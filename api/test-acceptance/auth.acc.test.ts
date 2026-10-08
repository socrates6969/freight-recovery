/* eslint-disable */
// T-AUTH-01..09, T-COOKIE-01/02, T-HDR-01 (API parts)
import { createHmac, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCOUNTS, Client, buildTestApp, closeApps, expectError, expectSecurityHeaders, login, loginRes,
  makeSession, parseSetCookie, rawLogin, sessionFor, strip,
} from './helpers/client.js';
import { SEED_PASSWORD, sleep } from './helpers/env.js';
import { ALL_PERMS, EXPECTED, ROLES } from './helpers/matrix.js';
import { deepKeys, newUser, uniq, userId } from './helpers/users.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
});
afterAll(closeApps);

describe('T-AUTH-01 login success without MFA', () => {
  it('returns a session body without any refresh token, only fr_rt/fr_csrf cookies', async () => {
    const c = new Client(app);
    const csrf = await c.get('/auth/csrf');
    expect(csrf.status).toBe(200);
    const r = await rawLogin(c, 'manager@acme.test');
    expect(r.status, r.text).toBe(200);
    expect(r.body.status).toBe('ok');
    expect(r.body.tokenType).toBe('Bearer');
    expect(typeof r.body.accessToken).toBe('string');
    expect(r.body.expiresIn).toBeGreaterThan(0);
    expect(r.body.user.role).toBe('MANAGER');
    expect(r.body.user.tenant.name).toBe('Acme Logistics (synthetic)');
    const names = r.setCookies.map((s) => parseSetCookie(s).name);
    expect(names).toContain('fr_rt');
    for (const n of names) expect(['fr_rt', 'fr_csrf']).toContain(n);
    const rt = c.cookie('fr_rt')!;
    expect(rt.length).toBeGreaterThan(20);
    expect(deepKeys(r.body).has('refreshToken')).toBe(false);
    expect(r.text.includes(rt)).toBe(false);
  });
  it('negative control: wrong password does not set fr_rt', async () => {
    const c = new Client(app);
    const r = await rawLogin(c, 'manager@acme.test', 'Wrong-Password-1234!');
    expect(r.status).toBe(401);
    expect(r.setCookies.some((s) => s.startsWith('fr_rt='))).toBe(false);
  });
});

describe('T-AUTH-02 identical failure responses (no enumeration)', () => {
  it('unknown email, wrong password and disabled user are indistinguishable', async () => {
    const admin = await sessionFor(app, ACCOUNTS.ADMIN);
    const spare1Id = await userId(admin, 'spare1@acme.test');
    // positive control first: spare1 can log in while ACTIVE
    expect((await login(app, 'spare1@acme.test')).token).toBeTruthy();
    const dis = await admin.post(`/users/${spare1Id}/disable`, { reason: 'acceptance disable check' });
    expect(dis.status, dis.text).toBe(200);
    try {
      const mk = () => new Client(app);
      const unknown = await rawLogin(mk(), `ghost-${uniq()}@acme.test`);
      const wrong = await rawLogin(mk(), 'spare3@acme.test', 'Wrong-Password-1234!');
      const disabled = await rawLogin(mk(), 'spare1@acme.test');
      for (const r of [unknown, wrong, disabled]) expectError(r, 401, 'invalid_credentials');
      expect(strip(unknown.body)).toEqual(strip(wrong.body));
      expect(strip(disabled.body)).toEqual(strip(wrong.body));
      // timing sanity bound: factor 3 over 10 samples (medians)
      const med = (a: number[]) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
      const tu: number[] = [];
      const tw: number[] = [];
      for (let i = 0; i < 10; i++) {
        tu.push((await rawLogin(mk(), `ghost-${uniq()}@acme.test`)).ms);
        tw.push((await rawLogin(mk(), 'spare3@acme.test', 'Wrong-Password-1234!')).ms);
      }
      const a = med(tu);
      const b = med(tw);
      expect(Math.max(a, b) / Math.max(1, Math.min(a, b))).toBeLessThan(3);
    } finally {
      const en = await admin.post(`/users/${spare1Id}/enable`, { reason: 'acceptance re-enable' });
      expect(en.status, en.text).toBe(200);
    }
  });
});

describe('T-AUTH-03 email normalization', () => {
  it('logs in with padded, mixed-case email', async () => {
    const r = await rawLogin(new Client(app), '  MANAGER@Acme.TEST ');
    expect(r.status, r.text).toBe(200);
    expect(r.body.user.email).toBe('manager@acme.test');
  });
});

function b64u(b: Buffer | string) {
  return Buffer.from(b).toString('base64url');
}

