import { describe, expect, it } from 'vitest';

import {
  CARRIER_RESPONSE_TEXT,
  ClaimOutcomeBody,
  ClaimOutcomeList,
  ClaimOutcomeView,
  InsightsRecovery,
  InsightsRecoveryQuery,
  OUTCOME_CHANNEL_TEXT,
  OUTCOME_KIND_TEXT,
  OUTCOME_TEXT,
  outcomeInstant,
} from './outcomes-dto.js';

const U = '00000000-0000-4000-8000-000000000001';
const ISO = '2026-10-12T10:00:00.000Z';
const issuePaths = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; code: string }[] } }) =>
  (r.error?.issues ?? []).map((i) => `${i.path.join('.')}:${i.code}`);

describe('outcome instants', () => {
  it('accepts Z instants of a plausible year and rejects offsets, dates and other years', () => {
    expect(outcomeInstant.safeParse('2026-10-12T10:00:00Z').success).toBe(true);
    expect(outcomeInstant.safeParse('2026-10-12T10:00:00.123Z').success).toBe(true);
    for (const v of ['2026-10-12', '2026-10-12T10:00:00+01:00', '1999-12-31T23:59:59Z', '2101-01-01T00:00:00Z', 'x']) {
      expect([v, outcomeInstant.safeParse(v).success]).toEqual([v, false]);
    }
  });
});

describe('ClaimOutcomeBody', () => {
  const base = { kind: 'OUTCOME', channel: 'EMAIL', carrierResponse: 'ACCEPTED' };
  it('OUTCOME: defaults, bounds, strictness and the closedAt >= sentAt rule', () => {
    const p = ClaimOutcomeBody.parse(base);
    expect(p).toEqual({ ...base, sentAt: null, creditedCents: null, paidCents: null, closedAt: null, note: '' });
    expect(ClaimOutcomeBody.parse({ ...base, creditedCents: 0, paidCents: 2_147_483_647, note: '  Credit note CN-1  ' }).note).toBe('Credit note CN-1');
    expect(ClaimOutcomeBody.safeParse({ ...base, creditedCents: -1 }).success).toBe(false);
    expect(ClaimOutcomeBody.safeParse({ ...base, creditedCents: 2_147_483_648 }).success).toBe(false);
    expect(ClaimOutcomeBody.safeParse({ ...base, creditedCents: 1.5 }).success).toBe(false);
    expect(ClaimOutcomeBody.safeParse({ ...base, channel: 'FAX' }).success).toBe(false);
    expect(ClaimOutcomeBody.safeParse({ ...base, carrierResponse: 'PAID' }).success).toBe(false);
    expect(ClaimOutcomeBody.safeParse({ ...base, note: 'a'.repeat(501) }).success).toBe(false);
    expect(ClaimOutcomeBody.safeParse({ ...base, note: 'bad\u202Etext' }).success).toBe(false);
    expect(ClaimOutcomeBody.safeParse({ ...base, tenantId: U }).success).toBe(false);
    expect(ClaimOutcomeBody.safeParse({ ...base, recordedById: U }).success).toBe(false);
    expect(issuePaths(ClaimOutcomeBody.safeParse({ ...base, sentAt: '2026-10-12T10:00:00Z', closedAt: '2026-10-11T10:00:00Z' }))).toEqual(['closedAt:custom']);
    expect(ClaimOutcomeBody.safeParse({ ...base, sentAt: '2026-10-12T10:00:00Z', closedAt: '2026-10-12T10:00:00Z' }).success).toBe(true);
  });
  it('AUDITED_NO_FINDING: only closedAt and note; no channel, response or amounts', () => {
    expect(ClaimOutcomeBody.parse({ kind: 'AUDITED_NO_FINDING' })).toEqual({ kind: 'AUDITED_NO_FINDING', closedAt: null, note: '' });
    expect(ClaimOutcomeBody.safeParse({ kind: 'AUDITED_NO_FINDING', channel: 'EMAIL' }).success).toBe(false);
    expect(ClaimOutcomeBody.safeParse({ kind: 'AUDITED_NO_FINDING', creditedCents: 1 }).success).toBe(false);
    expect(ClaimOutcomeBody.safeParse({ kind: 'SOMETHING' }).success).toBe(false);
    expect(ClaimOutcomeBody.safeParse({}).success).toBe(false);
  });
});

