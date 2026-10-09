/**
 * Recovery Intelligence services (Q6): prioritised worklist (priority-v1), similar past claims
 * (similar-v1) and the provenance summary. Tenant-scoped: every read goes through the caller's tenant
 * transaction (RLS FORCE + explicit tenant predicates in db/intelligence.ts). Deterministic: the result
 * depends only on the stored data, the documented policy inputs and the injected clock.
 */
import { performance } from 'node:perf_hooks';

import {
  PROVENANCE_NOTE,
  SIMILARITY_MIN_PERCENT,
  SIMILARITY_WEIGHTS,
  SIMILAR_NOTE,
  worklistNote,
  type ProvenanceDto,
  type SimilarItemDto,
  type SimilarResponseDto,
  type WorklistDto,
  type WorklistQueryInput,
} from '@fr/shared';

import { provenanceRows, similarityFeatures, worklistPage } from '../db/intelligence.js';
import { isUuid } from '../db/errors.js';
import type { TenantDb } from '../db/tenant.js';
import { errors } from '../http/errors.js';

import { buildWhy, nextAction, scoreClaim, waitingDays } from './priority.js';
import { rankSimilar, type Candidate } from './similarity.js';

export interface IntelligencePolicy {
  pendingWeightPercent: number;
  similarCandidateLimit: number;
}

export async function buildWorklist(db: TenantDb, q: WorklistQueryInput, policy: IntelligencePolicy, now: Date): Promise<WorklistDto> {
  const w = policy.pendingWeightPercent;
  const offset = (q.page - 1) * q.pageSize;
  const page = await db.tx((tx) =>
    worklistPage(tx, { statuses: q.status, perspective: q.perspective ?? null, weightPercent: w, limit: q.pageSize, offset }),
  );
  const items = page.rows.map((r, i) => {
    const score = scoreClaim({ recoverableCents: r.recoverableCents, pendingReviewCents: r.pendingReviewCents }, w);
    // The SQL computed the same integer formula; a disagreement is a defect, never shown to users.
    if (score.valueCents !== r.valueCents) throw new Error('priority score mismatch');
    const days = waitingDays(now, r.updatedAt);
    return {
      rank: offset + i + 1,
      claim: {
        id: r.id,
        claimNumber: r.claimNumber,
        loadNumber: r.loadNumber,
        carrierName: r.carrierName,
        perspective: r.perspective,
        status: r.status as 'PENDING_REVIEW' | 'APPROVED',
        recoverableCents: r.recoverableCents,
        pendingReviewCents: r.pendingReviewCents,
        currency: 'USD' as const,
        assignee: r.assignee,
        latestPacket: { revision: r.packetRevision, status: r.packetStatus as 'PENDING_REVIEW' },
      },
      score: { version: 'priority-v1' as const, valueCents: score.valueCents, parts: score.parts },
      why: buildWhy({
        recoverableCents: r.recoverableCents,
        pendingReviewCents: r.pendingReviewCents,
        w,
        status: r.status,
        pendingFindingsCount: r.pendingFindingsCount,
        waitingDays: days,
      }),
      nextAction: nextAction(r.status, r.pendingFindingsCount),
      pendingFindingsCount: r.pendingFindingsCount,
      waitingSince: r.updatedAt.toISOString(),
      waitingDays: days,
    };
  });
  return {
    generatedAt: now.toISOString(),
    formula: { version: 'priority-v1', pendingWeightPercent: w },
    label: worklistNote(w),
    notRanked: { awaitingAnalysis: page.awaitingAnalysis },
    items,
    page: q.page,
    pageSize: q.pageSize,
    total: page.total,
  };
}

const SIMILAR_STATUSES = new Set(['APPROVED', 'SEND_READY', 'REJECTED']);

function roundMs(v: number): number {
  return Math.max(0, Math.round(v * 1000) / 1000);
}

/** Target lookup: unknown / other-tenant / non-UUID ids are answered with the standard 404. */
export async function similarTarget(db: TenantDb, claimId: string): Promise<{ id: string; hasPacket: boolean }> {
  if (!isUuid(claimId)) throw errors.notFound();
  const target = await db.tx(async (tx) => {
    const claim = await tx.claim.findFirst({ where: { id: claimId }, select: { id: true } });
    if (!claim) return null;
    const packets = await tx.evidencePacket.count({ where: { claimId } });
    return { id: claim.id, hasPacket: packets > 0 };
  });
  if (!target) throw errors.notFound();
  return target;
}