describe('T-AUTH-04 /me permissions and token rejection', () => {
  for (const role of ROLES) {
    it(`permissions for ${role} equal the C2 matrix`, async () => {
      const s = await sessionFor(app, ACCOUNTS[role]);
      const me = await s.get('/me');
      expect(me.status, me.text).toBe(200);
      expect(me.body.user.role).toBe(role);
      expect([...me.body.permissions].sort()).toEqual([...EXPECTED[role]].sort());
      if (role === 'PLATFORM_DEV' || role === 'SUPER_ADMIN') expect(me.body.user.tenant).toBeNull();
      else expect(me.body.user.tenant.name).toBe('Acme Logistics (synthetic)');
      for (const p of ALL_PERMS) expect(me.body.permissions.includes(p)).toBe(EXPECTED[role].includes(p));
      expectSecurityHeaders(me);
    });
  }
  it('rejects missing, malformed, tampered, alg:none, foreign-signed and non-access tokens', async () => {
    const s = await sessionFor(app, ACCOUNTS.MANAGER);
    const c = new Client(app);
    expect((await c.get('/me', { token: s.token })).status).toBe(200); // positive control
    expectError(await c.get('/me'), 401, 'unauthenticated');
    expectError(await c.get('/me', { token: 'abc' }), 401, 'unauthenticated');
    const [h, p, sig] = s.token.split('.');
    expect(sig, 'access token is a 3-part JWT').toBeTruthy();
    const mid = Math.floor(p!.length / 2);
    const flipped = p!.slice(0, mid) + (p![mid] === 'A' ? 'B' : 'A') + p!.slice(mid + 1);
    expectError(await c.get('/me', { token: `${h}.${flipped}.${sig}` }), 401, 'unauthenticated');
    const claims = JSON.parse(Buffer.from(p!, 'base64url').toString('utf8'));
    const none = `${b64u(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64u(JSON.stringify(claims))}.`;
    expectError(await c.get('/me', { token: none }), 401, 'unauthenticated');
    const hdr = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = b64u(JSON.stringify(claims));
    const forged = createHmac('sha256', randomBytes(32)).update(`${hdr}.${body}`).digest('base64url');
    expectError(await c.get('/me', { token: `${hdr}.${body}.${forged}` }), 401, 'unauthenticated');
    // MFA token and enroll token as Bearer
    const o = await rawLogin(new Client(app), 'owner@acme.test');
    expect(o.body.status).toBe('mfa_required');
    expectError(await c.get('/me', { token: o.body.mfaToken }), 401, 'unauthenticated');
    const na = await rawLogin(new Client(app), 'newadmin@acme.test');
    if (na.body.status === 'mfa_enrollment_required')
      expectError(await c.get('/me', { token: na.body.enrollToken }), 401, 'unauthenticated');
  });
  it('rejects an expired token', async () => {
    const short = await buildTestApp({ ACCESS_TOKEN_TTL_SECONDS: '2', LOCKOUT_THRESHOLD: '50' });
    const s = await login(short, 'manager@acme.test');
    expect((await s.get('/me')).status).toBe(200);
    await sleep(3200);
    expectError(await s.get('/me'), 401, 'unauthenticated');
  }, 20000);
});

describe('T-AUTH-05 immediacy of disable and role change', () => {
  it('disabled user is cut off on the very next request; enable restores login', async () => {
    const admin = await sessionFor(app, ACCOUNTS.ADMIN);
    const id = await userId(admin, 'spare4@acme.test');
    const u = await login(app, 'spare4@acme.test');
    expect((await u.get('/me')).status).toBe(200);
    expect((await admin.post(`/users/${id}/disable`, { reason: 'acceptance immediacy check' })).status).toBe(200);
    try {
      expectError(await u.get('/me'), 401, 'unauthenticated');
      expectError(await rawLogin(new Client(app), 'spare4@acme.test'), 401, 'invalid_credentials');
    } finally {
      expect((await admin.post(`/users/${id}/enable`, { reason: 'acceptance immediacy re-enable' })).status).toBe(200);
    }
    expect((await login(app, 'spare4@acme.test')).token).toBeTruthy();
  });
  it('role change is visible with the OLD token on the next request', async () => {
    const admin = await sessionFor(app, ACCOUNTS.ADMIN);
    const id = await userId(admin, 'spare2@acme.test');
    const u = await login(app, 'spare2@acme.test');
    expect((await u.get('/me')).body.user.role).toBe('VIEWER');
    const ch = await admin.patch(`/users/${id}/role`, { role: 'ANALYST', reason: 'acceptance role change' });
    expect(ch.status, ch.text).toBe(200);
    try {
      const me = await u.get('/me');
      expect(me.status).toBe(200);
      expect(me.body.user.role).toBe('ANALYST');
      expect(me.body.permissions).toContain('import:run');
    } finally {
      expect((await admin.patch(`/users/${id}/role`, { role: 'VIEWER', reason: 'acceptance role restore' })).status).toBe(200);
    }
  });
});

