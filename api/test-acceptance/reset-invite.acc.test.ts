/* eslint-disable */
// T-RESET-01..04, T-INV-01..03
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCOUNTS, Client, buildTestApp, closeApps, expectError, login, loginRes, makeSession, outboxToken, rawLogin, sessionFor, strip,
} from './helpers/client.js';
import { dumpAllText, withAdmin } from './helpers/db.js';
import { SEED_PASSWORD, sleep } from './helpers/env.js';
import { GOOD_PW, enrollMfa, newUser, uniq } from './helpers/users.js';

const BAD = 'Wrong-Password-1234!';
const NEWPW = 'Another-Long-Pass-77!';
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
});
afterAll(closeApps);
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;

describe('T-RESET-01 forgot is non-enumerating', () => {
  it('identical 202 bodies and comparable timing; outbox entry only for the real address; token strong and not stored raw', async () => {
    const pub = () => new Client(app, '10.6.0.1');
    const a = await pub().post('/auth/forgot', { email: 'reset@acme.test' });
    const b = await pub().post('/auth/forgot', { email: 'nobody@acme.test' });
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(a.body).toEqual({ status: 'accepted' });
    expect(a.text).toBe(b.text);
    const ta: number[] = [];
    const tb: number[] = [];
    for (let i = 0; i < 6; i++) {
      ta.push((await pub().post('/auth/forgot', { email: 'reset@acme.test' })).ms);
      tb.push((await pub().post('/auth/forgot', { email: `nobody-${uniq()}@acme.test` })).ms);
    }
    expect(Math.max(med(ta), med(tb)) / Math.max(1, Math.min(med(ta), med(tb)))).toBeLessThan(3);
    const real = await outboxToken(pub(), 'reset@acme.test', 'password_reset');
    expect(real).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    const none = await pub().get('/dev/outbox?to=nobody%40acme.test');
    expect(none.body.items).toHaveLength(0);
    const dump = await dumpAllText(['mail_outbox']); // mail_outbox legitimately holds the dev token (C6); see ambiguity note
    expect(dump.includes(real!)).toBe(false);
  });
});

describe('T-RESET-02 reset completes, kills sessions and clears lockout', () => {
  it('works once; old password dead; prior sessions revoked; lock cleared', async () => {
    const owner = await sessionFor(app, ACCOUNTS.OWNER);
    const u = await newUser(app, owner, 'VIEWER');
    const sess = await loginRes(app, u.email, u.password);
    const S = makeSession(sess.client, u.email, sess.res);
    const lockApp = await buildTestApp({ LOCKOUT_THRESHOLD: '3', LOCKOUT_BASE_SECONDS: '30', LOCKOUT_MAX_SECONDS: '60' });
    for (let i = 0; i < 3; i++) await rawLogin(new Client(lockApp), u.email, BAD);
    expectError(await rawLogin(new Client(lockApp), u.email, u.password), 429, 'account_locked');
    const pub = new Client(app, '10.6.0.2');
    expect((await pub.post('/auth/forgot', { email: u.email })).status).toBe(202);
    const tok = (await outboxToken(pub, u.email, 'password_reset'))!;
    const r = await pub.post('/auth/reset', { token: tok, password: NEWPW });
    expect(r.status, r.text).toBe(204);
    expectError(await pub.post('/auth/reset', { token: tok, password: GOOD_PW }), 400, 'invalid_token');
    expectError(await rawLogin(new Client(app), u.email, u.password), 401, 'invalid_credentials');
    const fresh = await rawLogin(new Client(lockApp), u.email, NEWPW); // lock state cleared even on the strict-lockout app
    expect(fresh.status, fresh.text).toBe(200);
    expectError(await S.get('/me'), 401, 'unauthenticated');
    expectError(await S.client.post('/auth/refresh', {}), 401, 'unauthenticated');
    const both = await pub.post('/auth/reset', { token: 'x'.repeat(43), password: 'Short1!' });
    expect(both.status).toBe(400);
    expect(['invalid_token', 'weak_password']).toContain(both.body.error.code);
  }, 60000);
  it('weak password on a valid token is rejected and does not consume the token', async () => {
    const owner = await sessionFor(app, ACCOUNTS.OWNER);
    const u = await newUser(app, owner, 'VIEWER');
    const pub = new Client(app, '10.6.0.3');
    await pub.post('/auth/forgot', { email: u.email });
    const tok = (await outboxToken(pub, u.email, 'password_reset'))!;
    expectError(await pub.post('/auth/reset', { token: tok, password: 'password1234' }), 400, 'weak_password');
    expect((await pub.post('/auth/reset', { token: tok, password: NEWPW })).status).toBe(204); // control
  });
});

