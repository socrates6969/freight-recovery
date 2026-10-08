/* eslint-disable */
// T-LOG-01/02: no secrets in structured logs
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCOUNTS, Client, buildTestApp, claimId, closeApps, login, outboxToken, rawLogin, sessionFor,
} from './helpers/client.js';
import { SEED_PASSWORD, SEED_TOTP_SECRET } from './helpers/env.js';
import { freshCode } from './helpers/totp.js';
import { GOOD_PW, newUser, uniq } from './helpers/users.js';

const lines: string[] = [];
let app: FastifyInstance;
let setup: FastifyInstance;
const NEWPW = 'Another-Long-Pass-77!';
beforeAll(async () => {
  const logStream = new Writable({
    write(chunk, _e, cb) {
      lines.push(...String(chunk).split('\n').filter(Boolean));
      cb();
    },
  });
  setup = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
  app = await buildTestApp({ LOG_LEVEL: 'debug', LOCKOUT_THRESHOLD: '50' }, { logStream });
});
afterAll(closeApps);

const walk = (o: any, f: (k: string, v: any, path: string) => void, p = '') => {
  if (Array.isArray(o)) o.forEach((x, i) => walk(x, f, `${p}[${i}]`));
  else if (o && typeof o === 'object')
    for (const [k, v] of Object.entries(o)) {
      f(k, v, `${p}.${k}`);
      walk(v, f, `${p}.${k}`);
    }
};

