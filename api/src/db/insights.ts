/**
 * REQ-20261018-exec-dashboard: read-only SQL of the executive insights routes (the leakage sections L1-L3 live
 * in `insights-leakage.ts` and share these helpers). Every function runs inside
 * the CALLER's tenant transaction opened by `insightsRead` (app.tenant_id set, RLS FORCE applies, READ ONLY,
 * REPEATABLE READ) and additionally filters every claim scan on `tenant_id = fr_current_tenant()` with
 * tenant-matched joins (defense in depth). All inputs are bound parameters; nothing from a tenant row or a
 * request is interpolated into SQL. Money sums come back as bigint and are converted with `safeInt`.
 */
import { Prisma } from './client.js';
import { unwrapRawTx, type TenantDb, type TenantTx } from './tenant.js';

export type InsightsKind = 'FREIGHT' | 'OCEAN_DD';
export type InsightsPerspective = 'SHIPPER' | 'CARRIER';

export interface InsightsFilter {
  kind: InsightsKind | null;
  perspective: InsightsPerspective | null;
}

/** Half-open UTC period [from, to). */
export interface InsightsPeriod {
  from: Date;
  to: Date;
}

const CARRIER_MAX = 200;

/** One consistent, database-enforced read-only snapshot per request (spec 6.3). */
export async function insightsRead<T>(db: TenantDb, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return db.tx(
    async (tx) => {
      await unwrapRawTx(tx).$executeRaw`SET TRANSACTION READ ONLY`;
      return fn(tx);
    },
    { isolationLevel: 'RepeatableRead' },
  );
}

/** bigint/number from SQL to a safe integer number; anything else is an internal error (fixed 500). */
export function safeInt(v: bigint | number | null | undefined): number {
  const n = typeof v === 'bigint' ? Number(v) : (v ?? 0);
  if (!Number.isSafeInteger(n) || (typeof v === 'bigint' && BigInt(n) !== v)) throw new RangeError('aggregate out of range');
  return n;
}

function checkFilter(f: InsightsFilter): void {
  if (f.kind !== null && f.kind !== 'FREIGHT' && f.kind !== 'OCEAN_DD') throw new RangeError('invalid kind');
  if (f.perspective !== null && f.perspective !== 'SHIPPER' && f.perspective !== 'CARRIER') throw new RangeError('invalid perspective');
}

export function checkPeriod(p: InsightsPeriod): void {
  if (!(p.from instanceof Date) || !(p.to instanceof Date) || Number.isNaN(p.from.getTime()) || Number.isNaN(p.to.getTime()) || p.from >= p.to) {
    throw new RangeError('invalid period');
  }
}

function checkNow(now: Date): void {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new RangeError('invalid now');
}

export function checkCarrier(carrier: string): void {
  if (typeof carrier !== 'string' || carrier.length < 1 || carrier.length > CARRIER_MAX) throw new RangeError('invalid carrier');
}

/** F(c): the tenant, kind and perspective filter on alias `c` (bound parameters, enum casts as in worklistPage). */
export function claimFilter(f: InsightsFilter): Prisma.Sql {
  checkFilter(f);
  return Prisma.sql`c.tenant_id = fr_current_tenant()
      AND (${f.kind}::text IS NULL OR c.kind = ${f.kind}::text::"ClaimKind")
      AND (${f.perspective}::text IS NULL OR c.perspective = ${f.perspective}::text::"Perspective")`;
}

// ---------------------------------------------------------------------------------------------
// S1 / M1 / M2 / M3
// ---------------------------------------------------------------------------------------------

export interface StatusRow {
  status: string;
  claimCount: number;
  recoverableCents: number;
  pendingReviewCents: number;
}

export async function claimsByStatus(tx: TenantTx, f: InsightsFilter): Promise<StatusRow[]> {
  const rows = await unwrapRawTx(tx).$queryRaw<{ status: string; n: number; rec: bigint; pend: bigint }[]>`
    SELECT c.status::text AS status, count(*)::int AS n,
           COALESCE(sum(c.recoverable_cents), 0)::bigint AS rec, COALESCE(sum(c.pending_review_cents), 0)::bigint AS pend
    FROM claims c
    WHERE ${claimFilter(f)}
    GROUP BY c.status`;
  return rows.map((r) => ({ status: r.status, claimCount: safeInt(r.n), recoverableCents: safeInt(r.rec), pendingReviewCents: safeInt(r.pend) }));
}

// ---------------------------------------------------------------------------------------------
// M4 / M5 / M6
// ---------------------------------------------------------------------------------------------

export interface CountCentsRow {
  claimCount: number;
  cents: number;
}

export interface PeriodMoney {
  readyToDemand: CountCentsRow;
  identifiedInPeriod: CountCentsRow;
  rejectedInPeriod: CountCentsRow;
}