describe('outcome views', () => {
  const view = () => ({
    id: U,
    claimId: U,
    kind: 'OUTCOME',
    channel: 'PORTAL',
    carrierResponse: 'PARTIAL',
    sentAt: ISO,
    creditedCents: 12300,
    paidCents: null,
    closedAt: null,
    note: '',
    version: 1,
    recordedAt: ISO,
    recordedBy: { id: U, name: 'Riley Reviewer' },
  });
  it('view and list are strict', () => {
    expect(ClaimOutcomeView.safeParse(view()).success).toBe(true);
    expect(ClaimOutcomeView.safeParse({ ...view(), email: 'x' }).success).toBe(false);
    expect(ClaimOutcomeList.safeParse({ claimId: U, items: [view()] }).success).toBe(true);
    expect(ClaimOutcomeList.safeParse({ claimId: U, items: [view()], total: 1 }).success).toBe(false);
  });
});

describe('insights recovery contract', () => {
  it('query: same period rules as throughput; unknown keys refused', () => {
    expect(InsightsRecoveryQuery.safeParse({ from: '2026-06-01', to: '2026-06-16' }).success).toBe(true);
    expect(InsightsRecoveryQuery.safeParse({ from: '2026-06-16', to: '2026-06-01' }).success).toBe(false);
    expect(InsightsRecoveryQuery.safeParse({ from: '2026-06-01', to: '2026-06-16', tenantId: U }).success).toBe(false);
  });
  it('response: strict, basis literal, rate nullable', () => {
    const z0 = { claimCount: 0, identifiedCents: 0 };
    const body = {
      meta: { asOf: ISO, period: { from: ISO, to: ISO }, filters: { kind: null, perspective: null } },
      basis: 'human_entered',
      sent: z0,
      responses: { noneYet: z0, accepted: z0, partial: z0, rejected: z0, disputed: z0, withdrawn: z0 },
      credited: { claimCount: 0, cents: 0 },
      paid: { claimCount: 0, cents: 0 },
      recoveryRate: { claimCount: 0, creditedCents: 0, identifiedCents: 0, rateBasisPoints: null },
      reviewerHours: { claimCount: 0, hours: 0, capHoursPerClaim: 8, creditedPerHourCents: null, approximation: OUTCOME_TEXT.reviewerHoursNote },
      byRule: [],
      auditedNoFinding: { claimCount: 0 },
    };
    expect(InsightsRecovery.safeParse(body).success).toBe(true);
    expect(InsightsRecovery.safeParse({ ...body, basis: 'reconciled' }).success).toBe(false);
    expect(InsightsRecovery.safeParse({ ...body, reviewerHours: { ...body.reviewerHours, capHoursPerClaim: 7 } }).success).toBe(false);
    expect(InsightsRecovery.safeParse({ ...body, extra: 1 }).success).toBe(false);
    expect(/recovered|saved|won/iu.test(JSON.stringify(Object.keys(InsightsRecovery.shape)))).toBe(false);
  });
});

describe('outcome copy', () => {
  const HONEST = /accura|guarantee|AI-powered|verified result|\bsaves\b|\brecovered\b/iu;
  it('states the human-entered basis and never claims accuracy or recovery', () => {
    const strings = [...Object.values(OUTCOME_TEXT), ...Object.values(OUTCOME_CHANNEL_TEXT), ...Object.values(CARRIER_RESPONSE_TEXT), ...Object.values(OUTCOME_KIND_TEXT)];
    expect(strings.length).toBeGreaterThanOrEqual(25);
    for (const s of strings) expect(s, s).not.toMatch(HONEST);
    expect(OUTCOME_TEXT.reviewerHoursNote).toContain('approximated from approval timestamps');
    expect(OUTCOME_TEXT.reviewerHoursNote).toContain('capped at 8 hours');
    expect(Object.isFrozen(OUTCOME_TEXT)).toBe(true);
  });
});