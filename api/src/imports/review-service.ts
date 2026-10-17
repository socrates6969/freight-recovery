/**
 * Human review of imported documents (A9.1-A9.2, R46-R51). Every mutation is ONE tenant transaction
 * that row-locks the document (SELECT ... FOR UPDATE), checks the state (NEEDS_REVIEW), validates,
 * updates, inserts an append-only import_review_decisions row (reason as written, sanitized of
 * control/bidi characters by the request schema; only SHA-256 hashes of before/after values) and
 * appends the audit event. Accepted documents are immutable (DB trigger).
 */
import { createHash, randomUUID } from 'node:crypto';

import {
  FIELD_REVIEW_REASONS,
  LOAD_NUMBER_KEYS,
  fieldSpec,
  type DocReviewReason,
  type ImportDocumentDetailDto,
  type KnownDocType,
  type ReviewQueueItemDto,
} from '@fr/shared';

import { appendAudit } from '../audit/audit.js';
import { isUuid } from '../db/errors.js';
import { lockImportDocument } from '../db/import-locks.js';
import type { TenantDb, TenantTx } from '../db/tenant.js';
import { HttpError, errors } from '../http/errors.js';

import type { Actor, ImportDeps } from './deps.js';
import { effectiveValue, toReviewQueueItem, type FieldRow } from './dto.js';
import { PASSTHROUGH_REASONS, documentReviewReasons } from './parse/reasons.js';
import { DOC_SELECT, deleteObjectQuietly, documentDetail, loadDocument, type StoredDocument } from './service.js';
import { validateManualValue } from './values.js';

/** Reason recorded for R46 (the contract's request has no reason field). */
export const SET_TYPE_REASON = 'Document type set by a reviewer.';
const BLOCKING_FIELD_REASONS = new Set(['UNPARSEABLE_VALUE', 'CONFLICTING_VALUES']);

const hashValue = (v: string | null) => (v === null ? null : createHash('sha256').update(v, 'utf8').digest('hex'));

function audit(tx: TenantTx, doc: StoredDocument, actor: Actor, action: Parameters<typeof appendAudit>[1]['action'], metadata: Record<string, unknown>) {
  return appendAudit(tx, {
    tenantId: doc.tenantId,
    action,
    actorId: actor.userId,
    actorRole: actor.role,
    targetType: 'import_document',
    targetId: doc.id,
    metadata: { documentId: doc.id, batchId: doc.batchId, ...metadata },
    ip: actor.ip,
    requestId: actor.requestId,
  });
}

/** Lock + load a NEEDS_REVIEW document of the batch (404 unknown, 409 any other state). */
async function lockReviewable(tx: TenantTx, batchId: string, docId: string): Promise<StoredDocument> {
  if (!isUuid(batchId) || !isUuid(docId)) throw errors.notFound();
  if (!(await lockImportDocument(tx, docId))) throw errors.notFound();
  const doc = await loadDocument(tx, batchId, docId);
  if (doc.status !== 'NEEDS_REVIEW') throw errors.invalidState();
  return doc;
}

async function liveFields(tx: TenantTx, docId: string): Promise<FieldRow[]> {
  return (await tx.extractedField.findMany({ where: { documentId: docId } })) as FieldRow[];
}

/** Recompute the document's review reasons after a change (parser-only reasons are kept). */
async function refreshReasons(tx: TenantTx, doc: StoredDocument, docType: StoredDocument['docType']): Promise<void> {
  const fields = await liveFields(tx, doc.id);
  const passthrough = doc.reviewReasons.filter((r): r is DocReviewReason => PASSTHROUGH_REASONS.has(r as DocReviewReason));
  const reasons = documentReviewReasons({
    docType,
    detectedType: doc.detectedType,
    fields: fields.filter((f) => f.status !== 'REJECTED').map((f) => ({ key: f.key, value: effectiveValue(f), needsReview: f.needsReview })),
    passthrough,
  });
  await tx.importDocument.update({ where: { id: doc.id }, data: { reviewReasons: reasons } });
}

