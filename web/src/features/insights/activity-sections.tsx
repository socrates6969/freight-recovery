/**
 * Approval throughput (T1-T3, T5) and document intake / analysis failures (S3, S4) on the insights page
 * (REQ-20261018-exec-dashboard). Counts and durations only; no person-level figures.
 */
import { INSIGHTS_TEXT, type AnalysisFailureReason, type InsightsDurationDto, type InsightsStagesDto, type InsightsThroughputDto } from '@fr/shared';
import type { UseQueryResult } from '@tanstack/react-query';

import { hoursText, percentFromBasisPoints } from './insights-params';
import { QueryState, Section } from './section';

function durationText(d: InsightsDurationDto): string {
  if (d.decisionCount === 0) return 'No decisions in the period.';
  const n = d.decisionCount === 1 ? '1 decision' : `${d.decisionCount} decisions`;
  return `median ${hoursText(d.medianHours)}, 90th percentile ${hoursText(d.p90Hours)} (${n})`;
}

export function ThroughputSection({ q }: { q: UseQueryResult<InsightsThroughputDto> }) {
  return (
    <Section title="Approval throughput">
      <QueryState q={q}>
        {(d) => {
          const decided = d.rejectRate.approveCount + d.rejectRate.rejectCount;
          return (
            <>
              <table className="data-table mb-3 text-sm" aria-label="Approval throughput by week">
                <thead>
                  <tr>
                    <th scope="col">Week</th>
                    <th scope="col">Approved</th>
                    <th scope="col">Rejected</th>
                    <th scope="col">Marked ready to demand</th>
                    <th scope="col">Edited</th>
                  </tr>
                </thead>
                <tbody>
                  {d.weeks.map((w) => (
                    <tr key={w.isoWeek}>
                      <td>
                        {w.isoWeek} <span className="muted">({w.weekStart})</span>
                      </td>
                      <td className="num">{w.approve}</td>
                      <td className="num">{w.reject}</td>
                      <td className="num">{w.sendReady}</td>
                      <td className="num">{w.edit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="text-sm">
                <dt className="muted">Time from a new revision to the first approve or reject decision</dt>
                <dd className="mb-2">{durationText(d.timeToFirstDecision)}</dd>
                <dt className="muted">Time from approval to marked ready to demand</dt>
                <dd className="mb-2">{durationText(d.approvalToSendReady)}</dd>
                <dt className="muted">Reject rate</dt>
                <dd>
                  {d.rejectRate.rateBasisPoints === null
                    ? `Not shown: fewer than ${d.rejectRate.minimumDecisions} approve or reject decisions in the period`
                    : `${percentFromBasisPoints(d.rejectRate.rateBasisPoints)} (${d.rejectRate.rejectCount} rejected of ${decided} approve or reject decisions)`}
                </dd>
              </dl>
            </>
          );
        }}
      </QueryState>
    </Section>
  );
}

const DOC_STATUS_TEXT: Readonly<Record<string, string>> = Object.freeze({
  RECEIVED: 'Received',
  NEEDS_REVIEW: 'Needs review',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  FAILED: 'Failed',
});

const REASON_TEXT: Readonly<Record<AnalysisFailureReason, string>> = Object.freeze({
  input_values: 'Input values not usable',
  amount_out_of_range: 'Amount out of range',
  fuel_check: 'Fuel check could not run',
});

export function IntakeSection({ q }: { q: UseQueryResult<InsightsStagesDto> }) {
  return (
    <Section title="Document intake and analysis failures">
      <p className="muted mb-2 text-sm">{INSIGHTS_TEXT.intakeScopeNote}</p>
      <QueryState q={q}>
        {(d) => (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <table className="data-table text-sm" aria-label="Documents imported in the period">
              <thead>
                <tr>
                  <th scope="col">Document status</th>
                  <th scope="col">Imported in the period</th>
                </tr>
              </thead>
              <tbody>
                {(d.intake.inPeriod ?? []).map((s) => (
                  <tr key={s.status}>
                    <td>{DOC_STATUS_TEXT[s.status] ?? s.status}</td>
                    <td className="num">{s.count}</td>
                  </tr>
                ))}
                <tr>
                  <td>Needs review now</td>
                  <td className="num">{d.intake.needsReviewNow}</td>
                </tr>
              </tbody>
            </table>
            <table className="data-table text-sm" aria-label="Analysis failures in the period">
              <thead>
                <tr>
                  <th scope="col">Analysis failure reason</th>
                  <th scope="col">Failures in the period</th>
                </tr>
              </thead>
              <tbody>
                {(d.analysisFailures?.byReason ?? []).map((r) => (
                  <tr key={r.reasonCode}>
                    <td>{REASON_TEXT[r.reasonCode]}</td>
                    <td className="num">{r.count}</td>
                  </tr>
                ))}
                <tr>
                  <td>Total</td>
                  <td className="num">{d.analysisFailures?.total ?? 0}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </Section>
  );
}
