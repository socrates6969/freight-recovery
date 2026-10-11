/**
 * Exact fuel-table evaluation (Part C F4, spec A2). Prices, base prices, step sizes and row thresholds are
 * compared as integers scaled by 10^4; rates are multiplied with the step-5 `Dec` (Python Decimal port);
 * the mpg rate is an exact half-up integer division. No floating point.
 */
import { Dec, div, mul, q2 } from '../analysis/py-decimal.js';
import { AnalysisInputError } from '../analysis/types.js';
import { fscParamsIssue, type FscMpgParamsDto, type FscParamsDto, type FscRowsParamsDto, type FscStepParamsDto } from '../fuel-dto.js';

import { FSC_KINDS, FSC_UNITS, type FscKind, type FscUnit } from './constants.js';

/** The price text a table is evaluated at (a 3-decimal observation). */
const PRICE = /^[0-9]{1,4}\.[0-9]{3}$/u;
/** Fixed-point scale of prices and thresholds (4 decimals). */
const SCALE_DECIMALS = 4;
/** Fixed-point scale of an mpg value (2 decimals). */
const MPG_DECIMALS = 2;
const PERCENT_DIVISOR = Dec.fromInt(100);

/** A stored fuel table as the engines see it. */
export interface FscTableSpec {
  id: string;
  name: string;
  version: number;
  kind: FscKind;
  unit: FscUnit;
  priceSeries: 'diesel_us';
  effectiveOffsetDays: number;
  params: FscParamsDto;
  archived: boolean;
}

/** F4 result: `rate` is the rate text (`str(R * k)`, the mpg text, or the row rate). */
export interface FscEvaluation {
  rate: string;
  steps: number | null;
  row: number | null;
  reachesFirstStep: boolean;
}

/** Integer `text * 10^decimals` of a non-negative plain decimal with at most `decimals` fraction digits. */
export function scaled(text: string, decimals: number): bigint {
  const m = /^([0-9]+)(?:\.([0-9]+))?$/u.exec(text);
  const frac = m?.[2] ?? '';
  if (!m || frac.length > decimals) throw new AnalysisInputError('not a decimal of the expected scale');
  return BigInt((m[1] ?? '') + frac.padEnd(decimals, '0'));
}

/** Validate a table spec (kind, unit and params per F4); throws AnalysisInputError. */
export function checkFscTableSpec(table: FscTableSpec): void {
  if (!(FSC_KINDS as readonly string[]).includes(table.kind) || !(FSC_UNITS as readonly string[]).includes(table.unit)) throw new AnalysisInputError('invalid fuel table kind or unit');
  if (table.priceSeries !== 'diesel_us') throw new AnalysisInputError('invalid fuel table price series');
  if (!Number.isInteger(table.effectiveOffsetDays) || table.effectiveOffsetDays < 0 || table.effectiveOffsetDays > 6) throw new AnalysisInputError('invalid fuel table offset');
  if (fscParamsIssue(table.kind, table.unit, table.params) !== null) throw new AnalysisInputError('invalid fuel table params');
}

function evalStep(p: FscStepParamsDto, price: bigint): FscEvaluation {
  const b = scaled(p.basePrice, SCALE_DECIMALS);
  const s = scaled(p.stepSize, SCALE_DECIMALS);
  let k = 0n;
  if (p.bracket === 'above_base') {
    if (price > b) k = (price - b + s - 1n) / s;
  } else if (price >= b) {
    k = (price - b) / s + 1n;
  }
  if (k === 0n) return { rate: '0', steps: 0, row: null, reachesFirstStep: false };
  const steps = Number(k);
  return { rate: mul(Dec.parse(p.ratePerStep), Dec.fromInt(steps)).toString(), steps, row: null, reachesFirstStep: true };
}

function evalMpg(p: FscMpgParamsDto, price: bigint): FscEvaluation {
  const b = scaled(p.basePrice, SCALE_DECIMALS);
  if (price <= b) return { rate: '0', steps: null, row: null, reachesFirstStep: false };
  const mm = scaled(p.mpg, MPG_DECIMALS);
  const d = p.decimals;
  const num = (price - b) * 100n * 10n ** BigInt(d);
  const den = mm * 10_000n;
  const q = (2n * num + den) / (2n * den);
  const digits = q.toString().padStart(d + 1, '0');
  return { rate: `${digits.slice(0, -d)}.${digits.slice(-d)}`, steps: null, row: null, reachesFirstStep: true };
}

function evalRows(p: FscRowsParamsDto, price: bigint): FscEvaluation {
  let row = -1;
  p.rows.forEach((r, i) => {
    if (scaled(r.atLeast, SCALE_DECIMALS) <= price) row = i;
  });
  const hit = row < 0 ? undefined : p.rows[row];
  if (hit === undefined) return { rate: '0', steps: null, row: null, reachesFirstStep: false };
  return { rate: Dec.parse(hit.rate).toString(), steps: null, row, reachesFirstStep: true };
}

/** F4 `evaluateFscTable(table, price)`; `price` is a 3-decimal text. Invalid input throws AnalysisInputError. */
export function evaluateFscTable(table: FscTableSpec, price: string): FscEvaluation {
  checkFscTableSpec(table);
  if (typeof price !== 'string' || !PRICE.test(price)) throw new AnalysisInputError('price must have exactly 3 decimals');
  const p = scaled(price, SCALE_DECIMALS);
  if (table.kind === 'step') return evalStep(table.params as FscStepParamsDto, p);
  if (table.kind === 'mpg') return evalMpg(table.params as FscMpgParamsDto, p);
  return evalRows(table.params as FscRowsParamsDto, p);
}

/**
 * Expected surcharge (F4): per mile `Q(miles * rate)`, percent `Q(rate * L / 100)`. Returns null when the
 * needed input (miles or L) is missing.
 */
export function expectedAmount(unit: FscUnit, rate: Dec, miles: Dec | null, linehaul: Dec | null): Dec | null {
  if (unit === 'per_mile') return miles === null ? null : q2(mul(miles, rate));
  return linehaul === null ? null : q2(div(mul(rate, linehaul), PERCENT_DIVISOR));
}
