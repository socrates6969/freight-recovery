import { describe, expect, it } from 'vitest';

import { binomial, computePassStats, wilsonInterval } from './eval-stats.js';

const T = true;
const F = false;

describe('binomial', () => {
  it('matches known values and is 0 when b > a', () => {
    expect(binomial(4, 2)).toBe(6);
    expect(binomial(20, 10)).toBe(184756);
    expect(binomial(5, 0)).toBe(1);
    expect(binomial(2, 3)).toBe(0);
    expect(binomial(0, 0)).toBe(1);
    expect(() => binomial(-1, 0)).toThrow(RangeError);
  });
});

describe('wilsonInterval (z = 1.959964), vectors computed independently', () => {
  it('1/3', () => {
    const w = wilsonInterval(1, 3);
    expect(w.low).toBeCloseTo(0.061491944, 8);
    expect(w.high).toBeCloseTo(0.792340401, 8);
  });
  it('5/12', () => {
    const w = wilsonInterval(5, 12);
    expect(w.low).toBeCloseTo(0.193260312, 8);
    expect(w.high).toBeCloseTo(0.680488689, 8);
  });
  it('clamps at 0 and 1', () => {
    expect(wilsonInterval(0, 4).low).toBe(0);
    expect(wilsonInterval(0, 4).high).toBeCloseTo(0.48989084, 7);
    expect(wilsonInterval(30, 30).high).toBe(1);
    expect(wilsonInterval(30, 30).low).toBeCloseTo(0.886486605, 8);
  });
});

describe('computePassStats', () => {
  it('k=2 hand vector: counts [2,1,0]', () => {
    const s = computePassStats([
      [T, T],
      [T, F],
      [F, F],
    ]);
    expect(s).toMatchObject({
      cases: 3,
      k: 2,
      runsTotal: 6,
      runsPassed: 3,
      perRunPassRate: 0.5,
      passHatKCount: 1,
      passAtLeastOneCount: 2,
      flakyCaseCount: 1,
      alwaysFailCount: 1,
    });
    expect(s.passHatK).toBeCloseTo(1 / 3, 12);
    expect(s.passPowCurve[0]).toBeCloseTo(0.5, 12);
    expect(s.passPowCurve[1]).toBeCloseTo(1 / 3, 12);
  });

  it('k=4 hand vector: counts [4,3,2,0,4] -> curve [0.65, 0.533333, 0.45, 0.4]', () => {
    const rows = [
      [T, T, T, T],
      [T, F, T, T],
      [F, T, F, T],
      [F, F, F, F],
      [T, T, T, T],
    ];
    const s = computePassStats(rows);
    const expected = [0.65, 0.5333333333333333, 0.45, 0.4];
    expected.forEach((v, i) => expect(s.passPowCurve[i]).toBeCloseTo(v, 12));
    expect(s.passHatKCount).toBe(2);
    expect(s.passHatK).toBe(0.4);
    expect(s.flakyCaseCount).toBe(2);
    expect(s.alwaysFailCount).toBe(1);
    expect(s.passAtLeastOneCount).toBe(4);
  });

  it('contract identities: curve[0] = perRunPassRate, curve[k-1] = passHatK; deterministic => flat curve', () => {
    for (let seed = 1; seed < 40; seed += 1) {
      let x = seed;
      const rnd = () => {
        x = (x * 1103515245 + 12345) % 2147483648;
        return x / 2147483648;
      };
      const k = 1 + Math.floor(rnd() * 6);
      const n = 1 + Math.floor(rnd() * 9);
      const rows = Array.from({ length: n }, () => Array.from({ length: k }, () => rnd() < 0.6));
      const s = computePassStats(rows);
      expect(s.passPowCurve).toHaveLength(k);
      expect(s.passPowCurve[0]).toBeCloseTo(s.perRunPassRate, 12);
      expect(s.passPowCurve[k - 1]).toBeCloseTo(s.passHatK, 12);
      // Non-increasing in j.
      for (let j = 1; j < k; j += 1) expect((s.passPowCurve[j] ?? 0) <= (s.passPowCurve[j - 1] ?? 0) + 1e-12).toBe(true);
      const det = rows.map((r) => r.map(() => r[0] ?? false));
      const d = computePassStats(det);
      for (const v of d.passPowCurve) expect(v).toBeCloseTo(d.passHatK, 12);
    }
  });

  it('rejects empty input, ragged rows, k = 0 and k > 20', () => {
    expect(() => computePassStats([])).toThrow(RangeError);
    expect(() => computePassStats([[]])).toThrow(RangeError);
    expect(() => computePassStats([[T], [T, F]])).toThrow(RangeError);
    expect(() => computePassStats([Array.from({ length: 21 }, () => T)])).toThrow(RangeError);
  });
});
