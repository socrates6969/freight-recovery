/**
 * REQ-20261018-exec-dashboard: unit coverage of the pure insights assembly (ISO weeks, buckets, hours,
 * basis points, M7 omission rules, L1 remainder identity, T5 threshold). No database.
 */
import { InsightsDeadlines, InsightsLeakage, InsightsStages, InsightsSummary, InsightsThroughput } from '@fr/shared';
import { describe, expect, it } from 'vitest';

import { safeInt } from '../src/db/insights.js';
import {
  basisPoints,
  carrierBody,
  ddShare,
  deadlinesBody,
  hours,
  isoWeekLabel,
  isoWeeksOf,
  rejectRate,
  stagesBody,
  summaryBody,
  throughputBody,
} from '../src/insights/service.js';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const NOF = { kind: null, perspective: null } as const;
const d = (s: string) => new Date(s);
const period = { from: d('2026-05-17T00:00:00Z'), to: d('2026-06-16T00:00:00Z') };

describe('insights helpers', () => {
  it('basisPoints floors in integer arithmetic and refuses b <= 0', () => {
    expect(basisPoints(1, 3)).toBe(3333);
    expect(basisPoints(2, 3)).toBe(6666);
    expect(basisPoints(5, 5)).toBe(10000);
    expect(basisPoints(0, 7)).toBe(0);
    expect(basisPoints(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBe(10000);
    expect(() => basisPoints(1, 0)).toThrow(RangeError);
  });

  it('hours rounds to one decimal', () => {
    expect(hours(0)).toBe(0);
    expect(hours(3_600_000)).toBe(1);
    expect(hours(5_400_000)).toBe(1.5);
    expect(hours(179_999)).toBe(0);
    expect(hours(180_000)).toBe(0.1);
  });

  it('ISO week labels follow ISO-8601 week-years', () => {
    expect(isoWeekLabel(d('2024-12-30T00:00:00Z'))).toBe('2025-W01');
    expect(isoWeekLabel(d('2020-12-28T00:00:00Z'))).toBe('2020-W53');
    expect(isoWeekLabel(d('2026-06-15T00:00:00Z'))).toBe('2026-W25');
    expect(isoWeekLabel(d('2027-01-04T00:00:00Z'))).toBe('2027-W01');
  });

  it('lists every intersecting week, starting at the Monday on or before `from`', () => {
    const w = isoWeeksOf({ from: d('2026-06-17T00:00:00Z'), to: d('2026-06-29T00:00:00Z') });
    expect(w).toEqual([
      { weekStart: '2026-06-15', isoWeek: '2026-W25' },
      { weekStart: '2026-06-22', isoWeek: '2026-W26' },
    ]);
    expect(isoWeeksOf({ from: d('2026-06-15T00:00:00Z'), to: d('2026-06-22T00:00:00.001Z') })).toHaveLength(2);
    const longest = isoWeeksOf({ from: d('2025-01-05T00:00:00Z'), to: d('2026-01-06T00:00:00Z') });
    expect(longest.length).toBeLessThanOrEqual(54);
  });

  it('safeInt refuses values beyond the safe integer range', () => {
    expect(safeInt(12n)).toBe(12);
    expect(safeInt(null)).toBe(0);
    expect(() => safeInt(2n ** 60n)).toThrow(RangeError);
  });
});

describe('insights bodies (M7, summary, stages)', () => {
  it('M7 omission rules and share', () => {
    expect(ddShare({ auditedInvoiceCount: 3, missingTotalCount: 1, totalDueCents: 500, identifiedCents: 100 })).toMatchObject({
      omittedReason: 'missing_total',
      shareBasisPoints: null,
      excludedInvoiceCount: 1,
    });
    expect(ddShare({ auditedInvoiceCount: 2, missingTotalCount: 0, totalDueCents: 0, identifiedCents: 0 })).toMatchObject({ omittedReason: 'zero_total', totalDueCents: null });
    expect(ddShare({ auditedInvoiceCount: 2, missingTotalCount: 0, totalDueCents: 30000, identifiedCents: 10000 })).toEqual({
      auditedInvoiceCount: 2,
      excludedInvoiceCount: 0,
      identifiedCents: 10000,
      totalDueCents: 30000,
      shareBasisPoints: 3333,
      omittedReason: null,
    });
  });

  it('summary: stages in fixed order with zeros, M1-M3 over open statuses, T4 = age > 7', () => {
    const body = summaryBody(
      NOW,
      period,
      NOF,
      [
        { status: 'APPROVED', claimCount: 2, recoverableCents: 500, pendingReviewCents: 0 },
        { status: 'PENDING_REVIEW', claimCount: 3, recoverableCents: 700, pendingReviewCents: 40 },
        { status: 'SEND_READY', claimCount: 1, recoverableCents: 900, pendingReviewCents: 0 },
      ],
      { readyToDemand: { claimCount: 1, cents: 900 }, identifiedInPeriod: { claimCount: 0, cents: 0 }, rejectedInPeriod: { claimCount: 0, cents: 0 } },
      { auditedInvoiceCount: 0, missingTotalCount: 0, totalDueCents: 0, identifiedCents: 0 },
      [
        { status: 'PENDING_REVIEW', bucket: 'd0to7', claimCount: 1 },
        { status: 'PENDING_REVIEW', bucket: 'd8to30', claimCount: 1 },
        { status: 'PENDING_REVIEW', bucket: 'over60', claimCount: 1 },
      ],
    );
    expect(InsightsSummary.parse(body)).toEqual(body);
    expect(body.stages.map((s) => [s.status, s.claimCount, s.cents])).toEqual([
      ['AWAITING_ANALYSIS', 0, 0],
      ['PENDING_REVIEW', 3, 700],
      ['APPROVED', 2, 500],
      ['SEND_READY', 1, 900],
      ['REJECTED', 0, 0],
    ]);
    expect(body.money).toMatchObject({ identifiedOpenCents: 1200, pendingReviewOpenCents: 40, approvedNotSendReadyCents: 500 });
    expect(body.reviewQueue).toEqual({ claimCount: 3, identifiedCents: 700, waitingOverThresholdCount: 2, thresholdDays: 7 });
    expect(body.meta).toEqual({ asOf: NOW.toISOString(), period: { from: period.from.toISOString(), to: period.to.toISOString() }, filters: NOF });
  });

  it('stages: S3/S4 null without a period; filled in fixed order with one', () => {
    const none = stagesBody(NOW, null, NOF, [], [], { inPeriod: null, needsReviewNow: 4 }, null);
    expect(InsightsStages.parse(none)).toEqual(none);
    expect(none.intake).toEqual({ scope: 'all_documents', inPeriod: null, needsReviewNow: 4 });
    expect(none.analysisFailures).toBeNull();
    expect(none.meta.period).toBeNull();
    const failures = {
      total: 3,
      byReason: [
        { reasonCode: 'fuel_check' as const, count: 1 },
        { reasonCode: 'input_values' as const, count: 2 },
      ],
    };
    const withP = stagesBody(NOW, period, NOF, [], [], { inPeriod: [{ status: 'FAILED', count: 2 }], needsReviewNow: 0 }, failures);
    expect(InsightsStages.parse(withP)).toEqual(withP);
    expect(withP.intake.inPeriod?.map((s) => s.status)).toEqual(['RECEIVED', 'NEEDS_REVIEW', 'ACCEPTED', 'REJECTED', 'FAILED']);
    expect(withP.analysisFailures?.byReason).toEqual([
      { reasonCode: 'input_values', count: 2 },
      { reasonCode: 'amount_out_of_range', count: 0 },
      { reasonCode: 'fuel_check', count: 1 },
    ]);
  });
});

describe('insights bodies (D1/D2, L1, throughput)', () => {
  it('deadlines: buckets by kind with zeros and the fixed labels', () => {
    const body = deadlinesBody(NOW, NOF, [
      { kind: 'OCEAN_DD', bucket: 'past', claimCount: 1, cents: 100 },
      { kind: 'FREIGHT', bucket: 'over90', claimCount: 2, cents: 250 },
    ]);
    expect(InsightsDeadlines.parse(body)).toEqual(body);
    expect(body.ddMitigationWindow.past).toEqual({ claimCount: 1, cents: 100 });
    expect(body.ddMitigationWindow.over14).toEqual({ claimCount: 0, cents: 0 });
    expect(body.freightInvoiceAge.over90).toEqual({ claimCount: 2, cents: 250 });
    expect(body.meta.period).toBeNull();
  });

  it('L1: rows plus the remainder add up exactly to the total', () => {
    const body = carrierBody(NOW, period, NOF, 2, { claimCount: 6, recoverableCents: 1000, pendingReviewCents: 200, carrierCount: 4 }, [
      { carrierKey: 'acme', displayName: 'Acme', claimCount: 3, recoverableCents: 600, pendingReviewCents: 100 },
      { carrierKey: 'beta', displayName: 'Beta', claimCount: 1, recoverableCents: 200, pendingReviewCents: 0 },
    ]);
    expect(InsightsLeakage.parse(body)).toEqual(body);
    expect(body.other).toEqual({ carrierCount: 2, claimCount: 2, identifiedCents: 200, pendingReviewCents: 100, shareBasisPoints: 2500 });
    expect(body.rows.map((r) => r.shareBasisPoints)).toEqual([5833, 1666]);
    const empty = carrierBody(NOW, period, NOF, 10, { claimCount: 0, recoverableCents: 0, pendingReviewCents: 0, carrierCount: 0 }, []);
    expect(empty.other.shareBasisPoints).toBe(0);
  });

  it('throughput: weeks filled, T5 omitted below five decisions', () => {
    expect(rejectRate(3, 1).rateBasisPoints).toBeNull();
    expect(rejectRate(4, 1).rateBasisPoints).toBe(2000);
    const body = throughputBody(
      NOW,
      { from: d('2026-06-01T00:00:00Z'), to: d('2026-06-15T00:00:00Z') },
      NOF,
      [
        { weekStart: '2026-06-08', action: 'APPROVE', count: 4 },
        { weekStart: '2026-06-08', action: 'REJECT', count: 2 },
        { weekStart: '2026-06-01', action: 'SEND_READY', count: 1 },
      ],
      { count: 3, p50Ms: 5_400_000, p90Ms: 7_200_000 },
      { count: 0, p50Ms: null, p90Ms: null },
    );
    expect(InsightsThroughput.parse(body)).toEqual(body);
    expect(body.weeks).toEqual([
      { isoWeek: '2026-W23', weekStart: '2026-06-01', approve: 0, reject: 0, sendReady: 1, edit: 0 },
      { isoWeek: '2026-W24', weekStart: '2026-06-08', approve: 4, reject: 2, sendReady: 0, edit: 0 },
    ]);
    expect(body.timeToFirstDecision).toEqual({ decisionCount: 3, medianHours: 1.5, p90Hours: 2 });
    expect(body.approvalToSendReady).toEqual({ decisionCount: 0, medianHours: null, p90Hours: null });
    expect(body.rejectRate).toEqual({ approveCount: 4, rejectCount: 2, rateBasisPoints: 3333, minimumDecisions: 5 });
  });
});
