/**
 * /api/me
 *
 * GET              The signed-in member and whether they are an admin.
 * POST { boardId } Records that this member uses a board in Trellops (the id
 *                  only, never the name), for the admin dashboard.
 */
import { json, methodNotAllowed } from './_lib/http.js';
import { getSession } from './_lib/session.js';
import { getDb, ensureSchema } from './_lib/db.js';
import { isAdmin } from './_lib/admin.js';
import { isTrelloId } from './_lib/validate.js';

export const config = { maxDuration: 10 };

async function handlePost(request: Request, memberId: string): Promise<Response> {
  const body: any = await request.json().catch(() => null);
  const boardId = body?.boardId;
  if (!isTrelloId(boardId)) return json(400, { error: 'A valid Trello board id is required.' });

  const sql = getDb();
  if (!sql) return json(200, { recorded: false });
  try {
    await ensureSchema(sql);
    await sql.query(
      `INSERT INTO user_boards (trello_member_id, board_id) VALUES ($1, $2)
       ON CONFLICT (trello_member_id, board_id) DO UPDATE SET last_seen_at = NOW()`,
      [memberId, boardId.toLowerCase()],
    );
    return json(200, { recorded: true });
  } catch (e) {
    console.error('[me] failed to record board', e);
    return json(200, { recorded: false });
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const session = await getSession(request);
    if (!session) return json(401, { error: 'Not signed in', code: 'NO_SESSION' });
    switch (request.method) {
      case 'GET':
        return json(200, { memberId: session.memberId, emailScope: session.emailScope, admin: isAdmin(session.memberId) });
      case 'POST':
        return handlePost(request, session.memberId);
      default:
        return methodNotAllowed('GET, POST');
    }
  },
};
