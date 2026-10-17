/**
 * Import service (A7): batches, the synchronous upload pipeline `ingestDocument` (pre-flight -> store ->
 * sandboxed parse -> persist), the stale-RECEIVED reaper, document detail and the proxied, integrity-
 * checked download. Every state change commits together with its audit event; object writes happen
 * outside database transactions (no transaction is held across slow I/O).
 */
import { createHash, randomUUID } from 'node:crypto';
import { Transform, type Readable, type TransformCallback } from 'node:stream';

import { DOC_REVIEW_REASONS, type DetectedType, type DocReviewReason, type ImportBatchDto, type ImportDocumentDetailDto } from '@fr/shared';

import { appendAudit } from '../audit/audit.js';
import { isUuid } from '../db/errors.js';
import { lockImportBatch } from '../db/import-locks.js';
import type { TenantDb, TenantTx } from '../db/tenant.js';
import { errors } from '../http/errors.js';
import { isKeyInTenant, tenantKey } from '../storage/s3.js';

import type { Actor, ImportDeps, IngestActor } from './deps.js';
import { toBatchDto, toDetailDto, toSummaryDto, type DecisionRow, type DocumentRow, type FieldRow } from './dto.js';
import { PARSER_VERSION, PROVIDER_NAME, PROVIDER_VERSION } from './parse/types.js';
import { ParserBusyError } from './sandbox/executor.js';

export const DOC_SELECT = {
  id: true,
  tenantId: true,
  batchId: true,
  displayName: true,
  detectedType: true,
  sizeBytes: true,
  sha256: true,
  storageKey: true,
  textKey: true,
  docType: true,
  docTypeBasis: true,
  status: true,
  rejectReason: true,
  reviewReasons: true,
  warnings: true,
  pageCount: true,
  loadNumber: true,
  providerName: true,
  providerVersion: true,
  createdAt: true,
  updatedAt: true,
  parsedAt: true,
} as const;

export type StoredDocument = DocumentRow & { tenantId: string; storageKey: string | null; textKey: string | null };

const BATCH_INCLUDE = { createdBy: { select: { id: true, name: true } }, _count: { select: { documents: true } } } as const;

function auditActor(actor: IngestActor | Actor): { actorId: string | null; actorRole: string | null; ip: string | null; requestId: string } {
  if ('kind' in actor) {
    return actor.kind === 'user'
      ? { actorId: actor.id, actorRole: actor.role, ip: actor.ip, requestId: actor.requestId }
      : { actorId: null, actorRole: `system:${actor.name}`, ip: null, requestId: actor.requestId };
  }
  return { actorId: actor.userId, actorRole: actor.role, ip: actor.ip, requestId: actor.requestId };
}

// ---------------------------------------------------------------------------------------------
// Batches (R40-R42)
// ---------------------------------------------------------------------------------------------

export async function createBatch(tx: TenantTx, tenantId: string, label: string | undefined, actor: Actor): Promise<ImportBatchDto> {
  const b = await tx.importBatch.create({ data: { tenantId, label: label ?? null, createdById: actor.userId }, include: BATCH_INCLUDE });
  await appendAudit(tx, {
    tenantId,
    action: 'import.batch_created',
    ...auditActor(actor),
    targetType: 'import_batch',
    targetId: b.id,
    metadata: { batchId: b.id },
  });
  return toBatchDto(b);
}

export async function listBatches(tx: TenantTx, page: number, pageSize: number): Promise<{ items: ImportBatchDto[]; page: number; pageSize: number; total: number }> {
  const total = await tx.importBatch.count();
  const rows = await tx.importBatch.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: BATCH_INCLUDE,
  });
  return { items: rows.map(toBatchDto), page, pageSize, total };
}

async function findBatch(tx: TenantTx, batchId: string) {
  if (!isUuid(batchId)) throw errors.notFound();
  const b = await tx.importBatch.findFirst({ where: { id: batchId }, include: BATCH_INCLUDE });
  if (!b) throw errors.notFound();
  return b;
}

