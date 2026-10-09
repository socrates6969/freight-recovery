/**
 * Display helpers for imports (N12). Every string here is fixed UI text or derived from typed values;
 * document-derived strings are always rendered as text nodes (SafeText) by the components.
 */
import {
  ALLOWED_EXTENSIONS,
  DEFAULT_IMPORT_MAX_FILE_BYTES,
  DEFAULT_IMPORT_MAX_FILES_PER_BATCH,
  FIELD_LABELS,
  confidenceLevel,
  fieldSpec,
  formatUsdCents,
  type ExtractedFieldDto,
} from '@fr/shared';

import { ApiError } from '../../api/client';

/** Fixed error texts (server text is never shown). */
export const UPLOAD_ERROR_TEXT = {
  tooLarge: 'File is too large.',
  unsupported: 'File type not supported.',
  quota: 'Storage quota reached.',
  busy: 'The parser is busy. Try again shortly.',
  other: 'Upload failed.',
} as const;
export const INVALID_VALUE_TEXT = 'That value is not valid for this field.';
export const STALE_TEXT = 'This item changed. Reload to continue.';
export const CONFIDENCE_NOTE = 'Confidence is a rule-based parse score, not an accuracy measure.';

export function uploadErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 413) return UPLOAD_ERROR_TEXT.tooLarge;
    if (e.status === 415) return UPLOAD_ERROR_TEXT.unsupported;
    if (e.status === 422 && e.code === 'quota_exceeded') return UPLOAD_ERROR_TEXT.quota;
    if (e.status === 503) return UPLOAD_ERROR_TEXT.busy;
  }
  return UPLOAD_ERROR_TEXT.other;
}

/** UX-only pre-filter (the server enforces the real rules). Returns the fixed error text or null. */
export function preFilter(file: { name: string; size: number }): string | null {
  const dot = file.name.lastIndexOf('.');
  const ext = dot === -1 ? '' : file.name.slice(dot).toLowerCase();
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) return UPLOAD_ERROR_TEXT.unsupported;
  if (file.size > DEFAULT_IMPORT_MAX_FILE_BYTES) return UPLOAD_ERROR_TEXT.tooLarge;
  return null;
}

export const MAX_FILES = DEFAULT_IMPORT_MAX_FILES_PER_BATCH;
/** Shown when a selection would exceed the batch limit; nothing is uploaded (the server enforces it too). */
export const TOO_MANY_FILES_TEXT = `Upload failed. Select at most ${DEFAULT_IMPORT_MAX_FILES_PER_BATCH} files per batch.`;

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

/** `95%` from a 0..1 score. */
export function confidencePercent(c: number): string {
  return `${Math.round(c * 100)}%`;
}

export function confidenceText(c: number): string {
  return `${confidencePercent(c)} ${confidenceLevel(c)}`;
}

/** Money-looking DecimalString -> `$1,234.56` (exact; more than two decimals are shown as typed). */
export function formatMoneyDecimal(v: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(v);
  if (!m) return v;
  const frac = m[3] ?? '';
  if (frac.length > 2 || (m[2] ?? '').length > 13) return `${m[1] ?? ''}$${m[2] ?? ''}${frac ? `.${frac}` : ''}`;
  const cents = Number(`${m[2] ?? '0'}${frac.padEnd(2, '0')}`);
  return formatUsdCents(m[1] ? -cents : cents);
}

/** Value cell text by kind (no timezone conversion for local datetimes). */
export function formatFieldValue(key: string, kind: ExtractedFieldDto['kind'], value: string | null): string {
  if (value === null) return '';
  if (kind === 'DECIMAL') return fieldSpec(key)?.money ? formatMoneyDecimal(value) : value;
  if (kind === 'DATETIME') return value.replace('T', ' ');
  if (kind === 'STRING_LIST') {
    try {
      const items: unknown = JSON.parse(value);
      return Array.isArray(items) ? items.filter((x): x is string => typeof x === 'string').join(', ') : value;
    } catch {
      return value;
    }
  }
  return value;
}

/** `p.2 line 14 chars 10-18` (PDF) or `line 14 chars 10-18`; MANUAL fields: `Manual entry`. */
export function sourceText(source: ExtractedFieldDto['source']): string {
  if (!source) return 'Manual entry';
  const loc = `line ${source.line} chars ${source.start}-${source.end}`;
  return source.page === null ? loc : `p.${source.page} ${loc}`;
}

/** Review cell text. */
export function reviewText(f: Pick<ExtractedFieldDto, 'needsReview' | 'status'>): string {
  if (f.status === 'CONFIRMED') return 'Confirmed';
  if (f.status === 'CORRECTED') return 'Corrected';
  if (f.status === 'REJECTED') return 'Rejected';
  return f.needsReview ? 'Needs review' : '';
}

export const STATUS_TEXT: Readonly<Record<string, string>> = {
  RECEIVED: 'Received',
  NEEDS_REVIEW: 'Needs review',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  FAILED: 'Failed',
};

export const DOC_TYPE_TEXT: Readonly<Record<string, string>> = {
  INVOICE: 'Invoice',
  RATE_CONFIRMATION: 'Rate confirmation',
  BILL_OF_LADING: 'Bill of lading',
  OTHER: 'Unknown',
};

export const REASON_TEXT: Readonly<Record<string, string>> = {
  UNKNOWN_DOC_TYPE: 'Unknown document type',
  NO_FIELDS: 'No fields found',
  MISSING_LOAD_NUMBER: 'Missing load number',
  IMAGE_NO_TEXT_LAYER: 'Image: key fields in manually',
  DECODE_REPLACEMENTS: 'Unreadable characters replaced',
  IGNORED_CONTENT: 'Some content was ignored',
  FLAGGED_FIELDS: 'Flagged fields',
  DUPLICATE_OF_EARLIER: 'Same file imported before',
  TRUNCATED_FIELDS: 'Too many fields',
};

/** "Created 1 claim, updated 0." */
export function commitSummary(created: number, updated: number): string {
  return `Created ${created} claim${created === 1 ? '' : 's'}, updated ${updated}.`;
}
