/* eslint-disable */
// T-MFA-01..09
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCOUNTS, Client, allAudit, buildTestApp, closeApps, expectError, login, parseSetCookie,
  rawLogin, sessionFor,
} from './helpers/client.js';
import { SEED_TOTP_SECRET, sleep } from './helpers/env.js';
import { dumpAllText } from './helpers/db.js';
import { base32Decode, freshCode, hotp, markUsed, stepNow } from './helpers/totp.js';
import { enrollMfa, newUser, userId } from './helpers/users.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
});
afterAll(closeApps);

/** Wait so that at least `minSec` remain in the current 30 s TOTP step (avoids boundary flakes). */
async function stableStep(minSec = 8) {
  const left = 30 - ((Date.now() / 1000) % 30);
  if (left < minSec) await sleep((left + 0.5) * 1000);
}
const wrongCode = (secret: string) => {
  const s = stepNow();
  const valid = new Set([-2, -1, 0, 1, 2].map((o) => hotp(secret, s + o)));
  for (let i = 0; i < 1000; i++) {
    const c = String(100000 + Math.floor(Math.random() * 899999));
    if (!valid.has(c)) return c;
  }
  throw new Error('no wrong code');
};

describe('T-MFA-01 enrolled accounts require TOTP', () => {
  for (const email of ['owner@acme.test', 'admin@acme.test']) {
    it(`${email}: mfa_required, no fr_rt, mfaToken not a Bearer, wrong code then correct code`, async () => {
      const c = new Client(app);
      const l = await rawLogin(c, email);
      expect(l.status, l.text).toBe(200);
      expect(l.body.status).toBe('mfa_required');
      expect(typeof l.body.mfaToken).toBe('string');
      expect(l.setCookies.some((s) => parseSetCookie(s).name === 'fr_rt')).toBe(false);
      expect(c.cookie('fr_rt')).toBeUndefined();
      expectError(await c.get('/me', { token: l.body.mfaToken }), 401, 'unauthenticated');
      expectError(await c.post('/auth/mfa/verify', { mfaToken: l.body.mfaToken, code: wrongCode(SEED_TOTP_SECRET) }), 401, 'invalid_code');
      let ok = await c.post('/auth/mfa/verify', { mfaToken: l.body.mfaToken, code: await freshCode(SEED_TOTP_SECRET, email) });
      for (let i = 0; i < 2 && ok.status === 401; i++) {
        // a concurrently run suite may have consumed this step server-side: re-login and use the next unused step
        const l2 = await rawLogin(c, email);
        ok = await c.post('/auth/mfa/verify', { mfaToken: l2.body.mfaToken, code: await freshCode(SEED_TOTP_SECRET, email) });
      }
      expect(ok.status, ok.text).toBe(200);
      expect(ok.body.status).toBe('ok');
      expect(c.cookie('fr_rt')).toBeTruthy();
      expect((await c.get('/me', { token: ok.body.accessToken })).status).toBe(200);
    });
  }
});

describe('T-MFA-02 replay and window', () => {
  it('same-step replay rejected; previous/current/next accepted once each; 3 steps away rejected', async () => {
    await stableStep(10);
    const owner = await sessionFor(app, ACCOUNTS.OWNER);
    const u = await newUser(app, owner, 'ADMIN');
    // enroll with the PREVIOUS step's code (window -1), then use current and next.
    const c0 = new Client(app);
    const l0 = await rawLogin(c0, u.email, u.password);
    expect(l0.body.status).toBe('mfa_enrollment_required');
    const st = await c0.post('/auth/mfa/enroll/start', { enrollToken: l0.body.enrollToken });
    const secret: string = st.body.secret;
    const S0 = stepNow();
    const enr = await c0.post('/auth/mfa/enroll/verify', { enrollToken: l0.body.enrollToken, code: hotp(secret, S0 - 1) });
    expect(enr.status, `previous-step code accepted at enrollment: ${enr.text}`).toBe(200);
    const verify = async (code: string) => {
      const c = new Client(app);
      const l = await rawLogin(c, u.email, u.password);
      expect(l.body.status).toBe('mfa_required');
      return c.post('/auth/mfa/verify', { mfaToken: l.body.mfaToken, code });
    };
    expectError(await verify(hotp(secret, S0 - 1)), 401, 'invalid_code'); // replay of consumed step
    expect((await verify(hotp(secret, S0))).status).toBe(200); // current accepted once
    expectError(await verify(hotp(secret, S0)), 401, 'invalid_code'); // replay of current
    expect((await verify(hotp(secret, S0 + 1))).status).toBe(200); // next accepted once
    expectError(await verify(hotp(secret, S0 + 1)), 401, 'invalid_code');
    expectError(await verify(hotp(secret, S0 + 3)), 401, 'invalid_code'); // 3 steps away
    expectError(await verify(hotp(secret, S0 - 3)), 401, 'invalid_code');
  }, 60000);
});

