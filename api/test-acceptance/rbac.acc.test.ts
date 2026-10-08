/* eslint-disable */
// T-RBAC-01..07 (authorization matrix, role-assignment rules). T-RBAC-08 lives in packages/shared.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCOUNTS, ALL_ROLES, Client, type Session, TENANT_ROLES, allAudit, buildTestApp, claimId, closeApps, expectError,
  sessionFor, type RoleName,
} from './helpers/client.js';
import { EXPECTED, RANK, has, type Role } from './helpers/matrix.js';
import { newUser, uniq, userId } from './helpers/users.js';

const RAND = '00000000-0000-4000-8000-0000000000bb';
let app: FastifyInstance;
const S = {} as Record<RoleName, Session>;
let ctx = { claim: '', tenantId: '', invite: '' };
beforeAll(async () => {
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
  for (const r of ALL_ROLES) S[r] = await sessionFor(app, ACCOUNTS[r]);
  ctx.claim = await claimId(S.MANAGER, 'CLM-0008');
  const t = await S.SUPER_ADMIN.get('/platform/tenants');
  ctx.tenantId = t.body.items.find((x: any) => /Acme/.test(x.name)).id;
});
afterAll(closeApps);

interface Route { id: string; perm: string; method: string; path: () => string; body?: () => unknown; allowedOk?: (r: any) => boolean }
const bad = (rev = 9999) => ({ packetRevision: rev, reason: 'rbac probe reason text' });
const ROUTES: Route[] = [
  { id: 'R16 GET /users', perm: 'users:read', method: 'GET', path: () => '/users' },
  { id: 'R18 GET /users/invites', perm: 'users:read', method: 'GET', path: () => '/users/invites' },
  { id: 'R17 POST /users/invites', perm: 'users:manage', method: 'POST', path: () => '/users/invites', body: () => ({ email: `rbac-${uniq()}@acme.test`, role: 'VIEWER' }) },
  { id: 'R19 DELETE invite', perm: 'users:manage', method: 'DELETE', path: () => `/users/invites/${RAND}` },
  { id: 'R20 PATCH role', perm: 'users:manage', method: 'PATCH', path: () => `/users/${RAND}/role`, body: () => ({ role: 'VIEWER', reason: 'rbac probe reason text' }) },
  { id: 'R21 disable', perm: 'users:manage', method: 'POST', path: () => `/users/${RAND}/disable`, body: () => ({ reason: 'rbac probe reason text' }) },
  { id: 'R22 enable', perm: 'users:manage', method: 'POST', path: () => `/users/${RAND}/enable`, body: () => ({ reason: 'rbac probe reason text' }) },
  { id: 'R23 mfa reset', perm: 'users:manage', method: 'POST', path: () => `/users/${RAND}/mfa/reset`, body: () => ({ reason: 'rbac probe reason text' }) },
  { id: 'R24 GET audit events', perm: 'audit:read', method: 'GET', path: () => '/audit/events' },
  { id: 'R25 GET audit verify', perm: 'audit:read', method: 'GET', path: () => '/audit/verify' },
  { id: 'R26 GET claims', perm: 'claims:read', method: 'GET', path: () => '/claims' },
  { id: 'R27 GET claim', perm: 'claims:read', method: 'GET', path: () => `/claims/${ctx.claim}` },
  { id: 'R28 GET packet', perm: 'claims:read', method: 'GET', path: () => `/claims/${ctx.claim}/packet` },
  { id: 'R34 GET approvals', perm: 'claims:read', method: 'GET', path: () => '/approvals' },
  { id: 'R29 assign', perm: 'claims:assign', method: 'POST', path: () => `/claims/${ctx.claim}/assign`, body: () => ({ assigneeId: RAND }) },
  { id: 'R30 revision', perm: 'packets:edit', method: 'POST', path: () => `/claims/${ctx.claim}/packet/revisions`, body: () => ({ baseRevision: 9999, demandLetter: 'rbac probe letter', reason: 'rbac probe reason text' }) },
  { id: 'R31 approve', perm: 'packets:approve', method: 'POST', path: () => `/claims/${ctx.claim}/packet/approve`, body: () => bad() },
  { id: 'R32 reject', perm: 'packets:approve', method: 'POST', path: () => `/claims/${ctx.claim}/packet/reject`, body: () => bad() },
  { id: 'R33 send', perm: 'demands:send', method: 'POST', path: () => `/claims/${ctx.claim}/packet/send`, body: () => bad() },
  { id: 'R35 platform health', perm: 'platform:health', method: 'GET', path: () => '/platform/health' },
  { id: 'R36 platform tenants', perm: 'platform:tenants:list', method: 'GET', path: () => '/platform/tenants' },
  { id: 'R37 cross-tenant claims', perm: 'platform:cross_tenant_read', method: 'GET', path: () => `/platform/tenants/${ctx.tenantId}/claims?reason=acceptance+rbac+probe` },
];

