/**
 * Server-side Trello checks. The browser still talks to Trello directly; the
 * server only calls Trello to confirm who a token belongs to. Tokens are never
 * stored or logged.
 */

// The public Trello API key the browser already uses (src/utils/constants.js).
const DEFAULT_TRELLO_API_KEY = '558e200650487a28cf1cc0b33561cd82';
const TRELLO_API_BASE = 'https://api.trello.com/1';

export interface TrelloMember {
  id: string;
  username: string;
  fullName: string;
  /** Present only when the token was granted the `account` scope. */
  email: string | null;
}

export class TrelloAuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Trello tokens are 64 hex characters (older ones) or start with "ATTA". */
export const looksLikeTrelloToken = (token: unknown): token is string =>
  typeof token === 'string' && token.length >= 32 && token.length <= 512 && /^[A-Za-z0-9]+$/.test(token);

export async function verifyTrelloToken(token: string, fetchImpl: typeof fetch = fetch): Promise<TrelloMember> {
  const key = process.env.TRELLO_API_KEY || DEFAULT_TRELLO_API_KEY;
  const url = `${TRELLO_API_BASE}/members/me?fields=id,username,fullName,email&key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  } catch {
    throw new TrelloAuthError(502, 'Could not reach Trello to verify the sign-in.');
  }
  if (res.status === 401 || res.status === 400) {
    throw new TrelloAuthError(401, 'The Trello token is invalid or has expired.');
  }
  if (res.status === 429) {
    throw new TrelloAuthError(503, 'Trello is rate limiting requests. Try again shortly.');
  }
  if (!res.ok) {
    throw new TrelloAuthError(502, `Trello returned ${res.status} while verifying the sign-in.`);
  }
  const data: any = await res.json();
  if (!data?.id) throw new TrelloAuthError(502, 'Trello returned an unexpected response.');
  return {
    id: String(data.id),
    username: String(data.username || ''),
    fullName: String(data.fullName || ''),
    email: typeof data.email === 'string' && data.email ? data.email : null,
  };
}