export async function periodMoney(tx: TenantTx, f: InsightsFilter, p: InsightsPeriod): Promise<PeriodMoney> {
  checkPeriod(p);
  const F = claimFilter(f);
  const rows = await unwrapRawTx(tx).$queryRaw<{ m4n: number; m4c: bigint; m5n: number; m5c: bigint; m6n: number; m6c: bigint }[]>`
    SELECT m4.n AS m4n, m4.c AS m4c, m5.n AS m5n, m5.c AS m5c, m6.n AS m6n, m6.c AS m6c
    FROM
      (SELECT count(*)::int AS n, COALESCE(sum(c.recoverable_cents), 0)::bigint AS c
         FROM claims c
        WHERE ${F}
          AND EXISTS (SELECT 1 FROM approvals a
                       WHERE a.tenant_id = c.tenant_id AND a.claim_id = c.id AND a.action = 'SEND_READY'
                         AND a.created_at >= ${p.from}::timestamptz AND a.created_at < ${p.to}::timestamptz)) m4,
      (SELECT count(*)::int AS n, COALESCE(sum(c.recoverable_cents), 0)::bigint AS c
         FROM claims c
        WHERE ${F}
          AND EXISTS (SELECT 1 FROM evidence_packets p
                       WHERE p.claim_id = c.id AND p.tenant_id = c.tenant_id AND p.revision = 1
                         AND p.created_at >= ${p.from}::timestamptz AND p.created_at < ${p.to}::timestamptz)) m5,
      (SELECT count(*)::int AS n, COALESCE(sum(c.recoverable_cents), 0)::bigint AS c
         FROM claims c
         JOIN LATERAL (
           SELECT a.action FROM approvals a
            WHERE a.tenant_id = c.tenant_id AND a.claim_id = c.id
              AND a.created_at >= ${p.from}::timestamptz AND a.created_at < ${p.to}::timestamptz
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT 1
         ) l ON true
        WHERE ${F} AND l.action = 'REJECT') m6`;
  const r = rows[0];
  if (!r) throw new Error('periodMoney: no row');
  return {
    readyToDemand: { claimCount: safeInt(r.m4n), cents: safeInt(r.m4c) },
    identifiedInPeriod: { claimCount: safeInt(r.m5n), cents: safeInt(r.m5c) },
    rejectedInPeriod: { claimCount: safeInt(r.m6n), cents: safeInt(r.m6c) },
  };
}

// ---------------------------------------------------------------------------------------------
// M7
// ---------------------------------------------------------------------------------------------

export interface DdShareRow {
  auditedInvoiceCount: number;
  missingTotalCount: number;
  totalDueCents: number;
  identifiedCents: number;
}

export async function ddShareTotals(tx: TenantTx, f: InsightsFilter): Promise<DdShareRow> {
  const rows = await unwrapRawTx(tx).$queryRaw<{ n: number; e: number; d: bigint; i: bigint }[]>`
    SELECT count(*)::int AS n,
           (count(*) FILTER (WHERE d.total_due_cents IS NULL))::int AS e,
           COALESCE(sum(d.total_due_cents), 0)::bigint AS d,
           COALESCE(sum(c.recoverable_cents), 0)::bigint AS i
    FROM dd_invoices d
    JOIN claims c ON c.id = d.claim_id AND c.tenant_id = d.tenant_id
    WHERE d.tenant_id = fr_current_tenant() AND d.status = 'AUDITED' AND ${claimFilter(f)}`;
  const r = rows[0];
  if (!r) throw new Error('ddShareTotals: no row');
  return { auditedInvoiceCount: safeInt(r.n), missingTotalCount: safeInt(r.e), totalDueCents: safeInt(r.d), identifiedCents: safeInt(r.i) };
}

// ---------------------------------------------------------------------------------------------
// S2 (and T4)
// ---------------------------------------------------------------------------------------------

export type AgeBucket = 'd0to7' | 'd8to30' | 'd31to60' | 'over60';

export interface AgeingRow {
  status: string;
  bucket: AgeBucket;
  claimCount: number;
}

/**
 * Open claims by status and whole days in the current stage. Entry time: AWAITING_ANALYSIS = claim created;
 * PENDING_REVIEW = current packet created; APPROVED = latest approvals row to APPROVED, else current packet.
 */
