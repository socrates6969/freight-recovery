/* eslint-disable */
// T-TEN-01..05, T-DB-01..04, T-SA-01/02
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCOUNTS, Client, type Session, allAudit, buildTestApp, claimIndex, closeApps, expectError, login, sessionFor, strip,
} from './helpers/client.js';
import { buildInsert, inRollback, tryQuery, withAdmin, withApp } from './helpers/db.js';

let app: FastifyInstance;
let acmeMgr: Session, gxMgr: Session, owner: Session, admin: Session, gxOwner: Session, superA: Session, dev: Session;
let acmeClaims: Map<string, any>, gxClaims: Map<string, any>;
beforeAll(async () => {
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
  acmeMgr = await sessionFor(app, ACCOUNTS.MANAGER);
  gxMgr = await sessionFor(app, 'manager@globex.test');
  owner = await sessionFor(app, ACCOUNTS.OWNER);
  admin = await sessionFor(app, ACCOUNTS.ADMIN);
  gxOwner = await sessionFor(app, 'owner@globex.test');
  superA = await sessionFor(app, ACCOUNTS.SUPER_ADMIN);
  dev = await sessionFor(app, ACCOUNTS.PLATFORM_DEV);
  acmeClaims = await claimIndex(acmeMgr);
  gxClaims = await claimIndex(gxMgr);
});
afterAll(closeApps);

describe('T-TEN-01 cross-tenant IDOR on claim-bound routes', () => {
  it('Globex ids are indistinguishable from random ids (byte-identical 404) and nothing changes', async () => {
    expect(gxClaims.size).toBe(6);
    const gx = [...gxClaims.values()][0];
    const random = randomUUID();
    const calls: Array<[string, string, unknown?]> = [
      ['GET', 'claims/{id}'],
      ['GET', 'claims/{id}/packet'],
      ['POST', 'claims/{id}/assign', { assigneeId: null }],
      ['POST', 'claims/{id}/packet/approve', { packetRevision: 1, reason: 'idor probe reason' }],
      ['POST', 'claims/{id}/packet/reject', { packetRevision: 1, reason: 'idor probe reason' }],
      ['POST', 'claims/{id}/packet/send', { packetRevision: 1, reason: 'idor probe reason' }],
      ['POST', 'claims/{id}/packet/revisions', { baseRevision: 1, demandLetter: 'idor letter', reason: 'idor probe reason' }],
    ];
    const beforeG = JSON.stringify((await gxMgr.get(`/claims/${gx.id}`)).body);
    const counts = () => withAdmin(async (c) => (await c.query(`select (select count(*) from approvals)::int a, (select count(*) from evidence_packets)::int p`)).rows[0]);
    const countBefore = await counts();
    for (const [m, p, b] of calls) {
      const real = await acmeMgr.as(m, '/' + p.replace('{id}', gx.id), { body: b });
      const fake = await acmeMgr.as(m, '/' + p.replace('{id}', random), { body: b });
      expectError(real, 404, 'not_found');
      expect(real.status).toBe(fake.status);
      expect(strip(real.body)).toEqual(strip(fake.body));
      expect(real.text.replace(/"requestId":"[^"]*"/, '')).toBe(fake.text.replace(/"requestId":"[^"]*"/, ''));
    }
    expect(JSON.stringify((await gxMgr.get(`/claims/${gx.id}`)).body)).toBe(beforeG); // control: Globex still reads its own
    expect(await counts()).toEqual(countBefore);
  });
});

