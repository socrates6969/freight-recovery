/* eslint-disable */
// T-COMMIT COM-01..11: claims from approved extractions. Re-seeds at the end (imports create claims in the shared tenant).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, Client, buildTestApp, claimId, claimIndex, closeApps, expectError, sessionFor, type Session } from './helpers/client.js';
import * as H from './helpers/imp.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
let an: Session, rev: Session, mgr: Session, admin: Session, owner: Session, viewer: Session, gxMgr: Session;
let baseline: Record<string, number> = {};
const S = (s: string) => Buffer.from(s, 'utf8');
const num = (n: string) => Number(n.replace(/\D/g, ''));
const STATUSES = ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SEND_READY'];
const counts = async (s: Session) => Object.fromEntries(await Promise.all(STATUSES.map(async (st) => [st, (await s.get(`/claims?status=${st}&pageSize=1`)).body.total])));

beforeAll(async () => {
  await H.assertS3Reachable();
  app = await buildTestApp();
  an = H.wrap(await sessionFor(app, ACCOUNTS.ANALYST));
  rev = H.wrap(await sessionFor(app, ACCOUNTS.REVIEWER));
  mgr = H.wrap(await sessionFor(app, ACCOUNTS.MANAGER));
  admin = H.wrap(await sessionFor(app, ACCOUNTS.ADMIN));
  owner = H.wrap(await sessionFor(app, ACCOUNTS.OWNER));
  viewer = H.wrap(await sessionFor(app, ACCOUNTS.VIEWER));
  gxMgr = H.wrap(await sessionFor(app, 'manager@globex.test'));
  baseline = await counts(mgr);
});
afterAll(async () => {
  try { H.assertRecorded('imp-commit'); } finally { await closeApps(); reseed(); }
});

/** One batch with an accepted invoice, rate confirmation and BOL of the given load. */
async function loadBatch(s: Session, load: string, o: { carrier?: string; invoice?: string; docs?: ('inv' | 'rc' | 'bol')[] } = {}) {
  const b = await H.newBatch(s);
  const out: any[] = [];
  const which = o.docs ?? ['inv', 'rc', 'bol'];
  if (which.includes('inv')) out.push(await H.putOk(s, b, 'invoice.txt', S(H.invoiceTxt(load, { carrier: o.carrier, invoice: o.invoice }))));
  if (which.includes('rc')) out.push(await H.putOk(s, b, 'rate_confirmation.txt', S(H.rateTxt(load))));
  if (which.includes('bol')) out.push(await H.putOk(s, b, 'bol.txt', S(H.bolTxt(load))));
  for (const d of out) expect(d.status, `${d.displayName}: ${d.reviewReasons}`).toBe('ACCEPTED');
  return { b, docs: out };
}
const getClaim = async (s: Session, id: string) => (await s.get(`/claims/${id}`)).body;

describe('COM-01 create', () => {
  it('three ACCEPTED documents of one load, commit SHIPPER -> one AWAITING_ANALYSIS claim with the documents linked', async () => {
    const idx = await claimIndex(mgr);
    const maxNo = Math.max(...[...idx.keys()].map(num));
    const load = H.uniqLoad('C1');
    const { b, docs } = await loadBatch(an, load);
    const r = await H.commit(an, b, 'SHIPPER');
    expect(r.status, r.text).toBe(200);
    expect(r.body.created).toHaveLength(1);
    expect(r.body.updated).toEqual([]);
    expect(r.body.skipped).toEqual([]);
    const c = r.body.created[0];
    expect(c.claimNumber).toMatch(/^CLM-[0-9]{4,}$/);
    expect(num(c.claimNumber)).toBeGreaterThan(maxNo);
    expect(c.loadNumber).toBe(load);
    const claim = await getClaim(mgr, c.claimId);
    expect(claim).toMatchObject({ status: 'AWAITING_ANALYSIS', latestPacket: null, amountClaimedCents: 0, recoverableCents: 0, pendingReviewCents: 0, perspective: 'SHIPPER', invoiceNumber: 'INV-1001', carrierName: 'Acme Freight LLC', shipperName: 'Widget Co' });
    expect(String(claim.invoiceDate).startsWith('2025-03-10'), 'invoiceDate ' + claim.invoiceDate).toBe(true);
    const dl = await mgr.get(`/claims/${c.claimId}/documents`);
    expect(dl.status, dl.text).toBe(200);
    expect(dl.body.items).toHaveLength(3);
    for (const it of dl.body.items) {
      expect(Object.keys(it).sort()).toEqual(['detectedType', 'displayName', 'docType', 'id', 'linkedAt', 'sha256', 'sizeBytes', 'status']);
      expect(it.status).toBe('ACCEPTED');
      expect(docs.some((d) => d.sha256 === it.sha256 && d.docType === it.docType)).toBe(true);
    }
    expect(dl.text).not.toMatch(/storage|imports\/|2118\.00|1500\.00/);
    for (const q of [`status=AWAITING_ANALYSIS&q=${load}`, `q=${load}`]) {
      const f = await mgr.get(`/claims?${q}`);
      expect(f.body.items.map((i: any) => i.id)).toContain(c.claimId);
    }
  });
});

