/* eslint-disable */
// REQ-20261010-step5-analysis: single analyze API AN-A01..A18, cross-tenant AN-X01..X03, audit AN-U01..U04 and the
// T14 honesty check (test-spec T5, T8, T11, T14; Part C P1-P3, P5, P7). Black-box: HTTP, audit API, SQL counts.
// The repository fixtures are uploaded with a unique load number (the seeded CLM-0001/CLM-0002 already own
// LD-5001/LD-5002 for SHIPPER, so a commit would link to them instead of creating an AWAITING claim); expected
// letters are the reference letters with that load number and the Date line substituted.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Session, allAudit, buildTestApp, claimId, closeApps, sessionFor } from './helpers/client.js';
import * as A from './helpers/analysis.js';
import { withAdmin } from './helpers/db.js';
import { LD5001_SHIPPER, LD5002_CARRIER, LD5002_CARRIER_LETTER, projectFinding, seedLetter } from './helpers/analysis-vectors.js';
import * as F from './helpers/fe.js';
import * as H from './helpers/imp.js';
import * as K from './helpers/keys.js';
import { validatePacket } from './helpers/packet.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
let an: Session, rv: Session, m: Session, owner: Session, admin: Session, vw: Session, gxm: Session, gxo: Session;
/** Acme claims analyzed in this file (for AN-X02 / AN-U02). */
const analyzedIds = new Set<string>();
const analyzedLoads = new Set<string>();
const responses: any[] = [];

let a1: A.Made; // ld5001 SHIPPER, committed and analyzed by ANALYST
let a1res: any;
let a1seq = 0;
let a1verBefore = 0;
let a7: A.Made; // AN-A07 claim, reused by AN-A17

async function analyzeOk(s: Session, made: A.Made, body: unknown = {}) {
  const r = await A.analyze(s, made.claimId, body);
  expect(r.status, `analyze ${made.claimNumber} by ${s.email}: ${r.text}`).toBe(201);
  analyzedIds.add(made.claimId);
  analyzedLoads.add(made.load);
  responses.push(r.body);
  return r;
}
/** Refusal that must leave no trace (T1 "no side effects", AN-U03). */
async function refusedNoTrace(label: string, s: Session, id: string, body: unknown, status: number, code: keyof typeof A.MSG) {
  const before = await A.snapshot(owner, id);
  const seq0 = await H.lastSeq(owner);
  const r = await A.analyze(s, id, body);
  A.expectExact(r, status, code, label);
  expect(await A.snapshot(owner, id), `${label}: no side effects`).toBe(before);
  expect(await A.eventsSince(owner, seq0, 'claim.analyzed'), `${label}: no claim.analyzed`).toEqual([]);
  return r;
}

beforeAll(async () => {
  await H.assertS3Reachable();
  reseed();
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
  an = await sessionFor(app, ACCOUNTS.ANALYST);
  rv = await sessionFor(app, ACCOUNTS.REVIEWER);
  m = await sessionFor(app, ACCOUNTS.MANAGER);
  owner = await sessionFor(app, ACCOUNTS.OWNER);
  admin = await sessionFor(app, ACCOUNTS.ADMIN);
  vw = await sessionFor(app, ACCOUNTS.VIEWER);
  gxm = await sessionFor(app, 'manager@globex.test');
  gxo = await sessionFor(app, 'owner@globex.test');
}, 180000);
afterAll(async () => { try { await K.revokeActive(owner); } finally { await closeApps(); reseed(); } });

