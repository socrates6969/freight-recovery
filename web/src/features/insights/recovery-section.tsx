/**
 * REQ-20261020-claim-outcomes: the Recovery section of the insights page. Everything here comes from
 * outcomes typed in by the tenant's own team (the API says `basis: 'human_entered'`); the copy states the
 * basis and the reviewer-hour approximation. Amounts go through MoneyFigure with the labels identified,
 * credited and paid.
 */
import { CARRIER_RESPONSE_TEXT, OUTCOME_TEXT, type InsightsRecoveryDto } from '@fr/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { formatUsdCents } from '../../lib/format';

import { hoursText, percentFromBasisPoints } from './insights-params';
import { MoneyFigure } from './MoneyFigure';
import { QueryState, Section } from './section';

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

const RESPONSE_ROWS: readonly [keyof InsightsRecoveryDto['responses'], string][] = [
  ['accepted', CARRIER_RESPONSE_TEXT.ACCEPTED],
  ['partial', CARRIER_RESPONSE_TEXT.PARTIAL],
  ['rejected', CARRIER_RESPONSE_TEXT.REJECTED],
  ['disputed', CARRIER_RESPONSE_TEXT.DISPUTED],
  ['withdrawn', CARRIER_RESPONSE_TEXT.WITHDRAWN],
  ['noneYet', CARRIER_RESPONSE_TEXT.NONE_YET],
];

function rateText(bp: number | null): string {
  return bp === null ? 'Not shown: nothing identified' : percentFromBasisPoints(bp);
}

export function RecoverySection({ q }: { q: UseQueryResult<InsightsRecoveryDto> }) {
  return (
    <Section title={OUTCOME_TEXT.recoveryTitle}>
      <p className="muted mb-2 text-sm">{OUTCOME_TEXT.recoveryIntro}</p>
      <QueryState q={q}>
        {(d) => (
          <>
            {d.sent.claimCount === 0 && d.auditedNoFinding.claimCount === 0 ? <p className="muted mb-2">{OUTCOME_TEXT.recoveryEmpty}</p> : null}
            <dl className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <Figure caption={`Identified on claims with an outcome (${claimsText(d.sent.claimCount)})`}>
                <MoneyFigure cents={d.sent.identifiedCents} label="identified" />
              </Figure>
              <Figure caption={`Credited (${claimsText(d.credited.claimCount)})`}>
                <MoneyFigure cents={d.credited.cents} label="credited" />
              </Figure>
              <Figure caption={`Paid (${claimsText(d.paid.claimCount)})`}>
                <MoneyFigure cents={d.paid.cents} label="paid" />
              </Figure>
              <Figure caption={`Credited as a share of identified (${claimsText(d.recoveryRate.claimCount)})`}>
                <span className="num">{rateText(d.recoveryRate.rateBasisPoints)}</span>
              </Figure>
              <Figure caption={`Reviewer hours, approximated (${claimsText(d.reviewerHours.claimCount)})`}>
                <span className="num">{hoursText(d.reviewerHours.hours)}</span>
              </Figure>
              <Figure caption="Credited per reviewer-hour">
                {d.reviewerHours.creditedPerHourCents === null ? (
                  <span className="muted">Not shown: no reviewer hours</span>
                ) : (
                  <>
                    <MoneyFigure cents={d.reviewerHours.creditedPerHourCents} label="credited" /> <span className="muted text-sm">per hour</span>
                  </>
                )}
              </Figure>
              <Figure caption={OUTCOME_TEXT.noFindingLabel}>
                <span className="num">{d.auditedNoFinding.claimCount}</span>
              </Figure>
            </dl>
            <p className="muted mb-3 text-xs">{d.reviewerHours.approximation}</p>
            <table className="data-table mb-3 text-sm" aria-label="Carrier responses">
              <caption className="muted mb-1 text-left text-sm">Carrier responses (latest outcome per claim)</caption>
              <thead>
                <tr>
                  <th scope="col">Response</th>
                  <th scope="col">Claims</th>
                  <th scope="col">Identified</th>
                </tr>
              </thead>
              <tbody>
                {RESPONSE_ROWS.map(([key, label]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    <td className="num">{d.responses[key].claimCount}</td>
                    <td>
                      <MoneyFigure cents={d.responses[key].identifiedCents} label="identified" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="data-table text-sm" aria-label="Recovery by finding type">
              <caption className="muted mb-1 text-left text-sm">By finding type (current packet of each claim with an outcome)</caption>
              <thead>
                <tr>
                  <th scope="col">Finding type</th>
                  <th scope="col">Claims</th>
                  <th scope="col">Findings sent</th>
                  <th scope="col">Accepted</th>
                  <th scope="col">Partly</th>
                  <th scope="col">Rejected</th>
                  <th scope="col">Identified</th>
                  <th scope="col">Credited</th>
                  <th scope="col">Credited / identified</th>
                </tr>
              </thead>
              <tbody>
                {d.byRule.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="muted">
                      No findings on claims with an outcome in the period.
                    </td>
                  </tr>
                ) : null}
                {d.byRule.map((r) => (
                  <tr key={r.mixed ? 'mixed' : r.ruleId}>
                    <td>
                      {r.title}
                      {r.mixed ? null : <span className="muted"> ({r.ruleId})</span>}
                    </td>
                    <td className="num">{r.claimCount}</td>
                    <td className="num">{r.findingsSent}</td>
                    <td className="num">{r.findingsAccepted}</td>
                    <td className="num">{r.findingsPartial}</td>
                    <td className="num">{r.findingsRejected}</td>
                    <td>
                      <MoneyFigure cents={r.identifiedCents} label="identified" />
                    </td>
                    <td>
                      <MoneyFigure cents={r.creditedCents} label="credited" />
                    </td>
                    <td className="num">{rateText(r.rateBasisPoints)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted mt-2 text-xs">{OUTCOME_TEXT.mixedNote}</p>
            <p className="sr-only">{`Credited ${formatUsdCents(d.credited.cents)} of ${formatUsdCents(d.sent.identifiedCents)} identified.`}</p>
          </>
        )}
      </QueryState>
    </Section>
  );
}