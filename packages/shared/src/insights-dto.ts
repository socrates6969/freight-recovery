/**
 * REQ-20261018-exec-dashboard: executive insights contract. Strict query schemas and strict response
 * schemas of the five read-only `/api/v1/insights/*` routes. Every figure is an aggregate over the caller's
 * own tenant data; money is integer cents and every amount carries one of INSIGHTS_MONEY_LABELS in the UI.
 * No field carries actors, users, lanes, origins or destinations.
 */
import { z } from 'zod';

import { ANALYSIS_FAILURE_REASONS } from './analysis-failure.js';
import { CLAIM_KINDS, PERSPECTIVES, singleLine } from './dto.js';
import { IMPORT_DOC_STATUSES } from './import-fields.js';

const count = z.int().min(0);
const cents = z.int().min(0);
const basisPoints = z.int().min(0);
const iso = z.string();

// ---------------------------------------------------------------------------------------------
// Fixed policy
// ---------------------------------------------------------------------------------------------

export const INSIGHTS_LIMIT_DEFAULT = 10;
export const INSIGHTS_LIMIT_MAX = 50;
export const INSIGHTS_PERIOD_MAX_DAYS = 366;
export const INSIGHTS_REJECT_RATE_MIN_DECISIONS = 5;
export const INSIGHTS_REVIEW_WAIT_DAYS = 7;
export const INSIGHTS_STATUS_ORDER = ['AWAITING_ANALYSIS', 'PENDING_REVIEW', 'APPROVED', 'SEND_READY', 'REJECTED'] as const;
export const INSIGHTS_OPEN_STATUSES = ['AWAITING_ANALYSIS', 'PENDING_REVIEW', 'APPROVED'] as const;
export const INSIGHTS_LEAKAGE_BY = ['carrier', 'rule'] as const;
export const INSIGHTS_MONEY_LABELS = ['identified', 'pending review', 'approved', 'ready to demand', 'invoiced', 'credited', 'paid'] as const;
export type InsightsStatus = (typeof INSIGHTS_STATUS_ORDER)[number];
export type InsightsOpenStatus = (typeof INSIGHTS_OPEN_STATUSES)[number];
export type InsightsMoneyLabel = (typeof INSIGHTS_MONEY_LABELS)[number];

const DAY_MS = 86_400_000;
const INSIGHTS_INSTANT_MAX_LENGTH = 24;
const INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z)?$/u;

/**
 * Parse `YYYY-MM-DD` (00:00:00.000Z that day) or `YYYY-MM-DDTHH:MM:SS[.sss]Z` into a Date. Returns null
 * unless the value is a real calendar date with a valid time (checked by rebuilding it with Date.UTC).
 */
export function parseInsightsInstant(value: string): Date | null {
  if (value.length > INSIGHTS_INSTANT_MAX_LENGTH) return null;
  const m = INSTANT_RE.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4] ?? '0');
  const mi = Number(m[5] ?? '0');
  const s = Number(m[6] ?? '0');
  const ms = m[7] === undefined ? 0 : Number(m[7].padEnd(3, '0'));
  if (h > 23 || mi > 59 || s > 59) return null;
  const back = new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms));
  if (Number.isNaN(back.getTime())) return null;
  // Date.UTC maps years 0-99 to 1900-1999; setUTCFullYear restores the literal year before comparing.
  back.setUTCFullYear(y, mo - 1, d);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  if (back.getUTCHours() !== h || back.getUTCMinutes() !== mi || back.getUTCSeconds() !== s) return null;
  return back;
}

/** A query instant: a string that transforms to a Date; an invalid value adds a custom issue on its own path. */
export const insightsInstant = z.string().transform((v, ctx) => {
  const d = parseInsightsInstant(v);
  if (d === null) {
    ctx.addIssue({ code: 'custom', message: 'invalid instant' });
    return z.NEVER;
  }
  return d;
});

const kind = z.enum(CLAIM_KINDS).optional();
const perspective = z.enum(PERSPECTIVES).optional();

/** Period refinement: from < to and at most INSIGHTS_PERIOD_MAX_DAYS long (issues on `to`). Shared with routing-dto.ts. */
export function checkInsightsPeriod(from: Date, to: Date, ctx: z.RefinementCtx): void {
  if (from.getTime() >= to.getTime()) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must be after from' });
    return;
  }
  if (to.getTime() - from.getTime() > INSIGHTS_PERIOD_MAX_DAYS * DAY_MS) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'period too long' });
  }
}

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

export const InsightsSummaryQuery = z
  .strictObject({ from: insightsInstant, to: insightsInstant, kind, perspective })
  .superRefine((q, ctx) => checkInsightsPeriod(q.from, q.to, ctx));
