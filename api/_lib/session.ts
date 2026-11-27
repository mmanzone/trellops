/**
 * Signed session cookie. After the server verifies a Trello token it issues an
 * HttpOnly cookie holding only the Trello member id, signed with SESSION_SECRET
 * (HS256). API routes read it to know who is calling without seeing the token.
 */
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'trellops_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const ISSUER = 'trellops';

export interface Session {
  memberId: string;
  /** Whether the Trello token that created this session could read the email. */
  emailScope: boolean;
}

const secretKey = (): Uint8Array | null => {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  return new TextEncoder().encode(secret);
};

export const sessionsConfigured = () => secretKey() !== null;

export async function createSessionToken(session: Session): Promise<string> {
  const key = secretKey();
  if (!key) throw new Error('SESSION_SECRET is not set (needs at least 32 characters).');
  return new SignJWT({ es: session.emailScope })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.memberId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(key);
}

export async function verifySessionToken(token: string): Promise<Session | null> {
  const key = secretKey();
  if (!key || !token) return null;
  try {
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER, algorithms: ['HS256'] });
    if (!payload.sub) return null;
    return { memberId: payload.sub, emailScope: payload.es === true };
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export async function getSession(request: Request): Promise<Session | null> {
  const token = readCookie(request, SESSION_COOKIE);
  return token ? verifySessionToken(token) : null;
}

const isSecure = (request: Request) => new URL(request.url).protocol === 'https:';

export function sessionCookie(request: Request, token: string): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    isSecure(request) ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

export function clearSessionCookie(request: Request): string {
  return [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', isSecure(request) ? 'Secure' : '']
    .filter(Boolean)
    .join('; ');
}

let warnedUnconfigured = false;

/**
 * Gate for API routes. Returns the session, or a 401 Response to send back.
 * While SESSION_SECRET is unset (before the env var is added in Vercel) the
 * gate stays open, so deploying this code cannot break production.
 */
export async function requireSession(request: Request): Promise<{ session: Session | null } | { response: Response }> {
  if (!sessionsConfigured()) {
    if (!warnedUnconfigured) {
      console.warn('[session] SESSION_SECRET is not set; API routes are not enforcing sign-in.');
      warnedUnconfigured = true;
    }
    return { session: null };
  }
  const session = await getSession(request);
  if (!session) {
    return {
      response: new Response(JSON.stringify({ error: 'Sign in with Trello to use this feature.', code: 'NO_SESSION' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
    };
  }
  return { session };
}
