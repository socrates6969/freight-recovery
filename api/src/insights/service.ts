/**
 * REQ-20261018-exec-dashboard: pure assembly of the executive insights bodies from the aggregates read by
 * `db/insights.ts` and `db/insights-leakage.ts` (no SQL, no database access here). Fills missing statuses, buckets and ISO weeks with
 * zeros, converts durations to hours and ratios to floored basis points. Every list has a fixed order.
 */
import {
  ANALYSIS_FAILURE_REASONS,
  DD_DISPUTE_MIN_DAYS,
  IMPORT_DOC_STATUSES,
  INSIGHTS_OPEN_STATUSES,
  INSIGHTS_REJECT_RATE_MIN_DECISIONS,
  INSIGHTS_REVIEW_WAIT_DAYS,
  INSIGHTS_STATUS_ORDER,
  INSIGHTS_TEXT,
  type InsightsAgeBucketsDto,
  type InsightsCountCentsDto,
  type InsightsDdShareDto,
  type InsightsDeadlinesDto,
  type InsightsDurationDto,
  type InsightsLeakageByCarrierDto,
  type InsightsLeakageByRuleDto,
  type InsightsMetaDto,
  type InsightsStageRowDto,
  type InsightsStagesDto,
  type InsightsSummaryDto,
  type InsightsThroughputDto,
  type InsightsWeekDto,
} from '@fr/shared';

import type { AnalysisFailureCounts } from '../audit/analysis-failures.js';
import type {
  AgeingRow,
  DdShareRow,
  DeadlineRow,
  DurationStats,
  InsightsFilter,
  InsightsPeriod,
  IntakeCounts,
  PeriodMoney,
  StatusRow,
  WeekActionRow,
} from '../db/insights.js';
import type { CarrierRow, CarrierTotals, RuleRow } from '../db/insights-leakage.js';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const MS_PER_TENTH_HOUR = 360_000;
const BASIS_POINTS = 10_000n;
/** A 366-day half-open period intersects at most 54 ISO weeks; the loop never runs longer. */
const MAX_WEEKS = 54;

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** floor(10000 * a / b) in integer arithmetic; defined only for b > 0 and a >= 0. */
export function basisPoints(a: number, b: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b <= 0) throw new RangeError('basisPoints: invalid input');
  return Number((BASIS_POINTS * BigInt(a)) / BigInt(b));
}

/** Hours with one decimal: Math.round(ms / 360000) / 10. */
export function hours(ms: number): number {
  return Math.round(ms / MS_PER_TENTH_HOUR) / 10;
}

/** The Monday 00:00Z on or before `d`. */
export function isoWeekStart(d: Date): Date {
  const day = Math.floor(d.getTime() / DAY_MS) * DAY_MS;
  const sinceMonday = (new Date(day).getUTCDay() + 6) % 7;
  return new Date(day - sinceMonday * DAY_MS);
}

/** ISO-8601 week-year and week number of the week starting on Monday `monday`, as `YYYY-Www`. */
export function isoWeekLabel(monday: Date): string {
  const thursday = new Date(monday.getTime() + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / WEEK_MS);
  return `${String(year).padStart(4, '0')}-W${String(week).padStart(2, '0')}`;
}

/** Every ISO week (Monday, UTC) that intersects [from, to), in ascending order. */
export function isoWeeksOf(p: InsightsPeriod): { weekStart: string; isoWeek: string }[] {
  const out: { weekStart: string; isoWeek: string }[] = [];
  let start = isoWeekStart(p.from);
  while (start.getTime() < p.to.getTime()) {
    if (out.length >= MAX_WEEKS) throw new RangeError('isoWeeksOf: period too long');
    out.push({ weekStart: start.toISOString().slice(0, 10), isoWeek: isoWeekLabel(start) });
    start = new Date(start.getTime() + WEEK_MS);
  }
  return out;
}

export function meta(now: Date, period: InsightsPeriod | null, f: InsightsFilter): InsightsMetaDto {
  return {
    asOf: now.toISOString(),
    period: period === null ? null : { from: period.from.toISOString(), to: period.to.toISOString() },
    filters: { kind: f.kind, perspective: f.perspective },
  };
}

