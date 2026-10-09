/* eslint-disable */
// T-REV REV-01..08: review queue and resolution.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, Client, buildTestApp, closeApps, expectError, sessionFor, type Session } from './helpers/client.js';
import * as H from './helpers/imp.js';

let app: FastifyInstance;
let an: Session, rev: Session, mgr: Session, admin: Session, owner: Session, viewer: Session, gxMgr: Session;
let tenantId = '';
let seq0 = 0;
const S = (s: string) => Buffer.from(s, 'utf8');
const REASON = 'Checked against the source document';

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
  tenantId = H.tenantIdOf(an);
  seq0 = await H.lastSeq(owner);
});
afterAll(async () => {
  try { H.assertRecorded('imp-review'); } finally { await closeApps(); }
});

const rcLines = (load: string) => ['DOCUMENT: RATE CONFIRMATION', `Load Number: ${load}`, 'Carrier: Acme Freight LLC', 'Linehaul Rate: 1400.00', 'Fuel Surcharge: 168.00', 'Detention Free Hours: 2', 'Detention Rate Per Hour: 50.00', 'Detention Max Hours: 8', 'Authorized Accessorials: Detention'];
/** Text-layer PDF -> 8 fields, all flagged (0.85), NEEDS_REVIEW. */
async function flaggedPdf(tag = 'RV', s: Session = an) {
  const batchId = await H.newBatch(s);
  const doc = await H.putOk(s, batchId, 'rc.pdf', H.buildPdf(rcLines(H.uniqLoad(tag))));
  expect(doc.status).toBe('NEEDS_REVIEW');
  return { batchId, doc };
}
const resolve = (s: Session, b: string, d: string, f: string, body: any) => s.post(`/imports/${b}/documents/${d}/fields/${f}/resolve`, body);
const detail = async (s: Session, b: string, d: string) => (await s.get(`/imports/${b}/documents/${d}`)).body;
const fidOf = (doc: any, key: string) => doc.fields.find((f: any) => f.key === key).id as string;
async function queueIds(s: Session): Promise<{ ids: string[]; items: any[] }> {
  const items: any[] = [];
  for (let p = 1; p < 30; p++) {
    const r = await s.get(`/reviews?page=${p}&pageSize=100`);
    expect(r.status, r.text).toBe(200);
    items.push(...r.body.items);
    if (r.body.items.length < 100) break;
  }
  return { ids: items.map((i) => i.documentId), items };
}

describe('REV-01 queue', () => {
  it('a PDF-derived document is queued for REVIEWER/MANAGER/ADMIN/OWNER with the right counts, oldest first; others are denied', async () => {
    const { batchId, doc } = await flaggedPdf('Q1');
    for (const s of [rev, mgr, admin, owner]) {
      const q = await queueIds(s);
      const it = q.items.find((i) => i.documentId === doc.id);
      expect(it, 'item in queue').toBeTruthy();
      expect(it.unresolvedFlaggedCount).toBe(doc.flaggedFieldCount);
      expect(it.flaggedFieldCount).toBe(doc.flaggedFieldCount);
      expect(it.batchId).toBe(batchId);
      expect(it.docType).toBe('RATE_CONFIRMATION');
      const w = q.items.map((i) => Date.parse(i.waitingSince));
      for (let i = 1; i < w.length; i++) expect(w[i]!).toBeGreaterThanOrEqual(w[i - 1]!);
    }
    for (const s of [an, viewer]) expectError(await s.get('/reviews'), 403, 'forbidden');
    expectError(await new Client(app).get('/reviews'), 401);
    for (const acct of ['dev@platform.test', 'super@platform.test']) expectError(await (await sessionFor(app, acct)).get('/reviews'), 403, 'forbidden');
    expect((await queueIds(gxMgr)).ids).not.toContain(doc.id);
    expectError(await rev.get('/reviews?pageSize=101'), 400, 'validation_error');
  });
  it('accepted and rejected documents leave the queue', async () => {
    const a = await flaggedPdf('Q2'), b = await flaggedPdf('Q3');
    expect((await H.acceptDoc(rev, a.batchId, a.doc.id)).status).toBe(200);
    expect((await rev.post(`/imports/${b.batchId}/documents/${b.doc.id}/reject`, { reason: REASON })).status).toBe(200);
    const q = (await queueIds(rev)).ids;
    expect(q).not.toContain(a.doc.id);
    expect(q).not.toContain(b.doc.id);
  });
});

