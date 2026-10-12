/**
 * AR(2) on log-differences (Part C F7.3). The fit at origin `t` is ordinary least squares of `z_i` on
 * `(1, z_{i-1}, z_{i-2})` for `i = t-W+4 .. t`, solved from the normal equations by Gaussian elimination
 * with partial pivoting (largest absolute value, first row on ties) and back substitution. Plain double
 * accumulation in increasing `i` (no Kahan), so results are reproducible across Node versions.
 */

/** Number of regressors (constant, z_{i-1}, z_{i-2}). */
const P = 3;
/** First row of the window relative to `t - W` (the W levels give W-1 diffs, 2 of which are lags). */
const WINDOW_ROW_OFFSET = 4;

export type Ar2Coefficients = readonly [number, number, number];

/** `z_i = ln(y_i) - ln(y_{i-1})` for i >= 1 (z_0 = 0, unused). */
export function logDiffs(y: ArrayLike<number>): Float64Array {
  const z = new Float64Array(y.length);
  for (let i = 1; i < y.length; i += 1) z[i] = Math.log(y[i] ?? Number.NaN) - Math.log(y[i - 1] ?? Number.NaN);
  return z;
}

/** Solve the 3x3 system `A b = c`; null when a pivot is exactly 0 or a coefficient is not finite. */
export function solve3(a: readonly (readonly number[])[], c: readonly number[]): Ar2Coefficients | null {
  const m = a.map((row) => [...row]);
  const r = [...c];
  for (let k = 0; k < P; k += 1) {
    let piv = k;
    for (let i = k + 1; i < P; i += 1) if (Math.abs(m[i]?.[k] ?? 0) > Math.abs(m[piv]?.[k] ?? 0)) piv = i;
    const pivotRow = m[piv] ?? [];
    if ((pivotRow[k] ?? 0) === 0) return null;
    if (piv !== k) {
      [m[k], m[piv]] = [pivotRow, m[k] ?? []];
      [r[k], r[piv]] = [r[piv] ?? 0, r[k] ?? 0];
    }
    const rowK = m[k] ?? [];
    for (let i = k + 1; i < P; i += 1) {
      const rowI = m[i] ?? [];
      const f = (rowI[k] ?? 0) / (rowK[k] ?? 1);
      for (let j = k; j < P; j += 1) rowI[j] = (rowI[j] ?? 0) - f * (rowK[j] ?? 0);
      r[i] = (r[i] ?? 0) - f * (r[k] ?? 0);
    }
  }
  const b = [0, 0, 0];
  for (let i = P - 1; i >= 0; i -= 1) {
    const row = m[i] ?? [];
    let s = r[i] ?? 0;
    for (let j = i + 1; j < P; j += 1) s -= (row[j] ?? 0) * (b[j] ?? 0);
    b[i] = s / (row[i] ?? 1);
  }
  if (!b.every(Number.isFinite)) return null;
  return [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0];
}

/** OLS coefficients at origin `t` with window `W` (rows `i = t-W+4 .. t`), or null when singular. */
export function ar2Coefficients(z: Float64Array, t: number, W: number): Ar2Coefficients | null {
  const a = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const c = [0, 0, 0];
  for (let i = t - W + WINDOW_ROW_OFFSET; i <= t; i += 1) {
    const x = [1, z[i - 1] ?? 0, z[i - 2] ?? 0];
    const zi = z[i] ?? 0;
    for (let r = 0; r < P; r += 1) {
      const row = a[r] ?? [];
      for (let k = 0; k < P; k += 1) row[k] = (row[k] ?? 0) + (x[r] ?? 0) * (x[k] ?? 0);
      c[r] = (c[r] ?? 0) + (x[r] ?? 0) * zi;
    }
  }
  return solve3(a, c);
}

/** AR(2) forecast from a fitted origin: `y_t * exp(sum of the h iterated log-diff forecasts)`; `y_t` when unfitted. */
export function ar2Path(yt: number, z: Float64Array, t: number, h: number, coef: Ar2Coefficients | null): number {
  if (coef === null) return yt;
  const [b0, b1, b2] = coef;
  let p1 = z[t] ?? 0;
  let p2 = z[t - 1] ?? 0;
  let s = 0;
  for (let j = 1; j <= h; j += 1) {
    const zhat = b0 + b1 * p1 + b2 * p2;
    p2 = p1;
    p1 = zhat;
    s += zhat;
  }
  return yt * Math.exp(s);
}

/**
 * F7.3 `ar2Forecast(y, t, h, W)`: the AR(2) forecast of `y_{t+h}` made at origin `t` with a window of `W`
 * levels. Requires `t - W + 2 >= 1` and `t < y.length`.
 */
export function ar2Forecast(y: readonly number[], t: number, h: number, W: number): number {
  if (!Number.isInteger(t) || !Number.isInteger(h) || !Number.isInteger(W) || h < 1 || W < WINDOW_ROW_OFFSET + 1) throw new RangeError('invalid AR(2) arguments');
  if (t >= y.length || t - W + 2 < 1) throw new RangeError('origin outside the series');
  for (const v of y) if (!Number.isFinite(v) || v <= 0) throw new RangeError('values must be finite and > 0');
  const z = logDiffs(y);
  return ar2Path(y[t] ?? Number.NaN, z, t, h, ar2Coefficients(z, t, W));
}