describe('T-MFA-03 newadmin forced enrollment (single run per seed)', () => {
  it('login->enroll start/verify->10 recovery codes->MFA required afterwards->start again 401', async () => {
    const c = new Client(app);
    const l = await rawLogin(c, 'newadmin@acme.test');
    expect(l.body.status, 'newadmin already enrolled: re-run `npm run db:seed -- --reset` (T-MFA-03 is single-run per seed)').toBe('mfa_enrollment_required');
    expect(l.setCookies.some((s) => parseSetCookie(s).name === 'fr_rt')).toBe(false);
    expectError(await c.get('/me', { token: l.body.enrollToken }), 401, 'unauthenticated');
    const st = await c.post('/auth/mfa/enroll/start', { enrollToken: l.body.enrollToken });
    expect(st.status, st.text).toBe(200);
    expect(st.body.secret).toMatch(/^[A-Z2-7]{16,}=*$/);
    expect(st.body.otpauthUri.startsWith('otpauth://totp/')).toBe(true);
    expect(decodeURIComponent(st.body.otpauthUri)).toContain('FreightRecovery');
    expect(decodeURIComponent(st.body.otpauthUri)).toContain('newadmin@acme.test');
    // wrong code first (control), then the right one
    expectError(await c.post('/auth/mfa/enroll/verify', { enrollToken: l.body.enrollToken, code: wrongCode(st.body.secret) }), 401, 'invalid_code');
    const ver = await c.post('/auth/mfa/enroll/verify', { enrollToken: l.body.enrollToken, code: await freshCode(st.body.secret) });
    expect(ver.status, ver.text).toBe(200);
    expect(ver.body.status).toBe('ok');
    expect(ver.body.recoveryCodes).toHaveLength(10);
    expect(new Set(ver.body.recoveryCodes).size).toBe(10);
    expect((await c.get('/me', { token: ver.body.accessToken })).body.user.mfaEnabled).toBe(true);
    const again = await rawLogin(new Client(app), 'newadmin@acme.test');
    expect(again.body.status).toBe('mfa_required');
    expectError(await c.post('/auth/mfa/enroll/start', { enrollToken: l.body.enrollToken }), 401, 'invalid_token');
  });
});

describe('T-MFA-04 forced enrollment depends on role', () => {
  it('fresh ADMIN must enroll; fresh MANAGER/REVIEWER/ANALYST/VIEWER log in with password only', async () => {
    const owner = await sessionFor(app, ACCOUNTS.OWNER);
    const adm = await newUser(app, owner, 'ADMIN');
    const r = await rawLogin(new Client(app), adm.email, adm.password);
    expect(r.body.status).toBe('mfa_enrollment_required');
    for (const role of ['MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER']) {
      const u = await newUser(app, owner, role);
      const l = await rawLogin(new Client(app), u.email, u.password);
      expect(l.status, l.text).toBe(200);
      expect(l.body.status, role).toBe('ok');
    }
  });
});

describe('T-MFA-05 recovery codes', () => {
  it('usable exactly once and audited', async () => {
    const owner = await sessionFor(app, ACCOUNTS.OWNER);
    const u = await newUser(app, owner, 'ADMIN');
    const e = await enrollMfa(app, u.email, u.password);
    const code = e.recoveryCodes[0]!;
    const c1 = new Client(app);
    const l1 = await rawLogin(c1, u.email, u.password);
    const ok = await c1.post('/auth/mfa/verify', { mfaToken: l1.body.mfaToken, recoveryCode: code });
    expect(ok.status, ok.text).toBe(200);
    const c2 = new Client(app);
    const l2 = await rawLogin(c2, u.email, u.password);
    expectError(await c2.post('/auth/mfa/verify', { mfaToken: l2.body.mfaToken, recoveryCode: code }), 401, 'invalid_code');
    // a different, unused recovery code still works (positive control that only the used one died)
    const ok2 = await c2.post('/auth/mfa/verify', { mfaToken: (await rawLogin(c2, u.email, u.password)).body.mfaToken, recoveryCode: e.recoveryCodes[1] });
    expect(ok2.status, ok2.text).toBe(200);
    const ev = (await allAudit(owner, 'action=auth.mfa')).filter((x) => x.action === 'auth.mfa.recovery_used');
    expect(ev.length).toBeGreaterThanOrEqual(2);
    const text = JSON.stringify(ev);
    for (const rc of e.recoveryCodes) expect(text.includes(rc)).toBe(false);
  });
  it('mfa verify body must be code XOR recoveryCode', async () => {
    const c = new Client(app);
    const l = await rawLogin(c, 'owner@acme.test');
    expectError(await c.post('/auth/mfa/verify', { mfaToken: l.body.mfaToken, code: '123456', recoveryCode: 'x' }), 400, 'validation_error');
    expectError(await c.post('/auth/mfa/verify', { mfaToken: l.body.mfaToken }), 400, 'validation_error');
  });
});