async function snapshot() {
  const r = await S.MANAGER.get(`/claims/${ctx.claim}`);
  const p = await S.MANAGER.get(`/claims/${ctx.claim}/packet`);
  return JSON.stringify({ s: r.body.status, u: r.body.updatedAt, a: r.body.assignee, rev: p.body.revision, ap: p.body.approvals?.length });
}

describe('T-RBAC matrix: 21 routes x 8 roles', () => {
  for (const route of ROUTES) {
    it(`${route.id} (${route.perm})`, async () => {
      const before = await snapshot();
      const created: string[] = [];
      for (const role of ALL_ROLES) {
        const r = await S[role].as(route.method, route.path(), { body: route.body?.() });
        if (has(role as Role, route.perm)) {
          const denied = r.status === 403 || (r.status === 401);
          expect(denied, `${role} should be allowed on ${route.id}: ${r.status} ${r.text}`).toBe(false);
          if (route.id.startsWith('R17') && r.status === 201) created.push(r.body.id);
        } else {
          expectError(r, 403, 'forbidden');
        }
      }
      for (const id of created) await S.ADMIN.destroy(`/users/invites/${id}`);
      expect(await snapshot(), `${route.id} must not change target state`).toBe(before);
    }, 60000);
    it(`${route.id}: no token -> 401; invalid body as unauthorized role -> 403 (permission precedes validation)`, async () => {
      const c = new Client(app);
      expectError(await c.send(route.method, route.path(), { body: route.body?.() }), 401, 'unauthenticated');
      if (route.method !== 'GET' && route.method !== 'DELETE') {
        const lacking = ALL_ROLES.find((r) => !has(r as Role, route.perm))!;
        const r = await S[lacking].as(route.method, route.path(), { body: { totally: 'invalid', body: [1, 2, 3] } });
        expectError(r, 403, 'forbidden');
        // control: an allowed role with the same invalid body gets 400 (or 404 for id-bound, never 403)
        const allowed = ALL_ROLES.find((r) => has(r as Role, route.perm))!;
        const ok = await S[allowed].as(route.method, route.path(), { body: { totally: 'invalid', body: [1, 2, 3] } });
        expect([400, 404]).toContain(ok.status);
      }
    });
  }
  it('every authenticated role may call GET /me and POST /auth/change-password', async () => {
    for (const role of ALL_ROLES) {
      expect((await S[role].get('/me')).status).toBe(200);
      const r = await S[role].post('/auth/change-password', { currentPassword: 'Wrong-Password-1234!', newPassword: 'Another-Long-Pass-77!' });
      expectError(r, 401, 'invalid_credentials');
    }
    expectError(await new Client(app).get('/me'), 401, 'unauthenticated');
  });
});

describe('T-RBAC-01 VIEWER and ANALYST are read-only', () => {
  for (const role of ['VIEWER', 'ANALYST'] as RoleName[]) {
    it(`${role}: R29-R33 denied, unchanged, authz.denied audited`, async () => {
      const claim = await claimId(S.MANAGER, 'CLM-0009');
      const before = (await S.MANAGER.get(`/claims/${claim}/packet`)).body;
      const calls = [
        S[role].post(`/claims/${claim}/assign`, { assigneeId: null }),
        S[role].post(`/claims/${claim}/packet/revisions`, { baseRevision: 1, demandLetter: 'denied letter', reason: 'denied reason text' }),
        S[role].post(`/claims/${claim}/packet/approve`, { packetRevision: 1, reason: 'denied reason text' }),
        S[role].post(`/claims/${claim}/packet/reject`, { packetRevision: 1, reason: 'denied reason text' }),
        S[role].post(`/claims/${claim}/packet/send`, { packetRevision: 1, reason: 'denied reason text' }),
      ];
      for (const r of await Promise.all(calls)) expectError(r, 403, 'forbidden');
      const after = (await S.MANAGER.get(`/claims/${claim}/packet`)).body;
      expect(after.revision).toBe(before.revision);
      expect(after.status).toBe(before.status);
      expect(after.approvals).toEqual(before.approvals);
      const ev = await allAudit(S.OWNER);
      const mine = ev.filter((e) => e.action === 'authz.denied' && e.actor?.id === S[role].user.id);
      expect(mine.length).toBeGreaterThanOrEqual(5);
      expect(ev.filter((e) => e.actor?.id === S[role].user.id && /^(approval\.|packet\.revision_created)/.test(e.action))).toHaveLength(0);
    });
  }
});

