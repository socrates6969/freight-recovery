/**
 * Claims, packets and approvals domain logic (A11). Every function takes a tenant transaction
 * (TenantTx): tenant scoping is enforced by the client extension and Postgres RLS underneath.
 */
import { randomUUID } from 'node:crypto';

import type { ApprovalItemDto, ClaimDetailDto, ClaimSummaryDto, ClaimsQueryInput, PacketDto, PacketStatus, Role } from '@fr/shared';

import { appendAudit } from '../audit/audit.js';
import { isUuid } from '../db/errors.js';
import { lockClaimForUpdate, type TenantTx } from '../db/tenant.js';
import { UNPROCESSABLE, errors } from '../http/errors.js';

import { packetContentHash, type HashCitation, type HashPacket } from './content-hash.js';
import { buildClaimOrderBy, buildClaimWhere, pageArgs, type ClaimFilter, type ClaimSort } from './query.js';
import { ACTION_FOR, AUDIT_FOR, canTransition, targetStatus, type LiveStatus, type Transition } from './state-machine.js';

export interface Actor {
  userId: string;
  role: Role;
  ip: string;
  requestId: string;
}

const SUMMARY_INCLUDE = {
  assignee: { select: { id: true, name: true } },
  packets: { where: { status: { not: 'SUPERSEDED' } }, select: { revision: true, status: true, createdAt: true }, take: 1 },
} as const;

interface SummaryRow {
  id: string;
  claimNumber: string;
  loadNumber: string | null;
  invoiceNumber: string | null;
  invoiceDate: Date | null;
  carrierName: string;
  shipperName: string;
  perspective: 'SHIPPER' | 'CARRIER';
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'SEND_READY';
  amountClaimedCents: number;
  recoverableCents: number;
  pendingReviewCents: number;
  currency: string;
  assignee: { id: string; name: string } | null;
  packets: { revision: number; status: string; createdAt: Date }[];
  createdAt: Date;
  updatedAt: Date;
}