function duration(s: DurationStats): InsightsDurationDto {
  return {
    decisionCount: s.count,
    medianHours: s.count === 0 || s.p50Ms === null ? null : hours(s.p50Ms),
    p90Hours: s.count === 0 || s.p90Ms === null ? null : hours(s.p90Ms),
  };
}

// ---------------------------------------------------------------------------------------------
// S1, M1-M3, S2, T4
// ---------------------------------------------------------------------------------------------

/** S1: all five statuses in INSIGHTS_STATUS_ORDER (zeros included); cents = sum of recoverable. */
export function stageRows(rows: readonly StatusRow[]): InsightsStageRowDto[] {
  return INSIGHTS_STATUS_ORDER.map((status) => {
    const r = rows.find((x) => x.status === status);
    return { status, claimCount: r?.claimCount ?? 0, cents: r?.recoverableCents ?? 0 };
  });
}

/** M1 (recoverable over OPEN), M2 (pending over OPEN), M3 (recoverable of APPROVED). */
export function openMoney(rows: readonly StatusRow[]): { identifiedOpenCents: number; pendingReviewOpenCents: number; approvedNotSendReadyCents: number } {
  const open = rows.filter((r) => (INSIGHTS_OPEN_STATUSES as readonly string[]).includes(r.status));
  return {
    identifiedOpenCents: open.reduce((s, r) => s + r.recoverableCents, 0),
    pendingReviewOpenCents: open.reduce((s, r) => s + r.pendingReviewCents, 0),
    approvedNotSendReadyCents: rows.find((r) => r.status === 'APPROVED')?.recoverableCents ?? 0,
  };
}

/** M7: omitted when a total is missing or the summed total is zero; otherwise the floored share. */
export function ddShare(r: DdShareRow): InsightsDdShareDto {
  const counts = { auditedInvoiceCount: r.auditedInvoiceCount, excludedInvoiceCount: r.missingTotalCount };
  if (r.missingTotalCount > 0) return { ...counts, identifiedCents: null, totalDueCents: null, shareBasisPoints: null, omittedReason: 'missing_total' };
  if (r.totalDueCents === 0) return { ...counts, identifiedCents: null, totalDueCents: null, shareBasisPoints: null, omittedReason: 'zero_total' };
  return {
    ...counts,
    identifiedCents: r.identifiedCents,
    totalDueCents: r.totalDueCents,
    shareBasisPoints: basisPoints(r.identifiedCents, r.totalDueCents),
    omittedReason: null,
  };
}

const ZERO_AGE: InsightsAgeBucketsDto = Object.freeze({ d0to7: 0, d8to30: 0, d31to60: 0, over60: 0 });

/** S2: the three open statuses in INSIGHTS_OPEN_STATUSES order, each with all four buckets. */
export function ageing(rows: readonly AgeingRow[]): InsightsStagesDto['ageing'] {
  return INSIGHTS_OPEN_STATUSES.map((status) => {
    const buckets: InsightsAgeBucketsDto = { ...ZERO_AGE };
    for (const r of rows) if (r.status === status) buckets[r.bucket] += r.claimCount;
    return { status, buckets };
  });
}

/** T4: the PENDING_REVIEW stage row plus the claims waiting more than INSIGHTS_REVIEW_WAIT_DAYS (age > 7). */
export function reviewQueue(stages: readonly InsightsStageRowDto[], age: InsightsStagesDto['ageing']): InsightsSummaryDto['reviewQueue'] {
  const pending = stages.find((s) => s.status === 'PENDING_REVIEW');
  const b = age.find((a) => a.status === 'PENDING_REVIEW')?.buckets ?? ZERO_AGE;
  return {
    claimCount: pending?.claimCount ?? 0,
    identifiedCents: pending?.cents ?? 0,
    waitingOverThresholdCount: b.d8to30 + b.d31to60 + b.over60,
    thresholdDays: INSIGHTS_REVIEW_WAIT_DAYS,
  };
}

