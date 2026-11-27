import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import admin, { parseGrant } from '../api/admin';
import me from '../api/me';
import compRequests from '../api/comp-requests';
import { __setDbForTests } from '../api/_lib/db';
import { createSessionToken, SESSION_COOKIE } from '../api/_lib/session';
import { pgliteDb } from './pg';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const ADMIN = 'a'.repeat(24);
const USER = 'c'.repeat(24);
const BOARD = 'b'.repeat(24);

let sql: any;

const cookieFor = async (memberId: string) =>
  `${SESSION_COOKIE}=${await createSessionToken({ memberId, emailScope: true })}`;

const call = async (handler: any, path: string, memberId: string | null, init: RequestInit = {}) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (memberId) headers.cookie = await cookieFor(memberId);
  const res = await handler.fetch(new Request(`https://trellops.test${path}`, { ...init, headers }));
  return { status: res.status, body: await res.json() };
};
const post = (handler: any, path: string, memberId: string | null, body: unknown) =>
  call(handler, path, memberId, { method: 'POST', body: JSON.stringify(body) });

beforeEach(async () => {
  process.env.SESSION_SECRET = SECRET;
  process.env.ADMIN_TRELLO_IDS = `${ADMIN}, someone-else`;
  ({ sql } = await pgliteDb());
  __setDbForTests(sql);
  // Seed: one user who signed up and uses one board.
  const { ensureSchema } = await import('../api/_lib/db');
  await ensureSchema(sql);
  await sql.query(`INSERT INTO users (trello_member_id, username, email, login_count) VALUES ($1, 'pat', 'pat@example.org', 2)`, [USER]);
  await sql.query(`INSERT INTO events (type, trello_member_id) VALUES ('signup', $1), ('login', $1)`, [USER]);
});
afterEach(() => {
  delete process.env.SESSION_SECRET;
  delete process.env.ADMIN_TRELLO_IDS;
  __setDbForTests(undefined as any);
});

describe('admin access', () => {
  it('refuses anonymous and non-admin callers', async () => {
    expect((await call(admin, '/api/admin?view=summary', null)).status).toBe(401);
    expect((await call(admin, '/api/admin?view=summary', USER)).status).toBe(403);
    expect((await call(admin, '/api/admin?view=summary', ADMIN)).status).toBe(200);
  });

  it('reports admin status from /api/me', async () => {
    expect((await call(me, '/api/me', ADMIN)).body.admin).toBe(true);
    expect((await call(me, '/api/me', USER)).body.admin).toBe(false);
  });
});

describe('board ids and the users view', () => {
  it('records a board id and lists it with the user', async () => {
    expect((await post(me, '/api/me', USER, { boardId: 'not-a-board' })).status).toBe(400);
    expect((await post(me, '/api/me', USER, { boardId: BOARD.toUpperCase() })).body.recorded).toBe(true);
    await post(me, '/api/me', USER, { boardId: BOARD }); // second visit only bumps last_seen_at

    const { body } = await call(admin, '/api/admin?view=users', ADMIN);
    expect(body.users).toHaveLength(1);
    expect(body.users[0]).toMatchObject({ trello_member_id: USER, email: 'pat@example.org', board_ids: [BOARD], override: null });

    const byBoard = await call(admin, `/api/admin?view=users&q=${BOARD}`, ADMIN);
    expect(byBoard.body.users).toHaveLength(1);
    const none = await call(admin, '/api/admin?view=users&q=nobody', ADMIN);
    expect(none.body.users).toHaveLength(0);
  });

  it('summarises users, sign-ins and plans', async () => {
    const { body } = await call(admin, '/api/admin?view=summary', ADMIN);
    expect(body.users).toMatchObject({ total: 1, active7: 1, new7: 1, with_email: 1 });
    expect(body.weekly.reduce((n: number, w: any) => n + w.sign_ins, 0)).toBe(2);
    expect(body.plans).toEqual({ free: 1, pro: 0, boardPlans: 0 });
    expect(body.pendingRequests).toBe(0);
  });
});

