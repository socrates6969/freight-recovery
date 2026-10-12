/* eslint-disable */
// REQ-20261012-hardening Tier H, fix round 1: T10 HP-L01..HP-L04 known-device login during a lockout (Part C C14, C15).
// Fresh users, LOCKOUT_THRESHOLD N = 3, long lock so the lock lasts the whole case. "Expired" cookie: owner SQL moves
// the expiry of an earlier session's refresh tokens into the past (fixture, documented in test-plan.md).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, Client, type Res, type Session, buildTestApp, closeApps, expectError, login, rawLogin, sessionFor, strip } from './helpers/client.js';
import { withAdmin } from './helpers/db.js';
import * as I from './helpers/intel.js';
import { freshCode } from './helpers/totp.js';
import { enrollMfa, newUser } from './helpers/users.js';

const N = 3;
const BAD = 'Wrong-Login-Pass-1234!';
let app: FastifyInstance;
let setupApp: FastifyInstance;
let owner: Session;
let tid = '';
const dbNow = () => withAdmin(async (c) => (await c.query('select now() t')).rows[0].t as Date);
const lockRowsSince = (t: Date) => withAdmin(async (c) => (await c.query('select email_hash, failures, locked_until from login_lockouts where last_failure_at >= $1', [t])).rows as any[]);
/** Login with an explicit cookie (or none) from a fresh client. */
const loginWith = async (email: string, password: string, cookie: string | null, ip = '10.89.0.9') => {
  const c = new Client(app, ip);
  await c.ensureCsrf();
  return c.post('/auth/login', { email, password }, cookie === null ? {} : { cookies: { fr_rt: cookie } });
};
const same429 = (a: Res, b: Res, label: string) => {
  expectError(a, 429, 'account_locked');
  expect(strip(a.body), label).toEqual(strip(b.body));
  expect(a.text.replace(/"requestId":"[^"]*"/, ''), label).toBe(b.text.replace(/"requestId":"[^"]*"/, ''));
};
async function lockOut(email: string) {
  const t0 = await dbNow();
  for (let i = 1; i <= N; i++) expectError(await loginWith(email, BAD, null, '10.89.1.1'), 401, 'invalid_credentials');
  const locked = await loginWith(email, BAD, null, '10.89.1.1');
  expectError(locked, 429, 'account_locked');
  const rows = await lockRowsSince(t0);
  expect(rows).toHaveLength(1);
  return rows[0].email_hash as string;
}

beforeAll(async () => {
  setupApp = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
  app = await buildTestApp({ LOCKOUT_THRESHOLD: String(N), LOCKOUT_BASE_SECONDS: '600', LOCKOUT_MAX_SECONDS: '900', RATE_LIMIT_ENABLED: 'false' });
  owner = await sessionFor(setupApp, ACCOUNTS.OWNER);
  tid = owner.user.tenant.id;
}, 120000);
afterAll(closeApps);

