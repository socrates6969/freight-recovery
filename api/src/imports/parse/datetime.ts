/**
 * Port of `freight_recovery.extraction.stub.parse_dt`: the first of four `datetime.strptime` formats
 * that accepts the (Python-stripped) value wins. The directive grammars are CPython 3.12's
 * `_strptime.TimeRE` (note `%d` also accepts a space followed by one digit), a format space matches
 * one or more whitespace characters, the `T` matches case-insensitively, and the whole string must be
 * consumed; the calendar date must exist and seconds 60/61 are rejected (datetime constructor).
 * Registered divergence D7: digits are ASCII only (Python's `\d` also accepts other Unicode digits).
 * Output: `YYYY-MM-DDTHH:MM:SS` (Python naive `isoformat()`).
 */
import { pyStrip } from './text.js';

const WS = '[\\t\\n\\u000b\\u000c\\r\\u001c-\\u001f \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+';
const Y = '([0-9]{4})';
const MO = '(1[0-2]|0[1-9]|[1-9])';
const D = '(3[01]|[12][0-9]|0[1-9]|[1-9]| [1-9])';
const H = '(2[0-3]|[01][0-9]|[0-9])';
const MI = '([0-5][0-9]|[0-9])';
const S = '(6[01]|[0-5][0-9]|[0-9])';

type Order = 'ymd' | 'mdy';

interface Format {
  re: RegExp;
  order: Order;
  hasSeconds: boolean;
  /** The US `MM/DD/YYYY HH:MM` format (caps confidence at 0.80). */
  us: boolean;
}

const FORMATS: readonly Format[] = [
  { re: new RegExp(`^${Y}-${MO}-${D}${WS}${H}:${MI}$`, 'u'), order: 'ymd', hasSeconds: false, us: false },
  { re: new RegExp(`^${Y}-${MO}-${D}[Tt]${H}:${MI}$`, 'u'), order: 'ymd', hasSeconds: false, us: false },
  { re: new RegExp(`^${Y}-${MO}-${D}${WS}${H}:${MI}:${S}$`, 'u'), order: 'ymd', hasSeconds: true, us: false },
  { re: new RegExp(`^${MO}/${D}/${Y}${WS}${H}:${MI}$`, 'u'), order: 'mdy', hasSeconds: false, us: true },
];

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export interface ParsedDateTime {
  value: string;
  usFormat: boolean;
}

/** Parse like Python `parse_dt`; null when no format accepts the value. */
export function parseDateTime(raw: string): ParsedDateTime | null {
  const s = pyStrip(raw);
  for (const f of FORMATS) {
    const m = f.re.exec(s);
    if (!m) continue;
    const parts = m.slice(1).map((x) => Number.parseInt((x ?? '').trim(), 10));
    const [a = 0, b = 0, c = 0, hh = 0, mi = 0, ss = 0] = parts;
    const [year, month, day] = f.order === 'ymd' ? [a, b, c] : [c, a, b];
    const second = f.hasSeconds ? ss : 0;
    // The datetime constructor rejects these (strptime raises ValueError; the next format is tried).
    if (year < 1 || day > daysInMonth(year, month) || second > 59) continue;
    return { value: `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hh)}:${pad(mi)}:${pad(second)}`, usFormat: f.us };
  }
  return null;
}