describe('COM-02 behaviour of claims without a packet', () => {
  it('packet 404; edit/approve/reject/send 409 invalid_state (never 500); not in /approvals; seeded counts unchanged', async () => {
    const { b } = await loadBatch(an, H.uniqLoad('C2'));
    const id = (await H.commit(an, b)).body.created[0].claimId;
    expectError(await mgr.get(`/claims/${id}/packet`), 404, 'not_found');
    const body = { packetRevision: 1, reason: 'no packet exists for this probe' };
    for (const s of [mgr, rev]) {
      expectError(await s.post(`/claims/${id}/packet/revisions`, { baseRevision: 1, demandLetter: 'Draft demand letter text for probe.', reason: 'no packet exists for this probe' }), 409, 'invalid_state');
      expectError(await s.post(`/claims/${id}/packet/approve`, body), 409, 'invalid_state');
      expectError(await s.post(`/claims/${id}/packet/reject`, body), 409, 'invalid_state');
    }
    expectError(await mgr.post(`/claims/${id}/packet/send`, body), 409, 'invalid_state');
    const ap = await mgr.get('/approvals?pageSize=100');
    expect(ap.body.items.map((i: any) => i.id)).not.toContain(id);
    expect(await counts(mgr)).toEqual(baseline);
    const aw = await mgr.get('/claims?status=AWAITING_ANALYSIS&pageSize=100');
    expect(aw.body.items.every((i: any) => i.latestPacket === null)).toBe(true);
  });
});

describe('COM-03 idempotence, COM-04 skips', () => {
  it('a second identical commit changes nothing and reports already_linked', async () => {
    const { b, docs } = await loadBatch(an, H.uniqLoad('C3'));
    const first = await H.commit(an, b);
    const total0 = (await mgr.get('/claims?pageSize=1')).body.total;
    const second = await H.commit(an, b);
    expect(second.status, second.text).toBe(200);
    expect(second.body.created).toEqual([]);
    expect(second.body.updated).toEqual([]);
    expect(second.body.skipped.map((s: any) => s.reason)).toEqual(docs.map(() => 'already_linked'));
    expect(new Set(second.body.skipped.map((s: any) => s.documentId))).toEqual(new Set(docs.map((d) => d.id)));
    expect((await mgr.get('/claims?pageSize=1')).body.total).toBe(total0);
    expect(first.body.created).toHaveLength(1);
  });
  it('NEEDS_REVIEW and REJECTED documents are skipped not_accepted; accepting later and committing again links them', async () => {
    const load = H.uniqLoad('C4');
    const { b } = await loadBatch(an, load, { docs: ['inv', 'bol'] });
    const pdf = await H.putOk(an, b, 'rc.pdf', H.buildPdf(['DOCUMENT: RATE CONFIRMATION', `Load Number: ${load}`, 'Linehaul Rate: 1400.00']));
    const bad = await H.putOk(an, b, 'x.png', H.buildPng({ trailing: S('trailing') }));
    expect(pdf.status).toBe('NEEDS_REVIEW');
    expect(bad.status).toBe('REJECTED');
    const c1 = await H.commit(an, b);
    expect(c1.body.created).toHaveLength(1);
    expect(c1.body.skipped).toContainEqual({ documentId: pdf.id, reason: 'not_accepted' });
    expect(c1.body.skipped).toContainEqual({ documentId: bad.id, reason: 'not_accepted' });
    const id = c1.body.created[0].claimId;
    expect((await mgr.get(`/claims/${id}/documents`)).body.items).toHaveLength(2);
    expect((await H.acceptDoc(rev, b, pdf.id)).status).toBe(200);
    const c2 = await H.commit(an, b);
    expect(c2.body.created).toEqual([]);
    expect(c2.body.updated.map((u: any) => u.claimId)).toEqual([id]);
    expect(c2.body.updated[0].note).toBe('documents_linked');
    expect((await mgr.get(`/claims/${id}/documents`)).body.items).toHaveLength(3);
  });
});