describe('AN-A01..A06 analyze an ld5001 SHIPPER claim (ANALYST)', () => {
  it('AN-A01: 201 with the exact AnalyzeResponse; version +1 once', async () => {
    a1 = await A.ld5001Claim(an, rv, 'SHIPPER', 'A1');
    a1verBefore = (await A.dbClaim(a1.claimId)).version;
    a1seq = await H.lastSeq(owner);
    const r = await analyzeOk(an, a1, {});
    a1res = r.body;
    expect(Object.keys(r.body).sort()).toEqual(['analysis', 'claim', 'packet']);
    expect(r.body.claim).toEqual({ id: a1.claimId, status: 'PENDING_REVIEW', recoverableCents: 32500, pendingReviewCents: 15000, amountClaimedCents: 47500 });
    expect(Object.keys(r.body.packet).sort()).toEqual(['contentHash', 'id', 'revision', 'status']);
    expect(r.body.packet.id).toMatch(A.UUID_RE);
    expect(r.body.packet.revision).toBe(1);
    expect(r.body.packet.status).toBe('PENDING_REVIEW');
    expect(r.body.packet.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.body.analysis).toEqual({ rulesVersion: 'rules-v1', findingsCount: 3, pendingFindingsCount: 1, ignoredFindingsCount: 0 });
    const row = await A.dbClaim(a1.claimId);
    expect(row.version, 'claim version incremented by exactly 1').toBe(a1verBefore + 1);
    expect(await A.packetRows(a1.claimId)).toEqual([{ revision: 1, created_by_id: an.user.id, status: 'PENDING_REVIEW' }]);
    const appr = await withAdmin(async (c) => (await c.query('select count(*)::int n from approvals where claim_id = $1', [a1.claimId])).rows[0].n);
    expect(appr, 'P1: no approvals row is written').toBe(0);
  });
  it('AN-A02: GET /claims/:id shows PENDING_REVIEW, the amounts and latestPacket revision 1', async () => {
    const c = (await vw.get(`/claims/${a1.claimId}`)).body;
    expect(c).toMatchObject({ status: 'PENDING_REVIEW', recoverableCents: 32500, pendingReviewCents: 15000, amountClaimedCents: 47500, latestPacket: { revision: 1, status: 'PENDING_REVIEW' } });
  });
  it('AN-A03: packet content per P5 (author, verifier, integrity, findings, letter)', async () => {
    const p = (await vw.get(`/claims/${a1.claimId}/packet`)).body;
    validatePacket(p);
    expect(p.revision).toBe(1);
    expect(p.status).toBe('PENDING_REVIEW');
    expect(p.perspective).toBe('SHIPPER');
    expect(p.createdBy?.id).toBe(an.user.id);
    expect(p.verifier).toEqual({ status: 'NOT_RUN', checkedAt: null, note: null });
    expect(p.integrity.valid).toBe(true);
    expect(p.integrity.contentHash).toBe(a1res.packet.contentHash);
    expect(p.id).toBe(a1res.packet.id);
    expect(p.approvals).toEqual([]);
    expect(p.loadNumber).toBe(a1.load);
    expect(p.disclaimer).toBe(A.PACKET_DISCLAIMER);
    expect(p.currency).toBe('USD');
    expect(p.recoverableCents).toBe(32500);
    expect(p.pendingReviewCents).toBe(15000);
    expect(p.findings.map(projectFinding)).toEqual(LD5001_SHIPPER);
    const t = Date.parse(p.generatedAt);
    expect(Math.abs(Date.now() - t), 'generatedAt = analysis time').toBeLessThan(10 * 60_000);
    const expected = A.replaceDate(seedLetter('ld5001.json'), A.utcDate(p.generatedAt)).replaceAll('LD-5001', a1.load);
    expect(p.demandLetter).toBe(expected);
  });
  it('AN-A04: sources = linked ACCEPTED documents in link order with display name, type, sha256, size', async () => {
    const p = (await vw.get(`/claims/${a1.claimId}/packet`)).body;
    const links = (await vw.get(`/claims/${a1.claimId}/documents`)).body.items.filter((d: any) => d.status === 'ACCEPTED');
    expect(p.sources).toHaveLength(3);
    expect(p.sources.map((s: any) => [s.filename, s.docType, s.sha256, s.sizeBytes])).toEqual(links.map((d: any) => [d.displayName, d.docType, d.sha256, d.sizeBytes]));
    for (const f of a1.files) {
      const s = p.sources.find((x: any) => x.filename === f.name);
      expect(s, f.name).toBeTruthy();
      expect(s.sha256).toBe(H.sha256(f.bytes));
      expect(s.sizeBytes).toBe(f.bytes.length);
    }
    expect(p.sources.map((s: any) => s.docType).sort()).toEqual(['BILL_OF_LADING', 'INVOICE', 'RATE_CONFIRMATION']);
  });
  it('AN-A05: citations and governing clauses follow the P5 rules', async () => {
    const p = (await vw.get(`/claims/${a1.claimId}/packet`)).body;
    const src = (t: string) => p.sources.find((s: any) => s.docType === t).id as string;
    const doc = (t: string) => a1.docs.find((d) => d.docType === t);
    const inv = doc('INVOICE'), rc = doc('RATE_CONFIRMATION'), bol = doc('BILL_OF_LADING');
    const [lh, acc, det] = p.findings;
    const field = (d: any, key: string, t: string) => A.fieldCitation(an, a1, d, (x) => x.key === key, src(t));
    // INV-LINEHAUL-RATE: every unique linehaul line; clause linehaul_rate
    expect(lh.citations).toEqual([await A.lineCitation(an, a1, inv, 'Linehaul', src('INVOICE'))]);
    expect(lh.governingClause).toEqual({ ...(await field(rc, 'rate_confirmation.linehaul_rate', 'RATE_CONFIRMATION')), label: 'Contracted linehaul rate' });
    // INV-ACCESSORIAL-UNAUTH: that line; clause authorized_accessorials
    expect(acc.citations).toEqual([await A.lineCitation(an, a1, inv, 'Lumper', src('INVOICE'))]);
    expect(acc.governingClause).toEqual({ ...(await field(rc, 'rate_confirmation.authorized_accessorials', 'RATE_CONFIRMATION')), label: 'Authorized accessorials' });
    // DET-OVERBILLED: detention line, appointment (clock started at appointment), departure, rate; no max (cap not applied)
    expect(det.citations).toEqual([
      await A.lineCitation(an, a1, inv, 'Detention', src('INVOICE')),
      await field(bol, 'bol.appointment_time', 'BILL_OF_LADING'),
      await field(bol, 'bol.departure_time', 'BILL_OF_LADING'),
      await field(rc, 'rate_confirmation.detention_rate_per_hour', 'RATE_CONFIRMATION'),
    ]);
    expect(det.governingClause).toEqual({ ...(await field(rc, 'rate_confirmation.detention_free_hours', 'RATE_CONFIRMATION')), label: 'Detention free time' });
    for (const f of p.findings) for (const c of f.citations) expect(c.locator).toMatch(/^(invoice|rate_confirmation|bol)\.txt:(p\d+:)?L\d+$/);
  });
  it('AN-A06: timeline from the BOL and the invoice date, ordered by occurredAt', async () => {
    const p = (await vw.get(`/claims/${a1.claimId}/packet`)).body;
    const bolSrc = p.sources.find((s: any) => s.docType === 'BILL_OF_LADING').id;
    const invSrc = p.sources.find((s: any) => s.docType === 'INVOICE').id;
    expect(p.timeline.map((t: any) => ({ kind: t.kind, occurredAt: t.occurredAt, label: t.label, sourceId: t.sourceId }))).toEqual([
      { kind: 'ARRIVAL', occurredAt: '2025-03-03T07:45:00.000Z', label: 'Arrived at Widget Co DC 4', sourceId: bolSrc },
      { kind: 'APPOINTMENT', occurredAt: '2025-03-03T08:00:00.000Z', label: 'Appointment time', sourceId: bolSrc },
      { kind: 'DEPARTURE', occurredAt: '2025-03-03T11:30:00.000Z', label: 'Departed from Widget Co DC 4', sourceId: bolSrc },
      { kind: 'INVOICE', occurredAt: '2025-03-10T00:00:00.000Z', label: 'Invoice INV-1001 issued', sourceId: invSrc },
    ]);
  });
});

