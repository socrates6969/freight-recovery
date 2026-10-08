import { InviteInspectResponse } from '@fr/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { ApiError } from '../../api/client';
import { useApi } from '../../app-context';
import { tokenFromHash } from '../../lib/safe-next';

import { AuthLayout } from './AuthLayout';
import { lockMessage } from './session-actions';

const SENT_TEXT = 'If an account exists, a reset link has been sent.';
const POLICY_TEXT = 'Choose a stronger password: 12 to 128 characters, not a common password, not your email name.';

/** Reads `#token=...` once, then removes the fragment from the address bar (token stays in memory). */
function useFragmentToken(): string | null {
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState<string | null>(() => tokenFromHash(location.hash));
  useEffect(() => {
    if (location.hash) void navigate(location.pathname, { replace: true });
  }, [location.hash, location.pathname, navigate]);
  return token;
}

export function ForgotPage() {
  const api = useApi();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/v1/auth/forgot', { email }, undefined, false);
      setStatus(SENT_TEXT);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setError(lockMessage(err.code, err.retryAfterSeconds));
      else setStatus(SENT_TEXT);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Reset your password">
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-3">
        <div>
          <label className="label" htmlFor="forgot-email">
            Email
          </label>
          <input id="forgot-email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary justify-center" disabled={busy}>
          Send reset link
        </button>
        <p role="status" className="text-sm">
          {status}
        </p>
        {error ? (
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {error}
          </p>
        ) : null}
        <Link to="/login" className="text-sm text-[var(--color-accent)]">
          Back to sign in
        </Link>
      </form>
    </AuthLayout>
  );
}

export function ResetPage() {
  const api = useApi();
  const token = useFragmentToken();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (password !== confirm) {
      setMessage('The passwords do not match.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api.post('/api/v1/auth/reset', { token, password }, undefined, false);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'weak_password') setMessage(POLICY_TEXT);
      else if (err instanceof ApiError && err.status === 429) setMessage(lockMessage(err.code, err.retryAfterSeconds));
      else setMessage('This reset link is invalid or has expired.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthLayout title="Password updated">
        <p role="status" className="mb-3 text-sm">
          Your password was reset and all sessions were signed out.
        </p>
        <Link to="/login" className="btn btn-primary justify-center">
          Sign in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password">
      {token === null ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          This reset link is invalid or has expired.
        </p>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-3">
          <div>
            <label className="label" htmlFor="reset-password">
              New password
            </label>
            <input id="reset-password" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="reset-confirm">
              Confirm new password
            </label>
            <input id="reset-confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {message ? (
            <p role="alert" className="text-sm text-[var(--color-danger)]">
              {message}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary justify-center" disabled={busy || !token}>
            Reset password
          </button>
        </form>
      )}
    </AuthLayout>
  );
}

export function InvitePage() {
  const api = useApi();
  const token = useFragmentToken();
  const [invite, setInvite] = useState<{ email: string; tenantName: string; role: string } | null>(null);
  const [inspectFailed, setInspectFailed] = useState(false);
  const invalid = token === null || inspectFailed;
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (token === null) return;
    api
      .post('/api/v1/auth/invites/inspect', { token }, InviteInspectResponse, false)
      .then(setInvite)
      .catch(() => setInspectFailed(true));
  }, [api, token]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (password !== confirm) {
      setMessage('The passwords do not match.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api.post('/api/v1/auth/invites/accept', { token, name, password }, undefined, false);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'weak_password') setMessage(POLICY_TEXT);
      else if (err instanceof ApiError && err.code === 'conflict') setMessage('An account with this email already exists.');
      else if (err instanceof ApiError && err.code === 'validation_error') setMessage('Enter your name (no special control characters).');
      else setMessage('This invitation is invalid or has expired.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthLayout title="Account created">
        <p role="status" className="mb-3 text-sm">
          Your account is ready. Sign in to continue.
        </p>
        <Link to="/login" className="btn btn-primary justify-center">
          Sign in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Accept invitation">
      {invalid ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          This invitation is invalid or has expired.
        </p>
      ) : !invite ? (
        <div className="skeleton h-24" aria-hidden="true" />
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-3">
          <p className="text-sm">
            Joining <bdi className="safe-text font-medium">{invite.tenantName}</bdi> as {invite.role.toLowerCase()}. Email:{' '}
            <bdi className="safe-text font-medium">{invite.email}</bdi>
          </p>
          <div>
            <label className="label" htmlFor="invite-name">
              Name
            </label>
            <input id="invite-name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="invite-password">
              Password
            </label>
            <input id="invite-password" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="invite-confirm">
              Confirm password
            </label>
            <input id="invite-confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {message ? (
            <p role="alert" className="text-sm text-[var(--color-danger)]">
              {message}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary justify-center" disabled={busy}>
            Create account
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