export function toClaimSummary(c: SummaryRow): ClaimSummaryDto {
  const p = c.packets[0];
  return {
    id: c.id,
    claimNumber: c.claimNumber,
    loadNumber: c.loadNumber,
    invoiceNumber: c.invoiceNumber,
    carrierName: c.carrierName,
    shipperName: c.shipperName,
    perspective: c.perspective,
    status: c.status,
    amountClaimedCents: c.amountClaimedCents,
    recoverableCents: c.recoverableCents,
    pendingReviewCents: c.pendingReviewCents,
    currency: 'USD',
    assignee: c.assignee ? { id: c.assignee.id, name: c.assignee.name } : null,
    latestPacket: p ? { revision: p.revision, status: p.status as PacketStatus } : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function listClaims(
  tx: TenantTx,
  q: Pick<ClaimsQueryInput, 'q' | 'status' | 'perspective' | 'assigneeId' | 'sort' | 'page' | 'pageSize'>,
): Promise<{ items: ClaimSummaryDto[]; page: number; pageSize: number; total: number }> {
  const filter: ClaimFilter = { q: q.q, status: q.status, perspective: q.perspective, assigneeId: q.assigneeId };
  const where = buildClaimWhere(filter);
  // Sequential: both run on the same transaction connection.
  const total = await tx.claim.count({ where });
  const rows = await tx.claim.findMany({ where, orderBy: buildClaimOrderBy(q.sort), ...pageArgs(q.page, q.pageSize), include: SUMMARY_INCLUDE });
  return { items: (rows as SummaryRow[]).map(toClaimSummary), page: q.page, pageSize: q.pageSize, total };
}

async function findClaim(tx: TenantTx, id: string): Promise<SummaryRow> {
  if (!isUuid(id)) throw errors.notFound();
  const c = await tx.claim.findFirst({ where: { id }, include: SUMMARY_INCLUDE });
  if (!c) throw errors.notFound();
  return c as SummaryRow;
}

export async function getClaim(tx: TenantTx, id: string): Promise<ClaimDetailDto> {
  const c = await findClaim(tx, id);
  return { ...toClaimSummary(c), invoiceDate: c.invoiceDate ? c.invoiceDate.toISOString() : null };
}

export async function listApprovalQueue(
  tx: TenantTx,
  q: { status: readonly ('PENDING_REVIEW' | 'APPROVED')[]; page: number; pageSize: number; sort: ClaimSort },
): Promise<{ items: ApprovalItemDto[]; page: number; pageSize: number; total: number }> {
  const where = buildClaimWhere({ status: q.status as ClaimFilter['status'] });
  const include = {
    assignee: { select: { id: true, name: true } },
    packets: {
      where: { status: { not: 'SUPERSEDED' as const } },
      take: 1,
      select: {
        revision: true,
        status: true,
        createdAt: true,
        _count: { select: { findings: { where: { needsHumanReview: true } } } },
      },
    },
  };
  const total = await tx.claim.count({ where });
  const rows = await tx.claim.findMany({ where, orderBy: buildClaimOrderBy(q.sort), ...pageArgs(q.page, q.pageSize), include });
  const items = rows.map((r) => {
    const p = r.packets[0];
    const summary = toClaimSummary(r as unknown as SummaryRow);
    return {
      ...summary,
      packetRevision: p?.revision ?? 0,
      pendingFindingsCount: p?._count.findings ?? 0,
      waitingSince: (p?.createdAt ?? r.updatedAt).toISOString(),
    };
  });
  return { items, page: q.page, pageSize: q.pageSize, total };
}

// ---------------------------------------------------------------------------------------------
// Packets
// ---------------------------------------------------------------------------------------------

const PACKET_INCLUDE = {
  sources: { orderBy: { ordinal: 'asc' as const } },
  timeline: { orderBy: { ordinal: 'asc' as const } },
  findings: { orderBy: { ordinal: 'asc' as const } },
  createdBy: { select: { id: true, name: true } },
};

type PacketRow = NonNullable<Awaited<ReturnType<typeof loadPacketRow>>>;

async function loadPacketRow(tx: TenantTx, claimId: string, revision: number | undefined) {
  if (revision !== undefined) {
    return tx.evidencePacket.findFirst({ where: { claimId, revision }, include: PACKET_INCLUDE });
  }
  return tx.evidencePacket.findFirst({ where: { claimId }, orderBy: { revision: 'desc' }, include: PACKET_INCLUDE });
}

function asCitations(v: unknown): HashCitation[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((c) => {
    if (typeof c !== 'object' || c === null) return [];
    const r = c as Record<string, unknown>;
    if (typeof r['sourceId'] !== 'string') return [];
    return [{ sourceId: r['sourceId'], locator: String(r['locator'] ?? ''), excerpt: String(r['excerpt'] ?? '') }];
  });
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

export function toHashPacket(p: PacketRow): HashPacket {
  return {
    perspective: p.perspective,
    loadNumber: p.loadNumber,
    currency: p.currency,
    recoverableCents: p.recoverableCents,
    pendingReviewCents: p.pendingReviewCents,
    demandLetter: p.demandLetter,
    sources: p.sources.map((s) => ({ id: s.id, ordinal: s.ordinal, filename: s.filename, docType: s.docType, sha256: s.sha256, sizeBytes: s.sizeBytes })),
    timeline: p.timeline.map((t) => ({ ordinal: t.ordinal, occurredAt: t.occurredAt, kind: t.kind, label: t.label, sourceId: t.sourceId })),
    findings: p.findings.map((f) => ({
      ordinal: f.ordinal,
      ruleId: f.ruleId,
      title: f.title,
      direction: f.direction,
      amountCents: f.amountCents,
      explanation: f.explanation,
      calculation: asStrings(f.calculation),
      confidence: Number(f.confidence),
      needsHumanReview: f.needsHumanReview,
      citations: asCitations(f.citations),
      clauseSourceId: f.clauseSourceId,
      clauseLabel: f.clauseLabel,
      clauseExcerpt: f.clauseExcerpt,
      clauseLocator: f.clauseLocator,
    })),
  };
}

/** R28: packet DTO (default latest revision), integrity recomputed, read audited as packet.viewed. */
export async function getPacket(tx: TenantTx, claimId: string, revision: number | undefined, actor: Actor): Promise<PacketDto> {
  await findClaim(tx, claimId);
  const p = await loadPacketRow(tx, claimId, revision);
  if (!p) throw errors.notFound();
  const approvals = await tx.approval.findMany({
    where: { claimId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { actor: { select: { id: true, name: true } } },
  });
  const recomputed = packetContentHash(toHashPacket(p));
  await appendAudit(tx, {
    tenantId: p.tenantId,
    action: 'packet.viewed',
    actorId: actor.userId,
    actorRole: actor.role,
    targetType: 'claim',
    targetId: claimId,
    metadata: { claimId, revision: p.revision },
    ip: actor.ip,
    requestId: actor.requestId,
  });
  const timeline = [...p.timeline].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.ordinal - b.ordinal);
  return {
    id: p.id,
    claimId: p.claimId,
    revision: p.revision,
    status: p.status,
    perspective: p.perspective,
    loadNumber: p.loadNumber,
    generatedAt: p.generatedAt.toISOString(),
    disclaimer: p.disclaimer,
    demandLetter: p.demandLetter,
    currency: 'USD',
    recoverableCents: p.recoverableCents,
    pendingReviewCents: p.pendingReviewCents,
    timeline: timeline.map((t) => ({ id: t.id, occurredAt: t.occurredAt.toISOString(), kind: t.kind, label: t.label, sourceId: t.sourceId })),
    sources: p.sources.map((s) => ({ id: s.id, filename: s.filename, docType: s.docType, sha256: s.sha256, sizeBytes: s.sizeBytes })),
    findings: p.findings.map((f) => ({
      id: f.id,
      ruleId: f.ruleId,
      title: f.title,
      direction: f.direction,
      amountCents: f.amountCents,
      explanation: f.explanation,
      calculation: asStrings(f.calculation),
      confidence: Number(f.confidence),
      needsHumanReview: f.needsHumanReview,
      citations: asCitations(f.citations),
      governingClause:
        f.clauseSourceId === null
          ? null
          : { sourceId: f.clauseSourceId, label: f.clauseLabel ?? '', excerpt: f.clauseExcerpt ?? '', locator: f.clauseLocator ?? '' },
    })),
    verifier: {
      status: p.verifierStatus,
      checkedAt: p.verifierCheckedAt ? p.verifierCheckedAt.toISOString() : null,
      note: p.verifierNote,
    },
    integrity: { contentHash: p.contentHash, recomputedHash: recomputed, valid: recomputed === p.contentHash },
    approvals: approvals.map((a) => ({
      id: a.id,
      action: a.action,
      reason: a.reason,
      packetRevision: a.packetRevision,
      fromStatus: a.fromStatus,
      toStatus: a.toStatus,
      actor: { id: a.actor.id, name: a.actor.name, role: a.actorRole },
      createdAt: a.createdAt.toISOString(),
    })),
    createdAt: p.createdAt.toISOString(),
    createdBy: p.createdBy ? { id: p.createdBy.id, name: p.createdBy.name } : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Assignment (R29)
// ---------------------------------------------------------------------------------------------

export async function assignClaim(tx: TenantTx, claimId: string, assigneeId: string | null, actor: Actor): Promise<ClaimSummaryDto> {
  const claim = await findClaim(tx, claimId);
  if (!(await lockClaimForUpdate(tx, claim.id))) throw errors.notFound();
  if (assigneeId !== null) {
    const m = await tx.membership.findFirst({ where: { userId: assigneeId, user: { status: 'ACTIVE' } }, select: { id: true } });
    if (!m) throw errors.unprocessable(UNPROCESSABLE.assignee);
  }
  const previous = claim.assignee?.id ?? null;
  await tx.claim.update({ where: { id: claim.id }, data: { assigneeId, version: { increment: 1 } } });
  await appendAudit(tx, {
    tenantId: await currentTenant(tx, claim.id),
    action: 'claim.assigned',
    actorId: actor.userId,
    actorRole: actor.role,
    targetType: 'claim',
    targetId: claim.id,
    metadata: { claimId: claim.id, assigneeId, previousAssigneeId: previous },
    ip: actor.ip,
    requestId: actor.requestId,
  });
  return toClaimSummary(await findClaim(tx, claim.id));
}

async function currentTenant(tx: TenantTx, claimId: string): Promise<string> {
  const c = await tx.claim.findFirst({ where: { id: claimId }, select: { tenantId: true } });
  if (!c) throw errors.notFound();
  return c.tenantId;
}

// ---------------------------------------------------------------------------------------------
// Review transitions (R30-R33)
// ---------------------------------------------------------------------------------------------

interface LockedState {
  claimId: string;
  tenantId: string;
  latest: PacketRow;
}

async function lockAndLoadLatest(tx: TenantTx, claimId: string): Promise<LockedState> {
  if (!isUuid(claimId)) throw errors.notFound();
  if (!(await lockClaimForUpdate(tx, claimId))) throw errors.notFound();
  const latest = await tx.evidencePacket.findFirst({
    where: { claimId, status: { not: 'SUPERSEDED' } },
    include: PACKET_INCLUDE,
  });
  if (!latest) throw errors.notFound();
  return { claimId, tenantId: latest.tenantId, latest };
}

export interface TransitionResult {
  claim: { id: string; status: LiveStatus };
  packet: { id: string; revision: number; status: string; contentHash?: string };
  delivery?: { sent: false; mode: 'send_ready_only' };
}

/** R31/R32/R33: approve, reject, mark send-ready. One transaction; caller supplies it. */
export async function transition(
  tx: TenantTx,
  kind: Exclude<Transition, 'edit'>,
  claimId: string,
  input: { packetRevision: number; reason: string; acknowledgePendingFindings?: boolean | undefined },
  actor: Actor,
): Promise<TransitionResult> {
  const { latest, tenantId } = await lockAndLoadLatest(tx, claimId);
  if (input.packetRevision !== latest.revision) throw errors.staleRevision();
  const from = latest.status as LiveStatus;
  if (!canTransition(kind, from)) throw errors.invalidState();

  if (kind === 'approve' && latest.findings.some((f) => f.needsHumanReview) && input.acknowledgePendingFindings !== true) {
    throw errors.unprocessable(UNPROCESSABLE.acknowledgePending);
  }
  if (kind === 'send') {
    const approval = await tx.approval.findFirst({
      where: { packetId: latest.id, action: 'APPROVE' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const recomputed = packetContentHash(toHashPacket(latest));
    if (!approval || approval.contentHash !== recomputed || latest.contentHash !== recomputed) throw errors.invalidState();
  }

  const to = targetStatus(kind);
  await tx.evidencePacket.update({ where: { id: latest.id }, data: { status: to } });
  await tx.claim.update({ where: { id: claimId }, data: { status: to, version: { increment: 1 } } });
  await tx.approval.create({
    data: {
      tenantId,
      claimId,
      packetId: latest.id,
      packetRevision: latest.revision,
      action: ACTION_FOR[kind],
      reason: input.reason,
      fromStatus: from,
      toStatus: to,
      contentHash: latest.contentHash,
      actorId: actor.userId,
      actorRole: actor.role,
    },
  });
  await appendAudit(tx, {
    tenantId,
    action: AUDIT_FOR[kind],
    actorId: actor.userId,
    actorRole: actor.role,
    targetType: 'claim',
    targetId: claimId,
    metadata: {
      claimId,
      packetId: latest.id,
      packetRevision: latest.revision,
      fromStatus: from,
      toStatus: to,
      contentHash: latest.contentHash,
      reason: input.reason,
      ...(kind === 'approve' ? { acknowledgedPendingFindings: input.acknowledgePendingFindings === true } : {}),
    },
    ip: actor.ip,
    requestId: actor.requestId,
  });
  const result: TransitionResult = {
    claim: { id: claimId, status: to },
    packet: { id: latest.id, revision: latest.revision, status: to },
  };
  if (kind === 'send') result.delivery = { sent: false, mode: 'send_ready_only' };
  return result;
}

/** R30: create a new packet revision with an edited demand letter (copies content, new ids). */
export async function createRevision(
  tx: TenantTx,
  claimId: string,
  input: { baseRevision: number; demandLetter: string; reason: string },
  actor: Actor,
): Promise<TransitionResult> {
  const { latest, tenantId } = await lockAndLoadLatest(tx, claimId);
  if (input.baseRevision !== latest.revision) throw errors.staleRevision();
  const from = latest.status as LiveStatus;
  if (!canTransition('edit', from)) throw errors.invalidState();

  const newRevision = latest.revision + 1;
  const sourceIdMap = new Map<string, string>();
  for (const s of latest.sources) sourceIdMap.set(s.id, randomUUID());
  const remap = (id: string | null): string | null => (id === null ? null : (sourceIdMap.get(id) ?? null));
  const newPacketId = randomUUID();

  const hashInput = toHashPacket({ ...latest, demandLetter: input.demandLetter });
  const contentHash = packetContentHash(hashInput);

  await tx.evidencePacket.update({ where: { id: latest.id }, data: { status: 'SUPERSEDED' } });
  await tx.evidencePacket.create({
    data: {
      id: newPacketId,
      tenantId,
      claimId,
      revision: newRevision,
      status: 'PENDING_REVIEW',
      perspective: latest.perspective,
      loadNumber: latest.loadNumber,
      generatedAt: latest.generatedAt,
      disclaimer: latest.disclaimer,
      demandLetter: input.demandLetter,
      currency: latest.currency,
      recoverableCents: latest.recoverableCents,
      pendingReviewCents: latest.pendingReviewCents,
      verifierStatus: 'NOT_RUN',
      contentHash,
      createdById: actor.userId,
    },
  });
  if (latest.sources.length > 0) {
    await tx.packetSource.createMany({
      data: latest.sources.map((s) => ({
        id: sourceIdMap.get(s.id) ?? randomUUID(),
        tenantId,
        packetId: newPacketId,
        filename: s.filename,
        docType: s.docType,
        sha256: s.sha256,
        sizeBytes: s.sizeBytes,
        ordinal: s.ordinal,
      })),
    });
  }
  if (latest.timeline.length > 0) {
    await tx.packetTimelineEvent.createMany({
      data: latest.timeline.map((t) => ({
        tenantId,
        packetId: newPacketId,
        occurredAt: t.occurredAt,
        kind: t.kind,
        label: t.label,
        sourceId: remap(t.sourceId),
        ordinal: t.ordinal,
      })),
    });
  }
  if (latest.findings.length > 0) {
    await tx.packetFinding.createMany({
      data: latest.findings.map((f) => ({
        tenantId,
        packetId: newPacketId,
        ordinal: f.ordinal,
        ruleId: f.ruleId,
        title: f.title,
        direction: f.direction,
        amountCents: f.amountCents,
        explanation: f.explanation,
        calculation: asStrings(f.calculation),
        confidence: f.confidence,
        needsHumanReview: f.needsHumanReview,
        citations: asCitations(f.citations).map((c) => ({ ...c, sourceId: remap(c.sourceId) ?? c.sourceId })),
        clauseSourceId: remap(f.clauseSourceId),
        clauseLabel: f.clauseLabel,
        clauseExcerpt: f.clauseExcerpt,
        clauseLocator: f.clauseLocator,
      })),
    });
  }
  await tx.claim.update({ where: { id: claimId }, data: { status: 'PENDING_REVIEW', version: { increment: 1 } } });
  await tx.approval.create({
    data: {
      tenantId,
      claimId,
      packetId: latest.id,
      packetRevision: latest.revision,
      action: 'EDIT',
      reason: input.reason,
      fromStatus: from,
      toStatus: 'SUPERSEDED',
      contentHash: latest.contentHash,
      actorId: actor.userId,
      actorRole: actor.role,
    },
  });
  await appendAudit(tx, {
    tenantId,
    action: 'packet.revision_created',
    actorId: actor.userId,
    actorRole: actor.role,
    targetType: 'claim',
    targetId: claimId,
    metadata: { claimId, packetId: newPacketId, baseRevision: latest.revision, revision: newRevision, contentHash, reason: input.reason },
    ip: actor.ip,
    requestId: actor.requestId,
  });
  return {
    claim: { id: claimId, status: 'PENDING_REVIEW' },
    packet: { id: newPacketId, revision: newRevision, status: 'PENDING_REVIEW', contentHash },
  };
}