export function summaryBody(
  now: Date,
  period: InsightsPeriod,
  f: InsightsFilter,
  statusRows: readonly StatusRow[],
  money: PeriodMoney,
  dd: DdShareRow,
  ageRows: readonly AgeingRow[],
): InsightsSummaryDto {
  const stages = stageRows(statusRows);
  return {
    meta: meta(now, period, f),
    money: { ...openMoney(statusRows), ...money, ddShare: ddShare(dd) },
    stages,
    reviewQueue: reviewQueue(stages, ageing(ageRows)),
  };
}

// ---------------------------------------------------------------------------------------------
// S3, S4
// ---------------------------------------------------------------------------------------------

export function stagesBody(
  now: Date,
  period: InsightsPeriod | null,
  f: InsightsFilter,
  statusRows: readonly StatusRow[],
  ageRows: readonly AgeingRow[],
  intake: IntakeCounts,
  failures: AnalysisFailureCounts | null,
): InsightsStagesDto {
  const inPeriod = intake.inPeriod;
  return {
    meta: meta(now, period, f),
    stages: stageRows(statusRows),
    ageing: ageing(ageRows),
    intake: {
      scope: 'all_documents',
      inPeriod:
        inPeriod === null
          ? null
          : IMPORT_DOC_STATUSES.map((status) => ({ status, count: inPeriod.filter((g) => g.status === status).reduce((s, g) => s + g.count, 0) })),
      needsReviewNow: intake.needsReviewNow,
    },
    analysisFailures:
      failures === null
        ? null
        : {
            total: failures.total,
            byReason: ANALYSIS_FAILURE_REASONS.map((reasonCode) => ({ reasonCode, count: failures.byReason.find((r) => r.reasonCode === reasonCode)?.count ?? 0 })),
          },
  };
}

// ---------------------------------------------------------------------------------------------
// D1, D2
// ---------------------------------------------------------------------------------------------

function bucketOf(rows: readonly DeadlineRow[], kind: DeadlineRow['kind'], bucket: string): InsightsCountCentsDto {
  const hits = rows.filter((r) => r.kind === kind && r.bucket === bucket);
  return { claimCount: hits.reduce((s, r) => s + r.claimCount, 0), cents: hits.reduce((s, r) => s + r.cents, 0) };
}

