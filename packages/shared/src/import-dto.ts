/**
 * Step 3 (Import + Export) public contract (N4): strict request schemas and response DTOs.
 * Every object schema is strict: unknown keys are rejected.
 */
import { z } from 'zod';

import { APPROVAL_ACTIONS, CLAIM_STATUSES, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, PERSPECTIVES, claimFilterShape, reasonSchema, singleLine } from './dto.js';
import {
  DETECTED_TYPES,
  DOC_TYPE_BASES,
  FIELD_KEYS,
  FIELD_KINDS,
  FIELD_ORIGINS,
  FIELD_STATUSES,
  IMPORT_DOC_STATUSES,
  IMPORT_DOC_TYPES,
  IMPORT_SOURCES,
  KNOWN_DOC_TYPES,
  REVIEW_ACTIONS,
} from './import-fields.js';
import { cpLength } from './text-sanitize.js';
import { hasUnsafeChars } from './text.js';

export * from './import-fields.js';

const uuid = z.uuid();
const isoDate = z.string();
const intFromQuery = z.coerce.number().int();
/** Path ids: length-bounded strings; non-UUID values are answered 404 by the handlers (same as unknown). */
const pathId = z.string().min(1).max(64);

export const LABEL_MAX = 120;
export const DISPLAY_NAME_MAX = 255;
/** Max length (code points) of a corrected / manually added value before kind validation. */
export const FIELD_INPUT_MAX = 2000;

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

export const CreateBatchBody = z.strictObject({ label: singleLine(1, LABEL_MAX).optional() });
export const ImportsPageQuery = z.strictObject({
  page: intFromQuery.min(1).default(1),
  pageSize: intFromQuery.min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});
export const BatchParams = z.strictObject({ batchId: pathId });
export const DocParams = z.strictObject({ batchId: pathId, docId: pathId });
export const FieldParams = z.strictObject({ batchId: pathId, docId: pathId, fieldId: pathId });

/**
 * Upload file name (R43 `?filename=`): already percent-decoded once by the query parser; NFC-normalized;
 * 1..255 code points; no control, bidi or NUL characters (400 otherwise).
 */
export const uploadFilenameSchema = z
  .string()
  .max(4 * DISPLAY_NAME_MAX)
  .transform((v) => v.normalize('NFC'))
  .refine((v) => cpLength(v) >= 1 && cpLength(v) <= DISPLAY_NAME_MAX, { message: 'invalid length' })
  .refine((v) => !hasUnsafeChars(v) && !/[\u{2028}\u{2029}]/u.test(v), { message: 'unsafe characters' });
export const UploadQuery = z.strictObject({ filename: uploadFilenameSchema });

export const SetDocTypeBody = z.strictObject({ docType: z.enum(KNOWN_DOC_TYPES) });
export const AddFieldBody = z.strictObject({
  key: z.enum(FIELD_KEYS as [string, ...string[]]),
  value: z.string().max(FIELD_INPUT_MAX),
  reason: reasonSchema,
});
export const ResolveFieldBody = z
  .strictObject({
    action: z.enum(['CONFIRM', 'CORRECT', 'REJECT']),
    correctedValue: z.string().max(FIELD_INPUT_MAX).optional(),
    reason: reasonSchema,
  })
  .superRefine((v, ctx) => {
    if (v.action === 'CORRECT' && v.correctedValue === undefined) {
      ctx.addIssue({ code: 'custom', path: ['correctedValue'], message: 'required for CORRECT' });
    }
    if (v.action !== 'CORRECT' && v.correctedValue !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['correctedValue'], message: 'only allowed for CORRECT' });
    }
  });
export const AcceptDocBody = z.strictObject({ reason: reasonSchema, confirmRemaining: z.boolean().optional() });
export const RejectDocBody = z.strictObject({ reason: reasonSchema });
export const CommitBody = z.strictObject({ perspective: z.enum(PERSPECTIVES) });

export const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const EXPORT_ENTITIES = ['claims', 'packets', 'outcomes'] as const;
export type ExportEntity = (typeof EXPORT_ENTITIES)[number];

const { page: _page, pageSize: _pageSize, ...claimFilterNoPage } = claimFilterShape;

export const ExportClaimsQuery = z.strictObject({ format: z.enum(EXPORT_FORMATS), ...claimFilterNoPage });
export const ExportPacketsQuery = z
  .strictObject({ format: z.enum(EXPORT_FORMATS), claimId: uuid.optional(), ...claimFilterNoPage })
  .superRefine((v, ctx) => {
    if (v.claimId !== undefined && (v.q !== undefined || v.status !== undefined || v.perspective !== undefined || v.assigneeId !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['claimId'], message: 'claimId cannot be combined with filters' });
    }
  });

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, { message: 'invalid date' });

const approvalActionList = z
  .string()
  .max(200)
  .transform((v, ctx) => {
    const parts = v.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
    const out: (typeof APPROVAL_ACTIONS)[number][] = [];
    for (const p of parts) {
      if (!(APPROVAL_ACTIONS as readonly string[]).includes(p)) {
        ctx.addIssue({ code: 'custom', message: 'invalid value' });
        return z.NEVER;
      }
      const a = p as (typeof APPROVAL_ACTIONS)[number];
      if (!out.includes(a)) out.push(a);
    }
    if (out.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'empty list' });
      return z.NEVER;
    }
    return out;
  });

