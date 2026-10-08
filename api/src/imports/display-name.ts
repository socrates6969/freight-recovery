/**
 * Display name sanitation (A7). The sanitized name is used for the extension rule, the API response and
 * classify's filename branch; it is never used in an object key, an HTTP header or a log line.
 */
import { cpLength, cpSlice, removeUnsafeChars } from '@fr/shared';

import { lastExtension } from './sniff.js';

export const DISPLAY_NAME_MAX = 255;

/** NFC; controls/bidi/NUL removed; `/ \ : * ? " < > |` -> `_`; whitespace collapsed; trimmed; <= 255. */
export function displayNameFor(raw: string): string {
  let s = removeUnsafeChars(raw.normalize('NFC'));
  s = s.replace(/[/\\:*?"<>|]/gu, '_');
  s = s.replace(/\s+/gu, ' ').trim();
  if (cpLength(s) > DISPLAY_NAME_MAX) {
    const ext = lastExtension(s);
    const keep = ext && cpLength(ext) < 16 ? ext : '';
    s = `${cpSlice(s, DISPLAY_NAME_MAX - cpLength(keep))}${keep}`;
  }
  return s === '' ? 'unnamed' : s;
}
