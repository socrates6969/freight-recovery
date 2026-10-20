/**
 * priority-v1 (Q6.1): a fixed, documented, deterministic work-order score over stored claim amounts.
 *   valueCents = recoverableCents + floor(pendingReviewCents * W / 100)        (integer arithmetic)
 *   order: valueCents desc, recoverableCents desc, updatedAt asc, id asc       (strict total order)
 * W is stated policy (INTELLIGENCE_PENDING_WEIGHT_PERCENT), not estimated from outcomes. Nothing here
 * depends on the caller, the time of day or randomness; waiting time is shown but is NOT part of the score.
 *
 * deadline-first-v1 (REQ-20261020-dd-deadline), applied BEFORE priority-v1 (`compareDeadlineFirst`):
 *   deadline  = invoice date (UTC) + max(request window the D&D invoice states, DD_DISPUTE_MIN_DAYS = 30)
 *   daysLeft  = deadline - today (UTC date of the API clock); null when no invoice date is stored
 *   urgent    = kind is OCEAN_DD and 0 <= daysLeft <= DD_DEADLINE_URGENT_DAYS (14)
 *   order     = urgent claims first, by daysLeft asc; then priority-v1 for the urgent ties and for everything else
 * A claim whose floor date has passed (daysLeft < 0) is NOT moved up: the 30 days are a floor, and whether a
 * longer tariff window is still open is for counsel; the list marks it as closed. Stated policy, not learned.
 * `db/intelligence.ts` mirrors this order in SQL so pages are consistent; the service checks the days.
 */
import { DD_DEADLINE_URGENT_DAYS, formatUsdCents, type NextAction } from '@fr/shared';

export const DAY_MS = 86_400_000;

export interface ScoreInput {
  recoverableCents: number;
  pendingReviewCents: number;
}

export interface ScorePart {
  key: 'confirmed_recoverable' | 'pending_review';
  inputCents: number;
  weightPercent: number;
  contributionCents: number;
}

function assertCents(v: number, what: string): void {
  if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`${what} must be a non-negative safe integer`);
}

export function assertWeight(w: number): void {
  if (!Number.isInteger(w) || w < 0 || w > 100) throw new RangeError('W must be an integer 0..100');
}

export function scoreClaim(input: ScoreInput, w: number): { valueCents: number; parts: [ScorePart, ScorePart] } {
  assertWeight(w);
  assertCents(input.recoverableCents, 'recoverableCents');
  assertCents(input.pendingReviewCents, 'pendingReviewCents');
  const pendingContribution = Math.floor((input.pendingReviewCents * w) / 100);
  return {
    valueCents: input.recoverableCents + pendingContribution,
    parts: [
      { key: 'confirmed_recoverable', inputCents: input.recoverableCents, weightPercent: 100, contributionCents: input.recoverableCents },
      { key: 'pending_review', inputCents: input.pendingReviewCents, weightPercent: w, contributionCents: pendingContribution },
    ],
  };
}

export interface Rankable {
  valueCents: number;
  recoverableCents: number;
  updatedAt: Date;
  id: string;
}

/** Negative when `a` ranks before `b`. Ids are lowercase canonical UUIDs (byte order = string order). */
export function compareWorklist(a: Rankable, b: Rankable): number {
  if (a.valueCents !== b.valueCents) return b.valueCents - a.valueCents;
  if (a.recoverableCents !== b.recoverableCents) return b.recoverableCents - a.recoverableCents;
  const ta = a.updatedAt.getTime();
  const tb = b.updatedAt.getTime();
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function waitingDays(now: Date, updatedAt: Date): number {
  return Math.max(0, Math.floor((now.getTime() - updatedAt.getTime()) / DAY_MS));
}

export interface DeadlineRankable extends Rankable {
  kind: 'FREIGHT' | 'OCEAN_DD';
  /** Whole days from today to the dispute deadline; null when no invoice date is stored. */
  deadlineDaysLeft: number | null;
}

/** deadline-first-v1: an OCEAN_DD claim with 0..DD_DEADLINE_URGENT_DAYS days left. */
export function isDeadlineUrgent(i: Pick<DeadlineRankable, 'kind' | 'deadlineDaysLeft'>): boolean {
  return i.kind === 'OCEAN_DD' && i.deadlineDaysLeft !== null && i.deadlineDaysLeft >= 0 && i.deadlineDaysLeft <= DD_DEADLINE_URGENT_DAYS;
}

/** Negative when `a` ranks before `b`: urgent first (soonest deadline first), then priority-v1. Strict total order. */
export function compareDeadlineFirst(a: DeadlineRankable, b: DeadlineRankable): number {
  const ua = isDeadlineUrgent(a);
  const ub = isDeadlineUrgent(b);
  if (ua !== ub) return ua ? -1 : 1;
  if (ua && a.deadlineDaysLeft !== b.deadlineDaysLeft) return (a.deadlineDaysLeft ?? 0) - (b.deadlineDaysLeft ?? 0);
  return compareWorklist(a, b);
}

export interface WhyInput {
  recoverableCents: number;
  pendingReviewCents: number;
  w: number;
  status: string;
  pendingFindingsCount: number;
  waitingDays: number;
  /** REQ-20261020-dd-deadline: the dispute-window line of an OCEAN_DD claim (shared `ddDisputeWindowText`), first when present. */
  disputeWindowText?: string | null;
}

/** The "why" lines of Q6.1, in the contract order; each present only when its condition holds. */
export function buildWhy(i: WhyInput): string[] {
  const out: string[] = [];
  if (i.disputeWindowText) out.push(i.disputeWindowText);
  if (i.recoverableCents > 0) out.push(`Confirmed recoverable ${formatUsdCents(i.recoverableCents)} (counted at 100%)`);
  if (i.pendingReviewCents > 0) out.push(`Pending human review ${formatUsdCents(i.pendingReviewCents)} (counted at ${i.w}%)`);
  if (i.status === 'PENDING_REVIEW' && i.pendingFindingsCount > 0) {
    out.push(
      i.pendingFindingsCount === 1
        ? '1 finding needs human review before approval'
        : `${i.pendingFindingsCount} findings need human review before approval`,
    );
  }
  if (i.status === 'APPROVED') out.push('Approved and waiting to be marked send-ready');
  out.push(i.waitingDays === 1 ? 'Waiting 1 day (not part of the score)' : `Waiting ${i.waitingDays} days (not part of the score)`);
  return out;
}

export function nextAction(status: string, pendingFindingsCount: number): NextAction {
  if (status === 'APPROVED') return 'MARK_SEND_READY';
  return pendingFindingsCount > 0 ? 'RESOLVE_FINDINGS' : 'REVIEW_AND_APPROVE';
}
