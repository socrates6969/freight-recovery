// REQ-20261011-fuel-outlook: test-owned oracle for Part C F7 (AR(2) on log-diffs, combo, naive, walk-forward,
// Diebold-Mariano, gate, volatility-scaled type-7 ranges, target dates) and a minimal reader for the bundled
// FRED CSV files. Written from the F7 text and the owner's bt.py/iv.py only; it never imports the product's
// outlook or fuel modules. Pure (no imports) so it also runs under `node --experimental-strip-types`.

export type Candidate = 'ar2' | 'combo' | 'naive';
export type Reason = 'model_beats_naive' | 'fallback_gate' | 'naive_by_design';
export interface OHorizonCfg { h: number; candidate: Candidate }
export interface OSeriesCfg { m: number; evalYears: number | null; warm: number; frequency: 'weekly' | 'monthly'; horizons: OHorizonCfg[] }

/** F7 `OUTLOOK_SERIES`, restated. */
export const O_CFG: Record<'diesel_us' | 'ppi_tl', OSeriesCfg> = {
  diesel_us: { m: 52, evalYears: 15, warm: 104, frequency: 'weekly', horizons: [{ h: 1, candidate: 'ar2' }, { h: 4, candidate: 'combo' }, { h: 8, candidate: 'naive' }, { h: 13, candidate: 'naive' }] },
  ppi_tl: { m: 12, evalYears: null, warm: 36, frequency: 'monthly', horizons: [{ h: 1, candidate: 'ar2' }] },
};
/** Bounds-checked element access (no non-null assertions in test code). */
export function at<T>(a: readonly T[], i: number): T {
  const v = a[i];
  if (v === undefined) throw new RangeError(`index ${i} out of range (length ${a.length})`);
  return v;
}

export const O_GATE_MIN_ORIGINS = 100;
export const O_GATE_MIN_DM = 1.96;
export const O_VOL_FLOOR = 1e-9;

/** Reads `observation_date,<id>` CSV text (no validation; the product's parser is tested separately). */
export function oReadCsv(text: string): { dates: string[]; values: string[] } {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l !== '');
  const dates: string[] = [];
  const values: string[] = [];
  for (const l of lines.slice(1)) {
    const [d = '', v = ''] = l.split(',');
    dates.push(d);
    values.push(v);
  }
  return { dates, values };
}

/** OLS AR(2) coefficients at origin t with window W (F7.3); null when a pivot is exactly 0 or b is not finite. */
export function oAr2Coef(y: readonly number[], t: number, W: number): [number, number, number] | null {
  const z = (i: number) => Math.log(at(y, i)) - Math.log(at(y, i - 1));
  const A: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const c: number[] = [0, 0, 0];
  for (let i = t - W + 4; i <= t; i++) {
    const x = [1, z(i - 1), z(i - 2)];
    const zi = z(i);
    for (let r = 0; r < 3; r++) {
      const row = at(A, r);
      for (let k = 0; k < 3; k++) row[k] = at(row, k) + at(x, r) * at(x, k);
      c[r] = at(c, r) + at(x, r) * zi;
    }
  }
  // Gaussian elimination with partial pivoting (largest |value|, first row on ties), then back substitution.
  const M: number[][] = A.map((row, r) => [...row, at(c, r)]);
  for (let col = 0; col < 3; col++) {
    let p = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(at(at(M, r), col)) > Math.abs(at(at(M, p), col))) p = r;
    if (at(at(M, p), col) === 0) return null;
    if (p !== col) {
      const tmp = at(M, p);
      M[p] = at(M, col);
      M[col] = tmp;
    }
    const pr = at(M, col);
    for (let r = col + 1; r < 3; r++) {
      const row = at(M, r);
      const f = at(row, col) / at(pr, col);
      for (let k = col; k < 4; k++) row[k] = at(row, k) - f * at(pr, k);
    }
  }
  const b: number[] = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    const row = at(M, r);
    let s = at(row, 3);
    for (let k = r + 1; k < 3; k++) s -= at(row, k) * at(b, k);
    b[r] = s / at(row, r);
  }
  if (!b.every(Number.isFinite)) return null;
  return [at(b, 0), at(b, 1), at(b, 2)];
}

