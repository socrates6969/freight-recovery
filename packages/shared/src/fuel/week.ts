/**
 * Week rule of the fuel check (Part C F3): which weekly price posting applies to a ship date. Pure
 * integer civil-date arithmetic (days from 1970-01-01, proleptic Gregorian); no `Date` parsing.
 */
import { daysFromCivil } from '../analysis/local-datetime.js';

const DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/u;
const DAYS_PER_WEEK = 7;
/** 1970-01-01 was a Thursday: Monday-based weekday index 3. */
const EPOCH_WEEKDAY = 3;
/** Largest week-rule offset; also the last day of an effective week relative to its first. */
const MAX_OFFSET = 6;

/** Weekday names, Monday first (F3 `DAY`). */
export const DAY = Object.freeze(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const);

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeap(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** Parse a real calendar date `YYYY-MM-DD` (year >= 1) to [y, m, d], or null. */
export function parseCivilDate(s: unknown): [number, number, number] | null {
  const m = typeof s === 'string' ? DATE.exec(s) : null;
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return [y, mo, d];
}

/** Days since 1970-01-01 of a `YYYY-MM-DD` date; throws RangeError on anything else. */
export function toDays(date: string): number {
  const p = parseCivilDate(date);
  if (p === null) throw new RangeError('not a calendar date');
  return daysFromCivil(p[0], p[1], p[2]);
}

/** Inverse of `daysFromCivil` (H. Hinnant's civil_from_days). */
export function civilFromDays(z: number): [number, number, number] {
  const zz = z + 719_468;
  const era = Math.floor(zz / 146_097);
  const doe = zz - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return [y, m, d];
}

const pad = (n: number, w: number): string => String(n).padStart(w, '0');

/** `YYYY-MM-DD` of a day number. */
export function fromDays(z: number): string {
  const [y, m, d] = civilFromDays(z);
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

/** `date + n` calendar days. */
export function addDays(date: string, n: number): string {
  if (!Number.isSafeInteger(n)) throw new RangeError('n must be an integer');
  return fromDays(toDays(date) + n);
}

/** Weekday of a date, Monday = 0 .. Sunday = 6. */
export function weekdayIndex(date: string): number {
  const z = toDays(date);
  return (((z + EPOCH_WEEKDAY) % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
}

function checkOffset(offsetDays: number): void {
  if (!Number.isInteger(offsetDays) || offsetDays < 0 || offsetDays > MAX_OFFSET) throw new RangeError('offsetDays must be an integer 0..6');
}

/** F3 rule text for an offset 0..6: `Monday posting applies <DAY[o]> to <DAY[(o + 6) % 7]>`. */
export function weekRuleText(offsetDays: number): string {
  checkOffset(offsetDays);
  return `Monday posting applies ${DAY[offsetDays] ?? ''} to ${DAY[(offsetDays + MAX_OFFSET) % DAYS_PER_WEEK] ?? ''}`;
}

export interface PostingObservation {
  readonly date: string;
  readonly value: string;
}

export interface ApplicablePosting {
  /** Index of the applicable observation in the input array. */
  index: number;
  date: string;
  value: string;
  effectiveFrom: string;
  effectiveTo: string;
}

/**
 * F3: the last observation `w` with `w.date + offsetDays <= shipDate`, provided
 * `shipDate <= w.date + offsetDays + 6`; otherwise null. Observations must be in ascending date order.
 */
export function applicablePosting(observations: readonly PostingObservation[], shipDate: string, offsetDays: number): ApplicablePosting | null {
  checkOffset(offsetDays);
  const ship = toDays(shipDate);
  let lo = 0;
  let hi = observations.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const obs = observations[mid];
    if (obs === undefined) break;
    if (toDays(obs.date) + offsetDays <= ship) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const w = found < 0 ? undefined : observations[found];
  if (w === undefined) return null;
  const from = toDays(w.date) + offsetDays;
  if (ship > from + MAX_OFFSET) return null;
  return { index: found, date: w.date, value: w.value, effectiveFrom: fromDays(from), effectiveTo: fromDays(from + MAX_OFFSET) };
}
