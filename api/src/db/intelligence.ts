/**
 * Read-only SQL of the Recovery Intelligence features (Q6). Every function runs inside the CALLER's
 * tenant transaction (`app.tenant_id` set, RLS FORCE applies) and additionally filters on
 * `tenant_id = fr_current_tenant()` (defense in depth). All inputs are bound parameters; no string from a
 * tenant row or request is interpolated into SQL. Raw SQL lives here because it is confined to db/.
 */
import { assertUuid } from './errors.js';
import { unwrapRawTx, type TenantTx } from './tenant.js';

export interface WorklistRow {
  id: string;
  claimNumber: string;
  loadNumber: string | null;
  carrierName: string;
  perspective: 'SHIPPER' | 'CARRIER';
  status: string;
  recoverableCents: number;
  pendingReviewCents: number;
  updatedAt: Date;
  assignee: { id: string; name: string } | null;
  packetRevision: number;
  packetStatus: string;
  pendingFindingsCount: number;
  valueCents: number;
}

export interface WorklistFilter {
  statuses: readonly ('PENDING_REVIEW' | 'APPROVED')[];
  perspective: 'SHIPPER' | 'CARRIER' | null;
  weightPercent: number;
  limit: number;
  offset: number;
}

const ALLOWED_WORKLIST_STATUSES = new Set(['PENDING_REVIEW', 'APPROVED']);

function checkFilter(f: WorklistFilter): void {
  if (!f.statuses.every((s) => ALLOWED_WORKLIST_STATUSES.has(s)) || f.statuses.length === 0) throw new RangeError('invalid status filter');
  if (f.perspective !== null && f.perspective !== 'SHIPPER' && f.perspective !== 'CARRIER') throw new RangeError('invalid perspective');
  if (!Number.isInteger(f.weightPercent) || f.weightPercent < 0 || f.weightPercent > 100) throw new RangeError('invalid weight');
  if (!Number.isInteger(f.limit) || f.limit < 1 || f.limit > 100 || !Number.isInteger(f.offset) || f.offset < 0) throw new RangeError('invalid page');
}

/**
 * One page of eligible claims (status in the set, latest packet exists) in priority-v1 order. The SQL
 * order is value desc, recoverable desc, updated_at asc, id asc, with value computed in integer
 * arithmetic exactly as `scoreClaim` does (integer division of a non-negative bigint = floor).
 */
export async function worklistPage(tx: TenantTx, f: WorklistFilter): Promise<{ rows: WorklistRow[]; total: number; awaitingAnalysis: number }> {
  checkFilter(f);
  const raw = unwrapRawTx(tx);
  const statuses = [...f.statuses];
  const rows = await raw.$queryRaw<
    {
      id: string;
      claim_number: string;
      load_number: string | null;
      carrier_name: string;
      perspective: 'SHIPPER' | 'CARRIER';
      status: string;
      recoverable_cents: number;
      pending_review_cents: number;
      updated_at: Date;
      assignee_id: string | null;
      assignee_name: string | null;
      packet_revision: number;
      packet_status: string;
      pending_findings: bigint;
      value_cents: bigint;
    }[]
  >`
    SELECT c.id, c.claim_number, c.load_number, c.carrier_name, c.perspective::text AS perspective, c.status::text AS status,
           c.recoverable_cents, c.pending_review_cents, c.updated_at, c.assignee_id, u.name AS assignee_name,
           l.revision AS packet_revision, l.status::text AS packet_status,
           (SELECT count(*) FROM packet_findings pf
             WHERE pf.packet_id = l.id AND pf.tenant_id = c.tenant_id AND pf.needs_human_review) AS pending_findings,
           (c.recoverable_cents::bigint + (c.pending_review_cents::bigint * ${f.weightPercent}::bigint) / 100) AS value_cents
    FROM claims c
    JOIN LATERAL (
      SELECT p.id, p.revision, p.status FROM evidence_packets p
      WHERE p.claim_id = c.id AND p.tenant_id = c.tenant_id
      ORDER BY p.revision DESC LIMIT 1
    ) l ON true
    LEFT JOIN users u ON u.id = c.assignee_id
    WHERE c.tenant_id = fr_current_tenant()
      AND c.status = ANY(${statuses}::text[]::"ClaimStatus"[])
      AND (${f.perspective}::text IS NULL OR c.perspective = ${f.perspective}::text::"Perspective")
    ORDER BY value_cents DESC, c.recoverable_cents DESC, c.updated_at ASC, c.id ASC
    LIMIT ${f.limit} OFFSET ${f.offset}`;
  const counts = await raw.$queryRaw<{ total: bigint; awaiting: bigint }[]>`
    SELECT
      (SELECT count(*) FROM claims c
        WHERE c.tenant_id = fr_current_tenant()
          AND c.status = ANY(${statuses}::text[]::"ClaimStatus"[])
          AND (${f.perspective}::text IS NULL OR c.perspective = ${f.perspective}::text::"Perspective")
          AND EXISTS (SELECT 1 FROM evidence_packets p WHERE p.claim_id = c.id AND p.tenant_id = c.tenant_id)) AS total,
      (SELECT count(*) FROM claims c WHERE c.tenant_id = fr_current_tenant() AND c.status = 'AWAITING_ANALYSIS') AS awaiting`;
  const c = counts[0];
  return {
    rows: rows.map((r) => ({
      id: r.id,
      claimNumber: r.claim_number,
      loadNumber: r.load_number,
      carrierName: r.carrier_name,
      perspective: r.perspective,
      status: r.status,
      recoverableCents: r.recoverable_cents,
      pendingReviewCents: r.pending_review_cents,
      updatedAt: r.updated_at,
      assignee: r.assignee_id && r.assignee_name !== null ? { id: r.assignee_id, name: r.assignee_name } : null,
      packetRevision: r.packet_revision,
      packetStatus: r.packet_status,
      pendingFindingsCount: Number(r.pending_findings),
      valueCents: Number(r.value_cents),
    })),
    total: Number(c?.total ?? 0n),
    awaitingAnalysis: Number(c?.awaiting ?? 0n),
  };
}

