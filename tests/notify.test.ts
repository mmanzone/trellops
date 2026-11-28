import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import session from '../api/session';
import compRequests from '../api/comp-requests';
import { __setDbForTests, ensureSchema } from '../api/_lib/db';
import { createSessionToken, SESSION_COOKIE } from '../api/_lib/session';
import { signupEmail, compRequestEmail, sendAdminEmail, appUrl } from '../api/_lib/notify';
import { pgliteDb } from './pg';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const TOKEN = 'a'.repeat(64);
const USER = 'c'.repeat(24);
const BOARD = 'b'.repeat(24);

/** Answers Trello's member lookup and records every Resend call. */
function stubFetch() {
  const resend: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('https://api.resend.com')) {
      resend.push({ headers: init?.headers, body: JSON.parse(String(init?.body)) });
      return new Response('{"id":"e1"}', { status: 200 });
    }
    return new Response(JSON.stringify({ id: USER, username: 'pat', fullName: 'Pat <b>Test</b>', email: 'pat@example.org' }), { status: 200 });
  }));
  return resend;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  process.env.SESSION_SECRET = SECRET;
  process.env.RESEND_API_KEY = 're_test';
  process.env.NOTIFY_EMAIL_TO = 'admin@example.org, not-an-address';
  const { sql } = await pgliteDb();
  await ensureSchema(sql);
  __setDbForTests(sql);
});
afterEach(() => {
  for (const k of ['SESSION_SECRET', 'RESEND_API_KEY', 'NOTIFY_EMAIL_TO', 'NOTIFY_EMAIL_FROM', 'APP_URL']) delete process.env[k];
  vi.unstubAllGlobals();
  __setDbForTests(undefined as any);
});

const signIn = (cookie?: string) =>
  session.fetch(new Request('https://trellops.test/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ token: TOKEN }),
  }));

describe('admin email notifications', () => {
  it('emails the admins once when a new user signs up, with a link to the user in admin', async () => {
    const resend = stubFetch();
    await signIn();
    await flush();
    expect(resend).toHaveLength(1);
    const { body, headers } = resend[0];
    expect(headers.Authorization).toBe('Bearer re_test');
    expect(body.to).toEqual(['admin@example.org']);
    expect(body.subject).toBe('New Trellops user: Pat <b>Test</b>');
    expect(body.html).toContain(`https://trellops.test/admin?tab=users&amp;q=${USER}`);
    expect(body.html).toContain('Pat &lt;b&gt;Test&lt;/b&gt;');
    expect(body.html).not.toContain('<b>Test</b>');
    expect(body.text).toContain('pat@example.org');

    // A second sign-in by the same member is not a new user.
    await signIn();
    await flush();
    expect(resend).toHaveLength(1);
  });

  it('emails the admins about a charity request with a link to it', async () => {
    const resend = stubFetch();
    await signIn();
    await flush();
    process.env.APP_URL = 'https://trellops.xyz/';
    const cookie = `${SESSION_COOKIE}=${await createSessionToken({ memberId: USER, emailScope: true })}`;
    const res = await compRequests.fetch(new Request('https://preview.test/api/comp-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        boardId: BOARD, charityName: 'Harbour Food Bank', charityType: 'Registered charity',
        intendedUse: 'Volunteer shifts.', country: 'Australia', justification: 'No budget.',
      }),
    }));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    await flush();
    expect(resend).toHaveLength(2);
    const { body } = resend[1];
    expect(body.subject).toBe('Charity request: Harbour Food Bank');
    expect(body.html).toContain(`https://trellops.xyz/admin?tab=requests&amp;request=${id}`);
    expect(body.html).toContain('Volunteer shifts.');
    expect(body.html).toContain('pat, pat@example.org');
  });

  it('sends nothing without a key or recipients, and never throws', async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendAdminEmail(signupEmail({ id: USER, username: 'pat', email: null }, 'https://x.test'))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    process.env.RESEND_API_KEY = 're_test';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad from', { status: 422 })));
    expect(await sendAdminEmail(signupEmail({ id: USER, username: 'pat', email: null }, 'https://x.test'))).toBe(false);
  });

  it('builds links from APP_URL or the request origin', () => {
    expect(appUrl(new Request('https://preview.test/api/x'))).toBe('https://preview.test');
    process.env.APP_URL = 'https://trellops.xyz/';
    expect(appUrl(new Request('https://preview.test/api/x'))).toBe('https://trellops.xyz');
    const email = compRequestEmail(
      { id: 'r1', boardId: BOARD, charityName: 'A', charityType: 'Other', country: 'NZ', intendedUse: 'u', justification: 'j' },
      { memberId: USER },
      'https://trellops.xyz',
    );
    expect(email.text).toContain(`Requested by: ${USER}`);
  });
});
