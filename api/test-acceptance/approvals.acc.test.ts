/* eslint-disable */
// T-APR-01..11 (human approval gate), including concurrency, content binding and no-egress.
import { createServer } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCOUNTS, Client, type Session, allAudit, buildTestApp, claimId, closeApps, expectError, login, sessionFor,
} from './helpers/client.js';
import { withAdmin, withTriggersOff } from './helpers/db.js';
import { validatePacket } from './helpers/packet.js';
import { reseed } from './helpers/seed.js';
import { deepKeys } from './helpers/users.js';

let app: FastifyInstance;
let m: Session, rv: Session, an: Session, vw: Session, owner: Session;
beforeAll(async () => {
  reseed();
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
  m = await sessionFor(app, ACCOUNTS.MANAGER);
  rv = await sessionFor(app, ACCOUNTS.REVIEWER);
  an = await sessionFor(app, ACCOUNTS.ANALYST);
  vw = await sessionFor(app, ACCOUNTS.VIEWER);
  owner = await sessionFor(app, ACCOUNTS.OWNER);
});
afterAll(closeApps);

const R = 'a valid reason of sufficient length';
const idOf = (n: string) => claimId(m, n);
const pk = async (id: string, qs = '') => (await m.get(`/claims/${id}/packet${qs}`)).body;
const approve = (s: Session, id: string, rev: number, extra: object = {}, reason = R) => s.post(`/claims/${id}/packet/approve`, { packetRevision: rev, reason, ...extra });
const reject = (s: Session, id: string, rev: number, reason = R) => s.post(`/claims/${id}/packet/reject`, { packetRevision: rev, reason });
const send = (s: Session, id: string, rev: number, reason = R) => s.post(`/claims/${id}/packet/send`, { packetRevision: rev, reason });
const edit = (s: Session, id: string, base: number, letter = 'Edited demand letter text', reason = R) => s.post(`/claims/${id}/packet/revisions`, { baseRevision: base, demandLetter: letter, reason });
const workflowEvents = async () => (await allAudit(owner)).filter((e) => /^approval\./.test(e.action) || e.action === 'packet.revision_created').length;
async function snap(id: string) {
  const p = await pk(id);
  const c = (await m.get(`/claims/${id}`)).body;
  return JSON.stringify({ rev: p.revision, st: p.status, cst: c.status, ap: p.approvals.length, ev: await workflowEvents() });
}

describe('T-APR-11 approvals queue (read-only, run first on pristine seed)', () => {
  it('default PENDING_REVIEW+APPROVED, filters, fields, ordering, paging; VIEWER can read', async () => {
    const r = await m.get('/approvals?pageSize=100');
    expect(r.status, r.text).toBe(200);
    expect(r.body.total).toBe(20);
    expect(new Set(r.body.items.map((i: any) => i.status))).toEqual(new Set(['PENDING_REVIEW', 'APPROVED']));
    for (const it of r.body.items) {
      expect(Number.isInteger(it.packetRevision)).toBe(true);
      expect(Number.isInteger(it.pendingFindingsCount)).toBe(true);
      expect(Date.parse(it.waitingSince)).toBeGreaterThan(0);
    }
    const u = r.body.items.map((i: any) => Date.parse(i.updatedAt));
    expect(u).toEqual([...u].sort((a: number, b: number) => a - b));
    const only = await m.get('/approvals?status=APPROVED&pageSize=100');
    expect(only.body.total).toBe(4);
    expect(only.body.items.every((i: any) => i.status === 'APPROVED')).toBe(true);
    expect((await m.get('/approvals?status=PENDING_REVIEW&pageSize=100')).body.total).toBe(16);
    expectError(await m.get('/approvals?status=REJECTED'), 400, 'validation_error');
    const p1 = await m.get('/approvals?pageSize=7');
    const p3 = await m.get('/approvals?pageSize=7&page=3');
    expect(p1.body.items).toHaveLength(7);
    expect(p3.body.items).toHaveLength(6);
    expect((await m.get('/approvals?page=3')).body.items).toHaveLength(0);
    expectError(await m.get('/approvals?pageSize=101'), 400, 'validation_error');
    const c13 = r.body.items.find((i: any) => i.claimNumber === 'CLM-0013');
    const p13 = await pk(c13.id);
    expect(c13.pendingFindingsCount).toBe(p13.findings.filter((f: any) => f.needsHumanReview).length);
    expect(c13.pendingFindingsCount).toBeGreaterThan(0);
    expect(r.body.items.find((i: any) => i.claimNumber === 'CLM-0003').pendingFindingsCount).toBe(0);
    expect((await vw.get('/approvals')).status).toBe(200); // VIEWER may read the queue...
    expectError(await approve(vw, c13.id, 1), 403, 'forbidden'); // ...but cannot act
  });
});