describe('AN-A07/A08 ld5002 in both perspectives', () => {
  it('AN-A07: CARRIER (POST without a body) -> DET-UNBILLED 16250; AN-E42 letter', async () => {
    const c = await A.ld5002Claim(an, rv, 'CARRIER', 'A7');
    const r = await analyzeOk(an, c, 'none');
    a7 = c;
    expect(r.body.claim).toEqual({ id: c.claimId, status: 'PENDING_REVIEW', recoverableCents: 16250, pendingReviewCents: 0, amountClaimedCents: 16250 });
    expect(r.body.analysis).toEqual({ rulesVersion: 'rules-v1', findingsCount: 1, pendingFindingsCount: 0, ignoredFindingsCount: 0 });
    const p = (await vw.get(`/claims/${c.claimId}/packet`)).body;
    validatePacket(p);
    expect(p.findings.map(projectFinding)).toEqual(LD5002_CARRIER);
    expect(p.demandLetter).toBe(A.replaceDate(LD5002_CARRIER_LETTER, A.utcDate(p.generatedAt)).replaceAll('LD-5002', c.load));
    // P5 DET-* citations: no detention line; clock started at arrival (appointment == arrival); no cap
    const src = (t: string) => p.sources.find((s: any) => s.docType === t).id as string;
    const doc = (t: string) => c.docs.find((d) => d.docType === t);
    const f = (d: any, key: string, t: string) => A.fieldCitation(an, c, d, (x) => x.key === key, src(t));
    expect(p.findings[0].citations).toEqual([
      await f(doc('BILL_OF_LADING'), 'bol.arrival_time', 'BILL_OF_LADING'),
      await f(doc('BILL_OF_LADING'), 'bol.departure_time', 'BILL_OF_LADING'),
      await f(doc('RATE_CONFIRMATION'), 'rate_confirmation.detention_rate_per_hour', 'RATE_CONFIRMATION'),
    ]);
    expect(p.findings[0].governingClause).toEqual({ ...(await f(doc('RATE_CONFIRMATION'), 'rate_confirmation.detention_free_hours', 'RATE_CONFIRMATION')), label: 'Detention free time' });
  });
  it('AN-A08: SHIPPER -> zero findings still create revision 1 with the "no amount" letter', async () => {
    const c = await A.ld5002Claim(an, rv, 'SHIPPER', 'A8');
    const r = await analyzeOk(an, c, {});
    expect(r.body.claim).toEqual({ id: c.claimId, status: 'PENDING_REVIEW', recoverableCents: 0, pendingReviewCents: 0, amountClaimedCents: 0 });
    expect(r.body.analysis).toEqual({ rulesVersion: 'rules-v1', findingsCount: 0, pendingFindingsCount: 0, ignoredFindingsCount: 1 });
    const p = (await vw.get(`/claims/${c.claimId}/packet`)).body;
    validatePacket(p);
    expect(p.findings).toEqual([]);
    expect(p.recoverableCents).toBe(0);
    expect(p.pendingReviewCents).toBe(0);
    expect(p.demandLetter).toBe(A.replaceDate(seedLetter('ld5002.json'), A.utcDate(p.generatedAt)).replaceAll('LD-5002', c.load));
  });
});

