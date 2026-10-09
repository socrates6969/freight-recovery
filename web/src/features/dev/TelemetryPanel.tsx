import { TELEMETRY_NOTE } from '@fr/shared';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../app-context';

import { DEV_QUERY, ErrorState, Loading, RefreshButton, boundText } from './dev-common';

const COMPONENT_LABEL: Record<string, string> = { 'priority-v1': 'Prioritised worklist (priority-v1)', 'similar-v1': 'Similar past claims (similar-v1)' };

export function TelemetryPanel() {
  const api = useApi();
  const q = useQuery({ queryKey: ['dev', 'telemetry'], queryFn: () => api.platformTelemetry(), ...DEV_QUERY });
  const d = q.data;
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Request telemetry</h2>
        <RefreshButton onClick={() => void q.refetch()} busy={q.isFetching} />
      </div>
      <p className="muted mb-3 text-sm">{TELEMETRY_NOTE}</p>
      {q.isError ? (
        <ErrorState error={q.error} />
      ) : !d ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            Requests since start: <span className="num">{d.requests.total}</span> (401: <span className="num">{d.requests.unauthenticated401}</span>, 403:{' '}
            <span className="num">{d.requests.forbidden403}</span>, 429: <span className="num">{d.requests.rateLimited429}</span>)
          </p>
          <table className="data-table text-sm" aria-label="Routes">
            <thead>
              <tr>
                {['Method', 'Route', 'Requests', '2xx', '4xx', '5xx', 'p50 bound (ms)', 'p95 bound (ms)'].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.routes.map((r) => (
                <tr key={`${r.method} ${r.route}`}>
                  <td>{r.method}</td>
                  <td className="break-anywhere font-mono text-xs">{r.route}</td>
                  <td className="num">{r.count}</td>
                  <td className="num">{r.byStatusClass['2xx']}</td>
                  <td className="num">{r.byStatusClass['4xx']}</td>
                  <td className="num">{r.byStatusClass['5xx']}</td>
                  <td className="num">{boundText(r.p50UpperBoundMs, r.count)}</td>
                  <td className="num">{boundText(r.p95UpperBoundMs, r.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="data-table text-sm" aria-label="Parser">
            <thead>
              <tr>
                {['Jobs', 'Succeeded', 'Rejected', 'Timeouts', 'Memory kills', 'Failures', 'Busy rejections', 'Average queue wait (ms)'].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="num">{d.parser.jobs}</td>
                <td className="num">{d.parser.succeeded}</td>
                <td className="num">{d.parser.rejected}</td>
                <td className="num">{d.parser.timeouts}</td>
                <td className="num">{d.parser.memoryKills}</td>
                <td className="num">{d.parser.failures}</td>
                <td className="num">{d.parser.busyRejections}</td>
                <td className="num">{d.parser.avgQueueWaitMs === null ? '—' : d.parser.avgQueueWaitMs.toFixed(1)}</td>
              </tr>
            </tbody>
          </table>
          <h3 className="text-sm font-semibold">Intelligence components</h3>
          <table className="data-table text-sm" aria-label="Intelligence components">
            <thead>
              <tr>
                {['Component', 'Method', 'Learned model', 'Enabled', 'Calls', 'Errors', 'p50 bound (ms)', 'p95 bound (ms)'].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.components.map((c) => (
                <tr key={c.id}>
                  <td>{COMPONENT_LABEL[c.id] ?? c.id}</td>
                  <td>{c.method === 'fixed_rules' ? 'Fixed rules' : '—'}</td>
                  <td>{c.learnedModel ? '—' : 'None'}</td>
                  <td>{c.enabled ? 'Yes' : 'No'}</td>
                  <td className="num">{c.calls}</td>
                  <td className="num">{c.errors}</td>
                  <td className="num">{boundText(c.p50UpperBoundMs, c.calls)}</td>
                  <td className="num">{boundText(c.p95UpperBoundMs, c.calls)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
