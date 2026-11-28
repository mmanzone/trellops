/**
 * Admin access. Only Trello member ids listed in ADMIN_TRELLO_IDS (comma or
 * space separated) can use /api/admin. The member id comes from the signed
 * session cookie, which the server issued after checking the token with Trello.
 */
import { getSession, sessionsConfigured, type Session } from './session.js';
import { getDb, ensureSchema } from './db.js';
import { json } from './http.js';

export const adminIds = (env: Record<string, string | undefined> = process.env): string[] =>
  (env.ADMIN_TRELLO_IDS || '')
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export const isAdmin = (memberId: string | null | undefined): boolean =>
  !!memberId && adminIds().includes(memberId.toLowerCase());

type Sql = NonNullable<ReturnType<typeof getDb>>;

export async function requireAdmin(
  request: Request,
): Promise<{ session: Session; sql: Sql } | { response: Response }> {
  if (!sessionsConfigured()) {
    return { response: json(503, { error: 'Sign-in sessions are not configured (SESSION_SECRET).', code: 'NOT_CONFIGURED' }) };
  }
  const session = await getSession(request);
  if (!session) return { response: json(401, { error: 'Sign in with Trello first.', code: 'NO_SESSION' }) };
  if (!isAdmin(session.memberId)) {
    return { response: json(403, { error: 'This account is not an administrator.', code: 'NOT_ADMIN' }) };
  }
  const sql = getDb();
  if (!sql) return { response: json(503, { error: 'The database is not configured.', code: 'NO_DATABASE' }) };
  await ensureSchema(sql);
  return { session, sql };
}