describe('T-AUTH-06 logout', () => {
  it('revokes the session, the refresh cookie and clears cookies; idempotent without cookie', async () => {
    const { client, res } = await loginRes(app, 'viewer@acme.test');
    const s = makeSession(client, 'viewer@acme.test', res);
    expect((await s.get('/me')).status).toBe(200);
    const rt = client.cookie('fr_rt')!;
    const out = await s.post('/auth/logout', {});
    expect(out.status, out.text).toBe(204);
    const cleared = out.setCookies.map(parseSetCookie).find((c) => c.name === 'fr_rt');
    expect(cleared, 'fr_rt cleared').toBeTruthy();
    expect(cleared!.value).toBe('');
    expect(cleared!.attrs['max-age']).toBe('0');
    expectError(await s.get('/me'), 401, 'unauthenticated');
    const c2 = new Client(app);
    const rf = await c2.post('/auth/refresh', {}, { cookies: { fr_rt: rt } });
    expectError(rf, 401, 'unauthenticated');
    const bare = new Client(app);
    expect((await bare.post('/auth/logout', {})).status).toBe(204);
    expect((await bare.post('/auth/logout', {}, { cookies: { fr_rt: 'garbage' } })).status).toBe(204);
  });
});

describe('T-AUTH-07/08/09 change password and policy', () => {
  it('T-AUTH-07 wrong current, weak new, success; old password dead; other sessions revoked', async () => {
    const owner = await sessionFor(app, ACCOUNTS.OWNER);
    const u = await newUser(app, owner, 'VIEWER');
    const A = await login(app, u.email, u.password);
    const B = await login(app, u.email, u.password);
    expectError(await A.post('/auth/change-password', { currentPassword: 'Nope-Nope-Nope-12!', newPassword: 'Another-Long-Pass-77!' }), 401, 'invalid_credentials');
    expectError(await A.post('/auth/change-password', { currentPassword: u.password, newPassword: 'short' }), 400, 'weak_password');
    const ok = await A.post('/auth/change-password', { currentPassword: u.password, newPassword: 'Another-Long-Pass-77!' });
    expect(ok.status, ok.text).toBe(204);
    expectError(await rawLogin(new Client(app), u.email, u.password), 401, 'invalid_credentials');
    expect((await login(app, u.email, 'Another-Long-Pass-77!')).token).toBeTruthy();
    expectError(await B.get('/me'), 401, 'unauthenticated');
    expectError(await B.client.post('/auth/refresh', {}), 401, 'unauthenticated');
    expect((await A.get('/me')).status).toBe(200);
  });
  it('T-AUTH-08 password policy matrix', async () => {
    const owner = await sessionFor(app, ACCOUNTS.OWNER);
    const u = await newUser(app, owner, 'VIEWER');
    const local = u.email.split('@')[0]!;
    expect(local.length).toBeGreaterThanOrEqual(12);
    let cur = u.password;
    const S = await login(app, u.email, cur);
    const attempt = async (pw: string) => {
      const r = await S.post('/auth/change-password', { currentPassword: cur, newPassword: pw });
      if (r.status === 204) cur = pw;
      return r;
    };
    expectError(await attempt('Abcd!2345xy'), 400, 'weak_password'); // 11
    expectError(await attempt('x'.repeat(129)), 400, 'weak_password'); // 129
    expectError(await attempt('password1234'), 400, 'weak_password');
    expectError(await attempt('123456789012'), 400, 'weak_password');
    expectError(await attempt(local), 400, 'weak_password');
    expect((await attempt('Abcd!2345xyz')).status).toBe(204); // 12
    expect((await attempt(randomBytes(64).toString('hex'))).status).toBe(204); // 128
    expect((await attempt('Correct-Horse-\u{1F510}-Battery-2026')).status).toBe(204);
    expect((await login(app, u.email, cur)).token).toBeTruthy(); // last accepted password works
  });
  it('T-AUTH-09 userId in body is rejected as an unknown key', async () => {
    const m = await sessionFor(app, ACCOUNTS.MANAGER);
    const r = await m.post('/auth/change-password', { currentPassword: SEED_PASSWORD, newPassword: 'Another-Long-Pass-77!', userId: '00000000-0000-4000-8000-000000000000' });
    expectError(r, 400, 'validation_error');
    expectError(await new Client(app).post('/auth/login', { email: 'manager@acme.test', password: SEED_PASSWORD, userId: 'x' }), 400, 'validation_error');
  });
});

