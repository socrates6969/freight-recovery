import { describe, expect, it } from 'vitest';

import { INSIGHTS_NOT_TRACKED, INSIGHTS_OUTCOME_DISCLAIMER, INSIGHTS_TEXT } from './honest-copy.js';
import {
  INSIGHTS_LIMIT_DEFAULT,
  InsightsDeadlinesQuery,
  InsightsLeakage,
  InsightsLeakageQuery,
  InsightsStagesQuery,
  InsightsSummary,
  InsightsSummaryQuery,
  parseInsightsInstant,
} from './insights-dto.js';

const issuePaths = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; code: string }[] } }) =>
  (r.error?.issues ?? []).map((i) => `${i.path.join('.')}:${i.code}`);

describe('insights instant parser', () => {
  it('accepts date-only and Z instants and maps date-only to midnight UTC', () => {
    expect(parseInsightsInstant('2026-06-15')?.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(parseInsightsInstant('2026-06-15T12:34:56Z')?.toISOString()).toBe('2026-06-15T12:34:56.000Z');
    expect(parseInsightsInstant('2026-06-15T12:34:56.7Z')?.toISOString()).toBe('2026-06-15T12:34:56.700Z');
    expect(parseInsightsInstant('2024-02-29')?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(parseInsightsInstant('0050-01-01')?.toISOString()).toBe('0050-01-01T00:00:00.000Z');
  });

  it('rejects impossible dates, times, offsets and long values', () => {
    for (const v of ['2026-02-29', '2026-13-01', '2026-04-31', '2026-06-15T24:00:00Z', '2026-06-15T12:60:00Z', '2026-06-15T12:00:60Z', '2026-06-15T12:00:00+01:00', '2026-06-15T12:00:00', '2026-06-15T12:00:00.1234Z', '15/06/2026', ' 2026-06-15', '2026-06-15\n']) {
      expect([v, parseInsightsInstant(v)]).toEqual([v, null]);
    }
  });
});

describe('insights query schemas', () => {
  it('summary: period refinement on `to` (strictly increasing, at most 366 days)', () => {
    expect(InsightsSummaryQuery.safeParse({ from: '2026-01-01', to: '2027-01-02' }).success).toBe(true);
    expect(issuePaths(InsightsSummaryQuery.safeParse({ from: '2026-01-01', to: '2027-01-03' }))).toEqual(['to:custom']);
    expect(issuePaths(InsightsSummaryQuery.safeParse({ from: '2026-01-02', to: '2026-01-02' }))).toEqual(['to:custom']);
    expect(issuePaths(InsightsSummaryQuery.safeParse({ from: '2026-02-30', to: '2026-03-02' }))).toEqual(['from:custom']);
  });

  it('refuses unknown keys such as tenantId or role', () => {
    const r = InsightsSummaryQuery.safeParse({ from: '2026-01-01', to: '2026-02-01', tenantId: 'x' });
    expect(issuePaths(r)).toEqual([':unrecognized_keys']);
    expect(InsightsDeadlinesQuery.safeParse({ role: 'OWNER' }).success).toBe(false);
  });

  it('stages: from and to go together', () => {
    expect(InsightsStagesQuery.safeParse({}).success).toBe(true);
    expect(issuePaths(InsightsStagesQuery.safeParse({ from: '2026-01-01' }))).toEqual(['to:custom']);
    expect(issuePaths(InsightsStagesQuery.safeParse({ to: '2026-01-01' }))).toEqual(['from:custom']);
    expect(issuePaths(InsightsStagesQuery.safeParse({ from: '2026-02-01', to: '2026-01-01' }))).toEqual(['to:custom']);
  });

  it('leakage: by required, carrier only with by=rule, limit 1..50 default 10, carrier bounded and safe', () => {
    const base = { from: '2026-01-01', to: '2026-02-01' };
    expect(InsightsLeakageQuery.safeParse(base).success).toBe(false);
    expect(InsightsLeakageQuery.parse({ ...base, by: 'carrier' }).limit).toBe(INSIGHTS_LIMIT_DEFAULT);
    expect(InsightsLeakageQuery.parse({ ...base, by: 'carrier', limit: '50' }).limit).toBe(50);
    expect(InsightsLeakageQuery.safeParse({ ...base, by: 'carrier', limit: '51' }).success).toBe(false);
    expect(InsightsLeakageQuery.safeParse({ ...base, by: 'carrier', limit: '0' }).success).toBe(false);
    expect(issuePaths(InsightsLeakageQuery.safeParse({ ...base, by: 'carrier', carrier: 'Acme' }))).toEqual(['carrier:custom']);
    expect(InsightsLeakageQuery.parse({ ...base, by: 'rule', carrier: '  Acme  ' }).carrier).toBe('Acme');
    expect(InsightsLeakageQuery.safeParse({ ...base, by: 'rule', carrier: 'a'.repeat(201) }).success).toBe(false);
    expect(InsightsLeakageQuery.safeParse({ ...base, by: 'rule', carrier: 'Acme\u202Eevil' }).success).toBe(false);
  });
});

describe('insights response schemas', () => {
  const meta = { asOf: '2026-06-15T12:00:00.000Z', period: null, filters: { kind: null, perspective: null } };
  it('leakage is a discriminated union on `by`', () => {
    expect(InsightsLeakage.safeParse({ meta, by: 'rule', carrier: null, rows: [] }).success).toBe(true);
    expect(InsightsLeakage.safeParse({ meta, by: 'rule', carrier: null, rows: [], extra: 1 }).success).toBe(false);
  });
  it('summary keys contain no outcome words', () => {
    const keys = JSON.stringify(Object.keys(InsightsSummary.shape)) + JSON.stringify(Object.keys(InsightsSummary.shape.money.shape));
    expect(/recovered|saved|won/iu.test(keys)).toBe(false);
  });
});

describe('insights copy', () => {
  const texts = [...Object.values(INSIGHTS_TEXT), ...INSIGHTS_NOT_TRACKED.flatMap((g) => [g.title, g.reason])];
  it('outcome words appear only in the disclaimer; "deadline" nowhere', () => {
    expect(/\b(recovered|saved|won)\b/iu.test(INSIGHTS_OUTCOME_DISCLAIMER)).toBe(true);
    for (const t of texts) expect([t, /\b(recovered|saved|won)\b/iu.test(t), /deadline/iu.test(t)]).toEqual([t, false, false]);
    expect(/deadline/iu.test(INSIGHTS_OUTCOME_DISCLAIMER)).toBe(false);
  });
  it('lists the ten gaps G1-G10 in order and is frozen', () => {
    expect(INSIGHTS_NOT_TRACKED.map((g) => g.id)).toEqual(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10']);
    expect(Object.isFrozen(INSIGHTS_NOT_TRACKED)).toBe(true);
    expect(Object.isFrozen(INSIGHTS_TEXT)).toBe(true);
  });
});