describe('REV-02 resolve', () => {
  it('CONFIRM: field CONFIRMED, resolvedBy = the reviewer, decision row with the reason (newest first)', async () => {
    const { batchId, doc } = await flaggedPdf('R1');
    const f = fidOf(doc, 'rate_confirmation.linehaul_rate');
    const r = await resolve(rev, batchId, doc.id, f, { action: 'CONFIRM', reason: REASON });
    expect(r.status, r.text).toBe(200);
    expect(r.body.status).toBe('CONFIRMED');
    expect(r.body.resolvedBy).toMatchObject({ id: rev.user.id, name: rev.user.name, role: 'REVIEWER' });
    expect(Date.parse(r.body.resolvedAt)).toBeGreaterThan(0);
    const d = await detail(rev, batchId, doc.id);
    expect(d.decisions[0]).toMatchObject({ action: 'CONFIRM', fieldId: f, reason: REASON });
    expect(d.unresolvedFlaggedCount).toBe(doc.unresolvedFlaggedCount - 1);
  });
  it('CORRECT with valid input is canonicalised; original value unchanged; REJECT -> effectiveValue null', async () => {
    const { batchId, doc } = await flaggedPdf('R2');
    const c1 = await resolve(rev, batchId, doc.id, fidOf(doc, 'rate_confirmation.linehaul_rate'), { action: 'CORRECT', correctedValue: '$1,234.50', reason: REASON });
    expect(c1.status, c1.text).toBe(200);
    expect(c1.body).toMatchObject({ status: 'CORRECTED', correctedValue: '1234.50', effectiveValue: '1234.50', value: '1400.00' });
    const c2 = await resolve(rev, batchId, doc.id, fidOf(doc, 'rate_confirmation.authorized_accessorials'), { action: 'CORRECT', correctedValue: 'A, B', reason: REASON });
    expect(c2.body.correctedValue).toBe('["A","B"]');
    const rj = await resolve(rev, batchId, doc.id, fidOf(doc, 'rate_confirmation.carrier'), { action: 'REJECT', reason: REASON });
    expect(rj.body).toMatchObject({ status: 'REJECTED', effectiveValue: null });
  });
  it('CORRECT of a datetime: 03/04/2025 08:30 -> 2025-03-04T08:30:00', async () => {
    const b = await H.newBatch(an);
    const bol = await H.putOk(an, b, 'bol.pdf', H.buildPdf(['DOCUMENT: BILL OF LADING', `Load Number: ${H.uniqLoad('R3')}`, 'Appointment Time: 2025-03-03 08:00']));
    const r = await resolve(rev, b, bol.id, fidOf(bol, 'bol.appointment_time'), { action: 'CORRECT', correctedValue: '03/04/2025 08:30', reason: REASON });
    expect(r.body.correctedValue).toBe('2025-03-04T08:30:00');
  });
});

