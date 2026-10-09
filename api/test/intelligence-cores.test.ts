/**
 * priority-v1 and similar-v1 pure cores (A6.1, A6.3): exact formula vectors, contract texts, and property
 * tests on seeded random inputs (strict total order, monotonicity, symmetry, bounds, anchor rule).
 */
import { describe, expect, it } from 'vitest';

import { buildWhy, compareWorklist, nextAction, scoreClaim, waitingDays, type Rankable } from '../src/intelligence/priority.js';
import { isIncluded, normalizeCarrier, rankSimilar, scoreSimilarity, type Candidate } from '../src/intelligence/similarity.js';

function lcg(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

describe('scoreClaim', () => {
  it('value = R + floor(P*W/100) with explicit parts', () => {
    expect(scoreClaim({ recoverableCents: 10000, pendingReviewCents: 999 }, 25)).toEqual({
      valueCents: 10249,
      parts: [
        { key: 'confirmed_recoverable', inputCents: 10000, weightPercent: 100, contributionCents: 10000 },
        { key: 'pending_review', inputCents: 999, weightPercent: 25, contributionCents: 249 },
      ],
    });
    expect(scoreClaim({ recoverableCents: 5, pendingReviewCents: 3 }, 0).valueCents).toBe(5);
    expect(scoreClaim({ recoverableCents: 5, pendingReviewCents: 3 }, 100).valueCents).toBe(8);
    expect(scoreClaim({ recoverableCents: 0, pendingReviewCents: 1 }, 99).valueCents).toBe(0);
    expect(scoreClaim({ recoverableCents: 2147483647, pendingReviewCents: 2147483647 }, 100).valueCents).toBe(4294967294);
  });
  it('rejects invalid W and amounts', () => {
    expect(() => scoreClaim({ recoverableCents: 1, pendingReviewCents: 1 }, 101)).toThrow(RangeError);
    expect(() => scoreClaim({ recoverableCents: 1, pendingReviewCents: 1 }, 2.5)).toThrow(RangeError);
    expect(() => scoreClaim({ recoverableCents: -1, pendingReviewCents: 1 }, 25)).toThrow(RangeError);
  });
  it('is monotone non-decreasing in both inputs (random)', () => {
    const r = lcg(7);
    for (let i = 0; i < 2000; i += 1) {
      const R = Math.floor(r() * 1e7);
      const P = Math.floor(r() * 1e7);
      const w = Math.floor(r() * 101);
      const d = Math.floor(r() * 1000);
      const v = scoreClaim({ recoverableCents: R, pendingReviewCents: P }, w).valueCents;
      expect(scoreClaim({ recoverableCents: R + d, pendingReviewCents: P }, w).valueCents).toBeGreaterThanOrEqual(v);
      expect(scoreClaim({ recoverableCents: R, pendingReviewCents: P + d }, w).valueCents).toBeGreaterThanOrEqual(v);
    }
  });
});

describe('compareWorklist', () => {
  const mk = (v: number, r: number, t: number, id: string): Rankable => ({ valueCents: v, recoverableCents: r, updatedAt: new Date(t), id });
  it('orders by value desc, recoverable desc, updatedAt asc, id asc', () => {
    const items = [
      mk(100, 50, 3, 'b'),
      mk(100, 50, 3, 'a'),
      mk(100, 50, 1, 'z'),
      mk(100, 60, 9, 'q'),
      mk(200, 0, 9, 'y'),
      mk(0, 0, 0, 'x'),
    ];
    expect([...items].sort(compareWorklist).map((i) => i.id)).toEqual(['y', 'q', 'z', 'a', 'b', 'x']);
  });
  it('is a strict total order on random inputs (antisymmetric, transitive, irreflexive)', () => {
    const r = lcg(11);
    const pool: Rankable[] = Array.from({ length: 60 }, (_, i) => mk(Math.floor(r() * 5), Math.floor(r() * 3), Math.floor(r() * 3), `id${String(i).padStart(3, '0')}`));
    for (const a of pool) {
      expect(compareWorklist(a, a)).toBe(0);
      for (const b of pool) {
        if (a !== b) {
          expect(Math.sign(compareWorklist(a, b))).toBe(-Math.sign(compareWorklist(b, a)));
          expect(compareWorklist(a, b)).not.toBe(0);
        }
        for (const c of pool.slice(0, 15)) {
          if (compareWorklist(a, b) < 0 && compareWorklist(b, c) < 0) expect(compareWorklist(a, c)).toBeLessThan(0);
        }
      }
    }
  });
});

describe('why / next action / waiting days', () => {
  it('builds the contract lines in order with singular/plural', () => {
    expect(buildWhy({ recoverableCents: 123456, pendingReviewCents: 5000, w: 25, status: 'PENDING_REVIEW', pendingFindingsCount: 2, waitingDays: 3 })).toEqual([
      'Confirmed recoverable $1,234.56 (counted at 100%)',
      'Pending human review $50.00 (counted at 25%)',
      '2 findings need human review before approval',
      'Waiting 3 days (not part of the score)',
    ]);
    expect(buildWhy({ recoverableCents: 0, pendingReviewCents: 0, w: 25, status: 'PENDING_REVIEW', pendingFindingsCount: 1, waitingDays: 1 })).toEqual([
      '1 finding needs human review before approval',
      'Waiting 1 day (not part of the score)',
    ]);
    expect(buildWhy({ recoverableCents: 1, pendingReviewCents: 0, w: 0, status: 'APPROVED', pendingFindingsCount: 4, waitingDays: 0 })).toEqual([
      'Confirmed recoverable $0.01 (counted at 100%)',
      'Approved and waiting to be marked send-ready',
      'Waiting 0 days (not part of the score)',
    ]);
  });
  it('next action', () => {
    expect(nextAction('PENDING_REVIEW', 1)).toBe('RESOLVE_FINDINGS');
    expect(nextAction('PENDING_REVIEW', 0)).toBe('REVIEW_AND_APPROVE');
    expect(nextAction('APPROVED', 3)).toBe('MARK_SEND_READY');
  });
  it('waiting days floor and never negative', () => {
    const now = new Date('2026-10-09T12:00:00Z');
    expect(waitingDays(now, new Date('2026-10-08T12:00:00.001Z'))).toBe(0);
    expect(waitingDays(now, new Date('2026-10-08T12:00:00.000Z'))).toBe(1);
    expect(waitingDays(now, new Date('2026-10-10T12:00:00Z'))).toBe(0);
  });
});

const feat = (carrierName: string, rules: string[], totalCents: number, perspective: string) => ({ carrierName, ruleIds: new Set(rules), totalCents, perspective });

describe('similar-v1 scoring', () => {
  it('normalizes carriers', () => {
    expect(normalizeCarrier('  Acme\t  Freight  LLC ')).toBe('acme freight llc');
    expect(normalizeCarrier('ÉLAN')).toBe('élan');
  });

  it('exact vectors (points, percent, details)', () => {
    const t = feat('Acme Freight', ['R1', 'R2', 'R3'], 100000, 'SHIPPER');
    const s = scoreSimilarity(t, feat(' acme  freight ', ['R2', 'R3', 'R4'], 60000, 'SHIPPER'));
    // rules: |{R2,R3}| / |{R1..R4}| = 2/4 -> floor(40*2/4) = 20; amount floor(15*60000/100000) = 9.
    expect(s.points).toEqual({ sameCarrier: 35, sharedRules: 20, similarAmount: 9, samePerspective: 10 });
    expect(s.percent).toBe(74);
    expect(s.matches.map((m) => m.detail)).toEqual(['Same carrier', 'Shared rules: R2, R3', 'Amounts $1,000.00 and $600.00', 'Same perspective (SHIPPER)']);
    // Identical features score exactly 100.
    expect(scoreSimilarity(t, feat('Acme Freight', ['R3', 'R2', 'R1'], 100000, 'SHIPPER')).percent).toBe(100);
    // No anchor: perspective + amount only -> excluded even at 25 points.
    const noAnchor = scoreSimilarity(t, feat('Other', ['X'], 100000, 'SHIPPER'));
    expect(noAnchor.percent).toBe(25);
    expect(isIncluded(noAnchor)).toBe(false);
    // Anchor but below 30 -> excluded.
    const weak = scoreSimilarity(feat('A', ['R1'], 0, 'SHIPPER'), feat('B', ['R1', 'R2', 'R3', 'R4', 'R5'], 100, 'CARRIER'));
    expect(weak.percent).toBe(8);
    expect(isIncluded(weak)).toBe(false);
    // Empty rule sets give 0 rule points; zero totals give 0 amount points.
    expect(scoreSimilarity(feat('A', [], 0, 'S'), feat('A', [], 0, 'S')).points).toEqual({ sameCarrier: 35, sharedRules: 0, similarAmount: 0, samePerspective: 10 });
    // Empty carrier never matches.
    expect(scoreSimilarity(feat('  ', [], 0, 'S'), feat('', [], 0, 'C')).points.sameCarrier).toBe(0);
  });

  it('properties on random inputs: symmetric rule/amount points, percent in 0..100, 100 only for identical features', () => {
    const r = lcg(23);
    const carriers = ['Acme', 'acme', 'Beta', ''];
    const rules = ['R1', 'R2', 'R3', 'R4', 'R5'];
    const pick = () => rules.filter(() => r() < 0.4);
    for (let i = 0; i < 3000; i += 1) {
      const a = feat(carriers[Math.floor(r() * 4)] ?? '', pick(), Math.floor(r() * 3) * Math.floor(r() * 100000), r() < 0.5 ? 'SHIPPER' : 'CARRIER');
      const b = feat(carriers[Math.floor(r() * 4)] ?? '', pick(), Math.floor(r() * 3) * Math.floor(r() * 100000), r() < 0.5 ? 'SHIPPER' : 'CARRIER');
      const ab = scoreSimilarity(a, b);
      const ba = scoreSimilarity(b, a);
      expect(ab.points.sharedRules).toBe(ba.points.sharedRules);
      expect(ab.points.similarAmount).toBe(ba.points.similarAmount);
      expect(ab.percent).toBeGreaterThanOrEqual(0);
      expect(ab.percent).toBeLessThanOrEqual(100);
      if (ab.percent === 100) {
        expect(normalizeCarrier(a.carrierName)).toBe(normalizeCarrier(b.carrierName));
        expect([...a.ruleIds].sort()).toEqual([...b.ruleIds].sort());
        expect(a.totalCents).toBe(b.totalCents);
        expect(a.perspective).toBe(b.perspective);
      }
      expect(ab.matches.every((m) => m.points > 0)).toBe(true);
    }
  });

  it('ranks by percent desc, updatedAt desc, id asc and applies the limit', () => {
    const t = feat('Acme', ['R1'], 1000, 'SHIPPER');
    const c = (id: string, carrier: string, rulesIn: string[], total: number, persp: string, t0: number): Candidate => ({ id, updatedAt: new Date(t0), ...feat(carrier, rulesIn, total, persp) });
    const ranked = rankSimilar(
      t,
      [
        c('c3', 'Acme', ['R1'], 1000, 'SHIPPER', 1),
        c('c2', 'Acme', ['R1'], 1000, 'SHIPPER', 1),
        c('c1', 'Acme', ['R1'], 1000, 'SHIPPER', 5),
        c('c4', 'Acme', [], 1000, 'CARRIER', 9),
        c('c5', 'Zed', [], 1000, 'SHIPPER', 9),
      ],
      3,
    );
    expect(ranked.map((x) => [x.candidate.id, x.scored.percent])).toEqual([
      ['c1', 100],
      ['c2', 100],
      ['c3', 100],
    ]);
    expect(rankSimilar(t, [c('c4', 'Acme', [], 1000, 'CARRIER', 9)], 5).map((x) => x.scored.percent)).toEqual([50]);
  });
});