describe('T-LOG-01 / T-LOG-02', () => {
  it('drives every sensitive flow, then scans every log line', async () => {
    const secrets: string[] = [SEED_PASSWORD, GOOD_PW, NEWPW, 'Wrong-Password-1234!', SEED_TOTP_SECRET];
    const owner = await sessionFor(setup, ACCOUNTS.OWNER);
    const u = await newUser(setup, owner, 'MANAGER');
    const ghost = `logghost-${uniq()}@acme.test`;
    const LETTER = 'LOG-LETTER-CANARY-5521 confidential demand text';

    // login failure (known + unknown) and success
    await rawLogin(new Client(app), u.email, 'Wrong-Password-1234!');
    await rawLogin(new Client(app), ghost, 'Wrong-Password-1234!');
    const c = new Client(app);
    const ok = await rawLogin(c, u.email, u.password);
    secrets.push(ok.body.accessToken, c.cookie('fr_rt')!, c.cookie('fr_csrf')!);
    // authenticated request carrying Authorization, Cookie and X-CSRF-Token headers + a query string
    const res = await c.get('/claims?q=zzz9sentinel', { token: ok.body.accessToken, headers: { cookie: `fr_csrf=${c.cookie('fr_csrf')}; fr_rt=${c.cookie('fr_rt')}`, 'x-csrf-token': c.cookie('fr_csrf')! } });
    expect(res.status).toBe(200);
    const rid = res.headers['x-request-id'];
    // refresh
    const rf = await c.post('/auth/refresh', {});
    secrets.push(rf.body.accessToken, c.cookie('fr_rt')!);
    // MFA verify with seeded owner
    const mc = new Client(app);
    const ml = await rawLogin(mc, 'owner@acme.test');
    secrets.push(ml.body.mfaToken);
    const code = await freshCode(SEED_TOTP_SECRET, 'owner@acme.test');
    secrets.push(code);
    await mc.post('/auth/mfa/verify', { mfaToken: ml.body.mfaToken, code });
    // forgot + reset
    const reset = await newUser(setup, owner, 'VIEWER');
    await new Client(app, '10.5.0.1').post('/auth/forgot', { email: reset.email });
    const rtok = (await outboxToken(new Client(setup, '10.5.0.2'), reset.email, 'password_reset'))!;
    secrets.push(rtok);
    await new Client(app, '10.5.0.1').post('/auth/reset', { token: rtok, password: NEWPW });
    // invite accept
    const inviteEmail = `loginv-${uniq()}@acme.test`;
    await owner.post('/users/invites', { email: inviteEmail, role: 'VIEWER' });
    const itok = (await outboxToken(new Client(setup, '10.5.0.3'), inviteEmail, 'invite'))!;
    secrets.push(itok);
    await new Client(app, '10.5.0.4').post('/auth/invites/accept', { token: itok, name: 'Log Invitee', password: GOOD_PW });
    // MFA enrollment secrets + recovery codes (fresh admin, through the logged app)
    const adm = await newUser(setup, owner, 'ADMIN');
    const ec = new Client(app, '10.5.0.5');
    const el = await rawLogin(ec, adm.email, adm.password);
    secrets.push(el.body.enrollToken);
    const es = await ec.post('/auth/mfa/enroll/start', { enrollToken: el.body.enrollToken });
    secrets.push(es.body.secret);
    const ecode = await freshCode(es.body.secret);
    secrets.push(ecode);
    const ev = await ec.post('/auth/mfa/enroll/verify', { enrollToken: el.body.enrollToken, code: ecode });
    secrets.push(ev.body.accessToken, ...ev.body.recoveryCodes);
    // change password + packet edit
    const sess = await login(app, u.email, u.password);
    secrets.push(sess.token);
    await sess.post('/auth/change-password', { currentPassword: u.password, newPassword: NEWPW });
    const cid = await claimId(await sessionFor(setup, ACCOUNTS.MANAGER), 'CLM-0013');
    const mgr = await login(app, 'manager@acme.test');
    secrets.push(mgr.token);
    const rev = (await mgr.get(`/claims/${cid}/packet`)).body.revision;
    const ed = await mgr.post(`/claims/${cid}/packet/revisions`, { baseRevision: rev, demandLetter: LETTER, reason: 'logging check edit reason' });
    expect([201, 409]).toContain(ed.status);

    // ---- scan ----
    expect(lines.length).toBeGreaterThan(10); // capture is live (control)
    const parsed = lines.map((l, i) => {
      try {
        return JSON.parse(l);
      } catch {
        throw new Error(`log line ${i} is not JSON: ${l.slice(0, 120)}`);
      }
    });
    const all = lines.join('\n');
    for (const s of [...secrets, LETTER]) {
      if (!s || s.length < 6) continue;
      expect(all.includes(s), `log leaks ${s.slice(0, 10)}...`).toBe(false);
    }
    expect(/Bearer\s+[A-Za-z0-9._-]{20,}/.test(all)).toBe(false);
    for (const p of parsed) {
      walk(p, (k, v) => {
        if (/^(authorization|cookie|set-cookie|x-csrf-token|password|currentPassword|newPassword|token|accessToken|refreshToken|mfaToken|enrollToken|code|recoveryCode|secret|demandLetter)$/i.test(k) && typeof v === 'string')
          expect(v, `sensitive key ${k}`).toBe('[REDACTED]');
      });
    }
    // request lines: method/path/status/duration/requestId present; no query strings or bodies
    expect(all.includes('q=zzz9sentinel')).toBe(false);
    expect(all.includes('zzz9sentinel')).toBe(false);
    const reqLine = parsed.find((p) => JSON.stringify(p).includes(rid));
    expect(reqLine, 'a log line carries the requestId').toBeTruthy();
    const rl = parsed.filter((x) => JSON.stringify(x).includes(rid)).map((x) => JSON.stringify(x)).join('\n');
    expect(rl, `request log line: ${rl}`).toMatch(/GET/);
    expect(rl, `request log line: ${rl}`).toMatch(/200/);
    expect(rl).toMatch(/\/api\/v1\/claims/);
    expect(rl).toMatch(/durationMs|responseTime/);
    expect(rl).toContain(rid);
    expect(rl).not.toContain('q=');
    // T-LOG-02: failed-login emails are not clear text
    expect(all.includes(ghost)).toBe(false);
    expect(all.includes(ghost.split('@')[0]!)).toBe(false);
  }, 180000);
  it.todo('T-LOG-01 forced 500 logs a stack while the HTTP body has none: no contract-visible trigger for a 5xx (recorded as not automatable)');
});