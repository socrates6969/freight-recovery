/**
 * Exact decimal strings (A4). A `DecimalString` is the string Python prints for `str(Decimal(x))` of a
 * plain number: optional leading `-`, an integer part without leading zeros (at least one digit), and an
 * optional fraction exactly as typed (no exponent). No floating point is used anywhere in this module.
 *
 * `parseMoney` is a faithful port of `freight_recovery.extraction.stub.parse_money` (registered
 * divergence D7: only ASCII letters match the `USD` affix, where Python's IGNORECASE also folds e.g.
 * U+017F LONG S to `s`).
 */
import { pyStrip } from './text-sanitize.js';

export type DecimalString = string;

/** Python `_MONEY_OK`: `-?[0-9]{1,15}(?:[.][0-9]{1,6})?`, full match, ASCII digits only. */
const MONEY_OK = /^-?[0-9]{1,15}(?:\.[0-9]{1,6})?$/u;
const DECIMAL_STRING = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/u;
/** Scale of `toMicros`/`fromMicros` (10^6). */
export const MICROS_SCALE = 6;
const MICROS = 1_000_000n;

/** True when `value` is a canonical DecimalString. */
export function isDecimalString(value: unknown): value is DecimalString {
  return typeof value === 'string' && DECIMAL_STRING.test(value);
}

/** Canonical form of a string that already matched MONEY_OK (what Python's `str(Decimal(s))` prints). */
function canonical(cleaned: string): DecimalString {
  const neg = cleaned.startsWith('-');
  const body = neg ? cleaned.slice(1) : cleaned;
  const dot = body.indexOf('.');
  const intRaw = dot === -1 ? body : body.slice(0, dot);
  const frac = dot === -1 ? '' : body.slice(dot);
  const intPart = intRaw.replace(/^0+/u, '') || '0';
  return `${neg ? '-' : ''}${intPart}${frac}`;
}

function isZero(d: DecimalString): boolean {
  return /^-?0(\.0+)?$/u.test(d);
}

/**
 * Python `-Decimal(x)`: a zero becomes a positive zero (copy_abs; Python's default rounding is not
 * ROUND_FLOOR), any other value flips its sign.
 */
function negate(d: DecimalString): DecimalString {
  if (isZero(d)) return d.startsWith('-') ? d.slice(1) : d;
  return d.startsWith('-') ? d.slice(1) : `-${d}`;
}

/** Python `re.sub(r"(?i)^usd|usd$", "", s)` restricted to ASCII case folding (D7). */
function stripUsd(s: string): string {
  let out = s;
  // The two alternatives are applied in one left-to-right scan by Python; a leading match consumes
  // the first three characters and the trailing alternative can then still match at the end.
  if (/^[uU][sS][dD]/u.test(out)) out = out.slice(3);
  if (/[uU][sS][dD]$/u.test(out)) out = out.slice(0, -3);
  return out;
}

/**
 * Parse `$1,234.50` / `(300.00)` / `300 USD` into a canonical DecimalString, or null when the value is
 * not a plain decimal number (NaN, Infinity, exponents, huge magnitudes, odd separators).
 */
export function parseMoney(value: string): DecimalString | null {
  let cleaned = pyStrip(value);
  const negative = cleaned.startsWith('(') && cleaned.endsWith(')');
  if (negative) cleaned = cleaned.slice(1, -1);
  cleaned = pyStrip(stripUsd(pyStrip(cleaned.replaceAll('$', '').replaceAll(',', ''))));
  if (!MONEY_OK.test(cleaned)) return null;
  const d = canonical(cleaned);
  return negative ? negate(d) : d;
}

function split(d: DecimalString): { neg: boolean; int: string; frac: string } {
  if (!isDecimalString(d)) throw new RangeError('not a DecimalString');
  const neg = d.startsWith('-');
  const body = neg ? d.slice(1) : d;
  const [int = '0', frac = ''] = body.split('.');
  return { neg, int, frac };
}

/** Exact integer value scaled by 10^6 (more than six fraction digits is a RangeError, never rounded). */
export function toMicros(d: DecimalString): bigint {
  const { neg, int, frac } = split(d);
  if (frac.length > MICROS_SCALE) throw new RangeError('more than 6 fraction digits');
  const v = BigInt(int) * MICROS + BigInt(frac.padEnd(MICROS_SCALE, '0') || '0');
  return neg ? -v : v;
}

/** Inverse of toMicros with the shortest exact fraction (trailing zeros removed; `0` for zero). */
export function fromMicros(m: bigint): DecimalString {
  const neg = m < 0n;
  const abs = neg ? -m : m;
  const int = (abs / MICROS).toString();
  const frac = (abs % MICROS).toString().padStart(MICROS_SCALE, '0').replace(/0+$/u, '');
  if (abs === 0n) return '0';
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

/** Numeric comparison of two DecimalStrings (any number of fraction digits): -1, 0 or 1. */
export function compareDecimal(a: DecimalString, b: DecimalString): -1 | 0 | 1 {
  const x = split(a);
  const y = split(b);
  const scale = Math.max(x.frac.length, y.frac.length);
  const toInt = (p: { neg: boolean; int: string; frac: string }) => {
    const v = BigInt(p.int + p.frac.padEnd(scale, '0'));
    return p.neg ? -v : v;
  };
  const xa = toInt(x);
  const yb = toInt(y);
  return xa < yb ? -1 : xa > yb ? 1 : 0;
}