async function nextOrdinal(tx: TenantTx, docId: string): Promise<number> {
  const agg = await tx.extractedField.aggregate({ where: { documentId: docId }, _max: { ordinal: true } });
  return (agg._max.ordinal ?? -1) + 1;
}

// ---------------------------------------------------------------------------------------------
// R46 set document type
// ---------------------------------------------------------------------------------------------

export async function setDocType(
  db: TenantDb,
  batchId: string,
  docId: string,
  docType: KnownDocType,
  actor: Actor,
  threshold: number,
): Promise<ImportDocumentDetailDto> {
  return db.tx(async (tx) => {
    const doc = await lockReviewable(tx, batchId, docId);
    const extracted = await tx.extractedField.count({ where: { documentId: doc.id, origin: 'EXTRACTED' } });
    if (extracted > 0) throw errors.invalidState();
    const manual = await tx.extractedField.count({ where: { documentId: doc.id, status: { not: 'REJECTED' } } });
    if (manual > 0 && doc.docType !== docType) throw errors.invalidState();
    await tx.importDocument.update({ where: { id: doc.id }, data: { docType, docTypeBasis: 'MANUAL' } });
    await tx.importReviewDecision.create({
      data: { tenantId: doc.tenantId, documentId: doc.id, action: 'SET_TYPE', reason: SET_TYPE_REASON, actorId: actor.userId, actorRole: actor.role },
    });
    await refreshReasons(tx, doc, docType);
    await audit(tx, doc, actor, 'review.doctype_set', { docType, action: 'SET_TYPE' });
    return documentDetail(tx, batchId, docId, threshold);
  });
}

// ---------------------------------------------------------------------------------------------
// R47 add a manual field
// ---------------------------------------------------------------------------------------------

export async function addField(
  db: TenantDb,
  batchId: string,
  docId: string,
  input: { key: string; value: string; reason: string },
  actor: Actor,
  threshold: number,
) {
  return db.tx(async (tx) => {
    const doc = await lockReviewable(tx, batchId, docId);
    const spec = fieldSpec(input.key);
    if (!spec || doc.docType === 'OTHER' || spec.docType !== doc.docType) {
      throw errors.unprocessable('The field does not belong to this document type.');
    }
    const parsed = validateManualValue(input.key, spec.kind, input.value);
    if (!parsed) throw errors.validation([{ path: 'value', code: 'invalid_value' }]);
    const fields = await liveFields(tx, doc.id);
    const live = fields.filter((f) => f.key === input.key && f.status !== 'REJECTED');
    let groupIndex: number | null = null;
    if (spec.key === 'invoice.charge.description' || spec.key === 'invoice.charge.amount') {
      const used = new Set(live.map((f) => f.groupIndex ?? 0));
      const groups = fields.filter((f) => f.groupIndex !== null).map((f) => f.groupIndex ?? 0);
      const max = groups.length > 0 ? Math.max(...groups) : -1;
      groupIndex = 0;
      while (used.has(groupIndex) && groupIndex <= max + 1) groupIndex += 1;
    } else if (live.length > 0) {
      throw errors.invalidState();
    }
    const now = new Date();
    const id = randomUUID();
    await tx.extractedField.create({
      data: {
        id,
        tenantId: doc.tenantId,
        documentId: doc.id,
        key: input.key,
        groupIndex,
        ordinal: await nextOrdinal(tx, doc.id),
        kind: spec.kind,
        value: parsed.value,
        rawValue: parsed.raw,
        confidence: '1.000',
        needsReview: false,
        reviewReasons: [],
        status: 'CONFIRMED',
        origin: 'MANUAL',
        resolvedById: actor.userId,
        resolvedAt: now,
      },
    });
    await tx.importReviewDecision.create({
      data: {
        tenantId: doc.tenantId,
        documentId: doc.id,
        fieldId: id,
        action: 'ADD',
        reason: input.reason,
        afterValueSha256: hashValue(parsed.value),
        actorId: actor.userId,
        actorRole: actor.role,
      },
    });
    await refreshReasons(tx, doc, doc.docType);
    await audit(tx, doc, actor, 'review.field_added', { fieldId: id, fieldKey: input.key, groupIndex, action: 'ADD' });
    const detail = await documentDetail(tx, batchId, docId, threshold);
    const f = detail.fields.find((x) => x.id === id);
    if (!f) throw new HttpError(500, 'internal_error');
    return f;
  });
}

