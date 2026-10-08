/**
 * Commit accepted documents to claims (A9.3-A9.5, R52) and list a claim's documents (R53).
 *
 * One atomic transaction per call: lock the batch, take the ACCEPTED documents not yet linked, group
 * them by normalized load number (NFKC, whitespace collapsed, trimmed, upper-cased) and, per group:
 * create an AWAITING_ANALYSIS claim (no packet, zero amounts) or link to an existing claim of the same
 * perspective and load number (newest first). Existing claims that already have a packet are never
 * modified (documents are only linked; "new_evidence_not_in_packet"). Idempotent.
 */
import type { ClaimDocumentsResponseDto, CommitResultDto, Perspective } from '@fr/shared';
import { cpLength, cpSlice, sanitizeSingleLine } from '@fr/shared';

import { appendAudit } from '../audit/audit.js';
import { nextClaimNumber } from '../db/claim-numbers.js';
import { isUuid } from '../db/errors.js';
import { lockImportBatch } from '../db/import-locks.js';
import type { TenantTx } from '../db/tenant.js';
import { errors } from '../http/errors.js';

import type { Actor } from './deps.js';
import { effectiveValue, type FieldRow } from './dto.js';

const UNKNOWN = 'Unknown';
const LOAD_MAX = 100;

/** Grouping key of a load number. */
export function normalizeLoadNumber(v: string): string {
  return v.normalize('NFKC').replace(/\s+/gu, ' ').trim().toUpperCase();
}

