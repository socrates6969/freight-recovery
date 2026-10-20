/**
 * Leakage by billing party (L1) and by finding type (L2, or L3 for one billing party) on the insights page
 * (REQ-20261018-exec-dashboard). Billing-party names and finding titles are tenant data: rendered with
 * SafeText. The identified + pending ranking value is never shown as an amount.
 */
import { INSIGHTS_TEXT, type InsightsLeakageDto } from '@fr/shared';
import type { UseQueryResult } from '@tanstack/react-query';

import { SafeText } from '../../components/ui/SafeText';

import { percentFromBasisPoints } from './insights-params';
import { MoneyFigure } from './MoneyFigure';
import { QueryState, Section } from './section';

export function CarrierLeakageSection({ q, onShowRules }: { q: UseQueryResult<InsightsLeakageDto>; onShowRules: (carrierKey: string) => void }) {
  return (
    <Section title="Leakage by billing party">
      <QueryState q={q}>
        {(d) =>
          d.by !== 'carrier' || d.rows.length === 0 ? (
            <p className="muted">{INSIGHTS_TEXT.empty}</p>
          ) : (
            <table className="data-table text-sm" aria-label="Leakage by billing party">
              <thead>
                <tr>
                  <th scope="col">{INSIGHTS_TEXT.billingParty}</th>
                  <th scope="col">Claims</th>
                  <th scope="col">Identified</th>
                  <th scope="col">Pending review</th>
                  <th scope="col">Share (%)</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.carrierKey}>
                    <td>
                      <SafeText value={r.displayName} />
                    </td>
                    <td className="num">{r.claimCount}</td>
                    <td>
                      <MoneyFigure cents={r.identifiedCents} label="identified" />
                    </td>
                    <td>
                      <MoneyFigure cents={r.pendingReviewCents} label="pending review" />
                    </td>
                    <td className="num">{percentFromBasisPoints(r.shareBasisPoints)}</td>
                    <td>
                      <button type="button" className="btn" onClick={() => onShowRules(r.carrierKey)}>
                        Show finding types
                      </button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>All other billing parties</td>
                  <td className="num">{d.other.claimCount}</td>
                  <td>
                    <MoneyFigure cents={d.other.identifiedCents} label="identified" />
                  </td>
                  <td>
                    <MoneyFigure cents={d.other.pendingReviewCents} label="pending review" />
                  </td>
                  <td className="num">{percentFromBasisPoints(d.other.shareBasisPoints)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          )
        }
      </QueryState>
    </Section>
  );
}

export function RuleLeakageSection({ q, carrier, onClear }: { q: UseQueryResult<InsightsLeakageDto>; carrier: string | undefined; onClear: () => void }) {
  const d = q.data;
  const header = d && d.by === 'rule' ? d.carrier : null;
  const suffix =
    carrier !== undefined ? (
      <>
        {': '}
        <SafeText value={header?.displayName ?? carrier} />
      </>
    ) : null;
  return (
    <Section title="Leakage by finding type" suffix={suffix}>
      {carrier !== undefined ? (
        <button type="button" className="btn mb-2" onClick={onClear}>
          Clear
        </button>
      ) : null}
      <QueryState q={q}>
        {(data) =>
          data.by !== 'rule' || data.rows.length === 0 ? (
            <p className="muted">{INSIGHTS_TEXT.empty}</p>
          ) : (
            <table className="data-table text-sm" aria-label="Leakage by finding type">
              <thead>
                <tr>
                  <th scope="col">Finding type</th>
                  <th scope="col">Findings</th>
                  <th scope="col">Overcharge identified</th>
                  <th scope="col">Overcharge pending review</th>
                  <th scope="col">Underbilled identified</th>
                  <th scope="col">Underbilled pending review</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.ruleId}>
                    <td>
                      <SafeText value={r.title} />
                    </td>
                    <td className="num">{r.findingCount}</td>
                    <td>
                      <MoneyFigure cents={r.overcharge.identifiedCents} label="identified" />
                    </td>
                    <td>
                      <MoneyFigure cents={r.overcharge.pendingReviewCents} label="pending review" />
                    </td>
                    <td>
                      <MoneyFigure cents={r.underbilled.identifiedCents} label="identified" />
                    </td>
                    <td>
                      <MoneyFigure cents={r.underbilled.pendingReviewCents} label="pending review" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </QueryState>
    </Section>
  );
}
