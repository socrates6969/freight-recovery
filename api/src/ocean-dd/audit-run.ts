/**
 * Step 8 D&D audit run (REQ-20261011-ocean-dd, spec A3.2, Part C C12, C15, C17).
 *
 * route -> lock invoice row -> re-check DRAFT -> load tariff/calendar (same tx) -> buildDdPacket (engine,
 * persistability, sources, citations, CFR clauses, timeline, letter, content hash, snapshot) -> next claim
 * number -> OCEAN_DD claim (AWAITING_ANALYSIS) -> packet revision 1 (+ sources, timeline, findings) -> claim
 * PENDING_REVIEW with amounts -> invoice AUDITED with the snapshot -> `dd_invoice.audited`, all in the
 * caller's ONE tenant transaction. Findings are drafts for human review; the packet starts PENDING_REVIEW
 * and the four-eyes rules apply unchanged (the caller is the author of revision 1).
 */
import { createHash, randomUUID } from 'node:crypto';

import {
  AnalysisInputError,
  DD_PACKET_DISCLAIMER,
  DD_REGULATION_TEXT,
  DD_RULES_VERSION,
  DD_SOURCE_FILES,
  DdCalendarData,
  DdInvoiceData,
  DdTariffData,
  auditDdInvoice,
  buildDdDisputeLetter,
  canonicalJson,
  ddAddDays,
  plain,
  type DdAuditResponseDto,
  type DdAuditResultDto,
  type DdCalendarDataDto,
  type DdInvoiceDataDto,
  type DdTariffDataDto,
} from '@fr/shared';

import { appendAudit } from '../audit/audit.js';
import { INT4_MAX } from '../claims/analysis.js';
import { packetContentHash, type HashCitation, type HashPacket } from '../claims/content-hash.js';
import type { Actor } from '../claims/service.js';
import { nextClaimNumber } from '../db/claim-numbers.js';
import { lockDdInvoiceForUpdate } from '../db/dd-locks.js';
import { isUuid } from '../db/errors.js';
import type { TenantTx } from '../db/tenant.js';
import { errors } from '../http/errors.js';

import { dateValue, ddSha256, loadAttachments, parseStored, type DdAuditSnapshotDto } from './service.js';

/** Cap of untrusted text in timeline labels. */
const LABEL_TEXT_LIMIT = 100;

type SourceKind = keyof typeof DD_SOURCE_FILES;
type DdTimelineKind = 'INVOICE' | 'NOTE';

export interface DdSourceRow {
  id: string;
  ordinal: number;
  filename: string;
  docType: 'INVOICE' | 'OTHER';
  sha256: string;
  sizeBytes: number;
}

export interface DdTimelineRow {
  ordinal: number;
  occurredAt: Date;
  kind: DdTimelineKind;
  label: string;
  sourceId: string;
}

export interface DdFindingRow {
  ordinal: number;
  ruleId: string;
  title: string;
  direction: 'OVERCHARGE';
  amountCents: number;
  explanation: string;
  calculation: string[];
  confidence: number;
  needsHumanReview: boolean;
  citations: HashCitation[];
  clauseSourceId: string | null;
  clauseLabel: string | null;
  clauseExcerpt: string | null;
  clauseLocator: string | null;
}

export interface DdPacketBuild {
  result: DdAuditResultDto;
  packet: {
    id: string;
    revision: 1;
    status: 'PENDING_REVIEW';
    perspective: 'SHIPPER';
    loadNumber: null;
    generatedAt: Date;
    disclaimer: string;
    demandLetter: string;
    currency: 'USD';
    recoverableCents: number;
    pendingReviewCents: number;
    verifierStatus: 'NOT_RUN';
    contentHash: string;
    createdById: string;
  };
  sources: DdSourceRow[];
  timeline: DdTimelineRow[];
  findings: DdFindingRow[];
  hashPacket: HashPacket;
  snapshot: DdAuditSnapshotDto;
  snapshotSha256: string;
}

/** Cents that must fit the int4 columns, else AnalysisInputError (nothing is written). */
function storable(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > INT4_MAX) throw new AnalysisInputError('amount not storable');
  return cents;
}

const utcDate = (now: Date): string => now.toISOString().slice(0, 10);

/**
 * Pure part of the audit run (apart from `randomUUID`): engine, persistability, packet rows and hashes.
 * Throws AnalysisInputError (or RangeError) when the result is not storable.
 */
