/**
 * Packet content hash (A11): SHA-256 over canonical JSON of the packet CONTENT, using source ordinals
 * instead of UUIDs so a copied revision hashes identically. Approval binds to this hash; send re-checks it.
 */
import { createHash } from 'node:crypto';

import { canonicalJson } from '@fr/shared';

export interface HashSource {
  id: string;
  ordinal: number;
  filename: string;
  docType: string;
  sha256: string;
  sizeBytes: number;
}

export interface HashTimeline {
  ordinal: number;
  occurredAt: Date;
  kind: string;
  label: string;
  sourceId: string | null;
}

export interface HashCitation {
  sourceId: string;
  locator: string;
  excerpt: string;
}

export interface HashFinding {
  ordinal: number;
  ruleId: string;
  title: string;
  direction: string;
  amountCents: number;
  explanation: string;
  calculation: string[];
  confidence: number;
  needsHumanReview: boolean;
  citations: HashCitation[];
  clauseSourceId: string | null;
  clauseLabel: string | null;
  clauseExcerpt: string | null;
  clauseLocator: string | null;
}

export interface HashPacket {
  perspective: string;
  loadNumber: string | null;
  currency: string;
  recoverableCents: number;
  pendingReviewCents: number;
  demandLetter: string;
  sources: HashSource[];
  timeline: HashTimeline[];
  findings: HashFinding[];
}

function byOrdinal<T extends { ordinal: number }>(xs: readonly T[]): T[] {
  return [...xs].sort((a, b) => a.ordinal - b.ordinal);
}

export function packetContentHash(p: HashPacket): string {
  const sources = byOrdinal(p.sources);
  const ordinalOf = new Map(sources.map((s) => [s.id, s.ordinal]));
  const ord = (id: string | null): number | null => {
    if (id === null) return null;
    const o = ordinalOf.get(id);
    if (o === undefined) throw new Error('content hash: reference to a source outside the packet');
    return o;
  };
  const body = {
    perspective: p.perspective,
    loadNumber: p.loadNumber,
    currency: p.currency,
    recoverableCents: p.recoverableCents,
    pendingReviewCents: p.pendingReviewCents,
    demandLetter: p.demandLetter,
    sources: sources.map((s) => ({ filename: s.filename, docType: s.docType, sha256: s.sha256, sizeBytes: s.sizeBytes })),
    timeline: byOrdinal(p.timeline).map((t) => ({
      occurredAt: t.occurredAt.toISOString(),
      kind: t.kind,
      label: t.label,
      sourceOrdinal: ord(t.sourceId),
    })),
    findings: byOrdinal(p.findings).map((f) => ({
      ruleId: f.ruleId,
      title: f.title,
      direction: f.direction,
      amountCents: f.amountCents,
      explanation: f.explanation,
      calculation: f.calculation,
      confidence: f.confidence,
      needsHumanReview: f.needsHumanReview,
      citations: f.citations.map((c) => ({ sourceOrdinal: ord(c.sourceId), locator: c.locator, excerpt: c.excerpt })),
      clause:
        f.clauseSourceId === null
          ? null
          : {
              sourceOrdinal: ord(f.clauseSourceId),
              label: f.clauseLabel ?? '',
              excerpt: f.clauseExcerpt ?? '',
              locator: f.clauseLocator ?? '',
            },
    })),
  };
  return createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex');
}

/** recoverable = sum of confirmed findings; pending = sum of findings needing human review. */
export function packetTotals(findings: readonly { amountCents: number; needsHumanReview: boolean }[]): {
  recoverableCents: number;
  pendingReviewCents: number;
  amountClaimedCents: number;
} {
  let recoverable = 0;
  let pending = 0;
  for (const f of findings) {
    if (f.needsHumanReview) pending += f.amountCents;
    else recoverable += f.amountCents;
  }
  return { recoverableCents: recoverable, pendingReviewCents: pending, amountClaimedCents: recoverable + pending };
}
