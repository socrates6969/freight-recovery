/**
 * Walk-forward backtest, gate and volatility-scaled 80% range (Part C F7.2-F7.8, spec A4). Every forecast
 * at origin `t` uses only `y_0..y_t`; every range uses only scaled errors whose outcome is known at the
 * origin. Returns unrounded doubles; only DTOs round.
 */
import { addDays } from '../fuel/week.js';

import { ar2Coefficients, ar2Path, logDiffs, type Ar2Coefficients } from './ar.js';
import {
  AR_WINDOW_SEASONS,
  GATE_MIN_DM,
  GATE_MIN_ORIGINS,
  MIN_HISTORY_SEASONS,
  OUTLOOK_SERIES,
  PRICE_SERIES,
  RANGE_QUANTILES,
  VOL_FLOOR,
  isPriceSeriesKey,
  type OutlookMethod,
  type OutlookReason,
  type PriceSeriesKey,
} from './constants.js';

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
const DAYS_PER_WEEK = 7;
const MONTHS_PER_YEAR = 12;

export interface BacktestHorizonResult {
  h: number;
  unit: 'week' | 'month';
  candidate: OutlookMethod;
  method: OutlookMethod;
  reason: OutlookReason;
  /** N = number of walk-forward origins. */
  origins: number;
  firstOrigin: string;
  naiveMae: number;
  candidateMae: number;
  maeRatio: number | null;
  dm: number;
  coverage: number;
  coverageHits: number;
  coverageCases: number;
  /** Live forecast at the last observation (method used) and its 80% range. */
  point: number;
  low: number;
  high: number;
  targetDate: string;
}

/** Validated numeric levels: dates strictly ascending `YYYY-MM-DD`, values finite and > 0. */
export function checkSeries(dates: readonly string[], values: readonly (number | string)[]): number[] {
  if (!Array.isArray(dates) || !Array.isArray(values) || dates.length !== values.length) throw new RangeError('dates and values must have the same length');
  const y = values.map((v) => Number(v));
  for (let i = 0; i < y.length; i += 1) {
    const v = y[i] ?? Number.NaN;
    if (!Number.isFinite(v) || v <= 0) throw new RangeError('values must be finite and > 0');
    const d = dates[i];
    if (typeof d !== 'string' || !DATE.test(d)) throw new RangeError('dates must be YYYY-MM-DD');
    const prev = dates[i - 1];
    if (i > 0 && (prev === undefined || prev >= d)) throw new RangeError('dates must be ascending');
  }
  return y;
}

/** Population standard deviation: mean first, then mean of squared deviations. */
export function popstd(xs: ArrayLike<number>, from: number, to: number): number {
  const n = to - from + 1;
  let s = 0;
  for (let i = from; i <= to; i += 1) s += xs[i] ?? 0;
  const mean = s / n;
  let q = 0;
  for (let i = from; i <= to; i += 1) {
    const d = (xs[i] ?? 0) - mean;
    q += d * d;
  }
  return Math.sqrt(q / n);
}

/** Type-7 quantile of an ascending array (length >= 1). */
export function quantile7(sorted: ArrayLike<number>, q: number): number {
  const len = sorted.length;
  if (len === 0) throw new RangeError('empty sample');
  const pos = (len - 1) * q;
  const i = Math.floor(pos);
  const xi = sorted[i] ?? Number.NaN;
  if (i + 1 >= len) return xi;
  return xi + (pos - i) * ((sorted[i + 1] ?? Number.NaN) - xi);
}

/** Insert `x` into the ascending array `a` (binary search; equal values go after existing ones). */
function insertSorted(a: number[], x: number): void {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((a[mid] ?? 0) <= x) lo = mid + 1;
    else hi = mid;
  }
  a.splice(lo, 0, x);
}

/** Diebold-Mariano statistic of `d = |e_naive| - |e_candidate|` with the h-1 autocovariance terms. */
export function dieboldMariano(d: ArrayLike<number>, h: number): number {
  const n = d.length;
  let s = 0;
  for (let i = 0; i < n; i += 1) s += d[i] ?? 0;
  const g = s / n;
  let v = 0;
  for (let i = 0; i < n; i += 1) {
    const x = (d[i] ?? 0) - g;
    v += x * x;
  }
  v /= n;
  for (let k = 1; k < h; k += 1) {
    let c = 0;
    for (let i = k; i < n; i += 1) c += ((d[i] ?? 0) - g) * ((d[i - k] ?? 0) - g);
    v += 2 * (1 - k / h) * (c / (n - k));
  }
  return v > 0 ? g / Math.sqrt(v / n) : 0;
}

/** F7.8 target date: weekly `last + 7h` days; monthly the 1st of the month h months after `last`. */
export function targetDate(last: string, h: number, frequency: 'weekly' | 'monthly'): string {
  if (frequency === 'weekly') return addDays(last, DAYS_PER_WEEK * h);
  const y = Number(last.slice(0, 4));
  const m = Number(last.slice(5, 7)) - 1 + h;
  const yy = y + Math.floor(m / MONTHS_PER_YEAR);
  const mm = (m % MONTHS_PER_YEAR) + 1;
  return `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-01`;
}

