// REQ-20261011-fuel-outlook Tier L: T6 outlook gate and edge cases on synthetic series (CI-G01..G06; Part C F7).
// Everything is compared with the test-owned oracle: same method and reason, the same counts, doubles within 1e-9
// relative. PRNG: mulberry32 + Box-Muller (helpers/outlook-oracle.ts); seeds recorded below.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadModules, type OutlookMod } from './helpers/fuel-fixtures.js';
import { O_CFG, at, oDates, oNormal, oOutlook, oRng, type OBacktest } from './helpers/outlook-oracle.js';

interface Horizon extends Omit<OBacktest, 's0' | 'minMargin'> { unit: string }
interface Outlook { status: string; horizons: Horizon[]; backtestYears: { from: number; to: number } | null }
type Fn<T> = (d: readonly string[], v: readonly (string | number)[], k: string) => T;
let outlook: Fn<Outlook>;
let backtest: Fn<Horizon[]>;
beforeAll(async () => {
  const { O } = await loadModules();
  const m: OutlookMod = O;
  outlook = m.computeOutlook as unknown as Fn<Outlook>;
  backtest = m.backtestSeries as unknown as Fn<Horizon[]>;
});
const SEED_G01 = 7060101;
const SEEDS_G02_RATIO = [7060201, 7060202, 7060203, 7060204, 7060205, 7060206, 7060207, 7060208, 7060209, 7060210];
const SEED_G02_DM = 7060226; // maeRatio 0.9936 < 1 but DM 1.58 < 1.96 -> fallback through the DM leg of the gate

/** y_0 = 3; log-diffs z_i = phi z_{i-1} + sd e_i. */
function walk(seed: number, n: number, sd: number, phi: number): number[] {
  const nr = oNormal(oRng(seed));
  const y = [3];
  let z = 0;
  for (let i = 1; i < n; i++) { z = phi * z + sd * nr(); y.push(at(y, i - 1) * Math.exp(z)); }
  return y;
}
const rel = (a: number | null, e: number | null, tag: string) => {
  if (e === null || a === null) { expect(a, tag).toBe(e); return; }
  expect(Math.abs(a - e), `${tag}: ${a} vs oracle ${e}`).toBeLessThanOrEqual(1e-9 * Math.abs(e));
};
/** `exp` may be passed in when the caller also needs the oracle result (it is computed once per series). */
function expectAllOracle(y: number[], dates: string[], key: 'diesel_us' | 'ppi_tl', tag: string, exp = oOutlook(y, dates, O_CFG[key])): Outlook {
  const got = outlook(dates, y, key);
  expect([got.status, got.backtestYears], tag).toEqual([exp.status, exp.backtestYears]);
  expect(got.horizons.length, tag).toBe(exp.horizons.length);
  exp.horizons.forEach((e, i) => {
    const g = at(got.horizons, i);
    const t = `${tag} h${e.h}`;
    expect([g.h, g.candidate, g.method, g.reason, g.origins, g.firstOrigin, g.coverageHits, g.coverageCases, g.targetDate], t)
      .toEqual([e.h, e.candidate, e.method, e.reason, e.origins, e.firstOrigin, e.coverageHits, e.coverageCases, e.targetDate]);
    for (const k of ['naiveMae', 'candidateMae', 'maeRatio', 'dm', 'coverage', 'point', 'low', 'high'] as const) rel(g[k], e[k], `${t} ${k}`);
  });
  return got;
}
const W = oDates(1000, 'weekly');

