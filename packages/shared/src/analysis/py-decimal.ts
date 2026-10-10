/**
 * CPython `decimal.Decimal` semantics for the step-5 rules engine (spec A2): default context precision 28,
 * ROUND_HALF_EVEN, finite values only. Every operation reproduces the coefficient AND exponent CPython
 * produces, so `toString` and `format2f` print exactly what Python prints (`str(d)`, `format(d, '.2f')`).
 * BigInt only; no floating point. Internal helper of `@fr/shared/analysis` (not public contract).
 */
import { AnalysisInputError } from './types.js';

/** Python default context precision. */
export const PREC = 28;
const TEN = 10n;
const DECIMAL_INPUT = /^-?[0-9]+(\.[0-9]+)?$/u;

function pow10(n: number): bigint {
  return TEN ** BigInt(n);
}

function digitCount(coef: bigint): number {
  return coef === 0n ? 1 : coef.toString().length;
}

/** Immutable decimal `(-1)^sign * coef * 10^exp`. */
export class Dec {
  private constructor(
    readonly sign: 0 | 1,
    readonly coef: bigint,
    readonly exp: number,
  ) {}

  /** Build from a triple (no rounding). */
  static of(sign: 0 | 1, coef: bigint, exp: number): Dec {
    if (coef < 0n) throw new AnalysisInputError('negative coefficient');
    return new Dec(sign, coef, exp);
  }

  /** `Decimal(s)` for a plain decimal string (`-?digits(.digits)?`); anything else is refused. */
  static parse(s: string): Dec {
    if (typeof s !== 'string' || !DECIMAL_INPUT.test(s)) throw new AnalysisInputError('not a decimal string');
    const neg = s.startsWith('-');
    const body = neg ? s.slice(1) : s;
    const dot = body.indexOf('.');
    const digits = dot === -1 ? body : body.slice(0, dot) + body.slice(dot + 1);
    const exp = dot === -1 ? 0 : -(body.length - dot - 1);
    return new Dec(neg ? 1 : 0, BigInt(digits), exp);
  }

  /** `Decimal(n)` for a safe integer. */
  static fromInt(n: number): Dec {
    if (!Number.isSafeInteger(n)) throw new AnalysisInputError('not a safe integer');
    return new Dec(n < 0 ? 1 : 0, BigInt(Math.abs(n)), 0);
  }

  isZero(): boolean {
    return this.coef === 0n;
  }

  /** `adjusted()`: exponent of the most significant digit. */
  adjusted(): number {
    return this.exp + digitCount(this.coef) - 1;
  }

  /** CPython `__str__` (to-scientific-string, `eng=False`). */
  toString(): string {
    const int = this.coef.toString();
    const left = this.exp + int.length;
    const dot = this.exp <= 0 && left > -6 ? left : 1;
    let out: string;
    if (dot <= 0) out = `0.${'0'.repeat(-dot)}${int}`;
    else if (dot >= int.length) out = int + '0'.repeat(dot - int.length);
    else out = `${int.slice(0, dot)}.${int.slice(dot)}`;
    if (left !== dot) {
      const e = left - dot;
      out += `E${e < 0 ? '-' : '+'}${Math.abs(e)}`;
    }
    return (this.sign === 1 ? '-' : '') + out;
  }
}

/** `_fix`: round a coefficient longer than PREC digits (ROUND_HALF_EVEN). */
export function fix(x: Dec): Dec {
  const n = digitCount(x.coef);
  if (n <= PREC) return x;
  const shift = n - PREC;
  const div = pow10(shift);
  let q = x.coef / div;
  const r = x.coef % div;
  const half = 5n * pow10(shift - 1);
  if (r > half || (r === half && q % 2n === 1n)) q += 1n;
  let exp = x.exp + shift;
  if (q === pow10(PREC)) {
    q /= TEN;
    exp += 1;
  }
  return Dec.of(x.sign, q, exp);
}

function signedCoef(x: Dec, toExp: number): bigint {
  const c = x.coef * pow10(x.exp - toExp);
  return x.sign === 1 ? -c : c;
}

/** `_rescale` towards a SMALLER (or equal) exponent: appends zeros. */
function widen(x: Dec, exp: number): Dec {
  return Dec.of(x.sign, x.coef * pow10(x.exp - exp), exp);
}

/** `a + b` (CPython `__add__`, ROUND_HALF_EVEN, so an exact zero sum is positive). */
export function add(a: Dec, b: Dec): Dec {
  const exp = Math.min(a.exp, b.exp);
  if (a.isZero() && b.isZero()) return Dec.of((a.sign & b.sign) as 0 | 1, 0n, exp);
  if (a.isZero()) return fix(widen(b, Math.max(exp, b.exp - PREC - 1)));
  if (b.isZero()) return fix(widen(a, Math.max(exp, a.exp - PREC - 1)));
  const s = signedCoef(a, exp) + signedCoef(b, exp);
  if (s === 0n) return Dec.of(0, 0n, exp);
  return fix(Dec.of(s < 0n ? 1 : 0, s < 0n ? -s : s, exp));
}

