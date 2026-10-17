/**
 * Row -> DTO mapping for imports (N4). Structural row types (handlers never see Prisma types).
 */
import type {
  ExtractedFieldDto,
  ImportBatchDto,
  ImportDocumentDetailDto,
  ImportDocumentSummaryDto,
  ReviewQueueItemDto,
} from '@fr/shared';
import { FIELD_SPECS } from '@fr/shared';

export interface BatchRow {
  id: string;
  label: string | null;
  source: 'UPLOAD' | 'EMAIL';
  createdAt: Date;
  createdBy: { id: string; name: string };
  _count: { documents: number };
}

export interface FieldRow {
  id: string;
  key: string;
  groupIndex: number | null;
  ordinal: number;
  kind: 'STRING' | 'DECIMAL' | 'DATETIME' | 'STRING_LIST';
  value: string | null;
  rawValue: string;
  correctedValue: string | null;
  confidence: { toString(): string } | number;
  needsReview: boolean;
  reviewReasons: string[];
  status: 'PROPOSED' | 'CONFIRMED' | 'CORRECTED' | 'REJECTED';
  origin: 'EXTRACTED' | 'MANUAL';
  page: number | null;
  line: number | null;
  startCol: number | null;
  endCol: number | null;
  sourceRow: number | null;
  excerpt: string | null;
  resolvedById: string | null;
  resolvedAt: Date | null;
}

export interface DecisionRow {
  id: string;
  action: 'CONFIRM' | 'CORRECT' | 'REJECT' | 'ADD' | 'SET_TYPE' | 'ACCEPT' | 'REJECT_DOC';
  fieldId: string | null;
  reason: string;
  actorRole: string;
  createdAt: Date;
  actor: { id: string; name: string };
}

export interface DocumentRow {
  id: string;
  batchId: string;
  displayName: string;
  detectedType: 'PDF' | 'PNG' | 'JPEG' | 'CSV' | 'TXT';
  sizeBytes: number;
  sha256: string;
  docType: 'INVOICE' | 'RATE_CONFIRMATION' | 'BILL_OF_LADING' | 'OTHER';
  docTypeBasis: 'HEADER' | 'KEYS' | 'FILENAME' | 'MANUAL' | 'NONE';
  status: 'RECEIVED' | 'NEEDS_REVIEW' | 'ACCEPTED' | 'REJECTED' | 'FAILED';
  rejectReason: string | null;
  reviewReasons: string[];
  warnings: string[];
  pageCount: number | null;
  loadNumber: string | null;
  providerName: string;
  providerVersion: string;
  createdAt: Date;
  updatedAt: Date;
  parsedAt: Date | null;
}

export function toBatchDto(b: BatchRow): ImportBatchDto {
  return {
    id: b.id,
    label: b.label,
    source: b.source,
    documentCount: b._count.documents,
    createdBy: { id: b.createdBy.id, name: b.createdBy.name },
    createdAt: b.createdAt.toISOString(),
  };
}

const KEY_ORDER = new Map(FIELD_SPECS.map((f, i) => [f.key, i]));

/** Sort fields by N7 key order, then group index (the DTO order). */
export function sortFields<T extends { key: string; groupIndex: number | null; ordinal?: number }>(fields: T[]): T[] {
  return [...fields].sort(
    (a, b) => (KEY_ORDER.get(a.key) ?? 99) - (KEY_ORDER.get(b.key) ?? 99) || (a.groupIndex ?? 0) - (b.groupIndex ?? 0) || (a.ordinal ?? 0) - (b.ordinal ?? 0),
  );
}

/** correctedValue if CORRECTED, null if REJECTED, else value. */
export function effectiveValue(f: Pick<FieldRow, 'status' | 'value' | 'correctedValue'>): string | null {
  if (f.status === 'CORRECTED') return f.correctedValue;
  if (f.status === 'REJECTED') return null;
  return f.value;
}

