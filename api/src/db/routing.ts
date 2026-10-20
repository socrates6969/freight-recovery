/**
 * REQ-20261020-dd-deadline: read-only SQL of the reviewer-routing SHADOW (`GET /api/v1/insights/routing`).
 * Every function runs inside the caller's read-only tenant transaction (`insightsRead`: app.tenant_id set, RLS
 * FORCE applies) and additionally matches `tenant_id = fr_current_tenant()` with tenant-matched joins. All
 * inputs are bound parameters. Nothing here writes. The rows feed the pure `intelligence/routing.ts`.
 */
import { safeInt } from './insights.js';
import { unwrapRawTx, type TenantTx } from './tenant.js';

export interface RoutingPeriod {
  from: Date;
  to: Date;
}

function checkPeriod(p: RoutingPeriod): void {
  if (!(p.from instanceof Date) || !(p.to instanceof Date) || Number.isNaN(p.from.getTime()) || Number.isNaN(p.to.getTime()) || p.from >= p.to) {
    throw new RangeError('invalid period');
  }
}

function checkLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new RangeError('invalid limit');
}

export interface DecisionEventRow {
  packetId: string;
  claimId: string;
  packetCreatedAt: Date;
  decidedAt: Date;
  actorId: string;
  actorName: string;
  actorRole: string;
  action: 'APPROVE' | 'REJECT';
  /** created_by_id of the decided revision (null for revisions without an author). */
  authorId: string | null;
  /** Distinct finding rule ids of the decided revision, as stored (unsorted). */
  ruleIds: string[];
}

/**
 * The first APPROVE/REJECT decision of each packet revision that lies in the period, with the revision's
 * creation time (clock start), its author and its finding rules; decided_at ascending. Reads one row more
 * than `limit` so the caller can tell a cap from an exact fit. Restricting the scan to rows before `to` does
 * not change which row is first for rows inside the period.
 */
export async function firstDecisionEvents(tx: TenantTx, p: RoutingPeriod, limit: number): Promise<{ rows: DecisionEventRow[]; truncated: boolean }> {
  checkPeriod(p);
  checkLimit(limit);
  const rows = await unwrapRawTx(tx).$queryRaw<
    {
      packet_id: string;
      claim_id: string;
      packet_created_at: Date;
      decided_at: Date;
      actor_id: string;
      actor_name: string;
      actor_role: string;
      action: 'APPROVE' | 'REJECT';
      author_id: string | null;
      rule_ids: string[] | null;
    }[]
  >`
    WITH firsts AS (
      SELECT DISTINCT ON (a.packet_id) a.packet_id, a.claim_id, a.tenant_id, a.created_at, a.actor_id, a.actor_role, a.action
      FROM approvals a
      WHERE a.tenant_id = fr_current_tenant() AND a.action IN ('APPROVE', 'REJECT') AND a.created_at < ${p.to}::timestamptz
      ORDER BY a.packet_id, a.created_at ASC, a.id ASC
    )
    SELECT f.packet_id::text AS packet_id, f.claim_id::text AS claim_id, p.created_at AS packet_created_at, f.created_at AS decided_at,
           f.actor_id::text AS actor_id, u.name AS actor_name, f.actor_role, f.action::text AS action, p.created_by_id::text AS author_id,
           (SELECT array_agg(DISTINCT pf.rule_id) FROM packet_findings pf WHERE pf.packet_id = p.id AND pf.tenant_id = p.tenant_id) AS rule_ids
    FROM firsts f
    JOIN evidence_packets p ON p.id = f.packet_id AND p.tenant_id = f.tenant_id
    JOIN claims c ON c.id = f.claim_id AND c.tenant_id = f.tenant_id
    JOIN users u ON u.id = f.actor_id
    WHERE f.created_at >= ${p.from}::timestamptz
    ORDER BY f.created_at ASC, f.packet_id ASC
    LIMIT ${limit + 1}`;
  const truncated = rows.length > limit;
  return {
    truncated,
    rows: rows.slice(0, limit).map((r) => ({
      packetId: r.packet_id,
      claimId: r.claim_id,
      packetCreatedAt: r.packet_created_at,
      decidedAt: r.decided_at,
      actorId: r.actor_id,
      actorName: r.actor_name,
      actorRole: r.actor_role,
      action: r.action,
      authorId: r.author_id,
      ruleIds: r.rule_ids ?? [],
    })),
  };
}

export interface ImportDecisionStatRow {
  actorId: string;
  decisions: number;
  /** Nearest-rank median of (first decision by this actor on a document - document created_at), or null. */
  p50Ms: number | null;
}

