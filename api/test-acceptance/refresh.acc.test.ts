/* eslint-disable */
// T-REF-01..07
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCOUNTS, Client, allAudit, buildTestApp, closeApps, expectError, login, loginRes, makeSession, parseSetCookie,
  sessionFor,
} from './helpers/client.js';
import { dumpAllText } from './helpers/db.js';
import { sleep } from './helpers/env.js';
import { newUser, userId } from './helpers/users.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
});
afterAll(closeApps);

const rtFrom = (setCookies: string[]) => setCookies.map(parseSetCookie).find((c) => c.name === 'fr_rt')?.value;

describe('T-REF-01 rotation and reuse detection', () => {
  it('rotates; reuse of the old cookie revokes the whole family and is audited', async () => {
    const { client, res } = await loginRes(app, 'manager@acme.test');
    const s = makeSession(client, 'manager@acme.test', res);
    const old = client.cookie('fr_rt')!;
    const rf = await client.post('/auth/refresh', {});
    expect(rf.status, rf.text).toBe(200);
    expect(rf.body.tokenType).toBe('Bearer');
    const fresh = client.cookie('fr_rt')!;
    expect(fresh).not.toBe(old);
    expect(rf.body.accessToken).not.toBe(res.body.accessToken);
    expect((await client.get('/me', { token: rf.body.accessToken })).status).toBe(200); // control
    const reuse = await new Client(app).post('/auth/refresh', {}, { cookies: { fr_rt: old } });
    expectError(reuse, 401, 'unauthenticated');
    const afterNew = await new Client(app).post('/auth/refresh', {}, { cookies: { fr_rt: fresh } });
    expectError(afterNew, 401, 'unauthenticated');
    expectError(await client.get('/me', { token: rf.body.accessToken }), 401, 'unauthenticated');
    expectError(await s.get('/me'), 401, 'unauthenticated');
    const owner = await sessionFor(app, ACCOUNTS.OWNER);
    const ev = (await allAudit(owner, 'action=auth.refresh_reuse_detected')).filter((e) => e.actor?.id === s.user.id);
    expect(ev.length).toBeGreaterThanOrEqual(1);
    expect(ev[0].actor.role).toBe('MANAGER');
  });
});

describe('T-REF-02 rotation chain', () => {
  it('5 sequential refreshes succeed; every superseded cookie is dead', async () => {
    const { client } = await loginRes(app, 'reviewer@acme.test');
    const cookies = [client.cookie('fr_rt')!];
    for (let i = 0; i < 5; i++) {
      const r = await client.post('/auth/refresh', {});
      expect(r.status, `refresh #${i + 1}: ${r.text}`).toBe(200);
      cookies.push(client.cookie('fr_rt')!);
    }
    expect(new Set(cookies).size).toBe(6);
    // positive control on a second chain: its latest cookie works
    const other = await loginRes(app, 'analyst@acme.test');
    expect((await other.client.post('/auth/refresh', {})).status).toBe(200);
    // an intermediate (superseded) cookie of chain 1 is rejected
    expectError(await new Client(app).post('/auth/refresh', {}, { cookies: { fr_rt: cookies[2]! } }), 401, 'unauthenticated');
  });
});

