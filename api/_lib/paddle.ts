/**
 * Paddle Billing: configuration, webhook signatures, the API client and the
 * mapping from a Paddle subscription to a row in `subscriptions`.
 *
 * Environment:
 *   PADDLE_ENV             'sandbox' (default) or 'production'
 *   PADDLE_API_KEY         Server API key (never sent to the browser)
 *   PADDLE_CLIENT_TOKEN    Client-side token for Paddle.js (public)
 *   PADDLE_WEBHOOK_SECRET  Secret of the notification destination
 *
 * Price ids live in the plans table (Admin > Plans and limits).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getDb } from './db.js';

type Sql = NonNullable<ReturnType<typeof getDb>>;

export const paddleEnv = (): 'sandbox' | 'production' => (process.env.PADDLE_ENV === 'production' ? 'production' : 'sandbox');
export const paddleApiBase = () => (paddleEnv() === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com');
export const paddleConfigured = () => Boolean(process.env.PADDLE_API_KEY && process.env.PADDLE_CLIENT_TOKEN);

// --- Webhook signature --------------------------------------------------------

/** Paddle signs `${ts}:${rawBody}` with HMAC-SHA256; header is `ts=...;h1=...`. */
export function verifyPaddleSignature(rawBody: string, header: string | null, secret: string | undefined, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(';').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  ) as Record<string, string>;
  const ts = Number(parts.ts);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${parts.ts}:${rawBody}`).digest('hex');
  const given = header
    .split(';')
    .filter((p) => p.trim().startsWith('h1='))
    .map((p) => p.trim().slice(3));
  return given.some((h) => h.length === expected.length && timingSafeEqual(Buffer.from(h), Buffer.from(expected)));
}

// --- Checkout custom data -----------------------------------------------------

/**
 * The checkout carries who is buying and for which board. It is signed with
 * SESSION_SECRET so the webhook knows the browser did not change it.
 */
export interface CheckoutData {
  memberId: string;
  kind: 'user' | 'board';
  boardId: string | null;
}

const payload = (d: CheckoutData) => `${d.memberId}|${d.kind}|${d.boardId || ''}`;

export function signCheckoutData(d: CheckoutData): CheckoutData & { sig: string } {
  const secret = process.env.SESSION_SECRET || '';
  return { ...d, sig: createHmac('sha256', secret).update(payload(d)).digest('hex') };
}

export function readCheckoutData(raw: any): CheckoutData | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !raw || typeof raw !== 'object') return null;
  const d: CheckoutData = {
    memberId: String(raw.memberId || ''),
    kind: raw.kind === 'board' ? 'board' : 'user',
    boardId: raw.boardId ? String(raw.boardId).toLowerCase() : null,
  };
  if (!d.memberId || (d.kind === 'board' && !d.boardId)) return null;
  const expected = createHmac('sha256', secret).update(payload(d)).digest('hex');
  const sig = String(raw.sig || '');
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return d;
}

// --- Price ids ---------------------------------------------------------------

export interface PriceIds {
  pro: { monthly: string | null; annual: string | null };
  pack: { monthly: string | null; annual: string | null };
  board: { monthly: string | null; annual: string | null };
}

export async function loadPriceIds(sql: Sql): Promise<PriceIds> {
  const rows = (await sql.query(
    `SELECT code, paddle_price_monthly, paddle_price_annual, paddle_pack_price_monthly, paddle_pack_price_annual FROM plans`,
  )) as any[];
  const by = Object.fromEntries(rows.map((r) => [r.code, r]));
  return {
    pro: { monthly: by.pro?.paddle_price_monthly || null, annual: by.pro?.paddle_price_annual || null },
    pack: { monthly: by.pro?.paddle_pack_price_monthly || null, annual: by.pro?.paddle_pack_price_annual || null },
    board: { monthly: by.board?.paddle_price_monthly || null, annual: by.board?.paddle_price_annual || null },
  };
}

/** What a set of subscription items buys, by matching their price ids. */
export function classifyItems(items: Array<{ price?: { id?: string }; quantity?: number }>, ids: PriceIds) {
  let plan: 'pro' | 'board' | null = null;
  let period: 'monthly' | 'annual' | null = null;
  let packs = 0;
  for (const item of items || []) {
    const id = item?.price?.id;
    const qty = Number(item?.quantity) || 1;
    for (const p of ['monthly', 'annual'] as const) {
      if (id && id === ids.pro[p]) { plan = 'pro'; period = p; }
      if (id && id === ids.board[p]) { plan = plan || 'board'; period = period || p; }
      if (id && id === ids.pack[p]) packs += qty;
    }
  }
  return { plan, period, packs };
}

// --- API client --------------------------------------------------------------

export class PaddleError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function paddleApi(path: string, init: { method?: string; body?: unknown } = {}, fetchImpl: typeof fetch = fetch): Promise<any> {
  const key = process.env.PADDLE_API_KEY;
  if (!key) throw new PaddleError(503, 'Paddle is not configured.');
  const res = await fetchImpl(`${paddleApiBase()}${path}`, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(10000),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.error?.detail || data?.error?.code || `HTTP ${res.status}`;
    throw new PaddleError(res.status, `Paddle: ${detail}`);
  }
  return data?.data;
}

// --- Webhook -> subscriptions -------------------------------------------------

export type UpsertResult = 'stored' | 'stale' | 'unknown_member' | 'unknown_price';

/**
 * Writes a Paddle subscription (from a webhook `data` object) to the
 * subscriptions table. Events can arrive out of order, so an older event never
 * overwrites a newer one.
 */
export async function upsertSubscription(sql: Sql, sub: any, occurredAt: string): Promise<{ result: UpsertResult; memberId?: string; plan?: string; isNew?: boolean }> {
  const id = String(sub?.id || '');
  if (!id) return { result: 'unknown_member' };
  const existing = (await sql.query(
    `SELECT trello_member_id, kind, board_id, paddle_updated_at FROM subscriptions WHERE paddle_subscription_id = $1`,
    [id],
  )) as any[];
  const prev = existing[0];
  if (prev?.paddle_updated_at && new Date(prev.paddle_updated_at) > new Date(occurredAt)) return { result: 'stale' };

  const data = readCheckoutData(sub.custom_data);
  const memberId = data?.memberId || prev?.trello_member_id;
  if (!memberId) return { result: 'unknown_member' };

  const ids = await loadPriceIds(sql);
  const { plan, period, packs } = classifyItems(sub.items, ids);
  if (!plan) return { result: 'unknown_price' };
  const kind = plan === 'board' ? 'board' : 'user';
  const boardId = kind === 'board' ? data?.boardId || prev?.board_id || null : null;
  if (kind === 'board' && !boardId) return { result: 'unknown_member' };

  const periodEnd = sub.current_billing_period?.ends_at || null;
  const cancelAt = sub.scheduled_change?.action === 'cancel' ? sub.scheduled_change.effective_at : null;
  await sql.query(
    `INSERT INTO subscriptions (paddle_subscription_id, trello_member_id, kind, board_id, status, plan_code, pack_quantity,
                                current_period_end, canceled_at, paddle_customer_id, billing_period, cancel_at, paddle_updated_at, environment, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
     ON CONFLICT (paddle_subscription_id) DO UPDATE SET
       status = EXCLUDED.status, plan_code = EXCLUDED.plan_code, pack_quantity = EXCLUDED.pack_quantity,
       current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
       canceled_at = EXCLUDED.canceled_at, paddle_customer_id = EXCLUDED.paddle_customer_id,
       billing_period = EXCLUDED.billing_period, cancel_at = EXCLUDED.cancel_at,
       paddle_updated_at = EXCLUDED.paddle_updated_at, environment = EXCLUDED.environment, updated_at = NOW()`,
    [id, memberId, kind, boardId, String(sub.status || 'active'), plan, packs, periodEnd, sub.canceled_at || null,
      sub.customer_id || null, period, cancelAt, occurredAt, paddleEnv()],
  );
  return { result: 'stored', memberId, plan, isNew: !prev };
}