describe('T-RBAC-02/03 REVIEWER and MANAGER boundaries', () => {
  it('REVIEWER: R30/R31/R32 pass the permission gate; R33, R29, R16 forbidden', async () => {
    const r = S.REVIEWER;
    const c = ctx.claim;
    for (const res of [
      await r.post(`/claims/${c}/packet/revisions`, { baseRevision: 9999, demandLetter: 'x letter', reason: 'reviewer probe reason' }),
      await r.post(`/claims/${c}/packet/approve`, bad()),
      await r.post(`/claims/${c}/packet/reject`, bad()),
    ]) expect(res.status, res.text).toBe(409);
    expectError(await r.post(`/claims/${c}/packet/send`, bad()), 403, 'forbidden');
    expectError(await r.post(`/claims/${c}/assign`, { assigneeId: null }), 403, 'forbidden');
    expectError(await r.get('/users'), 403, 'forbidden');
  });
  it('MANAGER: R29-R33 pass the gate; R16/R17/R24 forbidden', async () => {
    const m = S.MANAGER;
    const c = ctx.claim;
    expect((await m.post(`/claims/${c}/assign`, { assigneeId: RAND })).status).toBe(422);
    for (const p of ['approve', 'reject', 'send'])
      expect((await m.post(`/claims/${c}/packet/${p}`, bad())).status, p).toBe(409);
    expectError(await m.get('/users'), 403, 'forbidden');
    expectError(await m.post('/users/invites', { email: 'x@acme.test', role: 'VIEWER' }), 403, 'forbidden');
    expectError(await m.get('/audit/events'), 403, 'forbidden');
  });
});

describe('T-RBAC-04/05 ADMIN and OWNER user-management rules', () => {
  it('ADMIN: lists/invites below rank; cannot invite ADMIN/OWNER, grant ADMIN, touch OWNER/other ADMIN/self', async () => {
    const a = S.ADMIN;
    const owner = S.OWNER;
    expect((await a.get('/users')).status).toBe(200);
    const mgr = await newUser(app, owner, 'MANAGER');
    const mid = await userId(a, mgr.email);
    expect((await a.patch(`/users/${mid}/role`, { role: 'REVIEWER', reason: 'rbac admin demote manager' })).status).toBe(200);
    expectError(await a.patch(`/users/${mid}/role`, { role: 'ADMIN', reason: 'rbac admin grants admin' }), 403, 'forbidden');
    expectError(await a.post('/users/invites', { email: `rbac-${uniq()}@acme.test`, role: 'ADMIN' }), 403, 'forbidden');
    expectError(await a.post('/users/invites', { email: `rbac-${uniq()}@acme.test`, role: 'OWNER' }), 403, 'forbidden');
    const ownerId = await userId(a, 'owner@acme.test');
    expectError(await a.patch(`/users/${ownerId}/role`, { role: 'MANAGER', reason: 'rbac admin hits owner' }), 403, 'forbidden');
    expectError(await a.post(`/users/${ownerId}/disable`, { reason: 'rbac admin hits owner' }), 403, 'forbidden');
    const newadminId = await userId(a, 'newadmin@acme.test');
    expectError(await a.post(`/users/${newadminId}/disable`, { reason: 'rbac admin on other admin' }), 403, 'forbidden');
    const selfId = await userId(a, 'admin@acme.test');
    expectError(await a.patch(`/users/${selfId}/role`, { role: 'MANAGER', reason: 'rbac admin self demote' }), 403, 'forbidden');
    expectError(await a.post(`/users/${selfId}/disable`, { reason: 'rbac admin self disable' }), 403, 'forbidden');
    // audit read and verify allowed
    expect((await a.get('/audit/events')).status).toBe(200);
    expect((await a.get('/audit/verify')).status).toBe(200);
    // no API path yields OWNER for any actor
    for (const actor of [S.OWNER, S.ADMIN]) {
      const r = await actor.post('/users/invites', { email: `rbac-${uniq()}@acme.test`, role: 'OWNER' });
      expect([400, 403]).toContain(r.status);
      const r2 = await actor.patch(`/users/${mid}/role`, { role: 'OWNER', reason: 'rbac promote to owner' });
      expect([400, 403]).toContain(r2.status);
    }
  });
  it('OWNER: can invite ADMIN then demote; cannot disable self; last OWNER protected', async () => {
    const o = S.OWNER;
    const adm = await newUser(app, o, 'ADMIN');
    const aid = await userId(o, adm.email);
    expect((await o.patch(`/users/${aid}/role`, { role: 'MANAGER', reason: 'rbac owner demotes admin' })).status).toBe(200);
    const selfId = await userId(o, 'owner@acme.test');
    const dis = await o.post(`/users/${selfId}/disable`, { reason: 'rbac owner self disable' });
    expect([403, 409]).toContain(dis.status);
    const demote = await o.patch(`/users/${selfId}/role`, { role: 'ADMIN', reason: 'rbac owner self demote' });
    expect([403, 409]).toContain(demote.status);
    const me = await o.get('/me');
    expect(me.body.user.role).toBe('OWNER');
  });
});

