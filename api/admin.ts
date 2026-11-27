/**
 * /api/admin  (admins only, see api/_lib/admin.ts)
 *
 * GET ?view=summary    Totals, weekly sign-ins, plan counts
 * GET ?view=users&q=   Users with email, Trello id, plan, board ids
 * GET ?view=overrides  Plans granted without payment (users and boards)
 * GET ?view=requests   Charity and NGO requests
 *
 * POST { action: 'grant', targetType, targetId, planCode, packQuantity?, reason, orgName?, note?, expiresAt? }
 * POST { action: 'revoke', id }
 * POST { action: 'review', id, decision: 'approve' | 'decline' }
 *
 * Every change is written to the events table as `admin_change`.
 */
import { json, methodNotAllowed } from './_lib/http.js';
import { requireAdmin } from './_lib/admin.js';
import { isTrelloId, cleanText, cleanLongText } from './_lib/validate.js';

export const config = { maxDuration: 15 };

type Sql = Extract<Awaited<ReturnType<typeof requireAdmin>>, { sql: unknown }>['sql'];

export const OVERRIDE_REASONS = ['Charity', 'NGO', 'Beta tester', 'Support', 'Partner', 'Other'];
export const PLAN_FOR_TARGET: Record<string, string> = { user: 'pro', board: 'board' };

const ACTIVE_OVERRIDE = `o.revoked_at IS NULL AND (o.expires_at IS NULL OR o.expires_at > NOW())`;

