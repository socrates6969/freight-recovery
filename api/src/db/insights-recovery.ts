/**
 * REQ-20261020-claim-outcomes: read-only SQL of the insights Recovery section. Same contract as `insights.ts`:
 * every function runs inside the CALLER's read-only tenant transaction opened by `insightsRead`, every claim
 * scan goes through `claimFilter` (tenant_id = fr_current_tenant() plus the kind/perspective filter with
 * tenant-matched joins), every outcome scan filters `tenant_id = fr_current_tenant()` as well, all inputs are
 * bound parameters and bigint sums are converted with `safeInt`. Reads claim_outcomes (kind, response, cents,
 * recorded_at), claims (status, recoverable_cents), evidence_packets (created_at, revision), approvals
 * (SEND_READY created_at) and packet_findings (rule_id, title, ordinal). Never the note text.
 */
import { Prisma } from './client.js';
import { checkPeriod, claimFilter, safeInt, type InsightsFilter, type InsightsPeriod } from './insights.js';
import { unwrapRawTx, type TenantTx } from './tenant.js';

/**
 * The latest OUTCOME row of each claim among the rows recorded in the period (recorded_at DESC, id DESC) for
 * claims passing F. Used as a CTE body by every reader below.
 */
function latestOutcomes(f: InsightsFilter, p: InsightsPeriod): Prisma.Sql {
  return Prisma.sql`
    SELECT DISTINCT ON (o.claim_id) o.claim_id, o.tenant_id, o.carrier_response, o.credited_cents, o.paid_cents
    FROM claim_outcomes o
    JOIN claims c ON c.id = o.claim_id AND c.tenant_id = o.tenant_id
    WHERE o.tenant_id = fr_current_tenant() AND o.kind = 'OUTCOME'
      AND o.recorded_at >= ${p.from}::timestamptz AND o.recorded_at < ${p.to}::timestamptz
      AND ${claimFilter(f)}
    ORDER BY o.claim_id, o.recorded_at DESC, o.id DESC`;
}

// ---------------------------------------------------------------------------------------------
// Claims with an outcome, by carrier response
// ---------------------------------------------------------------------------------------------

export interface RecoveryResponseRow {
  response: string;
  claimCount: number;
  identifiedCents: number;
  creditedCents: number;
  creditedClaimCount: number;
  paidCents: number;
  paidClaimCount: number;
}

export async function recoveryByResponse(tx: TenantTx, f: InsightsFilter, p: InsightsPeriod): Promise<RecoveryResponseRow[]> {
  checkPeriod(p);
  const rows = await unwrapRawTx(tx).$queryRaw<{ response: string; n: number; ident: bigint; cred: bigint; credn: number; paid: bigint; paidn: number }[]>`
    WITH lo AS (${latestOutcomes(f, p)})
    SELECT lo.carrier_response AS response, count(*)::int AS n,
           COALESCE(sum(c.recoverable_cents), 0)::bigint AS ident,
           COALESCE(sum(lo.credited_cents), 0)::bigint AS cred, (count(*) FILTER (WHERE lo.credited_cents IS NOT NULL))::int AS credn,
           COALESCE(sum(lo.paid_cents), 0)::bigint AS paid, (count(*) FILTER (WHERE lo.paid_cents IS NOT NULL))::int AS paidn
    FROM lo
    JOIN claims c ON c.id = lo.claim_id AND c.tenant_id = lo.tenant_id
    GROUP BY lo.carrier_response`;
  return rows.map((r) => ({
    response: r.response,
    claimCount: safeInt(r.n),
    identifiedCents: safeInt(r.ident),
    creditedCents: safeInt(r.cred),
    creditedClaimCount: safeInt(r.credn),
    paidCents: safeInt(r.paid),
    paidClaimCount: safeInt(r.paidn),
  }));
}

// ---------------------------------------------------------------------------------------------
// By finding type (current packet of each claim with an outcome)
// ---------------------------------------------------------------------------------------------

export interface RecoveryRuleRow {
  /** Empty for the mixed row. */
  ruleId: string;
  title: string;
  mixed: boolean;
  claimCount: number;
  findingsSent: number;
  findingsAccepted: number;
  findingsPartial: number;
  findingsRejected: number;
  identifiedCents: number;
  creditedCents: number;
}

/**
 * Findings of the current packet (max revision) of each claim with an outcome, grouped by the claim's single
 * rule id; claims whose packet holds several rule ids form one `mixed` row (credited cents belong to the claim
 * and are not split). Claims whose packet has no finding are left out of this breakdown.
 */
