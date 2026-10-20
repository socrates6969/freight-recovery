/**
 * Learning curve (scoup Labs): the port reproduces the hive measurement of 2026-10-19 (e1_charges.json) exactly on
 * tariff-seed-v1, is deterministic, and reports the seed-v2 gate on the 175 v1 names.
 */
import { describe, expect, it } from 'vitest';

import { CURVE_FRACTIONS, CURVE_RESAMPLES, CURVE_RNG_SEED, learningCurve } from './index.js';

describe('learningCurve', () => {
  it('reproduces the 2026-10-19 numbers on tariff-seed-v1 (50 resamples, PRNG seed 20261019)', () => {
    const r = learningCurve('v1');
    expect([r.seed, r.examples, r.sources, r.resamples, r.rngSeed, r.distinctName]).toEqual(['v1', 175, 6, CURVE_RESAMPLES, CURVE_RNG_SEED, true]);
    expect(r.baselines).toEqual({ keyword: { recognition: 19.43, wrong: 0, accessorialRecognition: 11.95 }, majority: { recognition: 90.86, wrong: 9.14, accessorialRecognition: 100 } });
    expect(r.byFraction.map((p) => p.fraction)).toEqual([...CURVE_FRACTIONS]);
    expect(r.byFraction.map((p) => [p.trainNamesMean, p.recognition.mean, p.wrong.mean, p.accessorialRecognition.mean, p.top1.mean])).toEqual([
      [14.8, 36.3, 1.7, 35.28, 90.69],
      [36.5, 60.22, 2.46, 59.06, 93.97],
      [73, 76.59, 2.49, 75.91, 96.13],
      [109.5, 84.51, 1.67, 84.2, 97.54],
      [145.8, 89.14, 0.57, 88.68, 98.86],
    ]);
    expect(r.byFraction.map((p) => [p.recognition.lo, p.recognition.hi])).toEqual([
      [31.43, 41.71],
      [54.86, 65.14],
      [72, 81.71],
      [81.71, 86.86],
      [89.14, 89.14],
    ]);
    expect(r.bySourceCount.map((p) => [p.otherSources, p.trainNamesMean, p.recognition, p.wrong])).toEqual([
      [1, 29.2, 58.4, 2.63],
      [2, 58.3, 73.31, 2.8],
      [3, 87.5, 81.14, 2.23],
      [4, 116.7, 85.94, 1.37],
      [5, 145.8, 89.14, 0.57],
    ]);
    expect(r.perSource.map((p) => [p.source, p.examples, p.recognised, p.wrong, p.abstained])).toEqual([
      ['magnum_2026', 27, 25, 0, 2],
      ['gardewine_2025', 27, 22, 0, 5],
      ['dohrn_2025', 30, 27, 1, 2],
      ['states_2023', 19, 18, 0, 1],
      ['xpo_2025', 43, 39, 0, 4],
      ['estes_2025', 29, 25, 0, 4],
    ]);
    expect(r.v1HeldOut).toBeNull();
    // Per-category split: the single linehaul name has no other-source example; every detention name is recognised at 100 %.
    const full = r.byFraction[4];
    expect(full?.byCategory.linehaul).toEqual({ total: 1, recognition: 0, wrong: 0 });
    expect(full?.byCategory.detention).toEqual({ total: 12, recognition: 100, wrong: 0 });
  }, 120_000);

  it('on tariff-seed-v2 reports the gate on the 175 v1 names (163 recognised, 1 wrong) and the 100 % point', () => {
    const r = learningCurve('v2', 2);
    expect([r.seed, r.examples, r.sources, r.resamples]).toEqual(['v2', 256, 8, 2]);
    expect(r.v1HeldOut).toEqual({ examples: 175, recognised: 163, wrong: 1, abstained: 11 });
    const full = r.byFraction[4];
    expect([full?.trainNamesMean, full?.recognition.mean, full?.wrong.mean]).toEqual([224, 91.8, 0.39]);
    expect(r.bySourceCount).toHaveLength(7);
    expect(r.perSource.map((p) => p.source)).toEqual(['magnum_2026', 'gardewine_2025', 'dohrn_2025', 'states_2023', 'xpo_2025', 'estes_2025', 'gsa_2021', 'fedex_2026']);
    expect(learningCurve('v2', 2)).toEqual(r);
  }, 120_000);

  it('rejects a non-positive resample count', () => {
    expect(() => learningCurve('v1', 0)).toThrow(RangeError);
    expect(() => learningCurve('v1', 1.5)).toThrow(RangeError);
  });
});