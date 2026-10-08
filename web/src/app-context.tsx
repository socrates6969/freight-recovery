import type { QueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

import type { ApiClient } from './api/client';
import type { SessionState, SessionStore } from './auth/session-store';
import type { ToastState } from './components/ui/toast-store';

export interface AppServices {
  api: ApiClient;
  session: SessionStore;
  toasts: StoreApi<ToastState>;
  queryClient: QueryClient;
}

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider({ value, children }: { value: AppServices; children: ReactNode }) {
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('ServicesProvider missing');
  return s;
}

export function useApi(): ApiClient {
  return useServices().api;
}

export function useSession<T>(selector: (s: SessionState) => T): T {
  return useStore(useServices().session, selector);
}

export function useToast(): ToastState['push'] {
  return useStore(useServices().toasts, (s) => s.push);
}

export function useCan(permission: string): boolean {
  return useSession((s) => s.permissions.includes(permission));
}
