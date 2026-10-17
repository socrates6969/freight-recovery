import { ApprovalsPage as ApprovalsPageSchema } from '@fr/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Command as CommandIcon, FileText, ListChecks, LogOut, Upload, UserRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useApi, useServices, useSession } from '../../app-context';
import { SafeText } from '../../components/ui/SafeText';
import { ToastRegion } from '../../components/ui/ToastRegion';
import { signOut } from '../auth/session-actions';

import { CommandPalette, type Command } from './CommandPalette';

/** Guard: wait for session restore; anonymous users go to /login?next=<path>. */
export function RequireSession() {
  const status = useSession((s) => s.status);
  const location = useLocation();
  if (status === 'unknown') {
    return (
      <div role="status" aria-label="Loading" className="p-8">
        Loading...
      </div>
    );
  }
  if (status === 'anonymous') {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <AppShell />;
}

function AccountMenu({ onSignOut }: { onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <UserRound size={16} aria-hidden="true" />
        <span>Account menu</span>
      </button>
      {open ? (
        <div role="menu" aria-label="Account menu" className="card absolute right-0 z-20 mt-1 min-w-40 p-1">
          <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-[var(--color-surface-2)]" onClick={onSignOut}>
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell() {
  const api = useApi();
  const { session } = useServices();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const user = useSession((s) => s.user);
  const permissions = useSession((s) => s.permissions);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteButton = useRef<HTMLButtonElement>(null);
  const isTenantUser = Boolean(user?.tenant) && permissions.includes('claims:read');
  const canImport = permissions.includes('import:run');
  const canReview = permissions.includes('import:review');

  const pending = useQuery({
    queryKey: ['approvals', 'pending-count'],
    queryFn: () => api.get('/api/v1/approvals?status=PENDING_REVIEW&pageSize=1', ApprovalsPageSchema),
    enabled: isTenantUser,
    staleTime: 15000,
  });

  const doSignOut = useCallback(() => {
    void signOut(api, session).then(() => {
      queryClient.clear();
      void navigate('/login', { replace: true });
    });
  }, [api, navigate, queryClient, session]);

  const commands = useMemo<Command[]>(
    () => [
      { id: 'claims', label: 'Go to Claims', run: () => void navigate('/claims') },
      { id: 'approvals', label: 'Go to Approvals', run: () => void navigate('/approvals') },
      { id: 'signout', label: 'Sign out', run: doSignOut },
    ],
    [doSignOut, navigate],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-md px-3 py-2 ${isActive ? 'bg-[var(--color-accent-tint)] font-medium text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]'}`;

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <p className="mb-4 px-3 text-sm font-semibold">Freight Recovery</p>
        <nav aria-label="Main" className="flex flex-col gap-1">
          <NavLink to="/claims" className={navClass}>
            <FileText size={16} aria-hidden="true" />
            Claims
          </NavLink>
          <NavLink to="/approvals" className={navClass}>
            <ClipboardCheck size={16} aria-hidden="true" />
            Approvals
            {pending.data ? <span className="badge badge-accent num ml-auto">{pending.data.total}</span> : null}
          </NavLink>
          {canImport ? (
            <NavLink to="/import" end className={navClass}>
              <Upload size={16} aria-hidden="true" />
              Import
            </NavLink>
          ) : null}
          {canReview ? (
            <NavLink to="/import/review" className={navClass}>
              <ListChecks size={16} aria-hidden="true" />
              Review queue
            </NavLink>
          ) : null}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-6 py-3">
          <div className="text-sm font-medium">{user?.tenant ? <SafeText value={user.tenant.name} /> : 'Platform'}</div>
          <div className="flex items-center gap-2">
            <button ref={paletteButton} type="button" className="btn" aria-label="Command menu" onClick={() => setPaletteOpen(true)}>
              <CommandIcon size={16} aria-hidden="true" />
              <span className="muted text-xs">Ctrl K</span>
            </button>
            <AccountMenu onSignOut={doSignOut} />
          </div>
        </header>
        <main className="min-w-0 flex-1 px-6 py-5">
          {isTenantUser ? (
            <Outlet />
          ) : (
            <section className="card p-6">
              <h1 className="mb-2 text-lg font-semibold">No tenant access</h1>
              <p className="muted">Platform accounts cannot view customer claims in this app.</p>
            </section>
          )}
        </main>
      </div>
      {paletteOpen ? <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} /> : null}
      <ToastRegion />
    </div>
  );
}