describe('overrides', () => {
  it('validates a grant', () => {
    expect(parseGrant({ targetType: 'team', targetId: USER, reason: 'Charity' }).ok).toBe(false);
    expect(parseGrant({ targetType: 'user', targetId: 'short', reason: 'Charity' }).ok).toBe(false);
    expect(parseGrant({ targetType: 'board', targetId: BOARD, reason: 'Because' }).ok).toBe(false);
    expect(parseGrant({ targetType: 'board', targetId: BOARD, planCode: 'pro', reason: 'NGO' }).ok).toBe(false);
    expect(parseGrant({ targetType: 'user', targetId: USER, reason: 'Support', expiresAt: '2000-01-01' }).ok).toBe(false);
    expect(parseGrant({ targetType: 'user', targetId: USER, reason: 'Support', packQuantity: 2 })).toMatchObject({ ok: true, value: { planCode: 'pro', packQuantity: 2 } });
  });

  it('grants Pro to a user, shows it, and revokes it', async () => {
    const granted = await post(admin, '/api/admin', ADMIN, { action: 'grant', targetType: 'user', targetId: USER, reason: 'Beta tester', packQuantity: 1 });
    expect(granted.status).toBe(201);

    let users = (await call(admin, '/api/admin?view=users', ADMIN)).body.users;
    expect(users[0].override).toMatchObject({ plan_code: 'pro', pack_quantity: 1, reason: 'Beta tester' });
    expect((await call(admin, '/api/admin?view=summary', ADMIN)).body.plans).toEqual({ free: 0, pro: 1, boardPlans: 0 });

    expect((await post(admin, '/api/admin', ADMIN, { action: 'revoke', id: granted.body.id })).status).toBe(200);
    expect((await post(admin, '/api/admin', ADMIN, { action: 'revoke', id: granted.body.id })).status).toBe(404);
    users = (await call(admin, '/api/admin?view=users', ADMIN)).body.users;
    expect(users[0].override).toBeNull();

    const log = await sql.query(`SELECT payload->>'action' AS action FROM events WHERE type = 'admin_change' ORDER BY id`);
    expect(log.map((r: any) => r.action)).toEqual(['grant', 'revoke']);
  });

  it('ignores an expired override', async () => {
    await sql.query(
      `INSERT INTO overrides (target_type, target_id, plan_code, reason, expires_at) VALUES ('user', $1, 'pro', 'Support', NOW() - INTERVAL '1 day')`,
      [USER],
    );
    const users = (await call(admin, '/api/admin?view=users', ADMIN)).body.users;
    expect(users[0].override).toBeNull();
    const list = (await call(admin, '/api/admin?view=overrides', ADMIN)).body.overrides;
    expect(list[0].active).toBe(false);
  });
});

describe('charity requests', () => {
  const form = {
    boardId: BOARD,
    charityName: 'Harbour Food Bank',
    charityType: 'Registered charity',
    intendedUse: 'Track volunteer shifts on a wall screen.',
    country: 'Australia',
    justification: 'Volunteer-run with no budget for software.',
  };

  it('requires sign-in and every field', async () => {
    expect((await post(compRequests, '/api/comp-requests', null, form)).status).toBe(401);
    delete process.env.SESSION_SECRET;
    expect((await post(compRequests, '/api/comp-requests', null, form)).body.code).toBe('NOT_CONFIGURED');
    process.env.SESSION_SECRET = SECRET;
    const missing = await post(compRequests, '/api/comp-requests', USER, { ...form, country: '', charityType: 'Club' });
    expect(missing.status).toBe(400);
    expect(missing.body.fields).toEqual(['type of organisation', 'country or location']);
  });

  it('queues a request, blocks a duplicate, and approval grants a free Board plan', async () => {
    const created = await post(compRequests, '/api/comp-requests', USER, form);
    expect(created.status).toBe(201);
    expect((await post(compRequests, '/api/comp-requests', USER, form)).status).toBe(409);

    const queue = (await call(admin, '/api/admin?view=requests', ADMIN)).body.requests;
    expect(queue[0]).toMatchObject({ status: 'pending', charity_name: 'Harbour Food Bank', requester_email: 'pat@example.org' });
    expect((await call(admin, '/api/admin?view=summary', ADMIN)).body.pendingRequests).toBe(1);

    const reviewed = await post(admin, '/api/admin', ADMIN, { action: 'review', id: created.body.id, decision: 'approve' });
    expect(reviewed.status).toBe(200);
    expect((await post(admin, '/api/admin', ADMIN, { action: 'review', id: created.body.id, decision: 'approve' })).status).toBe(404);

    const list = (await call(admin, '/api/admin?view=overrides', ADMIN)).body.overrides;
    expect(list[0]).toMatchObject({ target_type: 'board', target_id: BOARD, plan_code: 'board', reason: 'Charity', org_name: 'Harbour Food Bank', active: true, requester_email: 'pat@example.org' });
    expect((await call(admin, '/api/admin?view=summary', ADMIN)).body.plans.boardPlans).toBe(1);
  });

  it('declining leaves no plan', async () => {
    const created = await post(compRequests, '/api/comp-requests', USER, form);
    await post(admin, '/api/admin', ADMIN, { action: 'review', id: created.body.id, decision: 'decline' });
    expect((await call(admin, '/api/admin?view=overrides', ADMIN)).body.overrides).toHaveLength(0);
    expect((await call(admin, '/api/admin?view=requests', ADMIN)).body.requests[0].status).toBe('declined');
  });
});