describe('T-COOKIE-01/02', () => {
  it('default flags on csrf/login/refresh; logout clears; no Domain; access token never a cookie', async () => {
    const c = new Client(app);
    const csrf = await c.get('/auth/csrf');
    const fc = csrf.setCookies.map(parseSetCookie).find((x) => x.name === 'fr_csrf')!;
    expect(fc.attrs['secure']).toBe(true);
    expect(fc.attrs['samesite']).toMatch(/^strict$/i);
    expect(fc.attrs['path']).toBe('/');
    expect(fc.attrs['httponly']).toBeUndefined();
    const l = await rawLogin(c, 'reviewer@acme.test');
    const rt = l.setCookies.map(parseSetCookie).find((x) => x.name === 'fr_rt')!;
    expect(rt.attrs['httponly']).toBe(true);
    expect(rt.attrs['secure']).toBe(true);
    expect(rt.attrs['samesite']).toMatch(/^strict$/i);
    expect(rt.attrs['path']).toBe('/api/v1/auth');
    expect(rt.attrs['max-age'] ?? rt.attrs['expires']).toBeTruthy();
    const rf = await c.post('/auth/refresh', {});
    expect(rf.status, rf.text).toBe(200);
    const rt2 = rf.setCookies.map(parseSetCookie).find((x) => x.name === 'fr_rt')!;
    expect(rt2.attrs['httponly']).toBe(true);
    for (const r of [csrf, l, rf]) {
      for (const sc of r.setCookies) {
        const p = parseSetCookie(sc);
        expect(p.attrs['domain']).toBeUndefined();
        expect(['fr_rt', 'fr_csrf']).toContain(p.name);
        expect(sc.includes(l.body.accessToken)).toBe(false);
        expect(sc.includes(rf.body.accessToken)).toBe(false);
      }
    }
    const out = await c.post('/auth/logout', {});
    const cleared = out.setCookies.map(parseSetCookie);
    for (const n of ['fr_rt', 'fr_csrf']) {
      const x = cleared.find((k) => k.name === n);
      expect(x, `${n} cleared`).toBeTruthy();
      expect(x!.value).toBe('');
      expect(x!.attrs['max-age']).toBe('0');
    }
  });
  it('COOKIE_SECURE=false (non-production) drops Secure only', async () => {
    const a = await buildTestApp({ COOKIE_SECURE: 'false', LOCKOUT_THRESHOLD: '50' });
    const c = new Client(a);
    const csrf = await c.get('/auth/csrf');
    const l = await rawLogin(c, 'reviewer@acme.test');
    for (const sc of [...csrf.setCookies, ...l.setCookies]) {
      const p = parseSetCookie(sc);
      expect(p.attrs['secure']).toBeUndefined();
      expect(p.attrs['samesite']).toMatch(/^strict$/i);
      if (p.name === 'fr_rt') expect(p.attrs['httponly']).toBe(true);
      if (p.name === 'fr_csrf') expect(p.attrs['httponly']).toBeUndefined();
    }
  });
});

describe('T-HDR-01 API security headers on every status', () => {
  it('present with exact values on 200/201/204/400/401/403/404/413', async () => {
    const admin = await sessionFor(app, ACCOUNTS.ADMIN);
    const viewer = await sessionFor(app, ACCOUNTS.VIEWER);
    const c = new Client(app);
    const checks: Array<[number, () => Promise<any>]> = [
      [200, () => c.get('/healthz')],
      [200, () => viewer.get('/me')],
      [201, async () => {
        const email = `hdr-${uniq()}@acme.test`;
        const r = await admin.post('/users/invites', { email, role: 'MANAGER' });
        if (r.status === 201) await admin.destroy(`/users/invites/${r.body.id}`);
        return r;
      }],
      [204, () => new Client(app).post('/auth/logout', {})],
      [400, () => new Client(app).post('/auth/login', { nope: 1 })],
      [401, () => c.get('/me')],
      [403, () => viewer.get('/users')],
      [404, () => c.get('/nope-not-a-route')],
      [413, () => new Client(app).post('/auth/login', undefined, { raw: JSON.stringify({ email: 'a@b.test', password: 'x'.repeat(70000) }), headers: { 'content-type': 'application/json' } })],
    ];
    for (const [want, fn] of checks) {
      const r = await fn();
      expect(r.status, `${want}: ${r.text}`).toBe(want);
      expectSecurityHeaders(r, { hsts: false });
      if (want >= 400) expect(r.body.error).toBeTruthy();
    }
    expect(checks.length).toBe(9);
  });
  it('HSTS appears iff HSTS_MAX_AGE_SECONDS > 0 with includeSubDomains', async () => {
    const on = await buildTestApp({ HSTS_MAX_AGE_SECONDS: '31536000' });
    const r = await on.inject({ method: 'GET', url: '/healthz' });
    expect(r.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    const off = await buildTestApp({ HSTS_MAX_AGE_SECONDS: '0' });
    expect((await off.inject({ method: 'GET', url: '/healthz' })).headers['strict-transport-security']).toBeUndefined();
  });
  it.todo('T-HDR-01 forced 500 headers: no contract-visible way to trigger a 5xx black-box (recorded as skipped)');
});