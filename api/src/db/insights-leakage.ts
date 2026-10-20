/**
 * REQ-20261018-exec-dashboard: read-only SQL of the leakage sections (L1 by billing party; L2 and L3 by
 * finding type). Same contract as `insights.ts`: every function runs inside the CALLER's read-only tenant
 * transaction opened by `insightsRead`, every claim scan goes through `claimFilter` (tenant_id =
 * fr_current_tenant() plus the kind/perspective filter with tenant-matched joins), all inputs are bound
 * parameters, and bigint sums are converted with `safeInt`. Split out of `insights.ts` to keep both files
 * under the 500-line limit.
 */
import { checkCarrier, checkPeriod, claimFilter, safeInt, type InsightsFilter, type InsightsPeriod } from './insights.js';
import { unwrapRawTx, type TenantTx } from './tenant.js';

const LIMIT_MAX = 50;

// ---------------------------------------------------------------------------------------------
// L1 (by billing party)
// ---------------------------------------------------------------------------------------------

export interface CarrierTotals {
  claimCount: number;
  recoverableCents: number;
  pendingReviewCents: number;
  carrierCount: number;
}

export interface CarrierRow {
  carrierKey: string;
  displayName: string;
  claimCount: number;
  recoverableCents: number;
  pendingReviewCents: number;
}

