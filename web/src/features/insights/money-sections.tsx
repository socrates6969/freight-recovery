/**
 * Insights sections over the summary, stages and dispute-window data (REQ-20261018-exec-dashboard). Every
 * amount goes through MoneyFigure, and its label word is visible next to it.
 */
import {
  DD_DEADLINE_RED_DAYS,
  DD_DISPUTE_WINDOW_NOTE,
  INSIGHTS_TEXT,
  type InsightsCountCentsDto,
  type InsightsDeadlinesDto,
  type InsightsMoneyLabel,
  type InsightsStageRowDto,
  type InsightsStagesDto,
  type InsightsSummaryDto,
} from '@fr/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { percentFromBasisPoints } from './insights-params';
import { MoneyFigure } from './MoneyFigure';
import { INSIGHTS_STATUS_TEXT, QueryState, Section } from './section';

function claimsText(n: number): string {
  return n === 1 ? '1 claim' : `${n} claims`;
}

function Figure({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div>
      <dt className="muted text-sm">{caption}</dt>
      <dd className="text-lg">{children}</dd>
    </div>
  );
}

function hasNoClaims(stages: readonly InsightsStageRowDto[]): boolean {
  return stages.every((s) => s.claimCount === 0);
}

function DdShare({ dd }: { dd: InsightsSummaryDto['money']['ddShare'] }) {
  if (dd.omittedReason === 'missing_total') {
    return <p className="text-sm">{`Not shown: ${dd.excludedInvoiceCount} audited D&D invoice(s) have no total due.`}</p>;
  }
  if (dd.omittedReason === 'zero_total' || dd.identifiedCents === null || dd.totalDueCents === null || dd.shareBasisPoints === null) {
    return <p className="text-sm">Not shown: no audited D&amp;D invoices with a total due.</p>;
  }
  return (
    <p className="text-sm">
      Identified as disputable on audited D&amp;D invoices: <MoneyFigure cents={dd.identifiedCents} label="identified" /> of{' '}
      <MoneyFigure cents={dd.totalDueCents} label="invoiced" /> ({percentFromBasisPoints(dd.shareBasisPoints)})
    </p>
  );
}

export function MoneySection({ q }: { q: UseQueryResult<InsightsSummaryDto> }) {
  return (
    <Section title="Money">
      <QueryState q={q}>
        {(d) => (
          <>
            {hasNoClaims(d.stages) ? <p className="muted mb-2">{INSIGHTS_TEXT.empty}</p> : null}
            <dl className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Figure caption="Identified on open claims">
                <MoneyFigure cents={d.money.identifiedOpenCents} label="identified" />
              </Figure>
              <Figure caption="Pending review on open claims">
                <MoneyFigure cents={d.money.pendingReviewOpenCents} label="pending review" />
              </Figure>
              <Figure caption="Approved, not yet marked ready to demand">
                <MoneyFigure cents={d.money.approvedNotSendReadyCents} label="approved" />
              </Figure>
              <Figure caption={`Ready to demand in the period (${claimsText(d.money.readyToDemand.claimCount)})`}>
                <MoneyFigure cents={d.money.readyToDemand.cents} label="ready to demand" />
              </Figure>
              <Figure caption={`Identified in the period (${claimsText(d.money.identifiedInPeriod.claimCount)})`}>
                <MoneyFigure cents={d.money.identifiedInPeriod.cents} label="identified" />
              </Figure>
              <Figure caption={`Identified on claims your reviewers rejected in the period (${claimsText(d.money.rejectedInPeriod.claimCount)})`}>
                <MoneyFigure cents={d.money.rejectedInPeriod.cents} label="identified" />
              </Figure>
              <Figure caption="Share of invoiced D&D totals identified">
                <DdShare dd={d.money.ddShare} />
              </Figure>
            </dl>
          </>
        )}
      </QueryState>
    </Section>
  );
}

const STAGE_LABEL: Readonly<Record<InsightsStageRowDto['status'], InsightsMoneyLabel>> = Object.freeze({
  AWAITING_ANALYSIS: 'identified',
  PENDING_REVIEW: 'identified',
  APPROVED: 'approved',
  SEND_READY: 'ready to demand',
  REJECTED: 'identified',
});

