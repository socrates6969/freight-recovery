export { formatUsdCents } from '@fr/shared';

const DATE_TIME = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});
const DATE = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Formats an ISO timestamp as UTC; invalid input renders as an em dash. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${DATE_TIME.format(d)} UTC`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : DATE.format(d);
}

/** Calendar day as plain YYYY-MM-DD in UTC (leader ruling SQ5: used for invoice dates). */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
}

export const STATUS_LABEL: Record<string, string> = {
  PENDING_REVIEW: 'Pending review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SEND_READY: 'Send-ready',
  SUPERSEDED: 'Superseded',
  AWAITING_ANALYSIS: 'Awaiting analysis',
};
