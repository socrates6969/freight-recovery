// REQ-20261011-fuel-outlook Tier L: T5 outlook on the bundled history through `backtestSeries` / `computeOutlook`
// / `ar2Forecast` (CI-O01..O05; Part C F7). Pinned values and tolerances are those of test-spec T5 (abs 5e-6 for
// maeRatio and the MAEs, abs 5e-4 for dm, abs 1e-5 for point/low/high, exact counts and rounded strings). The
// product is additionally compared with the test-owned oracle (helpers/outlook-oracle.ts) at 1e-9 relative.
import { beforeAll, describe, expect, it } from 'vitest';
import { csvObs, loadModules, type OutlookMod, type Root } from './helpers/fuel-fixtures.js';
import { O_CFG, at, oAr2, oAr2Coef, oBacktest, oOutlook, oRound2, oRound3, type OBacktest } from './helpers/outlook-oracle.js';

interface Horizon extends Omit<OBacktest, 's0' | 'minMargin'> { unit: 'week' | 'month' }
interface Outlook { status: string; horizons: Horizon[]; backtestYears: { from: number; to: number } | null }
let O: OutlookMod;
let R: Root;
let outlook: (d: readonly string[], v: readonly (string | number)[], k: string) => Outlook;
let backtest: (d: readonly string[], v: readonly (string | number)[], k: string) => Horizon[];
beforeAll(async () => {
  ({ O, R } = await loadModules());
  outlook = O.computeOutlook as unknown as typeof outlook;
  backtest = O.backtestSeries as unknown as typeof backtest;
});
const series = (file: string) => { const o = csvObs(file); return { dates: o.map((x) => x.date), values: o.map((x) => x.value), y: o.map((x) => Number(x.value)) }; };
const D = () => series('GASDESW.csv');
const P = () => series('PCU4841214841212.csv');

const near = (a: number, e: number, abs: number, tag: string) => expect(Math.abs(a - e), `${tag}: ${a} vs ${e} (abs ${abs})`).toBeLessThanOrEqual(abs);
const rel = (a: number | null, e: number | null, tag: string) => {
  if (e === null || a === null) { expect(a, tag).toBe(e); return; }
  expect(Math.abs(a - e), `${tag}: ${a} vs oracle ${e} (rel 1e-9)`).toBeLessThanOrEqual(1e-9 * Math.abs(e));
};
/** Product horizon equals the oracle: same labels and counts, doubles within 1e-9 relative. */
export function expectOracle(got: Horizon, exp: OBacktest, tag: string) {
  expect([got.h, got.candidate, got.method, got.reason, got.origins, got.firstOrigin, got.coverageHits, got.coverageCases, got.targetDate], tag)
    .toEqual([exp.h, exp.candidate, exp.method, exp.reason, exp.origins, exp.firstOrigin, exp.coverageHits, exp.coverageCases, exp.targetDate]);
  for (const k of ['naiveMae', 'candidateMae', 'maeRatio', 'dm', 'coverage', 'point', 'low', 'high'] as const) rel(got[k], exp[k], `${tag} ${k}`);
}

const PINNED = [
  { key: 'diesel_us', h: 1, candidate: 'ar2', method: 'ar2', reason: 'model_beats_naive', origins: 779, firstOrigin: '2011-10-31', naiveMae: 0.041878, candidateMae: 0.035613, maeRatio: 0.850402, dm: 5.6375, hits: 526, cases: 675, coverage: 0.779259 },
  { key: 'diesel_us', h: 4, candidate: 'combo', method: 'combo', reason: 'model_beats_naive', origins: 776, firstOrigin: '2011-10-31', naiveMae: 0.127272, candidateMae: 0.122219, maeRatio: 0.960302, dm: 2.7485, hits: 530, cases: 672, coverage: 0.78869 },
  { key: 'diesel_us', h: 8, candidate: 'naive', method: 'naive', reason: 'naive_by_design', origins: 772, firstOrigin: '2011-10-31', naiveMae: 0.207645, candidateMae: 0.207645, maeRatio: 1, dm: 0, hits: 520, cases: 668, coverage: 0.778443 },
  { key: 'diesel_us', h: 13, candidate: 'naive', method: 'naive', reason: 'naive_by_design', origins: 767, firstOrigin: '2011-10-31', naiveMae: 0.277145, candidateMae: 0.277145, maeRatio: 1, dm: 0, hits: 510, cases: 663, coverage: 0.769231 },
  { key: 'ppi_tl', h: 1, candidate: 'ar2', method: 'ar2', reason: 'model_beats_naive', origins: 205, firstOrigin: '2009-07-01', naiveMae: 1.723146, candidateMae: 1.502823, maeRatio: 0.872139, dm: 2.3327, hits: 125, cases: 169, coverage: 0.739645 },
] as const;
const LIVE = [
  { key: 'diesel_us', h: 1, target: '2026-10-12', point: 6.12407, low: 5.903022, high: 6.39194, s: ['6.124', '5.903', '6.392'] },
  { key: 'diesel_us', h: 4, target: '2026-11-02', point: 6.136159, low: 5.30144, high: 7.174872, s: ['6.136', '5.301', '7.175'] },
  { key: 'diesel_us', h: 8, target: '2026-11-30', point: 6.199, low: 4.776939, high: 8.188677, s: ['6.199', '4.777', '8.189'] },
  { key: 'diesel_us', h: 13, target: '2027-01-04', point: 6.199, low: 4.383826, high: 9.395411, s: ['6.199', '4.384', '9.395'] },
  { key: 'ppi_tl', h: 1, target: '2026-09-01', point: 217.964763, low: 210.945352, high: 225.867636, s: ['218.0', '210.9', '225.9'] },
] as const;
const DEC: Record<string, number> = { diesel_us: 3, ppi_tl: 1 };