export const ExportOutcomesQuery = z
  .strictObject({
    format: z.enum(EXPORT_FORMATS),
    claimId: uuid.optional(),
    action: approvalActionList.optional(),
    from: isoDay.optional(),
    to: isoDay.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.from !== undefined && v.to !== undefined && v.from > v.to) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'from must not be after to' });
    }
  });

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

const userRef = z.object({ id: uuid, name: z.string() });
const userRoleRef = z.object({ id: uuid, name: z.string(), role: z.string() });

export const ImportBatch = z.object({
  id: uuid,
  label: z.string().nullable(),
  source: z.enum(IMPORT_SOURCES),
  documentCount: z.int(),
  createdBy: userRef,
  createdAt: isoDate,
});
export type ImportBatchDto = z.infer<typeof ImportBatch>;

export const ImportDocumentSummary = z.object({
  id: uuid,
  batchId: uuid,
  displayName: z.string(),
  detectedType: z.enum(DETECTED_TYPES),
  sizeBytes: z.int(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  docType: z.enum(IMPORT_DOC_TYPES),
  docTypeBasis: z.enum(DOC_TYPE_BASES),
  status: z.enum(IMPORT_DOC_STATUSES),
  rejectReason: z.string().nullable(),
  reviewReasons: z.array(z.string()),
  fieldCount: z.int(),
  flaggedFieldCount: z.int(),
  unresolvedFlaggedCount: z.int(),
  minConfidence: z.number().nullable(),
  loadNumber: z.string().nullable(),
  pageCount: z.int().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type ImportDocumentSummaryDto = z.infer<typeof ImportDocumentSummary>;

export const FieldSource = z.object({
  page: z.int().nullable(),
  line: z.int(),
  start: z.int(),
  end: z.int(),
  row: z.int().nullable(),
  excerpt: z.string(),
});

export const ExtractedField = z.object({
  id: uuid,
  key: z.string(),
  groupIndex: z.int().nullable(),
  kind: z.enum(FIELD_KINDS),
  value: z.string().nullable(),
  correctedValue: z.string().nullable(),
  effectiveValue: z.string().nullable(),
  rawValue: z.string(),
  confidence: z.number(),
  needsReview: z.boolean(),
  reviewReasons: z.array(z.string()),
  status: z.enum(FIELD_STATUSES),
  origin: z.enum(FIELD_ORIGINS),
  source: FieldSource.nullable(),
  resolvedBy: userRoleRef.nullable(),
  resolvedAt: isoDate.nullable(),
});
export type ExtractedFieldDto = z.infer<typeof ExtractedField>;

export const ReviewDecision = z.object({
  id: uuid,
  action: z.enum(REVIEW_ACTIONS),
  fieldId: uuid.nullable(),
  reason: z.string(),
  actor: userRoleRef,
  createdAt: isoDate,
});

export const ImportDocumentDetail = ImportDocumentSummary.extend({
  reviewThreshold: z.number(),
  warnings: z.array(z.string()),
  providerName: z.string(),
  providerVersion: z.string(),
  fields: z.array(ExtractedField),
  decisions: z.array(ReviewDecision),
});
export type ImportDocumentDetailDto = z.infer<typeof ImportDocumentDetail>;

export const ImportBatchDetail = ImportBatch.extend({ documents: z.array(ImportDocumentSummary) });
export type ImportBatchDetailDto = z.infer<typeof ImportBatchDetail>;

export const ImportBatchesPage = z.object({ items: z.array(ImportBatch), page: z.int(), pageSize: z.int(), total: z.int() });

export const ReviewQueueItem = z.object({
  documentId: uuid,
  batchId: uuid,
  batchLabel: z.string().nullable(),
  displayName: z.string(),
  docType: z.enum(IMPORT_DOC_TYPES),
  reviewReasons: z.array(z.string()),
  flaggedFieldCount: z.int(),
  unresolvedFlaggedCount: z.int(),
  uploadedBy: userRef.nullable(),
  waitingSince: isoDate,
});
export type ReviewQueueItemDto = z.infer<typeof ReviewQueueItem>;
export const ReviewQueuePage = z.object({ items: z.array(ReviewQueueItem), page: z.int(), pageSize: z.int(), total: z.int() });

export const CommitResult = z.object({
  created: z.array(z.object({ claimId: uuid, claimNumber: z.string(), loadNumber: z.string() })),
  updated: z.array(
    z.object({
      claimId: uuid,
      claimNumber: z.string(),
      loadNumber: z.string(),
      note: z.enum(['documents_linked', 'new_evidence_not_in_packet']),
    }),
  ),
  skipped: z.array(z.object({ documentId: uuid, reason: z.enum(['not_accepted', 'missing_load_number', 'already_linked']) })),
});
export type CommitResultDto = z.infer<typeof CommitResult>;

export const ClaimDocumentItem = z.object({
  id: uuid,
  displayName: z.string(),
  docType: z.enum(IMPORT_DOC_TYPES),
  detectedType: z.enum(DETECTED_TYPES),
  sizeBytes: z.int(),
  sha256: z.string(),
  status: z.enum(IMPORT_DOC_STATUSES),
  linkedAt: isoDate,
});
export const ClaimDocumentsResponse = z.object({ items: z.array(ClaimDocumentItem) });
export type ClaimDocumentsResponseDto = z.infer<typeof ClaimDocumentsResponse>;

/** Claim statuses accepted by the claims filter (re-exported for the export query docs). */
export const EXPORT_CLAIM_STATUSES = CLAIM_STATUSES;
