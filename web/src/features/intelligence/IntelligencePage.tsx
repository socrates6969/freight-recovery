/**
 * Recovery intelligence (Q12): the prioritised worklist computed by a fixed formula over this tenant's own
 * claims. Every number shown comes from the API; the explanatory notes are the shared fixed texts.
 */
import { NO_ACCURACY_NOTE, worklistNote, type NextAction } from '@fr/shared';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { step4ErrorText } from '../../api/client';
import { useApi } from '../../app-context';
import { SafeText } from '../../components/ui/SafeText';
import { formatUsdCents } from '../../lib/format';

export const NEXT_ACTION_TEXT: Record<NextAction, string> = {
  RESOLVE_FINDINGS: 'Resolve findings',
  REVIEW_AND_APPROVE: 'Review and approve',
  MARK_SEND_READY: 'Mark send-ready',
};
const PAGE_SIZE = 25;

export function notRankedText(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? 'Not ranked: 1 claim awaiting analysis' : `Not ranked: ${n} claims awaiting analysis`;
}

export function IntelligencePage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const perspectiveRaw = params.get('perspective');
  const perspective = perspectiveRaw === 'SHIPPER' || perspectiveRaw === 'CARRIER' ? perspectiveRaw : undefined;
  const pageRaw = Number(params.get('page') ?? '1');
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 100000 ? pageRaw : 1;
  const selectId = useId();
  const q = useQuery({
    queryKey: ['worklist', perspective ?? 'ALL', page],
    queryFn: () => api.worklist({ perspective, page, pageSize: PAGE_SIZE }),
    retry: false,
  });
  const d = q.data;
  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v === null) next.delete(k);
    else next.set(k, v);
    if (k !== 'page') next.delete('page');
    setParams(next);
  };
  const lastPage = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  const notRanked = d ? notRankedText(d.notRanked.awaitingAnalysis) : null;

  return (
    <section>
      <h1 className="mb-3 text-lg font-semibold">Recovery intelligence</h1>
      <section aria-label="How this works" className="card mb-4 p-4 text-sm">
        {d ? <p className="mb-1">{worklistNote(d.formula.pendingWeightPercent)}</p> : null}
        <p className="muted">{NO_ACCURACY_NOTE}</p>
      </section>
      <div className="mb-3 flex items-end gap-2">
        <div>
          <label className="label" htmlFor={selectId}>
            Perspective
          </label>
          <select id={selectId} className="input" value={perspective ?? 'ALL'} onChange={(e) => setParam('perspective', e.target.value === 'ALL' ? null : e.target.value)}>
            <option value="ALL">All</option>
            <option value="SHIPPER">Shipper</option>
            <option value="CARRIER">Carrier</option>
          </select>
        </div>
      </div>
      {q.isError ? (
        <p role="alert">{step4ErrorText(q.error)}</p>
      ) : !d ? (
        <div className="skeleton h-40" aria-hidden="true" />
      ) : (
        <>
          {notRanked ? <p className="muted mb-2 text-sm">{notRanked}</p> : null}
          {d.items.length === 0 ? (
            <p className="muted">Nothing to work on right now.</p>
          ) : (
            <table className="data-table text-sm" aria-label="Prioritised worklist">
              <thead>
                <tr>
                  {['Rank', 'Claim', 'Carrier', 'Priority score', 'Why', 'Next action', 'Waiting'].map((h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.items.map((it) => (
                  <tr key={it.claim.id}>
                    <td className="num">{it.rank}</td>
                    <td>
                      <Link to={`/claims/${encodeURIComponent(it.claim.id)}`} className="text-[var(--color-accent)]">
                        <SafeText value={it.claim.claimNumber} />
                      </Link>
                    </td>
                    <td className="max-w-48">
                      <SafeText value={it.claim.carrierName} />
                    </td>
                    <td className="num">{formatUsdCents(it.score.valueCents)}</td>
                    <td>
                      <ul className="list-disc pl-4">
                        {it.why.map((w) => (
                          <li key={w}>
                            <SafeText value={w} />
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td>{NEXT_ACTION_TEXT[it.nextAction]}</td>
                    <td className="num">{it.waitingDays === 1 ? '1 day' : `${it.waitingDays} days`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button type="button" className="btn" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>
              Previous page
            </button>
            <span className="muted text-sm">
              Page {page} of {lastPage}
            </span>
            <button type="button" className="btn" disabled={page >= lastPage} onClick={() => setParam('page', String(page + 1))}>
              Next page
            </button>
          </div>
        </>
      )}
    </section>
  );
}
