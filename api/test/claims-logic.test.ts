import { describe, expect, it } from 'vitest';

import { packetContentHash, packetTotals, type HashPacket } from '../src/claims/content-hash.js';
import { buildClaimOrderBy, buildClaimWhere, escapeLike, pageArgs } from '../src/claims/query.js';
import { canTransition, targetStatus } from '../src/claims/state-machine.js';

describe('claims query builder', () => {
  it('escapes LIKE metacharacters so q is a literal substring', () => {
    expect(escapeLike('50%')).toBe('50\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('back\\slash')).toBe('back\\\\slash');
    expect(escapeLike(`quote'"`)).toBe(`quote'"`);
    expect(escapeLike('%_\\')).toBe('\\%\\_\\\\');
  });

  it('builds an OR of case-insensitive contains over five fields with the escaped q', () => {
    for (const q of ['50%', 'a_b', 'back\\slash', `quote'"`]) {
      const e = escapeLike(q);
      expect(buildClaimWhere({ q })).toEqual({
        AND: [
          {
            OR: [
              { claimNumber: { contains: e, mode: 'insensitive' } },
              { loadNumber: { contains: e, mode: 'insensitive' } },
              { invoiceNumber: { contains: e, mode: 'insensitive' } },
              { carrierName: { contains: e, mode: 'insensitive' } },
              { shipperName: { contains: e, mode: 'insensitive' } },
            ],
          },
        ],
      });
    }
  });

  it('combines status, perspective and assignee filters', () => {
    expect(buildClaimWhere({})).toEqual({});
    expect(buildClaimWhere({ q: '   ' })).toEqual({});
    expect(buildClaimWhere({ status: ['APPROVED'], perspective: 'SHIPPER', assigneeId: 'none' })).toEqual({
      AND: [{ status: { in: ['APPROVED'] } }, { perspective: 'SHIPPER' }, { assigneeId: null }],
    });
    expect(buildClaimWhere({ assigneeId: '11111111-1111-4111-8111-111111111111' })).toEqual({
      AND: [{ assigneeId: '11111111-1111-4111-8111-111111111111' }],
    });
  });

  it('orders by the whitelisted field with an id tiebreak, and pages', () => {
    expect(buildClaimOrderBy({ field: 'recoverableCents', dir: 'desc' })).toEqual([{ recoverableCents: 'desc' }, { id: 'desc' }]);
    expect(pageArgs(3, 25)).toEqual({ skip: 50, take: 25 });
  });
});

const sample = (): HashPacket => ({
  perspective: 'SHIPPER',
  loadNumber: 'LD-5001',
  currency: 'USD',
  recoverableCents: 32500,
  pendingReviewCents: 15000,
  demandLetter: 'Dear carrier',
  sources: [
    { id: 's-b', ordinal: 2, filename: 'invoice.txt', docType: 'INVOICE', sha256: 'b'.repeat(64), sizeBytes: 280 },
    { id: 's-a', ordinal: 1, filename: 'bol.txt', docType: 'BILL_OF_LADING', sha256: 'a'.repeat(64), sizeBytes: 176 },
  ],
  timeline: [{ ordinal: 1, occurredAt: new Date('2025-03-03T08:00:00Z'), kind: 'APPOINTMENT', label: 'Appointment', sourceId: 's-a' }],
  findings: [
    {
      ordinal: 1,
      ruleId: 'INV-LINEHAUL-RATE',
      title: 'Linehaul billed above rate confirmation',
      direction: 'OVERCHARGE',
      amountCents: 10000,
      explanation: 'x',
      calculation: ['$1500.00 - $1400.00 = $100.00.'],
      confidence: 0.95,
      needsHumanReview: false,
      citations: [{ sourceId: 's-b', locator: 'invoice.txt:L7', excerpt: 'Charge: Linehaul | 1500.00' }],
      clauseSourceId: 's-a',
      clauseLabel: 'L',
      clauseExcerpt: 'E',
      clauseLocator: 'bol.txt:L1',
    },
  ],
});

describe('packet content hash', () => {
  it('is independent of row ids (copies hash identically) and of input order', () => {
    const a = sample();
    const b = sample();
    b.sources = b.sources.map((s) => ({ ...s, id: `new-${s.id}` })).reverse();
    b.timeline = b.timeline.map((t) => ({ ...t, sourceId: `new-${t.sourceId ?? ''}` }));
    b.findings = b.findings.map((f) => ({
      ...f,
      clauseSourceId: `new-${f.clauseSourceId ?? ''}`,
      citations: f.citations.map((c) => ({ ...c, sourceId: `new-${c.sourceId}` })),
    }));
    expect(packetContentHash(a)).toBe(packetContentHash(b));
    expect(packetContentHash(a)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('changes when content changes', () => {
    const a = sample();
    expect(packetContentHash({ ...a, demandLetter: 'Dear carrier.' })).not.toBe(packetContentHash(a));
    const f = sample();
    const firstFinding = f.findings[0];
    if (!firstFinding) throw new Error('no finding');
    firstFinding.amountCents = 10001;
    expect(packetContentHash(f)).not.toBe(packetContentHash(a));
  });

  it('rejects references to sources outside the packet', () => {
    const a = sample();
    const firstFinding = a.findings[0];
    if (!firstFinding) throw new Error('no finding');
    firstFinding.clauseSourceId = 'foreign';
    expect(() => packetContentHash(a)).toThrow();
  });

  it('separates confirmed and pending totals', () => {
    expect(
      packetTotals([
        { amountCents: 10000, needsHumanReview: false },
        { amountCents: 15000, needsHumanReview: true },
        { amountCents: 22500, needsHumanReview: false },
      ]),
    ).toEqual({ recoverableCents: 32500, pendingReviewCents: 15000, amountClaimedCents: 47500 });
  });
});

describe('review state machine', () => {
  it('allows exactly the specified transitions', () => {
    const all = ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SEND_READY'] as const;
    const allowed = (t: 'approve' | 'reject' | 'send' | 'edit') => all.filter((s) => canTransition(t, s));
    expect(allowed('approve')).toEqual(['PENDING_REVIEW']);
    expect(allowed('reject')).toEqual(['PENDING_REVIEW']);
    expect(allowed('send')).toEqual(['APPROVED']);
    expect(allowed('edit')).toEqual(['PENDING_REVIEW', 'APPROVED', 'REJECTED']);
    expect(targetStatus('approve')).toBe('APPROVED');
    expect(targetStatus('reject')).toBe('REJECTED');
    expect(targetStatus('send')).toBe('SEND_READY');
  });
});
