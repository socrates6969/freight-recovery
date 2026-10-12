/* eslint-disable */
// REQ-20261012-hardening Tier H, fix round 1: T10 HP-M01/M02 promotion to an MFA-required role (Part C C12) and
// HP-I01..HP-I04 invites that do not reveal accounts of other tenants (C13). Synthetic addresses only.
// Contract change recorded in test-plan.md: an invite for an email of another tenant answers 201 (was 409). No
// existing acceptance assertion expected that 409 (reset-invite T-INV-02 asserts 409 for an Acme member, unchanged).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, Client, type Session, buildTestApp, closeApps, expectError, login, rawLogin, sessionFor } from './helpers/client.js';
import { withAdmin } from './helpers/db.js';
import * as I from './helpers/intel.js';
import { GOOD_PW, enrollMfa, loginWithSecret, newUser, uniq, userId } from './helpers/users.js';

let app: FastifyInstance;
let owner: Session, admin: Session, gxo: Session;
let tid = '';
const REASON = 'Hardening acceptance role change';
const setRole = (s: Session, id: string, role: string) => s.patch(`/users/${id}/role`, { role, reason: REASON });
async function roleChangedSince(seq: number, subject: string) {
  const ev = (await I.eventsSince(tid, seq, 'user.role_changed')).filter((e) => e.target_id === subject || e.metadata?.userId === subject);
  expect(ev, 'one user.role_changed').toHaveLength(1);
  return ev[0]!;
}

beforeAll(async () => {
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
  owner = await sessionFor(app, ACCOUNTS.OWNER);
  admin = await sessionFor(app, ACCOUNTS.ADMIN);
  gxo = await sessionFor(app, I.GLOBEX.OWNER);
  tid = owner.user.tenant.id;
}, 120000);
afterAll(closeApps);

describe('HP-M01 / HP-M02 promotion to an MFA-required role (C12)', () => {
  it('HP-M01 MANAGER without MFA promoted to ADMIN: 200 {id, role}; old access token and refresh 401; sessionsRevoked >= 1; next login requires enrolment', async () => {
    const W = await newUser(app, owner, 'MANAGER');
    const ws = await login(app, W.email, W.password);
    const id = await userId(owner, W.email);
    const seq = await I.lastSeq(tid);
    const r = await setRole(owner, id, 'ADMIN');
    expect(r.status, r.text).toBe(200);
    expect(r.body).toEqual({ id, role: 'ADMIN' });
    expectError(await ws.get('/me'), 401, 'unauthenticated');
    expectError(await ws.client.post('/auth/refresh', {}), 401, 'unauthenticated');
    const e = await roleChangedSince(seq, id);
    expect(e.metadata.sessionsRevoked).toBeGreaterThanOrEqual(1);
    const revoked = await withAdmin(async (c) => (await c.query(`select count(*)::int n from refresh_tokens where user_id = $1 and revoked_reason = 'role_requires_mfa'`, [id])).rows[0].n);
    expect(revoked, 'revoke reason role_requires_mfa (C15)').toBeGreaterThanOrEqual(1);
    const l = await rawLogin(new Client(app, '10.90.0.1'), W.email, W.password);
    expect(l.status, l.text).toBe(200);
    expect(l.body.status).toBe('mfa_enrollment_required');
  }, 120000);
  it('HP-M02 subject with verified MFA (ADMIN -> MANAGER -> ADMIN) and MANAGER -> REVIEWER: nothing revoked, sessionsRevoked 0, sessions keep working', async () => {
    const W = await newUser(app, owner, 'ADMIN');
    const en = await enrollMfa(app, W.email, W.password);
    const id = await userId(owner, W.email);
    let seq = await I.lastSeq(tid);
    expect((await setRole(owner, id, 'MANAGER')).status).toBe(200);
    expect((await roleChangedSince(seq, id)).metadata.sessionsRevoked).toBe(0);
    const s = await loginWithSecret(app, W.email, W.password, en.secret);
    seq = await I.lastSeq(tid);
    const up = await setRole(owner, id, 'ADMIN');
    expect(up.status, up.text).toBe(200);
    expect((await roleChangedSince(seq, id)).metadata.sessionsRevoked).toBe(0);
    expect((await s.get('/me')).status, 'verified-MFA subject keeps the session').toBe(200);
    expect((await s.client.post('/auth/refresh', {})).status).toBe(200);
    // MANAGER -> REVIEWER (no MFA requirement)
    const V = await newUser(app, owner, 'MANAGER');
    const vs = await login(app, V.email, V.password);
    const vid = await userId(owner, V.email);
    seq = await I.lastSeq(tid);
    expect((await setRole(owner, vid, 'REVIEWER')).status).toBe(200);
    expect((await roleChangedSince(seq, vid)).metadata.sessionsRevoked).toBe(0);
    expect((await vs.get('/me')).status).toBe(200);
  }, 180000);
});