export async function getBatchDetail(tx: TenantTx, batchId: string) {
  const b = await findBatch(tx, batchId);
  const docs = (await tx.importDocument.findMany({
    where: { batchId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: DOC_SELECT,
  })) as StoredDocument[];
  const fields = (await tx.extractedField.findMany({ where: { documentId: { in: docs.map((d) => d.id) } } })) as (FieldRow & { documentId: string })[];
  return {
    ...toBatchDto(b),
    documents: docs.map((d) => toSummaryDto(d, fields.filter((f) => f.documentId === d.id))),
  };
}

// ---------------------------------------------------------------------------------------------
// Document detail (R44) and loaders
// ---------------------------------------------------------------------------------------------

export async function loadDocument(tx: TenantTx, batchId: string, docId: string): Promise<StoredDocument> {
  if (!isUuid(batchId) || !isUuid(docId)) throw errors.notFound();
  const d = await tx.importDocument.findFirst({ where: { id: docId, batchId }, select: DOC_SELECT });
  if (!d) throw errors.notFound();
  return d as StoredDocument;
}

export async function loadFieldsAndDecisions(tx: TenantTx, docId: string): Promise<{ fields: FieldRow[]; decisions: DecisionRow[] }> {
  const fields = (await tx.extractedField.findMany({ where: { documentId: docId }, orderBy: [{ ordinal: 'asc' }, { createdAt: 'asc' }] })) as FieldRow[];
  const decisions = (await tx.importReviewDecision.findMany({
    where: { documentId: docId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { actor: { select: { id: true, name: true } } },
  })) as DecisionRow[];
  return { fields, decisions };
}

export async function documentDetail(tx: TenantTx, batchId: string, docId: string, threshold: number): Promise<ImportDocumentDetailDto> {
  const d = await loadDocument(tx, batchId, docId);
  const { fields, decisions } = await loadFieldsAndDecisions(tx, d.id);
  return toDetailDto(d, fields, decisions, threshold);
}

// ---------------------------------------------------------------------------------------------
// Object cleanup helpers
// ---------------------------------------------------------------------------------------------

/** Best-effort delete with one retry; failures are logged (the stale reaper/lifecycle sweep leftovers). */
export async function deleteObjectQuietly(deps: ImportDeps, tenantId: string, key: string | null): Promise<void> {
  if (!key) return;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await deps.store.deleteObject(tenantId, key);
      return;
    } catch {
      // retry once
    }
  }
  deps.log.warn({ event: 'import_object_delete_failed' }, 'object delete failed');
}

async function markFailed(deps: ImportDeps, db: TenantDb, docId: string, reasonCode: string, actor: IngestActor | Actor): Promise<void> {
  await db.tx(async (tx) => {
    const d = await tx.importDocument.findFirst({ where: { id: docId }, select: { id: true, batchId: true, status: true, tenantId: true } });
    if (!d || d.status !== 'RECEIVED') return;
    await tx.importDocument.update({ where: { id: docId }, data: { status: 'FAILED', storageKey: null, textKey: null } });
    await appendAudit(tx, {
      tenantId: d.tenantId,
      action: 'import.document_rejected',
      ...auditActor(actor),
      targetType: 'import_document',
      targetId: docId,
      metadata: { documentId: docId, batchId: d.batchId, reasonCode, status: 'FAILED' },
    });
  });
}

/** Reaper (A7): RECEIVED documents of the batch older than IMPORT_STALE_SECONDS become FAILED. */
export async function reapStale(deps: ImportDeps, db: TenantDb, batchId: string, actor: Actor): Promise<number> {
  if (!isUuid(batchId)) return 0;
  const cutoff = new Date(deps.now().getTime() - deps.cfg.imports.staleSeconds * 1000);
  const reaped = await db.tx(async (tx) => {
    const stale = await tx.importDocument.findMany({
      where: { batchId, status: 'RECEIVED', createdAt: { lt: cutoff } },
      select: { id: true, tenantId: true, storageKey: true, textKey: true },
    });
    for (const d of stale) {
      await tx.importDocument.update({ where: { id: d.id }, data: { status: 'FAILED', storageKey: null, textKey: null } });
      await appendAudit(tx, {
        tenantId: d.tenantId,
        action: 'import.document_rejected',
        ...auditActor(actor),
        targetType: 'import_document',
        targetId: d.id,
        metadata: { documentId: d.id, batchId, reasonCode: 'parse_failed', status: 'FAILED' },
      });
    }
    return stale;
  });
  for (const d of reaped) {
    await deleteObjectQuietly(deps, d.tenantId, d.storageKey);
    await deleteObjectQuietly(deps, d.tenantId, d.textKey);
  }
  return reaped.length;
}

// ---------------------------------------------------------------------------------------------
// Ingest (R43; also the future email worker)
// ---------------------------------------------------------------------------------------------