export function buildDdPacket(args: { invoice: DdInvoiceDataDto; tariff: DdTariffDataDto | null; calendar: DdCalendarDataDto | null; now: Date; actorId: string }): DdPacketBuild {
  const { invoice, tariff, calendar, now, actorId } = args;
  const result = auditDdInvoice({ invoice, tariff, calendar });
  for (const f of result.findings) storable(f.amountCents);
  const recoverableCents = storable(result.recoverableCents);
  const pendingReviewCents = storable(result.pendingReviewCents);
  storable(recoverableCents + pendingReviewCents);

  // Sources (C17): invoice, tariff and calendar when attached, regulation text.
  const objects: { kind: SourceKind; object: unknown; docType: 'INVOICE' | 'OTHER' }[] = [{ kind: 'invoice', object: invoice, docType: 'INVOICE' }];
  if (tariff !== null) objects.push({ kind: 'tariff', object: tariff, docType: 'OTHER' });
  if (calendar !== null) objects.push({ kind: 'calendar', object: calendar, docType: 'OTHER' });
  objects.push({ kind: 'regulation', object: DD_REGULATION_TEXT, docType: 'OTHER' });
  const sourceOf = new Map<SourceKind, DdSourceRow>();
  const sources: DdSourceRow[] = objects.map((o, i) => {
    const bytes = Buffer.from(canonicalJson(o.object), 'utf8');
    const row: DdSourceRow = {
      id: randomUUID(),
      ordinal: i + 1,
      filename: DD_SOURCE_FILES[o.kind],
      docType: o.docType,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.length,
    };
    sourceOf.set(o.kind, row);
    return row;
  });
  const source = (kind: SourceKind): DdSourceRow => {
    const s = sourceOf.get(kind);
    if (!s) throw new Error(`D&D finding cites the ${kind} source, which is not attached`);
    return s;
  };

  const findings: DdFindingRow[] = result.findings.map((f, i) => {
    const clauseSource = f.clause === null ? null : source(f.clause.source);
    return {
      ordinal: i + 1,
      ruleId: f.ruleId,
      title: f.title,
      direction: 'OVERCHARGE',
      amountCents: f.amountCents,
      explanation: f.explanation,
      calculation: [...f.calculation],
      confidence: f.confidence,
      needsHumanReview: f.needsHumanReview,
      citations: f.citations.map((c) => {
        const s = source(c.source);
        return { sourceId: s.id, locator: `${s.filename}#${c.pointer}`, excerpt: c.excerpt };
      }),
      clauseSourceId: clauseSource === null ? null : clauseSource.id,
      clauseLabel: f.clause === null ? null : f.clause.label,
      clauseExcerpt: f.clause === null ? null : f.clause.excerpt,
      clauseLocator: f.clause === null || clauseSource === null ? null : `${clauseSource.filename}#${f.clause.key}`,
    };
  });

  // Timeline (C17): invoice date; latest charged date; non-NVOCC: + 30 days (541.7 limit).
  const invoiceSource = source('invoice');
  const events: { occurredAt: Date; kind: DdTimelineKind; label: string }[] = [];
  if (invoice.invoiceDate !== null) events.push({ occurredAt: dateValue(invoice.invoiceDate), kind: 'INVOICE', label: `Invoice ${plain(invoice.invoiceNumber, LABEL_TEXT_LIMIT)} issued` });
  let last: string | null = null;
  for (const c of invoice.containers) for (const p of c.periods) if (last === null || p.to > last) last = p.to;
  if (last !== null) {
    events.push({ occurredAt: dateValue(last), kind: 'NOTE', label: 'Charges last incurred' });
    if (invoice.billingPartyType !== 'NVOCC') events.push({ occurredAt: dateValue(ddAddDays(last, 30)), kind: 'NOTE', label: '30-day issuance limit (46 CFR 541.7)' });
  }
  const kindOrder = (k: DdTimelineKind): number => (k === 'INVOICE' ? 0 : 1);
  const timeline: DdTimelineRow[] = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.occurredAt.getTime() - b.e.occurredAt.getTime() || kindOrder(a.e.kind) - kindOrder(b.e.kind) || a.i - b.i)
    .map(({ e }, i) => ({ ordinal: i + 1, occurredAt: e.occurredAt, kind: e.kind, label: e.label, sourceId: invoiceSource.id }));

  const demandLetter = buildDdDisputeLetter(invoice, result, utcDate(now));
  const hashPacket: HashPacket = {
    perspective: 'SHIPPER',
    loadNumber: null,
    currency: 'USD',
    recoverableCents,
    pendingReviewCents,
    demandLetter,
    sources: sources.map((s) => ({ ...s })),
    timeline: timeline.map((t) => ({ ...t })),
    findings: findings.map((f) => ({ ...f, citations: f.citations.map((c) => ({ ...c })) })),
  };
  const contentHash = packetContentHash(hashPacket);
  const snapshot: DdAuditSnapshotDto = { invoice, tariff, calendar, rulesVersion: DD_RULES_VERSION };
  return {
    result,
    packet: {
      id: randomUUID(),
      revision: 1,
      status: 'PENDING_REVIEW',
      perspective: 'SHIPPER',
      loadNumber: null,
      generatedAt: now,
      disclaimer: DD_PACKET_DISCLAIMER,
      demandLetter,
      currency: 'USD',
      recoverableCents,
      pendingReviewCents,
      verifierStatus: 'NOT_RUN',
      contentHash,
      createdById: actorId,
    },
    sources,
    timeline,
    findings,
    hashPacket,
    snapshot,
    snapshotSha256: ddSha256(snapshot),
  };
}

