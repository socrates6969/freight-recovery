/**
 * Session state lives ONLY in memory (Zustand vanilla store, one per AppRoot). Never localStorage,
 * sessionStorage, IndexedDB or JS-written cookies. The refresh token is an HttpOnly cookie the
 * browser handles; a page reload restores the session with a silent POST /auth/refresh.
 */
import type { MeResponseDto, SessionUserDto } from '@fr/shared';
import { createStore, type StoreApi } from 'zustand/vanilla';

export type SessionStatus = 'unknown' | 'anonymous' | 'authenticated';

export interface SessionState {
  status: SessionStatus;
  accessToken: string | null;
  user: SessionUserDto | null;
  permissions: readonly string[];
  /** Short-lived step-up tokens, memory only (never router state or storage). */
  mfaToken: string | null;
  enrollToken: string | null;
  setSession: (accessToken: string, user: SessionUserDto) => void;
  setMe: (me: MeResponseDto) => void;
  setPending: (p: { mfaToken?: string | null; enrollToken?: string | null }) => void;
  clear: () => void;
  markAnonymous: () => void;
}

export type SessionStore = StoreApi<SessionState>;

export function createSessionStore(): SessionStore {
  return createStore<SessionState>()((set) => ({
    status: 'unknown',
    accessToken: null,
    user: null,
    permissions: [],
    mfaToken: null,
    enrollToken: null,
    setSession: (accessToken, user) => set({ accessToken, user, status: 'authenticated', mfaToken: null, enrollToken: null }),
    setMe: (me) => set({ user: me.user, permissions: me.permissions }),
    setPending: (p) =>
      set((s) => ({
        mfaToken: p.mfaToken === undefined ? s.mfaToken : p.mfaToken,
        enrollToken: p.enrollToken === undefined ? s.enrollToken : p.enrollToken,
      })),
    clear: () => set({ status: 'anonymous', accessToken: null, user: null, permissions: [], mfaToken: null, enrollToken: null }),
    markAnonymous: () => set({ status: 'anonymous' }),
  }));
}