describe('REV-02 resolve (validation and state)', () => {
  it('invalid corrected values and malformed requests -> 400; unknown ids -> 404; second resolve -> 409', async () => {
    const { batchId, doc } = await flaggedPdf('R4');
    const lh = fidOf(doc, 'rate_confirmation.linehaul_rate'), load = fidOf(doc, 'rate_confirmation.load_number'), car = fidOf(doc, 'rate_confirmation.carrier');
    const bads: [string, string][] = [[lh, 'abc'], [lh, '1e3'], [car, 'x'.repeat(201)], [car, 'bad\u0001ctl'], [load, '   '], [load, '']];
    for (const [f, v] of bads) expectError(await resolve(rev, batchId, doc.id, f, { action: 'CORRECT', correctedValue: v, reason: REASON }), 400, 'validation_error');
    const b2 = await H.newBatch(an);
    const bol = await H.putOk(an, b2, 'bol.pdf', H.buildPdf(['DOCUMENT: BILL OF LADING', `Load Number: ${H.uniqLoad('R4')}`, 'Appointment Time: 2025-03-03 08:00']));
    expectError(await resolve(rev, b2, bol.id, fidOf(bol, 'bol.appointment_time'), { action: 'CORRECT', correctedValue: '2025-02-30 08:00', reason: REASON }), 400, 'validation_error');
    for (const reason of ['short', '         x       ', 'bad\u0001control reason', 'bidi \u202e reason text']) expectError(await resolve(rev, batchId, doc.id, lh, { action: 'CONFIRM', reason }), 400, 'validation_error');
    expectError(await resolve(rev, batchId, doc.id, lh, { action: 'CORRECT', reason: REASON }), 400, 'validation_error');
    expectError(await resolve(rev, batchId, doc.id, lh, { action: 'CONFIRM', correctedValue: '5', reason: REASON }), 400, 'validation_error');
    expectError(await resolve(rev, batchId, doc.id, H.RAND_UUID, { action: 'CONFIRM', reason: REASON }), 404, 'not_found');
    expectError(await resolve(rev, batchId, doc.id, bol.fields[0].id, { action: 'CONFIRM', reason: REASON }), 404, 'not_found');
    const gx = await flaggedPdf('R4G', gxMgr);
    expectError(await resolve(rev, batchId, doc.id, gx.doc.fields[0].id, { action: 'CONFIRM', reason: REASON }), 404, 'not_found');
    expect((await resolve(rev, batchId, doc.id, lh, { action: 'CONFIRM', reason: REASON })).status).toBe(200);
    expectError(await resolve(rev, batchId, doc.id, lh, { action: 'CONFIRM', reason: REASON }), 409, 'invalid_state');
    expectError(await resolve(rev, batchId, doc.id, lh, { action: 'REJECT', reason: REASON }), 409, 'invalid_state');
  });
  it('resolve on an ACCEPTED or REJECTED document -> 409', async () => {
    const a = await flaggedPdf('R5'), b = await flaggedPdf('R6');
    await H.acceptDoc(rev, a.batchId, a.doc.id);
    await rev.post(`/imports/${b.batchId}/documents/${b.doc.id}/reject`, { reason: REASON });
    expectError(await resolve(rev, a.batchId, a.doc.id, a.doc.fields[0].id, { action: 'CONFIRM', reason: REASON }), 409, 'invalid_state');
    expectError(await resolve(rev, b.batchId, b.doc.id, b.doc.fields[0].id, { action: 'CONFIRM', reason: REASON }), 409, 'invalid_state');
  });
});

describe('REV-03 accept gates', () => {
  it('unresolved flagged fields -> 409 unresolved_fields; confirmRemaining confirms them with one decision each; accept is final', async () => {
    const { batchId, doc } = await flaggedPdf('A1');
    const p = `/imports/${batchId}/documents/${doc.id}`;
    expectError(await rev.post(`${p}/accept`, { reason: REASON }), 409, 'unresolved_fields');
    expectError(await rev.post(`${p}/accept`, { reason: REASON, confirmRemaining: false }), 409, 'unresolved_fields');
    const lh = fidOf(doc, 'rate_confirmation.linehaul_rate');
    await resolve(rev, batchId, doc.id, lh, { action: 'CORRECT', correctedValue: '1401.00', reason: REASON });
    const a = await rev.post(`${p}/accept`, { reason: REASON, confirmRemaining: true });
    expect(a.status, a.text).toBe(200);
    expect(a.body.status).toBe('ACCEPTED');
    expect(a.body.unresolvedFlaggedCount).toBe(0);
    const acts = a.body.decisions.map((d: any) => d.action);
    expect(acts.filter((x: string) => x === 'ACCEPT')).toHaveLength(1);
    expect(acts.filter((x: string) => x === 'CONFIRM')).toHaveLength(doc.flaggedFieldCount - 1);
    expect(acts.filter((x: string) => x === 'CORRECT')).toHaveLength(1);
    expectError(await rev.post(`${p}/accept`, { reason: REASON }), 409, 'invalid_state');
    expectError(await resolve(rev, batchId, doc.id, lh, { action: 'CONFIRM', reason: REASON }), 409, 'invalid_state');
    expectError(await rev.patch(p, { docType: 'INVOICE' }), 409, 'invalid_state');
    expectError(await rev.post(`${p}/fields`, { key: 'rate_confirmation.carrier', value: 'X', reason: REASON }), 409, 'invalid_state');
    expectError(await rev.post(`${p}/reject`, { reason: REASON }), 409, 'invalid_state');
  });
  it('an unresolved UNPARSEABLE field blocks accept even with confirmRemaining until corrected or rejected', async () => {
    const b = await H.newBatch(an);
    const d = await H.putOk(an, b, 'rc.txt', S(`DOCUMENT: RATE CONFIRMATION\nLoad Number: ${H.uniqLoad('A2')}\nLinehaul Rate: NaN\nCarrier: Acme\n`));
    expect(d.status).toBe('NEEDS_REVIEW');
    const p = `/imports/${b}/documents/${d.id}`;
    expectError(await rev.post(`${p}/accept`, { reason: REASON, confirmRemaining: true }), 409, 'unresolved_fields');
    const f = fidOf(d, 'rate_confirmation.linehaul_rate');
    expect((await resolve(rev, b, d.id, f, { action: 'REJECT', reason: REASON })).status).toBe(200);
    const a = await rev.post(`${p}/accept`, { reason: REASON, confirmRemaining: true });
    expect(a.status, a.text).toBe(200);
    expect(a.body.status).toBe('ACCEPTED');
  });
});

