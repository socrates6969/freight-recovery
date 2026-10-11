/**
 * Step 7 fuel-check contract (REQ-20261011-fuel-outlook, Part C F4, F10): strict request schemas for fuel
 * tables and claim fuel inputs, and the response DTOs. Exported from the package root; imports no
 * engine code. Decimal checks are anchored regexes plus exact `Dec` comparisons (never `Number`).
 */
import { z } from 'zod';

import { Dec, compare } from './analysis/py-decimal.js';
import { singleLine } from './dto.js';
import { FSC_BRACKETS, FSC_DEFAULT_OFFSET_DAYS, FSC_KINDS, FSC_ROWS_MAX, FSC_TABLE_NAME_MAX, FSC_UNITS, FUEL_CHECK_STATUSES, FUEL_CHECK_VERSION, type FscKind, type FscUnit } from './fuel/constants.js';

const uuid = z.uuid();

/** basePrice, stepSize, atLeast: `^[0-9]{1,2}(\.[0-9]{1,4})?$` and > 0. */
const PRICE_PARAM = /^[0-9]{1,2}(\.[0-9]{1,4})?$/u;
/** A per-mile rate. */
const RATE_PER_MILE = /^[0-9](\.[0-9]{1,4})?$/u;
/** A percent rate (also <= 100). */
const RATE_PERCENT = /^[0-9]{1,3}(\.[0-9]{1,3})?$/u;
/** Either rate form (the unit decides which one applies; checked on the table body). */
const RATE_ANY = /^(?:[0-9](\.[0-9]{1,4})?|[0-9]{1,3}(\.[0-9]{1,3})?)$/u;
const MPG = /^[0-9]{1,2}(\.[0-9]{1,2})?$/u;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
const MILES_IN = /^[0-9]{1,5}(\.[0-9])?$/u;
const MILES_OUT = /^[0-9]{1,5}\.[0-9]$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SIGNED_DECIMAL = /^-?[0-9]+(\.[0-9]+)?$/u;

const ZERO = Dec.fromInt(0);
const PERCENT_MAX = Dec.fromInt(100);
const MPG_MIN = Dec.fromInt(1);
const MPG_MAX = Dec.fromInt(20);
const MILES_MIN = Dec.parse('0.1');
const MILES_MAX = Dec.fromInt(10_000);
/** Bounds of a ship date (inclusive). */
export const SHIP_DATE_MIN = '1994-01-01';
export const SHIP_DATE_MAX = '2100-12-31';

/** `Dec` of a string already known to match `re`, else null (refinements run even after a failed regex). */
function decIf(v: string, re: RegExp): Dec | null {
  return re.test(v) ? Dec.parse(v) : null;
}

const between = (v: string, re: RegExp, min: Dec, max: Dec | null): boolean => {
  const d = decIf(v, re);
  return d !== null && compare(d, min) >= 0 && (max === null || compare(d, max) <= 0);
};

const positiveParam = z
  .string()
  .regex(PRICE_PARAM)
  .refine((v) => {
    const d = decIf(v, PRICE_PARAM);
    return d !== null && compare(d, ZERO) > 0;
  }, { message: 'must be greater than 0' });
const rateParam = z.string().regex(RATE_ANY);

/** True for a real calendar date `YYYY-MM-DD`. */
export function isCalendarDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE.test(v)) return false;
  const y = Number(v.slice(0, 4));
  const m = Number(v.slice(5, 7));
  const d = Number(v.slice(8, 10));
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = m === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;
  return d <= dim;
}

const dateText = z.string().refine(isCalendarDate, { message: 'not a calendar date' });
const decimalText = z.string().regex(SIGNED_DECIMAL);

export const FscStepParams = z.strictObject({
  basePrice: positiveParam,
  stepSize: positiveParam,
  ratePerStep: rateParam,
  bracket: z.enum(FSC_BRACKETS),
});
export type FscStepParamsDto = z.infer<typeof FscStepParams>;

export const FscMpgParams = z.strictObject({
  basePrice: positiveParam,
  mpg: z
    .string()
    .regex(MPG)
    .refine((v) => between(v, MPG, MPG_MIN, MPG_MAX), { message: 'mpg must be between 1 and 20' }),
  decimals: z.union([z.literal(2), z.literal(3), z.literal(4)]),
});
export type FscMpgParamsDto = z.infer<typeof FscMpgParams>;

export const FscRowsParams = z.strictObject({
  rows: z
    .array(z.strictObject({ atLeast: positiveParam, rate: rateParam }))
    .min(1)
    .max(FSC_ROWS_MAX)
    .refine(
      (rows) => {
        for (let i = 1; i < rows.length; i += 1) {
          const prev = rows[i - 1];
          const cur = rows[i];
          if (prev === undefined || cur === undefined) return false;
          if (!PRICE_PARAM.test(prev.atLeast) || !PRICE_PARAM.test(cur.atLeast)) return false;
          if (compare(Dec.parse(prev.atLeast), Dec.parse(cur.atLeast)) >= 0) return false;
        }
        return true;
      },
      { message: 'atLeast must be strictly increasing' },
    ),
});
export type FscRowsParamsDto = z.infer<typeof FscRowsParams>;

export const FscParams = z.union([FscStepParams, FscMpgParams, FscRowsParams]);
export type FscParamsDto = z.infer<typeof FscParams>;

function rateOk(unit: FscUnit, rate: string): boolean {
  if (unit === 'per_mile') return RATE_PER_MILE.test(rate);
  return between(rate, RATE_PERCENT, ZERO, PERCENT_MAX);
}

