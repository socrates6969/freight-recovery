/* eslint-disable */
// REQ-20261011-charge-intelligence Tier H (written now; run after the owner's go-ahead): T9 analysis with learning
// (CI-A13..A19), T10 flag (CI-F01, CI-F02), T13 claim.analyzed metadata (CI-U01 analysis part, CI-U03 verify).
// Part C C4, C6, C9, C10, C15 (RD7-RD9). Black-box through the import pipeline, the analyze routes and audit rows.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Session, buildTestApp, closeApps, sessionFor, resetSessionCache } from './helpers/client.js';
import * as A from './helpers/analysis.js';
import { LD5001_SHIPPER, LD5002_CARRIER, projectFinding } from './helpers/analysis-vectors.js';
import { withAdmin } from './helpers/db.js';
import * as H from './helpers/imp.js';
import * as I from './helpers/intel.js';
import { validatePacket } from './helpers/packet.js';
import { reseed } from './helpers/seed.js';

const LRN_EXPL = "'Sort and segregate' ($85.00) is not recognised by the fixed rules. Its nearest labelled example is 'SORT AND SEGREGATE SERVICE' (public tariff example, Dohrn Rules Tariff DHRN 100 (2025)), labelled accessorial, and it is not listed as authorized on the rate confirmation. Suggestion only - verify before disputing.";
const LRN_CALC = ["Nearest labelled example: 'SORT AND SEGREGATE SERVICE' (public tariff example, Dohrn Rules Tariff DHRN 100 (2025)) = accessorial, similarity 0.836.", 'A suggestion needs similarity of at least 0.30.', "Authorized accessorials: ['Appointment'].", "Charged: 'Sort and segregate' = $85.00."];
const DET_EXTRA = "Possible detention billed under another name: 'Driver waiting time' = $75.00 (nearest labelled example 'DETENTION - DRIVER WAIT', public tariff example, Gardewine GWN Tariff 100 (2025), similarity 0.450). Confirm before claiming.";
const NO_CONFIRMED = '(No confirmed discrepancies.';
const B1_LINES: [string, string][] = [['Linehaul', '1500.00'], ['Fuel surcharge', '300.00'], ['Sort and segregate', '85.00'], ['Lumper fee', '150.00'], ['Scale ticket', '12.00'], ['Appointment fee', '40.00']];
const k1Files = (load: string) => [A.invoiceFile(load, B1_LINES, { total: '2087.00' }), A.rateFile(load, { linehaul: '1500.00', fuel: '300.00', acc: 'Appointment' })];
const bolFile = (load: string, arr: string, dep: string): A.FileSpec => ({ name: 'bol.txt', bytes: Buffer.from(['DOCUMENT: BILL OF LADING', `Load Number: ${load}`, 'Facility: Synthetic DC 1', `Arrival Time: ${arr}`, `Departure Time: ${dep}`].join('\n') + '\n', 'utf8') });
const b3Files = (load: string, desc = 'Driver waiting time') => [
  A.invoiceFile(load, [['Linehaul', '1200.00'], [desc, '75.00']]),
  A.rateFile(load, { linehaul: '1200.00', free: '2', rate: '50.00' }),
  bolFile(load, '2026-03-02 08:00', '2026-03-02 12:30'),
];
const p1Files = (load: string) => [A.invoiceFile(load, [['Linehaul', '1500.00'], ['Pallet jack rental', '60.00']]), A.rateFile(load, { linehaul: '1500.00' })];

let app: FastifyInstance;
let an: Session, rv: Session, m: Session, owner: Session, vw: Session, dev: Session, gxm: Session, gxo: Session;
let tid = '';
const approve = (s: Session, id: string, extra: object = {}) => s.post(`/claims/${id}/packet/approve`, { packetRevision: 1, reason: 'Checked the review items carefully', ...extra });
const analyzedEvent = async (seq: number, claimId: string) => {
  const ev = (await A.eventsSince(owner, seq, 'claim.analyzed')).filter((e: any) => e.targetId === claimId);
  expect(ev).toHaveLength(1);
  return ev[0];
};
const clearLabels = (t: string) => withAdmin(async (c) => { await c.query('delete from charge_labels where tenant_id = $1', [t]); });
async function analyzeOk(s: Session, made: A.Made) {
  const r = await A.analyze(s, made.claimId);
  expect(r.status, `analyze ${made.claimNumber}: ${r.text}`).toBe(201);
  return r;
}

