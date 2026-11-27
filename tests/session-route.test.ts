import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../api/session';
import summarize from '../api/summarize';
import { __setDbForTests, splitStatements, databaseUrl } from '../api/_lib/db';
import { SCHEMA_SQL } from '../api/_lib/schema';
import { SESSION_COOKIE } from '../api/_lib/session';
import { readFileSync } from 'node:fs';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const TOKEN = 'a'.repeat(64);

const trelloMember = (email: string | null) => ({ id: 'member1', username: 'pat', fullName: 'Pat Test', ...(email ? { email } : {}) });

function mockTrello(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Minimal stand-in for the Neon query function that records every query. */
function fakeDb(inserted = true) {
  const queries: Array<{ text: string; params?: unknown[] }> = [];
  const sql: any = () => { throw new Error('tagged template not used'); };
  sql.query = async (text: string, params?: unknown[]) => {
    queries.push({ text, params });
    return text.startsWith('INSERT INTO users') ? [{ inserted }] : [];
  };
  return { sql, queries };
}

const post = (body: unknown, cookie?: string) =>
  handler.fetch(new Request('https://trellops.test/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  }));

describe('POST /api/session', () => {
  beforeEach(() => { process.env.SESSION_SECRET = SECRET; __setDbForTests(null); });
  afterEach(() => { delete process.env.SESSION_SECRET; vi.unstubAllGlobals(); __setDbForTests(undefined as any); });

  it('rejects a missing or malformed token without calling Trello', async () => {
    const fetchMock = mockTrello(200, trelloMember(null));
    expect((await post({})).status).toBe(400);
    expect((await post({ token: 'short' })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 401 when Trello rejects the token', async () => {
    mockTrello(401, 'invalid token');
    expect((await post({ token: TOKEN })).status).toBe(401);
  });

  it('asks Trello for the email and never echoes the token', async () => {
    const fetchMock = mockTrello(200, trelloMember('pat@example.com'));
    const res = await post({ token: TOKEN });
    expect(res.status).toBe(200);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/members/me?fields=id,username,fullName,email');
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text)).toMatchObject({ memberId: 'member1', emailScope: true, tracked: false, sessions: true });
    expect(res.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=`);
  });

  it('reports a token without the account scope', async () => {
    mockTrello(200, trelloMember(null));
    const body = await (await post({ token: TOKEN })).json();
    expect(body.emailScope).toBe(false);
  });

  it('sets no cookie while SESSION_SECRET is unset', async () => {
    delete process.env.SESSION_SECRET;
    mockTrello(200, trelloMember(null));
    const res = await post({ token: TOKEN });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('records a new sign-in once, and a reload only as a visit', async () => {
    const { sql, queries } = fakeDb(true);
    __setDbForTests(sql);
    mockTrello(200, trelloMember('pat@example.com'));

    const first = await post({ token: TOKEN });
    expect((await first.json()).tracked).toBe(true);
    const schemaCount = splitStatements(SCHEMA_SQL).length;
    const userUpsert = queries[schemaCount];
    expect(userUpsert.text).toContain('INSERT INTO users');
    expect(userUpsert.params).toEqual(['member1', 'pat', 'Pat Test', 'pat@example.com', true, true]);
    expect(queries[schemaCount + 1].text).toContain('INSERT INTO events');
    expect(queries[schemaCount + 1].params?.[0]).toBe('signup');

    // Reload with the cookie from the first call: no new login event.
    const cookie = first.headers.get('set-cookie')!.split(';')[0];
    const { sql: sql2, queries: q2 } = fakeDb(false);
    __setDbForTests(sql2);
    await post({ token: TOKEN }, cookie);
    const upserts = q2.filter((q) => q.text.startsWith('INSERT INTO users'));
    expect(upserts[0].params?.[5]).toBe(false);
    expect(q2.some((q) => q.text.startsWith('INSERT INTO events'))).toBe(false);
  });

  it('still signs in when the database fails', async () => {
    const sql: any = () => {};
    sql.query = async () => { throw new Error('db down'); };
    __setDbForTests(sql);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockTrello(200, trelloMember(null));
    const res = await post({ token: TOKEN });
    expect(res.status).toBe(200);
    expect((await res.json()).tracked).toBe(false);
  });
});

describe('other methods', () => {
  beforeEach(() => { process.env.SESSION_SECRET = SECRET; });
  afterEach(() => { delete process.env.SESSION_SECRET; });

  it('GET without a cookie is 401, DELETE clears the cookie', async () => {
    const get = await handler.fetch(new Request('https://trellops.test/api/session'));
    expect(get.status).toBe(401);
    const del = await handler.fetch(new Request('https://trellops.test/api/session', { method: 'DELETE' }));
    expect(del.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('the AI summary route refuses callers without a session', async () => {
    const res = await summarize.fetch(new Request('https://trellops.test/api/summarize', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardsData: [] }),
    }));
    expect(res.status).toBe(401);
  });
});

describe('schema', () => {
  it('api/_lib/schema.ts matches db/schema.sql (run npm run build:schema)', () => {
    expect(SCHEMA_SQL).toBe(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  });
});

describe('database url', () => {
  it('accepts the prefixed names the Neon integration creates', () => {
    expect(databaseUrl({ TRELLOPS_DATABASE_URL: 'postgres://a' })).toBe('postgres://a');
    expect(databaseUrl({ DATABASE_URL: 'postgres://b', TRELLOPS_DATABASE_URL: 'postgres://a' })).toBe('postgres://b');
    expect(databaseUrl({})).toBeNull();
  });
});