export interface PrestoreRejection {
  reasonCode: string;
  sizeBytes?: number;
  sha256?: string;
}

/** Audit a rejection that happens before any document row exists (413/415/409/422). */
export async function auditPrestoreRejection(db: TenantDb, tenantId: string, batchId: string, actor: IngestActor | Actor, r: PrestoreRejection): Promise<void> {
  await db.tx(async (tx) => {
    await appendAudit(tx, {
      tenantId,
      action: 'import.document_rejected',
      ...auditActor(actor),
      targetType: 'import_batch',
      targetId: batchId,
      metadata: {
        documentId: null,
        batchId,
        reasonCode: r.reasonCode,
        ...(r.sizeBytes !== undefined ? { sizeBytes: r.sizeBytes } : {}),
        ...(r.sha256 ? { sha256Prefix: r.sha256.slice(0, 12) } : {}),
      },
    });
  });
}

/** Pre-flight before reading the body: the batch exists in the tenant and is not full. */
export async function assertBatchAcceptsUploads(db: TenantDb, batchId: string, maxFiles: number): Promise<void> {
  await db.tx(async (tx) => {
    const b = await findBatch(tx, batchId);
    if (b._count.documents >= maxFiles) throw errors.batchFull();
  });
}

export interface IngestInput {
  tenantId: string;
  actor: IngestActor;
  batchId: string;
  displayName: string;
  detectedType: DetectedType;
  bytes: Uint8Array;
  sha256: string;
  source: 'UPLOAD' | 'EMAIL';
  sourceRef?: string;
}

function sortDocReasons(rs: Iterable<string>): DocReviewReason[] {
  const set = new Set(rs);
  return DOC_REVIEW_REASONS.filter((r) => set.has(r));
}

/**
 * Store, parse and persist one already-sniffed document. Returns the final detail (status ACCEPTED,
 * NEEDS_REVIEW, REJECTED or FAILED). Throws HttpErrors for the 409/422/503 cases of N4.
 */