/** Log every account in again. reseed() recreates the seed users, so sessions made before it are no longer valid
 *  (REQ-20261011-ocean-dd Tier H run: mid-test reseed() left the file's sessions answering 401 - test design). */
async function signIn() {
  resetSessionCache();
  an = await sessionFor(app, ACCOUNTS.ANALYST);
  rv = await sessionFor(app, ACCOUNTS.REVIEWER);
  m = await sessionFor(app, ACCOUNTS.MANAGER);
  owner = await sessionFor(app, ACCOUNTS.OWNER);
  vw = await sessionFor(app, ACCOUNTS.VIEWER);
  dev = await sessionFor(app, ACCOUNTS.PLATFORM_DEV);
  gxm = await sessionFor(app, I.GLOBEX.MANAGER);
  gxo = await sessionFor(app, I.GLOBEX.OWNER);
  tid = owner.user.tenant.id;
}

beforeAll(async () => {
  await H.assertS3Reachable();
  reseed();
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50', FLAGS_CACHE_TTL_MS: '0' });
  await signIn();
  await clearLabels(tid);
}, 180000);
afterAll(async () => { try { await I.setFlag(dev, 'intelligence.charge_suggestions', true, 'acceptance restore'); } finally { await closeApps(); reseed(); } });

describe('T10 flag (C10)', () => {
  // REQ-20261011-fuel-outlook F14 (additive): six flags (cost_outlook and fuel_check added, ordered by key).
  // REQ-20261011-ocean-dd C16/C20 (additive): seven flags (intelligence.ocean_dd added, ordered by key).
  it('CI-F01 /features returns exactly seven flags including intelligence.charge_suggestions: true', async () => {
    const r = await vw.get('/features');
    expect(r.status, r.text).toBe(200);
    expect(Object.keys(r.body.flags).sort()).toEqual(['intelligence.charge_suggestions', 'intelligence.cost_outlook', 'intelligence.fuel_check', 'intelligence.ocean_dd', 'intelligence.provenance', 'intelligence.similar_claims', 'intelligence.worklist']);
    expect(r.body.flags['intelligence.charge_suggestions']).toBe(true);
  });
});