describe('T-APR-01 reason requirement for R30-R33', () => {
  const bad: Array<[string, any]> = [
    ['missing', undefined], ['empty', ''], ['spaces', '          '], ['9 chars', '123456789'],
    ['10 spaces + 1 char', '          x'], ['2001 chars', 'x'.repeat(2001)],
  ];
  it('invalid reasons -> 400 on all four routes with no state or audit change', async () => {
    const id = await idOf('CLM-0011');
    const id16 = await idOf('CLM-0016'); // APPROVED: exercises send validation without consuming anything
    const before = await snap(id);
    const before16 = await snap(id16);
    for (const [label, reason] of bad) {
      const body = (b: object) => (reason === undefined ? b : { ...b, reason });
      const calls = await Promise.all([
        m.post(`/claims/${id}/packet/revisions`, body({ baseRevision: 1, demandLetter: 'letter for reason test' })),
        m.post(`/claims/${id}/packet/approve`, body({ packetRevision: 1 })),
        m.post(`/claims/${id}/packet/reject`, body({ packetRevision: 1 })),
        m.post(`/claims/${id16}/packet/send`, body({ packetRevision: 1 })),
      ]);
      for (const c of calls) expectError(c, 400, 'validation_error');
      void label;
    }
    expect(await snap(id)).toBe(before);
    expect(await snap(id16)).toBe(before16);
  }, 60000);
  it('boundary lengths 10 and 2000 are accepted', async () => {
    const id = await idOf('CLM-0011');
    const id12 = await idOf('CLM-0012');
    const e1 = await edit(m, id, 1, 'letter ten chars reason', '1234567890');
    expect(e1.status, e1.text).toBe(201);
    const e2 = await edit(m, id, 2, 'letter 2000 chars reason', 'y'.repeat(2000));
    expect(e2.status, e2.text).toBe(201);
    expectError(await edit(m, id, 3, 'letter', 'y'.repeat(2001)), 400, 'validation_error');
    const a = await approve(m, id12, 1, {}, '1234567890');
    expect(a.status, a.text).toBe(200);
    const s = await send(m, id12, 1, 'z'.repeat(2000));
    expect(s.status, s.text).toBe(200);
    const rj = await reject(m, id, 3, 'r'.repeat(2000));
    expect(rj.status, rj.text).toBe(200);
  });
});

describe('T-APR-02 approve', () => {
  it('REVIEWER approves CLM-0003: state, history, audit with content hash, queue membership', async () => {
    const id = await idOf('CLM-0003');
    const before = await pk(id);
    const reason = 'Approved after checking each cited source';
    const r = await approve(rv, id, 1, {}, reason);
    expect(r.status, r.text).toBe(200);
    expect(r.body.claim).toMatchObject({ id, status: 'APPROVED' });
    expect(r.body.packet).toMatchObject({ revision: 1, status: 'APPROVED' });
    const after = await pk(id);
    validatePacket(after);
    const rec = after.approvals[0];
    expect(rec).toMatchObject({ action: 'APPROVE', reason, fromStatus: 'PENDING_REVIEW', toStatus: 'APPROVED', packetRevision: 1 });
    expect(rec.actor.role).toBe('REVIEWER');
    expect(rec.actor.id).toBe(rv.user.id);
    const ev = (await allAudit(owner, 'action=approval.approved')).find((e) => e.actor?.id === rv.user.id && JSON.stringify(e.metadata).includes(before.integrity.contentHash));
    expect(ev, 'approval.approved with content hash in metadata').toBeTruthy();
    const pend = (await m.get('/approvals?status=PENDING_REVIEW&pageSize=100')).body.items;
    expect(pend.some((i: any) => i.claimNumber === 'CLM-0003')).toBe(false);
    expect((await m.get('/approvals?status=APPROVED&pageSize=100')).body.items.some((i: any) => i.claimNumber === 'CLM-0003')).toBe(true);
    expect(after.integrity.valid).toBe(true);
  });
});

