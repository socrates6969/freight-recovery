/* eslint-disable */
// T12 (T-PROV-01..05): provenance summary, driven through the real step 3 flow (upload, review, accept, commit).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, buildTestApp, closeApps, expectError, type RoleName, type Session } from './helpers/client.js';
import * as H from './helpers/imp.js';
import * as I from './helpers/intel.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
let SS: Record<RoleName, Session>;
let gx: Session;
let claimId = '';
let docs: any[] = []; // public document views, linked order
let bareClaim = '';
const REASON = 'Provenance acceptance review';
const S = (s: string) => Buffer.from(s, 'utf8');
const resolveF = (rev: Session, b: string, d: string, f: string, body: any) => rev.post(`/imports/${b}/documents/${d}/fields/${f}/resolve`, { reason: REASON, ...body });

beforeAll(async () => {
  await H.assertS3Reachable();
  app = await buildTestApp();
  SS = await I.seededOn(app);
  for (const r of Object.keys(SS) as RoleName[]) SS[r] = I.recorded(SS[r]);
  gx = I.recorded(I.onApp(app, await I.baseSession(I.GLOBEX.MANAGER)));
  const an = H.wrap(SS.ANALYST), rev = H.wrap(SS.REVIEWER), mgr = H.wrap(SS.MANAGER);
  // a seeded claim without linked documents (checked through the public API)
  const cl = (await mgr.get('/claims?pageSize=50')).body.items as any[];
  for (const c of cl) {
    if ((await mgr.get(`/claims/${c.id}/documents`)).body.items.length === 0) { bareClaim = c.id; break; }
  }
  const load = H.uniqLoad('PV');
  const b = await H.newBatch(an);
  // 1. clean invoice (same layout as tests/fixtures/ld5001/invoice.txt, unique load number)
  const inv = await H.putOk(an, b, 'invoice.txt', S(H.invoiceTxt(load)));
  if (inv.status !== 'ACCEPTED') expect((await H.acceptDoc(rev, b, inv.id)).status).toBe(200);
  // 2. rate confirmation with a repeated, conflicting Load Number line
  const rcText = H.rateTxt(load).replace('Carrier: Acme Freight LLC', `Load Number: ${load}-X\r\nCarrier: Acme Freight LLC`);
  const rc = await H.putOk(an, b, 'rate_confirmation.txt', S(rcText));
  expect(rc.status).toBe('NEEDS_REVIEW');
  const loadF = rc.fields.find((f: any) => f.key === 'rate_confirmation.load_number');
  expect((await resolveF(rev, b, rc.id, loadF.id, { action: 'CORRECT', correctedValue: load })).status).toBe(200);
  const carrierF = rc.fields.find((f: any) => f.key === 'rate_confirmation.carrier');
  expect((await resolveF(rev, b, rc.id, carrierF.id, { action: 'CONFIRM' })).status).toBe(200);
  const fuelF = rc.fields.find((f: any) => f.key === 'rate_confirmation.fuel_surcharge');
  expect((await resolveF(rev, b, rc.id, fuelF.id, { action: 'REJECT' })).status).toBe(200);
  const acc = await H.acceptDoc(rev, b, rc.id, true);
  expect(acc.status, acc.text).toBe(200);
  // 3. image document: type set by the reviewer plus one MANUAL field
  const png = await H.putOk(an, b, 'scan.png', H.buildPng());
  expect((await rev.patch(`/imports/${b}/documents/${png.id}`, { docType: 'BILL_OF_LADING' })).status).toBe(200);
  const add = await rev.post(`/imports/${b}/documents/${png.id}/fields`, { key: 'bol.load_number', value: load, reason: REASON });
  expect(add.status, add.text).toBe(201);
  expect(add.body.origin).toBe('MANUAL');
  const acc3 = await H.acceptDoc(rev, b, png.id, true);
  expect(acc3.status, acc3.text).toBe(200);
  const cm = await H.commit(mgr, b, 'SHIPPER');
  expect(cm.status, cm.text).toBe(200);
  expect(cm.body.created.length).toBe(1);
  claimId = cm.body.created[0].claimId;
  const linked = (await mgr.get(`/claims/${claimId}/documents`)).body.items as any[];
  expect(linked.length).toBe(3);
  linked.sort((x, y) => Date.parse(x.linkedAt) - Date.parse(y.linkedAt) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  docs = [];
  for (const l of linked) docs.push((await H.getDoc(mgr, b, l.id)).body);
}, 300000);
afterAll(async () => { try { await I.resetFlags(); I.assertHonest('intel-provenance'); H.assertRecorded('intel-provenance'); } finally { await closeApps(); reseed(); } });

const prov = async (s: Session, id = claimId) => {
  const r = await s.get(`/claims/${id}/provenance`);
  expect(r.status, r.text).toBe(200);
  return r.body;
};

describe('T-PROV-01 counts equal the oracle', () => {
  it('per-document and total counts follow the public document view', async () => {
    const p = await prov(SS.MANAGER);
    expect(p.claimId).toBe(claimId);
    expect(p.documents.map((d: any) => d.documentId)).toEqual(docs.map((d) => d.id));
    const tot = { documents: 0, fields: 0, manualFields: 0, proposed: 0, confirmed: 0, corrected: 0, rejected: 0, unresolvedFlagged: 0 };
    docs.forEach((d, i) => {
      const f = d.fields as any[];
      const ex = f.filter((x) => x.origin === 'EXTRACTED');
      const mn = f.filter((x) => x.origin === 'MANUAL');
      const st = (s: string) => f.filter((x) => x.status === s).length;
      const row = p.documents[i];
      expect(row.displayName).toBe(d.displayName);
      expect(row.docType).toBe(d.docType);
      expect(row.status).toBe(d.status);
      expect(row.extractedFieldCount).toBe(ex.length);
      expect(row.manualFieldCount).toBe(mn.length);
      expect(row.byFieldStatus).toEqual({ PROPOSED: st('PROPOSED'), CONFIRMED: st('CONFIRMED'), CORRECTED: st('CORRECTED'), REJECTED: st('REJECTED') });
      expect(row.unresolvedFlaggedCount).toBe(f.filter((x) => x.needsReview && x.status === 'PROPOSED').length);
      expect(row.minConfidence).toBe(ex.length ? Math.min(...ex.map((x) => x.confidence)) : null);
      tot.documents++; tot.fields += f.length; tot.manualFields += mn.length; tot.proposed += st('PROPOSED'); tot.confirmed += st('CONFIRMED'); tot.corrected += st('CORRECTED'); tot.rejected += st('REJECTED');
      tot.unresolvedFlagged += row.unresolvedFlaggedCount;
    });
    expect(p.totals).toEqual(tot);
    expect(p.totals.fields).toBe(p.totals.proposed + p.totals.confirmed + p.totals.corrected + p.totals.rejected);
    expect(p.totals.fields).toBe(p.documents.reduce((s: number, d: any) => s + d.extractedFieldCount + d.manualFieldCount, 0));
    expect(p.documents.some((d: any) => d.manualFieldCount > 0)).toBe(true);
    expect(p.totals.corrected).toBeGreaterThan(0);
    expect(p.totals.rejected).toBeGreaterThan(0);
    const imageDoc = p.documents.find((d: any) => d.extractedFieldCount === 0);
    expect(imageDoc?.minConfidence ?? null).toBeNull();
  });
});

describe('T-PROV-02 empty and unknown', () => {
  it('a claim without documents is empty; unknown, foreign and malformed ids are indistinguishable', async () => {
    expect(bareClaim, 'a seeded claim without linked documents').toBeTruthy();
    const e = await prov(SS.MANAGER, bareClaim);
    expect(e.documents).toEqual([]);
    expect(e.totals).toEqual({ documents: 0, fields: 0, manualFields: 0, proposed: 0, confirmed: 0, corrected: 0, rejected: 0, unresolvedFlagged: 0 });
    const gxClaim = (await gx.get('/claims?pageSize=1')).body.items[0].id;
    const unknown = await SS.MANAGER.get(`/claims/${I.RAND_UUID}/provenance`);
    I.expectIdentical404(await SS.MANAGER.get(`/claims/${gxClaim}/provenance`), unknown);
    I.expectIdentical404(await SS.MANAGER.get('/claims/not-a-uuid/provenance'), unknown);
  });
});

describe('T-PROV-03 static content', () => {
  it('fixed basis and label; no excerpts or extracted values; no forbidden claims', async () => {
    const r = await SS.MANAGER.get(`/claims/${claimId}/provenance`);
    expect(r.body.basis).toBe('rule_based_parse_score');
    expect(r.body.label).toBe(I.PROVENANCE_NOTE);
    expect(Object.keys(r.body).sort()).toEqual(['basis', 'claimId', 'documents', 'label', 'totals']);
    for (const d of r.body.documents) expect(Object.keys(d).sort()).toEqual(['byFieldStatus', 'displayName', 'docType', 'documentId', 'extractedFieldCount', 'manualFieldCount', 'minConfidence', 'status', 'unresolvedFlaggedCount']);
    for (const n of ['INV-1001', 'Acme Freight LLC', 'Widget Co', '1500.00', 'Linehaul']) expect(r.text.includes(n), n).toBe(false);
    expect(I.HONEST_RE.test(r.text)).toBe(false);
  });
});

describe('T-PROV-04 roles, flag, audit', () => {
  it('six tenant roles read; platform roles and anonymous callers do not; audited; flag hides the route', async () => {
    for (const r of ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER'] as RoleName[]) expect((await SS[r].get(`/claims/${claimId}/provenance`)).status, r).toBe(200);
    expectError(await SS.PLATFORM_DEV.get(`/claims/${claimId}/provenance`), 403, 'forbidden');
    expectError(await SS.SUPER_ADMIN.get(`/claims/${claimId}/provenance`), 403, 'forbidden');
    expectError(await new Client(app).get(`/claims/${claimId}/provenance`), 401, 'unauthenticated');
    const tid = SS.OWNER.user.tenant.id;
    const seq = await I.lastSeq(tid);
    const p = await prov(SS.MANAGER);
    const ev = await I.eventsSince(tid, seq);
    expect(ev.map((e) => e.action)).toEqual(['intelligence.viewed']);
    expect(ev[0]!.metadata).toEqual({ kind: 'provenance', claimId, returned: p.documents.length });
    const off = await buildTestApp({ FLAGS_CACHE_TTL_MS: '0' });
    const dev = I.onApp(off, SS.PLATFORM_DEV);
    await I.setFlag(dev, 'intelligence.provenance', false, 'acceptance provenance off');
    try {
      expectError(await I.onApp(off, SS.MANAGER).get(`/claims/${claimId}/provenance`), 404, 'not_found');
    } finally {
      await I.setFlag(dev, 'intelligence.provenance', true, 'acceptance provenance on');
    }
  }, 60000);
});

describe('T-PROV-05 isolation', () => {
  it('another tenant sees the same 404 as for an unknown claim', async () => {
    const r = await gx.get(`/claims/${claimId}/provenance`);
    I.expectIdentical404(r, await gx.get(`/claims/${I.RAND_UUID}/provenance`));
    expect(r.text.includes(claimId)).toBe(false);
  });
});