describe('REV-04 document-level reasons', () => {
  it('unknown type: cannot be accepted until the type is set and a field is added; foreign key / duplicate key rejected', async () => {
    const b = await H.newBatch(an);
    const d = await H.putOk(an, b, 'mystery.txt', S(`just some words ${H.uniqLoad('D1')}`));
    expect(d.reviewReasons).toContain('UNKNOWN_DOC_TYPE');
    const p = `/imports/${b}/documents/${d.id}`;
    expectError(await rev.post(`${p}/accept`, { reason: REASON, confirmRemaining: true }), 409, 'unresolved_fields');
    const t = await rev.patch(p, { docType: 'INVOICE' });
    expect(t.status, t.text).toBe(200);
    expect(t.body.docType).toBe('INVOICE');
    expect(t.body.docTypeBasis).toBe('MANUAL');
    expectError(await rev.post(`${p}/accept`, { reason: REASON, confirmRemaining: true }), 409, 'unresolved_fields');
    const foreign = await rev.post(`${p}/fields`, { key: 'bol.facility', value: 'Dock', reason: REASON });
    expect([400, 422]).toContain(foreign.status);
    expect((await detail(rev, b, d.id)).fields).toHaveLength(0);
    const add = await rev.post(`${p}/fields`, { key: 'invoice.load_number', value: H.uniqLoad('D1'), reason: REASON });
    expect(add.status, add.text).toBe(201);
    expect(add.body).toMatchObject({ origin: 'MANUAL', confidence: 1, source: null, status: 'CONFIRMED', needsReview: false });
    expectError(await rev.post(`${p}/fields`, { key: 'invoice.load_number', value: 'LD-OTHER', reason: REASON }), 409, 'invalid_state');
    const a = await rev.post(`${p}/accept`, { reason: REASON, confirmRemaining: true });
    expect(a.status, a.text).toBe(200);
    expect(a.body.status).toBe('ACCEPTED');
  });
  it('image: set type RATE_CONFIRMATION, add rate_confirmation.load_number, accept -> ACCEPTED', async () => {
    const b = await H.newBatch(an);
    const d = await H.putOk(an, b, 'scan.png', H.buildPng());
    const p = `/imports/${b}/documents/${d.id}`;
    expect((await rev.patch(p, { docType: 'RATE_CONFIRMATION' })).status).toBe(200);
    expect((await rev.post(`${p}/fields`, { key: 'rate_confirmation.load_number', value: H.uniqLoad('D2'), reason: REASON })).status).toBe(201);
    const a = await rev.post(`${p}/accept`, { reason: REASON });
    expect(a.status, a.text).toBe(200);
    expect(a.body.status).toBe('ACCEPTED');
    expect(a.body.loadNumber).toMatch(/^LD-TD2/);
  });
  it('PATCH docType on a document with EXTRACTED fields -> 409; MISSING_LOAD_NUMBER blocks accept until a load number field exists', async () => {
    const { batchId, doc } = await flaggedPdf('D3');
    expectError(await rev.patch(`/imports/${batchId}/documents/${doc.id}`, { docType: 'INVOICE' }), 409, 'invalid_state');
    const b = await H.newBatch(an);
    const d = await H.putOk(an, b, 'rc.txt', S('DOCUMENT: RATE CONFIRMATION\nCarrier: Acme Freight LLC\nLinehaul Rate: 1400.00\n'));
    expect(d.reviewReasons).toContain('MISSING_LOAD_NUMBER');
    const p = `/imports/${b}/documents/${d.id}`;
    expectError(await rev.post(`${p}/accept`, { reason: REASON, confirmRemaining: true }), 409, 'unresolved_fields');
    expect((await rev.post(`${p}/fields`, { key: 'rate_confirmation.load_number', value: H.uniqLoad('D3'), reason: REASON })).status).toBe(201);
    expect((await rev.post(`${p}/accept`, { reason: REASON, confirmRemaining: true })).status).toBe(200);
  });
});

