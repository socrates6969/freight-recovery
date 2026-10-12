/**
 * Tariff-style detention calculator (REQ-20261011-charge-intelligence, Part C C12; registered divergence
 * RD10: no Python counterpart). Free time, billing increment, rounding direction, rate per increment and an
 * optional minimum and maximum charge, as carrier rules tariffs state them. Exact decimal arithmetic
 * (no floats); seconds in plain integers. Pure. Not used by any route, extraction field or analysis path
 * in step 6 (the step-5 `computeDetention` is unchanged).
 *
 * Term mapping from public tariffs (values come from the caller):
 * - XPO CNWY 199-AJ.4 Item 211 (with power): free time 15 / 30 / 40 / 60 min by actual weight
 *   (<1,000 / 1,000-4,999 / 5,000-9,999 / >=10,000 lb), 15-minute increments rounded UP ("or fraction
 *   thereof"), 72.25 per increment, minimum charge 95.50, no maximum.
 * - States Logistics LTL accessorials (2023), detention with power: 30 min free, 15-minute increments
 *   (rounding not stated: default down), 26.25 per increment, minimum 105.00, maximum 630.00.
 * - Estes Item 501 (stops >= 20,000 lb): 15-minute increments at 40.00; free time is contractual (not on
 *   the accessorial sheet); rounding, minimum and maximum not stated (default down, none).
 * Detention without power (per-day tiers) is out of scope.
 */
import type { DecimalString } from '../decimal.js';

import { LocalDateTime } from './local-datetime.js';
import { Dec, div, format2f, gt, lt, mul, q2 } from './py-decimal.js';
import { AnalysisInputError } from './types.js';

const FREE_MIN = 0;
const FREE_MAX = 1440;
const INCREMENT_MIN = 1;
const INCREMENT_MAX = 240;
const SECONDS_PER_MINUTE = 60;
const MONEY = /^[0-9]+(\.[0-9]{1,6})?$/u;

export interface TariffDetentionTerms {
  /** Free time in minutes (integer 0..1440). */
  freeMinutes: number;
  /** Billing increment in minutes (integer 1..240). */
  incrementMinutes: number;
  /** `up` when the tariff bills "each increment or fraction thereof", else `down`. */
  rounding: 'down' | 'up';
  ratePerIncrement: DecimalString;
  minimumCharge: DecimalString | null;
  maximumCharge: DecimalString | null;
}

export interface TariffDetentionResult {
  increments: number;
  billableMinutes: number;
  /** Two decimals (`d.dd`). */
  amount: string;
  minimumApplied: boolean;
  maximumApplied: boolean;
  steps: string[];
}

function checkInt(v: unknown, min: number, max: number, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new AnalysisInputError(`${what} out of range`);
  return v;
}

function checkMoney(v: unknown, what: string): Dec {
  if (typeof v !== 'string' || !MONEY.test(v)) throw new AnalysisInputError(`${what} is not a decimal >= 0`);
  return Dec.parse(v);
}

const optMoney = (v: unknown, what: string): Dec | null => (v === null ? null : checkMoney(v, what));

/** `f2(seconds)`: minutes with two decimals (half-even). */
const f2 = (seconds: number): string => format2f(div(Dec.fromInt(seconds), Dec.fromInt(SECONDS_PER_MINUTE)));

/** Detention under tariff terms between the clock start and the departure (`YYYY-MM-DDTHH:MM:SS`). */
export function computeTariffDetention(clockStart: string, departure: string, terms: TariffDetentionTerms): TariffDetentionResult {
  const start = LocalDateTime.parse(clockStart);
  const end = LocalDateTime.parse(departure);
  if (typeof terms !== 'object' || terms === null) throw new AnalysisInputError('terms missing');
  const free = checkInt(terms.freeMinutes, FREE_MIN, FREE_MAX, 'freeMinutes');
  const inc = checkInt(terms.incrementMinutes, INCREMENT_MIN, INCREMENT_MAX, 'incrementMinutes');
  if (terms.rounding !== 'down' && terms.rounding !== 'up') throw new AnalysisInputError('rounding must be down or up');
  const rate = checkMoney(terms.ratePerIncrement, 'ratePerIncrement');
  const minimum = optMoney(terms.minimumCharge, 'minimumCharge');
  const maximum = optMoney(terms.maximumCharge, 'maximumCharge');
  if (minimum !== null && maximum !== null && gt(minimum, maximum)) throw new AnalysisInputError('minimumCharge above maximumCharge');

  const dwell = end.epochSeconds() - start.epochSeconds();
  const over = dwell - SECONDS_PER_MINUTE * free;
  const steps = [`Dwell ${f2(dwell)} min from ${start.fmtYmdHm()} to ${end.fmtYmdHm()}.`];
  const none = (extra: string): TariffDetentionResult => ({
    increments: 0,
    billableMinutes: 0,
    amount: '0.00',
    minimumApplied: false,
    maximumApplied: false,
    steps: [...steps, extra],
  });
  if (over <= 0) return none(`Within ${free} min free time. No detention owed.`);

  steps.push(`Less ${free} min free time = ${f2(over)} min over.`);
  const unit = SECONDS_PER_MINUTE * inc;
  const n = terms.rounding === 'up' ? Math.floor((over + unit - 1) / unit) : Math.floor(over / unit);
  steps.push(`Rounded ${terms.rounding} to ${inc}-minute increments: ${n} x ${inc} min = ${n * inc} min.`);
  if (n === 0) return none('No complete increment. No detention owed.');

  const base = q2(mul(Dec.fromInt(n), rate));
  steps.push(`${n} x $${rate.toString()} = $${format2f(base)}.`);
  let amount = base;
  let minimumApplied = false;
  let maximumApplied = false;
  if (minimum !== null && lt(amount, minimum)) {
    amount = q2(minimum);
    minimumApplied = true;
    steps.push(`Raised to the minimum charge of $${minimum.toString()}.`);
  }
  if (maximum !== null && gt(amount, maximum)) {
    amount = q2(maximum);
    maximumApplied = true;
    steps.push(`Capped at the maximum charge of $${maximum.toString()}.`);
  }
  steps.push(`Detention = $${format2f(amount)}.`);
  return { increments: n, billableMinutes: n * inc, amount: format2f(amount), minimumApplied, maximumApplied, steps };
}