describe('T-TEN-02 list isolation', () => {
  it('Acme list never contains Globex rows for any filter combination; total = 26', async () => {
    const gxIds = new Set([...gxClaims.values()].map((c) => c.id));
    expect(acmeClaims.size).toBe(26);
    const queries = [
      '', 'q=GLX', 'q=GLX-0001', 'q=Globex', 'status=APPROVED', 'status=PENDING_REVIEW,REJECTED,SEND_READY,APPROVED',
      'sort=claimNumber:asc', 'sort=carrierName:desc&pageSize=100', 'assigneeId=none', 'perspective=SHIPPER', 'perspective=CARRIER',
      'page=1&pageSize=100&sort=recoverableCents:desc', 'page=2&pageSize=10',
    ];
    for (const qs of queries) {
      const r = await acmeMgr.get(`/claims?${qs}`);
      expect(r.status, `${qs}: ${r.text}`).toBe(200);
      for (const it of r.body.items) {
        expect(gxIds.has(it.id), `${qs}`).toBe(false);
        expect(it.claimNumber.startsWith('GLX-')).toBe(false);
      }
    }
    const all = await acmeMgr.get('/claims?pageSize=100');
    expect(all.body.total).toBe(26);
    expect((await acmeMgr.get('/claims?q=GLX-0001')).body.total).toBe(0);
    expect((await gxMgr.get('/claims?q=GLX-0001')).body.total).toBe(1); // control
  });
});

describe('T-TEN-03 users, invites, assign, audit isolation', () => {
  it('cross-tenant ids -> 422/404; audit has no Globex data and per-tenant seq from 1', async () => {
    const gxViewer = await sessionFor(app, 'viewer@globex.test');
    const gxUserId = gxViewer.user.id;
    const acmeClaim = acmeClaims.get('CLM-0012')!;
    const asg = await acmeMgr.post(`/claims/${acmeClaim.id}/assign`, { assigneeId: gxUserId });
    expect(asg.status, asg.text).toBe(422);
    expect((await acmeMgr.get(`/claims/${acmeClaim.id}`)).body.assignee).toBeNull();
    const reason = 'cross tenant probe reason';
    expectError(await admin.patch(`/users/${gxUserId}/role`, { role: 'ANALYST', reason }), 404, 'not_found');
    expectError(await admin.post(`/users/${gxUserId}/disable`, { reason }), 404, 'not_found');
    expectError(await admin.post(`/users/${gxUserId}/enable`, { reason }), 404, 'not_found');
    expectError(await admin.post(`/users/${gxUserId}/mfa/reset`, { reason }), 404, 'not_found');
    expect((await gxViewer.get('/me')).status).toBe(200);
    const inv = await gxOwner.post('/users/invites', { email: `tenprobe-${randomUUID().slice(0, 8)}@globex.test`, role: 'VIEWER' });
    expect(inv.status, inv.text).toBe(201);
    try {
      expectError(await admin.destroy(`/users/invites/${inv.body.id}`), 404, 'not_found');
      const list = await gxOwner.get('/users/invites');
      expect(list.body.items.some((i: any) => i.id === inv.body.id)).toBe(true);
    } finally {
      expect((await gxOwner.destroy(`/users/invites/${inv.body.id}`)).status).toBe(204);
    }
    const acmeEv = await allAudit(owner);
    const gxEv = await allAudit(gxOwner);
    const blob = JSON.stringify(acmeEv);
    for (const needle of ['globex', 'Globex', 'GLX-', gxUserId]) expect(blob.includes(needle), needle).toBe(false);
    const seqs = (ev: any[]) => ev.map((e) => e.seq).sort((a, b) => a - b);
    for (const ev of [acmeEv, gxEv]) {
      const s = seqs(ev);
      expect(s[0]).toBe(1);
      for (let i = 1; i < s.length; i++) expect(s[i]).toBe(s[i - 1]! + 1);
    }
    expect(JSON.stringify(gxEv).includes('acme.test')).toBe(false);
  });
});

describe('T-TEN-04 tenant smuggling is ignored or rejected', () => {
  it('X-Tenant-Id header, tenantId query and body never change scope', async () => {
    const tenants = (await superA.get('/platform/tenants')).body.items;
    const gxT = tenants.find((t: any) => /Globex/.test(t.name)).id;
    const base = await acmeMgr.get('/claims?pageSize=100');
    const viaHeader = await acmeMgr.get('/claims?pageSize=100', { headers: { 'x-tenant-id': gxT } });
    expect(viaHeader.status).toBe(200);
    expect(viaHeader.body.items.map((i: any) => i.id)).toEqual(base.body.items.map((i: any) => i.id));
    expect((await acmeMgr.get(`/claims?tenantId=${gxT}`)).status).toBe(400);
    const c = acmeClaims.get('CLM-0012')!;
    expect((await acmeMgr.post(`/claims/${c.id}/assign`, { assigneeId: null, tenantId: gxT })).status).toBe(400);
    const gxClaim = [...gxClaims.values()][0];
    expectError(await acmeMgr.get(`/claims/${gxClaim.id}`, { headers: { 'x-tenant-id': gxT } }), 404, 'not_found');
  });
});