describe('HP-I01..I04 invites (C13)', () => {
  let foreign = '';
  let fresh = '';
  let foreignInvite: any;
  it('HP-I01 email of another tenant only and a brand-new email: both 201 with identical shapes; list, events, platform event, mail', async () => {
    // a user who exists only in Globex
    const g = await newUser(app, gxo, 'VIEWER', GOOD_PW, 'globex.test');
    foreign = g.email;
    fresh = `brand-new-${uniq()}@acme.test`;
    const seqT = await I.lastSeq(tid);
    const seqP = await I.lastSeq(null);
    const a = await admin.post('/users/invites', { email: foreign, role: 'VIEWER' });
    const b = await admin.post('/users/invites', { email: fresh, role: 'VIEWER' });
    for (const r of [a, b]) {
      expect(r.status, r.text).toBe(201);
      expect(Object.keys(r.body).sort()).toEqual(['email', 'expiresAt', 'id', 'role']);
    }
    foreignInvite = a.body;
    const list = (await admin.get('/users/invites')).body.items as any[];
    const la = list.find((i) => i.id === a.body.id), lb = list.find((i) => i.id === b.body.id);
    expect(la && lb, 'both listed').toBeTruthy();
    expect(Object.keys(la).sort()).toEqual(Object.keys(lb).sort());
    expect(la.status).toBe(lb.status);
    const created = (await I.eventsSince(tid, seqT, 'invite.created'));
    expect(created).toHaveLength(2);
    expect(Object.keys(created[0]!.metadata).sort()).toEqual(Object.keys(created[1]!.metadata).sort());
    const plat = (await I.eventsSince(null, seqP)).filter((e) => e.action === 'invite.existing_account');
    expect(plat).toHaveLength(1);
    expect(plat[0]!.metadata).toEqual({ inviteId: a.body.id });
    expect(JSON.stringify(plat[0]).includes(foreign), 'no email in the platform event').toBe(false);
    const p = new Client(app, '10.90.1.1');
    for (const email of [foreign, fresh]) {
      const mails = (await p.get(`/dev/outbox?to=${encodeURIComponent(email)}`)).body.items.filter((i: any) => i.kind === 'invite');
      expect(mails.length, `invite mail for ${email.split('@')[0]}`).toBeGreaterThanOrEqual(1);
    }
  }, 120000);
  it('HP-I02 accepting the foreign invite: 409 conflict; no user or membership created; the Globex user unchanged', async () => {
    const p = new Client(app, '10.90.1.2');
    const tok = (await p.get(`/dev/outbox?to=${encodeURIComponent(foreign)}`)).body.items.filter((i: any) => i.kind === 'invite').map((i: any) => i.token)[0];
    expect(tok).toBeTruthy();
    const before = await withAdmin(async (c) => (await c.query(`select u.id, u.name, u.password_hash, (select count(*)::int from memberships m where m.user_id = u.id) n from users u where lower(u.email) = lower($1)`, [foreign])).rows);
    expectError(await p.post('/auth/invites/accept', { token: tok, name: 'Should Not Exist', password: 'Another-Long-Pass-77!' }), 409, 'conflict');
    const after = await withAdmin(async (c) => (await c.query(`select u.id, u.name, u.password_hash, (select count(*)::int from memberships m where m.user_id = u.id) n from users u where lower(u.email) = lower($1)`, [foreign])).rows);
    expect(after).toEqual(before);
    expect(after).toHaveLength(1);
    expect(after[0].n).toBe(1);
    expect((await login(app, foreign, GOOD_PW)).user.tenant.name).not.toBe(owner.user.tenant.name);
    void foreignInvite;
  }, 60000);
  it('HP-I03 existing Acme member and a duplicate pending invite: 409 conflict (unchanged)', async () => {
    expectError(await admin.post('/users/invites', { email: 'manager@acme.test', role: 'VIEWER' }), 409, 'conflict');
    expectError(await admin.post('/users/invites', { email: fresh, role: 'VIEWER' }), 409, 'conflict');
  });
  it('HP-A01 chains verify (tenant and platform)', async () => {
    expect((await owner.get('/audit/verify')).body.valid).toBe(true);
    expect((await gxo.get('/audit/verify')).body.valid).toBe(true);
  });
});