describe('AN-A09..A14 refusals change nothing', () => {
  it('AN-A09: repeat analyze -> 409 invalid_state, exact body, no side effects', async () => {
    await refusedNoTrace('AN-A09', an, a1.claimId, {}, 409, 'invalid_state');
    expect((await A.packetRows(a1.claimId)).map((r) => r.revision)).toEqual([1]);
  });
  it('AN-A10: seeded PENDING_REVIEW / APPROVED / REJECTED / SEND_READY claims -> 409', async () => {
    for (const [num, st] of [['CLM-0003', 'PENDING_REVIEW'], ['CLM-0015', 'APPROVED'], ['CLM-0019', 'REJECTED'], ['CLM-0022', 'SEND_READY']] as const) {
      const id = await claimId(m, num);
      expect((await m.get(`/claims/${id}`)).body.status, num).toBe(st);
      await refusedNoTrace(`AN-A10 ${num}`, m, id, {}, 409, 'invalid_state');
    }
  });
  it('AN-A11: random UUID -> 404, non-UUID -> 404, 65-character id -> 400', async () => {
    const seq0 = await H.lastSeq(owner);
    A.expectExact(await A.analyze(m, H.RAND_UUID), 404, 'not_found', 'random uuid');
    A.expectExact(await A.analyze(m, 'not-a-uuid'), 404, 'not_found', 'not-a-uuid');
    A.expectExact(await A.analyze(m, 'a'.repeat(65)), 400, 'validation_error', '65 chars');
    expect(await A.eventsSince(owner, seq0, 'claim.analyzed')).toEqual([]);
  });
  it('AN-A12: unknown body keys -> 400 validation_error (before 404), no side effects', async () => {
    const c = await A.smallClaim(an, rv, 'A12');
    await refusedNoTrace('AN-A12 {x:1}', m, c.claimId, { x: 1 }, 400, 'validation_error');
    await refusedNoTrace('AN-A12 {limit:1}', m, c.claimId, { limit: 1 }, 400, 'validation_error');
    A.expectExact(await A.analyze(m, H.RAND_UUID, { x: 1 }), 400, 'validation_error', 'precedence 400 before 404');
    // the claim is still analyzable afterwards
    await analyzeOk(m, c, {});
  });
  it('AN-A13: negative duplicate -> 422 analysis_input_invalid, claim stays AWAITING_ANALYSIS, no packet', async () => {
    const c = await A.badClaim(an, rv, 'A13');
    await refusedNoTrace('AN-A13', an, c.claimId, {}, 422, 'analysis_input_invalid');
    expect((await vw.get(`/claims/${c.claimId}`)).body.status).toBe('AWAITING_ANALYSIS');
    expect((await vw.get(`/claims/${c.claimId}/packet`)).status).toBe(404);
    expect(await A.packetRows(c.claimId)).toEqual([]);
  });
  it('AN-A14: finding above the INT4 cents range -> 422, no side effects', async () => {
    const load = H.uniqLoad('A14');
    const c = await A.makeClaim(an, rv, A.hugeFiles(load), 'SHIPPER', load);
    await refusedNoTrace('AN-A14', an, c.claimId, {}, 422, 'analysis_input_invalid');
    expect(await A.packetRows(c.claimId)).toEqual([]);
  });
});

