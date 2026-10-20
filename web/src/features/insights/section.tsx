/**
 * Shared building blocks of the insights sections (REQ-20261018-exec-dashboard): a labelled section card and
 * the per-section request state (a failed request shows a fixed text in an alert; other sections still render).
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { step4ErrorText } from '../../api/client';

export function Section({ title, suffix, children }: { title: string; suffix?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="card mb-4 p-4">
      <h2 className="mb-2 font-semibold">
        {title}
        {suffix}
      </h2>
      {children}
    </section>
  );
}

/** Renders the alert on error, a skeleton while loading, and `children(data)` once the data is there. */
export function QueryState<T>({ q, children }: { q: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (q.isError) return <p role="alert">{step4ErrorText(q.error)}</p>;
  if (q.data === undefined) return <div className="skeleton h-24" aria-hidden="true" />;
  return <>{children(q.data)}</>;
}

/** Fixed status names used by the stage and ageing tables. */
export const INSIGHTS_STATUS_TEXT: Readonly<Record<string, string>> = Object.freeze({
  AWAITING_ANALYSIS: 'Awaiting analysis',
  PENDING_REVIEW: 'Pending review',
  APPROVED: 'Approved',
  SEND_READY: 'Marked ready to demand',
  REJECTED: 'Rejected',
});
