/**
 * Document review reasons (N6/N7), computed from the fields. Pure; used by the worker AND re-computed by
 * the parent from the validated worker output (the parent never trusts reasons it can derive itself).
 */
import { DOC_REVIEW_REASONS, LOAD_NUMBER_KEYS, type DetectedType, type DocReviewReason, type ImportDocType } from '@fr/shared/import-fields';

export interface ReasonField {
  key: string;
  /** Effective value (null when unparseable or rejected). */
  value: string | null;
  needsReview: boolean;
}

/** Reasons that only the parser/pipeline can know (passed through). */
export const PASSTHROUGH_REASONS: ReadonlySet<DocReviewReason> = new Set(['DECODE_REPLACEMENTS', 'IGNORED_CONTENT', 'TRUNCATED_FIELDS', 'DUPLICATE_OF_EARLIER']);

export function documentReviewReasons(input: {
  docType: ImportDocType;
  detectedType: DetectedType;
  fields: readonly ReasonField[];
  passthrough: readonly DocReviewReason[];
}): DocReviewReason[] {
  const set = new Set<DocReviewReason>();
  for (const r of input.passthrough) if (PASSTHROUGH_REASONS.has(r)) set.add(r);
  const isImage = input.detectedType === 'PNG' || input.detectedType === 'JPEG';
  if (isImage) set.add('IMAGE_NO_TEXT_LAYER');
  if (input.docType === 'OTHER') {
    if (!isImage) set.add('UNKNOWN_DOC_TYPE');
  } else {
    if (input.fields.length === 0) set.add('NO_FIELDS');
    const loadKey = LOAD_NUMBER_KEYS[input.docType];
    if (!input.fields.some((f) => f.key === loadKey && f.value !== null && f.value !== '')) set.add('MISSING_LOAD_NUMBER');
  }
  if (input.fields.some((f) => f.needsReview)) set.add('FLAGGED_FIELDS');
  return DOC_REVIEW_REASONS.filter((r) => set.has(r));
}
