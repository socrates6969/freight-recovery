/* eslint-disable */
// REQ-20261009-four-eyes, documents: FE-D01..FE-D11 and concurrency FE-P03/FE-P04 (test-spec T4, T6; Part C P1-P4, P6).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Session, buildTestApp, closeApps, expectError, sessionFor } from './helpers/client.js';
import * as F from './helpers/fe.js';
import * as H from './helpers/imp.js';
import * as K from './helpers/keys.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
let an: Session, rv: Session, mgr: Session, owner: Session, admin: Session;
const S = (s: string) => Buffer.from(s, 'utf8');

interface Refusal { label: string; actor: Session; b: string; d: string; basis: 'uploader' | 'field_editor'; events: any[] }
const refusals: Refusal[] = [];
const flags: Record<string, boolean> = {};

async function refusedAccept(label: string, actor: Session, b: string, d: string, basis: Refusal['basis'], confirmRemaining: boolean | null = true) {
  const seq0 = await H.lastSeq(owner);
  const before = await F.docState(owner, b, d);
  const res = await F.accept(actor, b, d, confirmRemaining);
  F.expectFourEyes(res, label);
  expect(await F.docState(owner, b, d), `${label}: no side effects`).toBe(before);
  expect(JSON.parse(before).st).toBe('NEEDS_REVIEW');
  const events = await F.eventsSince(owner, seq0);
  expect(events.filter((e) => F.isWorkflowEvent(e.action)), `${label}: no review.* event`).toEqual([]);
  refusals.push({ label, actor, b, d, basis, events });
  return res;
}
const flag = async (s: Session, b: string, d: string) => {
  const r = await s.get(F.docPath(b, d));
  expect(r.status, r.text).toBe(200);
  expect(typeof r.body.selfAuthored).toBe('boolean');
  return r.body.selfAuthored as boolean;
};
async function acceptOk(s: Session, b: string, d: string) {
  const r = await F.accept(s, b, d, true);
  expect(r.status, `${s.email} accept: ${r.text}`).toBe(200);
  expect(r.body.status).toBe('ACCEPTED');
  expect(typeof r.body.selfAuthored, 'accept response carries selfAuthored').toBe('boolean');
  return r;
}

beforeAll(async () => {
  await H.assertS3Reachable();
  reseed();
  app = await buildTestApp();
  an = H.wrap(await sessionFor(app, ACCOUNTS.ANALYST));
  rv = H.wrap(await sessionFor(app, ACCOUNTS.REVIEWER));
  mgr = H.wrap(await sessionFor(app, ACCOUNTS.MANAGER));
  owner = H.wrap(await sessionFor(app, ACCOUNTS.OWNER));
  admin = H.wrap(await sessionFor(app, ACCOUNTS.ADMIN));
}, 120000);
afterAll(async () => { try { await K.revokeActive(owner); H.assertRecorded('four-eyes-docs'); } finally { await closeApps(); reseed(); } });

describe('FE-D01 (h) uploader cannot accept', () => {
  it('MANAGER uploads; MANAGER accept -> 403 no side effects; REVIEWER accept -> 200', async () => {
    const { batchId: b, doc, res } = await F.flaggedPdf(mgr, 'FD1');
    expect(res.body.selfAuthored, 'upload response for the uploader').toBe(true);
    flags['D01 uploader'] = await flag(mgr, b, doc.id);
    flags['D01 uninvolved'] = await flag(rv, b, doc.id);
    await refusedAccept('FE-D01', mgr, b, doc.id, 'uploader');
    const ok = await acceptOk(rv, b, doc.id);
    expect(ok.body.selfAuthored).toBe(false);
    expect(flags['D01 uploader']).toBe(true);
    expect(flags['D01 uninvolved']).toBe(false);
  });
});

