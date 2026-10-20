/**
 * REQ-20261020-dd-deadline: the reviewer-routing SHADOW section of the insights page. Three columns per open
 * claim (actual assignee, fastest-for-rule pick, least-loaded pick), the current agreement rate, the per
 * reviewer and per rule tables and the prequential bookkeeping. Labelled as a shadow that changes no
 * assignment; rendered only while the flag is on and the route answers (a 404 hides the section).
 */
import { type RoutingChoiceDto, type RoutingShadowDto } from '@fr/shared';
import type { UseQueryResult } from '@tanstack/react-query';

import { ApiError } from '../../api/client';
import { SafeText } from '../../components/ui/SafeText';

import { hoursText, percentFromBasisPoints } from './insights-params';
import { QueryState, Section } from './section';

function Choice({ c }: { c: RoutingChoiceDto | null }) {
  if (c === null) return <span className="muted">no pick (no history or no eligible reviewer)</span>;
  return (
    <>
      <SafeText value={c.name} /> <span className="muted text-xs">({c.basis})</span>
    </>
  );
}

function agreementText(a: { agreed: number; compared: number; rateBasisPoints: number | null }): string {
  if (a.rateBasisPoints === null) return 'no assigned claim to compare';
  return `${percentFromBasisPoints(a.rateBasisPoints)} (${a.agreed} of ${a.compared} assigned claims)`;
}

function yesNo(v: boolean | null): string {
  return v === null ? '—' : v ? 'yes' : 'no';
}

export function RoutingShadowSection({ q }: { q: UseQueryResult<RoutingShadowDto> }) {
  // Flag off (404) or forbidden: the section does not exist for this user.
  if (q.isError && q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403)) return null;
  return (
    <Section title="Reviewer routing (shadow)" suffix={<span className="badge badge-warn ml-2">Shadow: changes no assignment</span>}>
      <QueryState q={q}>
        {(d) => (
          <>
            <p className="mb-2 text-sm">{d.label}</p>
            <dl className="mb-3 text-sm">
              <dt className="muted">Fastest so far for the finding rule</dt>
              <dd className="mb-1">{d.policies.fastest_for_rule}</dd>
              <dt className="muted">Least loaded now</dt>
              <dd className="mb-1">{d.policies.least_loaded}</dd>
              <dt className="muted">Agreement with the actual assignee right now</dt>
              <dd>
                fastest for rule: {agreementText(d.agreement.fastestForRule)}; least loaded: {agreementText(d.agreement.leastLoaded)}
              </dd>
            </dl>
            <p className="muted mb-2 text-xs">
              {`${d.coverage.decisionsConsidered} first decisions in the period${d.coverage.decisionsTruncated ? ' (capped)' : ''}, ${d.coverage.openClaimsConsidered} open claims${d.coverage.openClaimsTruncated ? ' (capped)' : ''}, ${d.coverage.eligibleReviewers} eligible reviewers.`}
            </p>
            {d.openClaims.length === 0 ? (
              <p className="muted mb-3">No open claims with an evidence packet.</p>
            ) : (
              <table className="data-table mb-3 text-sm" aria-label="Routing shadow by open claim">
                <thead>
                  <tr>
                    <th scope="col">Claim</th>
                    <th scope="col">Actual assignee</th>
                    <th scope="col">Shadow: fastest for rule</th>
                    <th scope="col">Shadow: least loaded</th>
                    <th scope="col">Agrees</th>
                    <th scope="col">Open for</th>
                  </tr>
                </thead>
                <tbody>
                  {d.openClaims.map((c) => (
                    <tr key={c.claim.id}>
                      <td>
                        <SafeText value={c.claim.claimNumber} /> <span className="muted text-xs">{c.ruleIds.join(', ')}</span>
                      </td>
                      <td>{c.actual ? <SafeText value={c.actual.name} /> : <span className="muted">Unassigned</span>}</td>
                      <td>
                        <Choice c={c.fastestForRule} />
                      </td>
                      <td>
                        <Choice c={c.leastLoaded} />
                      </td>
                      <td className="num">{`${yesNo(c.agreement.fastestForRule)} / ${yesNo(c.agreement.leastLoaded)}`}</td>
                      <td className="num">{hoursText(c.prequential.openHoursSoFar)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <table className="data-table text-sm" aria-label="Reviewers in the period">
                <thead>
                  <tr>
                    <th scope="col">Reviewer</th>
                    <th scope="col">Packet decisions</th>
                    <th scope="col">Median to first decision</th>
                    <th scope="col">Import decisions</th>
                    <th scope="col">Open now</th>
                  </tr>
                </thead>
                <tbody>
                  {d.reviewers.map((rv) => (
                    <tr key={rv.id}>
                      <td>
                        <SafeText value={rv.name} /> <span className="muted text-xs">{rv.eligible ? rv.role.toLowerCase() : `${rv.role.toLowerCase()}, not eligible`}</span>
                      </td>
                      <td className="num">{`${rv.packetDecisions} (${rv.approveCount} approve, ${rv.rejectCount} reject)`}</td>
                      <td className="num">{hoursText(rv.medianHoursToFirstDecision)}</td>
                      <td className="num">{`${rv.importDecisions} (median ${hoursText(rv.importMedianHours)})`}</td>
                      <td className="num">{rv.openAssigned}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table className="data-table text-sm" aria-label="Finding rules in the period">
                <thead>
                  <tr>
                    <th scope="col">Rule</th>
                    <th scope="col">Decisions</th>
                    <th scope="col">Reviewers, fastest first</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rules.map((rule) => (
                    <tr key={rule.ruleId}>
                      <td>
                        <SafeText value={rule.ruleId} />
                      </td>
                      <td className="num">{rule.decisions}</td>
                      <td>
                        {rule.reviewers.map((x) => (
                          <span key={x.reviewerId} className="mr-2 whitespace-nowrap">
                            <SafeText value={d.reviewers.find((rv) => rv.id === x.reviewerId)?.name ?? ''} /> <span className="muted text-xs">{`${hoursText(x.medianHours)} over ${x.decisions}`}</span>
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="mt-3 text-sm">
              <dt className="muted">Prequential bookkeeping (fastest for rule, replayed over the period)</dt>
              <dd>
                {`${d.prequential.evaluated} decisions replayed: ${d.prequential.noHistory} without history, ${d.prequential.agreed} where the shadow pick was the actual decider, ${d.prequential.disagreedShadowMedianFaster} where the pick's median was below the actual time, ${d.prequential.disagreedShadowMedianNotFaster} where it was not.`}
              </dd>
              <dd className="muted text-xs">{d.prequential.note}</dd>
            </dl>
          </>
        )}
      </QueryState>
    </Section>
  );
}