/** Totals over claims created in the period, the top `limit` keys and their display names (3 statements). */
export async function carrierLeakage(tx: TenantTx, f: InsightsFilter, p: InsightsPeriod, limit: number): Promise<{ totals: CarrierTotals; rows: CarrierRow[] }> {
  checkPeriod(p);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > LIMIT_MAX) throw new RangeError('invalid limit');
  const raw = unwrapRawTx(tx);
  const F = claimFilter(f);
  const totals = await raw.$queryRaw<{ n: number; rec: bigint; pend: bigint; keys: number }[]>`
    SELECT count(*)::int AS n, COALESCE(sum(c.recoverable_cents), 0)::bigint AS rec,
           COALESCE(sum(c.pending_review_cents), 0)::bigint AS pend, count(DISTINCT lower(btrim(c.carrier_name)))::int AS keys
    FROM claims c
    WHERE ${F} AND c.created_at >= ${p.from}::timestamptz AND c.created_at < ${p.to}::timestamptz`;
  const top = await raw.$queryRaw<{ k: string; n: number; rec: bigint; pend: bigint }[]>`
    SELECT lower(btrim(c.carrier_name)) AS k, count(*)::int AS n,
           COALESCE(sum(c.recoverable_cents), 0)::bigint AS rec, COALESCE(sum(c.pending_review_cents), 0)::bigint AS pend
    FROM claims c
    WHERE ${F} AND c.created_at >= ${p.from}::timestamptz AND c.created_at < ${p.to}::timestamptz
    GROUP BY lower(btrim(c.carrier_name))
    ORDER BY (COALESCE(sum(c.recoverable_cents), 0)::bigint + COALESCE(sum(c.pending_review_cents), 0)::bigint) DESC,
             lower(btrim(c.carrier_name)) COLLATE "C" ASC
    LIMIT ${limit}`;
  const names = new Map<string, string>();
  if (top.length > 0) {
    const keys = top.map((r) => r.k);
    const named = await raw.$queryRaw<{ k: string; name: string }[]>`
      SELECT DISTINCT ON (s.k) s.k, s.name
      FROM (
        SELECT lower(btrim(c.carrier_name)) AS k, btrim(c.carrier_name) AS name, count(*) AS n
        FROM claims c
        WHERE ${F} AND c.created_at >= ${p.from}::timestamptz AND c.created_at < ${p.to}::timestamptz
          AND lower(btrim(c.carrier_name)) = ANY(${keys}::text[])
        GROUP BY 1, 2
      ) s
      ORDER BY s.k, s.n DESC, s.name COLLATE "C" ASC`;
    for (const r of named) names.set(r.k, r.name);
  }
  const t = totals[0];
  if (!t) throw new Error('carrierLeakage: no totals row');
  return {
    totals: { claimCount: safeInt(t.n), recoverableCents: safeInt(t.rec), pendingReviewCents: safeInt(t.pend), carrierCount: safeInt(t.keys) },
    rows: top.map((r) => ({
      carrierKey: r.k,
      displayName: names.get(r.k) ?? r.k,
      claimCount: safeInt(r.n),
      recoverableCents: safeInt(r.rec),
      pendingReviewCents: safeInt(r.pend),
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// L2 / L3 (by finding type; current packet only)
// ---------------------------------------------------------------------------------------------

export interface RuleRow {
  ruleId: string;
  title: string;
  findingCount: number;
  overchargeIdentifiedCents: number;
  overchargePendingCents: number;
  underbilledIdentifiedCents: number;
  underbilledPendingCents: number;
}

/** The carrier key as PostgreSQL computes it and the most frequent spelling among matching claims (L3 header). */
export async function carrierHeader(tx: TenantTx, f: InsightsFilter, p: InsightsPeriod, carrier: string): Promise<{ carrierKey: string; displayName: string | null }> {
  checkPeriod(p);
  checkCarrier(carrier);
  const rows = await unwrapRawTx(tx).$queryRaw<{ k: string; name: string | null }[]>`
    SELECT lower(btrim(${carrier}::text)) AS k,
           (SELECT btrim(c.carrier_name)
              FROM claims c
             WHERE ${claimFilter(f)} AND c.created_at >= ${p.from}::timestamptz AND c.created_at < ${p.to}::timestamptz
               AND lower(btrim(c.carrier_name)) = lower(btrim(${carrier}::text))
             GROUP BY btrim(c.carrier_name)
             ORDER BY count(*) DESC, btrim(c.carrier_name) COLLATE "C" ASC
             LIMIT 1) AS name`;
  const r = rows[0];
  if (!r) throw new Error('carrierHeader: no row');
  return { carrierKey: r.k, displayName: r.name };
}

/**
 * Findings of the current packet (max revision) of claims created in the period, grouped by rule. Reads only
 * rule_id, title, direction, amount_cents, needs_human_review and ordinal from packet_findings.
 */
export async function ruleLeakage(tx: TenantTx, f: InsightsFilter, p: InsightsPeriod, carrier: string | null): Promise<RuleRow[]> {
  checkPeriod(p);
  if (carrier !== null) checkCarrier(carrier);
  const rows = await unwrapRawTx(tx).$queryRaw<{ rule_id: string; title: string; n: number; oi: bigint; op: bigint; ui: bigint; up: bigint }[]>`
    WITH cur AS (
      SELECT DISTINCT ON (p.claim_id) p.id, p.created_at
      FROM evidence_packets p
      JOIN claims c ON c.id = p.claim_id AND c.tenant_id = p.tenant_id
      WHERE ${claimFilter(f)} AND c.created_at >= ${p.from}::timestamptz AND c.created_at < ${p.to}::timestamptz
        AND (${carrier}::text IS NULL OR lower(btrim(c.carrier_name)) = lower(btrim(${carrier}::text)))
      ORDER BY p.claim_id, p.revision DESC
    )
    SELECT r.rule_id, r.title, r.n, r.oi, r.op, r.ui, r.up
    FROM (
      SELECT f.rule_id, count(*)::int AS n,
             COALESCE(sum(f.amount_cents) FILTER (WHERE f.direction = 'OVERCHARGE' AND NOT f.needs_human_review), 0)::bigint AS oi,
             COALESCE(sum(f.amount_cents) FILTER (WHERE f.direction = 'OVERCHARGE' AND f.needs_human_review), 0)::bigint AS op,
             COALESCE(sum(f.amount_cents) FILTER (WHERE f.direction = 'UNDERBILLED' AND NOT f.needs_human_review), 0)::bigint AS ui,
             COALESCE(sum(f.amount_cents) FILTER (WHERE f.direction = 'UNDERBILLED' AND f.needs_human_review), 0)::bigint AS up,
             (array_agg(f.title ORDER BY cur.created_at DESC, cur.id ASC, f.ordinal ASC))[1] AS title
      FROM packet_findings f
      JOIN cur ON f.packet_id = cur.id
      WHERE f.tenant_id = fr_current_tenant()
      GROUP BY f.rule_id
    ) r
    ORDER BY (r.oi + r.op + r.ui + r.up) DESC, r.rule_id COLLATE "C" ASC`;
  return rows.map((r) => ({
    ruleId: r.rule_id,
    title: r.title,
    findingCount: safeInt(r.n),
    overchargeIdentifiedCents: safeInt(r.oi),
    overchargePendingCents: safeInt(r.op),
    underbilledIdentifiedCents: safeInt(r.ui),
    underbilledPendingCents: safeInt(r.up),
  }));
}
