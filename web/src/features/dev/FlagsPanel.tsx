import type { FeatureFlagDto } from '@fr/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';

import { ApiError, step4ErrorText } from '../../api/client';
import { useApi, useToast } from '../../app-context';
import { Dialog } from '../../components/ui/Dialog';
import { SafeText } from '../../components/ui/SafeText';
import { formatDateTime } from '../../lib/format';

import { DEV_QUERY, ErrorState, Loading, RefreshButton } from './dev-common';

export const STALE_FLAG_TEXT = 'This flag changed. Reload to continue.';

function ChangeDialog({ flag, onClose }: { flag: FeatureFlagDto; onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => api.setFlag(flag.key, { enabled: !flag.enabled, expectedVersion: flag.version, reason: reason.trim() }),
    onSuccess: async () => {
      toast('Flag updated', 'success');
      await queryClient.invalidateQueries({ queryKey: ['dev', 'flags'] });
      onClose();
    },
    onError: async (e) => {
      if (e instanceof ApiError && e.status === 409 && e.code === 'stale_revision') {
        setError(STALE_FLAG_TEXT);
        await queryClient.invalidateQueries({ queryKey: ['dev', 'flags'] });
      } else setError(step4ErrorText(e));
    },
  });
  const ok = reason.trim().length >= 10 && !mutation.isPending;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ok) mutation.mutate();
  };
  return (
    <Dialog title={`Change ${flag.key}`} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <p className="text-sm">
          {flag.enabled ? 'Turn off' : 'Turn on'}: <SafeText value={flag.description} />
        </p>
        <div>
          <label className="label" htmlFor={reasonId}>
            Reason
          </label>
          <input id={reasonId} className="input" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />
          <p className="muted mt-1 text-xs">At least 10 characters. Recorded in the platform audit trail.</p>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!ok}>
            Confirm
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function FlagsPanel() {
  const api = useApi();
  const q = useQuery({ queryKey: ['dev', 'flags'], queryFn: () => api.platformFlags(), ...DEV_QUERY });
  const [open, setOpen] = useState<FeatureFlagDto | null>(null);
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Feature flags</h2>
        <RefreshButton onClick={() => void q.refetch()} busy={q.isFetching} />
      </div>
      {q.isError ? (
        <ErrorState error={q.error} />
      ) : !q.data ? (
        <Loading />
      ) : (
        <table className="data-table text-sm" aria-label="Feature flags">
          <thead>
            <tr>
              {['Flag', 'Description', 'State', 'Version', 'Last change'].map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {q.data.items.map((f) => (
              <tr key={f.key}>
                <td className="font-mono text-xs">{f.key}</td>
                <td>
                  <SafeText value={f.description} />
                </td>
                <td>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={f.enabled}
                    aria-label={f.key}
                    className={f.enabled ? 'btn btn-primary' : 'btn'}
                    onClick={() => setOpen(f)}
                  >
                    {f.enabled ? 'On' : 'Off'}
                  </button>
                </td>
                <td className="num">{f.version}</td>
                <td>
                  {f.updatedAt ? (
                    <>
                      {formatDateTime(f.updatedAt)} by <SafeText value={f.updatedBy?.name ?? '—'} />: <SafeText value={f.lastReason ?? ''} />
                    </>
                  ) : (
                    <span className="muted">Never changed (default)</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open ? <ChangeDialog flag={open} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}
