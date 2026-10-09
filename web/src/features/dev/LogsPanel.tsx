import { LOGS_NOTE, LOG_LEVELS, type LogLevelName } from '@fr/shared';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { useApi } from '../../app-context';
import { SafeText } from '../../components/ui/SafeText';
import { formatDateTime } from '../../lib/format';

import { DEV_QUERY, ErrorState, Loading, RefreshButton } from './dev-common';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const LEVEL_CHIP: Record<LogLevelName, string> = {
  trace: 'badge',
  debug: 'badge',
  info: 'badge badge-accent',
  warn: 'badge badge-warn',
  error: 'badge badge-danger',
  fatal: 'badge badge-danger',
};

export function LogsPanel() {
  const api = useApi();
  const levelId = useId();
  const ridId = useId();
  const [level, setLevel] = useState<LogLevelName>('info');
  const [rid, setRid] = useState('');
  const trimmed = rid.trim();
  const ridValid = trimmed === '' || UUID_RE.test(trimmed);
  const q = useQuery({
    queryKey: ['dev', 'logs', level, ridValid ? trimmed : ''],
    queryFn: () => api.platformLogs({ level, limit: 100, ...(trimmed && ridValid ? { requestId: trimmed } : {}) }),
    ...DEV_QUERY,
    enabled: ridValid,
  });
  const d = q.data;
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-base font-semibold">Recent logs</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor={levelId}>
              Minimum level
            </label>
            <select id={levelId} className="input" value={level} onChange={(e) => setLevel(e.target.value as LogLevelName)}>
              {LOG_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor={ridId}>
              Request ID
            </label>
            <input id={ridId} className="input" value={rid} maxLength={64} onChange={(e) => setRid(e.target.value)} aria-invalid={!ridValid} />
          </div>
          <RefreshButton onClick={() => void q.refetch()} busy={q.isFetching || !ridValid} />
        </div>
      </div>
      <p className="muted mb-3 text-sm">{LOGS_NOTE}</p>
      {!ridValid ? (
        <p role="alert" className="mb-3 text-sm text-[var(--color-danger)]">
          Enter a valid request ID.
        </p>
      ) : null}
      {q.isError ? (
        <ErrorState error={q.error} />
      ) : !ridValid ? null : !d ? (
        <Loading />
      ) : d.items.length === 0 ? (
        <p className="muted">No records match.</p>
      ) : (
        <table className="data-table text-sm" aria-label="Log records">
          <thead>
            <tr>
              {['Time', 'Level', 'Request', 'Route', 'Status', 'Duration', 'Event'].map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.items.map((r, i) => (
              <tr key={`${r.time}-${i}`}>
                <td className="whitespace-nowrap">{formatDateTime(r.time)}</td>
                <td>
                  <span className={LEVEL_CHIP[r.level]}>{r.level}</span>
                </td>
                <td className="break-anywhere font-mono text-xs">
                  <SafeText value={r.requestId ?? '—'} />
                </td>
                <td className="break-anywhere font-mono text-xs">
                  <SafeText value={r.route ? `${r.method ?? ''} ${r.route}`.trim() : '—'} />
                </td>
                <td className="num">{r.statusCode ?? '—'}</td>
                <td className="num">{r.durationMs === null ? '—' : `${r.durationMs.toFixed(1)} ms`}</td>
                <td className="break-anywhere">
                  <SafeText value={r.event} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
