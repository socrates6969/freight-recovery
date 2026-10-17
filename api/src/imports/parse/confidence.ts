/**
 * Field confidence (N7): a rule-based PARSE score, never an accuracy estimate. Start from the base for
 * an explicit `Key: value` line (0.95; 0.85 when the text came from a PDF text layer) and apply every
 * cap that holds; round to 3 decimals. A field needs review when its score is below the threshold or
 * when its value is unparseable or conflicting.
 */
import type { DocTypeBasis, FieldReviewReason } from '@fr/shared/import-fields';

export const BASE_TEXT = 0.95;
export const BASE_PDF = 0.85;
export const CAP_BASIS_KEYS = 0.85;
export const CAP_BASIS_FILENAME = 0.7;
export const CAP_US_DATETIME = 0.8;
export const CAP_CONFLICTING = 0.5;
export const CAP_DECODE_REPLACEMENTS = 0.6;
export const CAP_SANITIZED = 0.8;

export interface ConfidenceInput {
  isPdf: boolean;
  basis: DocTypeBasis;
  usDateTime: boolean;
  conflicting: boolean;
  decodeReplacements: boolean;
  sanitized: boolean;
  unparseable: boolean;
}

/** Thousandths (integer) of a 0..1 score; all comparisons are done on these to avoid float drift. */
export function milli(x: number): number {
  return Math.round(x * 1000);
}

export function fieldConfidence(i: ConfidenceInput): number {
  if (i.unparseable) return 0;
  const caps = [i.isPdf ? BASE_PDF : BASE_TEXT];
  if (i.basis === 'KEYS') caps.push(CAP_BASIS_KEYS);
  if (i.basis === 'FILENAME') caps.push(CAP_BASIS_FILENAME);
  if (i.usDateTime) caps.push(CAP_US_DATETIME);
  if (i.conflicting) caps.push(CAP_CONFLICTING);
  if (i.decodeReplacements) caps.push(CAP_DECODE_REPLACEMENTS);
  if (i.sanitized) caps.push(CAP_SANITIZED);
  return milli(Math.min(...caps)) / 1000;
}

/** Field review reasons in their fixed order, and whether the field needs review. */
export function fieldReview(
  confidence: number,
  threshold: number,
  flags: { unparseable: boolean; conflicting: boolean; sanitized: boolean },
): { needsReview: boolean; reasons: FieldReviewReason[] } {
  const reasons: FieldReviewReason[] = [];
  const low = milli(confidence) < milli(threshold);
  if (low) reasons.push('LOW_CONFIDENCE');
  if (flags.unparseable) reasons.push('UNPARSEABLE_VALUE');
  if (flags.conflicting) reasons.push('CONFLICTING_VALUES');
  if (flags.sanitized) reasons.push('SANITIZED_VALUE');
  return { needsReview: low || flags.unparseable || flags.conflicting, reasons };
}
