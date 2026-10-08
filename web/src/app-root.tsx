/**
 * AppRoot (C6): owns per-instance services (API client, in-memory session store, toasts, query client)
 * and the data router. With `initialEntries` it uses an in-memory router (tests); otherwise the browser
 * router. All network access goes through `fetchImpl ?? globalThis.fetch`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createBrowserRouter, createMemoryRouter, Navigate, RouterProvider, type RouteObject } from 'react-router-dom';

import { ApiClient } from './api/client';
import { ServicesProvider, type AppServices } from './app-context';
import { createSessionStore } from './auth/session-store';
import { ErrorBoundary } from './components/ErrorBoundary';
import { createToastStore } from './components/ui/toast-store';
import { restoreSession } from './features/auth/session-actions';

function NotFound() {
  return (
    <main className="p-8">
      <h1 className="mb-2 text-lg font-semibold">Page not found</h1>
      <a className="text-[var(--color-accent)]" href="/claims">
        Go to claims
      </a>
    </main>
  );
}

export const routes: RouteObject[] = [
  { path: '/login', lazy: async () => ({ Component: (await import('./features/auth/LoginPage')).LoginPage }) },
  { path: '/login/mfa', lazy: async () => ({ Component: (await import('./features/auth/MfaPage')).MfaPage }) },
  { path: '/login/mfa-setup', lazy: async () => ({ Component: (await import('./features/auth/MfaSetupPage')).MfaSetupPage }) },
  { path: '/forgot', lazy: async () => ({ Component: (await import('./features/auth/RecoveryPages')).ForgotPage }) },
  { path: '/reset', lazy: async () => ({ Component: (await import('./features/auth/RecoveryPages')).ResetPage }) },
  { path: '/invite', lazy: async () => ({ Component: (await import('./features/auth/RecoveryPages')).InvitePage }) },
  {
    path: '/',
    lazy: async () => ({ Component: (await import('./features/shell/AppShell')).RequireSession }),
    children: [
      { index: true, element: <Navigate to="/claims" replace /> },
      {
        path: 'claims',
        lazy: async () => ({ Component: (await import('./features/claims/ClaimsPage')).ClaimsPage }),
        children: [{ path: ':id', lazy: async () => ({ Component: (await import('./features/claims/ClaimSheet')).ClaimSheet }) }],
      },
      { path: 'approvals', lazy: async () => ({ Component: (await import('./features/approvals/ApprovalsPage')).ApprovalsPage }) },
    ],
  },
  { path: '*', element: <NotFound /> },
];

function createServices(fetchImpl: typeof fetch, onAuthLost: () => void): AppServices {
  const session = createSessionStore();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5000 },
      mutations: { retry: false },
    },
  });
  const api = new ApiClient(fetchImpl, session, onAuthLost);
  return { api, session, queryClient, toasts: createToastStore() };
}

export interface AppRootProps {
  fetchImpl?: typeof fetch;
  initialEntries?: string[];
}

type AppRouter = ReturnType<typeof createBrowserRouter>;

/** Build per-instance services and router (outside React so nothing here is a hook). */
function createAppState(fetchImpl: typeof fetch | undefined, initialEntries: string[] | undefined) {
  const boundFetch: typeof fetch = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const holder: { router: AppRouter | null } = { router: null };
  const services = createServices(boundFetch, () => {
    services.session.getState().clear();
    services.queryClient.clear();
    const router = holder.router;
    if (router) {
      const loc = router.state.location;
      void router.navigate(`/login?next=${encodeURIComponent(`${loc.pathname}${loc.search}`)}`, { replace: true });
    }
  });
  holder.router = initialEntries ? createMemoryRouter(routes, { initialEntries }) : createBrowserRouter(routes);
  return { services, router: holder.router };
}

export function AppRoot({ fetchImpl, initialEntries }: AppRootProps) {
  const [state] = useState(() => createAppState(fetchImpl, initialEntries));

  useEffect(() => {
    const { session, api } = state.services;
    if (session.getState().status === 'unknown') void restoreSession(api, session);
  }, [state]);

  return (
    <ErrorBoundary>
      <ServicesProvider value={state.services}>
        <QueryClientProvider client={state.services.queryClient}>
          <RouterProvider router={state.router} />
        </QueryClientProvider>
      </ServicesProvider>
    </ErrorBoundary>
  );
}