describe('T-APR-03 pending findings acknowledgement', () => {
  it('CLM-0013 needs acknowledgePendingFindings:true; recoverable unchanged; CLM-0014 false is rejected', async () => {
    const id = await idOf('CLM-0013');
    const before = await pk(id);
    const listBefore = (await m.get(`/claims/${id}`)).body;
    expect(before.pendingReviewCents).toBeGreaterThan(0);
    const snapB = await snap(id);
    expectError(await approve(m, id, 1), 422, 'unprocessable');
    expectError(await approve(m, id, 1, { acknowledgePendingFindings: false }), 422, 'unprocessable');
    expect(await snap(id)).toBe(snapB);
    const ok = await approve(m, id, 1, { acknowledgePendingFindings: true });
    expect(ok.status, ok.text).toBe(200);
    const after = await pk(id);
    const listAfter = (await m.get(`/claims/${id}`)).body;
    expect(after.recoverableCents).toBe(before.recoverableCents);
    expect(listAfter.recoverableCents).toBe(listBefore.recoverableCents);
    expect(after.pendingReviewCents).toBe(before.pendingReviewCents);
    const sum = before.findings.filter((f: any) => !f.needsHumanReview && f.direction === (before.perspective === 'SHIPPER' ? 'OVERCHARGE' : 'UNDERBILLED')).reduce((a: number, f: any) => a + f.amountCents, 0);
    expect(after.recoverableCents).toBe(sum);
    const id14 = await idOf('CLM-0014');
    expectError(await send(m, id14, 1), 409, 'invalid_state'); // T-APR-06: send on a PENDING_REVIEW claim
    expectError(await approve(m, id14, 1, { acknowledgePendingFindings: false }), 422, 'unprocessable');
    expect((await approve(m, id14, 1, { acknowledgePendingFindings: true })).status).toBe(200);
  });
});

describe('T-APR-04 reject then edit', () => {
  it('CLM-0004: REJECTED is terminal for approve, edit creates revision 2', async () => {
    const id = await idOf('CLM-0004');
    const r = await reject(m, id, 1, 'Rejected: carrier evidence is inconclusive');
    expect(r.status, r.text).toBe(200);
    expect(r.body.claim.status).toBe('REJECTED');
    expectError(await approve(m, id, 1), 409, 'invalid_state');
    const e = await edit(m, id, 1, 'Second attempt at the demand letter', 'Edit after rejection to address gaps');
    expect(e.status, e.text).toBe(201);
    expect(e.body.claim.status).toBe('PENDING_REVIEW');
    expect(e.body.packet).toMatchObject({ revision: 2, status: 'PENDING_REVIEW' });
    expect((await pk(id, '?revision=1')).status).toBe('SUPERSEDED');
    expect((await m.get(`/claims/${id}`)).body.status).toBe('PENDING_REVIEW');
  });
});

describe('T-APR-05 edit chain on CLM-0005', () => {
  it('edit -> stale handling -> approve -> edit invalidates approval -> re-approve -> send-ready', async () => {
    const id = await idOf('CLM-0005');
    const p1 = await pk(id);
    const letter = 'Edited letter\u0007 with\u0000 control chars\nand a second line';
    const e = await edit(m, id, 1, letter, 'Tighten the wording of the demand');
    expect(e.status, e.text).toBe(201);
    expect(e.body.packet.revision).toBe(2);
    expect(e.body.packet.status).toBe('PENDING_REVIEW');
    const p2 = await pk(id);
    const p1again = await pk(id, '?revision=1');
    validatePacket(p2);
    expect(p2.integrity.valid).toBe(true);
    expect(p1again.integrity.valid).toBe(true);
    expect(p2.integrity.contentHash).not.toBe(p1.integrity.contentHash);
    expect(p2.demandLetter).toBe('Edited letter with control chars\nand a second line');
    const strip = (o: any): any => JSON.parse(JSON.stringify(o, (k, v) => (k === 'id' || k === 'sourceId' ? undefined : v)));
    expect(strip(p2.sources)).toEqual(strip(p1.sources));
    expect(strip(p2.timeline)).toEqual(strip(p1.timeline));
    expect(strip(p2.findings)).toEqual(strip(p1.findings));
    expect(p2.verifier.status).toBe('NOT_RUN');
    expectError(await edit(m, id, 1), 409, 'stale_revision');
    expectError(await approve(m, id, 1), 409, 'stale_revision');
    expect((await approve(m, id, 2)).status).toBe(200);
    const e3 = await edit(m, id, 2, 'Third revision after approval', 'Reopen after approval to change wording');
    expect(e3.status, e3.text).toBe(201);
    expect(e3.body.packet.revision).toBe(3);
    expectError(await send(m, id, 2), 409, 'stale_revision');
    expect((await m.get(`/claims/${id}`)).body.status).toBe('PENDING_REVIEW');
    expect((await approve(m, id, 3)).status).toBe(200);
    const s = await send(m, id, 3);
    expect(s.status, s.text).toBe(200);
    expect(s.body.claim.status).toBe('SEND_READY');
    expect(s.body.delivery).toEqual({ sent: false, mode: 'send_ready_only' });
  });
});

