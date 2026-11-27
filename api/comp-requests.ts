/**
 * POST /api/comp-requests
 *
 * A signed-in member asks for a free Board plan for a charity or NGO. The
 * request waits in the admin dashboard's review queue.
 */
import { json, methodNotAllowed } from './_lib/http.js';
import { getSession } from './_lib/session.js';
import { getDb, ensureSchema } from './_lib/db.js';
import { isTrelloId, cleanText, cleanLongText } from './_lib/validate.js';

export const config = { maxDuration: 10 };

export const CHARITY_TYPES = [
  'Registered charity',
  'Non-governmental organisation (NGO)',
  'Not-for-profit or community group',
  'Volunteer organisation',
  'Other',
];

const MAX_PENDING_PER_MEMBER = 5;

async function handlePost(request: Request): Promise<Response> {
  const session = await getSession(request);
  if (!session) return json(401, { error: 'Sign in with Trello to send a request.', code: 'NO_SESSION' });

  const body: any = await request.json().catch(() => null);
  const boardId = body?.boardId;
  const charityName = cleanText(body?.charityName, 160);
  const charityType = CHARITY_TYPES.includes(body?.charityType) ? (body.charityType as string) : null;
  const intendedUse = cleanLongText(body?.intendedUse, 2000);
  const country = cleanText(body?.country, 120);
  const justification = cleanLongText(body?.justification, 2000);

  const missing: string[] = [];
  if (!isTrelloId(boardId)) missing.push('board ID');
  if (!charityName) missing.push('organisation name');
  if (!charityType) missing.push('type of organisation');
  if (!intendedUse) missing.push('how you plan to use Trellops');
  if (!country) missing.push('country or location');
  if (!justification) missing.push('why you need the free plan');
  if (missing.length) return json(400, { error: `Please fill in: ${missing.join(', ')}.`, fields: missing });

  const sql = getDb();
  if (!sql) return json(503, { error: 'Requests cannot be received right now. Please try again later.' });
  await ensureSchema(sql);

  const pending = (await sql.query(
    `SELECT count(*)::int AS n FROM comp_requests WHERE trello_member_id = $1 AND status = 'pending'`,
    [session.memberId],
  )) as Array<{ n: number }>;
  if ((pending[0]?.n ?? 0) >= MAX_PENDING_PER_MEMBER) {
    return json(429, { error: 'You already have several requests waiting for review.' });
  }
  const duplicate = (await sql.query(
    `SELECT id FROM comp_requests WHERE board_id = $1 AND status = 'pending' LIMIT 1`,
    [boardId.toLowerCase()],
  )) as Array<{ id: string }>;
  if (duplicate.length) {
    return json(409, { error: 'A request for this board is already waiting for review.' });
  }

  const rows = (await sql.query(
    `INSERT INTO comp_requests (trello_member_id, board_id, charity_name, charity_type, intended_use, country, justification)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [session.memberId, boardId.toLowerCase(), charityName, charityType, intendedUse, country, justification],
  )) as Array<{ id: string }>;
  await sql.query(`INSERT INTO events (type, trello_member_id, payload) VALUES ('comp_request', $1, $2::jsonb)`, [
    session.memberId,
    JSON.stringify({ requestId: rows[0]?.id, boardId: boardId.toLowerCase() }),
  ]);
  return json(201, { id: rows[0]?.id, status: 'pending' });
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    return handlePost(request);
  },
};
