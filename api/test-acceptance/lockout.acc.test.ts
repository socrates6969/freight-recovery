/* eslint-disable */
// T-LOCK-01..05, T-RATE-01/02
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCOUNTS, Client, buildTestApp, closeApps, expectError, expectSecurityHeaders, login, rawLogin, sessionFor, strip,
} from './helpers/client.js';
import { SEED_PASSWORD, sleep } from './helpers/env.js';
import { newUser, uniq } from './helpers/users.js';

const KNOBS = { LOCKOUT_THRESHOLD: '3', LOCKOUT_BASE_SECONDS: '2', LOCKOUT_MAX_SECONDS: '8', RATE_LIMIT_ENABLED: 'false' };
const BAD = 'Wrong-Password-1234!';
let app: FastifyInstance;
let setupApp: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp(KNOBS);
  setupApp = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
});
afterAll(closeApps);

const ra = (r: { headers: Record<string, any> }) => Number(r.headers['retry-after']);

describe('T-LOCK-01 lockout timing and reset (lockme) + T-LOCK-04 per-email isolation', () => {
  it('3rd failure locks; locked attempts do not extend; unlock; counter reset', async () => {
    const c = () => new Client(app);
    expectError(await rawLogin(c(), 'lockme@acme.test', BAD), 401, 'invalid_credentials');
    expectError(await rawLogin(c(), 'lockme@acme.test', BAD), 401, 'invalid_credentials');
    const third = await rawLogin(c(), 'lockme@acme.test', BAD);
    const t0 = Date.now();
    expectError(third, 401, 'invalid_credentials');
    const locked = await rawLogin(c(), 'lockme@acme.test', SEED_PASSWORD); // correct password while locked
    expectError(locked, 429, 'account_locked');
    expect(ra(locked)).toBeGreaterThanOrEqual(1);
    expect(ra(locked)).toBeLessThanOrEqual(2);
    expect(Number.isInteger(ra(locked))).toBe(true);
    // T-LOCK-04: other email unaffected while lockme is locked
    expect((await rawLogin(c(), 'lockme2@acme.test')).status).toBe(200);
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
    const again = await rawLogin(c(), 'lockme@acme.test', SEED_PASSWORD); // attempt at ~t+1s
    expectError(again, 429, 'account_locked');
    const unlockBy = t0 + 2000 + 1000; // t+2s +- 1s tolerance
    await sleep(Math.max(0, unlockBy - Date.now()) + 150);
    const ok = await rawLogin(c(), 'lockme@acme.test', SEED_PASSWORD);
    expect(ok.status, `not extended past t+3s: ${ok.text}`).toBe(200);
    // counter reset by success: one wrong password does not lock
    expectError(await rawLogin(c(), 'lockme@acme.test', BAD), 401, 'invalid_credentials');
    expect((await rawLogin(c(), 'lockme@acme.test', SEED_PASSWORD)).status).toBe(200);
  }, 30000);
});

describe('T-LOCK-02 exponential backoff capped at LOCKOUT_MAX_SECONDS', () => {
  it('failures 3,4,5,6 lock ~2s,~4s,~8s,~8s', async () => {
    const e = 'lockme2@acme.test';
    const c = () => new Client(app);
    for (let i = 0; i < 2; i++) expectError(await rawLogin(c(), e, BAD), 401, 'invalid_credentials');
    const want = [2, 4, 8, 8];
    for (let k = 0; k < want.length; k++) {
      expectError(await rawLogin(c(), e, BAD), 401, 'invalid_credentials'); // failure number 3+k
      const probe = await rawLogin(c(), e, SEED_PASSWORD);
      expectError(probe, 429, 'account_locked');
      const v = ra(probe);
      expect(v, `failure ${3 + k}`).toBeGreaterThanOrEqual(want[k]! - 1);
      expect(v, `failure ${3 + k}`).toBeLessThanOrEqual(want[k]! + 1);
      await sleep(v * 1000 + 300);
    }
    expect((await rawLogin(c(), e, SEED_PASSWORD)).status).toBe(200); // positive control
  }, 60000);
});

describe('T-LOCK-03 no enumeration through lockout', () => {
  it('unknown and known emails produce identical statuses, bodies and Retry-After', async () => {
    const owner = await sessionFor(setupApp, ACCOUNTS.OWNER);
    const real = await newUser(setupApp, owner, 'VIEWER');
    const ghost = `ghost-${uniq()}@acme.test`;
    const c = () => new Client(app);
    const seq = async (email: string) => {
      const out: any[] = [];
      for (let i = 0; i < 3; i++) out.push(await rawLogin(c(), email, BAD));
      out.push(await rawLogin(c(), email, BAD)); // 4th, within lock window
      return out;
    };
    const a = await seq(real.email);
    const b = await seq(ghost);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].status, `step ${i}`).toBe(b[i].status);
      expect(strip(a[i].body)).toEqual(strip(b[i].body));
      if (a[i].status === 429) expect(Math.abs(ra(a[i]) - ra(b[i]))).toBeLessThanOrEqual(1);
    }
    expect(a[3].status).toBe(429);
    await sleep(2500);
  }, 30000);
});

