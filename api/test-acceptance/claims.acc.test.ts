/* eslint-disable */
// T-CLM-01..07
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCOUNTS, type Session, allAudit, buildTestApp, claimId, claimIndex, closeApps, expectError, sessionFor,
} from './helpers/client.js';
import { moneyFromFindings } from './helpers/packet.js';
import { reseed } from './helpers/seed.js';
import { newUser, userId } from './helpers/users.js';

let app: FastifyInstance;
let m: Session;
let all: any[];
beforeAll(async () => {
  reseed();
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
  m = await sessionFor(app, ACCOUNTS.MANAGER);
  all = [...(await claimIndex(m)).values()];
});
afterAll(closeApps);

describe('T-CLM-01 defaults and paging', () => {
  it('default page, ordering, page 2/3, invalid page sizes', async () => {
    const r = await m.get('/claims');
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({ page: 1, pageSize: 25, total: 26 });
    expect(r.body.items).toHaveLength(25);
    const t = r.body.items.map((i: any) => Date.parse(i.createdAt));
    expect(t).toEqual([...t].sort((a: number, b: number) => b - a));
    const p2 = await m.get('/claims?page=2');
    expect(p2.body.items).toHaveLength(1);
    const ids = new Set([...r.body.items, ...p2.body.items].map((i: any) => i.id));
    expect(ids.size).toBe(26);
    const p3 = await m.get('/claims?page=3');
    expect(p3.status).toBe(200);
    expect(p3.body.items).toHaveLength(0);
    for (const bad of ['pageSize=101', 'pageSize=0', 'page=0', 'page=-1', 'pageSize=abc']) expectError(await m.get(`/claims?${bad}`), 400, 'validation_error');
    expect((await m.get('/claims?pageSize=100')).body.items).toHaveLength(26); // control
  });
});

describe('T-CLM-02 filters', () => {
  it('status / perspective / assignee filters', async () => {
    const cnt = async (qs: string) => (await m.get(`/claims?${qs}&pageSize=100`)).body;
    const ap = await cnt('status=APPROVED');
    expect(ap.total).toBe(4);
    expect(ap.items.every((i: any) => i.status === 'APPROVED')).toBe(true);
    expect((await cnt('status=PENDING_REVIEW,REJECTED')).total).toBe(19);
    expect((await cnt('status=PENDING_REVIEW')).total).toBe(16);
    expect((await cnt('status=SEND_READY')).total).toBe(3);
    const sh = (await cnt('perspective=SHIPPER')).total;
    const ca = (await cnt('perspective=CARRIER')).total;
    expect(sh + ca).toBe(26);
    expect(sh).toBeGreaterThan(0);
    expect((await cnt('assigneeId=none')).total).toBe(26);
    expectError(await m.get('/claims?status=BOGUS'), 400, 'validation_error');
    const reviewer = await sessionFor(app, ACCOUNTS.REVIEWER);
    const id3 = await claimId(m, 'CLM-0003');
    try {
      expect((await m.post(`/claims/${id3}/assign`, { assigneeId: reviewer.user.id })).status).toBe(200);
      const mine = await cnt(`assigneeId=${reviewer.user.id}`);
      expect(mine.total).toBe(1);
      expect(mine.items[0].claimNumber).toBe('CLM-0003');
      expect(mine.items[0].assignee.name).toBeTruthy();
      expect((await cnt('assigneeId=none')).total).toBe(25);
    } finally {
      await m.post(`/claims/${id3}/assign`, { assigneeId: null });
    }
    expect((await cnt('assigneeId=none')).total).toBe(26);
  });
});