describe('REV-05 reject, REV-06 conflicting values', () => {
  it('reject: REJECTED reviewer_rejected, objects deleted, original -> 409, commit skips not_accepted', async () => {
    const { batchId, doc } = await flaggedPdf('J1');
    const prefix = H.docPrefix(tenantId, batchId, doc.id);
    expect((await H.s3List(prefix)).length).toBeGreaterThan(0);
    const r = await rev.post(`/imports/${batchId}/documents/${doc.id}/reject`, { reason: REASON });
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({ status: 'REJECTED', rejectReason: 'reviewer_rejected' });
    expect(await H.waitGone(prefix)).toEqual([]);
    expectError(await rev.get(`/imports/${batchId}/documents/${doc.id}/original`), 409, 'invalid_state');
    const c = await H.commit(an, batchId);
    expect(c.status, c.text).toBe(200);
    expect(c.body.skipped).toContainEqual({ documentId: doc.id, reason: 'not_accepted' });
    expect(c.body.created).toEqual([]);
  });
  it('conflicting Load Number lines: confirmRemaining does not confirm; explicit CONFIRM does; then accept succeeds', async () => {
    const b = await H.newBatch(an);
    const d = await H.putOk(an, b, 'bol.txt', S(`DOCUMENT: BILL OF LADING\nLoad Number: ${H.uniqLoad('C1')}\nFacility: Dock 1\nLoad Number: ${H.uniqLoad('C2')}\n`));
    expect(d.status).toBe('NEEDS_REVIEW');
    const p = `/imports/${b}/documents/${d.id}`;
    const f = H.fld(d, 'bol.load_number');
    expect(f.reviewReasons).toContain('CONFLICTING_VALUES');
    expectError(await rev.post(`${p}/accept`, { reason: REASON, confirmRemaining: true }), 409, 'unresolved_fields');
    expect((await resolve(rev, b, d.id, f.id, { action: 'CONFIRM', reason: REASON })).status).toBe(200);
    expect((await rev.post(`${p}/accept`, { reason: REASON, confirmRemaining: true })).status).toBe(200);
  });
});

describe('REV-07 audit and REV-08 concurrency', () => {
  it('every state change above has its audit event and the chain verifies', async () => {
    const ev = await H.auditSince(owner, seq0);
    const names = new Set(ev.map((e) => e.action));
    for (const a of ['import.batch_created', 'import.document_received', 'import.document_parsed', 'review.field_resolved', 'review.field_added', 'review.doctype_set', 'review.document_accepted', 'review.document_rejected']) expect(names.has(a), `audit action ${a}`).toBe(true);
    for (const e of ev.filter((x) => x.action.startsWith('review.'))) {
      expect(e.actor?.id, e.action).toBeTruthy();
      const m = JSON.stringify(e.metadata ?? {});
      expect(m, `${e.action} metadata`).not.toMatch(/1234\.50|Acme Freight|LD-T/);
    }
    for (const t of [owner, gxMgr]) { /* chain of the other tenant is verified in imp-audit */ }
    const v = await owner.get('/audit/verify');
    expect(v.status).toBe(200);
    expect(v.body.valid).toBe(true);
  });
  it('REV-08: two reviewers resolving the same field -> exactly one 200 and one 409; two accepts -> exactly one 200', async () => {
    const { batchId, doc } = await flaggedPdf('K1');
    const f = fidOf(doc, 'rate_confirmation.carrier');
    const rs = await Promise.all([resolve(rev, batchId, doc.id, f, { action: 'CONFIRM', reason: REASON }), resolve(mgr, batchId, doc.id, f, { action: 'REJECT', reason: REASON })]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    const as = await Promise.all([H.acceptDoc(rev, batchId, doc.id), H.acceptDoc(mgr, batchId, doc.id)]);
    expect(as.map((r) => r.status).sort(), as.map((r) => r.text).join(' | ')).toEqual([200, 409]);
  });
});
