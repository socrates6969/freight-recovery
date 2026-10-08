/**
 * Untrusted-text helpers shared by API validation and web rendering.
 * - Single-line user fields: control characters and Unicode bidi controls are REJECTED.
 * - Multi-line user fields (demand letter): control characters except "\n" and bidi controls are STRIPPED.
 * - Display: every API string is rendered as a text node; displayText() additionally strips bidi
 *   override/isolate controls so hostile strings cannot visually reorder surrounding UI text.
 */

/** C0 controls (incl. \t \n \r), DEL and C1 controls. */
// eslint-disable-next-line no-control-regex
export const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F-\u009F]/u;
/** Bidi embedding/override/isolate controls plus implicit marks (LRM/RLM/ALM). */
export const BIDI_CONTROLS_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
/** Explicit bidi override/isolate controls stripped for display (U+202A-202E, U+2066-2069). */
const DISPLAY_BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/gu;
// eslint-disable-next-line no-control-regex
const MULTILINE_STRIP_RE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;

/** True when the string contains a control or bidi-control character (single-line policy). */
export function hasUnsafeChars(value: string): boolean {
  return CONTROL_CHARS_RE.test(value) || BIDI_CONTROLS_RE.test(value);
}

/** Multi-line policy: normalize CRLF/CR to LF, then strip every control except LF and every bidi control. */
export function stripUnsafeMultiline(value: string): string {
  return value.replace(/\r\n?/gu, '\n').replace(MULTILINE_STRIP_RE, '');
}

/** Neutralize a string for rendering: strips bidi override/isolate controls. Never returns markup. */
export function displayText(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(DISPLAY_BIDI_RE, '');
}