export interface ClaimFeatureRow {
  isTarget: boolean;
  id: string;
  claimNumber: string;
  carrierName: string;
  perspective: 'SHIPPER' | 'CARRIER';
  status: string;
  recoverableCents: number;
  pendingReviewCents: number;
  updatedAt: Date;
  ruleIds: string[];
  sourceDocTypes: string[];
  findingCount: number;
  decidedAt: Date | null;
}

/**
 * Target and candidate features in ONE query. Candidates: other claims of this tenant in
 * APPROVED/SEND_READY/REJECTED with a packet, the `candidateLimit` most recently updated
 * (updated_at desc, id desc). Features come from each claim's highest-revision packet.
 */
export async function similarityFeatures(tx: TenantTx, targetId: string, candidateLimit: number): Promise<ClaimFeatureRow[]> {
  assertUuid(targetId, 'targetId');
  if (!Number.isInteger(candidateLimit) || candidateLimit < 1 || candidateLimit > 2000) throw new RangeError('invalid candidate limit');
  const raw = unwrapRawTx(tx);
  const rows = await raw.$queryRaw<
    {
      is_target: boolean;
      id: string;
      claim_number: string;
      carrier_name: string;
      perspective: 'SHIPPER' | 'CARRIER';
      status: string;
      recoverable_cents: number;
      pending_review_cents: number;
      updated_at: Date;
      rule_ids: string[] | null;
      doc_types: string[] | null;
      finding_count: bigint;
      decided_at: Date | null;
    }[]
  >`
    WITH cand AS (
      SELECT c.id, c.updated_at FROM claims c
      WHERE c.tenant_id = fr_current_tenant()
        AND c.id <> ${targetId}::uuid
        AND c.status IN ('APPROVED', 'SEND_READY', 'REJECTED')
        AND EXISTS (SELECT 1 FROM evidence_packets p WHERE p.claim_id = c.id AND p.tenant_id = c.tenant_id)
      ORDER BY c.updated_at DESC, c.id DESC
      LIMIT ${candidateLimit}
    ),
    sel AS (
      SELECT ${targetId}::uuid AS id, true AS is_target
      UNION ALL
      SELECT id, false FROM cand
    )
    SELECT s.is_target, c.id, c.claim_number, c.carrier_name, c.perspective::text AS perspective, c.status::text AS status,
           c.recoverable_cents, c.pending_review_cents, c.updated_at,
           (SELECT array_agg(DISTINCT pf.rule_id) FROM packet_findings pf WHERE pf.packet_id = l.id AND pf.tenant_id = c.tenant_id) AS rule_ids,
           (SELECT array_agg(DISTINCT ps.doc_type::text) FROM packet_sources ps WHERE ps.packet_id = l.id AND ps.tenant_id = c.tenant_id) AS doc_types,
           (SELECT count(*) FROM packet_findings pf WHERE pf.packet_id = l.id AND pf.tenant_id = c.tenant_id) AS finding_count,
           (SELECT max(a.created_at) FROM approvals a WHERE a.claim_id = c.id AND a.tenant_id = c.tenant_id) AS decided_at
    FROM sel s
    JOIN claims c ON c.id = s.id AND c.tenant_id = fr_current_tenant()
    JOIN LATERAL (
      SELECT p.id FROM evidence_packets p
      WHERE p.claim_id = c.id AND p.tenant_id = c.tenant_id
      ORDER BY p.revision DESC LIMIT 1
    ) l ON true`;
  return rows.map((r) => ({
    isTarget: r.is_target,
    id: r.id,
    claimNumber: r.claim_number,
    carrierName: r.carrier_name,
    perspective: r.perspective,
    status: r.status,
    recoverableCents: r.recoverable_cents,
    pendingReviewCents: r.pending_review_cents,
    updatedAt: r.updated_at,
    ruleIds: r.rule_ids ?? [],
    sourceDocTypes: r.doc_types ?? [],
    findingCount: Number(r.finding_count),
    decidedAt: r.decided_at,
  }));
}