describe('FE-D02 (h) a CORRECT editor cannot accept', () => {
  it('ANALYST uploads; REVIEWER corrects a field; REVIEWER accept -> 403; MANAGER accept -> 200', async () => {
    const { batchId: b, doc, res } = await F.flaggedPdf(an, 'FD2');
    expect(res.body.selfAuthored).toBe(true);
    expect(await flag(rv, b, doc.id), 'before the correction').toBe(false);
    const c = await F.resolveF(rv, b, doc.id, F.fid(doc, 'rate_confirmation.linehaul_rate'), { action: 'CORRECT', correctedValue: '1401.00' });
    expect(c.status, c.text).toBe(200);
    flags['D02 uploader'] = await flag(an, b, doc.id);
    flags['D02 corrector'] = await flag(rv, b, doc.id);
    flags['D02 uninvolved'] = await flag(mgr, b, doc.id);
    expect([flags['D02 uploader'], flags['D02 corrector'], flags['D02 uninvolved']]).toEqual([true, true, false]);
    await refusedAccept('FE-D02', rv, b, doc.id, 'field_editor');
    await acceptOk(mgr, b, doc.id);
  });
});

describe('FE-D03 an ADD editor cannot accept', () => {
  it('ANALYST uploads an image; REVIEWER sets the type and ADDs the load number; REVIEWER accept -> 403; MANAGER accept -> 200', async () => {
    const b = await H.newBatch(an);
    const d = await H.putOk(an, b, 'scan.png', H.buildPng());
    expect(d.status).toBe('NEEDS_REVIEW');
    expect(d.selfAuthored).toBe(true);
    const t = await rv.patch(F.docPath(b, d.id), { docType: 'RATE_CONFIRMATION' });
    expect(t.status, t.text).toBe(200);
    expect(t.body.selfAuthored, 'set-type response; SET_TYPE does not make an editor').toBe(false);
    const add = await rv.post(`${F.docPath(b, d.id)}/fields`, { key: 'rate_confirmation.load_number', value: H.uniqLoad('FD3'), reason: F.R });
    expect(add.status, add.text).toBe(201);
    expect([await flag(an, b, d.id), await flag(rv, b, d.id), await flag(mgr, b, d.id)]).toEqual([true, true, false]);
    await refusedAccept('FE-D03', rv, b, d.id, 'field_editor');
    await acceptOk(mgr, b, d.id);
  });
});

describe('FE-D04/D05 CONFIRM, field REJECT and SET_TYPE do not make an editor', () => {
  it('FE-D04: REVIEWER confirms fields only, then accepts -> 200', async () => {
    const { batchId: b, doc } = await F.flaggedPdf(an, 'FD4');
    for (const f of (doc.fields as any[]).filter((x) => x.needsReview).slice(0, 3)) {
      const r = await F.resolveF(rv, b, doc.id, f.id, { action: 'CONFIRM' });
      expect(r.status, r.text).toBe(200);
    }
    expect(await flag(rv, b, doc.id)).toBe(false);
    const ok = await acceptOk(rv, b, doc.id);
    expect(ok.body.selfAuthored).toBe(false);
  });
  it('FE-D05a: REVIEWER rejects a field, then accepts -> 200', async () => {
    const { batchId: b, doc } = await F.flaggedPdf(an, 'FD5');
    const r = await F.resolveF(rv, b, doc.id, F.fid(doc, 'rate_confirmation.fuel_surcharge'), { action: 'REJECT' });
    expect(r.status, r.text).toBe(200);
    expect(await flag(rv, b, doc.id)).toBe(false);
    await acceptOk(rv, b, doc.id);
  });
  it('FE-D05b: REVIEWER sets the document type (MANAGER adds the field), REVIEWER accepts -> 200', async () => {
    const b = await H.newBatch(an);
    const d = await H.putOk(an, b, 'scan.png', H.buildPng());
    expect((await rv.patch(F.docPath(b, d.id), { docType: 'BILL_OF_LADING' })).status).toBe(200);
    const add = await mgr.post(`${F.docPath(b, d.id)}/fields`, { key: 'bol.load_number', value: H.uniqLoad('FD5'), reason: F.R });
    expect(add.status, add.text).toBe(201);
    expect(await flag(rv, b, d.id)).toBe(false);
    expect(await flag(mgr, b, d.id)).toBe(true);
    await acceptOk(rv, b, d.id);
  });
});

let rejectedDoc: { b: string; d: string } | null = null;
describe('FE-D06 document reject is unrestricted', () => {
  it('the uploader rejects their own NEEDS_REVIEW document -> 200 REJECTED', async () => {
    const { batchId: b, doc } = await F.flaggedPdf(mgr, 'FD6');
    const r = await F.rejectDoc(mgr, b, doc.id);
    expect(r.status, r.text).toBe(200);
    expect(r.body.status).toBe('REJECTED');
    expect(r.body.selfAuthored, 'reject response carries the flag (uploader)').toBe(true);
    rejectedDoc = { b, d: doc.id };
  });
});

