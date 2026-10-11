/**
 * Step 7 public price series and cost-outlook constants (REQ-20261011-fuel-outlook, Part C F1, F2, F7).
 * Plain data, no runtime imports: exported from the package root. The CSV parser, the models, the
 * backtest and the outlook stay behind the `@fr/shared/outlook` subpath.
 */

export const PRICE_SERIES_KEYS = Object.freeze(['diesel_us', 'ppi_tl'] as const);
export type PriceSeriesKey = (typeof PRICE_SERIES_KEYS)[number];

export type PriceFrequency = 'weekly' | 'monthly';

export interface PriceSeriesDefinition {
  readonly key: PriceSeriesKey;
  readonly fredId: string;
  readonly label: string;
  readonly unit: string;
  readonly frequency: PriceFrequency;
  readonly displayDecimals: number;
  /** Inclusive lower bound of a value (decimal text). */
  readonly minValue: string;
  /** Inclusive upper bound of a value (decimal text). */
  readonly maxValue: string;
  /** The pinned source URL (the only URL an import may record). */
  readonly sourceUrl: string;
  readonly citation: string;
}

/** F2 registry (frozen). */
export const PRICE_SERIES: Readonly<Record<PriceSeriesKey, PriceSeriesDefinition>> = Object.freeze({
  diesel_us: Object.freeze({
    key: 'diesel_us',
    fredId: 'GASDESW',
    label: 'U.S. average diesel price',
    unit: 'USD per gallon',
    frequency: 'weekly',
    displayDecimals: 3,
    minValue: '0.5',
    maxValue: '20',
    sourceUrl: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASDESW',
    citation: 'U.S. Energy Information Administration, US Diesel Sales Price [GASDESW], retrieved from FRED, Federal Reserve Bank of St. Louis',
  }),
  ppi_tl: Object.freeze({
    key: 'ppi_tl',
    fredId: 'PCU4841214841212',
    label: 'Producer price index, long-distance truckload',
    unit: 'index (Jun 1992 = 100)',
    frequency: 'monthly',
    displayDecimals: 1,
    minValue: '10',
    maxValue: '2000',
    sourceUrl: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=PCU4841214841212',
    citation:
      'U.S. Bureau of Labor Statistics, Producer Price Index by Industry: General Freight Trucking, Long-Distance Truckload [PCU4841214841212], retrieved from FRED, Federal Reserve Bank of St. Louis',
  }),
});

export function isPriceSeriesKey(value: unknown): value is PriceSeriesKey {
  return typeof value === 'string' && (PRICE_SERIES_KEYS as readonly string[]).includes(value);
}

export const OUTLOOK_VERSION = 'outlook-v1';

export const OUTLOOK_METHODS = Object.freeze(['ar2', 'combo', 'naive'] as const);
export type OutlookMethod = (typeof OUTLOOK_METHODS)[number];

export const OUTLOOK_REASONS = Object.freeze(['model_beats_naive', 'fallback_gate', 'naive_by_design'] as const);
export type OutlookReason = (typeof OUTLOOK_REASONS)[number];

export const OUTLOOK_STATUSES = Object.freeze(['ok', 'no_data', 'insufficient_history'] as const);
export type OutlookStatus = (typeof OUTLOOK_STATUSES)[number];

export interface OutlookHorizonConfig {
  readonly h: number;
  readonly candidate: OutlookMethod;
}

export interface OutlookSeriesConfig {
  /** Season length (observations per year). */
  readonly m: number;
  /** Walk-forward evaluation span in years (null: the second half of the history). */
  readonly evalYears: number | null;
  /** Coverage cases start at this origin index (range warm-up). */
  readonly warm: number;
  readonly horizons: readonly OutlookHorizonConfig[];
}

/** F7 configuration (frozen). */
export const OUTLOOK_SERIES: Readonly<Record<PriceSeriesKey, OutlookSeriesConfig>> = Object.freeze({
  diesel_us: Object.freeze({
    m: 52,
    evalYears: 15,
    warm: 104,
    horizons: Object.freeze([
      Object.freeze({ h: 1, candidate: 'ar2' as const }),
      Object.freeze({ h: 4, candidate: 'combo' as const }),
      Object.freeze({ h: 8, candidate: 'naive' as const }),
      Object.freeze({ h: 13, candidate: 'naive' as const }),
    ]),
  }),
  ppi_tl: Object.freeze({
    m: 12,
    evalYears: null,
    warm: 36,
    horizons: Object.freeze([Object.freeze({ h: 1, candidate: 'ar2' as const })]),
  }),
});

/** Gate: a model is used only with at least this many walk-forward origins ... */
export const GATE_MIN_ORIGINS = 100;
/** ... a Diebold-Mariano statistic of at least this value, and a MAE ratio strictly below 1. */
export const GATE_MIN_DM = 1.96;

/** Quantiles of the 80% range. */
export const RANGE_QUANTILES = Object.freeze([0.1, 0.9] as const);

/** Floor of the origin volatility (avoids division by zero on flat stretches). */
export const VOL_FLOOR = 1e-9;

/** A series needs at least this many seasons of history for an outlook. */
export const MIN_HISTORY_SEASONS = 16;

/** AR(2) window in seasons (W = 8m). */
export const AR_WINDOW_SEASONS = 8;

/** One stored observation: `YYYY-MM-DD` and the value with exactly 3 decimals. */
export interface PriceObservationData {
  readonly date: string;
  readonly value: string;
}

/** The active import of one series with its observations in date order (price store output). */
export interface PriceSeriesData {
  readonly key: PriceSeriesKey;
  readonly importId: string;
  readonly sha256: string;
  readonly sourceUrl: string;
  readonly retrievedAt: string;
  readonly observations: readonly PriceObservationData[];
}

/** Bounds of a price CSV (F9). */
export const PRICE_CSV_MAX_BYTES = 1_048_576;
export const PRICE_CSV_MAX_ROWS = 5000;
