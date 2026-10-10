/* eslint-disable */
// REQ-20261010-step5-analysis [S] bulk analyze: AN-B01..B08, concurrency AN-C03/C04 (test-spec T6, T9; Part C P2, P7,
// P9). The whole file is should-have: ACC_SKIP_BULK=1 skips it when the leader reports the bulk feature was cut.
// Reseeds first so that no other AWAITING_ANALYSIS claims exist; tests run in file order and share tenant state:
//   C03, C04 (all good claims analyzed) -> B01, B02 (none awaiting) -> B03 (B stays, bad) -> B04 (B + 4 bad + 1 good)
//   -> B05 -> B07. B06 is asserted inside every bulk request (bulkChecked).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Session, buildTestApp, closeApps, sessionFor } from './helpers/client.js';
import * as A from './helpers/analysis.js';
import * as H from './helpers/imp.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
let an: Session, rv: Session, m: Session, owner: Session, admin: Session, gxm: Session, gxo: Session;

const awaitingCount = async (s: Session) => (await s.get('/claims?status=AWAITING_ANALYSIS&pageSize=1')).body.total as number;

/** One bulk request with the AN-B06 audit checks: exactly one claim.bulk_analyzed (P7 keys and counts) and one
 *  claim.analyzed with bulk: true per analyzed claim. */
async function bulkChecked(s: Session, body: unknown, label: string) {
  const seq0 = await H.lastSeq(owner);
  const r = await A.bulk(s, body);
  expect(r.status, `${label}: ${r.text}`).toBe(200);
  const b = r.body;
  expect(Object.keys(b).sort(), label).toEqual(['analyzed', 'examined', 'failed', 'limit', 'remaining', 'skipped']);
  expect(b.examined, `${label}: examined = analyzed + skipped + failed`).toBe(b.analyzed.length + b.skipped.length + b.failed.length);
  expect(b.analyzed.length).toBeLessThanOrEqual(b.limit);
  expect(b.examined).toBeLessThanOrEqual(Math.min(4 * b.limit, 100));
  for (const a of b.analyzed) {
    expect(Object.keys(a).sort()).toEqual(['claimId', 'claimNumber', 'findingsCount', 'packetId', 'pendingReviewCents', 'recoverableCents']);
    expect(a.packetId).toMatch(A.UUID_RE);
    const c = (await owner.get(`/claims/${a.claimId}`)).body;
    expect(c.status).toBe('PENDING_REVIEW');
    expect(c.claimNumber).toBe(a.claimNumber);
    expect([c.recoverableCents, c.pendingReviewCents]).toEqual([a.recoverableCents, a.pendingReviewCents]);
    const p = (await owner.get(`/claims/${a.claimId}/packet`)).body;
    expect(p.id).toBe(a.packetId);
    expect(p.findings).toHaveLength(a.findingsCount);
    expect(p.createdBy?.id, 'bulk requester is the author').toBe(s.user.id);
  }
  for (const x of b.skipped) { expect(Object.keys(x).sort()).toEqual(['claimId', 'claimNumber', 'code']); expect(x.code).toBe('invalid_state'); }
  for (const x of b.failed) { expect(Object.keys(x).sort()).toEqual(['claimId', 'claimNumber', 'code']); expect(x.code).toBe('analysis_input_invalid'); }
  expect(b.remaining, `${label}: remaining = AWAITING_ANALYSIS count after the run`).toBe(await awaitingCount(owner));
  const ev = await A.eventsSince(owner, seq0);
  const sum = ev.filter((e) => e.action === 'claim.bulk_analyzed');
  expect(sum, `${label}: one claim.bulk_analyzed`).toHaveLength(1);
  expect(sum[0].actor).toEqual({ id: s.user.id, role: s.user.role });
  expect(sum[0].targetType).toBe('tenant');
  expect(sum[0].targetId).toBe(s.user.tenant.id);
  expect(sum[0].metadata).toEqual({ limit: b.limit, examined: b.examined, analyzed: b.analyzed.length, skipped: b.skipped.length, failed: b.failed.length, remaining: b.remaining });
  const per = ev.filter((e) => e.action === 'claim.analyzed' && e.actor?.id === s.user.id && b.analyzed.some((a: any) => a.claimId === e.targetId));
  expect(per.map((e) => e.targetId).sort(), `${label}: one claim.analyzed per analyzed claim`).toEqual(b.analyzed.map((a: any) => a.claimId).sort());
  for (const e of per) {
    expect(e.metadata.bulk).toBe(true);
    expect(Object.keys(e.metadata).sort()).toEqual([...A.P7_ANALYZED_KEYS].sort());
  }
  expect(sum[0].seq, 'summary after the per-claim events').toBeGreaterThan(Math.max(0, ...per.map((e) => e.seq)));
  return b;
}
const ids = (xs: any[]) => xs.map((x) => x.claimId);

