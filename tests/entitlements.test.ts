import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeEntitlements, DEFAULT_PLANS, ALL_FEATURES, isEnforcedFor, parseEnforcement, resolveEntitlements, type UserPlan } from '../api/_lib/entitlements';
import admin, { parsePlanUpdate } from '../api/admin';
import me from '../api/me';
import configs from '../api/configs';
import shares from '../api/shares';
import { __setDbForTests, ensureSchema } from '../api/_lib/db';
import { createSessionToken, SESSION_COOKIE } from '../api/_lib/session';
import { pgliteDb } from './pg';

const FREE: UserPlan = { code: 'free', source: 'free', packs: 0, expiresAt: null };
const PRO: UserPlan = { code: 'pro', source: 'paid', packs: 0, expiresAt: null };
const ids = (n: number) => Array.from({ length: n }, (_, i) => String(i).padStart(24, '0'));

describe('the access rule', () => {
  const base = { plans: DEFAULT_PLANS, enforced: true, countedBoardIds: [] as string[] };

  it('gives everyone every feature while enforcement is off', () => {
    const e = computeEntitlements({ ...base, enforced: false, userPlan: FREE });
    expect(e.features).toEqual([...ALL_FEATURES]);
    expect(e.plan).toBe('free');
    expect(e.boardLimit).toBeNull();
  });

  it('limits Free to one board, no features and a 60-minute refresh', () => {
    const e = computeEntitlements({ ...base, userPlan: FREE, board: { id: ids(1)[0], hasBoardPlan: false, member: false } });
    expect(e.features).toEqual([]);
    expect(e.minRefreshSeconds).toBe(3600);
    expect(e.boardLimit).toBe(1);
    expect(e.board?.allowed).toBe(true);
  });

  it('refuses a second board on Free and allows the one already used', () => {
    const [a, b] = ids(2);
    expect(computeEntitlements({ ...base, userPlan: FREE, countedBoardIds: [a], board: { id: b, hasBoardPlan: false, member: false } }).board?.allowed).toBe(false);
    expect(computeEntitlements({ ...base, userPlan: FREE, countedBoardIds: [a], board: { id: a, hasBoardPlan: false, member: false } }).board?.allowed).toBe(true);
  });

  it('blocks every board when over the limit, until boards are removed', () => {
    const [a, b] = ids(2);
    expect(computeEntitlements({ ...base, userPlan: FREE, countedBoardIds: [a, b], board: { id: a, hasBoardPlan: false, member: false } }).board?.allowed).toBe(false);
  });

  it('gives Pro 5 boards plus 5 per pack, all features and 60 s', () => {
    const e = computeEntitlements({ ...base, userPlan: { ...PRO, packs: 2 } });
    expect(e.boardLimit).toBe(15);
    expect(e.minRefreshSeconds).toBe(60);
    expect(e.features).toContain('share');
    expect(e.features).toContain('sync');
    const six = computeEntitlements({ ...base, userPlan: PRO, countedBoardIds: ids(5), board: { id: 'f'.repeat(24), hasBoardPlan: false, member: false } });
    expect(six.board?.allowed).toBe(false);
  });

  it('unlocks a Board plan board for its members only, without share or export', () => {
    const board = 'e'.repeat(24);
    const member = computeEntitlements({ ...base, userPlan: FREE, countedBoardIds: ids(1), board: { id: board, hasBoardPlan: true, member: true } });
    expect(member.board).toEqual({ id: board, coveredByBoardPlan: true, allowed: true });
    expect(member.features).toContain('map');
    expect(member.features).not.toContain('share');
    expect(member.features).not.toContain('export');
    expect(member.minRefreshSeconds).toBe(60);
    const outsider = computeEntitlements({ ...base, userPlan: FREE, countedBoardIds: ids(1), board: { id: board, hasBoardPlan: true, member: false } });
    expect(outsider.features).toEqual([]);
    expect(outsider.board?.allowed).toBe(false);
  });

  it('reads the enforcement switch', () => {
    const m = 'a'.repeat(24);
    expect(isEnforcedFor(parseEnforcement(null), m)).toBe(false);
    expect(isEnforcedFor(parseEnforcement({ mode: 'all' }), m)).toBe(true);
    expect(isEnforcedFor(parseEnforcement({ mode: 'test', testMemberIds: [m.toUpperCase()] }), m)).toBe(true);
    expect(isEnforcedFor(parseEnforcement({ mode: 'test', testMemberIds: ['b'.repeat(24)] }), m)).toBe(false);
  });

  it('validates plan edits', () => {
    expect(parsePlanUpdate({ code: 'pro', boardLimit: 5, boardsPerPack: 5, minRefreshSeconds: 15 }).ok).toBe(false);
    expect(parsePlanUpdate({ code: 'pro', boardLimit: 5, boardsPerPack: 5, minRefreshSeconds: 60 }).ok).toBe(true);
    expect(parsePlanUpdate({ code: 'gold', boardLimit: 5, boardsPerPack: 5, minRefreshSeconds: 60 }).ok).toBe(false);
  });
});

