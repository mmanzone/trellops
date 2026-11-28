import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import webhook from '../api/paddle-webhook';
import billing from '../api/billing';
import admin, { parsePlanUpdate } from '../api/admin';
import me from '../api/me';
import pricing from '../api/pricing';
import { __setDbForTests, ensureSchema } from '../api/_lib/db';
import { createSessionToken, SESSION_COOKIE } from '../api/_lib/session';
import { verifyPaddleSignature, signCheckoutData, readCheckoutData, classifyItems } from '../api/_lib/paddle';
import { pgliteDb } from './pg';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const HOOK_SECRET = 'pdl_ntfset_test_secret';
const ADMIN = 'a'.repeat(24);
const USER = 'c'.repeat(24);
const BOARD = 'b'.repeat(24);
const PRICES = {
  proM: 'pri_01proMonthly0000', proA: 'pri_01proAnnual00000',
  packM: 'pri_01packMonthly000', packA: 'pri_01packAnnual0000',
  boardM: 'pri_01boardMonthly00', boardA: 'pri_01boardAnnual000',
};

let sql: any;

const cookieFor = async (memberId: string) => `${SESSION_COOKIE}=${await createSessionToken({ memberId, emailScope: true })}`;
const call = async (handler: any, path: string, memberId: string | null, init: RequestInit = {}) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (memberId) headers.cookie = await cookieFor(memberId);
  const res = await handler.fetch(new Request(`https://trellops.test${path}`, { ...init, headers }));
  return { status: res.status, body: await res.json() };
};
const post = (handler: any, path: string, memberId: string | null, body: unknown) =>
  call(handler, path, memberId, { method: 'POST', body: JSON.stringify(body) });

const signed = (body: string, secret = HOOK_SECRET, ts = Math.floor(Date.now() / 1000)) =>
  `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`;

const deliver = async (event: unknown, signature?: string) => {
  const body = JSON.stringify(event);
  const res = await webhook.fetch(new Request('https://trellops.test/api/paddle-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Paddle-Signature': signature ?? signed(body) },
    body,
  }));
  return { status: res.status, body: await res.json() };
};

const subEvent = (overrides: any = {}, occurredAt = new Date().toISOString(), type = 'subscription.created') => ({
  event_id: `evt_${Math.random()}`,
  event_type: type,
  occurred_at: occurredAt,
  data: {
    id: 'sub_01test',
    status: 'active',
    customer_id: 'ctm_01test',
    custom_data: signCheckoutData({ memberId: USER, kind: 'user', boardId: null }),
    items: [{ price: { id: PRICES.proM }, quantity: 1 }],
    current_billing_period: { starts_at: '2026-11-28T00:00:00Z', ends_at: '2099-12-28T00:00:00Z' },
    scheduled_change: null,
    canceled_at: null,
    ...overrides,
  },
});

beforeEach(async () => {
  process.env.SESSION_SECRET = SECRET;
  process.env.ADMIN_TRELLO_IDS = ADMIN;
  process.env.PADDLE_WEBHOOK_SECRET = HOOK_SECRET;
  process.env.PADDLE_API_KEY = 'pdl_sdbx_apikey_test';
  process.env.PADDLE_CLIENT_TOKEN = 'test_clienttoken';
  ({ sql } = await pgliteDb());
  await ensureSchema(sql);
  __setDbForTests(sql);
  await sql.query(`INSERT INTO users (trello_member_id, username, email) VALUES ($1, 'pat', 'pat@example.org')`, [USER]);
  await sql.query(
    `UPDATE plans SET paddle_price_monthly = $1, paddle_price_annual = $2, paddle_pack_price_monthly = $3, paddle_pack_price_annual = $4 WHERE code = 'pro'`,
    [PRICES.proM, PRICES.proA, PRICES.packM, PRICES.packA],
  );
  await sql.query(`UPDATE plans SET paddle_price_monthly = $1, paddle_price_annual = $2 WHERE code = 'board'`, [PRICES.boardM, PRICES.boardA]);
});
afterEach(() => {
  for (const k of ['SESSION_SECRET', 'ADMIN_TRELLO_IDS', 'PADDLE_WEBHOOK_SECRET', 'PADDLE_API_KEY', 'PADDLE_CLIENT_TOKEN', 'PADDLE_ENV']) delete process.env[k];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __setDbForTests(undefined as any);
});

