// REQ-20261012-hardening Tier H: T2 four-eyes label-author basis HD-F01..HD-F12 (Part C C1). Black-box over HTTP;
// audit rows and approval counts over SQL. Tests run in file order and share tenant state (Acme after reseed).
// Users: O1 OWNER, M1 MANAGER, AN1 ANALYST, V1 VIEWER (seeded); R1 seeded REVIEWER; R2, R3 new REVIEWERs; M2 a new
// MANAGER (HD-F12 needs a label author who holds demands:send - REVIEWER does not; see test-plan.md deviation note).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Session, buildTestApp, closeApps, sessionFor } from './helpers/client.js';
import * as AH from './helpers/analysis.js';
import * as D from './helpers/dd.js';
import * as F from './helpers/fe.js';
import * as X from './helpers/hardening.js';
import * as H from './helpers/imp.js';
import * as I from './helpers/intel.js';
import * as K from './helpers/keys.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
let O1: Session, M1: Session, AN1: Session, V1: Session, R1: Session, R2: Session, R3: Session, M2: Session, DEV: Session;
let tid = '';
const ref = (inf: X.Influenced) => ({ claimId: inf.made.claimId, packetId: inf.packet.id as string, revision: 1 });

beforeAll(async () => {
  await H.assertS3Reachable();
  reseed();
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50', FLAGS_CACHE_TTL_MS: '0' });
  O1 = await sessionFor(app, ACCOUNTS.OWNER);
  M1 = await sessionFor(app, ACCOUNTS.MANAGER);
  AN1 = await sessionFor(app, ACCOUNTS.ANALYST);
  V1 = await sessionFor(app, ACCOUNTS.VIEWER);
  R1 = await sessionFor(app, ACCOUNTS.REVIEWER);
  DEV = await sessionFor(app, ACCOUNTS.PLATFORM_DEV);
  R2 = (await K.newSession(app, O1, 'REVIEWER')).s;
  R3 = (await K.newSession(app, O1, 'REVIEWER')).s;
  M2 = (await K.newSession(app, O1, 'MANAGER')).s;
  tid = O1.user.tenant.id;
  await X.clearLabels(tid);
}, 240000);
afterAll(async () => { try { await I.setFlag(DEV, 'intelligence.charge_suggestions', true, 'hardening restore'); } finally { await closeApps(); reseed(); } });

describe('T2 claim A: R1 creates X, R2 changes it, R3 re-PUTs it unchanged, AN1 analyses (HD-F01..F06, F10)', () => {
  let A: X.Influenced;
  let x = '';
  it('fixture: label writes before the analysis; learnedLabelIds contains X', async () => {
    x = await X.putLabelOk(R1, X.PJ, 'accessorial', 'created');
    expect(await X.putLabelOk(R2, X.PJ, 'other', 'changed')).toBe(x);
    expect(await X.putLabelOk(M2, X.PJ, 'accessorial', 'changed')).toBe(x);
    const seq = await I.lastSeq(tid);
    expect(await X.putLabelOk(R3, X.PJ, 'accessorial', 'unchanged')).toBe(x);
    expect(await I.eventsSince(tid, seq), 'an unchanged PUT writes no audit event').toEqual([]);
    A = await X.influenced(tid, AN1, M1, AN1, [x], 'HF-A');
  }, 180000);
  it('HD-F01 R1 (label creator) approve -> 403 label_author, exact body and event, nothing written', async () => {
    await X.expectRefusal(tid, R1, ref(A), 'APPROVE', 'label_author', 'HD-F01');
  });
  it('HD-F02 R1 reject -> 403 label_author (action REJECT)', async () => {
    await X.expectRefusal(tid, R1, ref(A), 'REJECT', 'label_author', 'HD-F02');
  });
  it('HD-F03 R2 (changed the category before the analysis) refused on approve and reject', async () => {
    await X.expectRefusal(tid, R2, ref(A), 'APPROVE', 'label_author', 'HD-F03 approve');
    await X.expectRefusal(tid, R2, ref(A), 'REJECT', 'label_author', 'HD-F03 reject');
  });
  it('HD-F10 queue: R1/R2 label_author, AN1 revision_author, M1 and R3 not self-authored; no other user named', async () => {
    const exp: [Session, boolean, string | null][] = [[R1, true, 'label_author'], [R2, true, 'label_author'], [M2, true, 'label_author'], [AN1, true, 'revision_author'], [M1, false, null], [R3, false, null], [V1, false, null]];
    for (const [s, self, basis] of exp) {
      const it = await X.queueItem(s, A.made.claimId);
      expect(it, `${s.email} sees the claim`).toBeTruthy();
      expect([it.selfAuthored, it.selfAuthoredBasis], s.email).toEqual([self, basis]);
      const t = JSON.stringify(it);
      for (const u of [R1, R2, R3, M2, AN1]) expect(t.includes(u.user.id) || t.includes(u.email), `${s.email}: no user identity`).toBe(false);
    }
  });
  it('HD-F05 / HD-F06: R3 changes X after the analysis (not excluded); O1 deletes X; R1 still refused (audit chain); R3 approves 200', async () => {
    expect(await X.putLabelOk(R3, X.PJ, 'other', 'changed')).toBe(x);
    expect((await O1.destroy(`/charge-labels/${x}`)).status).toBe(204);
    await X.expectRefusal(tid, R1, ref(A), 'APPROVE', 'label_author', 'HD-F06 R1 after delete');
    await X.expectRefusal(tid, R2, ref(A), 'APPROVE', 'label_author', 'HD-F06 R2 after delete');
    const q = await X.queueItem(R3, A.made.claimId);
    expect([q.selfAuthored, q.selfAuthoredBasis], 'HD-F05 later write does not exclude').toEqual([false, null]);
    // HD-F04 + HD-F05: neither the unchanged PUT before nor the change after the analysis makes R3 a label author
    const ok = await F.approve(R3, A.made.claimId, 1);
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.claim.status).toBe('APPROVED');
  });
});