// --- Routes against real SQL ---------------------------------------------------

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const ADMIN = 'a'.repeat(24);
const USER = 'c'.repeat(24);
const B1 = '1'.repeat(24);
const B2 = '2'.repeat(24);
let sql: any;

const call = async (handler: any, path: string, memberId: string | null, init: RequestInit = {}, extra: Record<string, string> = {}) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  if (memberId) headers.cookie = `${SESSION_COOKIE}=${await createSessionToken({ memberId, emailScope: true })}`;
  const res = await handler.fetch(new Request(`https://trellops.test${path}`, { ...init, headers }));
  return { status: res.status, body: await res.json() };
};
const send = (handler: any, method: string, path: string, memberId: string | null, body?: unknown) =>
  call(handler, path, memberId, { method, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(async () => {
  process.env.SESSION_SECRET = SECRET;
  process.env.ADMIN_TRELLO_IDS = ADMIN;
  ({ sql } = await pgliteDb());
  __setDbForTests(sql);
  await ensureSchema(sql);
  await sql.query(`INSERT INTO users (trello_member_id, username, email) VALUES ($1, 'pat', 'pat@example.org'), ($2, 'admin', 'a@example.org')`, [USER, ADMIN]);
});
afterEach(() => {
  delete process.env.SESSION_SECRET;
  delete process.env.ADMIN_TRELLO_IDS;
  __setDbForTests(null);
});

const enforceFor = (testMemberIds: string[]) => send(admin, 'POST', '/api/admin', ADMIN, { action: 'setEnforcement', mode: 'test', testMemberIds });

describe('entitlement routes', () => {
  it('reports Free with all features while enforcement is off', async () => {
    const r = await call(me, `/api/me?board=${B1}`, USER);
    expect(r.status).toBe(200);
    expect(r.body.entitlements.enforced).toBe(false);
    expect(r.body.entitlements.plan).toBe('free');
    expect(r.body.entitlements.features).toContain('map');
  });

  it('flipping a test user between Free and Pro in admin changes their rights', async () => {
    expect((await enforceFor([USER])).status).toBe(200);
    let r = await call(me, `/api/me?board=${B1}`, USER);
    expect(r.body.entitlements.enforced).toBe(true);
    expect(r.body.entitlements.features).toEqual([]);
    expect(r.body.entitlements.minRefreshSeconds).toBe(3600);

    const grant = await send(admin, 'POST', '/api/admin', ADMIN, { action: 'grant', targetType: 'user', targetId: USER, reason: 'Beta tester' });
    expect(grant.status).toBe(201);
    r = await call(me, `/api/me?board=${B1}`, USER);
    expect(r.body.entitlements.plan).toBe('pro');
    expect(r.body.entitlements.features).toContain('map');

    await send(admin, 'POST', '/api/admin', ADMIN, { action: 'revoke', id: grant.body.id });
    r = await call(me, `/api/me?board=${B1}`, USER);
    expect(r.body.entitlements.plan).toBe('free');
  });

  it('enforces the board limit and frees a slot when a board is removed', async () => {
    await enforceFor([USER]);
    expect((await send(me, 'POST', '/api/me', USER, { boardId: B1 })).status).toBe(200);
    const second = await send(me, 'POST', '/api/me', USER, { boardId: B2 });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('BOARD_LIMIT');
    expect(second.body.boards).toEqual([B1]);
    expect((await send(me, 'DELETE', `/api/me?board=${B1}`, USER)).body.boards).toEqual([]);
    expect((await send(me, 'POST', '/api/me', USER, { boardId: B2 })).status).toBe(200);
  });

  it('covers a Board plan board after Trello confirms membership, and refuses public boards', async () => {
    await enforceFor([USER]);
    await send(admin, 'POST', '/api/admin', ADMIN, { action: 'grant', targetType: 'board', targetId: B2, reason: 'Charity' });
    const trello = (permissionLevel: string, members: string[]) => (async () =>
      new Response(JSON.stringify({ prefs: { permissionLevel }, members: members.map((id) => ({ id })) }))) as unknown as typeof fetch;

    let e = await resolveEntitlements(sql, USER, { boardId: B2, trelloToken: 'x'.repeat(64), fetchImpl: trello('public', [USER]) });
    expect(e.board?.coveredByBoardPlan).toBe(false);
    e = await resolveEntitlements(sql, USER, { boardId: B2, trelloToken: 'x'.repeat(64), fetchImpl: trello('private', ['d'.repeat(24)]) });
    expect(e.board?.coveredByBoardPlan).toBe(false);
    e = await resolveEntitlements(sql, USER, { boardId: B2, trelloToken: 'x'.repeat(64), fetchImpl: trello('private', [USER]) });
    expect(e.board?.coveredByBoardPlan).toBe(true);
    expect(e.features).toContain('map');
    // Cached for 24 hours: no token needed next time, and it does not use the Free slot.
    e = await resolveEntitlements(sql, USER, { boardId: B2 });
    expect(e.board?.coveredByBoardPlan).toBe(true);
    expect(e.boardsUsed).toBe(0);
    expect((await send(me, 'POST', '/api/me', USER, { boardId: B1 })).status).toBe(200);
  });

  it('starts a 14-day trial once for users without a plan', async () => {
    await enforceFor([USER]);
    const first = await send(admin, 'POST', '/api/admin', ADMIN, { action: 'startTrials' });
    expect(first.body.started).toBe(2);
    expect((await send(admin, 'POST', '/api/admin', ADMIN, { action: 'startTrials' })).body.started).toBe(0);
    const r = await call(me, '/api/me', USER);
    expect(r.body.entitlements.planSource).toBe('trial');
    const days = (new Date(r.body.entitlements.trialEndsAt).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
    const s = await call(admin, '/api/admin?view=settings', ADMIN);
    expect(s.body.trials.active).toBe(2);
    expect(s.body.enforcement.mode).toBe('test');
  });

  it('saves configs to the server for Pro only', async () => {
    await enforceFor([USER]);
    const cfg = { boardId: B1, blocks: [{ id: 'x' }] };
    expect((await send(configs, 'PUT', '/api/configs', USER, { boardId: B1, config: cfg })).status).toBe(403);
    await send(admin, 'POST', '/api/admin', ADMIN, { action: 'grant', targetType: 'user', targetId: USER, reason: 'Support' });
    expect((await send(configs, 'PUT', '/api/configs', USER, { boardId: B1, config: cfg })).status).toBe(200);
    const got = await call(configs, `/api/configs?board=${B1}`, USER);
    expect(got.body.config.blocks).toEqual([{ id: 'x' }]);
    expect((await call(configs, `/api/configs?board=${B2}`, USER)).status).toBe(404);
  });

  it('share links: Pro creates, Free importer gets a read-only answer without the config', async () => {
    const OTHER = 'd'.repeat(24);
    await enforceFor([USER, OTHER]);
    expect((await send(shares, 'POST', '/api/shares', USER, { boardId: B1, config: { a: 1 } })).status).toBe(403);
    await send(admin, 'POST', '/api/admin', ADMIN, { action: 'grant', targetType: 'user', targetId: USER, reason: 'Support' });
    const created = await send(shares, 'POST', '/api/shares', USER, { boardId: B1, config: { a: 1 } });
    expect(created.status).toBe(200);
    const id = created.body.id;
    expect((await call(shares, `/api/shares?id=${id}`, USER)).body).toMatchObject({ allowed: true, config: { a: 1 } });
    const free = await call(shares, `/api/shares?id=${id}`, OTHER);
    expect(free.body.allowed).toBe(false);
    expect(free.body.config).toBeUndefined();
    await send(shares, 'DELETE', `/api/shares?id=${id}`, USER);
    expect((await call(shares, `/api/shares?id=${id}`, USER)).status).toBe(404);
  });
});