describe('T-APR-06 send rules and terminal SEND_READY', () => {
  it('send rules across states and roles', async () => {
    const c15 = await idOf('CLM-0015');
    const c19 = await idOf('CLM-0019');
    const c22 = await idOf('CLM-0022');
    for (const s of [rv, an, vw]) expectError(await send(s, c15, 1), 403, 'forbidden');
    expect((await m.get(`/claims/${c15}`)).body.status).toBe('APPROVED'); // unchanged by denied calls
    const ok = await send(m, c15, 1);
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.claim.status).toBe('SEND_READY');
    expectError(await send(m, c15, 1), 409, 'invalid_state'); // again
    expectError(await send(m, c19, 1), 409, 'invalid_state'); // REJECTED
    for (const id of [c22, c15]) {
      expectError(await send(m, id, 1), 409, 'invalid_state');
      expectError(await approve(m, id, 1), 409, 'invalid_state');
      expectError(await reject(m, id, 1), 409, 'invalid_state');
      expectError(await edit(m, id, 1), 409, 'invalid_state');
      expect((await m.get(`/claims/${id}`)).body.status).toBe('SEND_READY');
    }
    const c16 = await idOf('CLM-0016');
    expectError(await approve(m, c16, 1), 409, 'invalid_state');
    expectError(await reject(m, c16, 1), 409, 'invalid_state');
    expectError(await approve(m, c19, 1), 409, 'invalid_state');
    expectError(await reject(m, c19, 1), 409, 'invalid_state');
  });
});

describe('T-APR-07 nothing is transmitted', () => {
  it('no outbox row, no outbound connection, no delivery identifiers; works with dev outbox disabled', async () => {
    const hits: string[] = [];
    const srv = createServer((sock) => {
      hits.push('connection');
      sock.destroy();
    });
    await new Promise<void>((res) => srv.listen(0, '127.0.0.1', res));
    const port = (srv.address() as any).port;
    const proxy = `http://127.0.0.1:${port}`;
    const sentinel = await buildTestApp({ ENABLE_DEV_OUTBOX: 'false', HTTPS_PROXY: proxy, HTTP_PROXY: proxy, https_proxy: proxy, http_proxy: proxy, LOCKOUT_THRESHOLD: '50' });
    try {
      const mgr = await login(sentinel, 'manager@acme.test');
      const id = await idOf('CLM-0016');
      const outboxN = async () => withAdmin(async (c) => (await c.query(`select count(*)::int n from mail_outbox`)).rows[0].n);
      const n0 = await outboxN();
      const r = await send(mgr, id, 1);
      expect(r.status, r.text).toBe(200);
      expect(r.body.delivery).toEqual({ sent: false, mode: 'send_ready_only' });
      for (const k of deepKeys(r.body)) expect(/messageid|url|smtp/i.test(k), `key ${k}`).toBe(false);
      expect(await outboxN()).toBe(n0);
      expect((await new Client(sentinel).get('/dev/outbox?to=a%40b.test')).status).toBe(404); // dev outbox really is off
      await new Promise((r2) => setTimeout(r2, 300));
      expect(hits).toEqual([]);
    } finally {
      srv.close();
    }
  });
});

