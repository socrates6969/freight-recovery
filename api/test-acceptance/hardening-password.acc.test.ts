/* eslint-disable */
// REQ-20261012-hardening Tier H, fix round 1: T10 HP-P01..HP-P04 change-password throttling and lockout (Part C C10,
// C15). Fresh users per case (synthetic addresses), LOCKOUT_THRESHOLD N = 3. Lockout rows are located over SQL by
// time window (the email hash is keyed; it is never computed here).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, Client, type Session, buildTestApp, closeApps, expectError, login, rawLogin, sessionFor } from './helpers/client.js';
import { withAdmin } from './helpers/db.js';
import * as I from './helpers/intel.js';
import { newUser } from './helpers/users.js';

const N = 3;
const BAD = 'Wrong-Current-Pass-1234!';
const NEWPW = 'Brand-New-Long-Pass-2026!';
let app: FastifyInstance;
let setupApp: FastifyInstance;
let owner: Session;
let tid = '';
const cp = (s: Session, currentPassword: string, newPassword = NEWPW, ip?: string) => s.post('/auth/change-password', { currentPassword, newPassword }, ip ? { ip } : {});
const lockRowsSince = (t: Date) => withAdmin(async (c) => (await c.query('select email_hash, failures, locked_until from login_lockouts where last_failure_at >= $1', [t])).rows as any[]);
const dbNow = () => withAdmin(async (c) => (await c.query('select now() t')).rows[0].t as Date);

beforeAll(async () => {
  setupApp = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
  app = await buildTestApp({ LOCKOUT_THRESHOLD: String(N), LOCKOUT_BASE_SECONDS: '600', LOCKOUT_MAX_SECONDS: '900', RATE_LIMIT_ENABLED: 'false' });
  owner = await sessionFor(setupApp, ACCOUNTS.OWNER);
  tid = owner.user.tenant.id;
}, 120000);
afterAll(closeApps);

describe('HP-P01 / HP-P02 lockout on wrong currentPassword (C10.2-C10.5)', () => {
  let U: Awaited<ReturnType<typeof newUser>>;
  let s: Session;
  let hash = '';
  it('HP-P01 attempts 1..N 401; N+1 (wrong and correct) 429 account_locked with Retry-After; login also 429; N change_failed events + one lockout', async () => {
    U = await newUser(setupApp, owner, 'VIEWER');
    s = await login(app, U.email, U.password);
    const t0 = await dbNow();
    const seq = await I.lastSeq(tid);
    for (let i = 1; i <= N; i++) expectError(await cp(s, BAD), 401, 'invalid_credentials');
    for (const pw of [BAD, U.password]) {
      const r = await cp(s, pw);
      expectError(r, 429, 'account_locked');
      expect(Number(r.headers['retry-after']), 'Retry-After').toBeGreaterThan(0);
    }
    expectError(await rawLogin(new Client(app, '10.88.0.1'), U.email, U.password), 429, 'account_locked');
    const ev = await I.eventsSince(tid, seq);
    const failed = ev.filter((e) => e.action === 'auth.password.change_failed');
    expect(failed).toHaveLength(N);
    for (const e of failed) {
      expect([e.actor_id, e.target_id], 'actor and target = U').toEqual([s.user.id, s.user.id]);
      expect(e.metadata).toEqual({});
    }
    expect(ev.filter((e) => e.action === 'auth.lockout'), 'one auth.lockout').toHaveLength(1);
    expect(ev.filter((e) => e.action === 'auth.password.changed'), 'password not changed').toEqual([]);
    const rows = await lockRowsSince(t0);
    expect(rows, 'one lockout record (U)').toHaveLength(1);
    hash = rows[0].email_hash;
    expect(new Date(rows[0].locked_until).getTime()).toBeGreaterThan(Date.now());
  }, 120000);
  it('HP-P02 after the lock expires: correct change 204; lockout record gone; new password logs in', async () => {
    await withAdmin(async (c) => { await c.query(`update login_lockouts set locked_until = now() - interval '1 second' where email_hash = $1`, [hash]); });
    const r = await cp(s, U.password);
    expect(r.status, r.text).toBe(204);
    const left = await withAdmin(async (c) => (await c.query('select failures, locked_until from login_lockouts where email_hash = $1', [hash])).rows);
    expect(left, 'lockout record cleared').toEqual([]);
    expect((await login(app, U.email, NEWPW)).token).toBeTruthy();
    expectError(await rawLogin(new Client(app, '10.88.0.2'), U.email, U.password), 401, 'invalid_credentials');
  }, 60000);
});

describe('HP-P03 auth rate group per client address (C10.1)', () => {
  it('RATE_LIMIT_AUTH_MAX=2: the third change-password from one address (different users) is 429 rate_limited before any lockout effect', async () => {
    const lim = await buildTestApp({ LOCKOUT_THRESHOLD: String(N), RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_AUTH_MAX: '2', RATE_LIMIT_GLOBAL_MAX: '100000' });
    const users = [];
    for (let i = 0; i < 3; i++) {
      const u = await newUser(setupApp, owner, 'VIEWER');
      users.push(I.onApp(lim, await login(setupApp, u.email, u.password), '10.88.1.1'));
    }
    expectError(await cp(users[0]!, BAD), 401, 'invalid_credentials');
    expectError(await cp(users[1]!, BAD), 401, 'invalid_credentials');
    const t = await dbNow();
    const third = await cp(users[2]!, BAD);
    expectError(third, 429, 'rate_limited');
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
    expect(await lockRowsSince(t), 'no failure counted for the third user').toEqual([]);
  }, 120000);
});

describe('HP-P04 no known-device exception on change-password (C10.2)', () => {
  it('a session with a valid fr_rt cookie of U is still 429 account_locked while U is locked', async () => {
    const U = await newUser(setupApp, owner, 'VIEWER');
    const s = await login(app, U.email, U.password);
    expect(s.client.cookie('fr_rt'), 'device cookie present').toBeTruthy();
    for (let i = 1; i <= N; i++) expectError(await rawLogin(new Client(app, '10.88.2.1'), U.email, BAD), 401, 'invalid_credentials');
    expectError(await rawLogin(new Client(app, '10.88.2.1'), U.email, BAD), 429, 'account_locked');
    const r = await cp(s, U.password);
    expectError(r, 429, 'account_locked');
    expectError(await cp(s, BAD), 429, 'account_locked');
  }, 120000);
});
