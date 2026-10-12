/**
 * Python text primitives used by the rules engine (spec A3): full CPython `repr(str)` (printability per
 * Unicode general category, registered divergence RD4 for table differences) and the classifier's
 * `_norm_text`. Internal helpers of `@fr/shared/analysis`.
 */

/** Unicode categories C* and Z*: not printable for Python `str.isprintable()` (U+0020 excepted). */
const NOT_PRINTABLE = /^[\p{C}\p{Z}]$/u;

function hexEscape(cp: number): string {
  const h = cp.toString(16);
  if (cp <= 0xff) return `\\x${h.padStart(2, '0')}`;
  if (cp <= 0xffff) return `\\u${h.padStart(4, '0')}`;
  return `\\U${h.padStart(8, '0')}`;
}

/** CPython `repr(s)` of a str. */
export function pyReprStr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += `\\${quote}`;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch !== ' ' && NOT_PRINTABLE.test(ch)) out += hexEscape(cp);
    else out += ch;
  }
  return `${quote}${out}${quote}`;
}

/** CPython `repr(list_of_str)`. */
export function pyReprList(xs: readonly string[]): string {
  return `[${xs.map(pyReprStr).join(', ')}]`;
}

/** Python `_norm_text`: lower-case, runs of anything but `[a-z0-9]` -> one space, stripped. */
export function normText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .replace(/^ +| +$/gu, '');
}
