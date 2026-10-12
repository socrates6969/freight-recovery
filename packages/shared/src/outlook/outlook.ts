/**
 * `computeOutlook` (Part C F7): the backtest of every configured horizon with the status logic and the
 * backtest years. Unrounded doubles; the API rounds (F7.9).
 */
import { backtestSeries, checkSeries, firstOriginIndex, type BacktestHorizonResult } from './backtest.js';
import { MIN_HISTORY_SEASONS, OUTLOOK_SERIES, isPriceSeriesKey, type OutlookStatus, type PriceSeriesKey } from './constants.js';

export interface OutlookComputation {
  status: OutlookStatus;
  horizons: BacktestHorizonResult[];
  /** Year of the first origin date and of the last observation (null unless `ok`). */
  backtestYears: { from: number; to: number } | null;
}

/** F7 outlook of one series: `no_data` (empty input), `insufficient_history` (< 16 seasons) or `ok`. */
export function computeOutlook(dates: readonly string[], values: readonly (number | string)[], seriesKey: PriceSeriesKey): OutlookComputation {
  if (!isPriceSeriesKey(seriesKey)) throw new RangeError('unknown price series');
  checkSeries(dates, values);
  const n = dates.length;
  if (n === 0) return { status: 'no_data', horizons: [], backtestYears: null };
  const cfg = OUTLOOK_SERIES[seriesKey];
  if (n < MIN_HISTORY_SEASONS * cfg.m) return { status: 'insufficient_history', horizons: [], backtestYears: null };
  const horizons = backtestSeries(dates, values, seriesKey);
  const first = dates[firstOriginIndex(n, cfg.m, cfg.evalYears)] ?? '';
  const last = dates[n - 1] ?? '';
  return { status: 'ok', horizons, backtestYears: { from: Number(first.slice(0, 4)), to: Number(last.slice(0, 4)) } };
}
