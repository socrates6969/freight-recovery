/**
 * Types of the pure parsing core (A5). Shared by the sandboxed worker (producer) and the parent
 * process (which re-validates everything it receives; the worker is treated as untrusted code).
 */
import type {
  DetectedType,
  DocReviewReason,
  DocTypeBasis,
  FieldKind,
  FieldReviewReason,
  ImportDocType,
  ParseRejectReason,
  WarningCode,
} from '@fr/shared/import-fields';

export type { DetectedType };

/** Provider identity stored on every parsed document. */
export const PROVIDER_NAME = 'deterministic';
export const PROVIDER_VERSION = '1';
/** Bump when the parse/normalization output changes (stored as parser_version). */
export const PARSER_VERSION = '1';

/** Fields per document (excess dropped, FIELDS_TRUNCATED). */
export const MAX_FIELDS = 500;
/** Lines per normalized text (more is text_too_large). */
export const MAX_LINES = 200_000;
/** Warnings kept per document. */
export const MAX_WARNINGS = 50;
/** STRING value cap (code points). */
export const MAX_STRING_VALUE = 200;
/** raw_value cap (code points). */
export const MAX_RAW_VALUE = 500;

export interface ParseLimits {
  pdfPages: number;
  textChars: number;
  imagePixels: number;
}

export interface ParseRequest {
  /** Sanitized display name (used for the extension rule and classify's filename branch only). */
  filename: string;
  detectedType: DetectedType;
  limits: ParseLimits;
  /** REVIEW_CONFIDENCE_THRESHOLD (0.50..1.00), passed in by the parent. */
  threshold: number;
}

export interface FieldSource {
  /** 1-based PDF page, else null. */
  page: number | null;
  /** 1-based line in Python `splitlines()` of the normalized text. */
  line: number;
  /** UTF-16 offsets of the value inside the line (`end` exclusive). */
  start: number;
  end: number;
  /** 1-based CSV record among the non-empty records (header = 1), else null. */
  row: number | null;
  /** `plain(line, 200)`. */
  excerpt: string;
}

export interface FieldDraft {
  key: string;
  groupIndex: number | null;
  kind: FieldKind;
  /** Canonical value; null when unparseable. */
  value: string | null;
  rawValue: string;
  confidence: number;
  needsReview: boolean;
  reviewReasons: FieldReviewReason[];
  source: FieldSource;
}

/** Normalized text handed to an extraction provider. */
export interface ParsedText {
  text: string;
  isPdf: boolean;
  docType: ImportDocType;
  basis: DocTypeBasis;
  /** Per line index (0-based): 1-based PDF page, or null. */
  pageOfLine: (number | null)[];
  /** Per line index (0-based): 1-based CSV record, or null. */
  rowOfLine: (number | null)[];
  decodeReplacements: boolean;
}

export interface ExtractionDraft {
  fields: FieldDraft[];
  warnings: WarningCode[];
  reviewReasons: DocReviewReason[];
  loadNumber: string | null;
}

export interface ParseSuccess {
  ok: true;
  docType: ImportDocType;
  docTypeBasis: DocTypeBasis;
  status: 'ACCEPTED' | 'NEEDS_REVIEW';
  /** The normalized text pointers refer to (stored as the derived text object). */
  text: string;
  pageCount: number | null;
  charCount: number;
  lineCount: number;
  fields: FieldDraft[];
  warnings: WarningCode[];
  reviewReasons: DocReviewReason[];
  loadNumber: string | null;
  providerName: string;
  providerVersion: string;
  parserVersion: string;
}

export interface ParseReject {
  ok: false;
  reason: ParseRejectReason;
}

export type ParseResult = ParseSuccess | ParseReject;

export class ParseRejection extends Error {
  constructor(readonly reason: ParseRejectReason) {
    super(reason);
    this.name = 'ParseRejection';
  }
}
