import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { step4ErrorText } from '../../api/client';
import { useApi } from '../../app-context';
import { SafeText } from '../../components/ui/SafeText';
import { formatDateTime } from '../../lib/format';

import { DEV_QUERY, ErrorState, Loading, RefreshButton } from './dev-common';

export function AuditPanel() {
  const api = useApi();
  const q = useQuery({ queryKey: ['dev', 'platform-audit'], queryFn: () => api.platformAuditEvents(), ...DEV_QUERY });
  const [verify, setVerify] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runVerify = () => {
    setBusy(true);
    api
      .platformAuditVerify()
      .then((r) => setVerify(r.valid ? `Chain valid (${r.eventsChecked} events checked)` : `Chain broken at event ${r.brokenAtSeq ?? '?'}`))
      .catch((e: unknown) => setVerify(step4ErrorText(e)))
      .finally(() => setBusy(false));
  };
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Platform audit</h2>
        <div className="flex gap-2">
          <button type="button" className="btn" onClick={runVerify} disabled={busy}>
            Verify chain
          </button>
          <RefreshButton onClick={() => void q.refetch()} busy={q.isFetching} />
        </div>
      </div>
      {verify ? (
        <p role="status" className="mb-3 text-sm">
          {verify}
        </p>
      ) : null}
      {q.isError ? (
        <ErrorState error={q.error} />
      ) : !q.data ? (
        <Loading />
      ) : (
        <table className="data-table text-sm" aria-label="Platform audit events">
          <thead>
            <tr>
              {['Seq', 'Time', 'Action', 'Actor role', 'Target'].map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {q.data.items.map((e) => (
              <tr key={e.id}>
                <td className="num">{e.seq}</td>
                <td className="whitespace-nowrap">{formatDateTime(e.createdAt)}</td>
                <td className="font-mono text-xs">
                  <SafeText value={e.action} />
                </td>
                <td>
                  <SafeText value={e.actor?.role ?? '—'} />
                </td>
                <td className="break-anywhere font-mono text-xs">
                  <SafeText value={e.targetType ? `${e.targetType} ${e.targetId ?? ''}` : '—'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