/**
 * POST /dd/invoices/:id/audit inside the caller's tenant transaction. 404 for unknown/other-tenant/non-UUID
 * ids; 409 invalid_state unless DRAFT (re-checked under the row lock); 422 analysis_input_invalid when the
 * result is not storable (nothing written).
 */
export async function runDdAudit(tx: TenantTx, tenantId: string, id: string, actor: Actor, now: Date = new Date()): Promise<DdAuditResponseDto> {
  if (!isUuid(id)) throw errors.notFound();
  if (!(await lockDdInvoiceForUpdate(tx, id))) throw errors.notFound();
  const row = await tx.ddInvoice.findFirst({ where: { id }, select: { id: true, status: true, data: true, tariffId: true, calendarId: true } });
  if (!row) throw errors.notFound();
  if (row.status !== 'DRAFT') throw errors.invalidState();
  const invoice = parseStored(DdInvoiceData, row.data, 'D&D invoice');
  const { tariff, calendar } = await loadAttachments(tx, row.tariffId, row.calendarId);
  // Defence in depth: the attachments were validated by loadAttachments with the same schemas.
  if (tariff !== null) DdTariffData.parse(tariff);
  if (calendar !== null) DdCalendarData.parse(calendar);

  let built: DdPacketBuild;
  try {
    built = buildDdPacket({ invoice, tariff, calendar, now, actorId: actor.userId });
  } catch (e) {
    if (e instanceof AnalysisInputError || e instanceof RangeError) throw errors.analysisInputInvalid();
    throw e;
  }
  const { packet, sources, timeline, findings, result } = built;
  const claimNumber = await nextClaimNumber(tx, tenantId);
  const claim = await tx.claim.create({
    data: {
      tenantId,
      claimNumber,
      kind: 'OCEAN_DD',
      perspective: 'SHIPPER',
      loadNumber: null,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate === null ? null : dateValue(invoice.invoiceDate),
      carrierName: invoice.billingPartyName,
      shipperName: invoice.billedPartyName,
      status: 'AWAITING_ANALYSIS',
      amountClaimedCents: 0,
      recoverableCents: 0,
      pendingReviewCents: 0,
    },
    select: { id: true },
  });
  const claimId = claim.id;
  await tx.evidencePacket.create({ data: { ...packet, tenantId, claimId } });
  await tx.packetSource.createMany({ data: sources.map((s) => ({ ...s, tenantId, packetId: packet.id })) });
  if (timeline.length > 0) await tx.packetTimelineEvent.createMany({ data: timeline.map((t) => ({ ...t, tenantId, packetId: packet.id })) });
  if (findings.length > 0) {
    await tx.packetFinding.createMany({ data: findings.map((f) => ({ ...f, citations: f.citations.map((c) => ({ ...c })), tenantId, packetId: packet.id })) });
  }
  const amountClaimedCents = result.recoverableCents + result.pendingReviewCents;
  await tx.claim.update({
    where: { id: claimId },
    data: { status: 'PENDING_REVIEW', recoverableCents: result.recoverableCents, pendingReviewCents: result.pendingReviewCents, amountClaimedCents, version: { increment: 1 } },
  });
  const updated = await tx.ddInvoice.updateMany({
    where: { id, status: 'DRAFT' },
    // Fix round 3 (review F1): updated_by_id keeps the last data editor; the audit run is not an edit.
    data: { status: 'AUDITED', claimId, auditedAt: now, auditSnapshot: built.snapshot, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw errors.invalidState();
  const findingsCount = findings.length;
  const pendingFindingsCount = findings.filter((f) => f.needsHumanReview).length;
  await appendAudit(tx, {
    tenantId,
    action: 'dd_invoice.audited',
    actorId: actor.userId,
    actorRole: actor.role,
    targetType: 'claim',
    targetId: claimId,
    metadata: {
      invoiceId: id,
      claimId,
      claimNumber,
      packetId: packet.id,
      revision: 1,
      contentHash: packet.contentHash,
      rulesVersion: DD_RULES_VERSION,
      findingsCount,
      pendingFindingsCount,
      recoverableCents: result.recoverableCents,
      pendingReviewCents: result.pendingReviewCents,
      snapshotSha256: built.snapshotSha256,
      tariffId: row.tariffId,
      calendarId: row.calendarId,
    },
    ip: actor.ip,
    requestId: actor.requestId,
  });
  return {
    invoiceId: id,
    claim: { id: claimId, claimNumber, status: 'PENDING_REVIEW', recoverableCents: result.recoverableCents, pendingReviewCents: result.pendingReviewCents, amountClaimedCents },
    packet: { id: packet.id, revision: 1, status: 'PENDING_REVIEW', contentHash: packet.contentHash },
    audit: { rulesVersion: DD_RULES_VERSION, findingsCount, pendingFindingsCount },
  };
}
