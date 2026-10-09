/**
 * Dev dashboard shell (Q12): heading, tab list "Dev sections" (per permission, URL state, arrow keys) and
 * the active section. Platform users only; tenant users are sent to /claims.
 */
import { type KeyboardEvent } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useSession } from '../../app-context';

export const DEV_TABS = [
  { slug: 'pipeline', label: 'Pipeline health', permission: 'platform:health' },
  { slug: 'telemetry', label: 'Telemetry', permission: 'platform:health' },
  { slug: 'logs', label: 'Logs', permission: 'platform:logs' },
  { slug: 'flags', label: 'Feature flags', permission: 'platform:flags' },
  { slug: 'evaluation', label: 'Evaluation', permission: 'platform:eval' },
  { slug: 'audit', label: 'Audit', permission: 'platform:audit' },
] as const;

export function devTabsFor(permissions: readonly string[]) {
  return DEV_TABS.filter((t) => permissions.includes(t.permission));
}

export function DevDashboard() {
  const user = useSession((s) => s.user);
  const permissions = useSession((s) => s.permissions);
  const location = useLocation();
  const navigate = useNavigate();
  const tabs = devTabsFor(permissions);
  if (user?.tenant || !permissions.includes('platform:health') || tabs.length === 0) return <Navigate to="/claims" replace />;
  const current = tabs.find((t) => location.pathname === `/dev/${t.slug}`);
  if (!current) {
    const first = tabs[0];
    return first ? <Navigate to={`/dev/${first.slug}`} replace /> : null;
  }

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = tabs.indexOf(current);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    if (next) {
      void navigate(`/dev/${next.slug}`);
      document.getElementById(`dev-tab-${next.slug}`)?.focus();
    }
  };

  return (
    <section>
      <h1 className="mb-4 text-lg font-semibold">Dev dashboard</h1>
      <div role="tablist" aria-label="Dev sections" className="mb-4 flex flex-wrap gap-1 border-b border-[var(--color-border)]">
        {tabs.map((t) => (
          <button
            key={t.slug}
            id={`dev-tab-${t.slug}`}
            type="button"
            role="tab"
            aria-selected={t === current}
            aria-controls="dev-panel"
            tabIndex={t === current ? 0 : -1}
            onClick={() => void navigate(`/dev/${t.slug}`)}
            onKeyDown={onKey}
            className={`-mb-px border-b-2 px-3 py-2 ${t === current ? 'border-[var(--color-accent)] font-medium' : 'muted border-transparent'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="dev-panel" aria-labelledby={`dev-tab-${current.slug}`} tabIndex={0}>
        <Outlet />
      </div>
    </section>
  );
}
