import { PIPELINE_NOTE, type PipelineWindow } from '@fr/shared';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { useApi } from '../../app-context';
import { SafeText } from '../../components/ui/SafeText';

import { DEV_QUERY, ErrorState, Labelled, Loading, RefreshButton } from './dev-common';

const WINDOWS: { value: PipelineWindow; label: string }[] = [
  { value: '1h', label: '1 hour' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
];
const STATUS_LABELS: Record<string, string> = { RECEIVED: 'Received', NEEDS_REVIEW: 'Needs review', ACCEPTED: 'Accepted', REJECTED: 'Rejected', FAILED: 'Failed' };

function duration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 120) return `${seconds} s`;
  if (seconds < 7200) return `${Math.floor(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} h`;
}

export function PipelinePanel() {
  const api = useApi();
  const [window, setWindow] = useState<PipelineWindow>('24h');
  const selectId = useId();
  const q = useQuery({ queryKey: ['dev', 'pipeline', window], queryFn: () => api.platformPipeline(window), ...DEV_QUERY });
  const d = q.data;
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-base font-semibold">Pipeline health</h2>
        <div className="flex items-end gap-2">
          <div>
            <label className="label" htmlFor={selectId}>
              Time window
            </label>
            <select id={selectId} className="input" value={window} onChange={(e) => setWindow(e.target.value as PipelineWindow)}>
              {WINDOWS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>
          <RefreshButton onClick={() => void q.refetch()} busy={q.isFetching} />
        </div>
      </div>
      <p className="muted mb-3 text-sm">{PIPELINE_NOTE}</p>
      {q.isError ? (
        <ErrorState error={q.error} />
      ) : !d ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-4">
          <span role="status" className={d.db === 'ok' ? 'badge badge-success w-fit' : 'badge badge-danger w-fit'}>
            {d.db === 'ok' ? 'Database ok' : 'Database down'}
          </span>
          <table className="data-table text-sm" aria-label="Documents by status">
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Documents</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(d.documents.byStatus).map(([k, v]) => (
                <tr key={k}>
                  <td>{STATUS_LABELS[k] ?? k}</td>
                  <td className="num">{v}</td>
                </tr>
              ))}
              <tr>
                <td>Total</td>
                <td className="num">{d.documents.total}</td>
              </tr>
            </tbody>
          </table>
          <table className="data-table text-sm" aria-label="Rejected by reason">
            <thead>
              <tr>
                <th scope="col">Reason</th>
                <th scope="col">Documents</th>
              </tr>
            </thead>
            <tbody>
              {d.documents.rejectedByReason.length === 0 ? (
                <tr>
                  <td colSpan={2} className="muted">
                    None
                  </td>
                </tr>
              ) : (
                d.documents.rejectedByReason.map((r) => (
                  <tr key={r.reason}>
                    <td>
                      <SafeText value={r.reason} />
                    </td>
                    <td className="num">{r.count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <dl>
            <Labelled label="Upload-to-parse time">
              {d.uploadToParseMs.n > 0 && d.uploadToParseMs.p50 !== null && d.uploadToParseMs.p95 !== null
                ? `p50 ${Math.round(d.uploadToParseMs.p50)} ms, p95 ${Math.round(d.uploadToParseMs.p95)} ms (${d.uploadToParseMs.n} documents)`
                : 'No documents in this window'}
            </Labelled>
            <Labelled label="Review queue depth">{d.reviewQueue.depth}</Labelled>
            <Labelled label="Oldest waiting">{duration(d.reviewQueue.oldestWaitingSeconds)}</Labelled>
            <Labelled label="Awaiting analysis">{d.claims.awaitingAnalysis}</Labelled>
            <Labelled label="Stale received">{d.staleReceived}</Labelled>
          </dl>
        </div>
      )}
    </section>
  );
}