describe('T-APR-08 concurrency', () => {
  it('10 parallel edits -> one 201; parallel approves -> one 200; approve vs reject -> one wins; audit chain valid', async () => {
    const id = await idOf('CLM-0006');
    const revs0 = (await pk(id)).revision;
    const edits = await Promise.all(Array.from({ length: 10 }, (_, i) => edit(m, id, revs0, `parallel edit ${i}`, 'parallel edit race reason')));
    expect(edits.filter((r) => r.status === 201)).toHaveLength(1);
    const losers = edits.filter((r) => r.status !== 201);
    expect(losers).toHaveLength(9);
    for (const l of losers) expectError(l, 409, 'stale_revision');
    const p = await pk(id);
    expect(p.revision).toBe(revs0 + 1);
    const two = await Promise.all([approve(m, id, p.revision), approve(rv, id, p.revision)]);
    expect(two.map((r) => r.status).sort()).toEqual([200, 409]);
    const e = await edit(m, id, p.revision, 'fresh pending revision', 'reopen for approve/reject race');
    expect(e.status, e.text).toBe(201);
    const rev3 = e.body.packet.revision;
    const race = await Promise.all([approve(m, id, rev3), reject(rv, id, rev3)]);
    expect(race.filter((r) => r.status === 200)).toHaveLength(1);
    expect(race.filter((r) => r.status === 409)).toHaveLength(1);
    const fin = await pk(id);
    expect(['APPROVED', 'REJECTED']).toContain(fin.status);
    const accepted = fin.approvals.filter((a: any) => a.packetRevision === rev3 && a.action !== 'EDIT');
    expect(accepted).toHaveLength(1);
    expect(fin.approvals.filter((a: any) => a.action === 'EDIT' && a.packetRevision >= revs0)).toHaveLength(2); // one per accepted edit (the race winner and the explicit edit)
    expect((await owner.get('/audit/verify')).body.valid).toBe(true);
    const c6 = await withAdmin(async (c) => (await c.query(`select count(*)::int n from evidence_packets p join claims cl on cl.id=p.claim_id where cl.claim_number='CLM-0006' and p.status<>'SUPERSEDED'`)).rows[0].n);
    expect(c6).toBe(1); // at most one live revision
  }, 60000);
});

describe('T-APR-09 approval is bound to content', () => {
  it('tampered stored letter blocks send-ready until restored', async () => {
    const id = await idOf('CLM-0007');
    expect((await approve(m, id, 1)).status).toBe(200);
    const row = await withAdmin(async (c) => (await c.query(`select p.id, p.demand_letter from evidence_packets p join claims cl on cl.id=p.claim_id where cl.claim_number='CLM-0007' and p.revision=1`)).rows[0]);
    try {
      await withTriggersOff(['evidence_packets'], (c) => c.query(`update evidence_packets set demand_letter = demand_letter || ' TAMPERED' where id=$1`, [row.id]));
      expectError(await send(m, id, 1), 409);
      expect((await m.get(`/claims/${id}`)).body.status).toBe('APPROVED');
    } finally {
      await withTriggersOff(['evidence_packets'], (c) => c.query(`update evidence_packets set demand_letter=$2 where id=$1`, [row.id, row.demand_letter]));
    }
    const ok = await send(m, id, 1);
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.claim.status).toBe('SEND_READY');
  });
});

describe('T-APR-10 RBAC probes on CLM-0008..0010', () => {
  it('ANALYST/VIEWER cannot approve, reject, edit or send; REVIEWER cannot send; MANAGER can do all four', async () => {
    const [c8, c9, c10] = [await idOf('CLM-0008'), await idOf('CLM-0009'), await idOf('CLM-0010')];
    const before = [await snap(c8), await snap(c9), await snap(c10)];
    for (const s of [an, vw]) {
      for (const id of [c8, c9, c10]) {
        expectError(await approve(s, id, 1), 403, 'forbidden');
        expectError(await reject(s, id, 1), 403, 'forbidden');
        expectError(await edit(s, id, 1), 403, 'forbidden');
        expectError(await send(s, id, 1), 403, 'forbidden');
      }
    }
    expectError(await send(rv, c8, 1), 403, 'forbidden');
    expect([await snap(c8), await snap(c9), await snap(c10)]).toEqual(before);
    expect((await approve(m, c8, 1)).status).toBe(200);
    expectError(await send(rv, c8, 1), 403, 'forbidden'); // reviewer still cannot send an approved revision
    expect((await send(m, c8, 1)).status).toBe(200);
    expect((await reject(m, c9, 1)).status).toBe(200);
    expect((await edit(m, c10, 1)).status).toBe(201);
  });
});