export function fieldCounts(fields: readonly Pick<FieldRow, 'needsReview' | 'status' | 'confidence'>[]) {
  const flagged = fields.filter((f) => f.needsReview);
  const confidences = fields.map((f) => Number(f.confidence.toString()));
  return {
    fieldCount: fields.length,
    flaggedFieldCount: flagged.length,
    unresolvedFlaggedCount: flagged.filter((f) => f.status === 'PROPOSED').length,
    minConfidence: confidences.length > 0 ? Math.min(...confidences) : null,
  };
}

export function toFieldDto(f: FieldRow, decisions: readonly DecisionRow[]): ExtractedFieldDto {
  const resolution = decisions.find((d) => d.fieldId === f.id && (d.action === 'CONFIRM' || d.action === 'CORRECT' || d.action === 'REJECT' || d.action === 'ADD'));
  return {
    id: f.id,
    key: f.key,
    groupIndex: f.groupIndex,
    kind: f.kind,
    value: f.value,
    correctedValue: f.correctedValue,
    effectiveValue: effectiveValue(f),
    rawValue: f.rawValue,
    confidence: Math.round(Number(f.confidence.toString()) * 1000) / 1000,
    needsReview: f.needsReview,
    reviewReasons: f.reviewReasons,
    status: f.status,
    origin: f.origin,
    source:
      f.origin === 'MANUAL' || f.line === null
        ? null
        : { page: f.page, line: f.line, start: f.startCol ?? 0, end: f.endCol ?? 0, row: f.sourceRow, excerpt: f.excerpt ?? '' },
    resolvedBy: f.resolvedById && resolution ? { id: resolution.actor.id, name: resolution.actor.name, role: resolution.actorRole } : null,
    resolvedAt: f.resolvedAt ? f.resolvedAt.toISOString() : null,
  };
}

export function toSummaryDto(d: DocumentRow, fields: readonly FieldRow[]): ImportDocumentSummaryDto {
  return {
    id: d.id,
    batchId: d.batchId,
    displayName: d.displayName,
    detectedType: d.detectedType,
    sizeBytes: d.sizeBytes,
    sha256: d.sha256,
    docType: d.docType,
    docTypeBasis: d.docTypeBasis,
    status: d.status,
    rejectReason: d.rejectReason,
    reviewReasons: d.reviewReasons,
    ...fieldCounts(fields),
    loadNumber: d.loadNumber,
    pageCount: d.pageCount,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export function toDetailDto(d: DocumentRow, fields: readonly FieldRow[], decisions: readonly DecisionRow[], threshold: number): ImportDocumentDetailDto {
  const newestFirst = [...decisions].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
  return {
    ...toSummaryDto(d, fields),
    reviewThreshold: threshold,
    warnings: d.warnings,
    providerName: d.providerName,
    providerVersion: d.providerVersion,
    fields: sortFields([...fields]).map((f) => toFieldDto(f, newestFirst)),
    decisions: newestFirst.map((x) => ({
      id: x.id,
      action: x.action,
      fieldId: x.fieldId,
      reason: x.reason,
      actor: { id: x.actor.id, name: x.actor.name, role: x.actorRole },
      createdAt: x.createdAt.toISOString(),
    })),
  };
}

export function toReviewQueueItem(
  d: DocumentRow & { batch: { label: string | null }; uploadedBy: { id: string; name: string } | null },
  fields: readonly FieldRow[],
): ReviewQueueItemDto {
  const c = fieldCounts(fields);
  return {
    documentId: d.id,
    batchId: d.batchId,
    batchLabel: d.batch.label,
    displayName: d.displayName,
    docType: d.docType,
    reviewReasons: d.reviewReasons,
    flaggedFieldCount: c.flaggedFieldCount,
    unresolvedFlaggedCount: c.unresolvedFlaggedCount,
    uploadedBy: d.uploadedBy ? { id: d.uploadedBy.id, name: d.uploadedBy.name } : null,
    waitingSince: (d.parsedAt ?? d.createdAt).toISOString(),
  };
}