describe('T9 analysis with learning (C4)', () => {
  it('CI-A13 + CI-U01: K1 shipper -> INV-ACCESSORIAL-UNAUTH then LRN; totals; citation; clause; audit; integrity', async () => {
    const load = H.uniqLoad('A13');
    const k1 = await A.makeClaim(an, rv, k1Files(load), 'SHIPPER', load);
    const seq = await H.lastSeq(owner);
    const r = await analyzeOk(an, k1);
    expect(r.body.analysis).toEqual({ rulesVersion: 'rules-v1', findingsCount: 2, pendingFindingsCount: 2, ignoredFindingsCount: 0, classifierVersion: 'charge-knn-v1', learnedFindingsCount: 1, reviewFlagsCount: 0, fuelCheckStatus: 'no_inputs', fuelFindingsCount: 0 });
    expect(r.body.claim).toEqual({ id: k1.claimId, status: 'PENDING_REVIEW', recoverableCents: 0, pendingReviewCents: 23500, amountClaimedCents: 23500 });
    const p = (await vw.get(`/claims/${k1.claimId}/packet`)).body;
    validatePacket(p);
    expect(p.integrity.valid).toBe(true);
    expect(p.findings.map((f: any) => f.ruleId)).toEqual(['INV-ACCESSORIAL-UNAUTH', 'LRN-ACCESSORIAL-REVIEW']);
    expect(projectFinding(p.findings[1])).toEqual({ ruleId: 'LRN-ACCESSORIAL-REVIEW', title: 'Possible unauthorized accessorial (suggestion)', direction: 'OVERCHARGE', amountCents: 8500, explanation: LRN_EXPL, calculation: LRN_CALC, confidence: 0.5, needsHumanReview: true });
    if ('ordinal' in p.findings[1]) expect([p.findings[0].ordinal, p.findings[1].ordinal]).toEqual([1, 2]);
    const inv = k1.docs.find((d) => d.docType === 'INVOICE');
    const rcd = k1.docs.find((d) => d.docType === 'RATE_CONFIRMATION');
    const src = (t: string) => p.sources.find((s: any) => s.docType === t).id as string;
    expect(p.findings[1].citations).toEqual([await A.lineCitation(an, k1, inv, 'Sort and segregate', src('INVOICE'))]);
    expect(p.findings[1].governingClause).toEqual({ ...(await A.fieldCitation(an, k1, rcd, (x) => x.key === 'rate_confirmation.authorized_accessorials', src('RATE_CONFIRMATION'))), label: 'Authorized accessorials' });
    expect(p.demandLetter).toContain(NO_CONFIRMED);
    expect(p.demandLetter).not.toContain('Sort and segregate');
    const e = await analyzedEvent(seq, k1.claimId);
    expect(Object.keys(e.metadata).sort()).toEqual([...A.P7_ANALYZED_KEYS].sort());
    expect(e.metadata).toMatchObject({ findingsCount: 2, pendingFindingsCount: 2, ignoredFindingsCount: 0, recoverableCents: 0, pendingReviewCents: 23500, rulesVersion: 'rules-v1', bulk: false, classifierVersion: 'charge-knn-v1', seedVersion: 'tariff-seed-v1', tenantLabelCount: 0, learnedFindingsCount: 1, reviewFlagsCount: 0, learnedLabelIds: [] });
    const v = await owner.get('/audit/verify');
    expect(v.body.valid, v.text).toBe(true);
  });
  it('CI-A14 B3 carrier: DET-UNBILLED flagged for review with the extra step and line citation; ack required to approve', async () => {
    const load = H.uniqLoad('A14');
    const c = await A.makeClaim(an, rv, b3Files(load), 'CARRIER', load);
    const r = await analyzeOk(an, c);
    expect(r.body.analysis).toMatchObject({ findingsCount: 1, pendingFindingsCount: 1, learnedFindingsCount: 0, reviewFlagsCount: 1, classifierVersion: 'charge-knn-v1' });
    expect([r.body.claim.recoverableCents, r.body.claim.pendingReviewCents]).toEqual([0, 12500]);
    const p = (await vw.get(`/claims/${c.claimId}/packet`)).body;
    validatePacket(p);
    expect(p.findings).toHaveLength(1);
    const f = p.findings[0];
    expect([f.ruleId, f.title, f.amountCents, f.confidence, f.needsHumanReview, f.direction]).toEqual(['DET-UNBILLED', 'Detention earned but not billed', 12500, 0.85, true, 'UNDERBILLED']);
    expect(f.explanation).toBe('Gate times and rate-con terms support $125.00 of detention; $0 was billed.');
    expect(f.calculation.at(-1)).toBe(DET_EXTRA);
    expect(f.calculation.slice(0, -1)).toEqual(['Clock starts at arrival 2026-03-02 08:00.', 'Departure 2026-03-02 12:30; dwell = 270 min (4.50 h).', 'Less 2 h free time = 2.50 h over.', 'Rounded down to 15-minute increments = 150 min (2.50 h).', '2.50 h x $50.00/h = $125.00.', 'Invoiced detention = $0; earned = $125.00.']);
    const src = (t: string) => p.sources.find((s: any) => s.docType === t).id as string;
    const doc = (t: string) => c.docs.find((d) => d.docType === t);
    const fc = (d: any, key: string, t: string) => A.fieldCitation(an, c, d, (x) => x.key === key, src(t));
    expect(f.citations).toEqual([
      await fc(doc('BILL_OF_LADING'), 'bol.arrival_time', 'BILL_OF_LADING'),
      await fc(doc('BILL_OF_LADING'), 'bol.departure_time', 'BILL_OF_LADING'),
      await fc(doc('RATE_CONFIRMATION'), 'rate_confirmation.detention_rate_per_hour', 'RATE_CONFIRMATION'),
      await A.lineCitation(an, c, doc('INVOICE'), 'Driver waiting time', src('INVOICE')),
    ]);
    expect(p.demandLetter).toContain(NO_CONFIRMED);
    expect([p.recoverableCents, p.pendingReviewCents]).toEqual([0, 12500]);
    const no = await approve(m, c.claimId, { acknowledgePendingFindings: false });
    expect(no.status, no.text).toBe(422);
    const ok = await approve(m, c.claimId, { acknowledgePendingFindings: true });
    expect(ok.status, ok.text).toBe(200);
  });
  it('CI-A15 learning from correction: P1 none; label; P2 learns; P1 packet unchanged; relabel other; P3 none', async () => {
    await clearLabels(tid);
    const l1 = H.uniqLoad('P1');
    const p1 = await A.makeClaim(an, rv, p1Files(l1), 'SHIPPER', l1);
    expect((await analyzeOk(an, p1)).body.analysis.learnedFindingsCount).toBe(0);
    const before = (await vw.get(`/claims/${p1.claimId}/packet`)).body;
    const lab = await I.put(rv, '/charge-labels', { description: 'Pallet jack rental', category: 'accessorial' });
    expect(lab.status, lab.text).toBe(200);
    const l2 = H.uniqLoad('P2');
    const p2 = await A.makeClaim(an, rv, p1Files(l2), 'SHIPPER', l2);
    const seq = await H.lastSeq(owner);
    const r2 = await analyzeOk(an, p2);
    expect(r2.body.analysis.learnedFindingsCount).toBe(1);
    const pk2 = (await vw.get(`/claims/${p2.claimId}/packet`)).body;
    const lrn = pk2.findings.filter((f: any) => f.ruleId === 'LRN-ACCESSORIAL-REVIEW');
    expect(lrn).toHaveLength(1);
    expect(lrn[0].amountCents).toBe(6000);
    expect(lrn[0].explanation).toContain("(your team's label)");
    expect(lrn[0].calculation[0]).toBe("Nearest labelled example: 'Pallet jack rental' (your team's label) = accessorial, similarity 1.000.");
    const e2 = await analyzedEvent(seq, p2.claimId);
    expect(e2.metadata.tenantLabelCount).toBe(1);
    expect(e2.metadata.learnedLabelIds, 'CI-U04').toEqual([lab.body.label.id]);
    const after = (await vw.get(`/claims/${p1.claimId}/packet`)).body;
    expect(after.integrity.contentHash).toBe(before.integrity.contentHash);
    expect(after.findings).toEqual(before.findings);
    expect(after.revision).toBe(before.revision);
    expect((await I.put(rv, '/charge-labels', { description: 'Pallet jack rental', category: 'other' })).body.outcome).toBe('changed');
    const l3 = H.uniqLoad('P3');
    const p3 = await A.makeClaim(an, rv, p1Files(l3), 'SHIPPER', l3);
    expect((await analyzeOk(an, p3)).body.analysis.learnedFindingsCount).toBe(0);
    expect((await vw.get(`/claims/${p3.claimId}/packet`)).body.findings).toEqual([]);
    await clearLabels(tid);
  });
  it('CI-A16 abstaining lines: no LRN, no review flag; packet as step 5', async () => {
    await clearLabels(tid);
    for (const [desc, amt] of [['Wait time', '75.00'], ['Scale ticket', '12.00']] as const) {
      const load = H.uniqLoad('A16');
      const c = await A.makeClaim(an, rv, [A.invoiceFile(load, [['Linehaul', '1500.00'], [desc, amt]]), A.rateFile(load, { linehaul: '1500.00' })], 'SHIPPER', load);
      const r = await analyzeOk(an, c);
      expect(r.body.analysis).toEqual({ rulesVersion: 'rules-v1', findingsCount: 0, pendingFindingsCount: 0, ignoredFindingsCount: 0, classifierVersion: 'charge-knn-v1', learnedFindingsCount: 0, reviewFlagsCount: 0, fuelCheckStatus: 'no_inputs', fuelFindingsCount: 0 });
      const p = (await vw.get(`/claims/${c.claimId}/packet`)).body;
      expect([p.findings, p.recoverableCents, p.pendingReviewCents]).toEqual([[], 0, 0]);
      expect(p.demandLetter).toContain(NO_CONFIRMED);
    }
    const load = H.uniqLoad('A16W');
    const w = await A.makeClaim(an, rv, b3Files(load, 'Wait time'), 'CARRIER', load);
    const r = await analyzeOk(an, w);
    expect(r.body.analysis).toMatchObject({ learnedFindingsCount: 0, reviewFlagsCount: 0 });
    const p = (await vw.get(`/claims/${w.claimId}/packet`)).body;
    expect(p.findings.map((f: any) => [f.ruleId, f.amountCents, f.needsHumanReview])).toEqual([['DET-UNBILLED', 12500, false]]);
    expect(p.findings[0].calculation.at(-1)).toBe('Invoiced detention = $0; earned = $125.00.');
    expect([p.recoverableCents, p.pendingReviewCents]).toEqual([12500, 0]);
  });
  it('CI-A17 parity unchanged for the step-5 fixtures', async () => {
    const sets: [string, 'SHIPPER' | 'CARRIER', any[] | null, any][] = [['ld5001', 'SHIPPER', LD5001_SHIPPER, { findingsCount: 3, pendingFindingsCount: 1, ignoredFindingsCount: 0 }], ['ld5002', 'CARRIER', LD5002_CARRIER, { findingsCount: 1, pendingFindingsCount: 0, ignoredFindingsCount: 0 }], ['ld5001', 'CARRIER', [], { findingsCount: 0, pendingFindingsCount: 0, ignoredFindingsCount: 3 }], ['ld5002', 'SHIPPER', [], { findingsCount: 0, pendingFindingsCount: 0, ignoredFindingsCount: 1 }]];
    for (const [set, persp, exp, counts] of sets) {
      const c = set === 'ld5001' ? await A.ld5001Claim(an, rv, persp, 'A17') : await A.ld5002Claim(an, rv, persp, 'A17');
      const r = await analyzeOk(an, c);
      expect(r.body.analysis, `${set} ${persp}`).toEqual({ rulesVersion: 'rules-v1', ...counts, classifierVersion: 'charge-knn-v1', learnedFindingsCount: 0, reviewFlagsCount: 0, fuelCheckStatus: 'no_inputs', fuelFindingsCount: 0 });
      const p = (await vw.get(`/claims/${c.claimId}/packet`)).body;
      expect(p.findings.map(projectFinding), `${set} ${persp}`).toEqual(exp);
    }
  });
  it.skipIf(A.SKIP_BULK)('CI-A18 bulk analyze: per-claim outcomes identical to single analyze; events carry the new keys', async () => {
    reseed();
    await signIn();
    await clearLabels(tid);
    const mk = async (kind: string, tag: string) => {
      const load = H.uniqLoad(tag);
      if (kind === 'k1') return A.makeClaim(an, rv, k1Files(load), 'SHIPPER', load);
      if (kind === 'b3') return A.makeClaim(an, rv, b3Files(load), 'CARRIER', load);
      return A.makeClaim(an, rv, A.LD5001(load), 'SHIPPER', load);
    };
    const kinds = ['k1', 'b3', 'ld'];
    const singles: Record<string, any> = {};
    for (const k of kinds) { const c = await mk(k, `S${k}`); await analyzeOk(an, c); singles[k] = { c, p: (await vw.get(`/claims/${c.claimId}/packet`)).body }; }
    const bulkMade: Record<string, A.Made> = {};
    for (const k of kinds) bulkMade[k] = await mk(k, `B${k}`);
    const seq = await H.lastSeq(owner);
    const b = await A.bulk(an, { limit: 10 });
    expect(b.status, b.text).toBe(200);
    expect(Object.keys(b.body).sort()).toEqual(['analyzed', 'examined', 'failed', 'limit', 'remaining', 'skipped']);
    for (const k of kinds) {
      const c = bulkMade[k]!;
      const p = (await vw.get(`/claims/${c.claimId}/packet`)).body;
      const s = singles[k];
      expect(p.findings.map(projectFinding), k).toEqual(s.p.findings.map(projectFinding));
      expect([p.recoverableCents, p.pendingReviewCents]).toEqual([s.p.recoverableCents, s.p.pendingReviewCents]);
      expect(A.replaceDate(p.demandLetter, '2000-01-01').replaceAll(c.load, 'LOAD'), k).toBe(A.replaceDate(s.p.demandLetter, '2000-01-01').replaceAll(s.c.load, 'LOAD'));
      const e = (await A.eventsSince(owner, seq, 'claim.analyzed')).filter((x: any) => x.targetId === c.claimId);
      expect(e).toHaveLength(1);
      expect(Object.keys(e[0].metadata).sort()).toEqual([...A.P7_ANALYZED_KEYS].sort());
      expect(e[0].metadata.bulk).toBe(true);
      expect(e[0].metadata.classifierVersion).toBe('charge-knn-v1');
      expect(e[0].metadata.learnedFindingsCount).toBe(k === 'k1' ? 1 : 0);
      expect(e[0].metadata.reviewFlagsCount).toBe(k === 'b3' ? 1 : 0);
    }
  }, 300000);
  it('CI-A19 cross-tenant learning isolation', async () => {
    await clearLabels(tid);
    expect((await I.put(rv, '/charge-labels', { description: 'Pallet jack rental', category: 'accessorial' })).status).toBe(200);
    const load = H.uniqLoad('A19');
    const c = await A.makeClaim(gxm, gxo, p1Files(load), 'SHIPPER', load);
    const r = await A.analyze(gxm, c.claimId);
    expect(r.status, r.text).toBe(201);
    expect(r.body.analysis.learnedFindingsCount).toBe(0);
    const v = await gxm.get(`/claims/${c.claimId}/charge-lines`);
    const pj = v.body.lines.find((l: any) => l.description === 'Pallet jack rental');
    expect(pj.label).toBeNull();
    expect([pj.suggestion.abstained, pj.suggestion.reason]).toEqual([true, 'below_threshold']);
    await clearLabels(tid);
  });
});