export interface ProvenanceRow {
  documentId: string;
  displayName: string;
  docType: string;
  status: string;
  extracted: number;
  manual: number;
  proposed: number;
  confirmed: number;
  corrected: number;
  rejected: number;
  unresolvedFlagged: number;
  minConfidence: number | null;
}

/** Per linked document: field counts (both origins), unresolved flagged fields, lowest extracted confidence. */
export async function provenanceRows(tx: TenantTx, claimId: string): Promise<ProvenanceRow[]> {
  assertUuid(claimId, 'claimId');
  const raw = unwrapRawTx(tx);
  const rows = await raw.$queryRaw<
    {
      document_id: string;
      display_name: string;
      doc_type: string;
      status: string;
      extracted: bigint;
      manual: bigint;
      proposed: bigint;
      confirmed: bigint;
      corrected: bigint;
      rejected: bigint;
      unresolved: bigint;
      min_confidence: string | null;
    }[]
  >`
    SELECT d.id AS document_id, d.display_name, d.doc_type::text AS doc_type, d.status::text AS status,
           count(f.id) FILTER (WHERE f.origin = 'EXTRACTED') AS extracted,
           count(f.id) FILTER (WHERE f.origin = 'MANUAL') AS manual,
           count(f.id) FILTER (WHERE f.status = 'PROPOSED') AS proposed,
           count(f.id) FILTER (WHERE f.status = 'CONFIRMED') AS confirmed,
           count(f.id) FILTER (WHERE f.status = 'CORRECTED') AS corrected,
           count(f.id) FILTER (WHERE f.status = 'REJECTED') AS rejected,
           count(f.id) FILTER (WHERE f.needs_review AND f.status = 'PROPOSED') AS unresolved,
           (min(f.confidence) FILTER (WHERE f.origin = 'EXTRACTED'))::text AS min_confidence
    FROM claim_documents cd
    JOIN import_documents d ON d.id = cd.document_id AND d.tenant_id = cd.tenant_id
    LEFT JOIN extracted_fields f ON f.document_id = d.id AND f.tenant_id = d.tenant_id
    WHERE cd.claim_id = ${claimId}::uuid AND cd.tenant_id = fr_current_tenant()
    GROUP BY d.id, d.display_name, d.doc_type, d.status, cd.linked_at
    ORDER BY cd.linked_at ASC, d.id ASC`;
  return rows.map((r) => ({
    documentId: r.document_id,
    displayName: r.display_name,
    docType: r.doc_type,
    status: r.status,
    extracted: Number(r.extracted),
    manual: Number(r.manual),
    proposed: Number(r.proposed),
    confirmed: Number(r.confirmed),
    corrected: Number(r.corrected),
    rejected: Number(r.rejected),
    unresolvedFlagged: Number(r.unresolved),
    minConfidence: r.min_confidence === null ? null : Number(r.min_confidence),
  }));
}