describe('COM-05 grouping and matching', () => {
  it('two loads in one batch -> two claims; the other perspective -> a separate claim', async () => {
    const b = await H.newBatch(an);
    const l1 = H.uniqLoad('C5'), l2 = H.uniqLoad('C5');
    await H.putOk(an, b, 'i1.txt', S(H.invoiceTxt(l1)));
    await H.putOk(an, b, 'i2.txt', S(H.invoiceTxt(l2, { invoice: 'INV-2' })));
    const r = await H.commit(an, b, 'SHIPPER');
    expect(r.body.created.map((c: any) => c.loadNumber).sort()).toEqual([l1, l2].sort());
    const b2 = await H.newBatch(an);
    await H.putOk(an, b2, 'i3.txt', S(H.invoiceTxt(l1, { invoice: 'INV-3' })));
    const carrier = await H.commit(an, b2, 'CARRIER');
    expect(carrier.body.created).toHaveLength(1);
    expect(carrier.body.created[0].claimId).not.toBe(r.body.created.find((c: any) => c.loadNumber === l1).claimId);
    expect((await getClaim(mgr, carrier.body.created[0].claimId)).perspective).toBe('CARRIER');
  });
  it('a later batch with the same load and perspective -> updated documents_linked; empty fields filled, filled fields and amounts never overwritten', async () => {
    const load = H.uniqLoad('C5');
    const first = await loadBatch(an, load, { docs: ['rc', 'bol'] });
    const c1 = await H.commit(an, first.b);
    const id = c1.body.created[0].claimId;
    const before = await getClaim(mgr, id);
    expect(before.invoiceNumber ?? null).toBeNull();
    const second = await loadBatch(an, load, { docs: ['inv'], invoice: 'INV-FIRST' });
    const c2 = await H.commit(an, second.b);
    expect(c2.body.created).toEqual([]);
    expect(c2.body.updated).toContainEqual({ claimId: id, claimNumber: before.claimNumber, loadNumber: load, note: 'documents_linked' });
    const mid = await getClaim(mgr, id);
    expect(mid.invoiceNumber).toBe('INV-FIRST');
    const third = await loadBatch(an, load, { docs: ['inv'], invoice: 'INV-SECOND', carrier: 'Other Carrier Inc' });
    await H.commit(an, third.b);
    const after = await getClaim(mgr, id);
    expect(after.invoiceNumber).toBe('INV-FIRST');
    expect(after.carrierName).toBe(mid.carrierName);
    expect([after.amountClaimedCents, after.recoverableCents, after.pendingReviewCents]).toEqual([0, 0, 0]);
    expect((await mgr.get(`/claims/${id}/documents`)).body.items).toHaveLength(4);
  });
  it('load numbers differing only in case and surrounding/inner whitespace map to one claim', async () => {
    const tag = H.uniqLoad('C5').replace(/-/g, ' ');
    const variants = [tag, tag.toLowerCase(), ` ${tag} `, tag.replace(/ /g, '  ')];
    const ids = new Set<string>();
    let created = 0;
    for (const v of variants) {
      const b = await H.newBatch(an);
      const d = await H.putOk(an, b, 'bol.txt', S(`DOCUMENT: BILL OF LADING\nLoad Number: ${v}\nFacility: Dock ${ids.size}\n`));
      expect(d.status).toBe('ACCEPTED');
      const r = await H.commit(an, b);
      created += r.body.created.length;
      for (const x of [...r.body.created, ...r.body.updated]) ids.add(x.claimId);
    }
    expect(created).toBe(1);
    expect(ids.size).toBe(1);
  });
});

