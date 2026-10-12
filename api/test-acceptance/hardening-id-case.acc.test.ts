/* eslint-disable */
// REQ-20261012-hardening fix round 2, Tier H: C-FR2.1 (H-1) UUID path parameters are canonicalised to lower case at the
// request boundary; audit targetIds come from the loaded row. Black-box over HTTP; audit rows over owner SQL.
// FR2-C01 (a) upper-case PUT /dd/invoices/{ID} by E, later edit by F, audit by M -> E approve 403 four-eyes (basis
//   dd_invoice_editor); E is only in the audit chain (not created_by, not updated_by).
// FR2-C02 (b) upper-case POST /claims/{ID}/analyze, then approval by the author of an influencing label -> 403 four-eyes
//   (basis label_author), both with the lower-case and the upper-case approve URL.
// FR2-C03 (c) every audit row written by these requests has target_id = lower(target_id); metadata ids are lower case;
//   no response body carries the upper-case id.
// FR2-C04 mixed-case GET of the claim, its packet and the D&D invoice returns the same body as the lower-case GET.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Res, type Session, buildTestApp, closeApps, sessionFor } from './helpers/client.js';
import * as AH from './helpers/analysis.js';
import * as D from './helpers/dd.js';
import { withAdmin } from './helpers/db.js';
import * as F from './helpers/fe.js';
import * as X from './helpers/hardening.js';
import * as H from './helpers/imp.js';
import * as I from './helpers/intel.js';
import * as K from './helpers/keys.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
let O1: Session, M1: Session, AN1: Session, V1: Session, E: Session, Fx: Session, C: Session, M2: Session, RN: Session, RL: Session;
let tid = '';

const up = (id: string) => id.toUpperCase();
const mixed = (id: string) => id.split('').map((ch, i) => (i % 2 ? ch.toUpperCase() : ch)).join('');
/** No response body carries the non-canonical form of the id (responses use the lower-case form). */
const noUpper = (r: Res, id: string, label: string) => {
  expect(r.text.includes(up(id)), `${label}: response must not echo the upper-case id`).toBe(false);
  expect(r.text.includes(mixed(id)), `${label}: response must not echo the mixed-case id`).toBe(false);
};
/** C-FR2.1 (c): every audit row since `seq` has target_id = lower(target_id) (owner SQL over the whole tenant chain). */
async function allTargetsLower(seq: number, label: string) {
  const bad = await withAdmin(async (c) => (await c.query(
    `select seq::int s, action, target_id from audit_events where tenant_id = $1 and seq > $2 and target_id is not null and target_id <> lower(target_id)`, [tid, seq])).rows);
  expect(bad, `${label}: audit rows with a non-lower-case target_id`).toEqual([]);
}
/** Every UUID-looking string in an event's metadata is lower case. */
const metaIdsLower = (ev: I.Ev, label: string) => {
  for (const s of I.allStrings(ev.metadata)) if (/^[0-9a-f-]{36}$/i.test(s)) expect(s, `${label}: ${ev.action} metadata id`).toBe(s.toLowerCase());
};

beforeAll(async () => {
  await H.assertS3Reachable();
  reseed();
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50', FLAGS_CACHE_TTL_MS: '0' });
  O1 = await sessionFor(app, ACCOUNTS.OWNER);
  M1 = await sessionFor(app, ACCOUNTS.MANAGER);
  AN1 = await sessionFor(app, ACCOUNTS.ANALYST);
  V1 = await sessionFor(app, ACCOUNTS.VIEWER);
  // E, F, C: REVIEWERs (E needs packets:approve to reach the four-eyes check); M2 MANAGER auditor; RN neutral; RL label author
  E = (await K.newSession(app, O1, 'REVIEWER')).s;
  Fx = (await K.newSession(app, O1, 'REVIEWER')).s;
  C = (await K.newSession(app, O1, 'REVIEWER')).s;
  M2 = (await K.newSession(app, O1, 'MANAGER')).s;
  RN = (await K.newSession(app, O1, 'REVIEWER')).s;
  RL = (await K.newSession(app, O1, 'REVIEWER')).s;
  tid = O1.user.tenant.id;
  await X.clearLabels(tid);
}, 240000);
afterAll(async () => { try { await closeApps(); } finally { reseed(); } });

