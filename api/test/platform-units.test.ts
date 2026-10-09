/**
 * Step 4 platform units: pipeline assembly (zero-fill, ordering, rates), flag reason rule, FlagService
 * cache semantics and fail-closed reads (fake database client; no network).
 */
import { PipelineHealth } from '@fr/shared';
import { describe, expect, it } from 'vitest';

import type { BaseClient } from '../src/db/client.js';
import { FlagService, validFlagReason } from '../src/platform/flags.js';
import { assemblePipelineHealth, rate } from '../src/platform/pipeline.js';

const NOW = new Date('2026-10-09T12:00:00.000Z');

describe('assemblePipelineHealth', () => {
  it('zero-fills every bucket when nothing happened', () => {
    const p = assemblePipelineHealth(
      [
        { metric: 'upload_to_parse', label: 'all', n: 0, p50Ms: null, p95Ms: null },
        { metric: 'review_queue', label: 'needs_review', n: 0, p50Ms: null, p95Ms: null },
      ],
      '24h',
      NOW,
      '0.1.0',
    );
    expect(p.documents).toEqual({
      total: 0,
      byStatus: { RECEIVED: 0, NEEDS_REVIEW: 0, ACCEPTED: 0, REJECTED: 0, FAILED: 0 },
      byDetectedType: { PDF: 0, PNG: 0, JPEG: 0, CSV: 0, TXT: 0 },
      rejectedByReason: [],
    });
    expect(p.rates).toEqual({ rejected: null, failed: null, needsReview: null });
    expect(p.uploadToParseMs).toEqual({ n: 0, p50: null, p95: null });
    expect(p.reviewQueue).toEqual({ depth: 0, oldestWaitingSeconds: null });
    expect(PipelineHealth.safeParse(p).success).toBe(true);
  });

  it('orders reasons by count desc then reason asc, maps odd labels to "unknown", computes rates', () => {
    const p = assemblePipelineHealth(
      [
        { metric: 'status', label: 'REJECTED', n: 4, p50Ms: null, p95Ms: null },
        { metric: 'status', label: 'ACCEPTED', n: 2, p50Ms: null, p95Ms: null },
        { metric: 'status', label: 'FAILED', n: 1, p50Ms: null, p95Ms: null },
        { metric: 'detected_type', label: 'TXT', n: 7, p50Ms: null, p95Ms: null },
        { metric: 'reject_reason', label: 'zeta_reason', n: 1, p50Ms: null, p95Ms: null },
        { metric: 'reject_reason', label: 'alpha_reason', n: 1, p50Ms: null, p95Ms: null },
        { metric: 'reject_reason', label: 'Bad Label!', n: 2, p50Ms: null, p95Ms: null },
        { metric: 'review_queue', label: 'needs_review', n: 3, p50Ms: 125_999, p95Ms: null },
        { metric: 'upload_to_parse', label: 'all', n: 2, p50Ms: 1500.25, p95Ms: 2900.125 },
        { metric: 'stale_received', label: 'received', n: 5, p50Ms: null, p95Ms: null },
        { metric: 'awaiting_analysis', label: 'claims', n: 6, p50Ms: null, p95Ms: null },
      ],
      '1h',
      NOW,
      '0.1.0',
    );
    expect(p.documents.rejectedByReason).toEqual([
      { reason: 'unknown', count: 2 },
      { reason: 'alpha_reason', count: 1 },
      { reason: 'zeta_reason', count: 1 },
    ]);
    expect(p.documents.total).toBe(7);
    expect(p.rates).toEqual({ rejected: 0.5714, failed: 0.1429, needsReview: 0 });
    expect(p.reviewQueue).toEqual({ depth: 3, oldestWaitingSeconds: 125 });
    expect(p.uploadToParseMs).toEqual({ n: 2, p50: 1500.25, p95: 2900.125 });
    expect(p.staleReceived).toBe(5);
    expect(p.claims.awaitingAnalysis).toBe(6);
  });

  it('rate rounds half-up to 4 decimals', () => {
    expect(rate(1, 3)).toBe(0.3333);
    expect(rate(2, 3)).toBe(0.6667);
    expect(rate(0, 0)).toBeNull();
    expect(rate(1, 8)).toBe(0.125);
  });
});

describe('flag reason rule', () => {
  it('accepts plain single-line text and rejects anything the sanitizer would change', () => {
    expect(validFlagReason('  Turn off during incident 42  ')).toBe('Turn off during incident 42');
    for (const bad of ['use <b>bold</b> here', 'two  spaces inside', 'back`tick reason']) expect(() => validFlagReason(bad)).toThrow();
  });
});

type FakeRow = { enabled: boolean } | null;

function fakeBase(read: () => FakeRow): { base: BaseClient; calls: () => number } {
  let n = 0;
  const tx = {
    $executeRaw: async () => 0,
    featureFlag: {
      findUnique: async () => {
        n += 1;
        return read();
      },
    },
  };
  const base = { $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as BaseClient;
  return { base, calls: () => n };
}

describe('FlagService', () => {
  it('caches values for the TTL and re-reads afterwards', async () => {
    let t = 1000;
    let value = true;
    const f = fakeBase(() => ({ enabled: value }));
    const s = new FlagService(f.base, 5000, () => t);
    expect(await s.isEnabled('intelligence.worklist')).toBe(true);
    value = false;
    t += 4999;
    expect(await s.isEnabled('intelligence.worklist')).toBe(true);
    t += 2;
    expect(await s.isEnabled('intelligence.worklist')).toBe(false);
    expect(f.calls()).toBe(2);
    s.invalidate('intelligence.worklist');
    value = true;
    expect(await s.isEnabled('intelligence.worklist')).toBe(true);
  });

  it('TTL 0 reads every time', async () => {
    const f = fakeBase(() => ({ enabled: true }));
    const s = new FlagService(f.base, 0, () => 0);
    await s.isEnabled('intelligence.provenance');
    await s.isEnabled('intelligence.provenance');
    expect(f.calls()).toBe(2);
  });

  it('fails closed: unknown keys, missing rows and read errors are OFF; failures cached for at most 1 s', async () => {
    let t = 0;
    let fail = true;
    const f = fakeBase(() => {
      if (fail) throw new Error('db down');
      return { enabled: true };
    });
    const s = new FlagService(f.base, 30_000, () => t);
    expect(await s.isEnabled('intelligence.similar_claims')).toBe(false);
    fail = false;
    t += 999;
    expect(await s.isEnabled('intelligence.similar_claims')).toBe(false);
    t += 2;
    expect(await s.isEnabled('intelligence.similar_claims')).toBe(true);
    expect(await s.isEnabled('not.a.flag' as 'intelligence.worklist')).toBe(false);
    const missing = new FlagService(fakeBase(() => null).base, 0);
    expect(await missing.isEnabled('intelligence.worklist')).toBe(false);
  });
});