/** Flip the sign (zero included): CPython `copy_negate`. */
export function copyNegate(x: Dec): Dec {
  return Dec.of(x.sign === 1 ? 0 : 1, x.coef, x.exp);
}

/** `a - b`. */
export function sub(a: Dec, b: Dec): Dec {
  return add(a, copyNegate(b));
}

/** `a * b`. */
export function mul(a: Dec, b: Dec): Dec {
  return fix(Dec.of((a.sign ^ b.sign) as 0 | 1, a.coef * b.coef, a.exp + b.exp));
}

/** `a / b` (CPython `__truediv__`). Division by zero is refused. */
export function div(a: Dec, b: Dec): Dec {
  if (b.isZero()) throw new AnalysisInputError('division by zero');
  const sign = (a.sign ^ b.sign) as 0 | 1;
  if (a.isZero()) return fix(Dec.of(sign, 0n, a.exp - b.exp));
  const shift = digitCount(b.coef) - digitCount(a.coef) + PREC + 1;
  let exp = a.exp - b.exp - shift;
  let q: bigint;
  let r: bigint;
  if (shift >= 0) {
    const n = a.coef * pow10(shift);
    q = n / b.coef;
    r = n % b.coef;
  } else {
    const d = b.coef * pow10(-shift);
    q = a.coef / d;
    r = a.coef % d;
  }
  if (r !== 0n) {
    if (q % 5n === 0n) q += 1n;
  } else {
    const ideal = a.exp - b.exp;
    while (exp < ideal && q % TEN === 0n) {
      q /= TEN;
      exp += 1;
    }
  }
  return fix(Dec.of(sign, q, exp));
}

/** `a // b` (CPython `_divide` integer part: truncation toward zero, exponent 0). */
export function divInt(a: Dec, b: Dec): Dec {
  if (b.isZero()) throw new AnalysisInputError('division by zero');
  const sign = (a.sign ^ b.sign) as 0 | 1;
  if (a.isZero() || a.adjusted() - b.adjusted() <= -2) return Dec.of(sign, 0n, 0);
  const e = Math.min(a.exp, b.exp);
  const q = (a.coef * pow10(a.exp - e)) / (b.coef * pow10(b.exp - e));
  if (q >= pow10(PREC)) throw new AnalysisInputError('quotient too large');
  return Dec.of(sign, q, 0);
}

/** Numeric comparison (-0 == 0): -1, 0 or 1. */
export function compare(a: Dec, b: Dec): -1 | 0 | 1 {
  const e = Math.min(a.exp, b.exp);
  const x = signedCoef(a, e);
  const y = signedCoef(b, e);
  return x < y ? -1 : x > y ? 1 : 0;
}

export const lt = (a: Dec, b: Dec): boolean => compare(a, b) < 0;
export const le = (a: Dec, b: Dec): boolean => compare(a, b) <= 0;
export const gt = (a: Dec, b: Dec): boolean => compare(a, b) > 0;
export const ge = (a: Dec, b: Dec): boolean => compare(a, b) >= 0;
export const eq = (a: Dec, b: Dec): boolean => compare(a, b) === 0;

/** `x.quantize(Decimal('1E<exp>'))` with ROUND_HALF_EVEN (`_rescale`); the sign is always kept. */
export function quantize(x: Dec, exp: number): Dec {
  if (x.isZero()) return Dec.of(x.sign, 0n, exp);
  let out: Dec;
  if (x.exp >= exp) {
    out = widen(x, exp);
  } else {
    const drop = exp - x.exp;
    const d = pow10(drop);
    let q = x.coef / d;
    const r = x.coef % d;
    const half = 5n * pow10(drop - 1);
    if (r > half || (r === half && q % 2n === 1n)) q += 1n;
    out = Dec.of(x.sign, q, exp);
  }
  if (digitCount(out.coef) > PREC) throw new AnalysisInputError('quantize result too long');
  return out;
}

/** Exponent of `Decimal('0.01')`. */
export const CENT_EXP = -2;

/** `x.quantize(Decimal('0.01'))`. */
export function q2(x: Dec): Dec {
  return quantize(x, CENT_EXP);
}

/** `format(x, '.2f')`. */
export function format2f(x: Dec): string {
  const y = quantize(x, CENT_EXP);
  const s = y.coef.toString().padStart(3, '0');
  return `${y.sign === 1 ? '-' : ''}${s.slice(0, -2)}.${s.slice(-2)}`;
}

/** Python `max(a, b)`: `a` unless `b > a`. */
export function pyMax(a: Dec, b: Dec): Dec {
  return gt(b, a) ? b : a;
}

/** `Decimal(0) + x1 + x2 + ...` (Python `sum(xs, Decimal(0))`). */
export function sumDec(xs: readonly Dec[]): Dec {
  let acc = Dec.fromInt(0);
  for (const x of xs) acc = add(acc, x);
  return acc;
}

/** Python integer floor division on safe integers (`a // b`, b > 0). */
export function floorDivInt(a: number, b: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || b <= 0) throw new AnalysisInputError('floorDivInt: invalid operands');
  const x = BigInt(a);
  const y = BigInt(b);
  const q = x / y;
  return Number(x % y !== 0n && x < 0n ? q - 1n : q);
}
