/* eslint-disable */
// REQ-20261012-hardening Tier H: T5 bulk analysis HD-B01..HD-B04 (Part C C5) in a dedicated fixture tenant so that no
// other suite's awaiting claims interfere. HD-B05 (budget stop) needs a rate-limited app: hardening-bulk-budget.acc.test.ts.
// HD-B06 = the existing AN-B01..B07 / AN-C03/C04 suites with additive pins; HD-B07 (stoppedBy 'error') is not
// reachable black-box (covered by the builder's integration test).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, closeApps } from './helpers/client.js';
import * as A from './helpers/analysis.js';
import { withAdmin } from './helpers/db.js';
import * as X from './helpers/hardening.js';
import * as H from './helpers/imp.js';
import * as I from './helpers/intel.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
let fx: I.Fx;
let F1: A.Made, G1: A.Made, G2: A.Made;
const ids = (xs: any[]) => xs.map((x) => x.claimId);

/** One bulk run with the HD-B04 summary-event checks. */
async function run(limit: number, label: string) {
  const seq = await I.lastSeq(fx.id);
  const r = await A.bulk(fx.manager, { limit });
  expect(r.status, `${label}: ${r.text}`).toBe(200);
  const b = r.body;
  expect(Object.keys(b).sort()).toEqual(['analyzed', 'examined', 'failed', 'limit', 'remaining', 'skipped', 'stoppedBy']);
  const ev = await I.eventsSince(fx.id, seq);
  const sum = ev.filter((e) => e.action === 'claim.bulk_analyzed');
  expect(sum, `${label}: one summary`).toHaveLength(1);
  expect(Object.keys(sum[0]!.metadata).sort(), `${label} HD-B04 keys`).toEqual(['analyzed', 'examined', 'failed', 'limit', 'remaining', 'skipped', 'stoppedBy']);
  expect(sum[0]!.metadata, `${label} HD-B04 values`).toEqual({ limit: b.limit, examined: b.examined, analyzed: b.analyzed.length, skipped: b.skipped.length, failed: b.failed.length, remaining: b.remaining, stoppedBy: b.stoppedBy });
  return { b, ev };
}

beforeAll(async () => {
  await H.assertS3Reachable();
  reseed();
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
  fx = await I.fixtureTenant(app, `hdbulk${Date.now() % 100000}`, 'Hardening Bulk Synthetic');
  const mk = async (files: (l: string) => A.FileSpec[], tag: string) => {
    const load = H.uniqLoad(tag);
    const m = await A.makeClaim(fx.analyst, fx.manager, files(load), 'SHIPPER', load);
    await H.sleep(25); // createdAt strictly increasing
    return m;
  };
  F1 = await mk(X.overflowFiles, 'HB-F1');
  G1 = await mk(A.smallFiles, 'HB-G1');
  G2 = await mk(A.smallFiles, 'HB-G2');
  const created = await withAdmin(async (c) => (await c.query('select id, created_at from claims where id = any($1::uuid[]) order by created_at', [[F1.claimId, G1.claimId, G2.claimId]])).rows.map((r: any) => r.id));
  expect(created, 'createdAt order F1 < G1 < G2').toEqual([F1.claimId, G1.claimId, G2.claimId]);
}, 240000);
afterAll(async () => { try { await I.clearTenantClaims(fx.id); await closeApps(); } finally { reseed(); } });

describe('T5 bulk ordering and stop reason (C5)', () => {
  it('HD-B01 {limit:1}: F1 fails (amount_out_of_range), G1 analysed, stoppedBy limit; one claim.analysis_failed (bulk true)', async () => {
    const { b, ev } = await run(1, 'HD-B01');
    expect(b.examined).toBe(2);
    expect(b.failed).toEqual([{ claimId: F1.claimId, claimNumber: F1.claimNumber, code: 'analysis_input_invalid', reasonCode: 'amount_out_of_range' }]);
    expect(ids(b.analyzed)).toEqual([G1.claimId]);
    expect(b.skipped).toEqual([]);
    expect(b.stoppedBy).toBe('limit');
    expect(b.remaining).toBe(2);
    const fe = ev.filter((e) => e.action === 'claim.analysis_failed');
    expect(fe).toHaveLength(1);
    expect([fe[0]!.target_id, fe[0]!.actor_id, fe[0]!.metadata.bulk, fe[0]!.metadata.reasonCode]).toEqual([F1.claimId, fx.manager.user.id, true, 'amount_out_of_range']);
    expect(fe[0]!.seq, 'failure event before the summary').toBeLessThan(ev.find((e) => e.action === 'claim.bulk_analyzed')!.seq);
  }, 120000);
  it('HD-B02 second {limit:1}: G2 analysed first (F1 is ordered after never-failed claims)', async () => {
    const { b, ev } = await run(1, 'HD-B02');
    expect(ids(b.analyzed)).toEqual([G2.claimId]);
    expect(b.examined).toBe(1);
    expect(b.failed).toEqual([]);
    expect(b.stoppedBy).toBe('limit');
    expect(ev.filter((e) => e.action === 'claim.analysis_failed')).toEqual([]);
  }, 120000);
  it('HD-B03 {limit:25}: only F1 left; examined 1, failed [F1], stoppedBy candidates, remaining 1', async () => {
    const { b } = await run(25, 'HD-B03');
    expect(b.examined).toBe(1);
    expect(ids(b.failed)).toEqual([F1.claimId]);
    expect(b.failed[0].reasonCode).toBe('amount_out_of_range');
    expect(b.analyzed).toEqual([]);
    expect(b.stoppedBy).toBe('candidates');
    expect(b.remaining).toBe(1);
    const d = await fx.viewer.get(`/claims/${F1.claimId}`);
    expect(d.body.analysisFailure).toMatchObject({ reasonCode: 'amount_out_of_range', failedAttempts: 2 });
  }, 120000);
  it('chain valid', async () => {
    expect((await fx.owner.get('/audit/verify')).body.valid).toBe(true);
  });
});
