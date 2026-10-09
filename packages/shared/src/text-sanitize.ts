/**
 * Python-compatible text primitives and the untrusted-text sanitizers ported from
 * `src/freight_recovery/evidence/sanitize.py` (`plain`, `md`). Lengths count Unicode code points (as
 * Python `len` does), never UTF-16 code units. Zod-free and dependency-free so the parse worker can load
 * it under the Node permission model.
 */

/** Characters for which Python `str.isspace()` is true (NOT U+FEFF, NOT U+200B). */
const PY_SPACE = '\t\n\u000b\u000c\r\u001c\u001d\u001e\u001f \u0085\u{a0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}';
const PY_SPACE_SET: ReadonlySet<string> = new Set(PY_SPACE);

export function isPySpace(ch: string): boolean {
  return PY_SPACE_SET.has(ch);
}

/** Python `str.strip()` with no arguments. */
export function pyStrip(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && PY_SPACE_SET.has(s.charAt(start))) start += 1;
  while (end > start && PY_SPACE_SET.has(s.charAt(end - 1))) end -= 1;
  return s.slice(start, end);
}

/** Python `str.lstrip()`: the number of leading whitespace UTF-16 units. */
export function pyLeadingSpaceLength(s: string): number {
  let i = 0;
  while (i < s.length && PY_SPACE_SET.has(s.charAt(i))) i += 1;
  return i;
}

/** Line boundaries of Python `str.splitlines()` (besides `\r\n`, which counts once). */
const LINE_BREAKS: ReadonlySet<string> = new Set(['\n', '\r', '\u000b', '\u000c', '\u001c', '\u001d', '\u001e', '\u0085', '\u{2028}', '\u{2029}']);

export interface PyLine {
  text: string;
  /** UTF-16 offset of the line's first character in the source string. */
  start: number;
}

/** Python `str.splitlines()` with each line's start offset. No trailing empty element. */
export function pySplitlinesWithOffsets(s: string): PyLine[] {
  const out: PyLine[] = [];
  let start = 0;
  let i = 0;
  while (i < s.length) {
    const ch = s.charAt(i);
    if (LINE_BREAKS.has(ch)) {
      out.push({ text: s.slice(start, i), start });
      i += ch === '\r' && s.charAt(i + 1) === '\n' ? 2 : 1;
      start = i;
    } else {
      i += 1;
    }
  }
  if (start < s.length) out.push({ text: s.slice(start), start });
  return out;
}

/** Python `str.splitlines()`. */
export function pySplitlines(s: string): string[] {
  return pySplitlinesWithOffsets(s).map((l) => l.text);
}

/** Number of Unicode code points (Python `len`). */
export function cpLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i += 1;
    }
    n += 1;
  }
  return n;
}

/** Python `s[:n]` (first n code points). */
export function cpSlice(s: string, n: number): string {
  if (n <= 0) return '';
  let count = 0;
  let i = 0;
  while (i < s.length && count < n) {
    const c = s.charCodeAt(i);
    i += c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff ? 2 : 1;
    count += 1;
  }
  return s.slice(0, i);
}

/** Python `_CTRL` of sanitize.py: C0, DEL, C1, LS, PS, bidi embeddings/overrides and isolates. */
// eslint-disable-next-line no-control-regex
const CTRL_RUNS = /[\u0000-\u001f\u007f-\u009f\u{2028}\u{2029}\u{202a}-\u{202e}\u{2066}-\u{2069}]+/gu;
const MD_META = /([\\`*_[\]<>|~&#])/gu;

/** Default field cap of sanitize.py (`MAX_FIELD`). */
export const MAX_FIELD = 200;

/** One-line plain text: control chars -> space, no backticks/angle brackets, truncated (`plain`). */
export function plain(text: unknown, limit: number = MAX_FIELD): string {
  let s = String(text).replace(CTRL_RUNS, ' ');
  s = s.replace(/[`<>]/gu, '');
  s = pyStrip(s.replace(/ {2,}/gu, ' '));
  return cpLength(s) <= limit ? s : `${cpSlice(s, limit - 3)}...`;
}

/** Markdown-safe inline text: `plain` with Markdown/HTML metacharacters backslash-escaped (`md`). */
export function md(text: unknown, limit: number = MAX_FIELD): string {
  return plain(text, limit).replace(MD_META, '\\$1');
}

/**
 * Characters never kept in a document-derived single-line value (N1): C0/C1 controls, DEL, line and
 * paragraph separators, bidi embeddings/overrides/isolates and the implicit marks ALM/LRM/RLM.
 */
// eslint-disable-next-line no-control-regex
export const UNSAFE_VALUE_CHARS = /[\u0000-\u001f\u007f-\u009f\u{61c}\u{200e}\u{200f}\u{2028}\u{2029}\u{202a}-\u{202e}\u{2066}-\u{2069}]/gu;

/** Remove every unsafe character (see UNSAFE_VALUE_CHARS). */
export function removeUnsafeChars(s: string): string {
  return s.replace(UNSAFE_VALUE_CHARS, '');
}

/**
 * Single-line value for storage/display: unsafe characters removed, Python-stripped, capped to `max`
 * code points. `changed` reports whether anything was removed or cut.
 */
export function sanitizeSingleLine(s: string, max: number): { value: string; changed: boolean } {
  const removed = pyStrip(removeUnsafeChars(s));
  const capped = cpLength(removed) > max ? cpSlice(removed, max) : removed;
  return { value: capped, changed: capped !== pyStrip(s) };
}