describe('C-FR2.1 (a) D&D invoice edited through an upper-case id (FR2-C01, FR2-C03, FR2-C04)', () => {
  let invId = '';
  let claimId = '';
  it('fixture: C creates; E PUTs via the UPPER-CASE id; F PUTs later (last editor); M2 audits', async () => {
    const tariff = await D.newTariff(O1, D.MAERSK);
    const num = D.uniq('SYN-DD-FR2A');
    const body = (n: string) => ({ ...D.si4(), invoiceNumber: n, tariffId: tariff, calendarId: null });
    const created = await D.newInvoice(C, { ...D.si4(), invoiceNumber: num }, tariff);
    invId = created.id;
    expect(invId, 'fixture: ids are stored lower case').toBe(invId.toLowerCase());
    expect(up(invId), 'fixture: the id has letters, so upper case differs').not.toBe(invId);
    const seq = await I.lastSeq(tid);
    const pE = await D.putInvoice(E, up(invId), { version: 1, invoice: { ...body(num), dueDate: '2026-04-27' } });
    expect(pE.status, pE.text).toBe(200);
    noUpper(pE, invId, 'FR2-C03 PUT response');
    const evE = await I.eventsSince(tid, seq);
    const upd = evE.filter((e) => e.action === 'dd_invoice.updated');
    expect(upd, 'one dd_invoice.updated for the upper-case PUT').toHaveLength(1);
    expect([upd[0]!.actor_id, upd[0]!.target_type, upd[0]!.target_id], 'FR2-C03 target_id from the row').toEqual([E.user.id, 'dd_invoice', invId]);
    expect(upd[0]!.metadata.invoiceId, 'FR2-C03 metadata invoiceId lower case').toBe(invId);
    for (const e of evE) metaIdsLower(e, 'FR2-C03 PUT');
    await allTargetsLower(seq, 'FR2-C03 PUT');
    const pF = await D.putInvoice(Fx, invId, { version: 2, invoice: { ...body(num), dueDate: '2026-04-28' } });
    expect(pF.status, pF.text).toBe(200);
    const a = await D.audit(M2, invId);
    expect(a.status, a.text).toBe(201);
    claimId = a.body.claim.id as string;
    const row = await withAdmin(async (q) => (await q.query('select created_by_id, updated_by_id from dd_invoices where id = $1', [invId])).rows[0]);
    expect([row.created_by_id, row.updated_by_id], 'fixture: E is neither creator nor last editor (audit chain only)').toEqual([C.user.id, Fx.user.id]);
  }, 180000);
  it('FR2-C01 E (edited via the upper-case id) approves -> 403 four-eyes, basis dd_invoice_editor; also reject; nothing written', async () => {
    const packet = (await V1.get(`/claims/${claimId}/packet`)).body;
    await X.expectRefusal(tid, E, { claimId, packetId: packet.id, revision: 1 }, 'APPROVE', 'dd_invoice_editor', 'FR2-C01 approve');
    await X.expectRefusal(tid, E, { claimId, packetId: packet.id, revision: 1 }, 'REJECT', 'dd_invoice_editor', 'FR2-C01 reject');
    // the same refusal through an upper-case claim id in the approve URL; the event names the lower-case claim id
    const seq = await I.lastSeq(tid);
    F.expectFourEyes(await F.approve(E, up(claimId), 1), 'FR2-C01 approve via upper-case URL');
    const ev = await I.eventsSince(tid, seq);
    expect(ev.map((e) => e.action)).toEqual(['authz.four_eyes_denied']);
    expect(ev[0]!.metadata, 'FR2-C03 four-eyes metadata from the loaded rows').toEqual({ claimId, packetId: packet.id, packetRevision: 1, action: 'APPROVE', basis: 'dd_invoice_editor' });
    await allTargetsLower(seq, 'FR2-C03 approve via upper-case URL');
  });
  it('FR2-C04 mixed-case GET of the invoice, the claim and the packet = the lower-case GET', async () => {
    for (const p of [`/dd/invoices/${invId}`, `/claims/${claimId}`, `/claims/${claimId}/packet`]) {
      const lo = await V1.get(p);
      expect(lo.status, lo.text).toBe(200);
      for (const v of [p.replace(/[0-9a-f-]{36}/, (m) => up(m)), p.replace(/[0-9a-f-]{36}/, (m) => mixed(m))]) {
        const r = await V1.get(v);
        expect(r.status, `${v}: ${r.text}`).toBe(200);
        expect(r.body, `${v} returns the same resource`).toEqual(lo.body);
      }
    }
  });
  it('a neutral REVIEWER (no edit, no audit) approves: 200 (the refusal is not a blanket one)', async () => {
    const ok = await F.approve(RN, claimId, 1);
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.claim.status).toBe('APPROVED');
  });
});