/** Scoring step of similar-v1 for an existing target of this tenant. */
export async function findSimilar(
  db: TenantDb,
  target: { id: string; hasPacket: boolean },
  limit: number,
  policy: IntelligencePolicy,
): Promise<SimilarResponseDto> {
  const claimId = target.id;
  const base = {
    claimId,
    version: 'similar-v1' as const,
    weights: { ...SIMILARITY_WEIGHTS },
    minPercent: SIMILARITY_MIN_PERCENT as 30,
    label: SIMILAR_NOTE,
  };
  if (!target.hasPacket) return { ...base, reason: 'no_packet', candidatesConsidered: 0, computeMs: 0, items: [] };

  const started = performance.now();
  const rows = await db.tx((tx) => similarityFeatures(tx, claimId, policy.similarCandidateLimit));
  const t = rows.find((r) => r.isTarget);
  if (!t) throw errors.notFound();
  const candidates: (Candidate & { row: (typeof rows)[number] })[] = rows
    .filter((r) => !r.isTarget && r.id !== claimId && SIMILAR_STATUSES.has(r.status))
    .map((r) => ({
      id: r.id,
      updatedAt: r.updatedAt,
      carrierName: r.carrierName,
      ruleIds: new Set(r.ruleIds),
      totalCents: r.recoverableCents + r.pendingReviewCents,
      perspective: r.perspective,
      row: r,
    }));
  const ranked = rankSimilar(
    { carrierName: t.carrierName, ruleIds: new Set(t.ruleIds), totalCents: t.recoverableCents + t.pendingReviewCents, perspective: t.perspective },
    candidates,
    limit,
  );
  const computeMs = roundMs(performance.now() - started);

  const items: SimilarItemDto[] = ranked.map(({ candidate, scored }) => {
    const r = candidate.row;
    const finalStatus = r.status as 'APPROVED' | 'SEND_READY' | 'REJECTED';
    return {
      claim: {
        id: r.id,
        claimNumber: r.claimNumber,
        carrierName: r.carrierName,
        perspective: r.perspective,
        status: finalStatus,
        recoverableCents: r.recoverableCents,
        pendingReviewCents: r.pendingReviewCents,
        updatedAt: r.updatedAt.toISOString(),
      },
      similarityPercent: scored.percent,
      matches: scored.matches,
      handling: {
        finalStatus,
        ruleIds: [...new Set(r.ruleIds)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
        sourceDocTypes: [...new Set(r.sourceDocTypes)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) as SimilarItemDto['handling']['sourceDocTypes'],
        findingCount: r.findingCount,
        decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      },
    };
  });
  return { ...base, reason: null, candidatesConsidered: candidates.length, computeMs, items };
}

export async function provenanceFor(db: TenantDb, claimId: string): Promise<ProvenanceDto> {
  if (!isUuid(claimId)) throw errors.notFound();
  const rows = await db.tx(async (tx) => {
    const claim = await tx.claim.findFirst({ where: { id: claimId }, select: { id: true } });
    if (!claim) return null;
    return provenanceRows(tx, claimId);
  });
  if (!rows) throw errors.notFound();
  const documents = rows.map((r) => ({
    documentId: r.documentId,
    displayName: r.displayName,
    docType: r.docType as ProvenanceDto['documents'][number]['docType'],
    status: r.status as ProvenanceDto['documents'][number]['status'],
    extractedFieldCount: r.extracted,
    manualFieldCount: r.manual,
    byFieldStatus: { PROPOSED: r.proposed, CONFIRMED: r.confirmed, CORRECTED: r.corrected, REJECTED: r.rejected },
    unresolvedFlaggedCount: r.unresolvedFlagged,
    minConfidence: r.minConfidence,
  }));
  const sum = (f: (d: (typeof documents)[number]) => number) => documents.reduce((a, d) => a + f(d), 0);
  return {
    claimId,
    basis: 'rule_based_parse_score',
    label: PROVENANCE_NOTE,
    documents,
    totals: {
      documents: documents.length,
      fields: sum((d) => d.extractedFieldCount + d.manualFieldCount),
      manualFields: sum((d) => d.manualFieldCount),
      proposed: sum((d) => d.byFieldStatus.PROPOSED),
      confirmed: sum((d) => d.byFieldStatus.CONFIRMED),
      corrected: sum((d) => d.byFieldStatus.CORRECTED),
      rejected: sum((d) => d.byFieldStatus.REJECTED),
      unresolvedFlagged: sum((d) => d.unresolvedFlaggedCount),
    },
  };
}
