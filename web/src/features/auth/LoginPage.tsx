import { LoginResponse } from '@fr/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { ApiError } from '../../api/client';
import { useApi, useServices } from '../../app-context';
import { safeNextPath } from '../../lib/safe-next';

import { AuthLayout } from './AuthLayout';
import { loadMe, lockMessage } from './session-actions';
import { useRetryCountdown } from './use-retry-countdown';

export function LoginPage() {
  const api = useApi();
  const { session } = useServices();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ code: string } | null>(null);
  const [retryUntil, setRetryUntil] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const remaining = useRetryCountdown(retryUntil);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post('/api/v1/auth/login', { email, password }, LoginResponse, false);
      if (r.status === 'ok') {
        session.getState().setSession(r.accessToken, r.user);
        await loadMe(api, session);
        void navigate(next, { replace: true });
      } else if (r.status === 'mfa_required') {
        session.getState().setPending({ mfaToken: r.mfaToken, enrollToken: null });
        void navigate(`/login/mfa?next=${encodeURIComponent(next)}`);
      } else {
        session.getState().setPending({ enrollToken: r.enrollToken, mfaToken: null });
        void navigate('/login/mfa-setup');
      }
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'error';
      if (err instanceof ApiError && err.status === 429) setRetryUntil(Date.now() + (err.retryAfterSeconds ?? 60) * 1000);
      setError({ code });
    } finally {
      setBusy(false);
      setPassword('');
    }
  };

  let message: string | null = null;
  if (error) {
    if (error.code === 'account_locked' || error.code === 'rate_limited') message = lockMessage(error.code, remaining);
    else if (error.code === 'invalid_credentials' || error.code === 'validation_error') message = 'Invalid email or password.';
    else message = 'Sign-in failed. Please try again.';
  }

  return (
    <AuthLayout title="Sign in">
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-3">
        <div>
          <label className="label" htmlFor="login-email">
            Email
          </label>
          <input id="login-email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {message ? (
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {message}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary justify-center" disabled={busy || (retryUntil !== null && remaining > 0)}>
          Sign in
        </button>
        <Link to="/forgot" className="text-sm text-[var(--color-accent)]">
          Forgot password?
        </Link>
      </form>
    </AuthLayout>
  );
}