describe('FE-D07 precedence', () => {
  it('uploader without confirmRemaining -> 403 (not 409 unresolved_fields); on ACCEPTED/REJECTED -> 409 invalid_state', async () => {
    const { batchId: b, doc } = await F.flaggedPdf(mgr, 'FD7');
    await refusedAccept('FE-D07 no confirmRemaining', mgr, b, doc.id, 'uploader', null);
    await refusedAccept('FE-D07 confirmRemaining:false', mgr, b, doc.id, 'uploader', false);
    expectError(await F.accept(rv, b, doc.id), 409, 'unresolved_fields'); // control: a non-editor gets the old error
    await acceptOk(rv, b, doc.id);
    expectError(await F.accept(mgr, b, doc.id, true), 409, 'invalid_state');
    expect(rejectedDoc).toBeTruthy();
    expectError(await F.accept(mgr, rejectedDoc!.b, rejectedDoc!.d, true), 409, 'invalid_state');
  });
});

describe('FE-D08 API-key uploads are attributed to the key creator', () => {
  it('uploadedBy = ADMIN; ADMIN accept -> 403 (uploader); key accept refused as before; REVIEWER accept -> 200', async () => {
    const k = await K.mkKey(admin, ['imports.write']);
    const nb = await K.keyReq(app, k.secret, 'POST', '/imports', { body: { label: 'four-eyes key batch' } });
    expect(nb.status, nb.text).toBe(201);
    const b = nb.body.id;
    const up = await K.keyReq(app, k.secret, 'POST', `/imports/${b}/documents?filename=rc.pdf`, { raw: H.buildPdf(F.rcLines(H.uniqLoad('FD8'))) });
    expect(up.status, up.text).toBe(201);
    const d = up.body.id;
    expect(up.body.status).toBe('NEEDS_REVIEW');
    let item: any = null;
    for (let p = 1; p < 30 && !item; p++) {
      const q = await rv.get(`/reviews?page=${p}&pageSize=100`);
      expect(q.status).toBe(200);
      item = q.body.items.find((i: any) => i.documentId === d) ?? null;
      if (q.body.items.length < 100) break;
    }
    expect(item, 'document in the review queue').toBeTruthy();
    expect(item.uploadedBy?.id).toBe(admin.user.id);
    expect(await flag(admin, b, d)).toBe(true);
    await refusedAccept('FE-D08 key creator', admin, b, d, 'uploader');
    const kr = await K.keyReq(app, k.secret, 'POST', `/imports/${b}/documents/${d}/accept`, { body: { reason: F.R, confirmRemaining: true } });
    expect(kr.status, kr.text).toBe(403);
    expect(kr.body.error.code).toBe('forbidden');
    await acceptOk(rv, b, d);
    await K.revokeActive(owner);
  });
});

describe('FE-D11 uploader who also corrected', () => {
  it('MANAGER uploads and corrects; MANAGER accept -> 403 with basis uploader', async () => {
    const { batchId: b, doc } = await F.flaggedPdf(mgr, 'FD11');
    const c = await F.resolveF(mgr, b, doc.id, F.fid(doc, 'rate_confirmation.carrier'), { action: 'CORRECT', correctedValue: 'Other Carrier LLC' });
    expect(c.status, c.text).toBe(200);
    await refusedAccept('FE-D11', mgr, b, doc.id, 'uploader');
    await acceptOk(rv, b, doc.id);
  });
});