describe('T10 flag off (CI-F02)', () => {
  it('flag off: analysis is step 5 exactly; null classifier keys; labels survive', async () => {
    await clearLabels(tid);
    expect((await I.put(rv, '/charge-labels', { description: 'Pallet jack rental', category: 'accessorial' })).status).toBe(200);
    await I.setFlag(dev, 'intelligence.charge_suggestions', false, 'acceptance charge flag off');
    try {
      const load = H.uniqLoad('F02');
      const k1 = await A.makeClaim(an, rv, k1Files(load), 'SHIPPER', load);
      const seq = await H.lastSeq(owner);
      const r = await analyzeOk(an, k1);
      expect(r.body.analysis).toEqual({ rulesVersion: 'rules-v1', findingsCount: 1, pendingFindingsCount: 1, ignoredFindingsCount: 0, classifierVersion: null, learnedFindingsCount: 0, reviewFlagsCount: 0, fuelCheckStatus: 'no_inputs', fuelFindingsCount: 0 });
      expect([r.body.claim.recoverableCents, r.body.claim.pendingReviewCents]).toEqual([0, 15000]);
      const p = (await vw.get(`/claims/${k1.claimId}/packet`)).body;
      expect(p.findings.map((f: any) => [f.ruleId, f.amountCents, f.needsHumanReview])).toEqual([['INV-ACCESSORIAL-UNAUTH', 15000, true]]);
      const e = await analyzedEvent(seq, k1.claimId);
      expect([e.metadata.classifierVersion, e.metadata.seedVersion, e.metadata.tenantLabelCount, e.metadata.learnedFindingsCount, e.metadata.reviewFlagsCount, e.metadata.learnedLabelIds]).toEqual([null, null, 0, 0, 0, []]);
      for (const res of [await vw.get('/charge-labels'), await vw.get(`/claims/${k1.claimId}/charge-lines`), await I.put(rv, '/charge-labels', { description: 'x label', category: 'other' }), await rv.destroy(`/charge-labels/${I.RAND_UUID}`)]) A.expectExact(res, 404, 'not_found');
    } finally {
      await I.setFlag(dev, 'intelligence.charge_suggestions', true, 'acceptance charge flag on');
    }
    const list = await vw.get('/charge-labels');
    expect(list.status, list.text).toBe(200);
    expect(list.body.items.map((x: any) => x.normalizedText)).toEqual(['pallet jack rental']);
    await clearLabels(tid);
    const v = await owner.get('/audit/verify');
    expect(v.body.valid, v.text).toBe(true);
  }, 120000);
});

