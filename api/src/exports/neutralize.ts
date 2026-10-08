/**
 * Export cell normalization (N9, pure). Text cells: C0/C1 controls removed except that tab, CR, LF,
 * LINE SEPARATOR and PARAGRAPH SEPARATOR runs become one space; bidi override/isolate/mark controls and
 * zero-width characters removed; capped at 10000 code points; then FORMULA NEUTRALIZATION: when the
 * first character after leading (Unicode White_Space) whitespace is `=`, `+`, `-`, `@` or a full-width
 * form of one of them, the cell is prefixed with `'`. Numeric cells are produced from numbers only and
 * are never neutralized.
 */
import { cpLength, cpSlice } from '@fr/shared';

export const MAX_CELL_CHARS = 10_000;

const WHITESPACE_RUNS = /[\t\r\n\u{2028}\u{2029}]+/gu;
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu;
const INVISIBLE = /[\u{61c}\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2060}-\u{2064}\u{2066}-\u{2069}\u{feff}]/gu;
// eslint-disable-next-line no-control-regex
const LEADING_WHITE_SPACE = /^[\t\n\u000b\u000c\r \u{85}\u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}]*/u;
const TRIGGERS: ReadonlySet<string> = new Set(['=', '+', '-', '@', '\u{ff1d}', '\u{ff0b}', '\u{ff0d}', '\u{ff20}']);

/** Control/bidi/zero-width removal, whitespace-run collapse and the length cap. */
export function cleanText(s: string): string {
  const cleaned = s.replace(WHITESPACE_RUNS, ' ').replace(CONTROLS, '').replace(INVISIBLE, '');
  return cpLength(cleaned) > MAX_CELL_CHARS ? cpSlice(cleaned, MAX_CELL_CHARS) : cleaned;
}

/** Prefix `'` when the first significant character could start a formula. */
export function neutralizeFormula(s: string): string {
  const lead = LEADING_WHITE_SPACE.exec(s)?.[0].length ?? 0;
  const first = String.fromCodePoint(s.codePointAt(lead) ?? 0);
  return lead < s.length && TRIGGERS.has(first) ? `'${s}` : s;
}

/** The full text-cell pipeline. */
export function textCell(value: string | null | undefined): string {
  return value === null || value === undefined ? '' : neutralizeFormula(cleanText(value));
}

/** Integer cents -> `[-]D+.DD` with integer arithmetic only. */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError('cents must be a safe integer');
  const neg = cents < 0;
  const abs = BigInt(Math.abs(cents));
  return `${neg ? '-' : ''}${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, '0')}`;
}
