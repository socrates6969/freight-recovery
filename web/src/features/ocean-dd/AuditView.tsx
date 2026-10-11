/**
 * Checks and findings of a D&D audit result (C6 labels, C18): rule id, title, amount and "needs human review".
 * Every engine text renders as text (SafeText).
 */
import { DD_CHECK_LABELS, DD_CHECK_STATUS_LABELS, DD_TEXT, type DdAuditResultDto } from '@fr/shared';

import { SafeText } from '../../components/ui/SafeText';

import { usd } from './dd-common';

export function AuditView({ result, labels }: { result: DdAuditResultDto; labels: readonly string[] }) {
  return (
    <div className="my-3">
      <h3 className="font-semibold">{DD_TEXT.checks}</h3>
      <table className="data-table text-sm" aria-label={DD_TEXT.checks}>
        <thead>
          <tr>
            <th scope="col">Check</th>
            <th scope="col">Container</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {result.checks.map((c, i) => (
            <tr key={`${c.id}-${c.containerIndex ?? 'x'}-${i}`}>
              <td>{DD_CHECK_LABELS[c.id]}</td>
              <td>{c.containerIndex === null ? '' : <SafeText value={labels[c.containerIndex] ?? `Container #${c.containerIndex + 1}`} />}</td>
              <td>{DD_CHECK_STATUS_LABELS[c.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="mt-3 font-semibold">{DD_TEXT.findings}</h3>
      {result.findings.length === 0 ? (
        <p className="text-sm">{DD_TEXT.noFindings}</p>
      ) : (
        <ul className="text-sm">
          {result.findings.map((f, i) => (
            <li key={`${f.ruleId}-${i}`} className="my-2 rounded-md border p-2">
              <p className="font-medium">
                <span className="num">{f.ruleId}</span> <SafeText value={f.title} />: <span className="num">{usd(f.amountCents)}</span>
                {f.needsHumanReview ? <span className="badge ml-2">Needs human review</span> : null}
              </p>
              <p>
                <SafeText value={f.explanation} />
              </p>
              <ul className="muted">
                {f.calculation.map((line, k) => (
                  <li key={k}>
                    <SafeText value={line} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm">
        Confirmed: <span className="num">{usd(result.recoverableCents)}</span>. For review: <span className="num">{usd(result.pendingReviewCents)}</span>.
      </p>
    </div>
  );
}
