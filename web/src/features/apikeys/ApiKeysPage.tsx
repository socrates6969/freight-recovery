/**
 * Tenant API keys (Q13 UI). The secret exists only in the create dialog's component state: it is shown
 * once in a read-only element, never put in the query cache (the create call is a plain request, not a
 * cached query), router state, URL, console or browser storage, and is cleared on Done, Escape and unmount.
 */
import { displayText, type ApiKeyViewDto } from '@fr/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { ApiError, step4ErrorText } from '../../api/client';
import { useApi, useCan, useToast } from '../../app-context';
import { Dialog } from '../../components/ui/Dialog';
import { SafeText } from '../../components/ui/SafeText';
import { formatDateTime } from '../../lib/format';

export const SCOPE_OPTIONS = [
  { scope: 'claims.read', label: 'Read claims' },
  { scope: 'exports.claims', label: 'Export claims' },
  { scope: 'imports.write', label: 'Upload documents' },
] as const;
/** "Last used" cell for a key that has never authenticated a request (Q13 lastUsedAt = null). */
export const NEVER_USED_LABEL = 'Never';
/** "Expires" cell for a non-expiring key (Q13 expiresAt = null); a separate label from NEVER_USED_LABEL. */
export const NO_EXPIRY_LABEL = 'Never';
const EXPIRY_OPTIONS = [30, 90, 180, 365] as const;
const STATUS_TEXT: Record<string, string> = { ACTIVE: 'Active', REVOKED: 'Revoked', EXPIRED: 'Expired' };
export const COPY_FALLBACK = 'Copy is not available. Select the key and copy it manually.';

function CreateDialog({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const nameId = useId();
  const expiresId = useId();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [days, setDays] = useState<number>(90);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const secretRef = useRef<string | null>(null);

  // Clear the secret from memory when the dialog goes away (Done, Escape, navigation).
  useEffect(
    () => () => {
      secretRef.current = null;
    },
    [],
  );

  const close = () => {
    secretRef.current = null;
    setSecret(null);
    onClose();
  };

  const ok = name.trim().length >= 1 && scopes.length >= 1 && !busy;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setError(null);
    api
      .createApiKey({ name: name.trim(), scopes, expiresInDays: days })
      .then(async (r) => {
        secretRef.current = r.secret;
        setSecret(r.secret);
        await queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError && err.status === 422 ? 'The maximum number of active keys has been reached.' : step4ErrorText(err)),
      )
      .finally(() => setBusy(false));
  };

  const copy = () => {
    const value = secretRef.current;
    if (!value || typeof navigator === 'undefined' || !navigator.clipboard) {
      setCopied(COPY_FALLBACK);
      return;
    }
    navigator.clipboard.writeText(value).then(
      () => setCopied('Copied'),
      () => setCopied(COPY_FALLBACK),
    );
  };

  if (secret !== null) {
    return (
      <Dialog title="API key created" onClose={close}>
        <div className="flex flex-col gap-3">
          <label className="label" htmlFor={`${nameId}-secret`}>
            API key secret
          </label>
          <input id={`${nameId}-secret`} className="input font-mono text-xs" readOnly value={secret} aria-label="API key secret" />
          <p className="text-sm">This key will not be shown again.</p>
          {copied ? (
            <p role="status" className="text-sm">
              {copied}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={copy}>
              Copy
            </button>
            <button type="button" className="btn btn-primary" onClick={close} data-autofocus>
              Done
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Create API key" onClose={close}>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <div>
          <label className="label" htmlFor={nameId}>
            Name
          </label>
          <input id={nameId} className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
        </div>
        <fieldset>
          <legend className="label">Scopes</legend>
          {SCOPE_OPTIONS.map((o) => (
            <label key={o.scope} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={scopes.includes(o.scope)}
                onChange={(e) => setScopes((s) => (e.target.checked ? [...s, o.scope] : s.filter((x) => x !== o.scope)))}
              />
              {o.label}
            </label>
          ))}
        </fieldset>
        <div>
          <label className="label" htmlFor={expiresId}>
            Expires
          </label>
          <select id={expiresId} className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {EXPIRY_OPTIONS.map((d) => (
              <option key={d} value={d}>{`${d} days`}</option>
            ))}
          </select>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!ok}>
            Create key
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function RevokeDialog({ apiKey, onClose }: { apiKey: ApiKeyViewDto; onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ok = reason.trim().length >= 10 && !busy;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    api
      .revokeApiKey(apiKey.id, reason.trim())
      .then(async () => {
        toast('API key revoked', 'success');
        await queryClient.invalidateQueries({ queryKey: ['api-keys'] });
        onClose();
      })
      .catch((err: unknown) => setError(step4ErrorText(err)))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog title={`Revoke ${displayText(apiKey.name)}`} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <p className="text-sm">The key stops working on its next request. This cannot be undone.</p>
        <div>
          <label className="label" htmlFor={reasonId}>
            Reason
          </label>
          <input id={reasonId} className="input" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />
          <p className="muted mt-1 text-xs">At least 10 characters. Recorded in the audit trail.</p>
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
          <button type="submit" className="btn btn-danger" disabled={!ok}>
            Confirm
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ApiKeysPage() {
  const api = useApi();
  const canManage = useCan('apikeys:manage');
  const q = useQuery({ queryKey: ['api-keys'], queryFn: () => api.apiKeys(), enabled: canManage, retry: false });
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKeyViewDto | null>(null);
  if (!canManage) return <p role="alert">Not available.</p>;
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">API keys</h1>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          Create API key
        </button>
      </div>
      {q.isError ? (
        <p role="alert">{step4ErrorText(q.error)}</p>
      ) : !q.data ? (
        <div className="skeleton h-24" aria-hidden="true" />
      ) : q.data.items.length === 0 ? (
        <p className="muted">No API keys yet.</p>
      ) : (
        <table className="data-table text-sm" aria-label="API keys">
          <thead>
            <tr>
              {['Name', 'Key', 'Scopes', 'Created', 'Last used', 'Expires', 'Status'].map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {q.data.items.map((k) => (
              <tr key={k.id}>
                <td>
                  <SafeText value={k.name} />
                </td>
                <td className="font-mono text-xs">{k.keyId}</td>
                <td>{k.scopes.map((s) => SCOPE_OPTIONS.find((o) => o.scope === s)?.label ?? s).join(', ')}</td>
                <td>{formatDateTime(k.createdAt)}</td>
                <td>{k.lastUsedAt ? formatDateTime(k.lastUsedAt) : NEVER_USED_LABEL}</td>
                <td>{k.expiresAt ? formatDateTime(k.expiresAt) : NO_EXPIRY_LABEL}</td>
                <td>
                  <span className="mr-2">{STATUS_TEXT[k.status] ?? k.status}</span>
                  {k.status === 'ACTIVE' ? (
                    <button type="button" className="btn" onClick={() => setRevoking(k)}>
                      {`Revoke ${displayText(k.name)}`}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {creating ? <CreateDialog onClose={() => setCreating(false)} /> : null}
      {revoking ? <RevokeDialog apiKey={revoking} onClose={() => setRevoking(null)} /> : null}
    </section>
  );
}
