/**
 * Parent <-> parse-worker protocol (A6). Request: ONE JSON header line + `\n` + the raw file bytes.
 * Response: one JSON document, `{ok:true,result}` or `{ok:false,reason}`.
 *
 * The worker is treated as UNTRUSTED code: the parent validates the response strictly (allow-listed
 * keys and codes, counts within caps, pointers inside the text, values re-validated per kind) and
 * re-derives everything it can compute itself (excerpts, review flags vs. the threshold, document
 * reasons, status, load number). Anything invalid is `parse_failed`.
 */
import {
  DOC_TYPE_BASES,
  FIELD_KINDS,
  FIELD_REVIEW_REASONS,
  IMPORT_DOC_TYPES,
  PARSE_REJECT_REASONS,
  WARNING_CODES,
  cpLength,
  fieldSpec,
  hasUnsafeChars,
  isDecimalString,
  plain,
  pySplitlinesWithOffsets,
  type DetectedType,
  type DocReviewReason,
  type FieldReviewReason,
  type ParseRejectReason,
} from '@fr/shared';
import { z } from 'zod';

import { milli } from '../parse/confidence.js';
import { PASSTHROUGH_REASONS, documentReviewReasons } from '../parse/reasons.js';
import {
  MAX_FIELDS,
  MAX_LINES,
  MAX_RAW_VALUE,
  MAX_STRING_VALUE,
  MAX_WARNINGS,
  PARSER_VERSION,
  PROVIDER_NAME,
  PROVIDER_VERSION,
  type FieldDraft,
  type ParseLimits,
  type ParseSuccess,
} from '../parse/types.js';

export const PROTOCOL_VERSION = 1;

export interface WorkerHeader {
  v: 1;
  filename: string;
  detectedType: DetectedType;
  limits: ParseLimits;
  threshold: number;
  /** Exact byte length of the body that follows the header line. */
  size: number;
}

export function encodeRequest(header: WorkerHeader): Buffer {
  return Buffer.from(`${JSON.stringify(header)}\n`, 'utf8');
}

/** Outcome reasons the executor reports (post-store rejections except reviewer_rejected). */
export type ParseFailureReason = ParseRejectReason | 'parse_timeout' | 'parse_memory' | 'parse_failed';

export type ParseOutcome = { ok: true; result: ParseSuccess } | { ok: false; reason: ParseFailureReason };

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u;
const MAX_VALUE_CHARS = 4000;

const fieldSchema = z.strictObject({
  key: z.string().max(64),
  groupIndex: z.int().min(0).max(MAX_FIELDS).nullable(),
  kind: z.enum(FIELD_KINDS),
  value: z.string().nullable(),
  rawValue: z.string(),
  confidence: z.number().min(0).max(1),
  needsReview: z.boolean(),
  reviewReasons: z.array(z.enum(FIELD_REVIEW_REASONS)).max(FIELD_REVIEW_REASONS.length),
  source: z.strictObject({
    page: z.int().min(1).nullable(),
    line: z.int().min(1),
    start: z.int().min(0),
    end: z.int().min(0),
    row: z.int().min(1).nullable(),
    excerpt: z.string().max(4000),
  }),
});

const successSchema = z.strictObject({
  ok: z.literal(true),
  docType: z.enum(IMPORT_DOC_TYPES),
  docTypeBasis: z.enum(DOC_TYPE_BASES).exclude(['MANUAL']),
  status: z.enum(['ACCEPTED', 'NEEDS_REVIEW']),
  text: z.string(),
  pageCount: z.int().min(0).nullable(),
  charCount: z.int().min(0),
  lineCount: z.int().min(0),
  fields: z.array(fieldSchema).max(MAX_FIELDS),
  warnings: z.array(z.enum(WARNING_CODES)).max(MAX_WARNINGS),
  reviewReasons: z.array(z.string()).max(20),
  loadNumber: z.string().nullable(),
  providerName: z.literal(PROVIDER_NAME),
  providerVersion: z.literal(PROVIDER_VERSION),
  parserVersion: z.literal(PARSER_VERSION),
});

const responseSchema = z.union([
  z.strictObject({ ok: z.literal(true), result: successSchema }),
  z.strictObject({ ok: z.literal(false), reason: z.enum(PARSE_REJECT_REASONS) }),
]);

class Invalid extends Error {}

function check(cond: boolean): void {
  if (!cond) throw new Invalid('invalid worker output');
}

