/* eslint-disable */
// REQ-20261012-hardening fix round 2, Tier H: C-FR2.2 (H-4) more than 50 influencing learned labels.
// FR2-L01 exactly 50 influencing labels: learnedLabelIds = the 50 ids in line order, learnedLabelIdsTruncated absent or
//   false; the author of an in-list label is refused (label_author); the author of a tenant label that matches no charge
//   line approves 200 (existing behaviour unchanged).
// FR2-L02 60 influencing labels: learnedLabelIds = the first 50 ids in line order and learnedLabelIdsTruncated = true;
//   RT, who authored ONLY labels of lines 51..60 (not in learnedLabelIds), is refused on approve and reject with the
//   four-eyes error (basis label_author), nothing written; the in-list author is refused too.
// FR2-L03 the database guard enforces the same rule: an approvals INSERT (APPROVE / REJECT) with actor RT as freight_app in
//   a tenant transaction -> P0001 four_eyes_required; the neutral reviewer's row is not refused; all rolled back.
// FR2-L04 a neutral REVIEWER (no label writes) approves the truncated claim: 200.
// Fixture pattern: CI-U04 (charge-analysis.acc.test.ts), lines `Cap probe service <aa..>` each with an exact-text label.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Session, buildTestApp, closeApps, sessionFor } from './helpers/client.js';
import * as A from './helpers/analysis.js';
import { type PgClient, appDb } from './helpers/db.js';
import * as F from './helpers/fe.js';
import * as X from './helpers/hardening.js';
import * as H from './helpers/imp.js';
import * as I from './helpers/intel.js';
import * as K from './helpers/keys.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
let O1: Session, M1: Session, AN1: Session, V1: Session, RL: Session, RT: Session, RU: Session, RN: Session;
let tid = '';
let c: PgClient;

const descs = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `Cap probe service ${tag}${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`);
const UNRELATED = 'Synthetic quarry access toll';

/** Labels for `ds` (line order); `authorOf(i)` writes label i. Then the claim (one invoice line per label) is analysed. */
async function labelledClaim(ds: string[], authorOf: (i: number) => Session, tag: string) {
  const ids: string[] = [];
  for (let i = 0; i < ds.length; i++) ids.push(await X.putLabelOk(authorOf(i), ds[i]!, 'accessorial', 'created'));
  const load = H.uniqLoad(tag);
  const made = await A.makeClaim(AN1, M1, [A.invoiceFile(load, ds.map((d, i) => [d, `${10 + i}.00`] as [string, string])), A.rateFile(load, { linehaul: '1500.00' })], 'SHIPPER', load);
  const r = await X.analyzeOk(AN1, made.claimId);
  expect(r.body.analysis.learnedFindingsCount, 'fixture: every line is a learned finding').toBe(ds.length);
  const event = await X.analyzedEvent(tid, made.claimId);
  const packet = (await V1.get(`/claims/${made.claimId}/packet`)).body;
  expect(packet.revision).toBe(1);
  return { ids, made, event, packet };
}

beforeAll(async () => {
  await H.assertS3Reachable();
  reseed();
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50', FLAGS_CACHE_TTL_MS: '0' });
  O1 = await sessionFor(app, ACCOUNTS.OWNER);
  M1 = await sessionFor(app, ACCOUNTS.MANAGER);
  AN1 = await sessionFor(app, ACCOUNTS.ANALYST);
  V1 = await sessionFor(app, ACCOUNTS.VIEWER);
  RL = (await K.newSession(app, O1, 'REVIEWER')).s; // authors the in-list labels
  RT = (await K.newSession(app, O1, 'REVIEWER')).s; // authors only the labels past the first 50 (or the 50th)
  RU = (await K.newSession(app, O1, 'REVIEWER')).s; // authors a tenant label that matches no charge line
  RN = (await K.newSession(app, O1, 'REVIEWER')).s; // no label writes
  tid = O1.user.tenant.id;
  c = await appDb();
  expect((await c.query('select current_user u')).rows[0].u).toBe('freight_app');
}, 240000);
afterAll(async () => { try { await X.clearLabels(tid); await c?.end(); await closeApps(); } finally { reseed(); } });