describe('T17 CI-U04 learnedLabelIds and CI-A21 bulk once-per-request (C4, C9 fix round 1)', () => {
  it('CI-U04 learnedLabelIds: [] for seed-only; [id] after a label; [] with the flag off; capped at 50 in line order', async () => {
    await clearLabels(tid);
    const l0 = H.uniqLoad('U4A');
    const k1 = await A.makeClaim(an, rv, k1Files(l0), 'SHIPPER', l0);
    let seq = await H.lastSeq(owner);
    await analyzeOk(an, k1);
    expect((await analyzedEvent(seq, k1.claimId)).metadata.learnedLabelIds, 'seed-only nearest').toEqual([]);
    const lab = await I.put(rv, '/charge-labels', { description: 'Pallet jack rental', category: 'accessorial' });
    const l1 = H.uniqLoad('U4B');
    const p2 = await A.makeClaim(an, rv, p1Files(l1), 'SHIPPER', l1);
    seq = await H.lastSeq(owner);
    await analyzeOk(an, p2);
    const e = await analyzedEvent(seq, p2.claimId);
    expect(e.metadata.learnedLabelIds).toEqual([lab.body.label.id]);
    expect(Object.keys(e.metadata).sort()).toEqual([...A.P7_ANALYZED_KEYS].sort());
    await I.setFlag(dev, 'intelligence.charge_suggestions', false, 'acceptance U04 flag off');
    try {
      const l2 = H.uniqLoad('U4C');
      const p3 = await A.makeClaim(an, rv, p1Files(l2), 'SHIPPER', l2);
      seq = await H.lastSeq(owner);
      await analyzeOk(an, p3);
      expect((await analyzedEvent(seq, p3.claimId)).metadata.learnedLabelIds).toEqual([]);
    } finally {
      await I.setFlag(dev, 'intelligence.charge_suggestions', true, 'acceptance U04 flag on');
    }
    // 60 distinct labelled LRN lines -> exactly the first 50 label ids in line order
    await clearLabels(tid);
    const descs = Array.from({ length: 60 }, (_, i) => `Cap probe service ${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`);
    const ids: string[] = [];
    for (const d of descs) {
      const r = await I.put(rv, '/charge-labels', { description: d, category: 'accessorial' });
      expect(r.status, r.text).toBe(200);
      ids.push(r.body.label.id);
    }
    const l3 = H.uniqLoad('U4D');
    const big = await A.makeClaim(an, rv, [A.invoiceFile(l3, descs.map((d, i) => [d, `${10 + i}.00`] as [string, string])), A.rateFile(l3, { linehaul: '1500.00' })], 'SHIPPER', l3);
    seq = await H.lastSeq(owner);
    const r = await analyzeOk(an, big);
    expect(r.body.analysis.learnedFindingsCount).toBe(60);
    expect((await analyzedEvent(seq, big.claimId)).metadata.learnedLabelIds).toEqual(ids.slice(0, 50));
    await clearLabels(tid);
  }, 300000);
  it.skipIf(A.SKIP_BULK)('CI-A21 one label snapshot per bulk request; a label written after the request started does not change it; a later single analyze uses it', async () => {
    reseed();
    await signIn();
    await clearLabels(tid);
    const made: A.Made[] = [];
    for (let i = 0; i < 3; i++) {
      const l = H.uniqLoad(`A21${i}`);
      made.push(await A.makeClaim(an, rv, p1Files(l), 'SHIPPER', l));
    }
    const seq = await H.lastSeq(owner);
    const [b, put] = await Promise.all([A.bulk(an, { limit: 10 }), I.put(rv, '/charge-labels', { description: 'Pallet jack rental', category: 'accessorial' })]);
    expect(b.status, b.text).toBe(200);
    expect(put.status, put.text).toBe(200);
    const evs = (await A.eventsSince(owner, seq, 'claim.analyzed')).filter((e: any) => made.some((m) => m.claimId === e.targetId));
    expect(evs).toHaveLength(3);
    const counts = new Set(evs.map((e: any) => e.metadata.tenantLabelCount));
    const learnedSet = new Set(evs.map((e: any) => e.metadata.learnedFindingsCount));
    expect(counts.size, 'same tenantLabelCount for every candidate of one request').toBe(1);
    expect(learnedSet.size, 'same learnedFindingsCount for every candidate of one request').toBe(1);
    const labelEv = (await A.eventsSince(owner, seq, 'charge_label.set'))[0];
    const firstAnalyzed = Math.min(...evs.map((e: any) => e.seq));
    if (labelEv && labelEv.seq > firstAnalyzed) for (const e of evs) expect(e.metadata.learnedFindingsCount, 'label committed after the request started').toBe(0);
    console.log(`[CI-A21] tenantLabelCount=${[...counts]} learned=${[...learnedSet]} labelAfterFirstAnalyzed=${labelEv ? labelEv.seq > firstAnalyzed : 'n/a'}`);
    const l = H.uniqLoad('A21S');
    const later = await A.makeClaim(an, rv, p1Files(l), 'SHIPPER', l);
    expect((await analyzeOk(an, later)).body.analysis.learnedFindingsCount).toBe(1);
    await clearLabels(tid);
  }, 300000);
});