describe('T5 outlook on the bundled history (F7)', () => {
  let res: Record<string, Outlook>;
  let ms = 0;
  beforeAll(() => {
    const t0 = performance.now();
    res = { diesel_us: outlook(D().dates, D().values, 'diesel_us'), ppi_tl: outlook(P().dates, P().values, 'ppi_tl') };
    ms = performance.now() - t0;
  });
  const hz = (key: string, h: number): Horizon => { const x = res[key]?.horizons.find((z) => z.h === h); if (!x) throw new Error(`${key} h=${h} missing`); return x; };

  it('CI-O01 backtest table (pinned, T5 tolerances)', () => {
    for (const p of PINNED) {
      const g = hz(p.key, p.h);
      const tag = `${p.key} h${p.h}`;
      expect([g.candidate, g.method, g.reason, g.origins, g.firstOrigin, g.coverageHits, g.coverageCases], tag).toEqual([p.candidate, p.method, p.reason, p.origins, p.firstOrigin, p.hits, p.cases]);
      expect(g.unit, tag).toBe(p.key === 'diesel_us' ? 'week' : 'month');
      near(g.naiveMae, p.naiveMae, 5e-6, `${tag} naiveMae`);
      near(g.candidateMae, p.candidateMae, 5e-6, `${tag} candidateMae`);
      near(g.maeRatio ?? NaN, p.maeRatio, 5e-6, `${tag} maeRatio`);
      near(g.dm, p.dm, 5e-4, `${tag} dm`);
      expect(g.coverage, tag).toBe(p.hits / p.cases);
    }
  });
  it('CI-O01 live outlook (pinned, abs 1e-5) and rounded strings (exact)', () => {
    for (const l of LIVE) {
      const g = hz(l.key, l.h);
      const tag = `${l.key} h${l.h}`;
      expect(g.targetDate, tag).toBe(l.target);
      near(g.point, l.point, 1e-5, `${tag} point`);
      near(g.low, l.low, 1e-5, `${tag} low`);
      near(g.high, l.high, 1e-5, `${tag} high`);
      const d = DEC[l.key] ?? 3;
      expect([g.point.toFixed(d), g.low.toFixed(d), g.high.toFixed(d)], tag).toEqual(l.s);
    }
  });
  it('CI-O01 status, backtestYears, horizons per series; no other ppi_tl horizon; no deep-sea series', () => {
    expect([res.diesel_us?.status, res.ppi_tl?.status]).toEqual(['ok', 'ok']);
    expect(res.diesel_us?.backtestYears).toEqual({ from: 2011, to: 2026 });
    expect(res.ppi_tl?.backtestYears).toEqual({ from: 2009, to: 2026 });
    expect(res.diesel_us?.horizons.map((h) => h.h)).toEqual([1, 4, 8, 13]);
    expect(res.ppi_tl?.horizons.map((h) => h.h)).toEqual([1]);
    expect(() => outlook(P().dates, P().values, 'ppi_deep_sea')).toThrow();
    expect(Object.keys(R.OUTLOOK_SERIES as object).sort()).toEqual(['diesel_us', 'ppi_tl']);
  });
  it('CI-O01 the product equals the oracle (1e-9 relative, exact counts) and backtestSeries equals computeOutlook().horizons', () => {
    for (const [key, s] of [['diesel_us', D()], ['ppi_tl', P()]] as const) {
      const exp = oOutlook(s.y, s.dates, O_CFG[key]);
      expect(res[key]?.backtestYears).toEqual(exp.backtestYears);
      exp.horizons.forEach((e, i) => expectOracle(at(res[key]?.horizons ?? [], i), e, `${key} h${e.h}`));
      expect(backtest(s.dates, s.values, key)).toEqual(res[key]?.horizons);
      // numbers and strings give the same result (values are parsed with Number())
      expect(outlook(s.dates, s.y, key)).toEqual(res[key]);
    }
  });
  it('CI-O02 DTO rounding of the table rows', () => {
    const rows = PINNED.map((p) => hz(p.key, p.h));
    expect(rows.map((g) => oRound3(g.maeRatio ?? NaN))).toEqual([0.85, 0.96, 1, 1, 0.872]);
    expect(rows.map((g) => oRound2(g.dm))).toEqual([5.64, 2.75, 0, 0, 2.33]);
    expect(rows.map((g) => oRound3(g.coverage))).toEqual([0.779, 0.789, 0.778, 0.769, 0.74]);
    const rt = R.rangeText as (c: number) => string;
    expect(rows.map((g) => /(\d+)% of outcomes/.exec(rt(g.coverage))?.[1])).toEqual(['78', '79', '78', '77', '74']);
  });
  it('CI-O03 AR(2) coefficients at the last origin (oracle, abs 1e-7); product ar2Forecast matches (1e-9 relative)', () => {
    for (const [key, s, b] of [['diesel_us', D(), [0.00078504, 0.40126543, 0.05584967]], ['ppi_tl', P(), [0.00145799, 0.31286926, 0.2840788]]] as const) {
      const W = 8 * O_CFG[key].m;
      const T = s.y.length - 1;
      const c = oAr2Coef(s.y, T, W);
      if (!c) throw new Error('oracle coefficients');
      c.forEach((x, i) => near(x, at(b, i), 1e-7, `${key} b${i}`));
      const z = (i: number) => Math.log(at(s.y, i)) - Math.log(at(s.y, i - 1));
      rel(O.ar2Forecast(s.y, T, 1, W), at(s.y, T) * Math.exp(c[0] + c[1] * z(T) + c[2] * z(T - 1)), `${key} ar2Forecast(T,1)`);
      for (const [t, h] of [[T, 4], [T - 100, 1], [T - 37, 13], [W + 3, 2]] as const) rel(O.ar2Forecast(s.y, t, h, W), oAr2(s.y, t, h, W), `${key} ar2Forecast(${t},${h})`);
    }
  });
  it('CI-O04 context (informative; oracle only, no product assertion): candidates that are not configured', () => {
    const d = D();
    const p = P();
    const r = (s: { y: number[]; dates: string[] }, key: 'diesel_us' | 'ppi_tl', h: number, c: 'ar2' | 'combo' | 'naive') => oBacktest(s.y, s.dates, O_CFG[key], { h, candidate: c });
    const a = r(d, 'diesel_us', 4, 'ar2');
    const b = r(d, 'diesel_us', 8, 'combo');
    const c = r(p, 'ppi_tl', 3, 'ar2');
    const n3 = r(p, 'ppi_tl', 3, 'naive');
    expect([a.maeRatio?.toFixed(6), a.dm.toFixed(4), a.method]).toEqual(['0.970550', '1.0134', 'naive']);
    expect([b.maeRatio?.toFixed(6), b.dm.toFixed(4), b.method]).toEqual(['0.981786', '1.6522', 'naive']);
    expect([c.maeRatio?.toFixed(6), c.dm.toFixed(4), c.method]).toEqual(['0.887816', '1.5303', 'naive']);
    expect([n3.coverageHits, n3.coverageCases, n3.coverage.toFixed(6)]).toEqual([108, 167, '0.646707']);
  });
  it('CI-O04 robustness of the exact hit counts: the smallest distance of a coverage case from its bound is >= 2.5e-6 (oracle)', () => {
    for (const [key, s] of [['diesel_us', D()], ['ppi_tl', P()]] as const) for (const e of oOutlook(s.y, s.dates, O_CFG[key]).horizons) expect(e.minMargin, `${key} h${e.h}`).toBeGreaterThanOrEqual(2.5e-6);
  });
  it('CI-O05 performance: computeOutlook for both bundled series takes < 2 s (one worker)', () => {
    console.info(`[CI-O05] computeOutlook(diesel_us + ppi_tl) took ${ms.toFixed(1)} ms on Node ${process.version}`);
    expect(ms).toBeLessThan(2000);
  });
});