export function oAr2(y: readonly number[], t: number, h: number, W: number): number {
  const b = oAr2Coef(y, t, W);
  if (b === null) return at(y, t);
  let p1 = Math.log(at(y, t)) - Math.log(at(y, t - 1));
  let p2 = Math.log(at(y, t - 1)) - Math.log(at(y, t - 2));
  let s = 0;
  for (let j = 1; j <= h; j++) {
    const zh = b[0] + b[1] * p1 + b[2] * p2;
    p2 = p1;
    p1 = zh;
    s += zh;
  }
  return at(y, t) * Math.exp(s);
}

export function oForecast(kind: Candidate, y: readonly number[], t: number, h: number, W: number): number {
  if (kind === 'naive') return at(y, t);
  const ar = oAr2(y, t, h, W);
  return kind === 'ar2' ? ar : (at(y, t) + ar) / 2;
}

/** F7.5 DM statistic of naive vs candidate errors. */
export function oDm(eNaive: readonly number[], eCand: readonly number[], h: number): number {
  const N = eNaive.length;
  const d = eNaive.map((e, i) => Math.abs(e) - Math.abs(at(eCand, i)));
  const g = d.reduce((a, b) => a + b, 0) / N;
  let v = d.reduce((a, x) => a + (x - g) * (x - g), 0) / N;
  for (let k = 1; k < h; k++) {
    let s = 0;
    for (let i = k; i < N; i++) s += (at(d, i) - g) * (at(d, i - k) - g);
    v += 2 * (1 - k / h) * (s / (N - k));
  }
  return v > 0 ? g / Math.sqrt(v / N) : 0;
}

/** Type-7 quantile of an ascending array. */
export function oQuantile(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const i = Math.floor(pos);
  if (i + 1 >= sorted.length) return at(sorted, i);
  return at(sorted, i) + (pos - i) * (at(sorted, i + 1) - at(sorted, i));
}

export function oPopStd(xs: readonly number[]): number {
  const mu = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - mu) * (x - mu), 0) / xs.length);
}

export function oVol(y: readonly number[], t: number, m: number): number {
  const zs: number[] = [];
  for (let i = t - m + 1; i <= t; i++) zs.push(Math.log(at(y, i)) - Math.log(at(y, i - 1)));
  return Math.max(oPopStd(zs), O_VOL_FLOOR);
}

export function oTargetDate(lastDate: string, h: number, frequency: 'weekly' | 'monthly'): string {
  const [Y = 0, M = 1, D = 1] = lastDate.split('-').map(Number);
  if (frequency === 'weekly') return new Date(Date.UTC(Y, M - 1, D + 7 * h)).toISOString().slice(0, 10);
  return new Date(Date.UTC(Y, M - 1 + h, 1)).toISOString().slice(0, 10);
}

export interface OBacktest {
  h: number; candidate: Candidate; method: Candidate; reason: Reason;
  origins: number; firstOrigin: string; s0: number;
  naiveMae: number; candidateMae: number; maeRatio: number | null; dm: number;
  coverageHits: number; coverageCases: number; coverage: number;
  point: number; low: number; high: number; targetDate: string;
  /** smallest |l_i - bound| over the coverage cases (robustness of the hit counts against float noise) */
  minMargin: number;
}

export function oS0(n: number, cfg: Pick<OSeriesCfg, 'm' | 'evalYears'>): number {
  const half = Math.floor(n / 2);
  return cfg.evalYears === null ? half : Math.max(half, n - cfg.evalYears * cfg.m);
}

