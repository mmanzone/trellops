import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createSessionToken,
  verifySessionToken,
  requireSession,
  sessionCookie,
  readCookie,
  SESSION_COOKIE,
} from '../api/_lib/session';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';

const req = (cookie?: string, url = 'https://trellops.test/api/summarize') =>
  new Request(url, { method: 'POST', headers: cookie ? { cookie } : {} });

describe('session tokens', () => {
  beforeEach(() => { process.env.SESSION_SECRET = SECRET; });
  afterEach(() => { delete process.env.SESSION_SECRET; });

  it('round-trips the member id and email scope', async () => {
    const token = await createSessionToken({ memberId: 'm123', emailScope: true });
    expect(await verifySessionToken(token)).toEqual({ memberId: 'm123', emailScope: true });
  });

  it('rejects a tampered token', async () => {
    const token = await createSessionToken({ memberId: 'm123', emailScope: false });
    const [h, p, s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', iss: 'trellops' })).toString('base64url');
    expect(await verifySessionToken(`${h}.${forged}.${s}`)).toBeNull();
    expect(await verifySessionToken(`${h}.${p}.x${s}`)).toBeNull();
  });

  it('rejects a token signed with another secret', async () => {
    const token = await createSessionToken({ memberId: 'm123', emailScope: false });
    process.env.SESSION_SECRET = 'another-secret-that-is-also-32-characters-plus';
    expect(await verifySessionToken(token)).toBeNull();
  });

  it('builds a secure HttpOnly cookie on https and reads it back', async () => {
    const cookie = sessionCookie(req(), 'abc');
    expect(cookie).toContain(`${SESSION_COOKIE}=abc`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(sessionCookie(req(undefined, 'http://localhost/api/x'), 'abc')).not.toContain('Secure');
    expect(readCookie(req(`foo=1; ${SESSION_COOKIE}=abc; bar=2`), SESSION_COOKIE)).toBe('abc');
  });
});

describe('requireSession gate', () => {
  afterEach(() => { delete process.env.SESSION_SECRET; });

  it('stays open while SESSION_SECRET is not set', async () => {
    delete process.env.SESSION_SECRET;
    expect(await requireSession(req())).toEqual({ session: null });
  });

  it('returns 401 without a cookie once configured', async () => {
    process.env.SESSION_SECRET = SECRET;
    const gate = await requireSession(req());
    expect('response' in gate && gate.response.status).toBe(401);
  });

  it('lets a valid session through', async () => {
    process.env.SESSION_SECRET = SECRET;
    const token = await createSessionToken({ memberId: 'm9', emailScope: true });
    const gate = await requireSession(req(`${SESSION_COOKIE}=${token}`));
    expect(gate).toEqual({ session: { memberId: 'm9', emailScope: true } });
  });
});