export type InsightsSummaryQueryInput = z.output<typeof InsightsSummaryQuery>;

export const InsightsStagesQuery = z
  .strictObject({ from: insightsInstant.optional(), to: insightsInstant.optional(), kind, perspective })
  .superRefine((q, ctx) => {
    if (q.from === undefined && q.to !== undefined) ctx.addIssue({ code: 'custom', path: ['from'], message: 'from and to go together' });
    else if (q.from !== undefined && q.to === undefined) ctx.addIssue({ code: 'custom', path: ['to'], message: 'from and to go together' });
    else if (q.from !== undefined && q.to !== undefined) checkInsightsPeriod(q.from, q.to, ctx);
  });
export type InsightsStagesQueryInput = z.output<typeof InsightsStagesQuery>;

export const InsightsDeadlinesQuery = z.strictObject({ kind, perspective });
export type InsightsDeadlinesQueryInput = z.output<typeof InsightsDeadlinesQuery>;

export const InsightsLeakageQuery = z
  .strictObject({
    from: insightsInstant,
    to: insightsInstant,
    kind,
    perspective,
    by: z.enum(INSIGHTS_LEAKAGE_BY),
    carrier: singleLine(1, 200).optional(),
    limit: z.coerce.number().int().min(1).max(INSIGHTS_LIMIT_MAX).default(INSIGHTS_LIMIT_DEFAULT),
  })
  .superRefine((q, ctx) => {
    checkInsightsPeriod(q.from, q.to, ctx);
    if (q.carrier !== undefined && q.by === 'carrier') ctx.addIssue({ code: 'custom', path: ['carrier'], message: 'carrier applies to by=rule only' });
  });
export type InsightsLeakageQueryInput = z.output<typeof InsightsLeakageQuery>;

export const InsightsThroughputQuery = z
  .strictObject({ from: insightsInstant, to: insightsInstant, kind, perspective })
  .superRefine((q, ctx) => checkInsightsPeriod(q.from, q.to, ctx));
export type InsightsThroughputQueryInput = z.output<typeof InsightsThroughputQuery>;

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export const InsightsCountCents = z.strictObject({ claimCount: count, cents });
export type InsightsCountCentsDto = z.infer<typeof InsightsCountCents>;

export const InsightsMeta = z.strictObject({
  asOf: iso,
  period: z.strictObject({ from: iso, to: iso }).nullable(),
  filters: z.strictObject({ kind: z.enum(CLAIM_KINDS).nullable(), perspective: z.enum(PERSPECTIVES).nullable() }),
});
export type InsightsMetaDto = z.infer<typeof InsightsMeta>;

/** One S1 row: claims in a status and the sum of their recoverable (identified) cents. */
export const InsightsStageRow = z.strictObject({ status: z.enum(INSIGHTS_STATUS_ORDER), claimCount: count, cents });
export type InsightsStageRowDto = z.infer<typeof InsightsStageRow>;

const stageRows = z.array(InsightsStageRow).length(INSIGHTS_STATUS_ORDER.length);

export const InsightsDdShare = z.strictObject({
  auditedInvoiceCount: count,
  excludedInvoiceCount: count,
  identifiedCents: cents.nullable(),
  totalDueCents: cents.nullable(),
  shareBasisPoints: basisPoints.nullable(),
  omittedReason: z.enum(['missing_total', 'zero_total']).nullable(),
});
export type InsightsDdShareDto = z.infer<typeof InsightsDdShare>;

export const InsightsSummary = z.strictObject({
  meta: InsightsMeta,
  money: z.strictObject({
    identifiedOpenCents: cents,
    pendingReviewOpenCents: cents,
    approvedNotSendReadyCents: cents,
    readyToDemand: InsightsCountCents,
    identifiedInPeriod: InsightsCountCents,
    rejectedInPeriod: InsightsCountCents,
    ddShare: InsightsDdShare,
  }),
  stages: stageRows,
  reviewQueue: z.strictObject({
    claimCount: count,
    identifiedCents: cents,
    waitingOverThresholdCount: count,
    thresholdDays: z.literal(INSIGHTS_REVIEW_WAIT_DAYS),
  }),
});
export type InsightsSummaryDto = z.infer<typeof InsightsSummary>;

export const InsightsAgeBuckets = z.strictObject({ d0to7: count, d8to30: count, d31to60: count, over60: count });
export type InsightsAgeBucketsDto = z.infer<typeof InsightsAgeBuckets>;