describe('AN-A15..A18 the review flow continues unchanged', () => {
  it('AN-A15/A16: analyzer is a revision author (four-eyes); approvals queue selfAuthored; another approver approves, send works', async () => {
    const r1 = await F.approve(an, a1.claimId, 1);
    A.expectExact(r1, 403, 'forbidden', 'ANALYST approve');
    const c = await A.ld5001Claim(an, rv, 'SHIPPER', 'A15');
    await analyzeOk(m, c, {});
    // AN-A16
    const q = async (s: Session) => {
      const r = await s.get('/approvals?status=PENDING_REVIEW,APPROVED&pageSize=100');
      expect(r.status, r.text).toBe(200);
      return (r.body.items as any[]).find((i) => i.id === c.claimId);
    };
    const im = await q(m);
    expect(im, 'claim listed in the approvals queue').toBeTruthy();
    expect(im.packetRevision).toBe(1);
    expect(im.pendingFindingsCount).toBe(1);
    expect(im.selfAuthored).toBe(true);
    expect((await q(rv)).selfAuthored).toBe(false);
    // AN-A15
    F.expectFourEyes(await F.approve(m, c.claimId, 1, true), 'analyzer approve');
    F.expectFourEyes(await F.reject(m, c.claimId, 1), 'analyzer reject');
    const ok = await F.approve(rv, c.claimId, 1, true);
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.claim.status).toBe('APPROVED');
    const { s: m2 } = await K.newSession(app, owner, 'MANAGER');
    const sent = await F.send(m2, c.claimId, 1);
    expect(sent.status, sent.text).toBe(200);
    expect(sent.body.claim.status).toBe('SEND_READY');
  }, 180000);
  it('AN-A17: a REVIEWER creates revision 2 from revision 1; integrity valid; claim stays PENDING_REVIEW', async () => {
    const c = a7;
    expect(c, 'AN-A07 claim exists').toBeTruthy();
    const r = await rv.post(`/claims/${c.claimId}/packet/revisions`, { baseRevision: 1, demandLetter: 'Synthetic reviewed letter for AN-A17', reason: 'Acceptance review edit after analysis' });
    expect(r.status, r.text).toBe(201);
    expect(r.body.packet.revision).toBe(2);
    const p = (await vw.get(`/claims/${c.claimId}/packet`)).body;
    expect(p.revision).toBe(2);
    expect(p.integrity.valid).toBe(true);
    expect((await vw.get(`/claims/${c.claimId}`)).body.status).toBe('PENDING_REVIEW');
    const p1 = (await vw.get(`/claims/${c.claimId}/packet?revision=1`)).body;
    expect(p1.integrity.valid, 'revision 1 still verifies').toBe(true);
  });
  it('AN-A18: an analyzed claim leaves the AWAITING_ANALYSIS list and appears under PENDING_REVIEW', async () => {
    const ids = async (st: string) => ((await vw.get(`/claims?status=${st}&q=${encodeURIComponent(a1.load)}&pageSize=100`)).body.items as any[]).map((i) => i.id);
    expect(await ids('AWAITING_ANALYSIS')).not.toContain(a1.claimId);
    expect(await ids('PENDING_REVIEW')).toContain(a1.claimId);
  });
});

