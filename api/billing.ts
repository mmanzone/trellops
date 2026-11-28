/**
 * /api/billing  (signed in)
 *
 * GET                       Whether checkout is open for this member, the
 *                           Paddle client token and environment, and the
 *                           member's own subscriptions.
 * POST { action: 'checkout', plan: 'pro'|'board', period: 'monthly'|'annual', packs?, boardId? }
 *                           Items and signed custom data for a Paddle.js checkout.
 * POST { action: 'portal' } A Paddle customer portal link (manage, cancel,
 *                           update the card, download invoices).
 * POST { action: 'setPacks', packs }
 *                           Changes the number of extra board packs on the
 *                           member's Pro subscription (prorated).
 *
 * Checkout opens for the members plan limits apply to (Admin > Plans and
 * limits): the test accounts first, then everyone at launch.
 */
import { json, methodNotAllowed } from './_lib/http.js';
import { getSession } from './_lib/session.js';
import { getDb, ensureSchema } from './_lib/db.js';
import { isTrelloId } from './_lib/validate.js';
import { loadEnforcement, isEnforcedFor } from './_lib/entitlements.js';
import { paddleConfigured, paddleEnv, loadPriceIds, signCheckoutData, paddleApi, PaddleError } from './_lib/paddle.js';

export const config = { maxDuration: 15 };

type Sql = NonNullable<ReturnType<typeof getDb>>;

const ACTIVE = `(status IN ('active', 'trialing', 'past_due', 'paused') AND (cancel_at IS NULL OR cancel_at > NOW()))`;
const MAX_PACKS = 20;

async function checkoutOpenFor(sql: Sql, memberId: string): Promise<boolean> {
  if (!paddleConfigured()) return false;
  // Checkout opens for whoever plan limits apply to: test accounts first, everyone at launch.
  return isEnforcedFor(await loadEnforcement(sql), memberId);
}

async function mySubscriptions(sql: Sql, memberId: string) {
  return (await sql.query(
    `SELECT paddle_subscription_id AS id, kind, board_id, status, plan_code, pack_quantity, billing_period,
            current_period_end, cancel_at, canceled_at, created_at
     FROM subscriptions WHERE trello_member_id = $1 AND environment IS NOT DISTINCT FROM $2
     ORDER BY created_at DESC`,
    [memberId, paddleEnv()],
  )) as any[];
}

async function handleGet(sql: Sql, memberId: string): Promise<Response> {
  const open = await checkoutOpenFor(sql, memberId);
  const ids = await loadPriceIds(sql);
  return json(200, {
    configured: paddleConfigured(),
    checkoutOpen: open,
    environment: paddleEnv(),
    clientToken: open ? process.env.PADDLE_CLIENT_TOKEN : null,
    available: {
      pro: Boolean(ids.pro.monthly || ids.pro.annual),
      packs: Boolean(ids.pack.monthly || ids.pack.annual),
      board: Boolean(ids.board.monthly || ids.board.annual),
    },
    subscriptions: await mySubscriptions(sql, memberId),
  });
}

async function checkout(sql: Sql, memberId: string, body: any): Promise<Response> {
  if (!(await checkoutOpenFor(sql, memberId))) return json(403, { error: 'Paid plans are not open yet.', code: 'CHECKOUT_CLOSED' });
  const plan = body?.plan === 'board' ? 'board' : body?.plan === 'pro' ? 'pro' : null;
  const period = body?.period === 'annual' ? 'annual' : 'monthly';
  if (!plan) return json(400, { error: 'Choose Pro or a Board plan.' });
  const ids = await loadPriceIds(sql);
  const users = (await sql.query(`SELECT email FROM users WHERE trello_member_id = $1`, [memberId])) as any[];
  const email = users[0]?.email || null;

  if (plan === 'pro') {
    const priceId = ids.pro[period];
    if (!priceId) return json(409, { error: 'Pro is not set up for this billing period yet.' });
    const existing = (await sql.query(
      `SELECT 1 FROM subscriptions WHERE kind = 'user' AND trello_member_id = $1 AND ${ACTIVE} LIMIT 1`,
      [memberId],
    )) as any[];
    if (existing.length) return json(409, { error: 'You already have Pro. Use Manage billing to change it.', code: 'ALREADY_SUBSCRIBED' });
    const packs = Math.max(0, Math.min(MAX_PACKS, Math.floor(Number(body?.packs) || 0)));
    const items = [{ priceId, quantity: 1 }];
    if (packs > 0) {
      if (!ids.pack[period]) return json(409, { error: 'Board packs are not set up for this billing period yet.' });
      items.push({ priceId: ids.pack[period] as string, quantity: packs });
    }
    return json(200, { items, customData: signCheckoutData({ memberId, kind: 'user', boardId: null }), email });
  }

  const boardId = isTrelloId(body?.boardId) ? String(body.boardId).toLowerCase() : null;
  if (!boardId) return json(400, { error: 'Choose a board first.' });
  const priceId = ids.board[period];
  if (!priceId) return json(409, { error: 'The Board plan is not set up for this billing period yet.' });
  const covered = (await sql.query(
    `SELECT 1 FROM subscriptions WHERE kind = 'board' AND board_id = $1 AND ${ACTIVE} LIMIT 1`,
    [boardId],
  )) as any[];
  if (covered.length) return json(409, { error: 'This board already has a Board plan.', code: 'ALREADY_SUBSCRIBED' });
  return json(200, { items: [{ priceId, quantity: 1 }], customData: signCheckoutData({ memberId, kind: 'board', boardId }), email });
}