describe('T-TEN-05 suspended tenant', () => {
  it('Acme requests and refresh fail with 401 while Globex is unaffected; restored afterwards', async () => {
    const s = await login(app, 'viewer@acme.test');
    const gxv = await sessionFor(app, 'viewer@globex.test');
    expect((await s.get('/me')).status).toBe(200);
    const prev = await withAdmin(async (c) => (await c.query(`select id, status from tenants where name like 'Acme%'`)).rows[0]);
    expect(prev, 'Acme tenant row').toBeTruthy();
    try {
      await withAdmin((c) => c.query(`update tenants set status='SUSPENDED' where id=$1`, [prev.id]));
      expectError(await s.get('/me'), 401, 'unauthenticated');
      expectError(await s.client.post('/auth/refresh', {}), 401, 'unauthenticated');
      expect((await new Client(app).post('/auth/login', { email: 'viewer@acme.test', password: 'Synthetic-Pass-2026!' })).status).toBe(401);
      expect((await gxv.get('/me')).status).toBe(200);
      expect((await gxMgr.get('/claims')).status).toBe(200);
    } finally {
      await withAdmin((c) => c.query(`update tenants set status=$2 where id=$1`, [prev.id, prev.status]));
    }
    expect((await login(app, 'viewer@acme.test')).token).toBeTruthy(); // restored
  });
});

describe('T-DB-01 RLS from a raw freight_app connection with no application context', () => {
  it('reads return zero rows, inserts rejected, updates/deletes touch nothing (with controls)', async () => {
    const tables = ['claims', 'evidence_packets', 'approvals', 'audit_events', 'memberships'];
    await withApp(async (a) => {
      await withAdmin(async (adm) => {
        for (const t of tables) {
          const c = await adm.query(`select count(*)::int n from ${t}`);
          expect(c.rows[0].n, `admin sees ${t}`).toBeGreaterThan(0);
          const r = await a.query(`select count(*)::int n from ${t}`);
          expect(r.rows[0].n, `app w/o context sees ${t}`).toBe(0);
        }
        const tenant = (await adm.query(`select id from tenants where name like 'Acme%'`)).rows[0].id;
        const ins = await buildInsert(adm, 'claims', { tenant_id: `'${tenant}'`, claim_number: `'ACC-RLS-1'` });
        const ctl = await inRollback(adm, () => tryQuery(adm, ins));
        expect(ctl.ok, `control insert must be valid for owner: ${ctl.error}`).toBe(true);
        const bad = await tryQuery(a, ins);
        expect(bad.ok, 'app role must not insert without context').toBe(false);
        expect(bad.error).toMatch(/row-level security|permission denied|policy/i);
        const up = await tryQuery(a, `update claims set claim_number='x'`);
        expect(up.ok ? up.rowCount : 0).toBe(0);
        const gone = await tryQuery(a, `delete from claims`);
        expect(gone.ok ? gone.rowCount : 0).toBe(0);
        const still = await adm.query(`select count(*)::int n from claims where claim_number='x'`);
        expect(still.rows[0].n).toBe(0);
        const upCtl = await inRollback(adm, () => tryQuery(adm, `update claims set claim_number=claim_number`));
        expect(upCtl.rowCount).toBeGreaterThan(0);
      });
    });
  });
});

