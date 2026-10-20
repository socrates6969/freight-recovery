/**
 * REQ-20261020-dd-deadline: the D&D dispute-window line shown on the claims list, the claim sheet and the
 * worklist. The text is the shared fixed wording; the API states the facts (invoice date, stated and applied
 * window, closing date) and the days left are counted from `today` (the API's UTC date on the worklist, the
 * browser's UTC date elsewhere). Red at or below DD_DEADLINE_RED_DAYS days and once the floor date has passed.
 */
import { DD_DISPUTE_WINDOW_NOTE, ddDisputeDaysLeft, ddDisputeUrgency, ddDisputeWindowText, utcDay, type DdDisputeWindowDto } from '@fr/shared';

export function todayUtc(): string {
  return utcDay(new Date());
}

/** CSS class of a window line by urgency (red <= 7 days or closed). */
export function disputeWindowClass(daysLeft: number): string {
  const u = ddDisputeUrgency(daysLeft);
  return u === 'red' || u === 'closed' ? 'font-medium text-[var(--color-danger)]' : u === 'urgent' ? 'font-medium text-[var(--color-warn)]' : '';
}

export function DisputeWindowLine({ window, today, className = '' }: { window: Pick<DdDisputeWindowDto, 'closesOn'>; today: string; className?: string }) {
  const daysLeft = ddDisputeDaysLeft(window.closesOn, today);
  return (
    <span className={`${disputeWindowClass(daysLeft)} ${className}`.trim()} data-days-left={daysLeft}>
      {ddDisputeWindowText(window, today)}
    </span>
  );
}

/** The basis of the window, as fixed copy: stated terms, the floor, and the counsel note. */
export function DisputeWindowBasis({ window }: { window: DdDisputeWindowDto }) {
  const stated = window.statedDays === null ? 'the invoice states no request window' : `the invoice states ${window.statedDays} days`;
  const applied = window.floorApplied ? `; the ${window.windowDays}-day floor of ${window.regulation} applies` : `; ${window.windowDays} days applied (${window.regulation} floor not needed)`;
  return (
    <p className="muted text-xs">
      {`Invoice date ${window.invoiceDate}; ${stated}${applied}. `}
      {DD_DISPUTE_WINDOW_NOTE}
    </p>
  );
}