export function StagesSection({ q }: { q: UseQueryResult<InsightsSummaryDto> }) {
  return (
    <Section title="Claims by stage">
      <QueryState q={q}>
        {(d) => (
          <>
            {hasNoClaims(d.stages) ? <p className="muted mb-2">{INSIGHTS_TEXT.empty}</p> : null}
            <table className="data-table text-sm" aria-label="Claims by stage">
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Claims</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {d.stages.map((s) => (
                  <tr key={s.status}>
                    <td>{INSIGHTS_STATUS_TEXT[s.status]}</td>
                    <td className="num">{s.claimCount}</td>
                    <td>
                      <MoneyFigure cents={s.cents} label={STAGE_LABEL[s.status]} /> <span className="muted">{STAGE_LABEL[s.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-sm">
              Review queue: {claimsText(d.reviewQueue.claimCount)} pending review, <MoneyFigure cents={d.reviewQueue.identifiedCents} label="identified" />{' '}
              identified; {d.reviewQueue.waitingOverThresholdCount} waiting more than {d.reviewQueue.thresholdDays} days.
            </p>
          </>
        )}
      </QueryState>
    </Section>
  );
}

export function AgeingSection({ q }: { q: UseQueryResult<InsightsStagesDto> }) {
  return (
    <Section title="Time in stage">
      <QueryState q={q}>
        {(d) => (
          <table className="data-table text-sm" aria-label="Time in stage">
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">0-7 days</th>
                <th scope="col">8-30 days</th>
                <th scope="col">31-60 days</th>
                <th scope="col">Over 60 days</th>
              </tr>
            </thead>
            <tbody>
              {d.ageing.map((a) => (
                <tr key={a.status}>
                  <td>{INSIGHTS_STATUS_TEXT[a.status]}</td>
                  <td className="num">{a.buckets.d0to7}</td>
                  <td className="num">{a.buckets.d8to30}</td>
                  <td className="num">{a.buckets.d31to60}</td>
                  <td className="num">{a.buckets.over60}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </QueryState>
    </Section>
  );
}

function BucketTable({ label, rows }: { label: string; rows: readonly [string, InsightsCountCentsDto][] }) {
  return (
    <table className="data-table mb-3 text-sm" aria-label={label}>
      <caption className="muted mb-1 text-left text-sm">{label}</caption>
      <thead>
        <tr>
          <th scope="col">Days</th>
          <th scope="col">Claims</th>
          <th scope="col">Identified</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, b]) => (
          <tr key={name}>
            <td>{name}</td>
            <td className="num">{b.claimCount}</td>
            <td>
              <MoneyFigure cents={b.cents} label="identified" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DisputeWindowSection({ q }: { q: UseQueryResult<InsightsDeadlinesDto> }) {
  return (
    <Section title="Dispute windows and invoice age">
      <QueryState q={q}>
        {(d) => (
          <>
            <p className="mb-3 text-sm" data-testid="dd-closing-soon">
              <span className={d.ddMitigationWindow.d0to7.claimCount > 0 ? 'font-medium text-[var(--color-danger)]' : 'font-medium'}>
                {`${claimsText(d.ddMitigationWindow.d0to7.claimCount)} with a D&D dispute window closing within ${DD_DEADLINE_RED_DAYS} days`}
              </span>
              {d.ddMitigationWindow.past.claimCount > 0 ? <span className="muted">{` (${claimsText(d.ddMitigationWindow.past.claimCount)} already past the floor date)`}</span> : null}
            </p>
            <p className="muted mb-3 text-xs">{DD_DISPUTE_WINDOW_NOTE}</p>
            <BucketTable
              label={INSIGHTS_TEXT.ddWindowLabel}
              rows={[
                ['Already past', d.ddMitigationWindow.past],
                ['0-7 days', d.ddMitigationWindow.d0to7],
                ['8-14 days', d.ddMitigationWindow.d8to14],
                ['Over 14 days', d.ddMitigationWindow.over14],
                ['Date missing', d.ddMitigationWindow.dateMissing],
              ]}
            />
            <BucketTable
              label={INSIGHTS_TEXT.invoiceAgeLabel}
              rows={[
                ['0-30 days', d.freightInvoiceAge.d0to30],
                ['31-60 days', d.freightInvoiceAge.d31to60],
                ['61-90 days', d.freightInvoiceAge.d61to90],
                ['Over 90 days', d.freightInvoiceAge.over90],
                ['Date missing', d.freightInvoiceAge.dateMissing],
              ]}
            />
          </>
        )}
      </QueryState>
    </Section>
  );
}