describe('T-DB-02 append-only and least privilege for the app role', () => {
  it('UPDATE/DELETE/TRUNCATE audit_events+approvals error; packet content columns immutable; no DDL', async () => {
    await withApp(async (a) => {
      for (const t of ['audit_events', 'approvals']) {
        for (const sql of [
          t === 'audit_events' ? `update audit_events set action='x'` : `update approvals set reason='x'`,
          `delete from ${t}`,
          `truncate ${t}`,
        ]) {
          const r = await tryQuery(a, sql);
          expect(r.ok, `${sql} must be rejected`).toBe(false);
        }
      }
      for (const sql of [`update evidence_packets set demand_letter='x'`, `update evidence_packets set content_hash='x'`]) {
        const r = await tryQuery(a, sql);
        expect(r.ok, `${sql} must be rejected`).toBe(false);
      }
      for (const sql of [`create table acc_probe(x int)`, `drop table claims`, `alter table claims add column acc_probe int`, `select * from pg_authid`]) {
        const r = await tryQuery(a, sql);
        expect(r.ok, `${sql} must be rejected`).toBe(false);
      }
    });
    await withAdmin(async (adm) => {
      expect((await inRollback(adm, () => tryQuery(adm, `create table acc_probe(x int)`))).ok).toBe(true); // control
      expect((await adm.query(`select count(*)::int n from audit_events`)).rows[0].n).toBeGreaterThan(0);
      expect((await adm.query(`select count(*)::int n from approvals`)).rows[0].n).toBeGreaterThan(0);
    });
  });
});

describe('T-DB-03 no tenant cross-talk through pooled connections', () => {
  it('20 parallel reads alternating tenants; then interleaved writes', async () => {
    const check = (r: any, prefix: string) => {
      expect(r.status).toBe(200);
      for (const it of r.body.items) expect(it.claimNumber.startsWith(prefix), `${it.claimNumber} leaked`).toBe(true);
    };
    const reads = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0 ? acmeMgr.get('/claims?pageSize=100').then((r) => ['CLM-', r] as const) : gxMgr.get('/claims?pageSize=100').then((r) => ['GLX-', r] as const),
    );
    for (const [p, r] of await Promise.all(reads)) check(r, p);
    const gxViewerId = (await sessionFor(app, 'viewer@globex.test')).user.id;
    const reviewerId = (await sessionFor(app, ACCOUNTS.REVIEWER)).user.id;
    const acmeC = acmeClaims.get('CLM-0012')!.id;
    const gxC = [...gxClaims.values()][0].id;
    await acmeMgr.client.ensureCsrf(); // establish the CSRF cookie once: concurrent first calls would rotate it under each other
    await gxMgr.client.ensureCsrf();
    try {
      const mixed = Array.from({ length: 20 }, (_, i) => {
        if (i % 4 === 0) return acmeMgr.post(`/claims/${acmeC}/assign`, { assigneeId: reviewerId }).then((r) => ['A', r] as const);
        if (i % 4 === 1) return gxMgr.post(`/claims/${gxC}/assign`, { assigneeId: gxViewerId }).then((r) => ['G', r] as const);
        if (i % 4 === 2) return acmeMgr.get('/claims?pageSize=100').then((r) => ['CLM-', r] as const);
        return gxMgr.get('/claims?pageSize=100').then((r) => ['GLX-', r] as const);
      });
      for (const [p, r] of await Promise.all(mixed)) {
        if (p === 'A' || p === 'G') expect(r.status, r.text).toBe(200);
        else check(r, p);
      }
    } finally {
      await acmeMgr.post(`/claims/${acmeC}/assign`, { assigneeId: null });
      await gxMgr.post(`/claims/${gxC}/assign`, { assigneeId: null });
    }
    expect((await acmeMgr.get(`/claims/${acmeC}`)).body.assignee).toBeNull();
  });
});

describe('T-DB-04 unauthenticated and platform users never reach tenant data', () => {
  it('401 / 403', async () => {
    const c = new Client(app);
    const id = acmeClaims.get('CLM-0001')!.id;
    for (const p of ['/claims', `/claims/${id}`, `/claims/${id}/packet`, '/approvals', '/users', '/audit/events'])
      expectError(await c.get(p), 401, 'unauthenticated');
    for (const s of [dev, superA]) for (const p of ['/claims', '/approvals', '/users', '/audit/events']) expectError(await s.get(p), 403, 'forbidden');
  });
});