describe('COM-06 existing claim with a packet', () => {
  it('real ld5001 files committed SHIPPER -> CLM-0001 updated new_evidence_not_in_packet; status, revision, hash and amounts unchanged', async () => {
    const id = await claimId(mgr, 'CLM-0001');
    const c0 = await getClaim(mgr, id);
    const p0 = (await mgr.get(`/claims/${id}/packet`)).body;
    const b = await H.newBatch(an);
    for (const f of ['ld5001/bol.txt', 'ld5001/invoice.txt', 'ld5001/rate_confirmation.txt']) {
      const d = await H.putOk(an, b, H.base(f), H.FIX(f));
      if (d.status !== 'ACCEPTED') expect((await H.acceptDoc(rev, b, d.id)).status).toBe(200);
    }
    const r = await H.commit(an, b, 'SHIPPER');
    expect(r.status, r.text).toBe(200);
    expect(r.body.created).toEqual([]);
    const u = r.body.updated.find((x: any) => x.claimNumber === 'CLM-0001');
    expect(u, JSON.stringify(r.body)).toBeTruthy();
    expect(u.note).toBe('new_evidence_not_in_packet');
    const c1 = await getClaim(mgr, id);
    const p1 = (await mgr.get(`/claims/${id}/packet`)).body;
    expect(c1.status).toBe(c0.status);
    expect([c1.amountClaimedCents, c1.recoverableCents, c1.pendingReviewCents]).toEqual([c0.amountClaimedCents, c0.recoverableCents, c0.pendingReviewCents]);
    expect(c1.latestPacket).toEqual(c0.latestPacket);
    expect(p1.revision).toBe(p0.revision);
    expect(p1.integrity.contentHash).toBe(p0.integrity.contentHash);
    expect((await mgr.get(`/claims/${id}/documents`)).body.items).toHaveLength(3);
  });
});

describe('COM-07 tenancy', () => {
  it('the same load imported by Globex creates a Globex claim; no Acme claim changes; documents are never linked across tenants', async () => {
    const load = H.uniqLoad('C7');
    const a = await loadBatch(an, load);
    const ca = (await H.commit(an, a.b)).body.created[0];
    const acmeBefore = await getClaim(mgr, ca.claimId);
    const g = await loadBatch(gxMgr, load, { carrier: 'Globex Carrier Co' });
    const cg = await H.commit(gxMgr, g.b);
    expect(cg.status, cg.text).toBe(200);
    expect(cg.body.created).toHaveLength(1);
    expect(cg.body.created[0].claimId).not.toBe(ca.claimId);
    expect(await getClaim(mgr, ca.claimId)).toEqual(acmeBefore);
    const gDocs = (await gxMgr.get(`/claims/${cg.body.created[0].claimId}/documents`)).body.items;
    const aDocs = (await mgr.get(`/claims/${ca.claimId}/documents`)).body.items;
    expect(gDocs).toHaveLength(3);
    expect(aDocs).toHaveLength(3);
    expect(gDocs.map((d: any) => d.id).filter((id: string) => aDocs.some((x: any) => x.id === id))).toEqual([]);
    expectError(await gxMgr.get(`/claims/${ca.claimId}/documents`), 404, 'not_found');
    expectError(await H.commit(gxMgr, a.b), 404, 'not_found');
  });
});

