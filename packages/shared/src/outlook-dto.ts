/**
 * Step 7 cost-outlook contract (REQ-20261011-fuel-outlook, Part C F10): the outlook query, the response
 * DTOs and the evaluation report of `eval:outlook`. Exported from the package root; imports no engine code.
 */
import { z } from 'zod';

import { OUTLOOK_METHODS, OUTLOOK_REASONS, OUTLOOK_STATUSES, OUTLOOK_VERSION, PRICE_SERIES_KEYS } from './outlook/constants.js';
import { OUTLOOK_EVAL_NOTE, OUTLOOK_NOTE } from './outlook/copy.js';

const uuid = z.uuid();
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const DECIMAL = /^-?[0-9]+(\.[0-9]+)?$/u;
const dateText = z.string().regex(DATE);
const decimalText = z.string().regex(DECIMAL);
const count = z.int().min(0);

/**
 * Fix round 2 (F10 precedence 6): `fscTableId` is a bounded string here, not a uuid, so a syntactically invalid
 * id reaches the route and gets the same 404 as an unknown or other-tenant id (like the `:id` path routes).
 * Unknown query keys are still 400 (strict object).
 */
export const OutlookQuery = z.strictObject({ fscTableId: z.string().min(1).max(64).optional() });
export type OutlookQueryInput = z.output<typeof OutlookQuery>;

export const OutlookHorizon = z.strictObject({
  h: z.int().min(1),
  unit: z.enum(['week', 'month']),
  targetDate: dateText,
  method: z.enum(OUTLOOK_METHODS),
  reason: z.enum(OUTLOOK_REASONS),
  point: decimalText,
  low: decimalText,
  high: decimalText,
  backtest: z.strictObject({
    candidate: z.enum(OUTLOOK_METHODS),
    origins: count,
    maeRatio: z.number().nullable(),
    dm: z.number(),
    coverage: z.number().min(0).max(1),
    coverageHits: count,
    coverageCases: count,
  }),
  fsc: z.strictObject({ point: decimalText, low: decimalText, high: decimalText }).nullable(),
});
export type OutlookHorizonDto = z.infer<typeof OutlookHorizon>;

export const OutlookSeries = z.strictObject({
  key: z.enum(PRICE_SERIES_KEYS),
  label: z.string(),
  unit: z.string(),
  frequency: z.enum(['weekly', 'monthly']),
  citation: z.string(),
  status: z.enum(OUTLOOK_STATUSES),
  provenance: z
    .strictObject({
      importId: uuid,
      sourceUrl: z.string(),
      retrievedAt: dateText,
      sha256: z.string().regex(SHA256),
      rowCount: z.int().min(1),
      firstDate: dateText,
      lastDate: dateText,
    })
    .nullable(),
  latest: z.strictObject({ date: dateText, value: decimalText }).nullable(),
  backtestYears: z.strictObject({ from: z.int(), to: z.int() }).nullable(),
  horizons: z.array(OutlookHorizon),
});
export type OutlookSeriesDto = z.infer<typeof OutlookSeries>;

export const OutlookResponse = z.strictObject({
  outlookVersion: z.literal(OUTLOOK_VERSION),
  note: z.literal(OUTLOOK_NOTE),
  series: z.array(OutlookSeries),
  fscTable: z
    .strictObject({
      id: uuid,
      name: z.string(),
      version: z.int().min(1),
      unit: z.enum(['per_mile', 'percent']),
      current: decimalText,
    })
    .nullable(),
});
export type OutlookResponseDto = z.infer<typeof OutlookResponse>;

export const OutlookEvalReport = z.strictObject({
  evaluation: z.literal('walk-forward'),
  outlookVersion: z.literal(OUTLOOK_VERSION),
  note: z.literal(OUTLOOK_EVAL_NOTE),
  data: z.array(
    z.strictObject({
      series: z.enum(PRICE_SERIES_KEYS),
      file: z.string(),
      sha256: z.string().regex(SHA256),
      rows: z.int().min(1),
      firstDate: dateText,
      lastDate: dateText,
    }),
  ),
  results: z.array(
    z.strictObject({
      series: z.enum(PRICE_SERIES_KEYS),
      h: z.int().min(1),
      candidate: z.enum(OUTLOOK_METHODS),
      method: z.enum(OUTLOOK_METHODS),
      reason: z.enum(OUTLOOK_REASONS),
      origins: count,
      firstOrigin: dateText,
      naiveMae: z.number(),
      candidateMae: z.number(),
      maeRatio: z.number().nullable(),
      dm: z.number(),
      coverage: z.number().min(0).max(1),
      coverageHits: count,
      coverageCases: count,
    }),
  ),
});
export type OutlookEvalReportDto = z.infer<typeof OutlookEvalReport>;
