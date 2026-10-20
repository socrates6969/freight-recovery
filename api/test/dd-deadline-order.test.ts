/**
 * REQ-20261020-dd-deadline: the deadline-first-v1 ordering rule (pure core) and the dispute-window "why" line.
 * The SQL in db/intelligence.ts mirrors `compareDeadlineFirst`; the integration suite covers the SQL side.
 */
import { DD_DEADLINE_URGENT_DAYS, computeDdDisputeWindow, ddDisputeDaysLeft, ddDisputeWindowText } from '@fr/shared';
import { describe, expect, it } from 'vitest';

import { buildWhy, compareDeadlineFirst, compareWorklist, isDeadlineUrgent, type DeadlineRankable } from '../src/intelligence/priority.js';

const mk = (id: string, o: Partial<DeadlineRankable> = {}): DeadlineRankable => ({
  id,
  valueCents: 100,
  recoverableCents: 100,
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  kind: 'FREIGHT',
  deadlineDaysLeft: null,
  ...o,
});

function lcg(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

describe('isDeadlineUrgent (deadline-first-v1)', () => {
  it('is true only for OCEAN_DD with 0..14 days left', () => {
    expect(DD_DEADLINE_URGENT_DAYS).toBe(14);
    expect(isDeadlineUrgent({ kind: 'OCEAN_DD', deadlineDaysLeft: 0 })).toBe(true);
    expect(isDeadlineUrgent({ kind: 'OCEAN_DD', deadlineDaysLeft: 14 })).toBe(true);
    expect(isDeadlineUrgent({ kind: 'OCEAN_DD', deadlineDaysLeft: 15 })).toBe(false);
    expect(isDeadlineUrgent({ kind: 'OCEAN_DD', deadlineDaysLeft: -1 })).toBe(false);
    expect(isDeadlineUrgent({ kind: 'OCEAN_DD', deadlineDaysLeft: null })).toBe(false);
    expect(isDeadlineUrgent({ kind: 'FREIGHT', deadlineDaysLeft: 3 })).toBe(false);
  });
});

describe('compareDeadlineFirst', () => {
  it('urgent D&D claims come first, soonest first, regardless of value; the rest keep priority-v1 order', () => {
    const items = [
      mk('a', { valueCents: 900, recoverableCents: 900 }),
      mk('b', { kind: 'OCEAN_DD', deadlineDaysLeft: 10, valueCents: 1 }),
      mk('c', { kind: 'OCEAN_DD', deadlineDaysLeft: 2, valueCents: 1 }),
      mk('d', { kind: 'OCEAN_DD', deadlineDaysLeft: 40, valueCents: 500 }),
      mk('e', { kind: 'OCEAN_DD', deadlineDaysLeft: -3, valueCents: 5000 }),
      mk('f', { kind: 'OCEAN_DD', deadlineDaysLeft: null, valueCents: 50 }),
      mk('g', { kind: 'OCEAN_DD', deadlineDaysLeft: 0, valueCents: 1 }),
      mk('h', { valueCents: 2000, recoverableCents: 2000 }),
    ];
    expect([...items].sort(compareDeadlineFirst).map((i) => i.id)).toEqual(['g', 'c', 'b', 'e', 'h', 'a', 'd', 'f']);
  });
  it('a past floor date is not moved up (it ranks by priority-v1 like everyone else)', () => {
    const past = mk('p', { kind: 'OCEAN_DD', deadlineDaysLeft: -1, valueCents: 10 });
    const freight = mk('q', { valueCents: 20, recoverableCents: 20 });
    expect(compareDeadlineFirst(past, freight)).toBeGreaterThan(0);
    expect(compareDeadlineFirst(freight, past)).toBeLessThan(0);
  });
  it('urgent ties on days left fall through to priority-v1', () => {
    const x = mk('x', { kind: 'OCEAN_DD', deadlineDaysLeft: 5, valueCents: 10, recoverableCents: 10 });
    const y = mk('y', { kind: 'OCEAN_DD', deadlineDaysLeft: 5, valueCents: 20, recoverableCents: 20 });
    expect(compareDeadlineFirst(x, y)).toBe(compareWorklist(x, y));
    expect(compareDeadlineFirst(x, y)).toBeGreaterThan(0);
  });
  it('is a strict total order on random inputs', () => {
    const r = lcg(23);
    const pool: DeadlineRankable[] = Array.from({ length: 80 }, (_, i) =>
      mk(`id${String(i).padStart(3, '0')}`, {
        kind: r() < 0.5 ? 'OCEAN_DD' : 'FREIGHT',
        deadlineDaysLeft: r() < 0.2 ? null : Math.floor(r() * 40) - 5,
        valueCents: Math.floor(r() * 4),
        recoverableCents: Math.floor(r() * 3),
        updatedAt: new Date(Math.floor(r() * 3)),
      }),
    );
    for (const a of pool) {
      expect(compareDeadlineFirst(a, a)).toBe(0);
      for (const b of pool) {
        if (a !== b) {
          expect(Math.sign(compareDeadlineFirst(a, b))).toBe(-Math.sign(compareDeadlineFirst(b, a)));
          expect(compareDeadlineFirst(a, b)).not.toBe(0);
        }
        for (const c of pool.slice(0, 12)) {
          if (compareDeadlineFirst(a, b) < 0 && compareDeadlineFirst(b, c) < 0) expect(compareDeadlineFirst(a, c)).toBeLessThan(0);
        }
      }
    }
    // Every urgent item precedes every non-urgent item.
    const sorted = [...pool].sort(compareDeadlineFirst);
    const firstNonUrgent = sorted.findIndex((i) => !isDeadlineUrgent(i));
    expect(sorted.slice(firstNonUrgent).some(isDeadlineUrgent)).toBe(false);
  });
});

describe('buildWhy with the dispute-window line', () => {
  it('puts the window line first and keeps the rest of the contract order', () => {
    const w = computeDdDisputeWindow({ invoiceDate: '2026-10-01', statedDays: null }) ?? { closesOn: '' };
    expect(w.closesOn).toBe('2026-10-31');
    const text = ddDisputeWindowText(w, '2026-10-21');
    expect(ddDisputeDaysLeft(w.closesOn, '2026-10-21')).toBe(10);
    expect(buildWhy({ recoverableCents: 500, pendingReviewCents: 0, w: 25, status: 'PENDING_REVIEW', pendingFindingsCount: 0, waitingDays: 2, disputeWindowText: text })).toEqual([
      'Dispute window: 10 days left (closes 2026-10-31)',
      'Confirmed recoverable $5.00 (counted at 100%)',
      'Waiting 2 days (not part of the score)',
    ]);
  });
  it('is unchanged without a window (FREIGHT claims)', () => {
    expect(buildWhy({ recoverableCents: 500, pendingReviewCents: 0, w: 25, status: 'APPROVED', pendingFindingsCount: 0, waitingDays: 1, disputeWindowText: null })).toEqual([
      'Confirmed recoverable $5.00 (counted at 100%)',
      'Approved and waiting to be marked send-ready',
      'Waiting 1 day (not part of the score)',
    ]);
  });
});