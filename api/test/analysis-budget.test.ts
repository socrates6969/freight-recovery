/**
 * S5-1 (fix round 1): bulk analyze charges the per-user `analysis` budget once per candidate after the
 * first and stops when the budget is spent. Candidates here have non-UUID ids, so analyzeClaim refuses them
 * as 404 (-> skipped) without touching a database; only the loop/budget logic is exercised.
 */
import { describe, expect, it, vi } from 'vitest';

const appended: { action: string; metadata: unknown }[] = [];
vi.mock('../src/audit/audit.js', () => ({
  appendAudit: vi.fn(async (_tx: unknown, input: { action: string; metadata: unknown }) => {
    appended.push({ action: input.action, metadata: input.metadata });
    return { id: 'e', seq: 1, hash: 'h' };
  }),
}));

const { analyzeAwaiting } = await import('../src/claims/analysis.js');

const TENANT = '00000000-0000-4000-8000-000000000090';
const actor = { userId: '00000000-0000-4000-8000-000000000001', role: 'ANALYST' as const, ip: '127.0.0.1', requestId: 'r' };

function fakeDb(n: number, labelReads: { n: number } = { n: 0 }) {
  const tx = {
    chargeLabel: {
      findMany: vi.fn(async () => {
        labelReads.n += 1;
        return [];
      }),
    },
    claim: {
      findMany: vi.fn(async () => Array.from({ length: n }, (_, i) => ({ id: `not-a-uuid-${i}`, claimNumber: `CLM-${i}` }))),
      count: vi.fn(async () => 7),
    },
  };
  return { tenantId: TENANT, tx: async <T,>(fn: (t: never) => Promise<T>) => fn(tx as never) };
}

describe('analyzeAwaiting budget (S5-1)', () => {
  it('charges one token per candidate after the first and stops when the budget is spent', async () => {
    appended.length = 0;
    let tokens = 2;
    const charge = vi.fn(async () => (tokens-- > 0));
    const r = await analyzeAwaiting(fakeDb(10) as never, actor, 10, charge);
    // First candidate is covered by the request; two extra tokens; the third charge fails -> stop.
    expect(charge).toHaveBeenCalledTimes(3);
    expect(r.examined).toBe(3);
    expect(r.skipped.map((s) => s.claimNumber)).toEqual(['CLM-0', 'CLM-1', 'CLM-2']);
    expect([r.analyzed.length, r.failed.length, r.remaining, r.limit]).toEqual([0, 0, 7, 10]);
    expect(appended).toEqual([{ action: 'claim.bulk_analyzed', metadata: { limit: 10, examined: 3, analyzed: 0, skipped: 3, failed: 0, remaining: 7 } }]);
  });

  it('never charges for a single candidate and charges n-1 times when the budget suffices', async () => {
    const one = vi.fn(async () => true);
    expect((await analyzeAwaiting(fakeDb(1) as never, actor, 5, one)).examined).toBe(1);
    expect(one).not.toHaveBeenCalled();
    const many = vi.fn(async () => true);
    expect((await analyzeAwaiting(fakeDb(4) as never, actor, 5, many)).examined).toBe(4);
    expect(many).toHaveBeenCalledTimes(3);
  });

  it('fix round 1 (S1c): with the flag on, the tenant labels are read once per bulk request, not per claim', async () => {
    const reads = { n: 0 };
    expect((await analyzeAwaiting(fakeDb(5, reads) as never, actor, 5, async () => true, true)).examined).toBe(5);
    expect(reads.n).toBe(1);
    const off = { n: 0 };
    await analyzeAwaiting(fakeDb(5, off) as never, actor, 5, async () => true, false);
    expect(off.n).toBe(0);
    const none = { n: 0 };
    await analyzeAwaiting(fakeDb(0, none) as never, actor, 5, async () => true, true);
    expect(none.n).toBe(0);
  });
});