describe('T-CLM-03 search', () => {
  const hay = (c: any, q: string) => [c.claimNumber, c.loadNumber, c.invoiceNumber, c.carrierName, c.shipperName].some((f) => String(f ?? '').toLowerCase().includes(q.toLowerCase()));
  it('literal, case-insensitive substring over the five fields; oracle computed from the unfiltered list', async () => {
    const full = new Map<string, any>();
    for (const c of all) full.set(c.id, { ...c, ...(await m.get(`/claims/${c.id}`)).body });
    const rows = [...full.values()];
    const run = async (q: string) => {
      const r = await m.get(`/claims?q=${encodeURIComponent(q)}&pageSize=100`);
      expect(r.status, `${q}: ${r.text}`).toBe(200);
      return new Set(r.body.items.map((i: any) => i.id));
    };
    for (const q of ['CLM-0001', 'clm-0001', 'LD-5001', 'LD-5002', 'acme freight', 'Acme', 'inv-', 'zzzz', 'CLM-HOSTILE', '<script>']) {
      const got = await run(q);
      const want = new Set(rows.filter((c) => hay(c, q)).map((c) => c.id));
      expect([...got].sort(), `q=${q}`).toEqual([...want].sort());
    }
    expect((await run('CLM-0001')).size).toBe(1);
    expect((await run('clm-0001')).size).toBe(1);
    expect((await run('zzzz')).size).toBe(0);
    expect((await run('LD-5001')).size).toBeGreaterThanOrEqual(1);
    expectError(await m.get(`/claims?q=${'x'.repeat(101)}`), 400, 'validation_error');
    expect((await m.get(`/claims?q=${'x'.repeat(100)}`)).status).toBe(200);
  }, 60000);
  it('q combines with status/sort/page as an intersection', async () => {
    const r = await m.get('/claims?q=CLM-00&status=PENDING_REVIEW&sort=claimNumber:asc&pageSize=5&page=2');
    expect(r.status, r.text).toBe(200);
    expect(r.body.items.every((i: any) => i.status === 'PENDING_REVIEW' && /clm-00/i.test(i.claimNumber))).toBe(true);
    const nums = r.body.items.map((i: any) => i.claimNumber);
    expect(nums).toEqual([...nums].sort());
    const all1 = await m.get('/claims?q=CLM-00&status=PENDING_REVIEW&sort=claimNumber:asc&pageSize=100');
    expect(all1.body.items.map((i: any) => i.id).slice(5, 10)).toEqual(r.body.items.map((i: any) => i.id));
  });
});

describe('T-CLM-04 sorting', () => {
  const FIELDS = ['createdAt', 'updatedAt', 'claimNumber', 'carrierName', 'status', 'amountClaimedCents', 'recoverableCents'];
  const str = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const loc = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
  it.each(FIELDS)('monotone and repeatable for %s asc/desc', async (field) => {
    for (const dir of ['asc', 'desc'] as const) {
      const r1 = await m.get(`/claims?sort=${field}:${dir}&pageSize=100`);
      expect(r1.status, r1.text).toBe(200);
      const r2 = await m.get(`/claims?sort=${field}:${dir}&pageSize=100`);
      expect(r2.body.items.map((i: any) => i.id)).toEqual(r1.body.items.map((i: any) => i.id)); // stable
      const v = r1.body.items.map((i: any) => i[field]);
      const sgn = dir === 'asc' ? 1 : -1;
      const ok = (cmp: (a: any, b: any) => number) => v.every((x: any, i: number) => i === 0 || sgn * cmp(v[i - 1], x) <= 0);
      if (typeof v[0] === 'number') expect(ok((a, b) => a - b), `${field}:${dir}`).toBe(true);
      else if (/At$/.test(field)) expect(ok((a, b) => Date.parse(a) - Date.parse(b)), `${field}:${dir}`).toBe(true);
      else if (field === 'status') {
        const order = ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SEND_READY'];
        const idx = (s: string) => order.indexOf(s);
        // status may sort alphabetically or by declared enum order; both are monotone orderings
        expect(ok(str) || ok(loc) || ok((a, b) => idx(a) - idx(b)), `${field}:${dir}`).toBe(true);
      } else expect(ok(str) || ok(loc), `${field}:${dir}`).toBe(true);
    }
  });
  it('invalid sort fields/directions -> 400', async () => {
    for (const s of ['bogus:asc', 'createdAt:sideways', 'createdAt;drop', 'createdAt', ':asc']) expectError(await m.get(`/claims?sort=${encodeURIComponent(s)}`), 400, 'validation_error');
  });
});

