import { EnrollStartResponse, EnrollVerifyResponse } from '@fr/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { ApiError } from '../../api/client';
import { useApi, useServices, useSession, useToast } from '../../app-context';

import { AuthLayout } from './AuthLayout';
import { QrCode } from './QrCode';
import { loadMe, lockMessage } from './session-actions';

export function MfaSetupPage() {
  const api = useApi();
  const { session } = useServices();
  const toast = useToast();
  const navigate = useNavigate();
  const enrollToken = useSession((s) => s.enrollToken);
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!enrollToken || started.current) return;
    started.current = true;
    api
      .post('/api/v1/auth/mfa/enroll/start', { enrollToken }, EnrollStartResponse, false)
      .then(setEnrollment)
      .catch(() => {
        session.getState().setPending({ enrollToken: null });
        void navigate('/login', { replace: true });
      });
  }, [api, enrollToken, navigate, session]);

  if (!enrollToken && !recoveryCodes) return <Navigate to="/login" replace />;

  const onVerify = async (e: FormEvent) => {
    e.preventDefault();
    if (!enrollToken) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await api.post('/api/v1/auth/mfa/enroll/verify', { enrollToken, code: code.trim() }, EnrollVerifyResponse, false);
      setRecoveryCodes(r.recoveryCodes);
      session.getState().setSession(r.accessToken, r.user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setMessage(lockMessage(err.code, err.retryAfterSeconds));
      else setMessage('Invalid authentication code.');
    } finally {
      setBusy(false);
    }
  };

  const onCopy = async () => {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      toast('Recovery codes copied.', 'success');
    } catch {
      toast('Copy failed. Select and copy the codes manually.', 'error');
    }
  };

  const onDone = async () => {
    try {
      await loadMe(api, session);
    } finally {
      void navigate('/claims', { replace: true });
    }
  };

  if (recoveryCodes) {
    return (
      <AuthLayout title="Save your recovery codes">
        <section aria-label="Recovery codes" className="flex flex-col gap-3">
          <p className="muted text-sm">Each code works once if you lose your authenticator. They are shown only now.</p>
          <ul className="num grid grid-cols-2 gap-1 rounded-md bg-[var(--color-surface)] p-3 font-mono text-sm">
            {recoveryCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <button type="button" className="btn justify-center" onClick={() => void onCopy()}>
            Copy codes
          </button>
          <button type="button" className="btn btn-primary justify-center" onClick={() => void onDone()}>
            I have saved these codes
          </button>
        </section>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Set up two-step verification">
      <form onSubmit={(e) => void onVerify(e)} noValidate className="flex flex-col gap-3">
        <p className="muted text-sm">Your role requires an authenticator app. Scan the QR code or enter the secret manually.</p>
        {enrollment ? (
          <>
            <div className="flex justify-center">
              <QrCode value={enrollment.otpauthUri} />
            </div>
            <p className="text-sm">
              Secret:{' '}
              <code aria-label="Authenticator secret" className="safe-text font-mono">
                {enrollment.secret}
              </code>
            </p>
          </>
        ) : (
          <div className="skeleton h-40" aria-hidden="true" />
        )}
        <div>
          <label className="label" htmlFor="enroll-code">
            Authentication code
          </label>
          <input
            id="enroll-code"
            className="input num"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        {message ? (
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {message}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary justify-center" disabled={busy || !enrollment}>
          Verify and continue
        </button>
      </form>
    </AuthLayout>
  );
}