export function deadlinesBody(now: Date, f: InsightsFilter, rows: readonly DeadlineRow[]): InsightsDeadlinesDto {
  return {
    meta: meta(now, null, f),
    ddMitigationWindow: {
      label: INSIGHTS_TEXT.ddWindowLabel,
      regulation: '46 CFR 541.8(a)',
      minimumDays: DD_DISPUTE_MIN_DAYS,
      past: bucketOf(rows, 'OCEAN_DD', 'past'),
      d0to7: bucketOf(rows, 'OCEAN_DD', 'd0to7'),
      d8to14: bucketOf(rows, 'OCEAN_DD', 'd8to14'),
      over14: bucketOf(rows, 'OCEAN_DD', 'over14'),
      dateMissing: bucketOf(rows, 'OCEAN_DD', 'dateMissing'),
    },
    freightInvoiceAge: {
      label: INSIGHTS_TEXT.invoiceAgeLabel,
      d0to30: bucketOf(rows, 'FREIGHT', 'd0to30'),
      d31to60: bucketOf(rows, 'FREIGHT', 'd31to60'),
      d61to90: bucketOf(rows, 'FREIGHT', 'd61to90'),
      over90: bucketOf(rows, 'FREIGHT', 'over90'),
      dateMissing: bucketOf(rows, 'FREIGHT', 'dateMissing'),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// L1, L2, L3
// ---------------------------------------------------------------------------------------------

/** L1: the top rows plus one remainder row; rows + other add up exactly to total. */
export function carrierBody(now: Date, period: InsightsPeriod, f: InsightsFilter, limit: number, totals: CarrierTotals, rows: readonly CarrierRow[]): InsightsLeakageByCarrierDto {
  const totalValue = totals.recoverableCents + totals.pendingReviewCents;
  const share = (v: number) => (totalValue === 0 ? 0 : basisPoints(v, totalValue));
  const sum = (pick: (r: CarrierRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const otherRec = totals.recoverableCents - sum((r) => r.recoverableCents);
  const otherPend = totals.pendingReviewCents - sum((r) => r.pendingReviewCents);
  return {
    meta: meta(now, period, f),
    by: 'carrier',
    limit,
    total: { claimCount: totals.claimCount, identifiedCents: totals.recoverableCents, pendingReviewCents: totals.pendingReviewCents },
    rows: rows.map((r) => ({
      carrierKey: r.carrierKey,
      displayName: r.displayName,
      claimCount: r.claimCount,
      identifiedCents: r.recoverableCents,
      pendingReviewCents: r.pendingReviewCents,
      shareBasisPoints: share(r.recoverableCents + r.pendingReviewCents),
    })),
    other: {
      carrierCount: totals.carrierCount - rows.length,
      claimCount: totals.claimCount - sum((r) => r.claimCount),
      identifiedCents: otherRec,
      pendingReviewCents: otherPend,
      shareBasisPoints: share(otherRec + otherPend),
    },
  };
}

/** L2 (carrier null) or L3 (carrier header set). Rows arrive in their final order from SQL. */
export function ruleBody(
  now: Date,
  period: InsightsPeriod,
  f: InsightsFilter,
  carrier: { carrierKey: string; displayName: string | null } | null,
  rows: readonly RuleRow[],
): InsightsLeakageByRuleDto {
  return {
    meta: meta(now, period, f),
    by: 'rule',
    carrier,
    rows: rows.map((r) => ({
      ruleId: r.ruleId,
      title: r.title,
      findingCount: r.findingCount,
      overcharge: { identifiedCents: r.overchargeIdentifiedCents, pendingReviewCents: r.overchargePendingCents },
      underbilled: { identifiedCents: r.underbilledIdentifiedCents, pendingReviewCents: r.underbilledPendingCents },
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// T1, T2, T3, T5
// ---------------------------------------------------------------------------------------------

const ACTION_FIELD: Readonly<Record<string, 'approve' | 'reject' | 'sendReady' | 'edit'>> = Object.freeze({
  APPROVE: 'approve',
  REJECT: 'reject',
  SEND_READY: 'sendReady',
  EDIT: 'edit',
});

/** T1: every ISO week intersecting the period with its four action counts (missing = 0). */
export function weeks(period: InsightsPeriod, rows: readonly WeekActionRow[]): InsightsWeekDto[] {
  return isoWeeksOf(period).map(({ weekStart, isoWeek }) => {
    const w: InsightsWeekDto = { isoWeek, weekStart, approve: 0, reject: 0, sendReady: 0, edit: 0 };
    for (const r of rows) {
      const field = ACTION_FIELD[r.action];
      if (r.weekStart === weekStart && field !== undefined) w[field] += r.count;
    }
    return w;
  });
}

/** T5: omitted below INSIGHTS_REJECT_RATE_MIN_DECISIONS approve + reject decisions. */
export function rejectRate(approveCount: number, rejectCount: number): InsightsThroughputDto['rejectRate'] {
  const decided = approveCount + rejectCount;
  return {
    approveCount,
    rejectCount,
    rateBasisPoints: decided < INSIGHTS_REJECT_RATE_MIN_DECISIONS ? null : basisPoints(rejectCount, decided),
    minimumDecisions: INSIGHTS_REJECT_RATE_MIN_DECISIONS,
  };
}

export function throughputBody(
  now: Date,
  period: InsightsPeriod,
  f: InsightsFilter,
  weekRows: readonly WeekActionRow[],
  firstDecision: DurationStats,
  sendReady: DurationStats,
): InsightsThroughputDto {
  const w = weeks(period, weekRows);
  return {
    meta: meta(now, period, f),
    weeks: w,
    timeToFirstDecision: duration(firstDecision),
    approvalToSendReady: duration(sendReady),
    rejectRate: rejectRate(
      w.reduce((s, x) => s + x.approve, 0),
      w.reduce((s, x) => s + x.reject, 0),
    ),
  };
}
