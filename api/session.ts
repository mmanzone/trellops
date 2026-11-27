/**
 * /api/session
 *
 * POST   { token }  Verifies a Trello token with Trello, records the sign-in,
 *                   and sets a signed HttpOnly session cookie. The token is
 *                   used once for the check and never stored.
 * GET               Returns the current session (or 401).
 * DELETE            Signs out: clears the session cookie.
 */
import { json, methodNotAllowed } from './_lib/http.js';
import { verifyTrelloToken, looksLikeTrelloToken, TrelloAuthError } from './_lib/trello.js';
import {
  createSessionToken,
  getSession,
  sessionCookie,
  clearSessionCookie,
  sessionsConfigured,
} from './_lib/session.js';
import { recordLogin } from './_lib/db.js';

export const config = { maxDuration: 15 };

async function handlePost(request: Request): Promise<Response> {
  const body: any = await request.json().catch(() => null);
  const token = body?.token;
  if (!looksLikeTrelloToken(token)) return json(400, { error: 'A Trello token is required.' });

  let member;
  try {
    member = await verifyTrelloToken(token);
  } catch (e) {
    const status = e instanceof TrelloAuthError ? e.status : 502;
    return json(status, { error: (e as Error).message });
  }

  const existing = await getSession(request);
  const isNewSession = !existing || existing.memberId !== member.id;
  const emailScope = member.email !== null;

  let tracked = false;
  try {
    tracked = (await recordLogin(member, isNewSession)).recorded;
  } catch (e) {
    // Never block sign-in on the database.
    console.error('[session] failed to record sign-in', e);
  }

  const headers: Record<string, string> = {};
  if (sessionsConfigured()) {
    headers['Set-Cookie'] = sessionCookie(request, await createSessionToken({ memberId: member.id, emailScope }));
  }

  return json(
    200,
    {
      memberId: member.id,
      username: member.username,
      emailScope,
      tracked,
      sessions: sessionsConfigured(),
    },
    headers,
  );
}

export default {
  async fetch(request: Request): Promise<Response> {
    switch (request.method) {
      case 'POST':
        return handlePost(request);
      case 'GET': {
        const session = await getSession(request);
        return session ? json(200, session) : json(401, { error: 'Not signed in', code: 'NO_SESSION' });
      }
      case 'DELETE':
        return json(200, { ok: true }, { 'Set-Cookie': clearSessionCookie(request) });
      default:
        return methodNotAllowed('GET, POST, DELETE');
    }
  },
};
