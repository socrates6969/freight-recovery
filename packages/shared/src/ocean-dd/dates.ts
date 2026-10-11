/**
 * Civil dates of the D&D audit (C2): `YYYY-MM-DD` strings from 2000-01-01 to 2099-12-31, handled with integer
 * day numbers (days since 1970-01-01, proleptic Gregorian; H. Hinnant's days-from-civil / civil-from-days).
 * No `Date` parsing, no time zones: the same result on every runtime.
 */
import { DD_DATE_MAX, DD_DATE_MIN } from './constants.js';

const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
const DAYS_PER_ERA = 146097;
const DAYS_EPOCH_SHIFT = 719468;

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeap(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function daysFromCivil(y0: number, m: number, d: number): number {
  const y = m <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * DAYS_PER_ERA + doe - DAYS_EPOCH_SHIFT;
}

function civilFromDays(n: number): [number, number, number] {
  const z = n + DAYS_EPOCH_SHIFT;
  const era = Math.floor(z / DAYS_PER_ERA);
  const doe = z - era * DAYS_PER_ERA;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

/** Day number of a syntactically valid civil date, or null. */
function parse(v: unknown): number | null {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return null;
  const y = Number(v.slice(0, 4));
  const m = Number(v.slice(5, 7));
  const d = Number(v.slice(8, 10));
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return daysFromCivil(y, m, d);
}

/** Day number of 2000-01-01 (10957) and of 2099-12-31. */
export const DD_DAY_MIN = daysFromCivil(2000, 1, 1);
export const DD_DAY_MAX = daysFromCivil(2099, 12, 31);

/** True iff `v` is a `DdDate`: `YYYY-MM-DD`, a real date, 2000-01-01..2099-12-31. */
export function isDdDate(v: unknown): v is string {
  const n = parse(v);
  return n !== null && n >= DD_DAY_MIN && n <= DD_DAY_MAX;
}

/** Days since 1970-01-01. RangeError for anything but a `DdDate`. */
export function ddDayNumber(date: string): number {
  const n = parse(date);
  if (n === null || n < DD_DAY_MIN || n > DD_DAY_MAX) throw new RangeError(`not a date in ${DD_DATE_MIN}..${DD_DATE_MAX}`);
  return n;
}

/** Inverse of `ddDayNumber`. RangeError outside the `DdDate` range. */
export function ddDateFromDayNumber(n: number): string {
  if (!Number.isSafeInteger(n) || n < DD_DAY_MIN || n > DD_DAY_MAX) throw new RangeError(`day number outside ${DD_DATE_MIN}..${DD_DATE_MAX}`);
  const [y, m, d] = civilFromDays(n);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** ISO weekday of a day number: 1 = Monday .. 7 = Sunday (1970-01-01 was a Thursday). */
export function weekdayOfDayNumber(n: number): number {
  return ((((n + 3) % 7) + 7) % 7) + 1;
}

/** ISO weekday: 1 = Monday .. 7 = Sunday. */
export function ddIsoWeekday(date: string): number {
  return weekdayOfDayNumber(ddDayNumber(date));
}

/** `date` plus `n` days (n may be negative). RangeError when the result leaves the range. */
export function ddAddDays(date: string, n: number): string {
  if (!Number.isSafeInteger(n)) throw new RangeError('days must be an integer');
  return ddDateFromDayNumber(ddDayNumber(date) + n);
}

/** `b - a` in days. */
export function ddDaysBetween(a: string, b: string): number {
  return ddDayNumber(b) - ddDayNumber(a);
}