describe('T-CLM-05 money', () => {
  it('non-negative integers on every item; spot-checks against packet findings', async () => {
    for (const c of all) {
      expect(Number.isInteger(c.recoverableCents) && c.recoverableCents >= 0, c.claimNumber).toBe(true);
      expect(Number.isInteger(c.pendingReviewCents) && c.pendingReviewCents >= 0, c.claimNumber).toBe(true);
      expect(Number.isInteger(c.amountClaimedCents)).toBe(true);
      expect(c.currency).toBe('USD');
    }
    for (const num of ['CLM-0001', 'CLM-0002', 'CLM-0013']) {
      const c = all.find((x) => x.claimNumber === num);
      const p = (await m.get(`/claims/${c.id}/packet`)).body;
      const { rec, pend } = moneyFromFindings(p);
      expect(c.recoverableCents, num).toBe(rec);
      expect(c.pendingReviewCents, num).toBe(pend);
      expect(p.recoverableCents).toBe(rec);
      expect(p.pendingReviewCents).toBe(pend);
      const dir = p.perspective === 'SHIPPER' ? 'OVERCHARGE' : 'UNDERBILLED';
      if (p.findings.every((f: any) => f.direction === dir)) expect(c.amountClaimedCents, num).toBe(rec + pend);
    }
  });
});

describe('T-CLM-06 detail', () => {
  it('equals the list item plus invoice fields; 404 for unknown and non-UUID ids', async () => {
    const item = all.find((c) => c.claimNumber === 'CLM-0005');
    const d = await m.get(`/claims/${item.id}`);
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject(item);
    expect(d.body.invoiceNumber).toBeTruthy();
    expect(d.body.invoiceDate).toBeTruthy();
    expectError(await m.get('/claims/00000000-0000-4000-8000-0000000000cc'), 404, 'not_found');
    expectError(await m.get('/claims/not-a-uuid'), 404, 'not_found');
  });
});

describe('T-CLM-07 assign', () => {
  it('assign/unassign (audited); VIEWER assignable; disabled or unknown assignee -> 422', async () => {
    const owner = await sessionFor(app, ACCOUNTS.OWNER);
    const admin = await sessionFor(app, ACCOUNTS.ADMIN);
    const cid = await claimId(m, 'CLM-0011');
    const viewer = await sessionFor(app, ACCOUNTS.VIEWER);
    const r = await m.post(`/claims/${cid}/assign`, { assigneeId: viewer.user.id });
    expect(r.status, r.text).toBe(200);
    expect(r.body.assignee).toMatchObject({ id: viewer.user.id });
    expect((await allAudit(owner, 'action=claim.assigned')).some((e) => e.targetId === cid)).toBe(true);
    const un = await m.post(`/claims/${cid}/assign`, { assigneeId: null });
    expect(un.status).toBe(200);
    expect(un.body.assignee).toBeNull();
    const u = await newUser(app, owner, 'VIEWER');
    const uid = await userId(admin, u.email);
    expect((await admin.post(`/users/${uid}/disable`, { reason: 'assign disabled check' })).status).toBe(200);
    expectError(await m.post(`/claims/${cid}/assign`, { assigneeId: uid }), 422, 'unprocessable');
    expectError(await m.post(`/claims/${cid}/assign`, { assigneeId: '00000000-0000-4000-8000-0000000000dd' }), 422, 'unprocessable');
    expectError(await m.post(`/claims/${cid}/assign`, { assigneeId: 'not-a-uuid' }), 400, 'validation_error');
    expect((await m.get(`/claims/${cid}`)).body.assignee).toBeNull();
  });
});