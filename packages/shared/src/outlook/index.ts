/**
 * `@fr/shared/outlook` (REQ-20261011-fuel-outlook): the step-7 public price data and cost outlook. Strict
 * price CSV parser, AR(2)/combo/naive models, walk-forward backtest with the gate and the volatility-scaled
 * 80% range. The package root re-exports only the constants, copy and DTOs.
 */
export * from './constants.js';
export * from './copy.js';
export * from '../outlook-dto.js';
export * from '../fuel/constants.js';
export * from '../fuel/copy.js';
export * from '../fuel-dto.js';
export { sha256Hex } from './sha256.js';
export { PRICE_CSV_ERROR_CODES, PriceCsvError, parsePriceCsv, type ParsedPriceCsv, type PriceCsvErrorCode } from './csv.js';
export { ar2Coefficients, ar2Forecast, ar2Path, logDiffs, solve3, type Ar2Coefficients } from './ar.js';
export { backtestSeries, checkSeries, dieboldMariano, firstOriginIndex, popstd, quantile7, targetDate, type BacktestHorizonResult } from './backtest.js';
export { computeOutlook, type OutlookComputation } from './outlook.js';
