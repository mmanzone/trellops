/**
 * /api/shares  (share links, /?share=<id>)
 *
 * POST { boardId, config }  Pro: stores a config and returns its link id.
 * GET  ?id=<id>             Opens a link. Members without Pro get
 *                           { allowed: false } and no config (read-only warning).
 * DELETE ?id=<id>           The creator revokes a link.
 */
import { json, methodNotAllowed } from './_lib/http.js';
import { requireSession } from './_lib/session.js';
import { getDb, ensureSchema } from './_lib/db.js';
import { isTrelloId, MAX_CONFIG_BYTES } from './_lib/validate.js';
import { resolveEntitlements } from './_lib/entitlements.js';

export const config = { maxDuration: 10 };

const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const isShareId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9]{10,16}$/.test(v);

export function newShareId(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export default {
  async fetch(request: Request): Promise<Response> {
    const gate = await requireSession(request);
    if ('response' in gate) return gate.response;
    if (!gate.session) return json(503, { error: 'Sign-in sessions are not configured.', code: 'NOT_CONFIGURED' });
    const memberId = gate.session.memberId;
    const sql = getDb();
    if (!sql) return json(503, { error: 'The database is not configured.', code: 'NO_DATABASE' });
    await ensureSchema(sql);
    const url = new URL(request.url);

    if (request.method === 'POST') {
      const text = await request.text();
      if (text.length > MAX_CONFIG_BYTES) return json(413, { error: 'This configuration is too large to share.' });
      let body: any = null;
      try { body = JSON.parse(text); } catch { /* handled below */ }
      if (!isTrelloId(body?.boardId)) return json(400, { error: 'A valid Trello board id is required.' });
      if (!body?.config || typeof body.config !== 'object' || Array.isArray(body.config)) {
        return json(400, { error: 'A config object is required.' });
      }
      const ent = await resolveEntitlements(sql, memberId);
      if (!ent.features.includes('share')) {
        return json(403, { error: 'Share links need Trellops Pro.', code: 'NEEDS_PRO', feature: 'share' });
      }
      const boardId = body.boardId.toLowerCase();
      const id = newShareId();
      await sql.query(`INSERT INTO shares (id, trello_member_id, board_id, config) VALUES ($1, $2, $3, $4::jsonb)`, [
        id,
        memberId,
        boardId,
        JSON.stringify({ ...body.config, boardId }),
      ]);
      return json(200, { id });
    }

    if (request.method === 'GET') {
      const id = url.searchParams.get('id');
      if (!isShareId(id)) return json(400, { error: 'This share link is not valid.' });
      const rows = (await sql.query(`SELECT board_id, config, revoked_at FROM shares WHERE id = $1`, [id])) as any[];
      const share = rows[0];
      if (!share || share.revoked_at) return json(404, { error: 'This share link no longer exists.', code: 'NOT_FOUND' });
      const ent = await resolveEntitlements(sql, memberId);
      if (!ent.features.includes('share')) {
        return json(200, { allowed: false, boardId: share.board_id, code: 'NEEDS_PRO' });
      }
      return json(200, { allowed: true, boardId: share.board_id, config: share.config });
    }

    if (request.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!isShareId(id)) return json(400, { error: 'This share link is not valid.' });
      await sql.query(`UPDATE shares SET revoked_at = NOW() WHERE id = $1 AND trello_member_id = $2 AND revoked_at IS NULL`, [id, memberId]);
      return json(200, { revoked: true });
    }

    return methodNotAllowed('GET, POST, DELETE');
  },
};
