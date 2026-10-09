/**
 * Text primitives with Python semantics (A5.1). The string helpers themselves live in
 * @fr/shared/text-sanitize (also used by the sanitizers); this module adds decoding and key
 * normalization.
 */
import { pyStrip } from '@fr/shared/text-sanitize';

export { cpLength, cpSlice, isPySpace, pyLeadingSpaceLength, pySplitlines, pySplitlinesWithOffsets, pyStrip } from '@fr/shared/text-sanitize';

/**
 * UTF-8 decode like Python `bytes.decode("utf-8-sig", errors="replace")`: one leading BOM stripped,
 * invalid sequences replaced with U+FFFD. `replacements` is true only when the bytes were not valid
 * UTF-8 (a file that literally contains an encoded U+FFFD does not count).
 */
export function decodeUtf8(bytes: Uint8Array): { text: string; replacements: boolean } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), replacements: false };
  } catch {
    return { text: new TextDecoder('utf-8').decode(bytes), replacements: true };
  }
}

/**
 * Document-text control policy (fix round 2, F-04). Allowed in normalized document text: HT and the
 * line separators of Python `splitlines` (LF, VT, FF, CR, FS, GS, RS, NEL U+0085), which the pipeline
 * relies on for parity (uploads with VT/FS/GS/RS are already refused pre-store as binary_content).
 * Disallowed: NUL and every other C0 control, DEL, every other C1 control, and lone surrogates. The worker strips them; the parent
 * rejects worker output that still contains any.
 */
function isDisallowedTextCode(c: number): boolean {
  // Allowed C0: HT, and the Python `splitlines` separators LF, VT, FF, CR, FS, GS, RS.
  if (c < 0x20) return !(c === 0x09 || c === 0x0a || c === 0x0b || c === 0x0c || c === 0x0d || (c >= 0x1c && c <= 0x1e));
  return c === 0x7f || (c >= 0x80 && c <= 0x9f && c !== 0x85) || (c >= 0xd800 && c <= 0xdfff);
}

export function hasDisallowedTextControls(s: string): boolean {
  for (const ch of s) if (isDisallowedTextCode(ch.codePointAt(0) ?? 0)) return true;
  return false;
}

/** Remove disallowed characters (see `hasDisallowedTextControls`); returns the input when clean. */
export function stripDisallowedTextControls(s: string): string {
  if (!hasDisallowedTextControls(s)) return s;
  let out = '';
  for (const ch of s) if (!isDisallowedTextCode(ch.codePointAt(0) ?? 0)) out += ch;
  return out;
}

/** Python `_norm_key` / `_norm`: strip, lower-case, runs of non `[a-z0-9]` to `_`, trim `_`. */
export function normKey(key: string): string {
  return pyStrip(key)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}