async function portal(sql: Sql, memberId: string): Promise<Response> {
  const subs = (await sql.query(
    `SELECT paddle_subscription_id AS id, paddle_customer_id AS customer FROM subscriptions
     WHERE trello_member_id = $1 AND paddle_customer_id IS NOT NULL AND environment IS NOT DISTINCT FROM $2
     ORDER BY created_at DESC`,
    [memberId, paddleEnv()],
  )) as any[];
  if (!subs.length) return json(404, { error: 'No Paddle subscription was found for your account.' });
  const customer = subs[0].customer;
  const ids = subs.filter((s) => s.customer === customer).map((s) => s.id);
  const data = await paddleApi(`/customers/${encodeURIComponent(customer)}/portal-sessions`, { method: 'POST', body: { subscription_ids: ids } });
  const url = data?.urls?.general?.overview;
  if (!url) return json(502, { error: 'Paddle did not return a billing link.' });
  return json(200, { url });
}

async function setPacks(sql: Sql, memberId: string, body: any): Promise<Response> {
  const packs = Math.floor(Number(body?.packs));
  if (!Number.isInteger(packs) || packs < 0 || packs > MAX_PACKS) return json(400, { error: `Packs must be 0 to ${MAX_PACKS}.` });
  const rows = (await sql.query(
    `SELECT paddle_subscription_id AS id, billing_period FROM subscriptions
     WHERE kind = 'user' AND trello_member_id = $1 AND ${ACTIVE} AND environment IS NOT DISTINCT FROM $2
     ORDER BY created_at DESC LIMIT 1`,
    [memberId, paddleEnv()],
  )) as any[];
  if (!rows.length) return json(404, { error: 'You need a Pro subscription to add boards.' });
  const ids = await loadPriceIds(sql);
  const period = rows[0].billing_period === 'annual' ? 'annual' : 'monthly';
  if (!ids.pro[period] || (packs > 0 && !ids.pack[period])) return json(409, { error: 'Board packs are not set up for this billing period yet.' });
  const items: Array<{ price_id: string; quantity: number }> = [{ price_id: ids.pro[period] as string, quantity: 1 }];
  if (packs > 0) items.push({ price_id: ids.pack[period] as string, quantity: packs });
  await paddleApi(`/subscriptions/${encodeURIComponent(rows[0].id)}`, {
    method: 'PATCH',
    body: { items, proration_billing_mode: 'prorated_immediately' },
  });
  // The subscription.updated notification records the new count.
  return json(200, { ok: true, packs });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const session = await getSession(request);
    if (!session) return json(401, { error: 'Not signed in', code: 'NO_SESSION' });
    const sql = getDb();
    if (!sql) return json(503, { error: 'The database is not configured.', code: 'NO_DATABASE' });
    await ensureSchema(sql);
    try {
      if (request.method === 'GET') return await handleGet(sql, session.memberId);
      if (request.method !== 'POST') return methodNotAllowed('GET, POST');
      const body: any = await request.json().catch(() => null);
      switch (body?.action) {
        case 'checkout': return await checkout(sql, session.memberId, body);
        case 'portal': return await portal(sql, session.memberId);
        case 'setPacks': return await setPacks(sql, session.memberId, body);
        default: return json(400, { error: 'Unknown action.' });
      }
    } catch (e) {
      if (e instanceof PaddleError) {
        console.error('[billing]', e.message);
        return json(502, { error: 'Paddle could not complete that. Try again in a minute.' });
      }
      throw e;
    }
  },
};
