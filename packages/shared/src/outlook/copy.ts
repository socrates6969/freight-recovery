/**
 * Fixed UI copy of the step-7 cost outlook (Part C F15). Forecasts are shown only where a walk-forward
 * backtest on public data beat "no change"; nothing here claims accuracy or a guarantee.
 */
import type { OutlookMethod, OutlookReason } from './constants.js';

export const OUTLOOK_NOTE =
  'Forecasts are shown only at horizons where a model beat "no change" in a walk-forward backtest on public data; other horizons show "no change" with a range. Not a guarantee.';

/** `Backtested on public data ${from}-${to}; not a guarantee.` */
export function outlookBacktestText(from: number, to: number): string {
  return `Backtested on public data ${from}-${to}; not a guarantee.`;
}

/** `80% range. In the backtest, ${Math.round(coverage * 100)}% of outcomes fell inside ranges built this way.` */
export function rangeText(coverage: number): string {
  return `80% range. In the backtest, ${Math.round(coverage * 100)}% of outcomes fell inside ranges built this way.`;
}

export const METHOD_LABELS: Readonly<Record<OutlookMethod, string>> = Object.freeze({
  ar2: 'Trend model',
  combo: 'Average of trend model and no change',
  naive: 'No change',
});

export const REASON_LABELS: Readonly<Record<OutlookReason, string>> = Object.freeze({
  model_beats_naive: 'Beat "no change" in the backtest',
  fallback_gate: 'The model no longer beats "no change"; showing "no change"',
  naive_by_design: 'No model beat "no change" at this horizon',
});

export const OUTLOOK_TEXT = Object.freeze({
  nav: 'Outlook',
  heading: 'Cost outlook',
  noData: 'No public price data has been imported yet.',
  insufficient: 'Not enough price history for an outlook.',
  fscTable: 'Fuel table',
});

export const OUTLOOK_EVAL_NOTE =
  'Walk-forward backtest on bundled public price history (U.S. EIA and BLS data via FRED). It is a regression check of the forecast and range rules, not a guarantee about future prices.';