const enforceFor = (ids: string[], mode = 'test') =>
  sql.query(`INSERT INTO app_settings (key, value) VALUES ('enforcement', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [
    JSON.stringify({ mode, testMemberIds: ids }),
  ]);

describe('Paddle signatures and custom data', () => {
  it('accepts a correct signature and rejects a wrong, old or missing one', () => {
    const body = '{"a":1}';
    const now = 1_800_000_000;
    expect(verifyPaddleSignature(body, signed(body, HOOK_SECRET, now), HOOK_SECRET, now)).toBe(true);
    expect(verifyPaddleSignature(body + ' ', signed(body, HOOK_SECRET, now), HOOK_SECRET, now)).toBe(false);
    expect(verifyPaddleSignature(body, signed(body, 'other', now), HOOK_SECRET, now)).toBe(false);
    expect(verifyPaddleSignature(body, signed(body, HOOK_SECRET, now - 600), HOOK_SECRET, now)).toBe(false);
    expect(verifyPaddleSignature(body, null, HOOK_SECRET, now)).toBe(false);
    expect(verifyPaddleSignature(body, signed(body, HOOK_SECRET, now), undefined, now)).toBe(false);
  });

  it('detects custom data changed in the browser', () => {
    const d = signCheckoutData({ memberId: USER, kind: 'board', boardId: BOARD });
    expect(readCheckoutData(d)).toEqual({ memberId: USER, kind: 'board', boardId: BOARD });
    expect(readCheckoutData({ ...d, memberId: ADMIN })).toBeNull();
    expect(readCheckoutData({ ...d, boardId: 'd'.repeat(24) })).toBeNull();
    expect(readCheckoutData({ memberId: USER, kind: 'user' })).toBeNull();
  });

  it('works out the plan, period and packs from the price ids', () => {
    const ids = { pro: { monthly: 'p1', annual: 'p2' }, pack: { monthly: 'k1', annual: 'k2' }, board: { monthly: 'b1', annual: 'b2' } };
    expect(classifyItems([{ price: { id: 'p2' }, quantity: 1 }, { price: { id: 'k2' }, quantity: 3 }], ids)).toEqual({ plan: 'pro', period: 'annual', packs: 3 });
    expect(classifyItems([{ price: { id: 'b1' }, quantity: 1 }], ids)).toEqual({ plan: 'board', period: 'monthly', packs: 0 });
    expect(classifyItems([{ price: { id: 'zzz' }, quantity: 1 }], ids).plan).toBeNull();
  });
});

describe('POST /api/paddle-webhook', () => {
  it('refuses an unsigned notification', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await deliver(subEvent(), 'ts=1;h1=bad')).status).toBe(401);
    expect((await sql.query(`SELECT count(*)::int AS n FROM subscriptions`))[0].n).toBe(0);
  });

  it('accepts a secret pasted with a trailing newline or spaces', async () => {
    process.env.PADDLE_WEBHOOK_SECRET = `  ${HOOK_SECRET}\n`;
    expect((await deliver(subEvent())).status).toBe(200);
  });

  it('turns on Pro from a new subscription and keeps packs and cancellation in step', async () => {
    await enforceFor([USER]);
    expect((await deliver(subEvent())).body.outcome).toBe('stored');
    let ent = (await call(me, '/api/me', USER)).body.entitlements;
    expect(ent).toMatchObject({ plan: 'pro', planSource: 'paid' });

    const t = new Date(Date.now() + 1000).toISOString();
    await deliver(subEvent({ items: [{ price: { id: PRICES.proM }, quantity: 1 }, { price: { id: PRICES.packM }, quantity: 2 }] }, t, 'subscription.updated'));
    ent = (await call(me, '/api/me', USER)).body.entitlements;
    expect(ent.boardLimit).toBe(15);

    // An older event arriving late changes nothing.
    expect((await deliver(subEvent({}, new Date(Date.now() - 60000).toISOString(), 'subscription.updated'))).body.outcome).toBe('stale');
    expect((await call(me, '/api/me', USER)).body.entitlements.boardLimit).toBe(15);

    // Cancelled at the end of the period: still Pro until then.
    const t2 = new Date(Date.now() + 2000).toISOString();
    await deliver(subEvent({ scheduled_change: { action: 'cancel', effective_at: '2099-12-28T00:00:00Z' } }, t2, 'subscription.updated'));
    expect((await call(me, '/api/me', USER)).body.entitlements.plan).toBe('pro');

    // The period has ended.
    const t3 = new Date(Date.now() + 3000).toISOString();
    await deliver(subEvent({ status: 'canceled', current_billing_period: { ends_at: '2020-01-01T00:00:00Z' }, canceled_at: '2020-01-01T00:00:00Z' }, t3, 'subscription.canceled'));
    expect((await call(me, '/api/me', USER)).body.entitlements.plan).toBe('free');

    const log = await sql.query(`SELECT payload FROM events WHERE type = 'paddle' ORDER BY id`);
    expect(log.map((r: any) => r.payload.outcome)).toEqual(['stored', 'stored', 'stale', 'stored', 'stored']);
  });

  it('records a Board plan for the board in the signed custom data', async () => {
    await deliver(subEvent({
      id: 'sub_board',
      items: [{ price: { id: PRICES.boardA }, quantity: 1 }],
      custom_data: signCheckoutData({ memberId: USER, kind: 'board', boardId: BOARD }),
    }));
    const rows = await sql.query(`SELECT kind, board_id, plan_code, billing_period FROM subscriptions WHERE paddle_subscription_id = 'sub_board'`);
    expect(rows[0]).toEqual({ kind: 'board', board_id: BOARD, plan_code: 'board', billing_period: 'annual' });
  });

  it('ignores forged custom data and asks Paddle to retry an unknown price', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const forged = await deliver(subEvent({ custom_data: { memberId: ADMIN, kind: 'user', sig: 'x'.repeat(64) } }));
    expect(forged.body.outcome).toBe('unknown_member');
    const unknown = await deliver(subEvent({ id: 'sub_2', items: [{ price: { id: 'pri_unknown' }, quantity: 1 }] }));
    expect(unknown.status).toBe(500);
    expect((await sql.query(`SELECT count(*)::int AS n FROM subscriptions`))[0].n).toBe(0);
  });
});

describe('/api/billing', () => {
  it('keeps checkout closed until plan limits apply to the member', async () => {
    expect((await call(billing, '/api/billing', USER)).body).toMatchObject({ checkoutOpen: false, clientToken: null });
    expect((await post(billing, '/api/billing', USER, { action: 'checkout', plan: 'pro', period: 'monthly' })).status).toBe(403);

    await enforceFor([USER]);
    const open = (await call(billing, '/api/billing', USER)).body;
    expect(open).toMatchObject({ checkoutOpen: true, clientToken: 'test_clienttoken', environment: 'sandbox', available: { pro: true, packs: true, board: true } });
    expect((await call(billing, '/api/billing', ADMIN)).body.checkoutOpen).toBe(false);
    expect((await call(pricing, '/api/pricing', null)).body.salesOpen).toBe(false);
    await enforceFor([], 'all');
    expect((await call(pricing, '/api/pricing', null)).body.salesOpen).toBe(true);
  });

  it('prepares a signed Pro checkout with packs, and a Board plan checkout', async () => {
    await enforceFor([USER]);
    const pro = (await post(billing, '/api/billing', USER, { action: 'checkout', plan: 'pro', period: 'annual', packs: 2 })).body;
    expect(pro.items).toEqual([{ priceId: PRICES.proA, quantity: 1 }, { priceId: PRICES.packA, quantity: 2 }]);
    expect(pro.email).toBe('pat@example.org');
    expect(readCheckoutData(pro.customData)).toEqual({ memberId: USER, kind: 'user', boardId: null });

    expect((await post(billing, '/api/billing', USER, { action: 'checkout', plan: 'board', period: 'monthly' })).status).toBe(400);
    const board = (await post(billing, '/api/billing', USER, { action: 'checkout', plan: 'board', period: 'monthly', boardId: BOARD.toUpperCase() })).body;
    expect(board.items).toEqual([{ priceId: PRICES.boardM, quantity: 1 }]);
    expect(readCheckoutData(board.customData)).toEqual({ memberId: USER, kind: 'board', boardId: BOARD });
  });

  it('refuses a second Pro subscription and lists the member\'s own', async () => {
    await enforceFor([USER]);
    await deliver(subEvent());
    const again = await post(billing, '/api/billing', USER, { action: 'checkout', plan: 'pro', period: 'monthly' });
    expect(again.body.code).toBe('ALREADY_SUBSCRIBED');
    const subs = (await call(billing, '/api/billing', USER)).body.subscriptions;
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ id: 'sub_01test', plan_code: 'pro', status: 'active', billing_period: 'monthly' });
  });

  it('opens the customer portal and changes packs through the Paddle API', async () => {
    await deliver(subEvent());
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null });
      const data = String(url).includes('portal-sessions') ? { urls: { general: { overview: 'https://customer-portal.paddle.com/x' } } } : { id: 'sub_01test' };
      return new Response(JSON.stringify({ data }), { status: 200 });
    }));
    expect((await post(billing, '/api/billing', USER, { action: 'portal' })).body.url).toBe('https://customer-portal.paddle.com/x');
    expect(calls[0]).toMatchObject({ url: 'https://sandbox-api.paddle.com/customers/ctm_01test/portal-sessions', method: 'POST', body: { subscription_ids: ['sub_01test'] } });

    expect((await post(billing, '/api/billing', USER, { action: 'setPacks', packs: 3 })).body).toEqual({ ok: true, packs: 3 });
    expect(calls[1]).toMatchObject({
      url: 'https://sandbox-api.paddle.com/subscriptions/sub_01test',
      method: 'PATCH',
      body: { items: [{ price_id: PRICES.proM, quantity: 1 }, { price_id: PRICES.packM, quantity: 3 }], proration_billing_mode: 'prorated_immediately' },
    });
    expect((await post(billing, '/api/billing', USER, { action: 'setPacks', packs: 99 })).status).toBe(400);
  });
});

describe('admin Paddle settings', () => {
  it('validates and saves price ids', async () => {
    const base = { code: 'pro', boardLimit: 5, boardsPerPack: 5, minRefreshSeconds: 60 };
    expect(parsePlanUpdate({ ...base, paddlePriceMonthly: 'price_123' }).ok).toBe(false);
    expect(parsePlanUpdate({ ...base, paddlePriceMonthly: ' pri_01abcdefghij ' })).toMatchObject({ ok: true, value: { priceIds: { paddlePriceMonthly: 'pri_01abcdefghij' } } });

    expect((await post(admin, '/api/admin', ADMIN, { action: 'updatePlan', ...base, paddlePriceAnnual: 'pri_01newannual000', paddlePackPriceAnnual: '' })).status).toBe(200);
    const settings = (await call(admin, '/api/admin?view=settings', ADMIN)).body.paddle;
    expect(settings).toMatchObject({ configured: true, environment: 'sandbox', webhook: true });
    expect(settings.priceIds.pro).toEqual({ monthly: PRICES.proM, annual: 'pri_01newannual000' });
    expect(settings.priceIds.pack.annual).toBeNull();
  });

  it('lists subscriptions and shows paid Pro on the user', async () => {
    await deliver(subEvent());
    const subs = (await call(admin, '/api/admin?view=subscriptions', ADMIN)).body.subscriptions;
    expect(subs[0]).toMatchObject({ id: 'sub_01test', email: 'pat@example.org', plan_code: 'pro' });
    const users = (await call(admin, `/api/admin?view=users&q=${USER}`, ADMIN)).body.users;
    expect(users[0].subscription).toMatchObject({ plan_code: 'pro', status: 'active' });
  });
});
