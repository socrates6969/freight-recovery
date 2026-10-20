/**
 * REQ-20261018-exec-dashboard: the insights filters live in the URL search params so the page state is
 * shareable. Absent or invalid values fall back to the defaults: perspective SHIPPER, both claim kinds and
 * the 30 UTC days ending tomorrow 00:00Z (from = today - 29 days, to = today + 1 day, date-only).
 */
import { hasUnsafeChars, parseInsightsInstant, type ClaimKind, type Perspective } from '@fr/shared';

export type PerspectiveChoice = Perspective | 'ALL';

export interface InsightsParams {
  perspective: PerspectiveChoice;
  kind: ClaimKind | undefined;
  from: string;
  to: string;
  carrier: string | undefined;
}

const DAY_MS = 86_400_000;
const DEFAULT_PERIOD_DAYS = 30;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;
const CARRIER_MAX = 200;

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** from = UTC today - 29 days, to = UTC today + 1 day (both YYYY-MM-DD). */
export function defaultPeriod(now: Date): { from: string; to: string } {
  const today = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  return { from: day(today - (DEFAULT_PERIOD_DAYS - 1) * DAY_MS), to: day(today + DAY_MS) };
}

/** A real calendar date in YYYY-MM-DD form. */
export function isDateOnly(v: string | null): v is string {
  return v !== null && DATE_ONLY.test(v) && parseInsightsInstant(v) !== null;
}

export function parseInsightsParams(sp: URLSearchParams, now: Date): InsightsParams {
  const d = defaultPeriod(now);
  const p = sp.get('perspective');
  const k = sp.get('kind');
  const from = sp.get('from');
  const to = sp.get('to');
  const carrier = sp.get('carrier');
  return {
    perspective: p === 'SHIPPER' || p === 'CARRIER' || p === 'ALL' ? p : 'SHIPPER',
    kind: k === 'FREIGHT' || k === 'OCEAN_DD' ? k : undefined,
    from: isDateOnly(from) ? from : d.from,
    to: isDateOnly(to) ? to : d.to,
    carrier: carrier !== null && carrier.trim().length > 0 && carrier.length <= CARRIER_MAX && !hasUnsafeChars(carrier) ? carrier : undefined,
  };
}

/** True when the period can be requested (from strictly before to). */
export function periodValid(p: Pick<InsightsParams, 'from' | 'to'>): boolean {
  return p.from < p.to;
}

/** The kind/perspective filters as sent to the API (`ALL` sends no perspective). */
export function apiFilters(p: InsightsParams): { kind: ClaimKind | undefined; perspective: Perspective | undefined } {
  return { kind: p.kind, perspective: p.perspective === 'ALL' ? undefined : p.perspective };
}

/** Basis points as a percentage with two decimals, e.g. 1234 -> "12.34%". */
export function percentFromBasisPoints(bp: number): string {
  return `${(bp / 100).toFixed(2)}%`;
}

/** Hours with one decimal as shown in the throughput section. */
export function hoursText(h: number | null): string {
  return h === null ? '—' : `${h.toFixed(1)} h`;
}