describe('T-RBAC-06 platform roles', () => {
  it('PLATFORM_DEV: health only; SUPER_ADMIN: health + tenants; neither reaches tenant routes', async () => {
    expect((await S.PLATFORM_DEV.get('/platform/health')).status).toBe(200);
    expectError(await S.PLATFORM_DEV.get('/platform/tenants'), 403, 'forbidden');
    expectError(await S.PLATFORM_DEV.get(`/platform/tenants/${ctx.tenantId}/claims?reason=acceptance+dev+probe`), 403, 'forbidden');
    expect((await S.SUPER_ADMIN.get('/platform/health')).status).toBe(200);
    expect((await S.SUPER_ADMIN.get('/platform/tenants')).status).toBe(200);
    const c = ctx.claim;
    for (const role of ['PLATFORM_DEV', 'SUPER_ADMIN'] as RoleName[]) {
      expectError(await S[role].get('/claims'), 403, 'forbidden');
      expectError(await S[role].get(`/claims/${c}/packet`), 403, 'forbidden');
      expectError(await S[role].post(`/claims/${c}/packet/revisions`, { baseRevision: 1, demandLetter: 'x', reason: 'platform probe reason' }), 403, 'forbidden');
      expectError(await S[role].post(`/claims/${c}/assign`, { assigneeId: null }), 403, 'forbidden');
      expectError(await S[role].get('/users'), 403, 'forbidden');
    }
    for (const role of TENANT_ROLES) expectError(await S[role].get('/platform/health'), 403, 'forbidden');
  });
});

describe('T-RBAC-07 role-assignment rank rules for every actor/target pair', () => {
  it('R17 invite: allowed iff actor has users:manage, role strictly below actor, ADMIN needs admins:manage', async () => {
    const actors = TENANT_ROLES;
    const created: string[] = [];
    for (const actor of actors) {
      for (const target of TENANT_ROLES) {
        const r = await S[actor].post('/users/invites', { email: `rank-${uniq()}@acme.test`, role: target });
        const manage = has(actor as Role, 'users:manage');
        const rankOk = RANK[target]! < RANK[actor]!;
        const adminOk = target !== 'ADMIN' || has(actor as Role, 'admins:manage');
        const expectAllowed = manage && rankOk && adminOk;
        if (expectAllowed) {
          expect(r.status, `${actor}->${target}: ${r.text}`).toBe(201);
          created.push(r.body.id);
        } else if (target === 'OWNER') {
          expect([400, 403], `${actor}->OWNER: ${r.text}`).toContain(r.status);
        } else {
          expect(r.status, `${actor}->${target}: ${r.text}`).toBe(403);
          expect(r.body.error.code).toBe('forbidden');
        }
      }
    }
    for (const id of created) await S.OWNER.destroy(`/users/invites/${id}`);
  }, 120000);
  it('R20 role change over the matrix of actors (owner/admin) x fresh targets x new roles', async () => {
    const o = S.OWNER;
    for (const actor of ['OWNER', 'ADMIN'] as RoleName[]) {
      for (const target of ['MANAGER', 'VIEWER'] as const) {
        const u = await newUser(app, o, target);
        const id = await userId(o, u.email);
        for (const nr of TENANT_ROLES) {
          const r = await S[actor].patch(`/users/${id}/role`, { role: nr, reason: 'rbac rank matrix check' });
          const rankOk = RANK[nr]! < RANK[actor]!;
          const adminOk = nr !== 'ADMIN' || has(actor as Role, 'admins:manage');
          if (rankOk && adminOk) expect(r.status, `${actor}: ${target}->${nr} ${r.text}`).toBe(200);
          else if (nr === 'OWNER') expect([400, 403]).toContain(r.status);
          else expect(r.status, `${actor}: ${target}->${nr} ${r.text}`).toBe(403);
          // keep the target at a known rank for the next iteration
          const cur = (await o.get('/users?pageSize=100')).body.items.find((x: any) => x.id === id).role;
          if (cur !== target) await o.patch(`/users/${id}/role`, { role: target, reason: 'rbac rank matrix reset' });
        }
      }
    }
    void EXPECTED;
  }, 240000);
});