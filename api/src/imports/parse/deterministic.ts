/**
 * Deterministic, offline extraction provider: a port of
 * `freight_recovery.extraction.stub.DeterministicStubProvider` (`_pairs`, `_invoice`, `_ratecon`,
 * `_bol`) that additionally records, for every field, where it came from (line, character span, PDF
 * page, CSV record, excerpt) and a rule-based confidence (N7). Same input -> same output.
 *
 * Python semantics kept: first `:`/`=` splits a line; lines over 4000 code points are skipped; the key
 * must fully match `[A-Za-z][A-Za-z0-9 /#_-]{0,79}`; the value must be non-empty after strip; for a
 * single-valued key the LAST occurrence wins (CONFLICTING_VALUES when an earlier raw value differed);
 * `Charge:`/`Line:` values split on the first `|` and are kept only when the amount parses and the name
 * is non-empty. Registered divergence D6: string values have unsafe characters removed and are capped at
 * 200 code points (SANITIZED_VALUE).
 */
import { parseMoney } from '@fr/shared/decimal';
import { fieldSpec, type FieldKind, type FieldReviewReason, type KnownDocType, type WarningCode } from '@fr/shared/import-fields';
import { cpLength, cpSlice, plain, removeUnsafeChars, sanitizeSingleLine } from '@fr/shared/text-sanitize';

import { fieldConfidence, fieldReview } from './confidence.js';
import { parseDateTime } from './datetime.js';
import type { ExtractionProvider } from './provider.js';
import { normKey, pyLeadingSpaceLength, pySplitlinesWithOffsets, pyStrip } from './text.js';
import { MAX_FIELDS, MAX_RAW_VALUE, MAX_STRING_VALUE, MAX_WARNINGS, PROVIDER_NAME, PROVIDER_VERSION, type ExtractionDraft, type FieldDraft, type ParsedText } from './types.js';