function validValue(kind: string, value: string): boolean {
  if (cpLength(value) > MAX_VALUE_CHARS || hasUnsafeChars(value) || /[\u{2028}\u{2029}]/u.test(value)) return false;
  switch (kind) {
    case 'STRING':
      return value.length > 0 && cpLength(value) <= MAX_STRING_VALUE;
    case 'DECIMAL':
      return isDecimalString(value) && value.length <= 25;
    case 'DATETIME':
      return DATETIME_RE.test(value);
    case 'STRING_LIST': {
      try {
        const v: unknown = JSON.parse(value);
        return Array.isArray(v) && v.every((x) => typeof x === 'string' && cpLength(x) <= MAX_STRING_VALUE && !hasUnsafeChars(x));
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

/**
 * Validate and normalize a raw worker response. Returns `parse_failed` for anything that is not a
 * well-formed, in-bounds result for this request.
 */
export function validateWorkerResponse(raw: string, ctx: { detectedType: DetectedType; limits: ParseLimits; threshold: number }): ParseOutcome {
  let parsed: z.infer<typeof responseSchema>;
  try {
    parsed = responseSchema.parse(JSON.parse(raw));
  } catch {
    return { ok: false, reason: 'parse_failed' };
  }
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  try {
    return { ok: true, result: normalizeSuccess(parsed.result, ctx) };
  } catch {
    return { ok: false, reason: 'parse_failed' };
  }
}

function normalizeSuccess(r: z.infer<typeof successSchema>, ctx: { detectedType: DetectedType; limits: ParseLimits; threshold: number }): ParseSuccess {
  const isImage = ctx.detectedType === 'PNG' || ctx.detectedType === 'JPEG';
  const isPdf = ctx.detectedType === 'PDF';
  check(cpLength(r.text) <= ctx.limits.textChars);
  const lines = pySplitlinesWithOffsets(r.text);
  check(lines.length <= MAX_LINES);
  if (isImage) check(r.text === '' && r.fields.length === 0 && r.docType === 'OTHER' && r.pageCount === null);
  if (isPdf) check(r.pageCount !== null && r.pageCount >= 1 && r.pageCount <= ctx.limits.pdfPages);
  else check(r.pageCount === null);

  const seen = new Set<string>();
  const fields: FieldDraft[] = r.fields.map((f) => {
    const spec = fieldSpec(f.key);
    check(spec !== undefined && spec.docType === r.docType && spec.kind === f.kind);
    const grouped = f.key === 'invoice.charge.description' || f.key === 'invoice.charge.amount';
    check(grouped === (f.groupIndex !== null));
    const id = `${f.key}#${f.groupIndex ?? 0}`;
    check(!seen.has(id));
    seen.add(id);
    check(f.value === null || validValue(f.kind, f.value));
    check(cpLength(f.rawValue) <= MAX_RAW_VALUE && !hasUnsafeChars(f.rawValue));
    check(Number.isInteger(milli(f.confidence)) && Math.abs(milli(f.confidence) / 1000 - f.confidence) < 1e-9);
    const line = lines[f.source.line - 1];
    check(line !== undefined && f.source.start <= f.source.end && f.source.end <= line.text.length);
    check(isPdf ? f.source.page !== null && f.source.page <= (r.pageCount ?? 0) : f.source.page === null);
    check(ctx.detectedType === 'CSV' ? f.source.row !== null : f.source.row === null);
    const unparseable = f.value === null;
    const flags = new Set<FieldReviewReason>(f.reviewReasons);
    check(flags.has('UNPARSEABLE_VALUE') === unparseable);
    // The parent decides the threshold rule; the worker can never lower a flag it can verify.
    const low = milli(f.confidence) < milli(ctx.threshold);
    if (low) flags.add('LOW_CONFIDENCE');
    else flags.delete('LOW_CONFIDENCE');
    const reviewReasons = FIELD_REVIEW_REASONS.filter((x) => flags.has(x));
    return {
      key: f.key,
      groupIndex: f.groupIndex,
      kind: f.kind,
      value: f.value,
      rawValue: f.rawValue,
      confidence: milli(f.confidence) / 1000,
      needsReview: low || flags.has('UNPARSEABLE_VALUE') || flags.has('CONFLICTING_VALUES'),
      reviewReasons,
      source: {
        page: f.source.page,
        line: f.source.line,
        start: f.source.start,
        end: f.source.end,
        row: f.source.row,
        excerpt: plain(line?.text ?? '', 200),
      },
    };
  });

  const passthrough = r.reviewReasons.filter((x): x is DocReviewReason => PASSTHROUGH_REASONS.has(x as DocReviewReason));
  check(passthrough.length === r.reviewReasons.filter((x) => !['UNKNOWN_DOC_TYPE', 'NO_FIELDS', 'MISSING_LOAD_NUMBER', 'IMAGE_NO_TEXT_LAYER', 'FLAGGED_FIELDS'].includes(x)).length);
  const reviewReasons = documentReviewReasons({
    docType: r.docType,
    detectedType: ctx.detectedType,
    fields: fields.map((f) => ({ key: f.key, value: f.value, needsReview: f.needsReview })),
    passthrough,
  });
  const loadField = fields.find((f) => f.key.endsWith('.load_number') && f.value !== null);
  const loadNumber = loadField?.value ?? null;
  return {
    ok: true,
    docType: r.docType,
    docTypeBasis: r.docTypeBasis,
    status: reviewReasons.length === 0 ? 'ACCEPTED' : 'NEEDS_REVIEW',
    text: r.text,
    pageCount: r.pageCount,
    charCount: cpLength(r.text),
    lineCount: lines.length,
    fields,
    warnings: r.warnings,
    reviewReasons,
    loadNumber: loadNumber !== null && cpLength(loadNumber) <= 100 ? loadNumber : null,
    providerName: r.providerName,
    providerVersion: r.providerVersion,
    parserVersion: r.parserVersion,
  };
}
