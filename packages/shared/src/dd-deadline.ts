/**
 * REQ-20261020-dd-deadline: the ocean D&D dispute deadline. 46 CFR 541.8(a) gives the billed party at least
 * DD_DISPUTE_MIN_DAYS (30) calendar days from invoice issuance to request mitigation, refund or waiver. The
 * window applied here is the request window the invoice states, with the 30-day minimum as the floor when
 * the invoice states less or nothing. Pure and clock-free: callers pass `today` as a `YYYY-MM-DD` UTC date.
 * Lives outside `ocean-dd/` (that directory is byte-pinned by an acceptance test) and reuses its date
 * arithmetic, so the same result is produced on every runtime.
 */
import { z } from 'zod';

import { DD_DISPUTE_MIN_DAYS } from './ocean-dd/constants.js';
import { ddAddDays, ddDaysBetween, isDdDate } from './ocean-dd/dates.js';

export const DD_DISPUTE_REGULATION = '46 CFR 541.8(a)' as const;
/** Deadline-first ordering (api priority.ts): a D&D claim whose window closes within this many days outranks priority-v1. */
export const DD_DEADLINE_URGENT_DAYS = 14;
/** The window is shown in red at or below this many days left (and when it is closed). */
export const DD_DEADLINE_RED_DAYS = 7;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

/** What the stored invoice states: its issue date and its request window in days (null = not stated). */
export interface DdDisputeTerms {
  invoiceDate: string | null;
  statedDays: number | null;
}

export const DdDisputeWindow = z.strictObject({
  regulation: z.literal(DD_DISPUTE_REGULATION),
  invoiceDate: z.string().regex(DATE_RE),
  statedDays: z.int().min(0).nullable(),
  windowDays: z.int().min(DD_DISPUTE_MIN_DAYS),
  /** True when the 30-day floor replaced a shorter or missing stated window. */
  floorApplied: z.boolean(),
  closesOn: z.string().regex(DATE_RE),
});
export type DdDisputeWindowDto = z.infer<typeof DdDisputeWindow>;

export type DdDisputeUrgency = 'closed' | 'red' | 'urgent' | 'open';

/**
 * The window of one invoice, or null when no invoice date is stored (nothing to count from) or the closing
 * date would leave the supported date range. RangeError for a malformed date or a negative/non-integer
 * stated window (the schemas refuse both before storage).
 */
export function computeDdDisputeWindow(terms: DdDisputeTerms): DdDisputeWindowDto | null {
  if (terms.invoiceDate === null) return null;
  if (!isDdDate(terms.invoiceDate)) throw new RangeError('invoiceDate must be a civil date 2000-01-01..2099-12-31');
  const stated = terms.statedDays;
  if (stated !== null && (!Number.isSafeInteger(stated) || stated < 0)) throw new RangeError('statedDays must be a non-negative integer or null');
  const floorApplied = stated === null || stated < DD_DISPUTE_MIN_DAYS;
  const windowDays = floorApplied ? DD_DISPUTE_MIN_DAYS : stated;
  let closesOn: string;
  try {
    closesOn = ddAddDays(terms.invoiceDate, windowDays);
  } catch {
    return null;
  }
  return { regulation: DD_DISPUTE_REGULATION, invoiceDate: terms.invoiceDate, statedDays: stated, windowDays, floorApplied, closesOn };
}

/** Whole days from `today` to the closing date: 0 = closes today, negative = already closed. */
export function ddDisputeDaysLeft(closesOn: string, today: string): number {
  return ddDaysBetween(today, closesOn);
}

export function ddDisputeUrgency(daysLeft: number): DdDisputeUrgency {
  if (daysLeft < 0) return 'closed';
  if (daysLeft <= DD_DEADLINE_RED_DAYS) return 'red';
  if (daysLeft <= DD_DEADLINE_URGENT_DAYS) return 'urgent';
  return 'open';
}

function days(n: number): string {
  return n === 1 ? '1 day' : `${n} days`;
}

/** "Dispute window: N days left (closes YYYY-MM-DD)", or the closed form once the floor date has passed. */
export function ddDisputeWindowText(w: Pick<DdDisputeWindowDto, 'closesOn'>, today: string): string {
  const left = ddDisputeDaysLeft(w.closesOn, today);
  if (left < 0) return `Dispute window closed ${w.closesOn} (${days(-left)} ago)`;
  return `Dispute window: ${days(left)} left (closes ${w.closesOn})`;
}

/** `YYYY-MM-DD` of an instant in UTC (the date the API counts from). */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const DD_DISPUTE_WINDOW_NOTE =
  'The dispute window is computed from the invoice date and the request window the invoice states. The 30 calendar days of 46 CFR 541.8(a) are the floor and apply when the invoice states less or nothing; a tariff or service contract may allow more. Confirm current rules and any dispute with counsel or your customs broker.';

export const DD_DEADLINE_RULE_NOTE = `Ocean D&D claims whose dispute window closes within ${DD_DEADLINE_URGENT_DAYS} days are listed first, soonest first; every other claim follows in priority-v1 order. A claim whose floor date has already passed is not moved up; it is marked as closed.`;