describe('T6 gate and edge cases (F7)', () => {
  it(`CI-G01 model wins: AR(1) phi 0.6 log-diffs, sd 0.01, 1,000 weekly points (seed ${SEED_G01}) -> h=1 ar2 / model_beats_naive`, () => {
    const got = expectAllOracle(walk(SEED_G01, 1000, 0.01, 0.6), W, 'diesel_us', 'G01');
    expect([got.horizons[0]?.method, got.horizons[0]?.reason]).toEqual(['ar2', 'model_beats_naive']);
  });
  it(`CI-G02 automatic fallback on pure random walks (sd 0.02; seeds ${SEEDS_G02_RATIO[0]}..${SEEDS_G02_RATIO.at(-1)} and ${SEED_G02_DM})`, () => {
    for (const s of [...SEEDS_G02_RATIO, SEED_G02_DM]) {
      const y = walk(s, 1000, 0.02, 0);
      const exp = oOutlook(y, W, O_CFG.diesel_us);
      const got = expectAllOracle(y, W, 'diesel_us', `seed ${s}`, exp);
      for (const [i, e] of exp.horizons.entries()) {
        const gateFails = e.candidate !== 'naive' && !(e.origins >= 100 && e.maeRatio !== null && e.maeRatio < 1 && e.dm >= 1.96);
        if (e.candidate !== 'naive') expect(at(got.horizons, i).method === 'naive', `seed ${s} h${e.h}`).toBe(gateFails);
      }
      const h1 = at(got.horizons, 0);
      expect([h1.reason, h1.method], `seed ${s}`).toEqual(['fallback_gate', 'naive']);
      expect(h1.point, `seed ${s} point === y_T`).toBe(at(y, y.length - 1));
    }
    const dm = at(outlook(W, walk(SEED_G02_DM, 1000, 0.02, 0), 'diesel_us').horizons, 0);
    expect(dm.maeRatio ?? 1).toBeLessThan(1);
    expect(dm.dm).toBeLessThan(1.96);
  }, 20_000);
  it('CI-G03 constant series (2.5 for 1,000 weeks): maeRatio null and fallback for h1/h4, naive by design for h8/h13; point = low = high = 2.500; coverage 1', () => {
    const y = Array.from({ length: 1000 }, () => 2.5);
    const got = expectAllOracle(y, W, 'diesel_us', 'G03');
    expect(got.horizons.map((h) => [h.h, h.maeRatio, h.reason, h.method])).toEqual([[1, null, 'fallback_gate', 'naive'], [4, null, 'fallback_gate', 'naive'], [8, 1, 'naive_by_design', 'naive'], [13, 1, 'naive_by_design', 'naive']]);
    for (const h of got.horizons) {
      expect([h.point.toFixed(3), h.low.toFixed(3), h.high.toFixed(3)], `h${h.h}`).toEqual(['2.500', '2.500', '2.500']);
      expect(h.coverage, `h${h.h}`).toBe(1);
      expect(h.naiveMae).toBe(0);
    }
  });
  it('CI-G04 insufficient_history: weekly 831 vs 832 points; monthly 191 vs 192', () => {
    const wk = walk(7060401, 832, 0.01, 0.3);
    expect(outlook(W.slice(0, 831), wk.slice(0, 831), 'diesel_us')).toEqual({ status: 'insufficient_history', horizons: [], backtestYears: null });
    expect(expectAllOracle(wk, W.slice(0, 832), 'diesel_us', 'weekly 832').status).toBe('ok');
    const M = oDates(192, 'monthly');
    const mo = walk(7060402, 192, 0.01, 0.3);
    expect(outlook(M.slice(0, 191), mo.slice(0, 191), 'ppi_tl')).toEqual({ status: 'insufficient_history', horizons: [], backtestYears: null });
    expect(expectAllOracle(mo, M, 'ppi_tl', 'monthly 192').status).toBe('ok');
  });
  it('CI-G05 input validation throws RangeError (unsorted dates, mismatched lengths, value <= 0, NaN)', () => {
    const y = walk(7060501, 900, 0.01, 0.3);
    const d = W.slice(0, 900);
    const swapped = [...d];
    [swapped[10], swapped[11]] = [at(d, 11), at(d, 10)];
    const bad: [string, string[], (number | string)[]][] = [
      ['unsorted dates', swapped, y], ['mismatched lengths', d.slice(0, 899), y],
      ['value 0', d, y.map((v, i) => (i === 500 ? 0 : v))], ['value < 0', d, y.map((v, i) => (i === 500 ? -1 : v))], ['NaN', d, y.map((v, i) => (i === 500 ? NaN : v))],
    ];
    for (const [label, dd, yy] of bad) {
      expect(() => outlook(dd, yy, 'diesel_us'), `computeOutlook ${label}`).toThrow(RangeError);
      expect(() => backtest(dd, yy, 'diesel_us'), `backtestSeries ${label}`).toThrow(RangeError);
    }
  });
  it('CI-G06 determinism; frozen copies give the same result', () => {
    const y = walk(SEED_G01, 1000, 0.01, 0.6);
    const a = outlook(W, y, 'diesel_us');
    const b = outlook(Object.freeze([...W]), Object.freeze([...y]), 'diesel_us');
    expect(b).toEqual(a);
    expect(outlook(W, y, 'diesel_us')).toEqual(a);
    expect(y).toEqual(walk(SEED_G01, 1000, 0.01, 0.6));
  });
});
