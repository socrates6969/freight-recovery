/* eslint-disable */
// T8 (T-STAT-01..03): computePassStats worked vectors, properties and error handling. Absolute tolerance 1e-6 for listed values.
import { describe, expect, it } from 'vitest';

const load = async () => (await import('@fr/shared')) as any;
const T = true, F = false;
const TOL = 1e-6;
const near = (a: number, b: number, label: string, tol = TOL) => expect(Math.abs(a - b) <= tol, `${label}: ${a} vs ${b} (tol ${tol})`).toBe(true);

interface Vec { name: string; rows: boolean[][]; cases: number; k: number; runsPassed: number; rate: number; hatCount: number; hat: number; atLeastOne: number; flaky: number; alwaysFail: number; curve: number[]; wilson: [number, number] }
const rep = (n: number, row: boolean[]) => Array.from({ length: n }, () => [...row]);
const VECTORS: Vec[] = [
  { name: 'mixed 4x3', rows: [[T, T, T], [T, T, F], [F, F, F], [T, T, T]], cases: 4, k: 3, runsPassed: 8, rate: 0.666667, hatCount: 2, hat: 0.5, atLeastOne: 3, flaky: 1, alwaysFail: 1, curve: [0.666667, 0.583333, 0.5], wilson: [0.150039, 0.849961] },
  { name: 'one case, all pass, k=5', rows: [[T, T, T, T, T]], cases: 1, k: 5, runsPassed: 5, rate: 1, hatCount: 1, hat: 1, atLeastOne: 1, flaky: 0, alwaysFail: 0, curve: [1, 1, 1, 1, 1], wilson: [0.206549, 1] },
  { name: 'one case, all fail, k=2', rows: [[F, F]], cases: 1, k: 2, runsPassed: 0, rate: 0, hatCount: 0, hat: 0, atLeastOne: 0, flaky: 0, alwaysFail: 1, curve: [0, 0], wilson: [0, 0.793451] },
  { name: 'k=1, five cases', rows: [[T], [F], [T], [T], [F]], cases: 5, k: 1, runsPassed: 3, rate: 0.6, hatCount: 3, hat: 0.6, atLeastOne: 3, flaky: 0, alwaysFail: 2, curve: [0.6], wilson: [0.230724, 0.882379] },
  { name: 'six cases, k=4, mostly flaky', rows: [[T, F, T, F], [T, T, T, F], [T, T, T, T], [F, F, F, F], [T, F, F, F], [T, T, F, F]], cases: 6, k: 4, runsPassed: 12, rate: 0.5, hatCount: 1, hat: 0.166667, atLeastOne: 5, flaky: 4, alwaysFail: 1, curve: [0.5, 0.305556, 0.208333, 0.166667], wilson: [0.030053, 0.563503] },
  { name: 'twenty perfect cases, k=3', rows: rep(20, [T, T, T]), cases: 20, k: 3, runsPassed: 60, rate: 1, hatCount: 20, hat: 1, atLeastOne: 20, flaky: 0, alwaysFail: 0, curve: [1, 1, 1], wilson: [0.838875, 1] },
  { name: 'twelve cases, five perfect, seven failing', rows: Array.from({ length: 12 }, (_, i) => ([0, 5, 6, 7, 8].includes(i) ? [T, T, T] : [F, F, F])), cases: 12, k: 3, runsPassed: 15, rate: 0.416667, hatCount: 5, hat: 0.416667, atLeastOne: 5, flaky: 0, alwaysFail: 7, curve: [0.416667, 0.416667, 0.416667], wilson: [0.19326, 0.680489] },
];

describe('T-STAT-01 worked vectors', () => {
  for (const v of VECTORS) {
    it(v.name, async () => {
      const { computePassStats } = await load();
      const s = computePassStats(v.rows);
      expect(s.cases).toBe(v.cases);
      expect(s.k).toBe(v.k);
      expect(s.runsTotal).toBe(v.cases * v.k);
      expect(s.runsPassed).toBe(v.runsPassed);
      near(s.perRunPassRate, v.rate, 'perRunPassRate');
      expect(s.passHatKCount).toBe(v.hatCount);
      near(s.passHatK, v.hat, 'passHatK');
      expect(s.passAtLeastOneCount).toBe(v.atLeastOne);
      expect(s.flakyCaseCount).toBe(v.flaky);
      expect(s.alwaysFailCount).toBe(v.alwaysFail);
      expect(s.passPowCurve.length).toBe(v.k);
      v.curve.forEach((c, i) => near(s.passPowCurve[i], c, `passPowCurve[${i}]`));
      near(s.wilson95.low, v.wilson[0], 'wilson95.low');
      near(s.wilson95.high, v.wilson[1], 'wilson95.high');
    });
  }
});