export async function ageingRows(tx: TenantTx, f: InsightsFilter, now: Date): Promise<AgeingRow[]> {
  checkNow(now);
  const rows = await unwrapRawTx(tx).$queryRaw<{ status: string; bucket: AgeBucket; n: number }[]>`
    SELECT x.status,
           CASE WHEN x.age <= 7 THEN 'd0to7' WHEN x.age <= 30 THEN 'd8to30' WHEN x.age <= 60 THEN 'd31to60' ELSE 'over60' END AS bucket,
           count(*)::int AS n
    FROM (
      SELECT c.status::text AS status,
             GREATEST(0, floor(extract(epoch FROM (${now}::timestamptz - COALESCE(
               CASE c.status
                 WHEN 'AWAITING_ANALYSIS' THEN c.created_at
                 WHEN 'PENDING_REVIEW' THEN cp.created_at
                 ELSE COALESCE(ap.created_at, cp.created_at)
               END, c.created_at))) / 86400))::int AS age
      FROM claims c
      LEFT JOIN LATERAL (
        SELECT p.created_at FROM evidence_packets p
         WHERE p.claim_id = c.id AND p.tenant_id = c.tenant_id
         ORDER BY p.revision DESC LIMIT 1
      ) cp ON true
      LEFT JOIN LATERAL (
        SELECT a.created_at FROM approvals a
         WHERE a.tenant_id = c.tenant_id AND a.claim_id = c.id AND a.to_status = 'APPROVED'
         ORDER BY a.created_at DESC, a.id DESC LIMIT 1
      ) ap ON true
      WHERE ${claimFilter(f)} AND c.status IN ('AWAITING_ANALYSIS', 'PENDING_REVIEW', 'APPROVED')
    ) x
    GROUP BY 1, 2`;
  return rows.map((r) => ({ status: r.status, bucket: r.bucket, claimCount: safeInt(r.n) }));
}

// ---------------------------------------------------------------------------------------------
// S3 (tenant Prisma client: ImportDocument is a tenant model)
// ---------------------------------------------------------------------------------------------

export interface IntakeCounts {
  inPeriod: { status: string; count: number }[] | null;
  needsReviewNow: number;
}

export async function intakeCounts(tx: TenantTx, p: InsightsPeriod | null): Promise<IntakeCounts> {
  let inPeriod: IntakeCounts['inPeriod'] = null;
  if (p !== null) {
    checkPeriod(p);
    const groups = await tx.importDocument.groupBy({ by: ['status'], where: { createdAt: { gte: p.from, lt: p.to } }, _count: { _all: true } });
    inPeriod = groups.map((g) => ({ status: g.status, count: safeInt(g._count._all) }));
  }
  const needsReviewNow = await tx.importDocument.count({ where: { status: 'NEEDS_REVIEW' } });
  return { inPeriod, needsReviewNow: safeInt(needsReviewNow) };
}

// ---------------------------------------------------------------------------------------------
// D1 / D2
// ---------------------------------------------------------------------------------------------

export interface DeadlineRow {
  kind: InsightsKind;
  bucket: string;
  claimCount: number;
  cents: number;
}

/** Open claims by kind and calendar-day bucket (UTC dates). `minDays` is DD_DISPUTE_MIN_DAYS. */
export async function deadlineRows(tx: TenantTx, f: InsightsFilter, now: Date, minDays: number): Promise<DeadlineRow[]> {
  checkNow(now);
  if (!Number.isSafeInteger(minDays) || minDays < 0) throw new RangeError('invalid minDays');
  const rows = await unwrapRawTx(tx).$queryRaw<{ kind: InsightsKind; bucket: string; n: number; c: bigint }[]>`
    SELECT x.kind,
           CASE
             WHEN x.inv IS NULL THEN 'dateMissing'
             WHEN x.kind = 'OCEAN_DD' THEN
               CASE WHEN (x.inv + ${minDays}::int) - x.today < 0 THEN 'past'
                    WHEN (x.inv + ${minDays}::int) - x.today <= 7 THEN 'd0to7'
                    WHEN (x.inv + ${minDays}::int) - x.today <= 14 THEN 'd8to14'
                    ELSE 'over14' END
             ELSE
               CASE WHEN GREATEST(0, x.today - x.inv) <= 30 THEN 'd0to30'
                    WHEN GREATEST(0, x.today - x.inv) <= 60 THEN 'd31to60'
                    WHEN GREATEST(0, x.today - x.inv) <= 90 THEN 'd61to90'
                    ELSE 'over90' END
           END AS bucket,
           count(*)::int AS n,
           COALESCE(sum(x.rec), 0)::bigint AS c
    FROM (
      SELECT c.kind::text AS kind, c.recoverable_cents AS rec,
             (c.invoice_date AT TIME ZONE 'UTC')::date AS inv,
             (${now}::timestamptz AT TIME ZONE 'UTC')::date AS today
      FROM claims c
      WHERE ${claimFilter(f)} AND c.status IN ('AWAITING_ANALYSIS', 'PENDING_REVIEW', 'APPROVED')
    ) x
    GROUP BY 1, 2`;
  return rows.map((r) => ({ kind: r.kind, bucket: r.bucket, claimCount: safeInt(r.n), cents: safeInt(r.c) }));
}