/** First walk-forward origin `s0` (F7.2). */
export function firstOriginIndex(n: number, m: number, evalYears: number | null): number {
  const half = Math.floor(n / 2);
  return evalYears === null ? half : Math.max(half, n - evalYears * m);
}

/**
 * F7 walk-forward backtest of every configured horizon of `seriesKey`. Returns one result per horizon, or
 * [] when the history is shorter than 16 seasons.
 */
export function backtestSeries(dates: readonly string[], values: readonly (number | string)[], seriesKey: PriceSeriesKey): BacktestHorizonResult[] {
  if (!isPriceSeriesKey(seriesKey)) throw new RangeError('unknown price series');
  const y = checkSeries(dates, values);
  const cfg = OUTLOOK_SERIES[seriesKey];
  const frequency = PRICE_SERIES[seriesKey].frequency;
  const n = y.length;
  const { m } = cfg;
  if (n < MIN_HISTORY_SEASONS * m) return [];
  const W = AR_WINDOW_SEASONS * m;
  const s0 = firstOriginIndex(n, m, cfg.evalYears);
  const z = logDiffs(y);
  const coefCache = new Map<number, Ar2Coefficients | null>();
  const coefAt = (t: number): Ar2Coefficients | null => {
    if (!coefCache.has(t)) coefCache.set(t, ar2Coefficients(z, t, W));
    return coefCache.get(t) ?? null;
  };
  const forecast = (method: OutlookMethod, t: number, h: number): number => {
    const yt = y[t] ?? Number.NaN;
    if (method === 'naive') return yt;
    const ar = ar2Path(yt, z, t, h, coefAt(t));
    return method === 'ar2' ? ar : (yt + ar) / 2;
  };
  const volAt = (t: number): number => Math.max(popstd(z, t - m + 1, t), VOL_FLOOR);
  const [qLo, qHi] = RANGE_QUANTILES;
  const lastDate = dates[n - 1] ?? '';

  return cfg.horizons.map(({ h, candidate }) => {
    const N = n - h - s0;
    const absN = new Float64Array(N);
    const absC = new Float64Array(N);
    let sumN = 0;
    let sumC = 0;
    for (let j = 0; j < N; j += 1) {
      const t = s0 + j;
      const actual = y[t + h] ?? Number.NaN;
      absN[j] = Math.abs(actual - (y[t] ?? Number.NaN));
      absC[j] = candidate === 'naive' ? absN[j] ?? 0 : Math.abs(actual - forecast(candidate, t, h));
      sumN += absN[j] ?? 0;
      sumC += absC[j] ?? 0;
    }
    let maeRatio: number | null;
    let dm: number;
    if (candidate === 'naive') {
      maeRatio = 1;
      dm = 0;
    } else {
      maeRatio = sumN === 0 ? null : sumC / sumN;
      const d = new Float64Array(N);
      for (let j = 0; j < N; j += 1) d[j] = (absN[j] ?? 0) - (absC[j] ?? 0);
      dm = dieboldMariano(d, h);
    }
    let method: OutlookMethod;
    let reason: OutlookReason;
    if (candidate === 'naive') {
      method = 'naive';
      reason = 'naive_by_design';
    } else if (N >= GATE_MIN_ORIGINS && maeRatio !== null && maeRatio < 1 && dm >= GATE_MIN_DM) {
      method = candidate;
      reason = 'model_beats_naive';
    } else {
      method = 'naive';
      reason = 'fallback_gate';
    }

    // F7.7 range for the method used.
    const l = new Float64Array(N);
    const vol = new Float64Array(N);
    const r = new Float64Array(N);
    for (let j = 0; j < N; j += 1) {
      const t = s0 + j;
      l[j] = Math.log(y[t + h] ?? Number.NaN) - Math.log(forecast(method, t, h));
      vol[j] = volAt(t);
      r[j] = (l[j] ?? 0) / (vol[j] ?? 1);
    }
    const sorted: number[] = [];
    let next = 0;
    let hits = 0;
    let cases = 0;
    for (let i = cfg.warm; i < N; i += 1) {
      while (next <= i - h) {
        insertSorted(sorted, r[next] ?? 0);
        next += 1;
      }
      if (sorted.length === 0) continue;
      const lo = quantile7(sorted, qLo) * (vol[i] ?? 0);
      const hi = quantile7(sorted, qHi) * (vol[i] ?? 0);
      const li = l[i] ?? 0;
      cases += 1;
      if (lo <= li && li <= hi) hits += 1;
    }
    const all = Float64Array.from(r).sort();
    const T = n - 1;
    const fT = forecast(method, T, h);
    const volT = volAt(T);
    return {
      h,
      unit: frequency === 'weekly' ? 'week' : 'month',
      candidate,
      method,
      reason,
      origins: N,
      firstOrigin: dates[s0] ?? '',
      naiveMae: sumN / N,
      candidateMae: sumC / N,
      maeRatio,
      dm,
      coverage: cases === 0 ? 0 : hits / cases,
      coverageHits: hits,
      coverageCases: cases,
      point: fT,
      low: N === 0 ? fT : fT * Math.exp(quantile7(all, qLo) * volT),
      high: N === 0 ? fT : fT * Math.exp(quantile7(all, qHi) * volT),
      targetDate: targetDate(lastDate, h, frequency),
    };
  });
}