describe('COM-08 concurrency', () => {
  it('five concurrent commits of five batches create five claims with distinct numbers; two commits of the SAME batch create each claim once', async () => {
    const batches: Awaited<ReturnType<typeof loadBatch>>[] = [];
    for (let i = 0; i < 5; i++) batches.push(await loadBatch(an, H.uniqLoad('C8')));
    const rs = await Promise.all(batches.map((x) => H.commit(an, x.b)));
    for (const r of rs) expect(r.status, r.text).toBe(200);
    const nums = rs.flatMap((r) => r.body.created.map((c: any) => c.claimNumber));
    expect(nums).toHaveLength(5);
    expect(new Set(nums).size).toBe(5);
    const same = await loadBatch(an, H.uniqLoad('C8'));
    const two = await Promise.all([H.commit(an, same.b), H.commit(an, same.b)]);
    for (const r of two) expect(r.status, r.text).toBe(200);
    expect(two.flatMap((r) => r.body.created)).toHaveLength(1);
    const claims = await mgr.get(`/claims?q=${encodeURIComponent(same.docs[0].loadNumber)}`);
    expect(claims.body.total).toBe(1);
  });
});

describe('COM-09 hostile text flows', () => {
  it('carrier with bidi overrides, control characters, <script> and 190 chars becomes plain, sanitized claim text', async () => {
    const hostile = `Acme${String.fromCharCode(0x202e)}gnp${String.fromCharCode(0x2066)}x${String.fromCharCode(0x86)} <script>alert(1)</script> ${'Z'.repeat(190)}`;
    const load = H.uniqLoad('C9');
    const b = await H.newBatch(an);
    const d = await H.putOk(an, b, 'inv.txt', S(`DOCUMENT: FREIGHT INVOICE\nInvoice Number: INV-C9\nCarrier: ${hostile}\nShipper: Widget Co\nLoad Number: ${load}\nCharge: Linehaul | 5.00\n`));
    if (d.status !== 'ACCEPTED') expect((await H.acceptDoc(rev, b, d.id)).status).toBe(200);
    const c = await H.commit(an, b);
    expect(c.status, c.text).toBe(200);
    const claim = await getClaim(mgr, c.body.created[0].claimId);
    expect(typeof claim.carrierName).toBe('string');
    expect(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u200b-\u200f]/.test(claim.carrierName)).toBe(false);
    expect([...claim.carrierName].length).toBeLessThanOrEqual(200);
  });
});

describe('COM-10 RBAC, COM-11 audit', () => {
  it('ANALYST, REVIEWER, MANAGER, ADMIN, OWNER may commit; VIEWER 403; foreign batch 404', async () => {
    for (const s of [an, rev, mgr, admin, owner]) {
      const { b } = await loadBatch(s, H.uniqLoad('C10'), { docs: ['bol'] });
      const r = await H.commit(s, b);
      expect(r.status, `${s.email}: ${r.text}`).toBe(200);
    }
    const { b } = await loadBatch(an, H.uniqLoad('C10'), { docs: ['bol'] });
    expectError(await H.commit(viewer, b), 403, 'forbidden');
    expectError(await new Client(app).post(`/imports/${b}/commit`, { perspective: 'SHIPPER' }), 401);
    expectError(await H.commit(gxMgr, b), 404, 'not_found');
    expectError(await an.post(`/imports/${b}/commit`, { perspective: 'BOTH' }), 400, 'validation_error');
    expectError(await an.post(`/imports/${b}/commit`, { perspective: 'SHIPPER', extra: 1 }), 400, 'validation_error');
  });
  it('import.committed, claim.created_from_import and claim.documents_linked exist with ids only; the chain verifies', async () => {
    const seq = await H.lastSeq(owner);
    const load = H.uniqLoad('C11');
    const a = await loadBatch(an, load, { docs: ['bol'] });
    await H.commit(an, a.b);
    const b = await loadBatch(an, load, { docs: ['rc'] });
    await H.commit(an, b.b);
    const ev = await H.auditSince(owner, seq);
    const names = ev.map((e) => e.action);
    for (const n of ['import.committed', 'claim.created_from_import', 'claim.documents_linked']) expect(names, n).toContain(n);
    for (const e of ev.filter((x) => /^(import\.committed|claim\.created_from_import|claim\.documents_linked)$/.test(x.action))) {
      const m = JSON.stringify(e.metadata ?? {});
      expect(m).not.toContain(load);
      expect(m).not.toMatch(/Acme Freight|Widget Co|INV-/);
    }
    const v = await owner.get('/audit/verify');
    expect(v.body.valid).toBe(true);
  });
});