describe.skipIf(A.SKIP_BULK)('[S] bulk analyze', () => {
  beforeAll(async () => {
    await H.assertS3Reachable();
    reseed();
    app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
    an = await sessionFor(app, ACCOUNTS.ANALYST);
    rv = await sessionFor(app, ACCOUNTS.REVIEWER);
    m = await sessionFor(app, ACCOUNTS.MANAGER);
    owner = await sessionFor(app, ACCOUNTS.OWNER);
    admin = await sessionFor(app, ACCOUNTS.ADMIN);
    gxm = await sessionFor(app, 'manager@globex.test');
    gxo = await sessionFor(app, 'owner@globex.test');
    expect(await awaitingCount(owner), 'reseeded tenant has no AWAITING claims').toBe(0);
  }, 180000);
  afterAll(async () => { try { await closeApps(); } finally { reseed(); } });

  it('[S] AN-C03: 3 parallel bulk {limit:4} with 4 analyzable claims -> each claim analyzed once; others skipped; never 500', async () => {
    const made = [];
    for (let i = 0; i < 4; i++) made.push(await A.smallClaim(an, rv, `C3${i}`));
    const seq0 = await H.lastSeq(owner);
    const rs = await Promise.all([m, admin, owner].map((s) => A.bulk(s, { limit: 4 })));
    for (const r of rs) expect(r.status, r.text).toBe(200);
    const analyzed = rs.flatMap((r) => ids(r.body.analyzed));
    expect([...analyzed].sort(), 'union = the 4 claims, none twice').toEqual(made.map((c) => c.claimId).sort());
    for (const r of rs) {
      for (const x of r.body.skipped) expect(analyzed).toContain(x.claimId);
      expect(r.body.failed).toEqual([]);
      expect(r.body.examined).toBe(r.body.analyzed.length + r.body.skipped.length);
    }
    const ev = await A.eventsSince(owner, seq0);
    expect(ev.filter((e) => e.action === 'claim.analyzed')).toHaveLength(4);
    expect(ev.filter((e) => e.action === 'claim.bulk_analyzed')).toHaveLength(3);
    for (const c of made) expect((await A.packetRows(c.claimId)).map((r) => r.revision)).toEqual([1]);
    console.log(`[AN-C03] outcomes ${JSON.stringify(rs.map((r) => ({ a: r.body.analyzed.length, s: r.body.skipped.length })))}`);
  }, 300000);

  it('[S] AN-C04: single analyze racing a bulk that includes the claim -> analyzed exactly once (10 rounds)', async () => {
    const seen: Record<string, number> = {};
    for (let i = 0; i < 10; i++) {
      const c = await A.smallClaim(an, rv, `C4${i}`);
      const [single, b] = await Promise.all([A.analyze(m, c.claimId), A.bulk(admin, { limit: 1 })]);
      for (const r of [single, b]) expect(r.status, `round ${i}: ${r.text}`).not.toBe(500);
      expect(b.status).toBe(200);
      const bulkGot = ids(b.body.analyzed).includes(c.claimId);
      if (single.status === 201) {
        expect(bulkGot, `round ${i}: bulk must not analyze it too`).toBe(false);
        seen[ids(b.body.skipped).includes(c.claimId) ? 'single+bulkSkipped' : 'single+bulkNotExamined'] = (seen[ids(b.body.skipped).includes(c.claimId) ? 'single+bulkSkipped' : 'single+bulkNotExamined'] ?? 0) + 1;
      } else {
        A.expectExact(single, 409, 'invalid_state', `round ${i} single loser`);
        expect(bulkGot, `round ${i}: bulk analyzed it`).toBe(true);
        seen['bulk+single409'] = (seen['bulk+single409'] ?? 0) + 1;
      }
      expect((await A.packetRows(c.claimId)).map((r) => r.revision)).toEqual([1]);
    }
    console.log(`[AN-C04] outcomes ${JSON.stringify(seen)}`);
    expect(await awaitingCount(owner)).toBe(0);
  }, 600000);

  let c1: A.Made, c2: A.Made, c3: A.Made;
  it('[S] AN-B01: limit 2 analyzes the two oldest in creation order', async () => {
    c1 = await A.smallClaim(an, rv, 'B1a');
    c2 = await A.ld5001Claim(an, rv, 'SHIPPER', 'B1b');
    c3 = await A.smallClaim(an, rv, 'B1c');
    const b = await bulkChecked(m, { limit: 2 }, 'B01');
    expect(b.limit).toBe(2);
    expect(b.examined).toBe(2);
    expect(ids(b.analyzed)).toEqual([c1.claimId, c2.claimId]);
    expect(b.analyzed.map((a: any) => a.claimNumber)).toEqual([c1.claimNumber, c2.claimNumber]);
    expect(b.analyzed[1]).toMatchObject({ findingsCount: 3, recoverableCents: 32500, pendingReviewCents: 15000 });
    expect(b.skipped).toEqual([]);
    expect(b.failed).toEqual([]);
    expect(b.remaining).toBe(1);
  });
  it('[S] AN-B02: {} defaults to limit 10; then nothing is left', async () => {
    const b = await bulkChecked(m, {}, 'B02 first');
    expect(b.limit).toBe(10);
    expect(ids(b.analyzed)).toEqual([c3.claimId]);
    expect(b.examined).toBe(1);
    expect(b.remaining).toBe(0);
    const again = await bulkChecked(m, {}, 'B02 again');
    expect(again).toEqual({ limit: 10, examined: 0, analyzed: [], skipped: [], failed: [], remaining: 0 });
  });
  let bad: A.Made;
  it('[S] AN-B03: a failing oldest claim goes to failed and does not consume the limit', async () => {
    bad = await A.badClaim(an, rv, 'B3x');
    const g1 = await A.smallClaim(an, rv, 'B3a');
    const g2 = await A.smallClaim(an, rv, 'B3b');
    const b = await bulkChecked(m, { limit: 2 }, 'B03');
    expect(b.failed).toEqual([{ claimId: bad.claimId, claimNumber: bad.claimNumber, code: 'analysis_input_invalid' }]);
    expect(ids(b.analyzed)).toEqual([g1.claimId, g2.claimId]);
    expect(b.examined).toBe(3);
    expect(b.remaining).toBe(1);
    expect((await owner.get(`/claims/${bad.claimId}`)).body.status).toBe('AWAITING_ANALYSIS');
    expect(await A.packetRows(bad.claimId)).toEqual([]);
  });
  it('[S] AN-B04: scan cap min(4*limit, 100) over 5 failing oldest claims + 1 good', async () => {
    // `bad` from B03 is the oldest of the five failing claims
    const bads = [bad];
    for (let i = 0; i < 4; i++) bads.push(await A.badClaim(an, rv, `B4x${i}`));
    const good = await A.smallClaim(an, rv, 'B4g');
    const first = await bulkChecked(m, { limit: 1 }, 'B04 limit 1');
    expect(first.examined).toBe(4);
    expect(ids(first.failed)).toEqual(bads.slice(0, 4).map((c) => c.claimId));
    expect(first.analyzed).toEqual([]);
    expect(first.remaining).toBe(6);
    const second = await bulkChecked(m, { limit: 2 }, 'B04 limit 2');
    expect(second.examined).toBe(6);
    expect(ids(second.failed)).toEqual(bads.map((c) => c.claimId));
    expect(ids(second.analyzed)).toEqual([good.claimId]);
    expect(second.remaining).toBe(5);
  });
  it('[S] AN-B05: invalid bodies -> 400 validation_error, nothing analyzed, no bulk event', async () => {
    const g = await A.smallClaim(an, rv, 'B5');
    for (const body of [{ limit: 0 }, { limit: 26 }, { limit: '5' }, { limit: 1.5 }, { limit: 1, x: 1 }, { limit: -1 }, { limit: null }]) {
      const seq0 = await H.lastSeq(owner);
      A.expectExact(await A.bulk(m, body), 400, 'validation_error', JSON.stringify(body));
      const ev = await A.eventsSince(owner, seq0);
      expect(ev.filter((e) => e.action === 'claim.bulk_analyzed' || e.action === 'claim.analyzed'), JSON.stringify(body)).toEqual([]);
    }
    expect((await owner.get(`/claims/${g.claimId}`)).body.status).toBe('AWAITING_ANALYSIS');
    // limit 25 (ANALYZE_BATCH_MAX) is accepted
    const ok = await bulkChecked(m, { limit: 25 }, 'B05 limit 25');
    expect(ids(ok.analyzed)).toEqual([g.claimId]);
  });
  it('[S] AN-B07: Globex claims awaiting analysis are untouched by an Acme bulk', async () => {
    const load = H.uniqLoad('B7');
    const gc = await A.makeClaim(gxm, gxo, A.smallFiles(load), 'SHIPPER', load);
    const ga = await awaitingCount(gxm);
    expect(ga).toBeGreaterThanOrEqual(1);
    const b = await bulkChecked(m, { limit: 25 }, 'B07');
    expect(ids(b.analyzed)).not.toContain(gc.claimId);
    expect([...ids(b.failed), ...ids(b.skipped)]).not.toContain(gc.claimId);
    expect((await gxm.get(`/claims/${gc.claimId}`)).body.status).toBe('AWAITING_ANALYSIS');
    expect((await gxm.get(`/claims/${gc.claimId}/packet`)).status).toBe(404);
    expect(await A.packetRows(gc.claimId)).toEqual([]);
    expect(await awaitingCount(gxm)).toBe(ga);
    const gseq = (await gxo.get('/audit/events?limit=5')).body.items.map((e: any) => e.action);
    expect(gseq).not.toContain('claim.bulk_analyzed');
  });
  it.skip('[S] AN-B08: a claim whose linked documents are all non-ACCEPTED is not examined - not constructible through the API: commit links only ACCEPTED documents (others are skipped as not_accepted) and an ACCEPTED document cannot change status afterwards', () => undefined);
  it('[S] audit chains verify after the bulk runs', async () => {
    for (const s of [owner, gxo]) expect((await s.get('/audit/verify')).body.valid).toBe(true);
  });

  // Runs last: it reseeds (fresh tenant state) and uses its own apps. Setup goes through an app without rate limiting;
  // only the measured requests go through the rate-limited app (per-user buckets are per app instance).
  it('[S] AN-B09: the bulk run stops when the analysis rate-limit budget is spent; the next request is 429', async () => {
    await closeApps();
    reseed();
    const setup = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
    const san = await sessionFor(setup, ACCOUNTS.ANALYST);
    const srv = await sessionFor(setup, ACCOUNTS.REVIEWER);
    const sown = await sessionFor(setup, ACCOUNTS.OWNER);
    owner = sown; // bulkChecked-style audit reads use the unlimited app
    expect(await awaitingCount(sown), 'reseeded: no AWAITING claims').toBe(0);
    const made: A.Made[] = [];
    for (let i = 0; i < 5; i++) made.push(await A.smallClaim(san, srv, `B9${i}`));
    const limited = await buildTestApp({ LOCKOUT_THRESHOLD: '50', RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_ANALYSIS_MAX: '3', RATE_LIMIT_GLOBAL_MAX: '100000', RATE_LIMIT_AUTH_MAX: '100000' });
    const lm = await sessionFor(limited, ACCOUNTS.MANAGER);
    const seq0 = await H.lastSeq(sown);
    const r = await A.bulk(lm, { limit: 5 });
    expect(r.status, r.text).toBe(200);
    const b = r.body;
    expect(Object.keys(b).sort()).toEqual(['analyzed', 'examined', 'failed', 'limit', 'remaining', 'skipped']);
    expect(b.limit).toBe(5);
    expect(b.examined).toBe(3);
    expect(ids(b.analyzed), 'the oldest three, in order').toEqual(made.slice(0, 3).map((c) => c.claimId));
    expect(b.skipped).toEqual([]);
    expect(b.failed).toEqual([]);
    expect(b.remaining).toBe(2);
    for (const c of made.slice(3)) {
      expect((await sown.get(`/claims/${c.claimId}`)).body.status, `${c.claimNumber} unattempted`).toBe('AWAITING_ANALYSIS');
      expect(await A.packetRows(c.claimId)).toEqual([]);
    }
    expect(await awaitingCount(sown)).toBe(2);
    const ev = await A.eventsSince(sown, seq0);
    const sum = ev.filter((e) => e.action === 'claim.bulk_analyzed');
    expect(sum).toHaveLength(1);
    expect(sum[0].actor).toEqual({ id: lm.user.id, role: 'MANAGER' });
    expect(sum[0].metadata).toEqual({ limit: 5, examined: 3, analyzed: 3, skipped: 0, failed: 0, remaining: 2 });
    const per = ev.filter((e) => e.action === 'claim.analyzed');
    expect(per.map((e) => e.targetId).sort()).toEqual(made.slice(0, 3).map((c) => c.claimId).sort());
    for (const e of per) expect(e.metadata.bulk).toBe(true);
    // budget spent: the next analysis request (single or bulk) by the same user is refused
    const next = await A.analyze(lm, made[3]!.claimId);
    A.expectExact(next, 429, 'rate_limited', 'AN-B09 next request');
    expect(Number(next.headers['retry-after'])).toBeGreaterThan(0);
    A.expectExact(await A.bulk(lm, { limit: 1 }), 429, 'rate_limited', 'AN-B09 next bulk');
    expect(await awaitingCount(sown), 'refused requests changed nothing').toBe(2);
    expect((await sown.get('/audit/verify')).body.valid).toBe(true);
  }, 300000);
});