describe('T2 claim B: M2 creates Y; M1 approves; M2 sends (HD-F07, HD-F12)', () => {
  let B: X.Influenced;
  it('fixture', async () => {
    await X.clearLabels(tid);
    const y = await X.putLabelOk(M2, X.PJ, 'accessorial', 'created');
    B = await X.influenced(tid, AN1, M1, AN1, [y], 'HF-B');
  }, 180000);
  it('M2 is a label author: approve refused with label_author', async () => {
    await X.expectRefusal(tid, M2, ref(B), 'APPROVE', 'label_author', 'M2 approve');
  });
  it('HD-F07 M1 (no label writes, not the analyser) approves: 200, claim APPROVED', async () => {
    const r = await F.approve(M1, B.made.claimId, 1);
    expect(r.status, r.text).toBe(200);
    expect(r.body.claim.status).toBe('APPROVED');
  });
  it('HD-F12 send-ready by the label author M2 after M1 approved: 200 (send is not restricted by the basis)', async () => {
    const r = await F.send(M2, B.made.claimId, 1);
    expect(r.status, r.text).toBe(200);
    expect(r.body.claim.status).toBe('SEND_READY');
  });
});

describe('T2 precedence and flag (HD-F08, HD-F09)', () => {
  it('HD-F08 O1 creates the label and analyses the claim: approve -> 403 basis revision_author (precedence)', async () => {
    await X.clearLabels(tid);
    const z = await X.putLabelOk(O1, X.PJ, 'accessorial', 'created');
    const C = await X.influenced(tid, AN1, M1, O1, [z], 'HF-C');
    await X.expectRefusal(tid, O1, ref(C), 'APPROVE', 'revision_author', 'HD-F08');
    const q = await X.queueItem(O1, C.made.claimId);
    expect([q.selfAuthored, q.selfAuthoredBasis]).toEqual([true, 'revision_author']);
  }, 180000);
  it('HD-F09 claim analysed with the charge-suggestions flag off (learnedLabelIds empty): the label creator approves 200', async () => {
    await X.clearLabels(tid);
    await X.putLabelOk(R1, X.PJ, 'accessorial', 'created');
    await I.setFlag(DEV, 'intelligence.charge_suggestions', false, 'hardening HD-F09');
    let made: AH.Made | undefined;
    try {
      const load = H.uniqLoad('HF-D');
      made = await AH.makeClaim(AN1, M1, X.pjFiles(load), 'SHIPPER', load);
      await X.analyzeOk(AN1, made.claimId);
    } finally {
      await I.setFlag(DEV, 'intelligence.charge_suggestions', true, 'hardening HD-F09 restore');
    }
    if (!made) throw new Error('HD-F09 fixture not created');
    const ev = await X.analyzedEvent(tid, made.claimId);
    expect(ev.metadata.learnedLabelIds ?? [], 'flag off: no label influence').toEqual([]);
    const q = await X.queueItem(R1, made.claimId);
    expect([q.selfAuthored, q.selfAuthoredBasis]).toEqual([false, null]);
    const r = await F.approve(R1, made.claimId, 1);
    expect(r.status, r.text).toBe(200);
  }, 180000);
});

describe('T2 D&D editor basis on the queue (HD-F10 D&D part, HD-F11)', () => {
  it('the D&D invoice creator sees dd_invoice_editor; the auditor revision_author; refusals keep basis dd_invoice_editor', async () => {
    const tariff = await D.newTariff(O1, D.MAERSK);
    const inv = await D.newInvoice(AN1, { ...D.si4(), invoiceNumber: D.uniq('SYN-DD-HDF') }, tariff);
    const a = await D.audit(M2, inv.id);
    expect(a.status, a.text).toBe(201);
    const claimId = a.body.claim.id as string;
    const editor = await X.queueItem(AN1, claimId);
    expect([editor.selfAuthored, editor.selfAuthoredBasis]).toEqual([true, 'dd_invoice_editor']);
    const auditor = await X.queueItem(M2, claimId);
    expect([auditor.selfAuthored, auditor.selfAuthoredBasis]).toEqual([true, 'revision_author']);
    const other = await X.queueItem(R3, claimId);
    expect([other.selfAuthored, other.selfAuthoredBasis]).toEqual([false, null]);
    // the editor needs packets:approve to reach the four-eyes check: a REVIEWER editor (DD-X11 pattern)
    const inv2 = await D.newInvoice(R2, { ...D.si4(), invoiceNumber: D.uniq('SYN-DD-HDF2') }, tariff);
    const a2 = await D.audit(M2, inv2.id);
    expect(a2.status, a2.text).toBe(201);
    const pk = (await V1.get(`/claims/${a2.body.claim.id}/packet`)).body;
    await X.expectRefusal(tid, R2, { claimId: a2.body.claim.id, packetId: pk.id, revision: 1 }, 'APPROVE', 'dd_invoice_editor', 'HD-F11 D&D editor');
  }, 180000);
  it('audit chain valid after T2', async () => {
    expect((await O1.get('/audit/verify')).body.valid).toBe(true);
  });
});