describe('T-RESET-03 expiry, supersession, garbage', () => {
  it('expired == garbage == used (indistinguishable); a second request invalidates the first', async () => {
    const short = await buildTestApp({ RESET_TOKEN_TTL_SECONDS: '2', LOCKOUT_THRESHOLD: '50' });
    const owner = await sessionFor(app, ACCOUNTS.OWNER);
    const u = await newUser(app, owner, 'VIEWER');
    const pub = new Client(short, '10.6.0.4');
    await pub.post('/auth/forgot', { email: u.email });
    const tok = (await outboxToken(pub, u.email, 'password_reset'))!;
    await sleep(3200);
    const expired = await pub.post('/auth/reset', { token: tok, password: NEWPW });
    expectError(expired, 400, 'invalid_token');
    const garbage = await pub.post('/auth/reset', { token: 'garbage-' + 'z'.repeat(40), password: NEWPW });
    expectError(garbage, 400, 'invalid_token');
    expect(strip(garbage.body)).toEqual(strip(expired.body));
    const tampered = await pub.post('/auth/reset', { token: tok.slice(0, -1) + (tok.endsWith('A') ? 'B' : 'A'), password: NEWPW });
    expect(strip(tampered.body)).toEqual(strip(expired.body));
    // supersession on the normal app
    const u2 = await newUser(app, owner, 'VIEWER');
    const p2 = new Client(app, '10.6.0.5');
    await p2.post('/auth/forgot', { email: u2.email });
    const first = (await outboxToken(p2, u2.email, 'password_reset'))!;
    await p2.post('/auth/forgot', { email: u2.email });
    const second = (await outboxToken(p2, u2.email, 'password_reset'))!;
    expect(second).not.toBe(first);
    expectError(await p2.post('/auth/reset', { token: first, password: NEWPW }), 400, 'invalid_token');
    expect((await p2.post('/auth/reset', { token: second, password: NEWPW })).status).toBe(204);
  }, 60000);
});

describe('T-RESET-04 reset does not bypass MFA', () => {
  it('ADMIN with MFA still gets mfa_required after a password reset', async () => {
    const owner = await sessionFor(app, ACCOUNTS.OWNER);
    const u = await newUser(app, owner, 'ADMIN');
    await enrollMfa(app, u.email, u.password);
    const pub = new Client(app, '10.6.0.6');
    await pub.post('/auth/forgot', { email: u.email });
    const tok = (await outboxToken(pub, u.email, 'password_reset'))!;
    expect((await pub.post('/auth/reset', { token: tok, password: NEWPW })).status).toBe(204);
    const l = await rawLogin(new Client(app), u.email, NEWPW);
    expect(l.status).toBe(200);
    expect(l.body.status).toBe('mfa_required');
    expect(l.body.accessToken).toBeUndefined();
  }, 60000);
});

describe('T-INV-01 invite lifecycle', () => {
  it('create, list, inspect, accept, replay, role honoured', async () => {
    const admin = await sessionFor(app, ACCOUNTS.ADMIN);
    const email = `new1-${uniq()}@acme.test`;
    const inv = await admin.post('/users/invites', { email, role: 'MANAGER' });
    expect(inv.status, inv.text).toBe(201);
    expect(Object.keys(inv.body).sort()).toEqual(['email', 'expiresAt', 'id', 'role']);
    expect(inv.text).not.toMatch(/token/i);
    const pub = new Client(app, '10.6.1.1');
    const tok = (await outboxToken(pub, email, 'invite'))!;
    expect(tok).toBeTruthy();
    const list = await admin.get('/users/invites');
    const mine = list.body.items.find((i: any) => i.email === email);
    expect(mine.status).toMatch(/^pending$/i);
    const insp = await pub.post('/auth/invites/inspect', { token: tok });
    expect(insp.status, insp.text).toBe(200);
    expect(Object.keys(insp.body).sort()).toEqual(['email', 'role', 'tenantName']);
    expect(insp.body).toMatchObject({ email, role: 'MANAGER', tenantName: 'Acme Logistics (synthetic)' });
    expectError(await pub.post('/auth/invites/accept', { token: tok, name: 'New One', password: 'short' }), 400, 'weak_password');
    expect((await pub.post('/auth/invites/accept', { token: tok, name: 'New One', password: GOOD_PW })).status).toBe(204);
    const s = await login(app, email, GOOD_PW);
    expect(s.user.role).toBe('MANAGER');
    expectError(await pub.post('/auth/invites/accept', { token: tok, name: 'New One', password: GOOD_PW }), 400, 'invalid_token');
    expectError(await pub.post('/auth/invites/inspect', { token: tok }), 400, 'invalid_token');
  });
  it('acceptance for an email that already has an account -> 409 and no change', async (ctx) => {
    const gxOwner = await sessionFor(app, 'owner@globex.test');
    const admin = await sessionFor(app, ACCOUNTS.ADMIN);
    const email = `dual-${uniq()}@acme.test`;
    const g = await gxOwner.post('/users/invites', { email, role: 'VIEWER' });
    expect(g.status, g.text).toBe(201);
    const a = await admin.post('/users/invites', { email, role: 'VIEWER' });
    if (a.status !== 201) {
      await gxOwner.destroy(`/users/invites/${g.body.id}`);
      return ctx.skip(`cannot construct second pending invite for same email across tenants (status ${a.status}); 409-on-accept unreachable black-box`);
    }
    const pub = new Client(app, '10.6.1.2');
    const toks = (await pub.get(`/dev/outbox?to=${encodeURIComponent(email)}`)).body.items.filter((i: any) => i.kind === 'invite').map((i: any) => i.token);
    expect(toks).toHaveLength(2);
    const [second, first] = toks as string[];
    expect((await pub.post('/auth/invites/accept', { token: first, name: 'First', password: GOOD_PW })).status).toBe(204);
    const before = (await login(app, email, GOOD_PW)).user;
    expectError(await pub.post('/auth/invites/accept', { token: second, name: 'Second', password: NEWPW }), 409, 'conflict');
    const after = (await login(app, email, GOOD_PW)).user;
    expect(after).toEqual(before);
    expectError(await rawLogin(new Client(app), email, NEWPW), 401, 'invalid_credentials');
  });
});