const KEY_OK = /^[A-Za-z][A-Za-z0-9 /#_-]{0,79}$/u;
const MAX_LINE = 4000;
/** Values stored in the DB are at most 4000 code points (STRING_LIST JSON). */
const MAX_VALUE_CHARS = 4000;

export interface Pair {
  /** Normalized key. */
  key: string;
  /** Python-stripped value. */
  val: string;
  /** 0-based line index in Python `splitlines()`. */
  lineIndex: number;
  /** The line's text. */
  line: string;
  /** UTF-16 offset of `val` within the line. */
  valStart: number;
}

/** Python `_pairs`, with positions. */
export function pairs(text: string): Pair[] {
  const out: Pair[] = [];
  pySplitlinesWithOffsets(text).forEach(({ text: line }, lineIndex) => {
    if (cpLength(line) > MAX_LINE) return;
    const c = line.indexOf(':');
    const e = line.indexOf('=');
    const idx = c === -1 ? e : e === -1 ? c : Math.min(c, e);
    if (idx <= 0) return;
    const key = pyStrip(line.slice(0, idx));
    const rest = line.slice(idx + 1);
    const val = pyStrip(rest);
    if (val && KEY_OK.test(key)) out.push({ key: normKey(key), val, lineIndex, line, valStart: idx + 1 + pyLeadingSpaceLength(rest) });
  });
  return out;
}

interface Slot {
  field: string;
  aliases: readonly string[];
}

const SLOTS: Readonly<Record<KnownDocType, readonly Slot[]>> = {
  INVOICE: [
    { field: 'invoice.invoice_number', aliases: ['invoice_number', 'invoice', 'invoice_no'] },
    { field: 'invoice.load_number', aliases: ['load_number', 'load', 'load_no', 'pro_number'] },
    { field: 'invoice.carrier', aliases: ['carrier'] },
    { field: 'invoice.shipper', aliases: ['shipper'] },
    { field: 'invoice.invoice_date', aliases: ['invoice_date'] },
    { field: 'invoice.total', aliases: ['total', 'total_due', 'amount_due'] },
  ],
  RATE_CONFIRMATION: [
    { field: 'rate_confirmation.load_number', aliases: ['load_number', 'load', 'load_no'] },
    { field: 'rate_confirmation.carrier', aliases: ['carrier'] },
    { field: 'rate_confirmation.linehaul_rate', aliases: ['linehaul_rate'] },
    { field: 'rate_confirmation.fuel_surcharge', aliases: ['fuel_surcharge', 'fuel_surcharge_rate'] },
    { field: 'rate_confirmation.detention_free_hours', aliases: ['detention_free_hours'] },
    { field: 'rate_confirmation.detention_rate_per_hour', aliases: ['detention_rate_per_hour'] },
    { field: 'rate_confirmation.detention_max_hours', aliases: ['detention_max_hours'] },
    { field: 'rate_confirmation.authorized_accessorials', aliases: ['authorized_accessorials'] },
  ],
  BILL_OF_LADING: [
    { field: 'bol.load_number', aliases: ['load_number', 'load', 'load_no'] },
    { field: 'bol.facility', aliases: ['facility', 'consignee', 'location'] },
    { field: 'bol.appointment_time', aliases: ['appointment_time', 'appointment'] },
    { field: 'bol.arrival_time', aliases: ['arrival_time', 'arrival', 'check_in'] },
    { field: 'bol.departure_time', aliases: ['departure_time', 'departure', 'check_out'] },
  ],
};
const CHARGE_ALIASES: ReadonlySet<string> = new Set(['charge', 'line']);

interface Converted {
  value: string | null;
  sanitized: boolean;
  usDateTime: boolean;
}

/** Convert a raw value to the canonical stored form of its kind (validators shared with review). */
export function convertValue(kind: FieldKind, raw: string): Converted {
  switch (kind) {
    case 'DECIMAL':
      return { value: parseMoney(raw), sanitized: false, usDateTime: false };
    case 'DATETIME': {
      const dt = parseDateTime(raw);
      return { value: dt?.value ?? null, sanitized: false, usDateTime: dt?.usFormat ?? false };
    }
    case 'STRING_LIST': {
      const items: string[] = [];
      let sanitized = false;
      for (const part of raw.split(',')) {
        const stripped = pyStrip(part);
        if (!stripped) continue;
        const s = sanitizeSingleLine(stripped, MAX_STRING_VALUE);
        if (s.changed) sanitized = true;
        if (s.value) items.push(s.value);
        else sanitized = true;
      }
      while (items.length > 0 && cpLength(JSON.stringify(items)) > MAX_VALUE_CHARS) {
        items.pop();
        sanitized = true;
      }
      return { value: JSON.stringify(items), sanitized, usDateTime: false };
    }
    case 'STRING': {
      const s = sanitizeSingleLine(raw, MAX_STRING_VALUE);
      return { value: s.value === '' ? null : s.value, sanitized: s.changed, usDateTime: false };
    }
  }
}

/** Stored raw text: single-line safe, capped. */
export function rawText(raw: string): string {
  const cleaned = pyStrip(removeUnsafeChars(raw));
  return cpLength(cleaned) > MAX_RAW_VALUE ? cpSlice(cleaned, MAX_RAW_VALUE) : cleaned;
}

interface Pending {
  key: string;
  groupIndex: number | null;
  raw: string;
  conflicting: boolean;
  pair: Pair;
  start: number;
  end: number;
}

export class DeterministicProvider implements ExtractionProvider {
  readonly name = PROVIDER_NAME;
  readonly version = PROVIDER_VERSION;

  extract(doc: ParsedText, threshold: number): ExtractionDraft {
    const warnings: WarningCode[] = [];
    const ignored = { any: false };
    if (doc.docType === 'OTHER') return { fields: [], warnings, reviewReasons: [], loadNumber: null };
    const docType = doc.docType;
    const ps = pairs(doc.text);
    const pending: Pending[] = [];

    for (const slot of SLOTS[docType]) {
      const occ = ps.filter((p) => slot.aliases.includes(p.key));
      const last = occ[occ.length - 1];
      if (!last) continue;
      pending.push({
        key: slot.field,
        groupIndex: null,
        raw: last.val,
        conflicting: occ.slice(0, -1).some((o) => o.val !== last.val),
        pair: last,
        start: last.valStart,
        end: last.valStart + last.val.length,
      });
    }

    if (docType === 'INVOICE') {
      let group = 0;
      for (const p of ps) {
        if (!CHARGE_ALIASES.has(p.key)) continue;
        const bar = p.val.indexOf('|');
        const name = bar === -1 ? p.val : p.val.slice(0, bar);
        const amt = bar === -1 ? '' : p.val.slice(bar + 1);
        const amount = parseMoney(amt);
        const desc = pyStrip(name);
        if (amount === null || !desc) {
          if (warnings.length < MAX_WARNINGS) warnings.push('CHARGE_AMOUNT_UNREADABLE');
          ignored.any = true;
          continue;
        }
        const descStart = p.valStart + pyLeadingSpaceLength(name);
        const amtStart = p.valStart + bar + 1 + pyLeadingSpaceLength(amt);
        pending.push({ key: 'invoice.charge.description', groupIndex: group, raw: desc, conflicting: false, pair: p, start: descStart, end: descStart + desc.length });
        pending.push({ key: 'invoice.charge.amount', groupIndex: group, raw: pyStrip(amt), conflicting: false, pair: p, start: amtStart, end: amtStart + pyStrip(amt).length });
        group += 1;
      }
    }

    const order = (k: string) => {
      const keys = SLOTS[docType].map((s) => s.field).concat(['invoice.charge.description', 'invoice.charge.amount']);
      return keys.indexOf(k);
    };
    pending.sort((a, b) => order(a.key) - order(b.key) || (a.groupIndex ?? 0) - (b.groupIndex ?? 0));

    const fields: FieldDraft[] = [];
    for (const p of pending) {
      const spec = fieldSpec(p.key);
      if (!spec) continue;
      const conv = convertValue(spec.kind, p.raw);
      const unparseable = conv.value === null;
      const confidence = fieldConfidence({
        isPdf: doc.isPdf,
        basis: doc.basis,
        usDateTime: conv.usDateTime,
        conflicting: p.conflicting,
        decodeReplacements: doc.decodeReplacements,
        sanitized: conv.sanitized,
        unparseable,
      });
      const review = fieldReview(confidence, threshold, { unparseable, conflicting: p.conflicting, sanitized: conv.sanitized });
      fields.push({
        key: p.key,
        groupIndex: p.groupIndex,
        kind: spec.kind,
        value: conv.value,
        rawValue: rawText(p.raw),
        confidence,
        needsReview: review.needsReview,
        reviewReasons: review.reasons as FieldReviewReason[],
        source: {
          page: doc.pageOfLine[p.pair.lineIndex] ?? null,
          line: p.pair.lineIndex + 1,
          start: p.start,
          end: p.end,
          row: doc.rowOfLine[p.pair.lineIndex] ?? null,
          excerpt: plain(p.pair.line, 200),
        },
      });
    }

    const reviewReasons: ExtractionDraft['reviewReasons'] = [];
    if (ignored.any) reviewReasons.push('IGNORED_CONTENT');
    if (fields.length > MAX_FIELDS) {
      fields.length = MAX_FIELDS;
      warnings.push('FIELDS_TRUNCATED');
      reviewReasons.push('TRUNCATED_FIELDS');
    }
    const loadField = fields.find((f) => f.key.endsWith('.load_number') && f.value !== null);
    return { fields, warnings, reviewReasons, loadNumber: loadField?.value ?? null };
  }
}