describe('T-MFA-06 failed MFA codes count toward lockout', () => {
  it('3 wrong codes then 429 account_locked with Retry-After (owner@globex.test)', async () => {
    const a = await buildTestApp({ LOCKOUT_THRESHOLD: '3', LOCKOUT_BASE_SECONDS: '2', LOCKOUT_MAX_SECONDS: '8' });
    for (let i = 0; i < 3; i++) {
      const c = new Client(a);
      const l = await rawLogin(c, 'owner@globex.test');
      expect(l.body.status).toBe('mfa_required');
      expectError(await c.post('/auth/mfa/verify', { mfaToken: l.body.mfaToken, code: wrongCode(SEED_TOTP_SECRET) }), 401, 'invalid_code');
    }
    const locked = await rawLogin(new Client(a), 'owner@globex.test');
    expectError(locked, 429, 'account_locked');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    await sleep(3500);
    const s = await login(a, 'owner@globex.test'); // positive control: unlocks, correct code works
    expect(s.user.role).toBe('OWNER');
  }, 40000);
});

describe('T-MFA-07 MFA reset (R23)', () => {
  it('Admin resets a Manager (sessions revoked, password-only afterwards); cannot reset another ADMIN; Owner can', async () => {
    const owner = await sessionFor(app, ACCOUNTS.OWNER);
    const admin = await sessionFor(app, ACCOUNTS.ADMIN);
    const mgr = await newUser(app, owner, 'MANAGER');
    const ms = await login(app, mgr.email, mgr.password);
    const mid = await userId(admin, mgr.email);
    const r = await admin.post(`/users/${mid}/mfa/reset`, { reason: 'acceptance mfa reset manager' });
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({ id: mid, mfaEnabled: false });
    expectError(await ms.get('/me'), 401, 'unauthenticated');
    expect((await login(app, mgr.email, mgr.password)).token).toBeTruthy();

    const adm2 = await newUser(app, owner, 'ADMIN');
    const e2 = await enrollMfa(app, adm2.email, adm2.password);
    const a2id = await userId(owner, adm2.email);
    expectError(await admin.post(`/users/${a2id}/mfa/reset`, { reason: 'acceptance admin on admin' }), 403, 'forbidden');
    expect((await e2.session.get('/me')).status).toBe(200); // unchanged
    const byOwner = await owner.post(`/users/${a2id}/mfa/reset`, { reason: 'acceptance owner resets admin' });
    expect(byOwner.status, byOwner.text).toBe(200);
    expectError(await e2.session.get('/me'), 401, 'unauthenticated');
    const again = await rawLogin(new Client(app), adm2.email, adm2.password);
    expect(again.body.status).toBe('mfa_enrollment_required');
  }, 60000);
});

describe('T-MFA-08 TOTP secret never exposed or stored in clear', () => {
  it('absent from /me, /users, /audit/events and from a full DB text dump', async () => {
    const owner = await sessionFor(app, ACCOUNTS.OWNER);
    const u = await newUser(app, owner, 'ADMIN');
    const e = await enrollMfa(app, u.email, u.password);
    const secrets = [SEED_TOTP_SECRET, e.secret];
    const bodies = [
      (await owner.get('/me')).text,
      (await owner.get('/users?pageSize=100')).text,
      JSON.stringify(await allAudit(owner)),
      (await e.session.get('/me')).text,
    ].join('\n');
    const dump = await dumpAllText();
    for (const s of secrets) {
      const raw = base32Decode(s);
      for (const form of [s, s.toLowerCase(), raw.toString('hex'), raw.toString('base64'), raw.toString('base64url')]) {
        expect(bodies.includes(form), `API leaks ${form.slice(0, 6)}...`).toBe(false);
        expect(dump.includes(form), `DB stores ${form.slice(0, 6)}... in clear`).toBe(false);
      }
      for (const off of [-1, 0, 1]) expect(dump.includes(`"${hotp(s, stepNow(off))}"`)).toBe(false);
    }
    for (const rc of e.recoveryCodes) expect(dump.includes(rc)).toBe(false);
    markUsed(e.secret, stepNow());
  });
});

describe('T-MFA-09 platform accounts require MFA', () => {
  for (const email of ['dev@platform.test', 'super@platform.test']) {
    it(`${email} returns mfa_required`, async () => {
      const l = await rawLogin(new Client(app), email);
      expect(l.status, l.text).toBe(200);
      expect(l.body.status).toBe('mfa_required');
      expect(l.body.accessToken).toBeUndefined();
    });
  }
});