async function summary(sql: Sql) {
  const [users] = (await sql.query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE last_seen_at > NOW() - INTERVAL '7 days')::int  AS active7,
           count(*) FILTER (WHERE last_seen_at > NOW() - INTERVAL '30 days')::int AS active30,
           count(*) FILTER (WHERE first_seen_at > NOW() - INTERVAL '7 days')::int AS new7,
           count(*) FILTER (WHERE email IS NOT NULL)::int AS with_email
    FROM users`)) as any[];
  const weekly = (await sql.query(`
    SELECT to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS week,
           count(*) FILTER (WHERE type IN ('login', 'signup'))::int AS sign_ins,
           count(*) FILTER (WHERE type = 'signup')::int AS new_users
    FROM events
    WHERE created_at > date_trunc('week', NOW()) - INTERVAL '11 weeks' AND type IN ('login', 'signup')
    GROUP BY 1 ORDER BY 1`)) as any[];
  const [plans] = (await sql.query(`
    SELECT count(*) FILTER (WHERE o.target_type = 'user')::int  AS pro_users,
           count(*) FILTER (WHERE o.target_type = 'board')::int AS board_plans
    FROM overrides o WHERE ${ACTIVE_OVERRIDE}`)) as any[];
  const [boards] = (await sql.query(`SELECT count(DISTINCT board_id)::int AS boards FROM user_boards`)) as any[];
  const [requests] = (await sql.query(`SELECT count(*)::int AS pending FROM comp_requests WHERE status = 'pending'`)) as any[];
  return {
    users,
    weekly,
    plans: { free: Math.max(0, users.total - plans.pro_users), pro: plans.pro_users, boardPlans: plans.board_plans },
    boardsInUse: boards.boards,
    pendingRequests: requests.pending,
  };
}

async function users(sql: Sql, q: string) {
  return sql.query(
    `SELECT u.trello_member_id, u.email, u.username, u.full_name, u.has_email_scope,
            u.first_seen_at, u.last_seen_at, u.last_login_at, u.login_count,
            COALESCE((SELECT array_agg(b.board_id ORDER BY b.last_seen_at DESC)
                      FROM user_boards b WHERE b.trello_member_id = u.trello_member_id), '{}') AS board_ids,
            (SELECT row_to_json(x) FROM (
                SELECT o.id, o.plan_code, o.pack_quantity, o.reason, o.expires_at
                FROM overrides o
                WHERE o.target_type = 'user' AND o.target_id = u.trello_member_id AND ${ACTIVE_OVERRIDE}
                ORDER BY o.created_at DESC LIMIT 1) x) AS override
     FROM users u
     WHERE $1 = '' OR u.email ILIKE '%' || $1 || '%' OR u.username ILIKE '%' || $1 || '%'
        OR u.trello_member_id = lower($1)
        OR EXISTS (SELECT 1 FROM user_boards b WHERE b.trello_member_id = u.trello_member_id AND b.board_id = lower($1))
     ORDER BY u.last_seen_at DESC
     LIMIT 2000`,
    [q],
  );
}

async function overrides(sql: Sql) {
  return sql.query(`
    SELECT o.*, (${ACTIVE_OVERRIDE}) AS active,
           tu.email AS target_email, tu.username AS target_username,
           CASE WHEN o.target_type = 'board'
                THEN (SELECT count(*)::int FROM user_boards b WHERE b.board_id = o.target_id) END AS members_seen,
           r.trello_member_id AS requester_id, ru.email AS requester_email
    FROM overrides o
    LEFT JOIN users tu ON o.target_type = 'user' AND tu.trello_member_id = o.target_id
    LEFT JOIN comp_requests r ON r.override_id = o.id
    LEFT JOIN users ru ON ru.trello_member_id = r.trello_member_id
    ORDER BY (${ACTIVE_OVERRIDE}) DESC, o.created_at DESC
    LIMIT 2000`);
}

async function requests(sql: Sql) {
  return sql.query(`
    SELECT r.*, u.email AS requester_email, u.username AS requester_username,
           (SELECT count(*)::int FROM user_boards b WHERE b.board_id = r.board_id) AS members_seen
    FROM comp_requests r
    LEFT JOIN users u ON u.trello_member_id = r.trello_member_id
    ORDER BY (r.status = 'pending') DESC, r.created_at DESC
    LIMIT 1000`);
}

const logChange = (sql: Sql, adminId: string, payload: Record<string, unknown>) =>
  sql.query(`INSERT INTO events (type, trello_member_id, payload) VALUES ('admin_change', $1, $2::jsonb)`, [
    adminId,
    JSON.stringify(payload),
  ]);

export function parseGrant(body: any): { ok: true; value: any } | { ok: false; error: string } {
  const targetType = body?.targetType;
  if (targetType !== 'user' && targetType !== 'board') return { ok: false, error: 'Choose a user or a board.' };
  if (!isTrelloId(body?.targetId)) {
    return { ok: false, error: `Enter a valid Trello ${targetType === 'user' ? 'member' : 'board'} ID (24 characters).` };
  }
  const planCode = PLAN_FOR_TARGET[targetType];
  if (body?.planCode && body.planCode !== planCode) return { ok: false, error: `A ${targetType} can only get the ${planCode} plan.` };
  const packQuantity = targetType === 'user' ? Number(body?.packQuantity ?? 0) : 0;
  if (!Number.isInteger(packQuantity) || packQuantity < 0 || packQuantity > 50) {
    return { ok: false, error: 'Extra board packs must be a whole number from 0 to 50.' };
  }
  if (!OVERRIDE_REASONS.includes(body?.reason)) return { ok: false, error: 'Choose a reason.' };
  const orgName = body?.orgName ? cleanText(body.orgName, 160) : null;
  if (body?.orgName && !orgName) return { ok: false, error: 'Organisation name is too long.' };
  const note = body?.note ? cleanLongText(body.note, 1000) : null;
  let expiresAt: string | null = null;
  if (body?.expiresAt) {
    const d = new Date(body.expiresAt);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return { ok: false, error: 'The expiry date must be in the future.' };
    expiresAt = d.toISOString();
  }
  return {
    ok: true,
    value: { targetType, targetId: body.targetId.toLowerCase(), planCode, packQuantity, reason: body.reason, orgName, note, expiresAt },
  };
}

async function handlePost(request: Request, sql: Sql, adminId: string): Promise<Response> {
  const body: any = await request.json().catch(() => null);
  switch (body?.action) {
    case 'grant': {
      const parsed = parseGrant(body);
      if (!parsed.ok) return json(400, { error: (parsed as { error: string }).error });
      const v = (parsed as { value: any }).value;
      const rows = (await sql.query(
        `INSERT INTO overrides (target_type, target_id, plan_code, pack_quantity, reason, org_name, note, granted_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [v.targetType, v.targetId, v.planCode, v.packQuantity, v.reason, v.orgName, v.note, adminId, v.expiresAt],
      )) as Array<{ id: string }>;
      await logChange(sql, adminId, { action: 'grant', overrideId: rows[0]?.id, ...v });
      return json(201, { id: rows[0]?.id });
    }
    case 'revoke': {
      const id = Number(body?.id);
      if (!Number.isInteger(id) || id <= 0) return json(400, { error: 'Missing override id.' });
      const rows = (await sql.query(
        `UPDATE overrides SET revoked_at = NOW(), revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING id`,
        [id, adminId],
      )) as any[];
      if (!rows.length) return json(404, { error: 'That override does not exist or is already revoked.' });
      await logChange(sql, adminId, { action: 'revoke', overrideId: id });
      return json(200, { ok: true });
    }
    case 'review': {
      const id = Number(body?.id);
      const decision = body?.decision;
      if (!Number.isInteger(id) || id <= 0 || (decision !== 'approve' && decision !== 'decline')) {
        return json(400, { error: 'Missing request id or decision.' });
      }
      const found = (await sql.query(`SELECT * FROM comp_requests WHERE id = $1 AND status = 'pending'`, [id])) as any[];
      const req = found[0];
      if (!req) return json(404, { error: 'That request does not exist or was already reviewed.' });

      let overrideId: string | null = null;
      if (decision === 'approve') {
        const rows = (await sql.query(
          `INSERT INTO overrides (target_type, target_id, plan_code, reason, org_name, note, granted_by)
           VALUES ('board', $1, 'board', 'Charity', $2, $3, $4) RETURNING id`,
          [req.board_id, req.charity_name, `Approved request #${id} (${req.charity_type}, ${req.country})`, adminId],
        )) as Array<{ id: string }>;
        overrideId = rows[0]?.id ?? null;
      }
      await sql.query(
        `UPDATE comp_requests SET status = $2, reviewed_at = NOW(), reviewed_by = $3, override_id = $4 WHERE id = $1`,
        [id, decision === 'approve' ? 'approved' : 'declined', adminId, overrideId],
      );
      await logChange(sql, adminId, { action: 'review', requestId: id, decision, overrideId, boardId: req.board_id });
      return json(200, { ok: true, overrideId });
    }
    default:
      return json(400, { error: 'Unknown action.' });
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const gate = await requireAdmin(request);
    if ('response' in gate) return gate.response;
    const { sql, session } = gate;
    try {
      if (request.method === 'GET') {
        const url = new URL(request.url);
        const view = url.searchParams.get('view') || 'summary';
        const q = (url.searchParams.get('q') || '').trim().slice(0, 120);
        if (view === 'summary') return json(200, await summary(sql));
        if (view === 'users') return json(200, { users: await users(sql, q) });
        if (view === 'overrides') return json(200, { overrides: await overrides(sql) });
        if (view === 'requests') return json(200, { requests: await requests(sql) });
        return json(400, { error: 'Unknown view.' });
      }
      if (request.method === 'POST') return handlePost(request, sql, session.memberId);
      return methodNotAllowed('GET, POST');
    } catch (e) {
      console.error('[admin] error', e);
      return json(500, { error: 'Something went wrong on the server.' });
    }
  },
};