describe('T-SA-01/02 super-admin cross-tenant support access', () => {
  const cross = async (tid: string, qs: string) => superA.get(`/platform/tenants/${tid}/claims?${qs}`);
  it('requires a reason; success is audited exactly once in the target tenant chain', async () => {
    const tenants = (await superA.get('/platform/tenants')).body.items;
    const acme = tenants.find((t: any) => /Acme/.test(t.name));
    const count = async () => (await allAudit(owner, 'action=platform.cross_tenant_read')).length;
    const n0 = await count();
    expectError(await cross(acme.id, ''), 400, 'validation_error');
    expectError(await cross(acme.id, 'reason=123456789'), 400, 'validation_error');
    expect(await count()).toBe(n0);
    const reason = 'acceptance support lookup 001';
    const ok = await cross(acme.id, `reason=${encodeURIComponent(reason)}&q=CLM-0001`);
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.total).toBe(1);
    expect(ok.body.items[0].claimNumber).toBe('CLM-0001');
    const full = await cross(acme.id, `reason=${encodeURIComponent(reason)}&pageSize=100&sort=claimNumber:asc`);
    expect(full.body.total).toBe(26);
    const nums = full.body.items.map((i: any) => i.claimNumber);
    expect(nums).toEqual([...nums].sort());
    expect(await count()).toBe(n0 + 2);
    const events = (await allAudit(owner, 'action=platform.cross_tenant_read')).filter((e) => e.metadata?.reason === reason);
    expect(events.length).toBeGreaterThanOrEqual(2);
    for (const e of events) {
      expect(e.actor.role).toBe('SUPER_ADMIN');
      expect(e.targetId).toBe(acme.id);
    }
    expectError(await cross(randomUUID(), `reason=${encodeURIComponent(reason)}`), 404, 'not_found');
    expect(await count()).toBe(n0 + 2);
    expect((await owner.get('/audit/verify')).body.valid).toBe(true);
    expect(JSON.stringify(await allAudit(gxOwner)).includes(reason)).toBe(false);
  });
  it('T-SA-02 tenants list leaks no PII; PLATFORM_DEV denied without audit; SUPER_ADMIN has no mutation rights', async () => {
    const t = await superA.get('/platform/tenants');
    expect(t.status).toBe(200);
    for (const it of t.body.items) {
      expect(Object.keys(it).sort()).toEqual(['claimCount', 'id', 'name', 'status', 'userCount']);
      expect(typeof it.userCount).toBe('number');
    }
    expect(t.text).not.toMatch(/@|CLM-|GLX-|LD-\d/);
    const n0 = (await allAudit(owner, 'action=platform.cross_tenant_read')).length;
    const acmeId = t.body.items.find((x: any) => /Acme/.test(x.name)).id;
    expectError(await dev.get('/platform/tenants'), 403, 'forbidden');
    expectError(await dev.get(`/platform/tenants/${acmeId}/claims?reason=acceptance+dev+attempt`), 403, 'forbidden');
    expect((await allAudit(owner, 'action=platform.cross_tenant_read')).length).toBe(n0);
    const cid = acmeClaims.get('CLM-0010')!.id;
    for (const [p, b] of [
      [`/claims/${cid}/assign`, { assigneeId: null }],
      [`/claims/${cid}/packet/revisions`, { baseRevision: 1, demandLetter: 'x', reason: 'super mutation probe' }],
      [`/claims/${cid}/packet/approve`, { packetRevision: 1, reason: 'super mutation probe' }],
      [`/claims/${cid}/packet/reject`, { packetRevision: 1, reason: 'super mutation probe' }],
      [`/claims/${cid}/packet/send`, { packetRevision: 1, reason: 'super mutation probe' }],
    ] as const) expectError(await superA.post(p, b), 403, 'forbidden');
  });
});