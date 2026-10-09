/**
 * Validation of reviewer-entered values (R47 add, R48 correct) with the SAME validators as extraction:
 * DECIMAL via parseMoney (stored canonical), DATETIME via the four parse_dt formats (stored canonical),
 * STRING single-line <= 200 code points with no unsafe characters, STRING_LIST comma-separated input
 * stored as a JSON array. Load numbers must be non-empty and at most 100 code points.
 */
import { cpLength, hasUnsafeChars, parseMoney, pyStrip, type FieldKind } from '@fr/shared';

import { parseDateTime } from './parse/datetime.js';
import { MAX_RAW_VALUE, MAX_STRING_VALUE } from './parse/types.js';

const LOAD_NUMBER_MAX = 100;
const LINE_SEPARATORS = /[\u{2028}\u{2029}\u{85}]/u;

export interface ManualValue {
  /** Canonical stored value. */
  value: string;
  /** Stored raw text (what the reviewer typed, trimmed). */
  raw: string;
}

function safeSingleLine(s: string): boolean {
  return !hasUnsafeChars(s) && !LINE_SEPARATORS.test(s);
}

/** Canonical value for a reviewer input, or null when it is not valid for the field. */
export function validateManualValue(key: string, kind: FieldKind, input: string): ManualValue | null {
  const trimmed = pyStrip(input);
  if (!safeSingleLine(trimmed) || cpLength(trimmed) > MAX_RAW_VALUE) return null;
  switch (kind) {
    case 'DECIMAL': {
      const v = parseMoney(trimmed);
      return v === null ? null : { value: v, raw: trimmed };
    }
    case 'DATETIME': {
      const v = parseDateTime(trimmed);
      return v === null ? null : { value: v.value, raw: trimmed };
    }
    case 'STRING_LIST': {
      const items = trimmed
        .split(',')
        .map((x) => pyStrip(x))
        .filter((x) => x.length > 0);
      if (items.some((x) => cpLength(x) > MAX_STRING_VALUE)) return null;
      return { value: JSON.stringify(items), raw: trimmed };
    }
    case 'STRING': {
      if (trimmed.length === 0 || cpLength(trimmed) > MAX_STRING_VALUE) return null;
      if (key.endsWith('.load_number') && cpLength(trimmed) > LOAD_NUMBER_MAX) return null;
      return { value: trimmed, raw: trimmed };
    }
  }
}
