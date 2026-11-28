/**
 * /api/configs  (Pro: dashboard settings follow the member to any device)
 *
 * GET ?board=<id>           The saved config for that board, or 404.
 * GET                       Board ids with a saved config and when they changed.
 * PUT { boardId, config }   Saves the config (the same object as Export).
 *
 * Free members keep their settings in the browser only.
 */
import { json, methodNotAllowed } from './_lib/http.js';
import { requireSession } from './_lib/session.js';
import { getDb, ensureSchema } from './_lib/db.js';
import { isTrelloId, MAX_CONFIG_BYTES } from './_lib/validate.js';
import { resolveEntitlements } from './_lib/entitlements.js';

export const config = { maxDuration: 10 };



export default {
  async fetch(request: Request): Promise<Response> {
    const gate = await requireSession(request);
    if ('response' in gate) return gate.response;
    if (!gate.session) return json(503, { error: 'Sign-in sessions are not configured.', code: 'NOT_CONFIGURED' });
    const memberId = gate.session.memberId;
    const sql = getDb();
    if (!sql) return json(503, { error: 'The database is not configured.', code: 'NO_DATABASE' });
    await ensureSchema(sql);

    if (request.method === 'GET') {
      const board = new URL(request.url).searchParams.get('board');
      if (board) {
        if (!isTrelloId(board)) return json(400, { error: 'A valid Trello board id is required.' });
        const rows = (await sql.query(
          `SELECT config, updated_at FROM board_configs WHERE trello_member_id = $1 AND board_id = $2`,
          [memberId, board.toLowerCase()],
        )) as any[];
        if (!rows[0]) return json(404, { error: 'No saved config for this board.', code: 'NOT_FOUND' });
        return json(200, { boardId: board.toLowerCase(), config: rows[0].config, updatedAt: rows[0].updated_at });
      }
      const rows = await sql.query(
        `SELECT board_id, updated_at FROM board_configs WHERE trello_member_id = $1 ORDER BY updated_at DESC`,
        [memberId],
      );
      return json(200, { configs: rows });
    }

    if (request.method === 'PUT') {
      const text = await request.text();
      if (text.length > MAX_CONFIG_BYTES) return json(413, { error: 'This configuration is too large to save.' });
      let body: any = null;
      try { body = JSON.parse(text); } catch { /* handled below */ }
      if (!isTrelloId(body?.boardId)) return json(400, { error: 'A valid Trello board id is required.' });
      if (!body?.config || typeof body.config !== 'object' || Array.isArray(body.config)) {
        return json(400, { error: 'A config object is required.' });
      }
      const boardId = body.boardId.toLowerCase();
      const ent = await resolveEntitlements(sql, memberId, { boardId });
      if (!ent.features.includes('sync')) {
        return json(403, { error: 'Saving settings to your account needs Trellops Pro.', code: 'NEEDS_PRO', feature: 'sync' });
      }
      if (ent.board && !ent.board.allowed) {
        return json(409, { error: 'This board is over your plan\'s board limit.', code: 'BOARD_LIMIT' });
      }
      await sql.query(
        `INSERT INTO board_configs (trello_member_id, board_id, config) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (trello_member_id, board_id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`,
        [memberId, boardId, JSON.stringify({ ...body.config, boardId })],
      );
      return json(200, { saved: true });
    }

    return methodNotAllowed('GET, PUT');
  },
};