// seeded generator (mulberry32), seed 20261009
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const choose = (n: number, r: number): number => {
  if (r < 0 || r > n) return 0;
  let x = 1;
  for (let i = 1; i <= r; i++) x = (x * (n - r + i)) / i;
  return x;
};
const wilson = (x: number, n: number) => {
  const z = 1.959964, p = x / n, den = 1 + (z * z) / n, centre = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, centre - half), Math.min(1, centre + half)] as const;
};

describe('T-STAT-02 properties (seed 20261009, 200 matrices)', () => {
  it('structural invariants, independent recomputation, and invariance under permutations', async () => {
    const { computePassStats } = await load();
    const rnd = prng(20261009);
    for (let m = 0; m < 200; m++) {
      const n = 1 + Math.floor(rnd() * 30);
      const k = 1 + Math.floor(rnd() * 8);
      const rowP = Array.from({ length: n }, () => (rnd() < 0.3 ? (rnd() < 0.5 ? 0 : 1) : rnd()));
      const rows = rowP.map((p) => Array.from({ length: k }, () => rnd() < p));
      const s = computePassStats(rows);
      const label = `matrix ${m} (n=${n}, k=${k})`;
      expect(s.passPowCurve.length, label).toBe(k);
      s.passPowCurve.forEach((v: number, j: number) => {
        expect(v >= 0 && v <= 1 + 1e-12, `${label} curve[${j}]=${v}`).toBe(true);
        if (j > 0) expect(v <= s.passPowCurve[j - 1] + 1e-12, `${label} non-increasing at ${j}`).toBe(true);
      });
      near(s.passPowCurve[0], s.perRunPassRate, `${label} curve[0]`);
      near(s.passPowCurve[k - 1], s.passHatK, `${label} curve[k-1]`);
      if (s.flakyCaseCount === 0) for (const v of s.passPowCurve) near(v, s.passHatK, `${label} no flaky`);
      expect(s.passHatKCount <= s.passAtLeastOneCount && s.passAtLeastOneCount <= s.cases, label).toBe(true);
      expect(s.flakyCaseCount + s.alwaysFailCount + s.passHatKCount, label).toBe(s.cases);
      expect(s.wilson95.low <= s.passHatK + 1e-12 && s.passHatK <= s.wilson95.high + 1e-12, `${label} wilson contains passHatK`).toBe(true);
      expect(s.wilson95.low >= 0 && s.wilson95.high <= 1 && s.wilson95.low <= s.wilson95.high, label).toBe(true);
      // independent recomputation from the contract formulas
      const c = rows.map((r) => r.filter(Boolean).length);
      for (let j = 1; j <= k; j++) near(s.passPowCurve[j - 1], c.reduce((a, ci) => a + choose(ci, j) / choose(k, j), 0) / n, `${label} curve ${j}`, 1e-9);
      const [lo, hi] = wilson(c.filter((x) => x === k).length, n);
      near(s.wilson95.low, lo, `${label} wilson low`, 1e-9);
      near(s.wilson95.high, hi, `${label} wilson high`, 1e-9);
      // invariance
      const shuffled = [...rows].reverse().map((r, i) => (i % 2 ? [...r].reverse() : r));
      const s2 = computePassStats(shuffled);
      expect(s2.runsPassed).toBe(s.runsPassed);
      expect(s2.passHatKCount).toBe(s.passHatKCount);
      expect(s2.flakyCaseCount).toBe(s.flakyCaseCount);
      s2.passPowCurve.forEach((v: number, j: number) => near(v, s.passPowCurve[j], `${label} permuted curve ${j}`, 1e-9));
      near(s2.wilson95.low, s.wilson95.low, `${label} permuted wilson`, 1e-9);
    }
  });
  it('the lower interval bound of all-pass inputs strictly increases with the number of cases', async () => {
    const { computePassStats } = await load();
    const lows = [5, 20, 100].map((n) => computePassStats(rep(n, [T, T, T])).wilson95.low);
    expect(lows[0]).toBeLessThan(lows[1]);
    expect(lows[1]).toBeLessThan(lows[2]);
  });
});

describe('T-STAT-03 errors', () => {
  it('invalid shapes throw RangeError and never return a result', async () => {
    const { computePassStats } = await load();
    for (const bad of [[], [[]], [[T, T], [T]], [[T], [T, T]]]) expect(() => computePassStats(bad as any), JSON.stringify(bad)).toThrow(RangeError);
  });
  it('non-array rows and non-boolean cells throw', async () => {
    const { computePassStats } = await load();
    for (const bad of [[true], [[T], 'x'], [[1, 0]], [[T, 'true']], [[T, null]], [null], 'abc', undefined]) {
      let result: unknown;
      let thrown: unknown;
      try { result = computePassStats(bad as any); } catch (e) { thrown = e; }
      expect(thrown, `${JSON.stringify(bad)} must throw (got ${JSON.stringify(result)})`).toBeInstanceOf(Error);
    }
  });
});