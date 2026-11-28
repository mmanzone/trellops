/**
 * /api/me
 *
 * GET  ?board=<id>&boards=<id,id,...>
 *                        The signed-in member, whether they are an admin, and
 *                        their entitlements (on `board` when given). Send the
 *                        Trello token in X-Trello-Token so a Board plan can be
 *                        confirmed with Trello; it is used once and not stored.
 *                        `boardPlanBoards` lists which of `boards` (up to 200)
 *                        and the member's own boards have an active Board plan.
 * POST { boardId }       Records that this member uses a board (the id only,
 *                        never the name). Refused with 409 BOARD_LIMIT when the
 *                        plan's board limit is reached and plans are enforced.
 * DELETE ?board=<id>     Removes a board from the member's list, to free a slot.
 */
import { json, methodNotAllowed } from './_lib/http.js';
import { getSession, type Session } from './_lib/session.js';
import { getDb, ensureSchema } from './_lib/db.js';
import { isAdmin } from './_lib/admin.js';
import { isTrelloId } from './_lib/validate.js';
import { resolveEntitlements, activeBoards, boardsWithBoardPlan } from './_lib/entitlements.js';
import { looksLikeTrelloToken } from './_lib/trello.js';

export const config = { maxDuration: 10 };

const tokenFrom = (request: Request) => {
  const t = request.headers.get('x-trello-token');
  return looksLikeTrelloToken(t) ? t : null;
};

async function handleGet(request: Request, session: Session): Promise<Response> {
  const boardParam = new URL(request.url).searchParams.get('board');
  const boardId = isTrelloId(boardParam) ? boardParam.toLowerCase() : null;
  const base = { memberId: session.memberId, emailScope: session.emailScope, admin: isAdmin(session.memberId) };
  const sql = getDb();
  if (!sql) return json(200, { ...base, entitlements: null });
  try {
    const entitlements = await resolveEntitlements(sql, session.memberId, { boardId, trelloToken: tokenFrom(request) });
    const boards = (await activeBoards(sql, session.memberId)).map((b) => b.board_id);
    const asked = (new URL(request.url).searchParams.get('boards') || '')
      .split(',')
      .filter((id) => isTrelloId(id))
      .slice(0, 200)
      .map((id) => id.toLowerCase());
    const boardPlanBoards = [...(await boardsWithBoardPlan(sql, [...new Set([...boards, ...asked])]))];
    return json(200, { ...base, entitlements, boards, boardPlanBoards });
  } catch (e) {
    console.error('[me] failed to resolve entitlements', e);
    return json(200, { ...base, entitlements: null });
  }
}

async function handlePost(request: Request, memberId: string): Promise<Response> {
  const body: any = await request.json().catch(() => null);
  const boardId = body?.boardId;
  if (!isTrelloId(boardId)) return json(400, { error: 'A valid Trello board id is required.' });
  const id = boardId.toLowerCase();

  const sql = getDb();
  if (!sql) return json(200, { recorded: false });
  try {
    await ensureSchema(sql);
    const ent = await resolveEntitlements(sql, memberId, { boardId: id, trelloToken: tokenFrom(request) });
    if (ent.board && !ent.board.allowed) {
      const boards = (await activeBoards(sql, memberId)).map((b) => b.board_id);
      return json(409, {
        error: `Your plan covers ${ent.boardLimit} board${ent.boardLimit === 1 ? '' : 's'}. Remove a board to add this one.`,
        code: 'BOARD_LIMIT',
        boardLimit: ent.boardLimit,
        boards,
        entitlements: ent,
      });
    }
    await sql.query(
      `INSERT INTO user_boards (trello_member_id, board_id) VALUES ($1, $2)
       ON CONFLICT (trello_member_id, board_id) DO UPDATE SET last_seen_at = NOW(), removed_at = NULL`,
      [memberId, id],
    );
    return json(200, { recorded: true, entitlements: ent });
  } catch (e) {
    console.error('[me] failed to record board', e);
    return json(200, { recorded: false });
  }
}

async function handleDelete(request: Request, memberId: string): Promise<Response> {
  const boardParam = new URL(request.url).searchParams.get('board');
  if (!isTrelloId(boardParam)) return json(400, { error: 'A valid Trello board id is required.' });
  const sql = getDb();
  if (!sql) return json(503, { error: 'The database is not configured.', code: 'NO_DATABASE' });
  await ensureSchema(sql);
  await sql.query(`UPDATE user_boards SET removed_at = NOW() WHERE trello_member_id = $1 AND board_id = $2 AND removed_at IS NULL`, [
    memberId,
    boardParam.toLowerCase(),
  ]);
  await sql.query(`INSERT INTO events (type, trello_member_id, payload) VALUES ('board_removed', $1, $2::jsonb)`, [
    memberId,
    JSON.stringify({ boardId: boardParam.toLowerCase() }),
  ]);
  const boards = (await activeBoards(sql, memberId)).map((b) => b.board_id);
  return json(200, { removed: true, boards });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const session = await getSession(request);
    if (!session) return json(401, { error: 'Not signed in', code: 'NO_SESSION' });
    switch (request.method) {
      case 'GET':
        return handleGet(request, session);
      case 'POST':
        return handlePost(request, session.memberId);
      case 'DELETE':
        return handleDelete(request, session.memberId);
      default:
        return methodNotAllowed('GET, POST, DELETE');
    }
  },
};