// ---------------------------------------------------------------------------------------------
// T1 / T2 / T3
// ---------------------------------------------------------------------------------------------

export interface WeekActionRow {
  weekStart: string;
  action: string;
  count: number;
}

/** Approvals rows in the period by UTC ISO week (its Monday as YYYY-MM-DD) and action. */
export async function approvalWeeks(tx: TenantTx, f: InsightsFilter, p: InsightsPeriod): Promise<WeekActionRow[]> {
  checkPeriod(p);
  const rows = await unwrapRawTx(tx).$queryRaw<{ week: string; action: string; n: number }[]>`
    SELECT to_char(date_trunc('week', a.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS week, a.action::text AS action, count(*)::int AS n
    FROM approvals a
    JOIN claims c ON c.id = a.claim_id AND c.tenant_id = a.tenant_id
    WHERE a.tenant_id = fr_current_tenant() AND ${claimFilter(f)}
      AND a.created_at >= ${p.from}::timestamptz AND a.created_at < ${p.to}::timestamptz
    GROUP BY 1, 2`;
  return rows.map((r) => ({ weekStart: r.week, action: r.action, count: safeInt(r.n) }));
}

export interface DurationStats {
  count: number;
  p50Ms: number | null;
  p90Ms: number | null;
}

function toStats(r: { n: number; p50: bigint | null; p90: bigint | null } | undefined): DurationStats {
  if (!r) throw new Error('duration: no row');
  const count = safeInt(r.n);
  if (count === 0) return { count, p50Ms: null, p90Ms: null };
  return { count, p50Ms: r.p50 === null ? null : safeInt(r.p50), p90Ms: r.p90 === null ? null : safeInt(r.p90) };
}

/**
 * T2: the first APPROVE/REJECT row of each packet, kept when it lies in the period and its claim passes F;
 * the clock starts at the decided revision's own created_at. Nearest-rank percentiles (percentile_disc).
 * Restricting the scan to rows before `to` does not change which row is first for rows inside the period.
 */
export async function firstDecisionDurations(tx: TenantTx, f: InsightsFilter, p: InsightsPeriod): Promise<DurationStats> {
  checkPeriod(p);
  const rows = await unwrapRawTx(tx).$queryRaw<{ n: number; p50: bigint | null; p90: bigint | null }[]>`
    WITH firsts AS (
      SELECT DISTINCT ON (a.packet_id) a.packet_id, a.claim_id, a.tenant_id, a.created_at
      FROM approvals a
      WHERE a.tenant_id = fr_current_tenant() AND a.action IN ('APPROVE', 'REJECT') AND a.created_at < ${p.to}::timestamptz
      ORDER BY a.packet_id, a.created_at ASC, a.id ASC
    )
    SELECT count(*)::int AS n,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY x.ms) AS p50,
           percentile_disc(0.9) WITHIN GROUP (ORDER BY x.ms) AS p90
    FROM (
      SELECT (extract(epoch FROM (fr.created_at - p.created_at)) * 1000)::bigint AS ms
      FROM firsts fr
      JOIN evidence_packets p ON p.id = fr.packet_id AND p.tenant_id = fr.tenant_id
      JOIN claims c ON c.id = fr.claim_id AND c.tenant_id = fr.tenant_id
      WHERE fr.created_at >= ${p.from}::timestamptz AND ${claimFilter(f)}
    ) x`;
  return toStats(rows[0]);
}

/** T3: SEND_READY rows in the period; duration from the latest APPROVE on the same packet at or before it. */
export async function sendReadyDurations(tx: TenantTx, f: InsightsFilter, p: InsightsPeriod): Promise<DurationStats> {
  checkPeriod(p);
  const rows = await unwrapRawTx(tx).$queryRaw<{ n: number; p50: bigint | null; p90: bigint | null }[]>`
    SELECT count(*)::int AS n,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY x.ms) AS p50,
           percentile_disc(0.9) WITHIN GROUP (ORDER BY x.ms) AS p90
    FROM (
      SELECT (extract(epoch FROM (s.created_at - ap.created_at)) * 1000)::bigint AS ms
      FROM approvals s
      JOIN claims c ON c.id = s.claim_id AND c.tenant_id = s.tenant_id
      JOIN LATERAL (
        SELECT a.created_at FROM approvals a
         WHERE a.tenant_id = s.tenant_id AND a.packet_id = s.packet_id AND a.action = 'APPROVE' AND a.created_at <= s.created_at
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT 1
      ) ap ON true
      WHERE s.tenant_id = fr_current_tenant() AND s.action = 'SEND_READY'
        AND s.created_at >= ${p.from}::timestamptz AND s.created_at < ${p.to}::timestamptz
        AND ${claimFilter(f)}
    ) x`;
  return toStats(rows[0]);
}