describe('FR2-L01 exactly 50 influencing labels (existing behaviour unchanged)', () => {
  it('flag absent or false; ids exact; in-list author refused; non-matching label author approves 200', async () => {
    await X.clearLabels(tid);
    const u = await X.putLabelOk(RU, UNRELATED, 'accessorial', 'created');
    const ds = descs(50, 'f');
    const L = await labelledClaim(ds, (i) => (i === 49 ? RT : RL), 'FR2L1');
    expect(L.event.metadata.learnedLabelIds, 'all 50 ids in line order').toEqual(L.ids);
    expect(L.event.metadata.learnedLabelIds, 'fixture: the unrelated label did not influence').not.toContain(u);
    expect(L.event.metadata[A.TRUNC_KEY] === undefined || L.event.metadata[A.TRUNC_KEY] === false, `${A.TRUNC_KEY} absent or false: ${JSON.stringify(L.event.metadata[A.TRUNC_KEY])}`).toBe(true);
    const ref = { claimId: L.made.claimId, packetId: L.packet.id as string, revision: 1 };
    await X.expectRefusal(tid, RT, ref, 'APPROVE', 'label_author', 'FR2-L01 RT (50th label)');
    await X.expectRefusal(tid, RL, ref, 'APPROVE', 'label_author', 'FR2-L01 RL');
    const ok = await F.approve(RU, L.made.claimId, 1);
    expect(ok.status, `FR2-L01 non-matching label author: ${ok.text}`).toBe(200);
    expect(ok.body.claim.status).toBe('APPROVED');
  }, 300000);
});

describe('FR2-L02..L04 60 influencing labels (truncated)', () => {
  let L: Awaited<ReturnType<typeof labelledClaim>>;
  const ins = (s: Session, action: string, toStatus: string) =>
    X.approvalInsert({ tenant: tid, claim: L.made.claimId, packet: L.packet, action, toStatus, actorId: s.user.id, role: s.user.role });
  it('fixture + FR2-L02 metadata: learnedLabelIds = first 50 in line order; learnedLabelIdsTruncated = true', async () => {
    await X.clearLabels(tid);
    const ds = descs(60, 't');
    L = await labelledClaim(ds, (i) => (i >= 50 ? RT : RL), 'FR2L2');
    expect(L.event.metadata.learnedLabelIds).toEqual(L.ids.slice(0, 50));
    expect(L.event.metadata[A.TRUNC_KEY], 'more than 50 influencing labels').toBe(true);
    for (const id of L.ids.slice(50)) expect(L.event.metadata.learnedLabelIds, 'fixture: RT labels are past the cap').not.toContain(id);
  }, 300000);
  it('FR2-L02 RT (author of labels 51..60 only) approve and reject -> 403 four-eyes, basis label_author, nothing written', async () => {
    const ref = { claimId: L.made.claimId, packetId: L.packet.id as string, revision: 1 };
    await X.expectRefusal(tid, RT, ref, 'APPROVE', 'label_author', 'FR2-L02 RT approve');
    await X.expectRefusal(tid, RT, ref, 'REJECT', 'label_author', 'FR2-L02 RT reject');
    await X.expectRefusal(tid, RL, ref, 'APPROVE', 'label_author', 'FR2-L02 RL approve');
  });
  it('FR2-L03 database guard: approvals INSERT by RT (APPROVE, REJECT) -> P0001 four_eyes_required; RN not refused (rolled back)', async () => {
    const n0 = await X.approvalsOf(L.made.claimId);
    for (const [action, to] of [['APPROVE', 'APPROVED'], ['REJECT', 'REJECTED']] as const) {
      const o = await X.tx(c, tid, [ins(RT, action, to)], false);
      expect(o.ok, `FR2-L03 RT ${action} must fail`).toBe(false);
      expect(o.code, `FR2-L03 RT ${action}: ${o.message}`).toBe('P0001');
      expect(o.message).toBe('four_eyes_required');
    }
    const okRow = await X.tx(c, tid, [ins(RN, 'APPROVE', 'APPROVED')], false);
    expect(okRow.ok, `FR2-L03 RN not refused: ${okRow.message}`).toBe(true);
    expect(await X.approvalsOf(L.made.claimId), 'everything rolled back').toBe(n0);
  });
  it('FR2-L04 a neutral REVIEWER approves the truncated claim: 200; audit chain valid', async () => {
    const ok = await F.approve(RN, L.made.claimId, 1);
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.claim.status).toBe('APPROVED');
    expect((await O1.get('/audit/verify')).body.valid).toBe(true);
  });
});
