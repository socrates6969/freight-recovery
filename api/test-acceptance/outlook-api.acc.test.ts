// REQ-20261011-fuel-outlook Tier H (written now; run after the owner's go-ahead): T11 outlook API (CI-A20..A22),
// T13 flags (CI-X01, CI-X03). Part C F7, F10, F12, F14. Expected values: test-spec T5 (pinned) with the F7.9
// rounding. CI-A21 is should-have S2: set ACC_SKIP_S2=1 when S2 was cut (recorded in test-plan.md).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, ALL_ROLES, type RoleName, type Session, buildTestApp, closeApps, expectError, sessionFor } from './helpers/client.js';
import * as A from './helpers/analysis.js';
import { withAdmin } from './helpers/db.js';
import * as H from './helpers/imp.js';
import * as I from './helpers/intel.js';
import * as K from './helpers/keys.js';
import { reseed } from './helpers/seed.js';

const S2 = process.env.ACC_SKIP_S2 !== '1';
const NOTE = 'Forecasts are shown only at horizons where a model beat "no change" in a walk-forward backtest on public data; other horizons show "no change" with a range. Not a guarantee.';
const T1_BODY = { name: 'Outlook T1', kind: 'step', unit: 'per_mile', priceSeries: 'diesel_us', effectiveOffsetDays: 2, params: { basePrice: '1.20', stepSize: '0.06', ratePerStep: '0.01', bracket: 'above_base' } };
const hz = (h: number, unit: string, targetDate: string, method: string, reason: string, p: [string, string, string], bt: [string, number, number, number, number, number, number]) => ({
  h, unit, targetDate, method, reason, point: p[0], low: p[1], high: p[2],
  backtest: { candidate: bt[0], origins: bt[1], maeRatio: bt[2], dm: bt[3], coverage: bt[4], coverageHits: bt[5], coverageCases: bt[6] }, fsc: null,
});
const DIESEL_H = [
  hz(1, 'week', '2026-10-12', 'ar2', 'model_beats_naive', ['6.124', '5.903', '6.392'], ['ar2', 779, 0.85, 5.64, 0.779, 526, 675]),
  hz(4, 'week', '2026-11-02', 'combo', 'model_beats_naive', ['6.136', '5.301', '7.175'], ['combo', 776, 0.96, 2.75, 0.789, 530, 672]),
  hz(8, 'week', '2026-11-30', 'naive', 'naive_by_design', ['6.199', '4.777', '8.189'], ['naive', 772, 1, 0, 0.778, 520, 668]),
  hz(13, 'week', '2027-01-04', 'naive', 'naive_by_design', ['6.199', '4.384', '9.395'], ['naive', 767, 1, 0, 0.769, 510, 663]),
];
const PPI_H = [hz(1, 'month', '2026-09-01', 'ar2', 'model_beats_naive', ['218.0', '210.9', '225.9'], ['ar2', 205, 0.872, 2.33, 0.74, 125, 169])];
const SERIES = [
  {
    key: 'diesel_us', label: 'U.S. average diesel price', unit: 'USD per gallon', frequency: 'weekly', status: 'ok',
    citation: 'U.S. Energy Information Administration, US Diesel Sales Price [GASDESW], retrieved from FRED, Federal Reserve Bank of St. Louis',
    provenance: { sourceUrl: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASDESW', retrievedAt: '2026-10-11', sha256: 'aca8fefdbb54bdf16a2ab2c225d8b1f59c033e04d6fb96d8c232c3cc45417bdf', rowCount: 1699, firstDate: '1994-03-21', lastDate: '2026-10-05' },
    latest: { date: '2026-10-05', value: '6.199' }, backtestYears: { from: 2011, to: 2026 }, horizons: DIESEL_H,
  },
  {
    key: 'ppi_tl', label: 'Producer price index, long-distance truckload', unit: 'index (Jun 1992 = 100)', frequency: 'monthly', status: 'ok',
    citation: 'U.S. Bureau of Labor Statistics, Producer Price Index by Industry: General Freight Trucking, Long-Distance Truckload [PCU4841214841212], retrieved from FRED, Federal Reserve Bank of St. Louis',
    provenance: { sourceUrl: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=PCU4841214841212', retrievedAt: '2026-10-11', sha256: '83894390a4fd80d6033f9d18299e97b27e670427bbb5e6aa090cdca0d4a44bea', rowCount: 411, firstDate: '1992-06-01', lastDate: '2026-08-01' },
    latest: { date: '2026-08-01', value: '215.105' }, backtestYears: { from: 2009, to: 2026 }, horizons: PPI_H,
  },
];

let app: FastifyInstance;
let SS: Record<RoleName, Session>;
let gxo: Session;
let R: Record<string, { parse(v: unknown): unknown }>;
let tid = '';
const outlook = (s: Session, qs = '') => s.get(`/outlook${qs}`);
/** Removes the import ids (uuid-checked) so the rest can be compared exactly. */
function stripIds(body: { series: { provenance: { importId?: string } | null }[] }) {
  return {
    ...body,
    series: body.series.map((s) => {
      if (!s.provenance) return s;
      const { importId, ...prov } = s.provenance;
      expect(A.UUID_RE.test(importId ?? '')).toBe(true);
      return { ...s, provenance: prov };
    }),
  };
}

beforeAll(async () => {
  await H.assertS3Reachable();
  reseed();
  R = (await import('@fr/shared')) as unknown as typeof R;
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50', PRICE_CACHE_TTL_MS: '0', FLAGS_CACHE_TTL_MS: '0' });
  SS = {} as Record<RoleName, Session>;
  for (const r of ALL_ROLES) SS[r] = await sessionFor(app, ACCOUNTS[r]);
  gxo = await sessionFor(app, I.GLOBEX.OWNER);
  tid = SS.OWNER.user.tenant.id;
}, 180000);
afterAll(async () => { try { await K.revokeActive(SS.OWNER); } finally { await closeApps(); reseed(); } });

describe('T11 outlook API (F7, F10)', () => {
  it('CI-A20 every tenant role: 200 OutlookResponse equal to T5 (rounded), provenance, latest, fscTable null; no audit', async () => {
    const seq = await I.lastSeq(tid);
    for (const role of ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER'] as const) {
      const r = await outlook(SS[role]);
      expect(r.status, `${role} ${r.text}`).toBe(200);
      expect(R.OutlookResponse?.parse(r.body)).toEqual(r.body);
      expect(stripIds(r.body), role).toEqual({ outlookVersion: 'outlook-v1', note: NOTE, series: SERIES, fscTable: null });
    }
    expect(await I.eventsSince(tid, seq)).toEqual([]);
  });
  it.skipIf(!S2)('CI-A21 (S2) ?fscTableId=<T1>: diesel fsc per horizon, current 0.84, ppi fsc null; other-tenant/archived/non-UUID 404; unknown key 400', async () => {
    const own = await SS.OWNER.post('/fuel-tables', T1_BODY);
    expect(own.status, own.text).toBe(201);
    const r = await outlook(SS.VIEWER, `?fscTableId=${own.body.id}`);
    expect(r.status, r.text).toBe(200);
    const d = r.body.series.find((s: { key: string }) => s.key === 'diesel_us');
    expect(d.horizons.map((h: { fsc: unknown }) => h.fsc)).toEqual([
      { point: '0.83', low: '0.79', high: '0.87' }, { point: '0.83', low: '0.69', high: '1.00' },
      { point: '0.84', low: '0.60', high: '1.17' }, { point: '0.84', low: '0.54', high: '1.37' },
    ]);
    expect(r.body.fscTable).toEqual({ id: own.body.id, name: 'Outlook T1', version: 1, unit: 'per_mile', current: '0.84' });
    expect(r.body.series.find((s: { key: string }) => s.key === 'ppi_tl').horizons.map((h: { fsc: unknown }) => h.fsc)).toEqual([null]);
    const other = await gxo.post('/fuel-tables', { ...T1_BODY, name: 'Globex outlook table' });
    expect(other.status).toBe(201);
    const archived = await SS.OWNER.post('/fuel-tables', { ...T1_BODY, name: 'Outlook archived' });
    expect((await SS.OWNER.destroy(`/fuel-tables/${archived.body.id}`)).status).toBe(204);
    const unknown = await outlook(SS.VIEWER, `?fscTableId=${I.RAND_UUID}`);
    A.expectExact(unknown, 404, 'not_found');
    I.expectIdentical404(unknown, await outlook(SS.VIEWER, `?fscTableId=${other.body.id}`));
    A.expectExact(await outlook(SS.VIEWER, `?fscTableId=${archived.body.id}`), 404, 'not_found');
    A.expectExact(await outlook(SS.VIEWER, '?fscTableId=not-a-uuid'), 404, 'not_found');
    A.expectExact(await outlook(SS.VIEWER, '?bogus=1'), 400, 'validation_error');
    await withAdmin(async (c) => { await c.query('delete from fsc_tables where name in ($1, $2, $3)', ['Outlook T1', 'Globex outlook table', 'Outlook archived']); });
  });
  it('CI-A22 platform roles and API keys get 403', async () => {
    for (const role of ['PLATFORM_DEV', 'SUPER_ADMIN'] as const) expectError(await outlook(SS[role]), 403, 'forbidden');
    const k = await K.mkKey(SS.OWNER, [...K.SCOPES]);
    expectError(await K.keyReq(app, k.secret, 'GET', '/outlook'), 403, 'forbidden');
  });
});

describe('T13 flags (F14)', () => {
  // Step 8 (ocean D&D) added intelligence.ocean_dd, so the platform now has 7 flags; the exact key list above is the pin.
  it('CI-X01 /features returns all flags (6 in step 7, 7 since step 8) including cost_outlook and fuel_check, both on', async () => {
    const r = await SS.VIEWER.get('/features');
    expect(r.status, r.text).toBe(200);
    expect(Object.keys(r.body.flags).sort()).toEqual([...I.FLAG_KEYS]);
    expect(Object.keys(r.body.flags)).toHaveLength(7);
    expect([r.body.flags['intelligence.cost_outlook'], r.body.flags['intelligence.fuel_check']]).toEqual([true, true]);
  });
  it('CI-X03 cost_outlook off: outlook 404 (after 401/403/400); fuel routes unaffected', async () => {
    const dev = I.onApp(app, SS.PLATFORM_DEV);
    await I.setFlag(dev, 'intelligence.cost_outlook', false, 'acceptance outlook flag off');
    try {
      A.expectExact(await outlook(SS.VIEWER), 404, 'not_found');
      A.expectExact(await outlook(SS.VIEWER, '?bogus=1'), 400, 'validation_error');
      expectError(await outlook(SS.PLATFORM_DEV), 403, 'forbidden');
      expect((await SS.VIEWER.get('/fuel-tables')).status).toBe(200);
    } finally {
      await I.setFlag(dev, 'intelligence.cost_outlook', true, 'acceptance outlook flag on');
    }
    expect((await outlook(SS.VIEWER)).status).toBe(200);
  });
});
