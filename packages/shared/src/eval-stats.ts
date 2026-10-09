/**
 * Evaluation statistics (Q7.1). Pure, dependency-free. `outcomes[i][j]` = run j of case i was correct.
 *
 * - passPowCurve[j-1] = (1/n) * sum_i C(c_i, j) / C(k, j): for each case an unbiased estimate of p_i^j
 *   from c_i successes in k runs (sampling without replacement), averaged over cases.
 * - wilson95: Wilson score interval (z = 1.959964) for passHatKCount / n.
 * Numbers are NOT rounded here.
 */

export const WILSON_Z = 1.959964;
/** k above this would lose exactness of the floating-point binomial coefficients. */
export const MAX_EVAL_K = 20;

export interface PassStats {
  cases: number;
  k: number;
  runsTotal: number;
  runsPassed: number;
  perRunPassRate: number;
  passHatKCount: number;
  passHatK: number;
  passAtLeastOneCount: number;
  flakyCaseCount: number;
  alwaysFailCount: number;
  passPowCurve: number[];
  wilson95: { low: number; high: number };
}

/** Binomial coefficient C(a, b) by the multiplicative formula (exact for a <= 20); 0 when b > a. */
export function binomial(a: number, b: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) throw new RangeError('binomial: non-negative integers required');
  if (b > a) return 0;
  const m = Math.min(b, a - b);
  let r = 1;
  for (let i = 1; i <= m; i += 1) r = (r * (a - m + i)) / i;
  return Math.round(r);
}

/** Wilson score interval for x successes out of n (95%, z = 1.959964), clamped to [0, 1]. */
export function wilsonInterval(x: number, n: number, z: number = WILSON_Z): { low: number; high: number } {
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(x) || x < 0 || x > n) throw new RangeError('wilsonInterval: 0 <= x <= n, n >= 1');
  const p = x / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export function computePassStats(outcomes: readonly (readonly boolean[])[]): PassStats {
  if (!Array.isArray(outcomes) || outcomes.length === 0) throw new RangeError('computePassStats: at least one case is required');
  const first = outcomes[0];
  const k = first ? first.length : 0;
  if (k < 1) throw new RangeError('computePassStats: k must be >= 1');
  if (k > MAX_EVAL_K) throw new RangeError(`computePassStats: k must be <= ${MAX_EVAL_K}`);
  const counts: number[] = [];
  for (const row of outcomes) {
    if (!Array.isArray(row) || row.length !== k) throw new RangeError('computePassStats: every case needs exactly k runs');
    let c = 0;
    for (const v of row) {
      if (typeof v !== 'boolean') throw new RangeError('computePassStats: outcomes must be booleans');
      if (v) c += 1;
    }
    counts.push(c);
  }
  const n = counts.length;
  const runsPassed = counts.reduce((a, b) => a + b, 0);
  const passHatKCount = counts.filter((c) => c === k).length;
  const passAtLeastOneCount = counts.filter((c) => c >= 1).length;
  const flakyCaseCount = counts.filter((c) => c > 0 && c < k).length;
  const alwaysFailCount = counts.filter((c) => c === 0).length;
  const passPowCurve: number[] = [];
  for (let j = 1; j <= k; j += 1) {
    const ckj = binomial(k, j);
    let sum = 0;
    for (const c of counts) sum += binomial(c, j) / ckj;
    passPowCurve.push(sum / n);
  }
  return {
    cases: n,
    k,
    runsTotal: n * k,
    runsPassed,
    perRunPassRate: runsPassed / (n * k),
    passHatKCount,
    passHatK: passHatKCount / n,
    passAtLeastOneCount,
    flakyCaseCount,
    alwaysFailCount,
    passPowCurve,
    wilson95: wilsonInterval(passHatKCount, n),
  };
}