// ---------------------------------------------------------------------------------------------
// R48 resolve a field
// ---------------------------------------------------------------------------------------------

export async function resolveField(
  db: TenantDb,
  batchId: string,
  docId: string,
  fieldId: string,
  input: { action: 'CONFIRM' | 'CORRECT' | 'REJECT'; correctedValue?: string | undefined; reason: string },
  actor: Actor,
  threshold: number,
) {
  return db.tx(async (tx) => {
    const doc = await lockReviewable(tx, batchId, docId);
    if (!isUuid(fieldId)) throw errors.notFound();
    const field = (await tx.extractedField.findFirst({ where: { id: fieldId, documentId: doc.id } })) as FieldRow | null;
    if (!field) throw errors.notFound();
    if (field.status !== 'PROPOSED') throw errors.invalidState();
    let corrected: string | null = null;
    if (input.action === 'CORRECT') {
      const parsed = validateManualValue(field.key, field.kind, input.correctedValue ?? '');
      if (!parsed) throw errors.validation([{ path: 'correctedValue', code: 'invalid_value' }]);
      corrected = parsed.value;
    }
    const status = input.action === 'CONFIRM' ? 'CONFIRMED' : input.action === 'CORRECT' ? 'CORRECTED' : 'REJECTED';
    const before = effectiveValue(field);
    await tx.extractedField.update({
      where: { id: field.id },
      data: { status, correctedValue: corrected, resolvedById: actor.userId, resolvedAt: new Date() },
    });
    const after = effectiveValue({ status, value: field.value, correctedValue: corrected });
    await tx.importReviewDecision.create({
      data: {
        tenantId: doc.tenantId,
        documentId: doc.id,
        fieldId: field.id,
        action: input.action,
        reason: input.reason,
        beforeValueSha256: hashValue(before),
        afterValueSha256: hashValue(after),
        actorId: actor.userId,
        actorRole: actor.role,
      },
    });
    await refreshReasons(tx, doc, doc.docType);
    await audit(tx, doc, actor, 'review.field_resolved', { fieldId: field.id, fieldKey: field.key, action: input.action });
    const detail = await documentDetail(tx, batchId, docId, threshold);
    const f = detail.fields.find((x) => x.id === field.id);
    if (!f) throw new HttpError(500, 'internal_error');
    return f;
  });
}

// ---------------------------------------------------------------------------------------------
// R49 accept / R50 reject a document
// ---------------------------------------------------------------------------------------------