/** One horizon of F7 (walk-forward backtest, gate, coverage and the live range at T = n-1). */
export function oBacktest(y: readonly number[], dates: readonly string[], cfg: OSeriesCfg, hc: OHorizonCfg): OBacktest {
  const { h, candidate } = hc;
  const n = y.length;
  const W = 8 * cfg.m;
  const s0 = oS0(n, cfg);
  const N = n - h - s0;
  const fNaive: number[] = [];
  const fCand: number[] = [];
  for (let t = s0; t <= n - 1 - h; t++) {
    fNaive.push(at(y, t));
    fCand.push(oForecast(candidate, y, t, h, W));
  }
  const eN = fNaive.map((f, j) => at(y, s0 + j + h) - f);
  const eC = fCand.map((f, j) => at(y, s0 + j + h) - f);
  const sumN = eN.reduce((a, e) => a + Math.abs(e), 0);
  const sumC = eC.reduce((a, e) => a + Math.abs(e), 0);
  let maeRatio: number | null;
  let dm: number;
  if (candidate === 'naive') {
    maeRatio = 1;
    dm = 0;
  } else {
    maeRatio = sumN === 0 ? null : sumC / sumN;
    dm = oDm(eN, eC, h);
  }
  let method: Candidate;
  let reason: Reason;
  if (candidate === 'naive') { method = 'naive'; reason = 'naive_by_design'; }
  else if (N >= O_GATE_MIN_ORIGINS && maeRatio !== null && maeRatio < 1 && dm >= O_GATE_MIN_DM) { method = candidate; reason = 'model_beats_naive'; }
  else { method = 'naive'; reason = 'fallback_gate'; }
  const fUsed = method === candidate ? fCand : fNaive;
  const l = fUsed.map((f, j) => Math.log(at(y, s0 + j + h)) - Math.log(f));
  const vol = fUsed.map((_, j) => oVol(y, s0 + j, cfg.m));
  const r = l.map((x, j) => x / at(vol, j));
  let hits = 0;
  let minMargin = Infinity;
  for (let i = cfg.warm; i <= N - 1; i++) {
    const past = r.slice(0, i - h + 1).sort((a, b) => a - b);
    const lo = oQuantile(past, 0.1) * at(vol, i);
    const hi = oQuantile(past, 0.9) * at(vol, i);
    const li = at(l, i);
    if (lo <= li && li <= hi) hits++;
    minMargin = Math.min(minMargin, Math.abs(li - lo), Math.abs(li - hi));
  }
  const cases = Math.max(0, N - cfg.warm);
  const T = n - 1;
  const fT = oForecast(method, y, T, h, W);
  const volT = oVol(y, T, cfg.m);
  const all = [...r].sort((a, b) => a - b);
  return {
    h, candidate, method, reason, origins: N, firstOrigin: at(dates, s0), s0,
    naiveMae: sumN / N, candidateMae: sumC / N, maeRatio, dm,
    coverageHits: hits, coverageCases: cases, coverage: cases ? hits / cases : NaN,
    point: fT, low: fT * Math.exp(oQuantile(all, 0.1) * volT), high: fT * Math.exp(oQuantile(all, 0.9) * volT),
    targetDate: oTargetDate(at(dates, T), h, cfg.frequency), minMargin,
  };
}

export function oOutlook(y: readonly number[], dates: readonly string[], cfg: OSeriesCfg): { status: 'ok' | 'insufficient_history'; horizons: OBacktest[]; backtestYears: { from: number; to: number } | null } {
  if (y.length < 16 * cfg.m) return { status: 'insufficient_history', horizons: [], backtestYears: null };
  const horizons = cfg.horizons.map((hc) => oBacktest(y, dates, cfg, hc));
  return { status: 'ok', horizons, backtestYears: { from: Number(at(dates, oS0(y.length, cfg)).slice(0, 4)), to: Number(at(dates, y.length - 1).slice(0, 4)) } };
}

/** F7.9 DTO rounding. */
export const oRound3 = (x: number) => Math.round(x * 1000) / 1000;
export const oRound2 = (x: number) => Math.round(x * 100) / 100;

/** mulberry32 PRNG (seeded, recorded per test) and a Box-Muller normal. */
export function oRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function oNormal(rnd: () => number): () => number {
  return () => {
    let u = 0;
    while (u === 0) u = rnd();
    const v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}
/** Consecutive Mondays from 1990-01-01, or firsts of months from 1950-01-01. */
export function oDates(n: number, frequency: 'weekly' | 'monthly'): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(frequency === 'weekly' ? new Date(Date.UTC(1990, 0, 1 + 7 * i)).toISOString().slice(0, 10) : new Date(Date.UTC(1950, i, 1)).toISOString().slice(0, 10));
  return out;
}
