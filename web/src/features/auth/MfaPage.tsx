import { SessionOk } from '@fr/shared';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';

import { ApiError } from '../../api/client';
import { useApi, useServices, useSession } from '../../app-context';
import { safeNextPath } from '../../lib/safe-next';

import { AuthLayout } from './AuthLayout';
import { loadMe, lockMessage } from './session-actions';

export function MfaPage() {
  const api = useApi();
  const { session } = useServices();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const mfaToken = useSession((s) => s.mfaToken);
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!mfaToken) return <Navigate to="/login" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const body = useRecovery ? { mfaToken, recoveryCode: recoveryCode.trim() } : { mfaToken, code: code.trim() };
      const r = await api.post('/api/v1/auth/mfa/verify', body, SessionOk, false);
      session.getState().setSession(r.accessToken, r.user);
      await loadMe(api, session);
      void navigate(safeNextPath(params.get('next')), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_token') {
        session.getState().setPending({ mfaToken: null });
        void navigate('/login', { replace: true });
        return;
      }
      if (err instanceof ApiError && err.status === 429) setMessage(lockMessage(err.code, err.retryAfterSeconds));
      else setMessage('Invalid authentication code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Two-step verification">
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-3">
        {useRecovery ? (
          <div>
            <label className="label" htmlFor="mfa-recovery">
              Recovery code
            </label>
            <input
              id="mfa-recovery"
              className="input"
              autoComplete="off"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              data-autofocus
            />
          </div>
        ) : (
          <div>
            <label className="label" htmlFor="mfa-code">
              Authentication code
            </label>
            <input
              id="mfa-code"
              className="input num"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
        )}
        {message ? (
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {message}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary justify-center" disabled={busy}>
          Verify
        </button>
        {!useRecovery ? (
          <button type="button" className="btn justify-center" onClick={() => setUseRecovery(true)}>
            Use a recovery code
          </button>
        ) : null}
      </form>
    </AuthLayout>
  );
}