export async function acceptDocument(
  db: TenantDb,
  batchId: string,
  docId: string,
  input: { reason: string; confirmRemaining?: boolean | undefined },
  actor: Actor,
  threshold: number,
): Promise<ImportDocumentDetailDto> {
  return db.tx(async (tx) => {
    const doc = await lockReviewable(tx, batchId, docId);
    const fields = await liveFields(tx, doc.id);
    const unresolved = fields.filter((f) => f.needsReview && f.status === 'PROPOSED');
    const hardBlocked = unresolved.some((f) => f.reviewReasons.some((r) => BLOCKING_FIELD_REASONS.has(r)));
    if (hardBlocked || (unresolved.length > 0 && input.confirmRemaining !== true)) throw errors.unresolvedFields();
    // Type unknown / image without keyed fields / no load number block until resolved by the reviewer.
    if (doc.docType === 'OTHER') throw errors.unresolvedFields();
    const live = fields.filter((f) => f.status !== 'REJECTED');
    if (live.length === 0) throw errors.unresolvedFields();
    const loadKey = LOAD_NUMBER_KEYS[doc.docType];
    const loadField = live.find((f) => f.key === loadKey && effectiveValue(f) !== null);
    const loadNumber = loadField ? effectiveValue(loadField) : null;
    if (!loadNumber) throw errors.unresolvedFields();

    const now = new Date();
    for (const f of unresolved) {
      await tx.extractedField.update({ where: { id: f.id }, data: { status: 'CONFIRMED', resolvedById: actor.userId, resolvedAt: now } });
      await tx.importReviewDecision.create({
        data: {
          tenantId: doc.tenantId,
          documentId: doc.id,
          fieldId: f.id,
          action: 'CONFIRM',
          reason: input.reason,
          beforeValueSha256: hashValue(effectiveValue(f)),
          afterValueSha256: hashValue(effectiveValue(f)),
          actorId: actor.userId,
          actorRole: actor.role,
        },
      });
    }
    await tx.importDocument.update({ where: { id: doc.id }, data: { status: 'ACCEPTED', loadNumber } });
    await tx.importReviewDecision.create({
      data: { tenantId: doc.tenantId, documentId: doc.id, action: 'ACCEPT', reason: input.reason, actorId: actor.userId, actorRole: actor.role },
    });
    await audit(tx, doc, actor, 'review.document_accepted', {
      action: 'ACCEPT',
      confirmedCount: unresolved.length,
      fromStatus: 'NEEDS_REVIEW',
      toStatus: 'ACCEPTED',
      reason: input.reason,
    });
    return documentDetail(tx, batchId, docId, threshold);
  });
}

export async function rejectDocument(
  deps: ImportDeps,
  db: TenantDb,
  batchId: string,
  docId: string,
  input: { reason: string },
  actor: Actor,
  threshold: number,
): Promise<ImportDocumentDetailDto> {
  const { detail, keys, tenantId } = await db.tx(async (tx) => {
    const doc = await lockReviewable(tx, batchId, docId);
    await tx.importDocument.update({
      where: { id: doc.id },
      data: { status: 'REJECTED', rejectReason: 'reviewer_rejected', storageKey: null, textKey: null },
    });
    await tx.importReviewDecision.create({
      data: { tenantId: doc.tenantId, documentId: doc.id, action: 'REJECT_DOC', reason: input.reason, actorId: actor.userId, actorRole: actor.role },
    });
    await audit(tx, doc, actor, 'review.document_rejected', {
      action: 'REJECT_DOC',
      reasonCode: 'reviewer_rejected',
      fromStatus: 'NEEDS_REVIEW',
      toStatus: 'REJECTED',
      reason: input.reason,
    });
    return { detail: await documentDetail(tx, batchId, docId, threshold), keys: [doc.storageKey, doc.textKey], tenantId: doc.tenantId };
  });
  for (const k of keys) await deleteObjectQuietly(deps, tenantId, k);
  return detail;
}

// ---------------------------------------------------------------------------------------------
// R51 review queue
// ---------------------------------------------------------------------------------------------

export async function reviewQueue(tx: TenantTx, page: number, pageSize: number): Promise<{ items: ReviewQueueItemDto[]; page: number; pageSize: number; total: number }> {
  const where = { status: 'NEEDS_REVIEW' as const };
  const total = await tx.importDocument.count({ where });
  const docs = await tx.importDocument.findMany({
    where,
    orderBy: [{ parsedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: { ...DOC_SELECT, batch: { select: { label: true } }, uploadedBy: { select: { id: true, name: true } } },
  });
  const fields = (await tx.extractedField.findMany({ where: { documentId: { in: docs.map((d) => d.id) } } })) as (FieldRow & { documentId: string })[];
  return {
    items: docs.map((d) => toReviewQueueItem(d as StoredDocument & { batch: { label: string | null }; uploadedBy: { id: string; name: string } | null }, fields.filter((f) => f.documentId === d.id))),
    page,
    pageSize,
    total,
  };
}

/** Field reasons in fixed order (exported for tests). */
export const FIELD_REASON_ORDER = FIELD_REVIEW_REASONS;
