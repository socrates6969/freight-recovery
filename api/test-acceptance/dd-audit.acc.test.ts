// REQ-20261011-ocean-dd Tier H (written now; run after the owner's go-ahead): T12 audit run, claim and packet
// (DD-X01..X09; Part C C12, C17, C20) and T13 dd_invoice.audited event (DD-E01, DD-E02; C15). Black-box over HTTP; audit
// rows and claim counts over SQL. Expected values restated from test-spec T3 SI-4 / SI-6 / SI-8 and Part C.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, ALL_ROLES, type RoleName, type Session, buildTestApp, closeApps, sessionFor } from './helpers/client.js';
import * as A from './helpers/analysis.js';
import * as D from './helpers/dd.js';
import { withAdmin } from './helpers/db.js';
import * as F from './helpers/fe.js';
import * as I from './helpers/intel.js';
import * as K from './helpers/keys.js';
import { reseed } from './helpers/seed.js';

interface Shared { [k: string]: unknown; DD_REGULATION_TEXT: Record<string, string>; auditDdInvoice(a: unknown): { findings: unknown[] }; buildDdDisputeLetter(i: unknown, r: unknown, today: string): string }
const REGULATION_SHA256 = '202c5302ca6360d4c75bc9e172f8096a9c9e24675b09eb29bedb3b4a5f8e37b1';
const REGULATION_BYTES = 5062;
let app: FastifyInstance;
let SS: Record<RoleName, Session>;
let R: Shared;
let tid = '';
let maersk = '';
let hapag = '';
let hapagCal = '';
const strip = (b: Record<string, unknown>) => { const { tariffId: _t, calendarId: _c, ...rest } = b; void _t; void _c; return rest; };
const claimCount = (invoiceNumber: string) => withAdmin(async (c) => Number((await c.query(`select count(*)::int n from claims where tenant_id = $1 and kind = 'OCEAN_DD' and invoice_number = $2`, [tid, invoiceNumber])).rows[0].n));

beforeAll(async () => {
  reseed();
  R = (await import('@fr/shared')) as unknown as Shared;
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50', FLAGS_CACHE_TTL_MS: '0' });
  SS = {} as Record<RoleName, Session>;
  for (const r of ALL_ROLES) SS[r] = await sessionFor(app, ACCOUNTS[r]);
  tid = SS.OWNER.user.tenant.id;
  maersk = await D.newTariff(SS.OWNER, D.MAERSK);
  hapag = await D.newTariff(SS.OWNER, D.HAPAG);
  hapagCal = await D.newCalendar(SS.OWNER, D.HAPAG_CAL);
}, 180000);
afterAll(async () => { try { await closeApps(); } finally { reseed(); } });