export async function ingestDocument(deps: ImportDeps, db: TenantDb, input: IngestInput): Promise<ImportDocumentDetailDto> {
  const { tenantId, batchId, actor } = input;
  const cfg = deps.cfg.imports;
  const docId = randomUUID();
  const storageKey = tenantKey(tenantId, 'imports', batchId, docId, 'original');
  const sizeBytes = input.bytes.byteLength;
  const started = Date.now();

  // Transaction 1: capacity, duplicate, quota; insert RECEIVED + audit. Commit before any slow I/O.
  const pre = await db.tx(async (tx) => {
    await lockImportBatch(tx, batchId);
    const batch = await tx.importBatch.findFirst({ where: { id: batchId }, include: { _count: { select: { documents: true } } } });
    if (!batch) return { kind: 'missing' as const };
    const reject = async (reasonCode: string) => {
      await appendAudit(tx, {
        tenantId,
        action: 'import.document_rejected',
        ...auditActor(actor),
        targetType: 'import_batch',
        targetId: batchId,
        metadata: { documentId: null, batchId, reasonCode, sizeBytes, sha256Prefix: input.sha256.slice(0, 12) },
      });
    };
    if (batch._count.documents >= cfg.maxFilesPerBatch) {
      await reject('batch_full');
      return { kind: 'full' as const };
    }
    const dup = await tx.importDocument.findFirst({ where: { batchId, sha256: input.sha256 }, select: { id: true } });
    if (dup) {
      await reject('conflict');
      return { kind: 'conflict' as const };
    }
    const used = await tx.importDocument.aggregate({ _sum: { sizeBytes: true }, where: { status: { not: 'REJECTED' } } });
    if (Number(used._sum.sizeBytes ?? 0) + sizeBytes > cfg.tenantStorageQuotaBytes) {
      await reject('quota_exceeded');
      return { kind: 'quota' as const };
    }
    const earlier = await tx.importDocument.findFirst({
      where: { sha256: input.sha256, status: { notIn: ['REJECTED', 'FAILED'] }, batchId: { not: batchId } },
      select: { id: true },
    });
    await tx.importDocument.create({
      data: {
        id: docId,
        tenantId,
        batchId,
        uploadedById: actor.kind === 'user' ? actor.id : null,
        source: input.source,
        sourceRef: input.sourceRef ?? null,
        displayName: input.displayName,
        detectedType: input.detectedType,
        sizeBytes,
        sha256: input.sha256,
        storageKey,
        docType: 'OTHER',
        docTypeBasis: 'NONE',
        status: 'RECEIVED',
        reviewReasons: [],
        warnings: [],
        providerName: PROVIDER_NAME,
        providerVersion: PROVIDER_VERSION,
        parserVersion: PARSER_VERSION,
      },
    });
    await appendAudit(tx, {
      tenantId,
      action: 'import.document_received',
      ...auditActor(actor),
      targetType: 'import_document',
      targetId: docId,
      metadata: { documentId: docId, batchId, sizeBytes, sha256Prefix: input.sha256.slice(0, 12), detectedType: input.detectedType },
    });
    return { kind: 'ok' as const, duplicateOfEarlier: earlier !== null };
  });
  if (pre.kind === 'missing') throw errors.notFound();
  if (pre.kind === 'full') throw errors.batchFull();
  if (pre.kind === 'conflict') throw errors.conflict();
  if (pre.kind === 'quota') throw errors.quotaExceeded();

  const detail = () => db.tx((tx) => documentDetail(tx, batchId, docId, cfg.reviewConfidenceThreshold));

  // Store the original (SSE, checksum; verified in production).
  try {
    await deps.store.putObject(tenantId, storageKey, input.bytes, { sha256Hex: input.sha256, contentLength: sizeBytes });
    if (deps.verifyWrites) await deps.store.verifyStored(tenantId, storageKey, sizeBytes);
  } catch {
    deps.log.error({ event: 'import_store_failed', documentId: docId }, 'object store write failed');
    await deleteObjectQuietly(deps, tenantId, storageKey);
    await markFailed(deps, db, docId, 'storage_unavailable', actor);
    return detail();
  }

  // Parse in the sandbox.
  let outcome;
  try {
    outcome = await deps.executor.run({ bytes: input.bytes, filename: input.displayName, detectedType: input.detectedType });
  } catch (e) {
    await markFailed(deps, db, docId, e instanceof ParserBusyError ? 'parser_busy' : 'parse_failed', actor);
    await deleteObjectQuietly(deps, tenantId, storageKey);
    if (e instanceof ParserBusyError) throw errors.parserBusy();
    return detail();
  }

  if (!outcome.ok) {
    const reason = outcome.reason;
    await db.tx(async (tx) => {
      await tx.importDocument.update({ where: { id: docId }, data: { status: 'REJECTED', rejectReason: reason, storageKey: null } });
      await appendAudit(tx, {
        tenantId,
        action: 'import.document_rejected',
        ...auditActor(actor),
        targetType: 'import_document',
        targetId: docId,
        metadata: { documentId: docId, batchId, reasonCode: reason, status: 'REJECTED', durationMs: Date.now() - started },
      });
    });
    await deleteObjectQuietly(deps, tenantId, storageKey);
    return detail();
  }

  const result = outcome.result;
  let textKey: string | null = null;
  if (result.text.length > 0) {
    textKey = tenantKey(tenantId, 'imports', batchId, docId, 'text');
    const textBytes = new TextEncoder().encode(result.text);
    try {
      await deps.store.putObject(tenantId, textKey, textBytes, {
        sha256Hex: createHash('sha256').update(textBytes).digest('hex'),
        contentLength: textBytes.byteLength,
      });
      if (deps.verifyWrites) await deps.store.verifyStored(tenantId, textKey, textBytes.byteLength);
    } catch {
      deps.log.error({ event: 'import_store_failed', documentId: docId }, 'object store write failed');
      await deleteObjectQuietly(deps, tenantId, textKey);
      await deleteObjectQuietly(deps, tenantId, storageKey);
      await markFailed(deps, db, docId, 'storage_unavailable', actor);
      return detail();
    }
  }

  const reviewReasons = sortDocReasons([...result.reviewReasons, ...(pre.duplicateOfEarlier ? ['DUPLICATE_OF_EARLIER'] : [])]);
  const status = reviewReasons.length === 0 ? 'ACCEPTED' : 'NEEDS_REVIEW';
  const flagged = result.fields.filter((f) => f.needsReview).length;
  try {
    await db.tx(async (tx) => {
      await tx.importDocument.update({
        where: { id: docId },
        data: {
          status,
          docType: result.docType,
          docTypeBasis: result.docTypeBasis,
          pageCount: result.pageCount,
          charCount: result.charCount,
          loadNumber: result.loadNumber,
          reviewReasons,
          warnings: result.warnings,
          providerName: result.providerName,
          providerVersion: result.providerVersion,
          parserVersion: result.parserVersion,
          textKey,
          parsedAt: deps.now(),
        },
      });
      if (result.fields.length > 0) {
        await tx.extractedField.createMany({
          data: result.fields.map((f, ordinal) => ({
            tenantId,
            documentId: docId,
            key: f.key,
            groupIndex: f.groupIndex,
            ordinal,
            kind: f.kind,
            value: f.value,
            rawValue: f.rawValue,
            confidence: f.confidence.toFixed(3),
            needsReview: f.needsReview,
            reviewReasons: f.reviewReasons,
            origin: 'EXTRACTED' as const,
            page: f.source.page,
            line: f.source.line,
            startCol: f.source.start,
            endCol: f.source.end,
            sourceRow: f.source.row,
            excerpt: f.source.excerpt,
          })),
        });
      }
      await appendAudit(tx, {
        tenantId,
        action: 'import.document_parsed',
        ...auditActor(actor),
        targetType: 'import_document',
        targetId: docId,
        metadata: {
          documentId: docId,
          batchId,
          status,
          docType: result.docType,
          docTypeBasis: result.docTypeBasis,
          fieldCount: result.fields.length,
          flaggedCount: flagged,
          reviewReasons,
          durationMs: Date.now() - started,
        },
      });
    });
  } catch {
    deps.log.error({ event: 'import_persist_failed', documentId: docId }, 'persisting the parse result failed');
    await deleteObjectQuietly(deps, tenantId, textKey);
    await deleteObjectQuietly(deps, tenantId, storageKey);
    await markFailed(deps, db, docId, 'parse_failed', actor);
    return detail();
  }
  return detail();
}