describe('HP-L01..L03 password user', () => {
  it('lock by an attacker; foreign/revoked/expired/garbage cookies stay 429 (identical); D wrong 401; D correct 200 knownDevice; lock cleared', async () => {
    const U = await newUser(setupApp, owner, 'VIEWER');
    // expired cookie fixture: an earlier session whose refresh tokens are moved into the past
    const E = await login(app, U.email, U.password);
    const expired = E.client.cookie('fr_rt')!;
    await withAdmin(async (c) => { await c.query(`update refresh_tokens set expires_at = now() - interval '1 minute', family_expires_at = now() - interval '1 minute' where user_id = $1`, [E.user.id]); });
    // revoked cookie: a session that logged out
    const Rv = await login(app, U.email, U.password);
    const revoked = Rv.client.cookie('fr_rt')!;
    expect((await Rv.post('/auth/logout', {})).status).toBe(204);
    // device D (live family)
    const D = await login(app, U.email, U.password);
    const dCookie = D.client.cookie('fr_rt')!;
    expect(dCookie).toBeTruthy();
    const other = (await login(app, ACCOUNTS.VIEWER)).client.cookie('fr_rt')!;
    // HP-L01
    const hash = await lockOut(U.email);
    // HP-L03 (other cookies): 429, identical to the no-cookie response
    const base = await loginWith(U.email, U.password, null);
    expectError(base, 429, 'account_locked');
    for (const [label, ck] of [['revoked', revoked], ['expired', expired], ['other user', other], ['garbage', 'garbage-cookie-value']] as const) {
      same429(await loginWith(U.email, U.password, ck), base, `HP-L03 ${label}`);
    }
    // HP-L03 D with a wrong password: 401, not 429
    expectError(await loginWith(U.email, BAD, dCookie), 401, 'invalid_credentials');
    // HP-L02 D with the correct password: 200, knownDevice true, lockout cleared
    const seq = await I.lastSeq(tid);
    const ok = await loginWith(U.email, U.password, dCookie);
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.status).toBe('ok');
    const ev = (await I.eventsSince(tid, seq, 'auth.login.success')).filter((e) => e.actor_id === D.user.id);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.metadata.knownDevice).toBe(true);
    const left = await withAdmin(async (c) => (await c.query('select failures, locked_until from login_lockouts where email_hash = $1 and locked_until > now()', [hash])).rows);
    expect(left, 'lockout cleared').toEqual([]);
    expect((await loginWith(U.email, U.password, null)).status, 'unlocked for everyone afterwards').toBe(200);
    // the check never rotated D's cookie: D can still refresh
    expect((await D.client.post('/auth/refresh', {})).status).toBe(200);
  }, 180000);
});

describe('HP-L02 MFA user', () => {
  it('during the lock D gets mfa_required, then MFA verify from D succeeds with knownDevice', async () => {
    const U = await newUser(setupApp, owner, 'ADMIN');
    const en = await enrollMfa(app, U.email, U.password);
    const dCookie = en.session.client.cookie('fr_rt');
    expect(dCookie, 'enrolment session sets the device cookie').toBeTruthy();
    const hash = await lockOut(U.email);
    // without the cookie the MFA path is locked (checked before D's success: a success clears the lock, C14)
    const nc = new Client(app, '10.89.2.3');
    expectError(await rawLogin(nc, U.email, U.password), 429, 'account_locked');
    const seq = await I.lastSeq(tid);
    const c = new Client(app, '10.89.2.2');
    await c.ensureCsrf();
    const l = await c.post('/auth/login', { email: U.email, password: U.password }, { cookies: { fr_rt: dCookie! } });
    expect(l.status, l.text).toBe(200);
    expect(l.body.status).toBe('mfa_required');
    const v = await c.post('/auth/mfa/verify', { mfaToken: l.body.mfaToken, code: await freshCode(en.secret) }, { cookies: { fr_rt: dCookie! } });
    expect(v.status, v.text).toBe(200);
    const ev = (await I.eventsSince(tid, seq, 'auth.login.success'));
    expect(ev.length).toBeGreaterThanOrEqual(1);
    expect(ev.at(-1)!.metadata.knownDevice).toBe(true);
    // HP-L02: the lockout row is cleared by the success (C14 "a success clears the lockout record")
    const left = await withAdmin(async (q) => (await q.query('select failures, locked_until from login_lockouts where email_hash = $1 and locked_until > now()', [hash])).rows);
    expect(left, 'lockout cleared').toEqual([]);
  }, 180000);
});

describe('HP-L04 unlocked logins unchanged', () => {
  it('with and without cookie: 200, no knownDevice key', async () => {
    const U = await newUser(setupApp, owner, 'VIEWER');
    const seq = await I.lastSeq(tid);
    const D = await login(app, U.email, U.password);
    const r = await loginWith(U.email, U.password, D.client.cookie('fr_rt')!);
    expect(r.status, r.text).toBe(200);
    const ev = await I.eventsSince(tid, seq, 'auth.login.success');
    expect(ev.length).toBeGreaterThanOrEqual(2);
    for (const e of ev) expect('knownDevice' in (e.metadata ?? {}), JSON.stringify(e.metadata)).toBe(false);
  }, 120000);
});