describe('T-REF-03 parallel refresh with the same cookie', () => {
  it('exactly one 200 and one 401; family revoked afterwards', async () => {
    const { client } = await loginRes(app, 'analyst@acme.test');
    const rt = client.cookie('fr_rt')!;
    const mk = () => new Client(app).post('/auth/refresh', {}, { cookies: { fr_rt: rt } });
    const [a, b] = await Promise.all([mk(), mk()]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
    const winner = a.status === 200 ? a : b;
    const nextRt = rtFrom(winner.setCookies)!;
    expect(nextRt).toBeTruthy();
    expectError(await new Client(app).post('/auth/refresh', {}, { cookies: { fr_rt: nextRt } }), 401, 'unauthenticated');
  });
});

describe('T-REF-04 CSRF, forged, expired, family lifetime', () => {
  it('missing CSRF -> 403; forged cookie -> 401; control passes', async () => {
    const { client } = await loginRes(app, 'viewer@acme.test');
    expectError(await client.post('/auth/refresh', {}, { csrf: false }), 403, 'csrf_failed');
    expect(client.cookie('fr_rt')).toBeTruthy(); // rejected request must not have consumed the cookie
    expectError(await new Client(app).post('/auth/refresh', {}, { cookies: { fr_rt: 'forged-' + 'A'.repeat(60) } }), 401, 'unauthenticated');
    expect((await client.post('/auth/refresh', {})).status).toBe(200);
  });
  it('expired refresh token -> 401', async () => {
    const a = await buildTestApp({ REFRESH_TOKEN_TTL_SECONDS: '2', LOCKOUT_THRESHOLD: '50' });
    const { client } = await loginRes(a, 'viewer@acme.test');
    await sleep(3200);
    expectError(await client.post('/auth/refresh', {}), 401, 'unauthenticated');
  }, 20000);
  it('family absolute lifetime enforced even while rotating', async () => {
    const a = await buildTestApp({ REFRESH_FAMILY_MAX_SECONDS: '3', REFRESH_TOKEN_TTL_SECONDS: '30', LOCKOUT_THRESHOLD: '50' });
    const { client } = await loginRes(a, 'viewer@acme.test');
    let firstOk = false;
    let died = false;
    for (let i = 0; i < 8; i++) {
      const r = await client.post('/auth/refresh', {});
      if (r.status === 200) firstOk = true;
      else {
        expectError(r, 401, 'unauthenticated');
        died = true;
        break;
      }
      await sleep(900);
    }
    expect(firstOk).toBe(true);
    expect(died).toBe(true);
  }, 30000);
});

describe('T-REF-05 refresh token never leaks', () => {
  it('absent from bodies, logs, audit metadata and every DB row', async () => {
    const lines: string[] = [];
    const logStream = new Writable({ write(chunk, _e, cb) { lines.push(String(chunk)); cb(); } });
    const a = await buildTestApp({ LOG_LEVEL: 'debug', LOCKOUT_THRESHOLD: '50' }, { logStream });
    const bodies: string[] = [];
    const seen = new Set<string>();
    const { client, res } = await loginRes(a, 'manager@acme.test');
    bodies.push(res.text);
    seen.add(client.cookie('fr_rt')!);
    for (let i = 0; i < 2; i++) {
      const r = await client.post('/auth/refresh', {});
      bodies.push(r.text);
      seen.add(client.cookie('fr_rt')!);
    }
    const stale = [...seen][0]!;
    bodies.push((await new Client(a).post('/auth/refresh', {}, { cookies: { fr_rt: stale } })).text);
    const owner = await sessionFor(app, ACCOUNTS.OWNER);
    bodies.push(JSON.stringify(await allAudit(owner)));
    await sleep(100);
    const dump = await dumpAllText();
    for (const rt of seen) {
      expect(rt.length).toBeGreaterThan(20);
      for (const b of bodies) expect(b.includes(rt)).toBe(false);
      expect(lines.join('').includes(rt)).toBe(false);
      expect(dump.includes(rt)).toBe(false);
    }
    expect(lines.length).toBeGreaterThan(0); // the log capture is live (control)
  });
});

describe('T-REF-06 disabled user cannot refresh', () => {
  it('refresh fails after disable', async () => {
    const owner = await sessionFor(app, ACCOUNTS.OWNER);
    const admin = await sessionFor(app, ACCOUNTS.ADMIN);
    const u = await newUser(app, owner, 'VIEWER');
    const { client } = await loginRes(app, u.email, u.password);
    const id = await userId(admin, u.email);
    expect((await admin.post(`/users/${id}/disable`, { reason: 'acceptance refresh disable' })).status).toBe(200);
    expectError(await client.post('/auth/refresh', {}), 401, 'unauthenticated');
    expect((await admin.post(`/users/${id}/enable`, { reason: 'acceptance refresh enable' })).status).toBe(200);
    expect((await login(app, u.email, u.password)).token).toBeTruthy();
  });
});