// ---------------------------------------------------------------------------------------------
// Download (R45)
// ---------------------------------------------------------------------------------------------

const DOWNLOAD_EXT: Readonly<Record<string, string>> = { PDF: 'pdf', PNG: 'png', JPEG: 'jpg', CSV: 'csv', TXT: 'txt' };

/**
 * Pass-through that hashes the bytes and holds back the LAST chunk until the digest is verified: a
 * mismatching object never completes (the stream errors and the connection is destroyed).
 */
export class VerifyingStream extends Transform {
  private readonly hash = createHash('sha256');
  private held: Buffer | null = null;

  constructor(
    private readonly expected: string,
    private readonly onMismatch: () => void,
  ) {
    super();
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.hash.update(chunk);
    if (this.held) this.push(this.held);
    this.held = chunk;
    cb();
  }

  override _flush(cb: TransformCallback): void {
    if (this.hash.digest('hex') !== this.expected) {
      this.onMismatch();
      cb(new Error('integrity check failed'));
      return;
    }
    if (this.held) this.push(this.held);
    cb();
  }
}

export async function prepareDownload(
  deps: ImportDeps,
  db: TenantDb,
  tenantId: string,
  batchId: string,
  docId: string,
  actor: Actor,
): Promise<{ stream: Readable; filename: string }> {
  const d = await db.tx(async (tx) => {
    const doc = await loadDocument(tx, batchId, docId);
    if ((doc.status !== 'ACCEPTED' && doc.status !== 'NEEDS_REVIEW') || !doc.storageKey) throw errors.invalidState();
    // Defense in depth, independent of RLS: the key must be under the caller's tenant prefix.
    if (!isKeyInTenant(doc.storageKey, tenantId)) {
      deps.log.error({ event: 'import_key_tenant_mismatch', documentId: doc.id }, 'storage key outside tenant prefix');
      throw errors.notFound();
    }
    await appendAudit(tx, {
      tenantId,
      action: 'import.document_downloaded',
      ...auditActor(actor),
      targetType: 'import_document',
      targetId: doc.id,
      metadata: { documentId: doc.id, batchId: doc.batchId },
    });
    return doc;
  });
  const { stream } = await deps.store.getObjectStream(tenantId, d.storageKey ?? '');
  const verified = new VerifyingStream(d.sha256, () => {
    deps.log.error({ event: 'import_integrity_alert', documentId: d.id }, 'stored object hash differs from the recorded sha256');
  });
  stream.on('error', (e) => verified.destroy(e));
  return {
    stream: stream.pipe(verified),
    filename: `document-${d.id.replace(/-/gu, '').slice(0, 8)}.${DOWNLOAD_EXT[d.detectedType] ?? 'bin'}`,
  };
}
