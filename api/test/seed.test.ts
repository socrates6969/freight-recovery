import { describe, expect, it } from 'vitest';

import { buildClaimSet } from '../scripts/seed.js';

describe('seed claim set (C7)', () => {
  const { acme, globex } = buildClaimSet();

  it('has 26 Acme claims with the contracted status distribution', () => {
    expect(acme).toHaveLength(26);
    const count = (s: string) => acme.filter((c) => c.status === s).length;
    expect([count('PENDING_REVIEW'), count('APPROVED'), count('REJECTED'), count('SEND_READY')]).toEqual([16, 4, 3, 3]);
    const byNumber = new Map(acme.map((c) => [c.claimNumber, c]));
    expect(byNumber.get('CLM-0001')?.loadNumber).toBe('LD-5001');
    expect(byNumber.get('CLM-0002')?.loadNumber).toBe('LD-5002');
    for (const n of [15, 16, 17, 18]) expect(byNumber.get(`CLM-00${n}`)?.status).toBe('APPROVED');
    for (const n of [19, 20, 21]) expect(byNumber.get(`CLM-00${n}`)?.status).toBe('REJECTED');
    for (const n of [22, 23, 24]) expect(byNumber.get(`CLM-00${n}`)?.status).toBe('SEND_READY');
    expect(byNumber.get('CLM-HOSTILE-1')?.status).toBe('PENDING_REVIEW');
    expect(byNumber.get('CLM-HOSTILE-2')?.status).toBe('PENDING_REVIEW');
    expect(new Set(acme.map((c) => c.claimNumber)).size).toBe(26);
  });

  it('only CLM-0013 and CLM-0014 carry pending-review findings among CLM-0003..CLM-0014', () => {
    const pending = acme
      .filter((c) => /^CLM-00(0[3-9]|1[0-4])$/u.test(c.claimNumber))
      .filter((c) => c.findings.some((f) => f.needsHumanReview))
      .map((c) => c.claimNumber);
    expect(pending).toEqual(['CLM-0013', 'CLM-0014']);
  });

  it('transcribes LD-5001 from the Python pipeline (amounts in cents)', () => {
    const c = acme.find((x) => x.claimNumber === 'CLM-0001');
    expect(c?.recoverableCents).toBe(32500);
    expect(c?.pendingReviewCents).toBe(15000);
    expect(c?.findings.map((f) => [f.ruleId, f.amountCents, f.needsHumanReview])).toEqual([
      ['INV-LINEHAUL-RATE', 10000, false],
      ['INV-ACCESSORIAL-UNAUTH', 15000, true],
      ['DET-OVERBILLED', 22500, false],
    ]);
    expect(c?.verifierStatus).toBe('PASSED');
    expect(acme.find((x) => x.claimNumber === 'CLM-0002')?.verifierStatus).toBe('NEEDS_REVIEW');
    expect(acme.filter((x) => !['CLM-0001', 'CLM-0002'].includes(x.claimNumber)).every((x) => x.verifierStatus === 'NOT_RUN')).toBe(true);
  });

  it('keeps totals consistent with findings', () => {
    for (const c of [...acme, ...globex]) {
      const rec = c.findings.filter((f) => !f.needsHumanReview).reduce((s, f) => s + f.amountCents, 0);
      const pen = c.findings.filter((f) => f.needsHumanReview).reduce((s, f) => s + f.amountCents, 0);
      expect([c.claimNumber, c.recoverableCents, c.pendingReviewCents, c.amountClaimedCents]).toEqual([c.claimNumber, rec, pen, rec + pen]);
    }
  });

  it('has 6 Globex claims and is deterministic', () => {
    expect(globex.map((c) => c.claimNumber)).toEqual(['GLX-0001', 'GLX-0002', 'GLX-0003', 'GLX-0004', 'GLX-0005', 'GLX-0006']);
    expect(JSON.stringify(buildClaimSet())).toBe(JSON.stringify({ acme, globex }));
  });

  it('hostile claims carry attacker-style strings', () => {
    const h = JSON.stringify(acme.filter((c) => c.claimNumber.startsWith('CLM-HOSTILE')));
    for (const needle of ['<script>', 'onerror=', 'javascript:', '\u202E', '\u2066']) expect(h).toContain(needle);
    expect(h).toContain('A'.repeat(4995));
  });
});