/** `YYYY-MM-DD`, or the first ten characters of an ISO (`YYYY-MM-DD...`) or US (`MM/DD/YYYY...`) date. */
export function parseInvoiceDate(v: string | null): Date | null {
  if (!v) return null;
  const head = v.trim().slice(0, 10);
  let y: number;
  let m: number;
  let d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(head);
  const us = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(head);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (us) [y, m, d] = [Number(us[3]), Number(us[1]), Number(us[2])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && y >= 1 ? date : null;
}

function clean(v: string | null): string | null {
  if (v === null) return null;
  const s = sanitizeSingleLine(v, 200).value;
  return s === '' ? null : s;
}

interface DocInfo {
  id: string;
  docType: string;
  loadNumber: string;
  createdAt: Date;
  fields: FieldRow[];
}

function value(doc: DocInfo | undefined, key: string): string | null {
  if (!doc) return null;
  const f = doc.fields.find((x) => x.key === key && effectiveValue(x) !== null);
  return f ? effectiveValue(f) : null;
}

export async function commitBatch(tx: TenantTx, tenantId: string, batchId: string, perspective: Perspective, actor: Actor): Promise<CommitResultDto> {
  if (!isUuid(batchId)) throw errors.notFound();
  await lockImportBatch(tx, batchId);
  const batch = await tx.importBatch.findFirst({ where: { id: batchId }, select: { id: true } });
  if (!batch) throw errors.notFound();

  const docs = await tx.importDocument.findMany({
    where: { batchId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, status: true, docType: true, loadNumber: true, createdAt: true, claimLinks: { select: { id: true } } },
  });
  const result: CommitResultDto = { created: [], updated: [], skipped: [] };
  const eligible: (typeof docs)[number][] = [];
  for (const d of docs) {
    if (d.claimLinks.length > 0) result.skipped.push({ documentId: d.id, reason: 'already_linked' });
    else if (d.status !== 'ACCEPTED') result.skipped.push({ documentId: d.id, reason: 'not_accepted' });
    else if (!d.loadNumber) result.skipped.push({ documentId: d.id, reason: 'missing_load_number' });
    else eligible.push(d);
  }
  const fields = (await tx.extractedField.findMany({ where: { documentId: { in: eligible.map((d) => d.id) } } })) as (FieldRow & { documentId: string })[];

  const groups = new Map<string, DocInfo[]>();
  for (const d of eligible) {
    const load = d.loadNumber ?? '';
    const key = normalizeLoadNumber(load);
    const info: DocInfo = { id: d.id, docType: d.docType, loadNumber: load, createdAt: d.createdAt, fields: fields.filter((f) => f.documentId === d.id) };
    groups.set(key, [...(groups.get(key) ?? []), info]);
  }

  for (const [key, group] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const first = group[0];
    if (!first) continue;
    const loadNumber = cpLength(first.loadNumber.trim()) > LOAD_MAX ? cpSlice(first.loadNumber.trim(), LOAD_MAX) : first.loadNumber.trim();
    const invoice = group.find((d) => d.docType === 'INVOICE');
    const ratecon = group.find((d) => d.docType === 'RATE_CONFIRMATION');
    const extracted = {
      invoiceNumber: clean(value(invoice, 'invoice.invoice_number')),
      invoiceDate: parseInvoiceDate(value(invoice, 'invoice.invoice_date')),
      carrierName: clean(value(invoice, 'invoice.carrier') ?? value(ratecon, 'rate_confirmation.carrier')),
      shipperName: clean(value(invoice, 'invoice.shipper')),
    };
    const documentIds = group.map((d) => d.id);
    const candidates = await tx.claim.findMany({
      where: { perspective, loadNumber: { equals: loadNumber, mode: 'insensitive' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, claimNumber: true, status: true, loadNumber: true, invoiceNumber: true, invoiceDate: true, carrierName: true, shipperName: true },
    });
    const existing = candidates.find((c) => normalizeLoadNumber(c.loadNumber ?? '') === key);
    let claimId: string;
    if (!existing) {
      const claimNumber = await nextClaimNumber(tx, tenantId);
      const created = await tx.claim.create({
        data: {
          tenantId,
          claimNumber,
          loadNumber,
          invoiceNumber: extracted.invoiceNumber,
          invoiceDate: extracted.invoiceDate,
          carrierName: extracted.carrierName ?? UNKNOWN,
          shipperName: extracted.shipperName ?? UNKNOWN,
          perspective,
          status: 'AWAITING_ANALYSIS',
          amountClaimedCents: 0,
          recoverableCents: 0,
          pendingReviewCents: 0,
        },
        select: { id: true },
      });
      claimId = created.id;
      result.created.push({ claimId, claimNumber, loadNumber });
      await appendAudit(tx, {
        tenantId,
        action: 'claim.created_from_import',
        actorId: actor.userId,
        actorRole: actor.role,
        targetType: 'claim',
        targetId: claimId,
        metadata: { claimId, claimNumber, batchId, documentIds, perspective, status: 'AWAITING_ANALYSIS' },
        ip: actor.ip,
        requestId: actor.requestId,
      });
    } else {
      claimId = existing.id;
      const hasPacket = existing.status !== 'AWAITING_ANALYSIS' || (await tx.evidencePacket.count({ where: { claimId } })) > 0;
      if (!hasPacket) {
        const fill: Record<string, unknown> = {};
        if (existing.invoiceNumber === null && extracted.invoiceNumber) fill['invoiceNumber'] = extracted.invoiceNumber;
        if (existing.invoiceDate === null && extracted.invoiceDate) fill['invoiceDate'] = extracted.invoiceDate;
        if (existing.carrierName === UNKNOWN && extracted.carrierName) fill['carrierName'] = extracted.carrierName;
        if (existing.shipperName === UNKNOWN && extracted.shipperName) fill['shipperName'] = extracted.shipperName;
        if (Object.keys(fill).length > 0) await tx.claim.update({ where: { id: claimId }, data: { ...fill, version: { increment: 1 } } });
      }
      result.updated.push({ claimId, claimNumber: existing.claimNumber, loadNumber: existing.loadNumber ?? loadNumber, note: hasPacket ? 'new_evidence_not_in_packet' : 'documents_linked' });
      await appendAudit(tx, {
        tenantId,
        action: 'claim.documents_linked',
        actorId: actor.userId,
        actorRole: actor.role,
        targetType: 'claim',
        targetId: claimId,
        metadata: { claimId, claimNumber: existing.claimNumber, batchId, documentIds, hasPacket },
        ip: actor.ip,
        requestId: actor.requestId,
      });
    }
    await tx.claimDocument.createMany({ data: documentIds.map((documentId) => ({ tenantId, claimId, documentId, linkedById: actor.userId })) });
  }

  await appendAudit(tx, {
    tenantId,
    action: 'import.committed',
    actorId: actor.userId,
    actorRole: actor.role,
    targetType: 'import_batch',
    targetId: batchId,
    metadata: { batchId, perspective, created: result.created.length, updated: result.updated.length, skipped: result.skipped.length },
    ip: actor.ip,
    requestId: actor.requestId,
  });
  return result;
}

export async function claimDocuments(tx: TenantTx, claimId: string): Promise<ClaimDocumentsResponseDto> {
  if (!isUuid(claimId)) throw errors.notFound();
  const claim = await tx.claim.findFirst({ where: { id: claimId }, select: { id: true } });
  if (!claim) throw errors.notFound();
  const links = await tx.claimDocument.findMany({
    where: { claimId },
    orderBy: [{ linkedAt: 'asc' }, { id: 'asc' }],
    select: {
      linkedAt: true,
      document: { select: { id: true, displayName: true, docType: true, detectedType: true, sizeBytes: true, sha256: true, status: true } },
    },
  });
  return {
    items: links.map((l) => ({
      id: l.document.id,
      displayName: l.document.displayName,
      docType: l.document.docType,
      detectedType: l.document.detectedType,
      sizeBytes: l.document.sizeBytes,
      sha256: l.document.sha256,
      status: l.document.status,
      linkedAt: l.linkedAt.toISOString(),
    })),
  };
}