describe('T12 audit run, claim and packet (C12, C17)', () => {
  let made: { invoiceId: string; claimId: string; claimNumber: string; packetId: string; contentHash: string; day0: string; day1: string } | null = null;
  it('DD-X01 audit SI-4 as ANALYST: 201 response; claim row kind OCEAN_DD with the C17 fields; next claim number', async () => {
    // only numeric CLM-nnnn numbers count (the seed also has CLM-HOSTILE-* numbers; Tier H run a8a299a, test design)
    const before: number[] = [];
    for (let page = 1; ; page++) {
      const l = await SS.VIEWER.get(`/claims?pageSize=100&page=${page}`);
      expect(l.status, l.text).toBe(200);
      for (const c of l.body.items as { claimNumber: string }[]) if (/^CLM-\d{4,}$/.test(c.claimNumber)) before.push(Number(c.claimNumber.slice(4)));
      if (page * 100 >= l.body.total) break;
    }
    const inv = await D.newInvoice(SS.ANALYST, D.si4(), maersk);
    const seq = await I.lastSeq(tid);
    const day0 = A.utcDate(new Date().toISOString());
    const r = await D.audit(SS.ANALYST, inv.id);
    const day1 = A.utcDate(new Date().toISOString());
    expect(r.status, r.text).toBe(201);
    (R.DdAuditResponse as { parse(v: unknown): unknown }).parse(r.body);
    expect(r.body.invoiceId).toBe(inv.id);
    expect(r.body.claim).toMatchObject({ status: 'PENDING_REVIEW', recoverableCents: 29000, pendingReviewCents: 391000, amountClaimedCents: 420000 });
    expect(r.body.packet).toMatchObject({ revision: 1, status: 'PENDING_REVIEW' });
    expect(r.body.audit).toEqual({ rulesVersion: 'dd-rules-v1', findingsCount: 2, pendingFindingsCount: 1 });
    expect(r.body.claim.claimNumber).toMatch(/^CLM-\d{4,}$/);
    expect(Number(r.body.claim.claimNumber.slice(4))).toBeGreaterThan(Math.max(0, ...before));
    const c = await SS.VIEWER.get(`/claims/${r.body.claim.id}`);
    expect(c.status, c.text).toBe(200);
    expect(c.body).toMatchObject({ kind: 'OCEAN_DD', perspective: 'SHIPPER', loadNumber: null, invoiceNumber: 'SYN-DD-0001', carrierName: 'Synthetic Ocean Line A', shipperName: 'Synthetic Importer Inc', status: 'PENDING_REVIEW', claimNumber: r.body.claim.claimNumber });
    expect(new Date(c.body.invoiceDate).toISOString()).toBe('2026-03-27T00:00:00.000Z');
    made = { invoiceId: inv.id, claimId: r.body.claim.id, claimNumber: r.body.claim.claimNumber, packetId: r.body.packet.id, contentHash: r.body.packet.contentHash, day0, day1 };
    // DD-E01 dd_invoice.audited
    const evs = await I.eventsSince(tid, seq);
    expect(evs.map((e) => [e.action, e.target_type, e.target_id])).toEqual([['dd_invoice.audited', 'claim', r.body.claim.id]]);
    const m = evs[0]?.metadata;
    expect(I.keysOf(m)).toEqual(D.AUDIT_KEYS.audited);
    const detail = await D.getInvoice(SS.VIEWER, inv.id);
    const snapshot = { invoice: strip(detail.body.invoice), tariff: D.MAERSK, calendar: null, rulesVersion: 'dd-rules-v1' };
    expect(m).toEqual({
      invoiceId: inv.id, claimId: r.body.claim.id, claimNumber: r.body.claim.claimNumber, packetId: r.body.packet.id, revision: 1, contentHash: r.body.packet.contentHash,
      rulesVersion: 'dd-rules-v1', findingsCount: 2, pendingFindingsCount: 1, recoverableCents: 29000, pendingReviewCents: 391000, snapshotSha256: D.sha256Canon(snapshot), tariffId: maersk, calendarId: null,
    });
    D.noFreeText(evs, ['SYN-DD-0001', 'Synthetic Ocean Line A', 'Synthetic Importer Inc', 'SYNU0000001', 'SYNBL0001', 'Maersk']);
  });
  it('DD-X02 packet: disclaimer, letter, sources in order with canonical sha256/sizes', async () => {
    if (!made) throw new Error('DD-X01 did not run');
    const p = await SS.VIEWER.get(`/claims/${made.claimId}/packet`);
    expect(p.status, p.text).toBe(200);
    expect(p.body.disclaimer).toBe(D.DD_PACKET_DISCLAIMER);
    expect([p.body.revision, p.body.perspective, p.body.loadNumber, p.body.status]).toEqual([1, 'SHIPPER', null, 'PENDING_REVIEW']);
    const detail = await D.getInvoice(SS.VIEWER, made.invoiceId);
    const invData = strip(detail.body.invoice);
    const result = R.auditDdInvoice({ invoice: invData, tariff: D.MAERSK, calendar: null });
    const letters = [made.day0, made.day1].map((d) => R.buildDdDisputeLetter(invData, result, d));
    expect(letters).toContain(p.body.demandLetter);
    expect(p.body.sources.map((s: { filename: string; docType: string; sha256: string; sizeBytes: number }) => [s.filename, s.docType, s.sha256, s.sizeBytes])).toEqual([
      ['dd-invoice.json', 'INVOICE', D.sha256Canon(invData), D.sizeCanon(invData)],
      ['dd-tariff.json', 'OTHER', D.sha256Canon(D.MAERSK), D.sizeCanon(D.MAERSK)],
      ['ecfr-46-cfr-541-545.5.json', 'OTHER', REGULATION_SHA256, REGULATION_BYTES],
    ]);
    expect(D.sha256Canon(R.DD_REGULATION_TEXT)).toBe(REGULATION_SHA256);
  });
  it('DD-X03 findings rows equal T3 SI-4 with locators into the snapshot sources and clauses', async () => {
    if (!made) throw new Error('DD-X01 did not run');
    const p = (await SS.VIEWER.get(`/claims/${made.claimId}/packet`)).body;
    const src = Object.fromEntries(p.sources.map((s: { filename: string; id: string }) => [s.filename, s.id]));
    expect(p.findings.map((f: Record<string, unknown>) => ({ ruleId: f.ruleId, title: f.title, amountCents: f.amountCents, needsHumanReview: f.needsHumanReview, confidence: f.confidence, explanation: f.explanation, calculation: f.calculation })))
      .toEqual(D.SI4_FINDINGS);
    for (const f of p.findings) expect(f.direction).toBe('OVERCHARGE');
    const [tariffF, contentF] = p.findings;
    expect(tariffF.citations.map((c: { sourceId: string; locator: string }) => [c.sourceId, c.locator])).toEqual([
      [src['dd-invoice.json'], 'dd-invoice.json#/containers/0/periods/0/amount'], [src['dd-invoice.json'], 'dd-invoice.json#/containers/0/periods/1/amount'],
      [src['dd-invoice.json'], 'dd-invoice.json#/containers/0/periods/2/amount'], [src['dd-invoice.json'], 'dd-invoice.json#/containers/0/evidence/clockStart'],
      [src['dd-invoice.json'], 'dd-invoice.json#/containers/0/evidence/clockStop'], [src['dd-tariff.json'], 'dd-tariff.json#/tiers']]);
    expect(tariffF.governingClause).toEqual({ sourceId: src['dd-tariff.json'], label: 'Attached tariff', locator: 'dd-tariff.json#/tiers', excerpt: 'Maersk US import detention (2026); Maersk US import detention tariff effective 01 Jan 2026' });
    // review F3: SI-4 has only an inaccurate item, so the clause is 46 CFR 541.6(b) (excerpt plain(.., 200))
    expect(contentF.governingClause).toEqual({ sourceId: src['ecfr-46-cfr-541-545.5.json'], label: '46 CFR 541.6(b)', locator: 'ecfr-46-cfr-541-545.5.json#46 CFR 541.6(b)', excerpt: D.REG_541_6B_200 });
    expect(contentF.citations).toEqual([{ sourceId: src['dd-invoice.json'], locator: 'dd-invoice.json#/containers/0/periods/0/from', excerpt: '2026-03-05' }]);
  });
  it('DD-X04 timeline: invoice, last incurred, 30-day limit (ordered by time); NVOCC has no issuance-limit note', async () => {
    if (!made) throw new Error('DD-X01 did not run');
    const p = (await SS.VIEWER.get(`/claims/${made.claimId}/packet`)).body;
    const inv = p.sources.find((s: { filename: string }) => s.filename === 'dd-invoice.json').id;
    expect(p.timeline.map((t: { occurredAt: string; kind: string; label: string; sourceId: string }) => [new Date(t.occurredAt).toISOString(), t.kind, t.label, t.sourceId])).toEqual([
      ['2026-03-20T00:00:00.000Z', 'NOTE', 'Charges last incurred', inv],
      ['2026-03-27T00:00:00.000Z', 'INVOICE', 'Invoice SYN-DD-0001 issued', inv],
      ['2026-04-19T00:00:00.000Z', 'NOTE', '30-day issuance limit (46 CFR 541.7)', inv],
    ]);
    const nv = await D.newInvoice(SS.ANALYST, { ...D.si8(), invoiceNumber: 'SYN-DD-0008' }, maersk);
    const r = await D.audit(SS.ANALYST, nv.id);
    expect(r.status, r.text).toBe(201);
    expect(r.body.claim).toMatchObject({ recoverableCents: 0, pendingReviewCents: 391000 });
    const p8 = (await SS.VIEWER.get(`/claims/${r.body.claim.id}/packet`)).body;
    expect(p8.timeline.map((t: { label: string }) => t.label)).toEqual(['Charges last incurred', 'Invoice SYN-DD-0008 issued']);
  });
  it('DD-X05 AUDITED invoice: claimId, auditedAt, snapshot preview; re-audit/PUT/DELETE 409 invalid_state; packet hash verifies; edit creates rev 2', async () => {
    if (!made) throw new Error('DD-X01 did not run');
    const g = await D.getInvoice(SS.VIEWER, made.invoiceId);
    expect([g.body.status, g.body.claimId, g.body.claimNumber]).toEqual(['AUDITED', made.claimId, made.claimNumber]);
    expect(Number.isNaN(Date.parse(g.body.auditedAt))).toBe(false);
    D.expectCode(await D.audit(SS.ANALYST, made.invoiceId), 409, 'invalid_state');
    D.expectCode(await D.putInvoice(SS.ANALYST, made.invoiceId, { version: g.body.version, invoice: g.body.invoice }), 409, 'invalid_state');
    D.expectCode(await D.delInvoice(SS.ANALYST, made.invoiceId), 409, 'invalid_state');
    const before = g.body.preview;
    const t = await SS.OWNER.get(`/dd/tariffs?pageSize=100`);
    const cur = t.body.items.find((x: { id: string }) => x.id === maersk);
    expect((await D.putTariff(SS.OWNER, maersk, { version: cur.version, data: { ...D.MAERSK, tiers: [{ days: 4, rates: D.MAERSK.tiers[0]?.rates }, { days: 4, rates: D.MAERSK.tiers[1]?.rates }, { days: null, rates: { '20DV': '1.00', '40DV': '1.00', '40HC': '1.00', '45HC': '1.00' } }] } })).status).toBe(200);
    expect((await D.getInvoice(SS.VIEWER, made.invoiceId)).body.preview, 'an audited preview never changes').toEqual(before);
    const p = (await SS.VIEWER.get(`/claims/${made.claimId}/packet`)).body;
    expect(p.integrity).toEqual({ contentHash: made.contentHash, recomputedHash: made.contentHash, valid: true });
    const rev = await F.editOk(SS.REVIEWER, made.claimId, 1);
    expect(rev).toBe(2);
  });
  it('DD-X06 four-eyes: the auditor cannot approve (four_eyes_required); another approver can with acknowledgement; send-ready works', async () => {
    const inv = await D.newInvoice(SS.MANAGER, { ...D.si4(), invoiceNumber: 'SYN-DD-0406' }, maersk);
    const r = await D.audit(SS.MANAGER, inv.id);
    expect(r.status, r.text).toBe(201);
    const id = r.body.claim.id as string;
    F.expectFourEyes(await F.approve(SS.MANAGER, id, 1));
    const ok = await F.approve(SS.REVIEWER, id, 1);
    expect(ok.status, ok.text).toBe(200);
    const sent = await F.send(SS.MANAGER, id, 1);
    expect(sent.status, sent.text).toBe(200);
    expect((await SS.VIEWER.get(`/claims/${id}`)).body.kind).toBe('OCEAN_DD');
  });
  it('DD-X07 not storable (> 2,147,483,647 cents): 422 analysis_input_invalid; nothing written', async () => {
    const big = D.si1();
    const ctr = D.c0(big);
    ctr.periods = Array.from({ length: 20 }, (_, k) => ({ from: `2026-01-${String(k + 1).padStart(2, '0')}`, to: `2026-01-${String(k + 1).padStart(2, '0')}`, rate: null, amount: '9999999.99' }));
    big.containers = Array.from({ length: 50 }, (_, k) => ({ ...D.clone(ctr), containerNumber: `SYNU${String(k).padStart(7, '0')}` }));
    big.invoiceNumber = 'SYN-DD-0707';
    big.totalDue = '9999999.99';
    const inv = await D.newInvoice(SS.ANALYST, big, null);
    const seq = await I.lastSeq(tid);
    const claimsBefore = (await SS.VIEWER.get('/claims?pageSize=1')).body.total;
    D.expectCode(await D.audit(SS.ANALYST, inv.id), 422, 'analysis_input_invalid');
    expect((await SS.VIEWER.get('/claims?pageSize=1')).body.total).toBe(claimsBefore);
    const g = await D.getInvoice(SS.VIEWER, inv.id);
    expect([g.body.status, g.body.version, g.body.claimId]).toEqual(['DRAFT', 1, null]);
    expect(await I.eventsSince(tid, seq)).toEqual([]);
  });
  it('DD-X08 concurrency: two simultaneous audits -> one 201 and one 409; one claim', async () => {
    const inv = await D.newInvoice(SS.ANALYST, { ...D.si4(), invoiceNumber: 'SYN-DD-0808' }, maersk);
    const rs = await Promise.all([D.audit(SS.ANALYST, inv.id), D.audit(SS.REVIEWER, inv.id)]);
    expect(rs.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(await claimCount('SYN-DD-0808')).toBe(1);
  });
  it('DD-X02/SI-6 HAPAG with calendar: four sources incl. dd-calendar.json; amounts per T3', async () => {
    const inv = await D.newInvoice(SS.ANALYST, D.si6(), hapag, hapagCal);
    const r = await D.audit(SS.ANALYST, inv.id);
    expect(r.status, r.text).toBe(201);
    expect(r.body.claim).toMatchObject({ recoverableCents: 30000, pendingReviewCents: 55000, amountClaimedCents: 85000 });
    const p = (await SS.VIEWER.get(`/claims/${r.body.claim.id}/packet`)).body;
    expect(p.sources.map((s: { filename: string; docType: string; sha256: string }) => [s.filename, s.docType, s.sha256])).toEqual([
      ['dd-invoice.json', 'INVOICE', D.sha256Canon(strip((await D.getInvoice(SS.VIEWER, inv.id)).body.invoice))],
      ['dd-tariff.json', 'OTHER', D.sha256Canon(D.HAPAG)], ['dd-calendar.json', 'OTHER', D.sha256Canon(D.HAPAG_CAL)], ['ecfr-46-cfr-541-545.5.json', 'OTHER', REGULATION_SHA256]]);
    const ev = (await I.eventsSince(tid, 0, 'dd_invoice.audited')).find((e) => e.metadata.invoiceId === inv.id);
    expect([ev?.metadata.tariffId, ev?.metadata.calendarId]).toEqual([hapag, hapagCal]);
  });
  it('DD-X09 compatibility: analyze -> 409 invalid_state; kind in list, detail and approval queue; never awaiting analysis', async () => {
    if (!made) throw new Error('DD-X01 did not run');
    A.expectExact(await A.analyze(SS.ANALYST, made.claimId), 409, 'invalid_state');
    const list = (await SS.VIEWER.get('/claims?pageSize=100')).body.items as { id: string; kind: string }[];
    for (const c of list) expect(c.kind, c.id).toBe(await claimKindDb(c.id));
    expect(list.find((c) => c.id === made?.claimId)?.kind).toBe('OCEAN_DD');
    const q = (await SS.REVIEWER.get('/approvals')).body.items as { id: string; kind: string }[];
    for (const c of q) expect(c.kind, `approval queue ${c.id}`).toBe(await claimKindDb(c.id));
    expect(q.some((c) => c.kind === 'OCEAN_DD'), 'the audited OCEAN_DD claim is in the approval queue').toBe(true);
    expect((await SS.VIEWER.get('/claims?status=AWAITING_ANALYSIS&pageSize=100')).body.items.some((c: { kind: string }) => c.kind === 'OCEAN_DD')).toBe(false);
    const seeded = await withAdmin(async (c) => (await c.query(`select count(*)::int n from claims where tenant_id = $1 and kind = 'FREIGHT'`, [tid])).rows[0].n as number);
    expect(seeded, 'seeded claims are FREIGHT').toBeGreaterThan(0);
  });
  it('DD-X10 auditor with approval rights: a REVIEWER auditor and a MANAGER auditor get 403 four_eyes_required on approve and reject', async () => {
    for (const s of [SS.REVIEWER, SS.MANAGER]) {
      const inv = await D.newInvoice(SS.ANALYST, { ...D.si4(), invoiceNumber: D.uniq('SYN-DD-X10') }, maersk);
      const r = await D.audit(s, inv.id);
      expect(r.status, r.text).toBe(201);
      F.expectFourEyes(await F.approve(s, r.body.claim.id, 1), `${s.email} approve`);
      F.expectFourEyes(await F.reject(s, r.body.claim.id, 1), `${s.email} reject`);
    }
  });
  it('DD-X11 invoice editors (review F1/F2): creator, intermediate and last editor refused (basis dd_invoice_editor); updated_by_id stays the last editor; selfAuthored matrix; single-editor variants; auditor refused as revision author; edit allowed', async () => {
    const r1 = (await K.newSession(app, SS.OWNER, 'REVIEWER')).s;
    const r2 = (await K.newSession(app, SS.OWNER, 'REVIEWER')).s;
    const r3 = (await K.newSession(app, SS.OWNER, 'REVIEWER')).s;
    const r4 = (await K.newSession(app, SS.OWNER, 'REVIEWER')).s;
    const m1 = (await K.newSession(app, SS.OWNER, 'MANAGER')).s;
    const body = (num: string) => ({ ...D.si4(), invoiceNumber: num, tariffId: maersk, calendarId: null });
    // main case: R1 creates, R2 PUTs, R4 PUTs last, M1 audits
    const num = D.uniq('SYN-DD-X11');
    const created = await D.newInvoice(r1, { ...D.si4(), invoiceNumber: num }, maersk);
    const invNum = num;
    const p2 = await D.putInvoice(r2, created.id, { version: 1, invoice: { ...body(invNum), dueDate: '2026-04-27' } });
    expect(p2.status, p2.text).toBe(200);
    const p4 = await D.putInvoice(r4, created.id, { version: 2, invoice: { ...body(invNum), dueDate: '2026-04-28' } });
    expect(p4.status, p4.text).toBe(200);
    const a = await D.audit(m1, created.id);
    expect(a.status, a.text).toBe(201);
    const claimId = a.body.claim.id as string;
    const row = await withAdmin(async (c) => (await c.query('select updated_by_id, version from dd_invoices where id = $1', [created.id])).rows[0]);
    expect(row.updated_by_id, 'the audit run keeps the last data editor').toBe(r4.user.id);
    expect(row.version, 'pre-audit version (3) + 1').toBe(4);
    const before = await F.claimState(SS.VIEWER, claimId);
    for (const s of [r1, r2, r4]) {
      const seq = await I.lastSeq(tid);
      F.expectFourEyes(await F.approve(s, claimId, 1), `${s.email} approve`);
      F.expectFourEyes(await F.reject(s, claimId, 1), `${s.email} reject`);
      const evs = await I.eventsSince(tid, seq);
      expect(evs.map((e) => e.action), s.email).toEqual(['authz.four_eyes_denied', 'authz.four_eyes_denied']);
      for (const e of evs) expect(e.metadata.basis, s.email).toBe('dd_invoice_editor');
    }
    expect(await F.claimState(SS.VIEWER, claimId), 'no packet or claim change').toEqual(before);
    const seqM = await I.lastSeq(tid);
    F.expectFourEyes(await F.approve(m1, claimId, 1), 'auditor approve');
    const mEv = await I.eventsSince(tid, seqM, 'authz.four_eyes_denied');
    expect(mEv).toHaveLength(1);
    expect(mEv[0]?.metadata.basis, 'the auditor is refused by the revision-author rule').not.toBe('dd_invoice_editor');
    const queue = async (s: Session) => ((await s.get('/approvals?status=PENDING_REVIEW,APPROVED&pageSize=100')).body.items as { id: string; selfAuthored: boolean }[]).find((x) => x.id === claimId)?.selfAuthored;
    for (const s of [r1, r2, r4, m1]) expect(await queue(s), `${s.email} selfAuthored`).toBe(true);
    expect(await queue(r3), 'R3 selfAuthored').toBe(false);
    // single-editor variants
    const only1 = await D.newInvoice(r1, { ...D.si4(), invoiceNumber: D.uniq('SYN-DD-X11C') }, maersk);
    const a1 = await D.audit(m1, only1.id);
    expect(a1.status, a1.text).toBe(201);
    F.expectFourEyes(await F.approve(r1, a1.body.claim.id, 1), 'creator only');
    const numP = D.uniq('SYN-DD-X11P');
    const onlyPut = await D.newInvoice(SS.ANALYST, { ...D.si4(), invoiceNumber: numP }, maersk);
    expect((await D.putInvoice(r2, onlyPut.id, { version: 1, invoice: { ...body(numP), dueDate: '2026-04-27' } })).status).toBe(200);
    const a2 = await D.audit(m1, onlyPut.id);
    expect(a2.status, a2.text).toBe(201);
    F.expectFourEyes(await F.approve(r2, a2.body.claim.id, 1), 'only PUT');
    // R1 may still edit; R3 approves with acknowledgement
    expect(await F.editOk(r1, claimId, 1), 'an invoice editor may create a revision').toBe(2);
    F.expectFourEyes(await F.approve(r1, claimId, 2), 'now also a revision author');
    const ok = await F.approve(r3, claimId, 2);
    expect(ok.status, ok.text).toBe(200);
  });
  it('DD-E02 the tenant audit chain verifies after the whole run', async () => {
    const v = await SS.OWNER.get('/audit/verify');
    expect(v.body.valid, v.text).toBe(true);
  });
});

async function claimKindDb(id: string): Promise<string> {
  return withAdmin(async (c) => (await c.query('select kind::text k from claims where id = $1', [id])).rows[0]?.k as string);
}