describe('C-FR2.1 (b) analysis through an upper-case claim id (FR2-C02, FR2-C03, FR2-C04)', () => {
  let made: AH.Made;
  let x = '';
  let packet: any;
  it('fixture: RL creates label X; AN1 analyses via the UPPER-CASE id; claim.analyzed target_id lower; learnedLabelIds contains X', async () => {
    x = await X.putLabelOk(RL, X.PJ, 'accessorial', 'created');
    const load = H.uniqLoad('FR2B');
    made = await AH.makeClaim(AN1, M1, X.pjFiles(load), 'SHIPPER', load);
    expect(up(made.claimId)).not.toBe(made.claimId);
    const seq = await I.lastSeq(tid);
    const r = await AH.analyze(AN1, up(made.claimId));
    expect(r.status, r.text).toBe(201);
    noUpper(r, made.claimId, 'FR2-C03 analyze response');
    const evs = await I.eventsSince(tid, seq);
    const an = evs.filter((e) => e.action === 'claim.analyzed');
    expect(an, 'one claim.analyzed').toHaveLength(1);
    expect([an[0]!.target_type, an[0]!.target_id], 'FR2-C03 target_id from the row').toEqual(['claim', made.claimId]);
    expect(an[0]!.metadata.claimId, 'FR2-C03 metadata claimId').toBe(made.claimId);
    expect(an[0]!.metadata.learnedLabelIds, 'fixture: X influenced the analysis').toContain(x);
    for (const e of evs) metaIdsLower(e, 'FR2-C03 analyze');
    await allTargetsLower(seq, 'FR2-C03 analyze');
    packet = (await V1.get(`/claims/${made.claimId}/packet`)).body;
    expect(packet.claimId, 'FR2-C03 packet claimId from the row').toBe(made.claimId);
    expect(packet.revision).toBe(1);
  }, 180000);
  it('FR2-C02 RL (author of the influencing label) approve and reject -> 403 four-eyes, basis label_author; nothing written', async () => {
    const ref = { claimId: made.claimId, packetId: packet.id as string, revision: 1 };
    await X.expectRefusal(tid, RL, ref, 'APPROVE', 'label_author', 'FR2-C02 approve');
    await X.expectRefusal(tid, RL, ref, 'REJECT', 'label_author', 'FR2-C02 reject');
    const seq = await I.lastSeq(tid);
    F.expectFourEyes(await F.approve(RL, up(made.claimId), 1), 'FR2-C02 approve via upper-case URL');
    const ev = await I.eventsSince(tid, seq);
    expect(ev.map((e) => e.action)).toEqual(['authz.four_eyes_denied']);
    expect(ev[0]!.metadata, 'FR2-C03 four-eyes metadata from the loaded rows').toEqual({ claimId: ref.claimId, packetId: ref.packetId, packetRevision: 1, action: 'APPROVE', basis: 'label_author' });
    await allTargetsLower(seq, 'FR2-C03 approve via upper-case URL');
    const q = await X.queueItem(RL, made.claimId);
    expect([q.selfAuthored, q.selfAuthoredBasis], 'queue agrees with the refusal').toEqual([true, 'label_author']);
  });
  it('FR2-C04 mixed-case GET of the claim and packet = the lower-case GET', async () => {
    for (const p of [`/claims/${made.claimId}`, `/claims/${made.claimId}/packet`, `/claims/${made.claimId}/charge-lines`]) {
      const lo = await V1.get(p);
      expect(lo.status, lo.text).toBe(200);
      for (const v of [p.replace(/[0-9a-f-]{36}/, (m) => up(m)), p.replace(/[0-9a-f-]{36}/, (m) => mixed(m))]) {
        const r = await V1.get(v);
        expect(r.status, `${v}: ${r.text}`).toBe(200);
        expect(r.body, `${v} returns the same resource`).toEqual(lo.body);
      }
    }
  });
  it('M1 (no label write, not the analyser) approves: 200; audit chain valid', async () => {
    const ok = await F.approve(M1, made.claimId, 1);
    expect(ok.status, ok.text).toBe(200);
    expect((await O1.get('/audit/verify')).body.valid).toBe(true);
  });
});