/**
 * The F4 checks that tie `params` to `kind` and `unit`: the params schema of the kind, mpg only per mile,
 * and the rate format of the unit. Returns null when valid, else a short reason.
 */
export function fscParamsIssue(kind: FscKind, unit: FscUnit, params: unknown): string | null {
  if (kind === 'step') {
    const p = FscStepParams.safeParse(params);
    if (!p.success) return 'params do not match kind step';
    return rateOk(unit, p.data.ratePerStep) ? null : 'ratePerStep format does not match the unit';
  }
  if (kind === 'mpg') {
    if (unit !== 'per_mile') return 'an mpg table must be per_mile';
    return FscMpgParams.safeParse(params).success ? null : 'params do not match kind mpg';
  }
  const p = FscRowsParams.safeParse(params);
  if (!p.success) return 'params do not match kind rows';
  return p.data.rows.every((r) => rateOk(unit, r.rate)) ? null : 'rate format does not match the unit';
}

const tableShape = {
  name: singleLine(1, FSC_TABLE_NAME_MAX),
  kind: z.enum(FSC_KINDS),
  unit: z.enum(FSC_UNITS),
  priceSeries: z.literal('diesel_us'),
  effectiveOffsetDays: z.int().min(0).max(6).default(FSC_DEFAULT_OFFSET_DAYS),
  params: FscParams,
};

const refineTable = (v: { kind: FscKind; unit: FscUnit; params: unknown }, ctx: z.RefinementCtx): void => {
  const issue = fscParamsIssue(v.kind, v.unit, v.params);
  if (issue !== null) ctx.addIssue({ code: 'custom', message: issue, path: ['params'] });
};

export const FscTableBody = z.strictObject(tableShape).superRefine(refineTable);
export type FscTableBodyInput = z.output<typeof FscTableBody>;

export const UpdateFscTableBody = z.strictObject({ ...tableShape, expectedVersion: z.int().min(1) }).superRefine(refineTable);
export type UpdateFscTableBodyInput = z.output<typeof UpdateFscTableBody>;

export const FscTable = z.strictObject({
  id: uuid,
  name: z.string(),
  kind: z.enum(FSC_KINDS),
  unit: z.enum(FSC_UNITS),
  priceSeries: z.literal('diesel_us'),
  effectiveOffsetDays: z.int().min(0).max(6),
  params: FscParams,
  version: z.int().min(1),
  archived: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type FscTableDto = z.infer<typeof FscTable>;

export const FscTableList = z.strictObject({ items: z.array(FscTable) });
export type FscTableListDto = z.infer<typeof FscTableList>;

export const FscTablesQuery = z.strictObject({
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
export type FscTablesQueryInput = z.output<typeof FscTablesQuery>;

export const SetFuelInputsBody = z.strictObject({
  shipDate: z.string().refine((v) => isCalendarDate(v) && v >= SHIP_DATE_MIN && v <= SHIP_DATE_MAX, { message: `ship date must be a date ${SHIP_DATE_MIN}..${SHIP_DATE_MAX}` }),
  miles: z
    .string()
    .regex(MILES_IN)
    .refine((v) => between(v, MILES_IN, MILES_MIN, MILES_MAX), { message: 'miles must be 0.1..10000' })
    .nullable(),
  fscTableId: uuid,
});
export type SetFuelInputsInput = z.output<typeof SetFuelInputsBody>;

export const ClaimFuelInputs = z.strictObject({
  claimId: uuid,
  shipDate: dateText,
  miles: z.string().regex(MILES_OUT).nullable(),
  fscTableId: uuid,
  version: z.int().min(1),
  updatedAt: z.iso.datetime(),
});
export type ClaimFuelInputsDto = z.infer<typeof ClaimFuelInputs>;

export const SetFuelInputsResponse = z.strictObject({
  inputs: ClaimFuelInputs,
  outcome: z.enum(['created', 'changed', 'unchanged']),
});
export type SetFuelInputsResponseDto = z.infer<typeof SetFuelInputsResponse>;

const RESULT_STATUSES = FUEL_CHECK_STATUSES.filter((s): s is Exclude<typeof s, 'off'> => s !== 'off') as [
  Exclude<(typeof FUEL_CHECK_STATUSES)[number], 'off'>,
  ...Exclude<(typeof FUEL_CHECK_STATUSES)[number], 'off'>[],
];

export const FuelCheckResult = z.strictObject({
  checkVersion: z.literal(FUEL_CHECK_VERSION),
  status: z.enum(RESULT_STATUSES),
  priceSeries: z.literal('diesel_us').nullable(),
  postedDate: dateText.nullable(),
  price: decimalText.nullable(),
  effectiveFrom: dateText.nullable(),
  effectiveTo: dateText.nullable(),
  rate: decimalText.nullable(),
  expected: decimalText.nullable(),
  billed: decimalText.nullable(),
  difference: decimalText.nullable(),
  direction: z.enum(['overcharge', 'underbilled']).nullable(),
  alternative: z
    .strictObject({
      postedDate: dateText,
      price: decimalText,
      weeks: z.int().min(1),
      later: z.boolean(),
    })
    .nullable(),
  calculation: z.array(z.string()),
  priceImport: z
    .strictObject({
      id: uuid,
      sha256: z.string().regex(SHA256),
      retrievedAt: dateText,
      sourceUrl: z.string(),
    })
    .nullable(),
});
export type FuelCheckResultDto = z.infer<typeof FuelCheckResult>;

export const FuelCheckView = z.strictObject({
  claimId: uuid,
  inputs: ClaimFuelInputs.nullable(),
  table: FscTable.nullable(),
  result: FuelCheckResult,
});
export type FuelCheckViewDto = z.infer<typeof FuelCheckView>;
