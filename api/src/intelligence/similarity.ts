/**
 * similar-v1 (Q6.2): explainable integer similarity over features the system really stores (carrier,
 * finding rule ids, amounts, perspective). Fixed weights 35/40/15/10, anchor required (same carrier or
 * a shared rule), minimum 30. No learned component, no cache: every request scores its candidates anew.
 */
import { SIMILARITY_MIN_PERCENT, SIMILARITY_WEIGHTS, formatUsdCents, type MatchKey } from '@fr/shared';

export interface SimilarityFeatures {
  carrierName: string;
  ruleIds: ReadonlySet<string>;
  /** recoverableCents + pendingReviewCents */
  totalCents: number;
  perspective: string;
}

export interface Candidate extends SimilarityFeatures {
  id: string;
  updatedAt: Date;
}

export interface Match {
  key: MatchKey;
  points: number;
  detail: string;
}

export interface Scored {
  points: { sameCarrier: number; sharedRules: number; similarAmount: number; samePerspective: number };
  percent: number;
  matches: Match[];
}

/** Trim, collapse inner whitespace runs to one space, Unicode lower-case. */
export function normalizeCarrier(name: string): string {
  return name.trim().replace(/\s+/gu, ' ').toLowerCase();
}

function sortedStrings(values: Iterable<string>): string[] {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function scoreSimilarity(target: SimilarityFeatures, candidate: SimilarityFeatures): Scored {
  const ca = normalizeCarrier(target.carrierName);
  const cb = normalizeCarrier(candidate.carrierName);
  const sameCarrier = ca.length > 0 && ca === cb ? SIMILARITY_WEIGHTS.sameCarrier : 0;

  let sharedRules = 0;
  let intersection: string[] = [];
  if (target.ruleIds.size > 0 && candidate.ruleIds.size > 0) {
    intersection = sortedStrings([...target.ruleIds].filter((r) => candidate.ruleIds.has(r)));
    const union = new Set([...target.ruleIds, ...candidate.ruleIds]).size;
    sharedRules = Math.floor((SIMILARITY_WEIGHTS.sharedRules * intersection.length) / union);
  }

  const ta = target.totalCents;
  const tb = candidate.totalCents;
  let similarAmount = 0;
  if (ta > 0 && tb > 0) {
    // Integers below 2^53: 15 * min stays exact for totals up to ~6e14 (amounts are 32-bit columns).
    similarAmount = Math.floor((SIMILARITY_WEIGHTS.similarAmount * Math.min(ta, tb)) / Math.max(ta, tb));
  }

  const samePerspective = target.perspective === candidate.perspective ? SIMILARITY_WEIGHTS.samePerspective : 0;
  const matches: Match[] = [];
  if (sameCarrier > 0) matches.push({ key: 'same_carrier', points: sameCarrier, detail: 'Same carrier' });
  if (sharedRules > 0) matches.push({ key: 'shared_rules', points: sharedRules, detail: `Shared rules: ${intersection.join(', ')}` });
  if (similarAmount > 0) matches.push({ key: 'similar_amount', points: similarAmount, detail: `Amounts ${formatUsdCents(ta)} and ${formatUsdCents(tb)}` });
  if (samePerspective > 0) matches.push({ key: 'same_perspective', points: samePerspective, detail: `Same perspective (${candidate.perspective})` });
  return {
    points: { sameCarrier, sharedRules, similarAmount, samePerspective },
    percent: sameCarrier + sharedRules + similarAmount + samePerspective,
    matches,
  };
}

export function isIncluded(s: Scored): boolean {
  return (s.points.sameCarrier > 0 || s.points.sharedRules > 0) && s.percent >= SIMILARITY_MIN_PERCENT;
}

/** Included candidates ordered by percent desc, updatedAt desc, id asc; at most `limit`. */
export function rankSimilar<C extends Candidate>(target: SimilarityFeatures, candidates: readonly C[], limit: number): { candidate: C; scored: Scored }[] {
  const out: { candidate: C; scored: Scored }[] = [];
  for (const c of candidates) {
    const scored = scoreSimilarity(target, c);
    if (isIncluded(scored)) out.push({ candidate: c, scored });
  }
  out.sort((a, b) => {
    if (a.scored.percent !== b.scored.percent) return b.scored.percent - a.scored.percent;
    const ta = a.candidate.updatedAt.getTime();
    const tb = b.candidate.updatedAt.getTime();
    if (ta !== tb) return tb - ta;
    return a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0;
  });
  return out.slice(0, Math.max(0, limit));
}
