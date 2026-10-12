/**
 * Naive local datetimes (`YYYY-MM-DDTHH:MM:SS`, Python `datetime.isoformat()` without zone) for the rules
 * engine (spec A3). Elapsed seconds use an integer days-from-civil algorithm (proleptic Gregorian), never
 * `Date`/`Date.UTC`, which remap years 0-99. Registered divergences: RD1 (no offsets), RD2 (`%Y` pads
 * years < 1000 to four digits).
 */
import { AnalysisInputError } from './types.js';

const PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})$/u;
const SECONDS_PER_DAY = 86_400;
const MAX_HOUR = 23;
const MAX_MINUTE = 59;
const MAX_SECOND = 59;

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeap(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** Days since 1970-01-01 of a proleptic-Gregorian date (H. Hinnant's days_from_civil). */
export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

const pad = (n: number, w: number): string => String(n).padStart(w, '0');

export class LocalDateTime {
  private constructor(
    readonly year: number,
    readonly month: number,
    readonly day: number,
    readonly hour: number,
    readonly minute: number,
    readonly second: number,
  ) {}

  static parse(s: string): LocalDateTime {
    const m = typeof s === 'string' ? PATTERN.exec(s) : null;
    if (!m) throw new AnalysisInputError('not a local datetime');
    const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
    if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > MAX_HOUR || mi > MAX_MINUTE || se > MAX_SECOND) {
      throw new AnalysisInputError('not a valid local datetime');
    }
    return new LocalDateTime(y, mo, d, h, mi, se);
  }

  /** Seconds since 1970-01-01T00:00:00 of the naive time read as UTC (exact integer). */
  epochSeconds(): number {
    return daysFromCivil(this.year, this.month, this.day) * SECONDS_PER_DAY + this.hour * 3600 + this.minute * 60 + this.second;
  }

  /** Python `f"{dt:%Y-%m-%d %H:%M}"` (year padded to four digits, RD2). */
  fmtYmdHm(): string {
    return `${pad(this.year, 4)}-${pad(this.month, 2)}-${pad(this.day, 2)} ${pad(this.hour, 2)}:${pad(this.minute, 2)}`;
  }

  /** The naive time as a UTC instant (persisted timeline convention, policy D8). */
  toUtcDate(): Date {
    const d = new Date(0);
    d.setUTCFullYear(this.year, this.month - 1, this.day);
    d.setUTCHours(this.hour, this.minute, this.second, 0);
    return d;
  }
}
