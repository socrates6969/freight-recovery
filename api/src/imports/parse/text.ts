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

/** Python `_norm_key` / `_norm`: strip, lower-case, runs of non `[a-z0-9]` to `_`, trim `_`. */
export function normKey(key: string): string {
  return pyStrip(key)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}
