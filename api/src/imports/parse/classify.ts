/**
 * Document-type classification: a faithful port of `freight_recovery.ingest.loader.classify`
 * (`_MARKERS`, `_TYPE_KEYS`, `_present_keys`, `_markers_in`). Order: (1) an explicit, unambiguous
 * `Document:` header in the first 400 code points; (2) distinctive keys present in the body (a unique
 * top score wins, ties are UNKNOWN); (3) the file name. Python UNKNOWN maps to OTHER.
 */
import type { DocTypeBasis, ImportDocType, KnownDocType } from '@fr/shared/import-fields';

import { cpLength, cpSlice, pySplitlines, pyStrip } from './text.js';
import { normKey } from './text.js';

const NA = '(?<![a-z0-9])';
const NB = '(?![a-z0-9])';

/** Python `_MARKERS` (searched in `text.lower()`). */
const MARKERS: readonly [KnownDocType, RegExp][] = [
  ['RATE_CONFIRMATION', new RegExp(`${NA}(rate[ _-]?confirmation|rate[ _-]?con|ratecon)${NB}`, 'u')],
  ['BILL_OF_LADING', new RegExp(`${NA}(bill[ _-]?of[ _-]?lading|bol)${NB}`, 'u')],
  ['INVOICE', new RegExp(`${NA}invoice${NB}`, 'u')],
];

/** Python `_TYPE_KEYS`, in dict order (INVOICE, RATE_CONFIRMATION, BOL). */
const TYPE_KEYS: readonly [KnownDocType, ReadonlySet<string>][] = [
  ['INVOICE', new Set(['invoice_number', 'invoice_no', 'invoice', 'invoice_date', 'charge', 'line', 'total', 'total_due', 'amount_due'])],
  [
    'RATE_CONFIRMATION',
    new Set([
      'linehaul_rate',
      'fuel_surcharge',
      'fuel_surcharge_rate',
      'detention_free_hours',
      'detention_rate_per_hour',
      'detention_max_hours',
      'authorized_accessorials',
    ]),
  ],
  [
    'BILL_OF_LADING',
    new Set(['appointment_time', 'appointment', 'arrival_time', 'arrival', 'check_in', 'departure_time', 'departure', 'check_out', 'facility', 'consignee']),
  ],
];

export const MAX_KEY_LEN = 80;
export const MAX_LINE_LEN = 4000;
const HEADER_SCAN_CHARS = 400;

/** Python `_markers_in`. */
export function markersIn(text: string): Set<KnownDocType> {
  const low = text.toLowerCase();
  const out = new Set<KnownDocType>();
  for (const [t, re] of MARKERS) if (re.test(low)) out.add(t);
  return out;
}

/** Index of the first `:` or `=` (UTF-16), or -1. */
export function firstDelimiter(line: string): number {
  const c = line.indexOf(':');
  const e = line.indexOf('=');
  if (c === -1) return e;
  if (e === -1) return c;
  return Math.min(c, e);
}

/** Python `_present_keys`: normalized keys of `Key: value` / `Key = value` lines. */
export function presentKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const line of pySplitlines(text)) {
    if (cpLength(line) > MAX_LINE_LEN) continue;
    const idx = firstDelimiter(line);
    if (idx < 0) continue;
    const head = line.slice(0, idx);
    const cpIdx = cpLength(head);
    if (cpIdx > 0 && cpIdx <= MAX_KEY_LEN) keys.add(normKey(head));
  }
  return keys;
}

export interface Classification {
  docType: ImportDocType;
  basis: DocTypeBasis;
}

/** Python `classify(text, filename)` plus the basis that decided it. */
export function classify(text: string, filename = ''): Classification {
  for (const line of pySplitlines(cpSlice(text, HEADER_SCAN_CHARS))) {
    if (pyStrip(line).toLowerCase().startsWith('document:')) {
      const found = markersIn(line.slice(line.indexOf(':') + 1));
      const only = found.size === 1 ? [...found][0] : undefined;
      if (only) return { docType: only, basis: 'HEADER' };
      break;
    }
  }

  const keys = presentKeys(text);
  const scores = TYPE_KEYS.map(([t, ks]) => {
    let n = 0;
    for (const k of ks) if (keys.has(k)) n += 1;
    return [t, n] as const;
  });
  const top = Math.max(...scores.map(([, n]) => n));
  if (top > 0) {
    const winners = scores.filter(([, n]) => n === top);
    const w = winners.length === 1 ? winners[0] : undefined;
    return w ? { docType: w[0], basis: 'KEYS' } : { docType: 'OTHER', basis: 'NONE' };
  }

  const found = markersIn(filename);
  const only = found.size === 1 ? [...found][0] : undefined;
  return only ? { docType: only, basis: 'FILENAME' } : { docType: 'OTHER', basis: 'NONE' };
}
