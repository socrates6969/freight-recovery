/**
 * Shared bits of the Dev dashboard: query options (no polling, no focus refetch, nothing kept after the
 * view closes, so every view is a deliberate, audited request), fixed error text and small renderers.
 */
import type { ReactNode } from 'react';

import { step4ErrorText } from '../../api/client';

export const DEV_QUERY = { refetchOnWindowFocus: false, staleTime: Number.POSITIVE_INFINITY, gcTime: 0, retry: false } as const;

export function ErrorState({ error }: { error: unknown }) {
  return <p role="alert">{step4ErrorText(error)}</p>;
}

export function Loading() {
  return <div className="skeleton h-24" aria-hidden="true" />;
}

export function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-3 py-1">
      <dt className="muted">{label}</dt>
      <dd className="num">{children}</dd>
    </div>
  );
}

/** Percentage of a [0,1] rate with one decimal, e.g. 0.416667 -> "41.7%". */
export function percent1(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/** A bucket upper bound: the number, "> 5000" for the +Inf bucket of a non-empty histogram, else a dash. */
export function boundText(bound: number | null, count: number): string {
  if (count === 0) return '—';
  return bound === null ? '> 5000' : String(bound);
}

export function RefreshButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button type="button" className="btn" onClick={onClick} disabled={busy}>
      Refresh
    </button>
  );
}