describe('FE-D09/D10 flags and audit summary', () => {
  it('FE-D09 flags recorded above: uploader true, editor true, uninvolved false', () => {
    expect(flags).toEqual({ 'D01 uploader': true, 'D01 uninvolved': false, 'D02 uploader': true, 'D02 corrector': true, 'D02 uninvolved': false });
  });
  it('FE-D10: one authz.four_eyes_denied per refusal with the exact metadata; chain valid', async () => {
    expect(refusals.map((r) => r.label)).toEqual(expect.arrayContaining(['FE-D01', 'FE-D02', 'FE-D03', 'FE-D08 key creator', 'FE-D11']));
    for (const r of refusals) {
      const fe = r.events.filter((e) => e.action === 'authz.four_eyes_denied');
      expect(fe, `${r.label}: one event`).toHaveLength(1);
      const e = fe[0];
      expect(e.actor, r.label).toEqual({ id: r.actor.user.id, role: r.actor.user.role });
      expect(e.targetType, r.label).toBe('import_document');
      expect(e.targetId, r.label).toBe(r.d);
      expect(e.metadata, r.label).toEqual({ documentId: r.d, batchId: r.b, action: 'ACCEPT', basis: r.basis });
      expect(r.events.filter((x) => x.action === 'authz.denied'), `${r.label}: no authz.denied`).toEqual([]);
    }
    const v = await owner.get('/audit/verify');
    expect(v.body.valid).toBe(true);
  });
});

describe('FE-P03/P04 (g) concurrency on one document (20 rounds each)', () => {
  it('FE-P03: CORRECT and accept by the same reviewer: never both 200; consistent pairs; never 500', async () => {
    const seen: Record<string, number> = {};
    for (let i = 0; i < 20; i++) {
      const { batchId: b, doc } = await F.flaggedPdf(an, 'FP3');
      const f = F.fid(doc, 'rate_confirmation.linehaul_rate');
      const [rc, ra] = await Promise.all([F.resolveF(rv, b, doc.id, f, { action: 'CORRECT', correctedValue: '1399.00' }), F.accept(rv, b, doc.id, true)]);
      for (const r of [rc, ra]) expect(r.status, `round ${i}: ${r.text}`).not.toBe(500);
      if (ra.status === 200) {
        expectError(rc, 409, 'invalid_state');
        seen['accept-then-correct'] = (seen['accept-then-correct'] ?? 0) + 1;
      } else {
        expect(rc.status, `round ${i} correct: ${rc.text}`).toBe(200);
        F.expectFourEyes(ra, `round ${i} accept`);
        seen['correct-then-accept'] = (seen['correct-then-accept'] ?? 0) + 1;
        const st = (await owner.get(F.docPath(b, doc.id))).body;
        expect(st.status).toBe('NEEDS_REVIEW');
        expect(st.decisions.filter((x: any) => x.action === 'ACCEPT')).toEqual([]);
      }
    }
    console.log(`[FE-P03] serial orders ${JSON.stringify(seen)}`);
  }, 600000);
  it('FE-P04: accept by the uploader and by REVIEWER concurrently -> exactly one 200 (REVIEWER)', async () => {
    const seen: Record<string, number> = {};
    for (let i = 0; i < 20; i++) {
      const { batchId: b, doc } = await F.flaggedPdf(mgr, 'FP4');
      const [ru, rr] = await Promise.all([F.accept(mgr, b, doc.id, true), F.accept(rv, b, doc.id, true)]);
      for (const r of [ru, rr]) expect(r.status, `round ${i}: ${r.text}`).not.toBe(500);
      expect(rr.status, `round ${i} reviewer: ${rr.text}`).toBe(200);
      if (ru.status === 403) F.expectFourEyes(ru, `round ${i} uploader`);
      else expectError(ru, 409, 'invalid_state');
      seen[`${ru.status}`] = (seen[`${ru.status}`] ?? 0) + 1;
      const st = (await owner.get(F.docPath(b, doc.id))).body;
      const acc = st.decisions.filter((x: any) => x.action === 'ACCEPT');
      expect(acc).toHaveLength(1);
      expect(acc[0].actor?.id ?? acc[0].actorId ?? null).not.toBe(mgr.user.id);
    }
    console.log(`[FE-P04] uploader outcomes ${JSON.stringify(seen)}`);
  }, 600000);
});

describe('regression: imp-review concurrent accept by two non-editors still has exactly one winner', () => {
  it('ANALYST-uploaded document, REVIEWER and MANAGER accept concurrently -> [200, 409]', async () => {
    const { batchId: b, doc } = await F.flaggedPdf(an, 'FPR');
    const as = await Promise.all([F.accept(rv, b, doc.id, true), F.accept(mgr, b, doc.id, true)]);
    expect(as.map((r) => r.status).sort(), as.map((r) => r.text).join(' | ')).toEqual([200, 409]);
  });
});
void S;