/** Import review decisions in the period, per actor: count and the median time from the document's creation. */
export async function importDecisionStats(tx: TenantTx, p: RoutingPeriod): Promise<ImportDecisionStatRow[]> {
  checkPeriod(p);
  const rows = await unwrapRawTx(tx).$queryRaw<{ actor_id: string; n: number; p50: bigint | null }[]>`
    WITH d AS (
      SELECT r.actor_id, r.document_id, r.created_at
      FROM import_review_decisions r
      WHERE r.tenant_id = fr_current_tenant() AND r.created_at >= ${p.from}::timestamptz AND r.created_at < ${p.to}::timestamptz
    ),
    firsts AS (
      SELECT DISTINCT ON (d.document_id, d.actor_id) d.actor_id, d.document_id, d.created_at FROM d ORDER BY d.document_id, d.actor_id, d.created_at ASC
    ),
    durations AS (
      SELECT f.actor_id, (extract(epoch FROM (f.created_at - doc.created_at)) * 1000)::bigint AS ms
      FROM firsts f
      JOIN import_documents doc ON doc.id = f.document_id AND doc.tenant_id = fr_current_tenant()
    )
    SELECT d.actor_id::text AS actor_id, count(*)::int AS n,
           (SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY x.ms) FROM durations x WHERE x.actor_id = d.actor_id) AS p50
    FROM d
    GROUP BY d.actor_id
    ORDER BY d.actor_id`;
  return rows.map((r) => ({ actorId: r.actor_id, decisions: safeInt(r.n), p50Ms: r.p50 === null ? null : Math.max(0, safeInt(r.p50)) }));
}

export interface OpenClaimRow {
  id: string;
  claimNumber: string;
  kind: 'FREIGHT' | 'OCEAN_DD';
  status: 'PENDING_REVIEW' | 'APPROVED';
  assignee: { id: string; name: string } | null;
  packet: { id: string; revision: number; createdAt: Date; authorId: string | null };
  ruleIds: string[];
}

/** Open claims (PENDING_REVIEW/APPROVED with a packet), oldest current revision first; one row over `limit` signals a cap. */
export async function openClaimsForRouting(tx: TenantTx, limit: number): Promise<{ rows: OpenClaimRow[]; truncated: boolean }> {
  checkLimit(limit);
  const rows = await unwrapRawTx(tx).$queryRaw<
    {
      id: string;
      claim_number: string;
      kind: 'FREIGHT' | 'OCEAN_DD';
      status: 'PENDING_REVIEW' | 'APPROVED';
      assignee_id: string | null;
      assignee_name: string | null;
      packet_id: string;
      revision: number;
      packet_created_at: Date;
      author_id: string | null;
      rule_ids: string[] | null;
    }[]
  >`
    SELECT c.id::text AS id, c.claim_number, c.kind::text AS kind, c.status::text AS status, c.assignee_id::text AS assignee_id, u.name AS assignee_name,
           l.id::text AS packet_id, l.revision, l.created_at AS packet_created_at, l.created_by_id::text AS author_id,
           (SELECT array_agg(DISTINCT pf.rule_id) FROM packet_findings pf WHERE pf.packet_id = l.id AND pf.tenant_id = c.tenant_id) AS rule_ids
    FROM claims c
    JOIN LATERAL (
      SELECT p.id, p.revision, p.created_at, p.created_by_id FROM evidence_packets p
      WHERE p.claim_id = c.id AND p.tenant_id = c.tenant_id
      ORDER BY p.revision DESC LIMIT 1
    ) l ON true
    LEFT JOIN users u ON u.id = c.assignee_id
    WHERE c.tenant_id = fr_current_tenant() AND c.status IN ('PENDING_REVIEW', 'APPROVED')
    ORDER BY l.created_at ASC, c.id ASC
    LIMIT ${limit + 1}`;
  const truncated = rows.length > limit;
  return {
    truncated,
    rows: rows.slice(0, limit).map((r) => ({
      id: r.id,
      claimNumber: r.claim_number,
      kind: r.kind,
      status: r.status,
      assignee: r.assignee_id !== null && r.assignee_name !== null ? { id: r.assignee_id, name: r.assignee_name } : null,
      packet: { id: r.packet_id, revision: r.revision, createdAt: r.packet_created_at, authorId: r.author_id },
      ruleIds: r.rule_ids ?? [],
    })),
  };
}

export interface OpenLoadRow {
  assigneeId: string;
  openClaims: number;
}

/** Open claims (PENDING_REVIEW/APPROVED) assigned right now, per assignee. */
export async function openLoadByAssignee(tx: TenantTx): Promise<OpenLoadRow[]> {
  const rows = await unwrapRawTx(tx).$queryRaw<{ assignee_id: string; n: number }[]>`
    SELECT c.assignee_id::text AS assignee_id, count(*)::int AS n
    FROM claims c
    WHERE c.tenant_id = fr_current_tenant() AND c.status IN ('PENDING_REVIEW', 'APPROVED') AND c.assignee_id IS NOT NULL
    GROUP BY c.assignee_id
    ORDER BY c.assignee_id`;
  return rows.map((r) => ({ assigneeId: r.assignee_id, openClaims: safeInt(r.n) }));
}

export interface PoolMemberRow {
  id: string;
  name: string;
  role: string;
  active: boolean;
}

/** Every member of the tenant with the user's name and whether the account is active (tenant Prisma client). */
export async function reviewerPool(tx: TenantTx): Promise<PoolMemberRow[]> {
  const rows = await tx.membership.findMany({ select: { userId: true, role: true, user: { select: { name: true, status: true } } }, orderBy: { userId: 'asc' } });
  return rows.map((m) => ({ id: m.userId, name: m.user.name, role: m.role, active: m.user.status === 'ACTIVE' }));
}