export async function recoveryByRule(tx: TenantTx, f: InsightsFilter, p: InsightsPeriod): Promise<RecoveryRuleRow[]> {
  checkPeriod(p);
  const rows = await unwrapRawTx(tx).$queryRaw<{ rule_id: string; mixed: boolean; title: string; claims: number; sent: number; acc: number; part: number; rej: number; ident: bigint; cred: bigint }[]>`
    WITH lo AS (${latestOutcomes(f, p)}),
    cur AS (
      SELECT DISTINCT ON (p.claim_id) p.claim_id, p.tenant_id, p.id, p.created_at
      FROM evidence_packets p
      JOIN lo ON lo.claim_id = p.claim_id AND lo.tenant_id = p.tenant_id
      ORDER BY p.claim_id, p.revision DESC
    ),
    per_claim AS (
      SELECT cur.claim_id, cur.created_at AS packet_created, lo.carrier_response, c.recoverable_cents, lo.credited_cents,
             count(fi.id)::int AS findings, count(DISTINCT fi.rule_id)::int AS rules, min(fi.rule_id) AS rule_id,
             (array_agg(fi.title ORDER BY fi.ordinal ASC))[1] AS title
      FROM cur
      JOIN lo ON lo.claim_id = cur.claim_id AND lo.tenant_id = cur.tenant_id
      JOIN claims c ON c.id = cur.claim_id AND c.tenant_id = cur.tenant_id
      LEFT JOIN packet_findings fi ON fi.packet_id = cur.id AND fi.tenant_id = cur.tenant_id
      GROUP BY cur.claim_id, cur.created_at, lo.carrier_response, c.recoverable_cents, lo.credited_cents
    )
    SELECT CASE WHEN pc.rules = 1 THEN pc.rule_id ELSE '' END AS rule_id, (pc.rules > 1) AS mixed,
           (array_agg(pc.title ORDER BY pc.packet_created DESC, pc.claim_id ASC))[1] AS title,
           count(*)::int AS claims, COALESCE(sum(pc.findings), 0)::int AS sent,
           COALESCE(sum(pc.findings) FILTER (WHERE pc.carrier_response = 'ACCEPTED'), 0)::int AS acc,
           COALESCE(sum(pc.findings) FILTER (WHERE pc.carrier_response = 'PARTIAL'), 0)::int AS part,
           COALESCE(sum(pc.findings) FILTER (WHERE pc.carrier_response = 'REJECTED'), 0)::int AS rej,
           COALESCE(sum(pc.recoverable_cents), 0)::bigint AS ident, COALESCE(sum(pc.credited_cents), 0)::bigint AS cred
    FROM per_claim pc
    WHERE pc.findings > 0
    GROUP BY 1, 2
    ORDER BY cred DESC, ident DESC, (CASE WHEN pc.rules = 1 THEN pc.rule_id ELSE '' END) COLLATE "C" ASC`;
  return rows.map((r) => ({
    ruleId: r.mixed ? '' : r.rule_id,
    title: r.title,
    mixed: r.mixed,
    claimCount: safeInt(r.claims),
    findingsSent: safeInt(r.sent),
    findingsAccepted: safeInt(r.acc),
    findingsPartial: safeInt(r.part),
    findingsRejected: safeInt(r.rej),
    identifiedCents: safeInt(r.ident),
    creditedCents: safeInt(r.cred),
  }));
}

// ---------------------------------------------------------------------------------------------
// Reviewer hours (approximation from approval timestamps) and audited-with-no-finding count
// ---------------------------------------------------------------------------------------------

export interface ReviewerSpan {
  /** Claims with an outcome that have both a current packet and a SEND_READY approval row. */
  claimCount: number;
  /** Sum of the per-claim spans, each capped at `capMs`. */
  totalMs: number;
}

/**
 * For each claim with an outcome: the time from its current packet's creation to its latest SEND_READY
 * approval, floored at 0 and capped at `capMs`. Claims without a packet or a SEND_READY row are left out.
 */
export async function reviewerSpan(tx: TenantTx, f: InsightsFilter, p: InsightsPeriod, capMs: number): Promise<ReviewerSpan> {
  checkPeriod(p);
  if (!Number.isSafeInteger(capMs) || capMs <= 0) throw new RangeError('invalid capMs');
  const rows = await unwrapRawTx(tx).$queryRaw<{ n: number; ms: bigint }[]>`
    WITH lo AS (${latestOutcomes(f, p)})
    SELECT count(*)::int AS n, COALESCE(sum(x.ms), 0)::bigint AS ms
    FROM (
      SELECT LEAST(${capMs}::bigint, GREATEST(0::bigint, (extract(epoch FROM (sr.created_at - cp.created_at)) * 1000)::bigint)) AS ms
      FROM lo
      JOIN LATERAL (
        SELECT p.created_at FROM evidence_packets p
         WHERE p.claim_id = lo.claim_id AND p.tenant_id = lo.tenant_id
         ORDER BY p.revision DESC LIMIT 1
      ) cp ON true
      JOIN LATERAL (
        SELECT a.created_at FROM approvals a
         WHERE a.tenant_id = lo.tenant_id AND a.claim_id = lo.claim_id AND a.action = 'SEND_READY'
         ORDER BY a.created_at DESC, a.id DESC LIMIT 1
      ) sr ON true
    ) x`;
  const r = rows[0];
  if (!r) throw new Error('reviewerSpan: no row');
  return { claimCount: safeInt(r.n), totalMs: safeInt(r.ms) };
}

/** Distinct claims with an AUDITED_NO_FINDING row recorded in the period (claims passing F). */
export async function auditedNoFindingCount(tx: TenantTx, f: InsightsFilter, p: InsightsPeriod): Promise<number> {
  checkPeriod(p);
  const rows = await unwrapRawTx(tx).$queryRaw<{ n: number }[]>`
    SELECT count(DISTINCT o.claim_id)::int AS n
    FROM claim_outcomes o
    JOIN claims c ON c.id = o.claim_id AND c.tenant_id = o.tenant_id
    WHERE o.tenant_id = fr_current_tenant() AND o.kind = 'AUDITED_NO_FINDING'
      AND o.recorded_at >= ${p.from}::timestamptz AND o.recorded_at < ${p.to}::timestamptz
      AND ${claimFilter(f)}`;
  return safeInt(rows[0]?.n);
}