describe('T-LOCK-05 lockout does not end existing sessions', () => {
  it('existing access token keeps working while the email is locked', async () => {
    const owner = await sessionFor(setupApp, ACCOUNTS.OWNER);
    const u = await newUser(setupApp, owner, 'VIEWER');
    const s = await login(app, u.email, u.password);
    for (let i = 0; i < 3; i++) await rawLogin(new Client(app), u.email, BAD);
    expectError(await rawLogin(new Client(app), u.email, u.password), 429, 'account_locked');
    expect((await s.get('/me')).status).toBe(200);
  }, 20000);
});

describe('T-RATE-01/02 rate limits', () => {
  it('auth limit: 6th request per IP within window -> 429; other IP unaffected; window expires', async () => {
    const a = await buildTestApp({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_AUTH_MAX: '5', RATE_LIMIT_AUTH_WINDOW_SECONDS: '2', LOCKOUT_THRESHOLD: '50' });
    const A = new Client(a, '203.0.113.10');
    const B = new Client(a, '203.0.113.11');
    await A.ensureCsrf();
    await B.ensureCsrf();
    const mix = [
      () => A.post('/auth/login', { email: `rl-${uniq()}@acme.test`, password: BAD }),
      () => A.post('/auth/forgot', { email: `rl-${uniq()}@acme.test` }),
      () => A.post('/auth/invites/inspect', { token: 'x'.repeat(43) }),
      () => A.post('/auth/reset', { token: 'x'.repeat(43), password: 'Another-Long-Pass-77!' }),
      () => A.post('/auth/mfa/verify', { mfaToken: 'x'.repeat(43), code: '123456' }),
    ];
    for (const f of mix) {
      const r = await f();
      expect(r.status, r.text).not.toBe(429);
    }
    const sixth = await A.post('/auth/login', { email: 'rl@acme.test', password: BAD });
    expectError(sixth, 429, 'rate_limited');
    expect(Number.isInteger(ra(sixth))).toBe(true);
    expect(ra(sixth)).toBeGreaterThanOrEqual(1);
    // T-RATE-02: security headers + error body on 429
    expectSecurityHeaders(sixth);
    expect(sixth.body.error.message).toBeTruthy();
    // a different source IP is unaffected
    const other = await B.post('/auth/login', { email: 'manager@acme.test', password: SEED_PASSWORD });
    expect(other.status, other.text).toBe(200);
    // after the window the original IP succeeds again
    await sleep(2300);
    const later = await A.post('/auth/login', { email: 'reviewer@acme.test', password: SEED_PASSWORD });
    expect(later.status, later.text).toBe(200);
  }, 30000);

  it('global limit applies to any route', async () => {
    const a = await buildTestApp({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_GLOBAL_MAX: '20', RATE_LIMIT_AUTH_MAX: '1000' });
    const A = new Client(a, '203.0.113.20');
    let limited: any;
    let n = 0;
    for (; n < 40; n++) {
      const r = await A.get('/auth/csrf');
      if (r.status === 429) {
        limited = r;
        break;
      }
    }
    expect(limited, 'global limit never tripped').toBeTruthy();
    expect(n).toBeLessThanOrEqual(21);
    expect(n).toBeGreaterThanOrEqual(19);
    expectError(limited, 429, 'rate_limited');
    expect(ra(limited)).toBeGreaterThanOrEqual(1);
    expect((await new Client(a, '203.0.113.21').get('/auth/csrf')).status).toBe(200);
  }, 30000);

  it('forgot limit is per IP+email', async () => {
    const a = await buildTestApp({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_FORGOT_MAX: '2', RATE_LIMIT_AUTH_MAX: '1000' });
    const A = new Client(a, '203.0.113.30');
    const email = `forgot-${uniq()}@acme.test`;
    expect((await A.post('/auth/forgot', { email })).status).toBe(202);
    expect((await A.post('/auth/forgot', { email })).status).toBe(202);
    expectError(await A.post('/auth/forgot', { email }), 429, 'rate_limited');
    expect((await A.post('/auth/forgot', { email: `forgot-${uniq()}@acme.test` })).status).toBe(202);
  }, 30000);
});