export const InsightsStages = z.strictObject({
  meta: InsightsMeta,
  stages: stageRows,
  ageing: z.array(z.strictObject({ status: z.enum(INSIGHTS_OPEN_STATUSES), buckets: InsightsAgeBuckets })).length(INSIGHTS_OPEN_STATUSES.length),
  intake: z.strictObject({
    scope: z.literal('all_documents'),
    inPeriod: z.array(z.strictObject({ status: z.enum(IMPORT_DOC_STATUSES), count })).length(IMPORT_DOC_STATUSES.length).nullable(),
    needsReviewNow: count,
  }),
  analysisFailures: z
    .strictObject({
      total: count,
      byReason: z.array(z.strictObject({ reasonCode: z.enum(ANALYSIS_FAILURE_REASONS), count })).length(ANALYSIS_FAILURE_REASONS.length),
    })
    .nullable(),
});
export type InsightsStagesDto = z.infer<typeof InsightsStages>;

export const InsightsDeadlines = z.strictObject({
  meta: InsightsMeta,
  ddMitigationWindow: z.strictObject({
    label: z.string(),
    regulation: z.literal('46 CFR 541.8(a)'),
    minimumDays: z.literal(30),
    past: InsightsCountCents,
    d0to7: InsightsCountCents,
    d8to14: InsightsCountCents,
    over14: InsightsCountCents,
    dateMissing: InsightsCountCents,
  }),
  freightInvoiceAge: z.strictObject({
    label: z.string(),
    d0to30: InsightsCountCents,
    d31to60: InsightsCountCents,
    d61to90: InsightsCountCents,
    over90: InsightsCountCents,
    dateMissing: InsightsCountCents,
  }),
});
export type InsightsDeadlinesDto = z.infer<typeof InsightsDeadlines>;

export const InsightsCarrierRow = z.strictObject({
  carrierKey: z.string(),
  displayName: z.string(),
  claimCount: count,
  identifiedCents: cents,
  pendingReviewCents: cents,
  shareBasisPoints: basisPoints,
});
export type InsightsCarrierRowDto = z.infer<typeof InsightsCarrierRow>;

export const InsightsRuleRow = z.strictObject({
  ruleId: z.string(),
  title: z.string(),
  findingCount: count,
  overcharge: z.strictObject({ identifiedCents: cents, pendingReviewCents: cents }),
  underbilled: z.strictObject({ identifiedCents: cents, pendingReviewCents: cents }),
});
export type InsightsRuleRowDto = z.infer<typeof InsightsRuleRow>;

export const InsightsLeakageByCarrier = z.strictObject({
  meta: InsightsMeta,
  by: z.literal('carrier'),
  limit: z.int().min(1).max(INSIGHTS_LIMIT_MAX),
  total: z.strictObject({ claimCount: count, identifiedCents: cents, pendingReviewCents: cents }),
  rows: z.array(InsightsCarrierRow).max(INSIGHTS_LIMIT_MAX),
  other: z.strictObject({ carrierCount: count, claimCount: count, identifiedCents: cents, pendingReviewCents: cents, shareBasisPoints: basisPoints }),
});
export type InsightsLeakageByCarrierDto = z.infer<typeof InsightsLeakageByCarrier>;

export const InsightsLeakageByRule = z.strictObject({
  meta: InsightsMeta,
  by: z.literal('rule'),
  carrier: z.strictObject({ carrierKey: z.string(), displayName: z.string().nullable() }).nullable(),
  rows: z.array(InsightsRuleRow),
});
export type InsightsLeakageByRuleDto = z.infer<typeof InsightsLeakageByRule>;

export const InsightsLeakage = z.discriminatedUnion('by', [InsightsLeakageByCarrier, InsightsLeakageByRule]);
export type InsightsLeakageDto = z.infer<typeof InsightsLeakage>;

export const InsightsDuration = z.strictObject({ decisionCount: count, medianHours: z.number().nullable(), p90Hours: z.number().nullable() });
export type InsightsDurationDto = z.infer<typeof InsightsDuration>;

export const InsightsWeek = z.strictObject({
  isoWeek: z.string().regex(/^\d{4}-W\d{2}$/u),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  approve: count,
  reject: count,
  sendReady: count,
  edit: count,
});
export type InsightsWeekDto = z.infer<typeof InsightsWeek>;

export const InsightsThroughput = z.strictObject({
  meta: InsightsMeta,
  weeks: z.array(InsightsWeek),
  timeToFirstDecision: InsightsDuration,
  approvalToSendReady: InsightsDuration,
  rejectRate: z.strictObject({
    approveCount: count,
    rejectCount: count,
    rateBasisPoints: basisPoints.nullable(),
    minimumDecisions: z.literal(INSIGHTS_REJECT_RATE_MIN_DECISIONS),
  }),
});
export type InsightsThroughputDto = z.infer<typeof InsightsThroughput>;
