import { MeResponse } from '@fr/shared';

import type { ApiClient } from '../../api/client';
import type { SessionStore } from '../../auth/session-store';

/** Load /me (role + permissions) into the session store. */
export async function loadMe(api: ApiClient, session: SessionStore): Promise<void> {
  const me = await api.get('/api/v1/me', MeResponse);
  session.getState().setMe(me);
}

/** Restore a session on app load via the HttpOnly refresh cookie (silent). */
export async function restoreSession(api: ApiClient, session: SessionStore): Promise<void> {
  const ok = await api.refresh();
  if (!ok) {
    session.getState().clear();
    return;
  }
  try {
    await loadMe(api, session);
  } catch {
    session.getState().clear();
  }
}

/** Sign out: revoke the session server-side, then clear local state. */
export async function signOut(api: ApiClient, session: SessionStore): Promise<void> {
  try {
    await api.post('/api/v1/auth/logout', {}, undefined, false);
  } catch {
    // Local state is cleared regardless.
  }
  session.getState().clear();
}

export function lockMessage(code: string, seconds: number | null): string {
  const s = seconds ?? 60;
  return code === 'account_locked'
    ? `Too many failed attempts. Try again in ${s} seconds.`
    : `Too many requests. Try again in ${s} seconds.`;
}