describe('T-INV-02 revoke, expiry, duplicates', () => {
  it('revoked invite unusable; duplicate pending 409; active-user invite 409', async () => {
    const admin = await sessionFor(app, ACCOUNTS.ADMIN);
    const pub = new Client(app, '10.6.2.1');
    const email = `rev-${uniq()}@acme.test`;
    const inv = await admin.post('/users/invites', { email, role: 'VIEWER' });
    const tok = (await outboxToken(pub, email, 'invite'))!;
    expectError(await admin.post('/users/invites', { email, role: 'VIEWER' }), 409, 'conflict');
    expectError(await admin.post('/users/invites', { email: 'manager@acme.test', role: 'VIEWER' }), 409, 'conflict');
    expect((await admin.destroy(`/users/invites/${inv.body.id}`)).status).toBe(204);
    expectError(await pub.post('/auth/invites/accept', { token: tok, name: 'Revoked', password: GOOD_PW }), 400, 'invalid_token');
  });
  it('expired invite -> 400', async () => {
    const short = await buildTestApp({ INVITE_TTL_SECONDS: '2', LOCKOUT_THRESHOLD: '50' });
    const owner = await login(short, ACCOUNTS.OWNER);
    const email = `exp-${uniq()}@acme.test`;
    expect((await owner.post('/users/invites', { email, role: 'VIEWER' })).status).toBe(201);
    const pub = new Client(short, '10.6.2.2');
    const tok = (await outboxToken(pub, email, 'invite'))!;
    expect((await pub.post('/auth/invites/inspect', { token: tok })).status).toBe(200); // control: valid before expiry
    await sleep(3200);
    expectError(await pub.post('/auth/invites/accept', { token: tok, name: 'Late', password: GOOD_PW }), 400, 'invalid_token');
  }, 40000);
});

describe('T-INV-03 acceptance cannot choose role or tenant', () => {
  it('extra keys -> 400 and no account is created', async () => {
    const admin = await sessionFor(app, ACCOUNTS.ADMIN);
    const pub = new Client(app, '10.6.3.1');
    const email = `ek-${uniq()}@acme.test`;
    await admin.post('/users/invites', { email, role: 'VIEWER' });
    const tok = (await outboxToken(pub, email, 'invite'))!;
    for (const extra of [{ role: 'OWNER' }, { tenantId: '00000000-0000-4000-8000-000000000001' }, { email: 'other@acme.test' }])
      expectError(await pub.post('/auth/invites/accept', { token: tok, name: 'Extra Keys', password: GOOD_PW, ...extra }), 400, 'validation_error');
    expectError(await rawLogin(new Client(app), email, GOOD_PW), 401, 'invalid_credentials');
    expect((await pub.post('/auth/invites/accept', { token: tok, name: 'Extra Keys', password: GOOD_PW })).status).toBe(204); // control
    void withAdmin; void SEED_PASSWORD;
  });
});