describe('AN-X01..X03 cross-tenant', () => {
  it('AN-X01: Globex MANAGER analyzing an Acme claim -> 404 not_found, Acme claim unchanged; Acme can still analyze it', async () => {
    const c = await A.smallClaim(an, rv, 'X1');
    await refusedNoTrace('AN-X01', gxm, c.claimId, {}, 404, 'not_found');
    await analyzeOk(m, c, {});
  });
  it('AN-X02: Acme claim.analyzed events only in the Acme chain', async () => {
    const acme = await allAudit(owner);
    const acmeAnalyzed = acme.filter((e) => e.action === 'claim.analyzed').map((e) => e.targetId);
    for (const id of analyzedIds) expect(acmeAnalyzed, `Acme chain has claim.analyzed for ${id}`).toContain(id);
    const globex = await allAudit(gxo);
    const txt = JSON.stringify(globex);
    for (const id of analyzedIds) expect(txt.includes(id), `Globex audit mentions Acme claim ${id}`).toBe(false);
    expect(globex.filter((e) => e.action === 'claim.analyzed' && analyzedIds.has(e.targetId))).toEqual([]);
  });
  it('AN-X03: Acme packet readable by Acme only; Globex GET -> 404', async () => {
    expect((await vw.get(`/claims/${a1.claimId}/packet`)).status).toBe(200);
    A.expectExact(await gxm.get(`/claims/${a1.claimId}/packet`), 404, 'not_found', 'Globex packet');
    A.expectExact(await gxm.get(`/claims/${a1.claimId}`), 404, 'not_found', 'Globex claim');
  });
});

describe('AN-U01..U04 audit', () => {
  it('AN-U01: claim.analyzed of AN-A01 has the exact P7 metadata', async () => {
    const ev = (await A.eventsSince(owner, a1seq, 'claim.analyzed')).filter((e) => e.targetId === a1.claimId);
    expect(ev).toHaveLength(1);
    const e = ev[0];
    expect(e.actor).toEqual({ id: an.user.id, role: 'ANALYST' });
    expect(e.targetType).toBe('claim');
    expect(Object.keys(e.metadata).sort()).toEqual([...A.P7_ANALYZED_KEYS].sort());
    const p = (await vw.get(`/claims/${a1.claimId}/packet?revision=1`)).body;
    const docIdBySha = new Map(a1.docs.map((d) => [d.sha256, d.id]));
    expect(e.metadata).toEqual({
      claimId: a1.claimId, claimNumber: a1.claimNumber, packetId: a1res.packet.id, revision: 1, contentHash: a1res.packet.contentHash,
      perspective: 'SHIPPER', fromStatus: 'AWAITING_ANALYSIS', toStatus: 'PENDING_REVIEW',
      documentIds: p.sources.map((s: any) => docIdBySha.get(s.sha256)),
      findingsCount: 3, pendingFindingsCount: 1, ignoredFindingsCount: 0, recoverableCents: 32500, pendingReviewCents: 15000,
      rulesVersion: 'rules-v1', bulk: false,
    });
    expect(e.metadata.contentHash).toBe(p.integrity.contentHash);
  });
  it('AN-U02: no metadata value contains a file name, party name, extracted value, letter text or e-mail', async () => {
    const all = (await allAudit(owner)).filter((e) => e.action === 'claim.analyzed');
    expect(all.length).toBeGreaterThanOrEqual(analyzedIds.size);
    const banned = ['invoice.txt', 'rate_confirmation.txt', 'bol.txt', 'invoice.csv', 'ratecon.csv', 'bol.csv', 'Acme Freight', 'Widget Co', 'Synthetic Carrier', 'Synthetic Shipper', '1500.00', '1400.00', '2118', 'INV-1001', 'INV-2002', 'DRAFT', 'Sincerely', 'Lumper', 'Detention', '@'];
    for (const e of all) {
      const t = JSON.stringify(e.metadata);
      for (const b of banned) expect(t.includes(b), `claim.analyzed metadata contains ${b}: ${t}`).toBe(false);
      for (const l of analyzedLoads) expect(t.includes(l), `load number in metadata: ${t}`).toBe(false);
    }
  });
  it('T14 honesty: no analyze response contains accurate/accuracy/guaranteed or a recovery rate', () => {
    expect(responses.length).toBeGreaterThan(0);
    for (const r of responses) expect(JSON.stringify(r)).not.toMatch(/accura|guarantee|recovery rate/i);
  });
  it('AN-U04: audit chains verify (Acme and Globex)', async () => {
    for (const s of [owner, gxo]) {
      const v = await s.get('/audit/verify');
      expect(v.status, v.text).toBe(200);
      expect(v.body.valid).toBe(true);
    }
  });
});
