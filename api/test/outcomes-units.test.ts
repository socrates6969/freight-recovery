/**
 * REQ-20261020-claim-outcomes: unit coverage without a database. The state rule and view mapping of the
 * outcome service, the trigger error matcher, the audit metadata allow-list, the Recovery assembly (parsed
 * with the strict shared schema) and the shape of the Recovery SQL (tenant predicate, bound period, latest
 * row per claim, nothing interpolated from input).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { InsightsRecovery, OUTCOME_TEXT } from '@fr/shared';
import { describe, expect, it } from 'vitest';

import { sanitizeMetadata } from '../src/audit/chain.js';
import { outcomeAllowed, toOutcomeView } from '../src/claims/outcomes.js';
import { isOutcomeDbError } from '../src/http/db-guard.js';
import { creditedPerHour, recoveryBody } from '../src/insights/service.js';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const NOF = { kind: null, perspective: null } as const;
const period = { from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-06-16T00:00:00Z') };
const U = '00000000-0000-4000-8000-000000000001';

describe('outcome service (pure parts)', () => {
  it('state rule: OUTCOME needs SEND_READY; AUDITED_NO_FINDING any analysed claim', () => {
    expect(outcomeAllowed('OUTCOME', 'SEND_READY')).toBe(true);
    for (const s of ['AWAITING_ANALYSIS', 'PENDING_REVIEW', 'APPROVED', 'REJECTED']) expect([s, outcomeAllowed('OUTCOME', s)]).toEqual([s, false]);
    for (const s of ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SEND_READY']) expect([s, outcomeAllowed('AUDITED_NO_FINDING', s)]).toEqual([s, true]);
    expect(outcomeAllowed('AUDITED_NO_FINDING', 'AWAITING_ANALYSIS')).toBe(false);
  });

  it('view: ISO instants, nulls kept, no fields beyond the contract', () => {
    const v = toOutcomeView({
      id: U,
      claimId: U,
      kind: 'OUTCOME',
      channel: 'EMAIL',
      carrierResponse: 'PARTIAL',
      sentAt: NOW,
      creditedCents: 100,
      paidCents: null,
      closedAt: null,
      note: 'n',
      version: 1,
      recordedAt: NOW,
      recordedBy: { id: U, name: 'Riley' },
    });
    expect(v).toEqual({
      id: U,
      claimId: U,
      kind: 'OUTCOME',
      channel: 'EMAIL',
      carrierResponse: 'PARTIAL',
      sentAt: NOW.toISOString(),
      creditedCents: 100,
      paidCents: null,
      closedAt: null,
      note: 'n',
      version: 1,
      recordedAt: NOW.toISOString(),
      recordedBy: { id: U, name: 'Riley' },
    });
  });

  it('trigger matcher: exact P0001 messages only', () => {
    expect(isOutcomeDbError({ code: 'P0001', message: 'claim_outcome_state_invalid' })).toBe(true);
    expect(isOutcomeDbError({ meta: { driverAdapterError: { cause: { originalCode: 'P0001', originalMessage: 'claim_outcome_claim_invalid' } } } })).toBe(true);
    expect(isOutcomeDbError({ code: 'P0001', message: 'claim_outcome_state_invalid extra' })).toBe(false);
    expect(isOutcomeDbError({ code: '23514', message: 'claim_outcome_state_invalid' })).toBe(false);
  });

  it('audit metadata: the outcome keys pass, the note never does', () => {
    const out = sanitizeMetadata({ claimId: U, outcomeId: U, kind: 'OUTCOME', channel: 'EMAIL', carrierResponse: 'ACCEPTED', creditedCents: 5, paidCents: null, sentAt: NOW.toISOString(), closedAt: null, note: 'secret' });
    expect(Object.keys(out).sort()).toEqual(['carrierResponse', 'channel', 'claimId', 'closedAt', 'creditedCents', 'kind', 'outcomeId', 'paidCents', 'sentAt']);
    expect('note' in out).toBe(false);
  });
});

describe('recovery assembly', () => {
  it('creditedPerHour floors cents per hour and is null without a span', () => {
    expect(creditedPerHour(40000, 39_600_000)).toBe(3636);
    expect(creditedPerHour(0, 3_600_000)).toBe(0);
    expect(creditedPerHour(100, 0)).toBeNull();
    expect(creditedPerHour(-1, 1)).toBeNull();
  });

  it('body: responses filled with zeros, totals summed, rate floored, mixed row titled, strict-schema valid', () => {
    const body = recoveryBody(
      NOW,
      period,
      NOF,
      [
        { response: 'ACCEPTED', claimCount: 1, identifiedCents: 50000, creditedCents: 40000, creditedClaimCount: 1, paidCents: 40000, paidClaimCount: 1 },
        { response: 'REJECTED', claimCount: 1, identifiedCents: 1000, creditedCents: 0, creditedClaimCount: 0, paidCents: 0, paidClaimCount: 0 },
        { response: 'UNKNOWN', claimCount: 9, identifiedCents: 9, creditedCents: 9, creditedClaimCount: 9, paidCents: 9, paidClaimCount: 9 },
      ],
      [
        { ruleId: 'R_X', title: 'Detention', mixed: false, claimCount: 1, findingsSent: 2, findingsAccepted: 2, findingsPartial: 0, findingsRejected: 0, identifiedCents: 50000, creditedCents: 40000 },
        { ruleId: '', title: 'x', mixed: true, claimCount: 1, findingsSent: 3, findingsAccepted: 0, findingsPartial: 0, findingsRejected: 3, identifiedCents: 1000, creditedCents: 0 },
      ],
      { claimCount: 2, totalMs: 39_600_000 },
      1,
    );
    expect(InsightsRecovery.parse(body)).toEqual(body);
    expect(body.basis).toBe('human_entered');
    expect(body.sent).toEqual({ claimCount: 2, identifiedCents: 51000 });
    expect(body.responses).toEqual({
      noneYet: { claimCount: 0, identifiedCents: 0 },
      accepted: { claimCount: 1, identifiedCents: 50000 },
      partial: { claimCount: 0, identifiedCents: 0 },
      rejected: { claimCount: 1, identifiedCents: 1000 },
      disputed: { claimCount: 0, identifiedCents: 0 },
      withdrawn: { claimCount: 0, identifiedCents: 0 },
    });
    expect(body.credited).toEqual({ claimCount: 1, cents: 40000 });
    expect(body.paid).toEqual({ claimCount: 1, cents: 40000 });
    expect(body.recoveryRate).toEqual({ claimCount: 2, creditedCents: 40000, identifiedCents: 51000, rateBasisPoints: 7843 });
    expect(body.reviewerHours).toEqual({ claimCount: 2, hours: 11, capHoursPerClaim: 8, creditedPerHourCents: 3636, approximation: OUTCOME_TEXT.reviewerHoursNote });
    expect(body.byRule.map((r) => [r.ruleId, r.title, r.mixed, r.rateBasisPoints])).toEqual([
      ['R_X', 'Detention', false, 8000],
      ['', OUTCOME_TEXT.mixedRule, true, 0],
    ]);
    expect(body.auditedNoFinding).toEqual({ claimCount: 1 });
    const empty = recoveryBody(NOW, period, NOF, [], [], { claimCount: 0, totalMs: 0 }, 0);
    expect(InsightsRecovery.parse(empty)).toEqual(empty);
    expect(empty.recoveryRate.rateBasisPoints).toBeNull();
    expect(empty.reviewerHours.creditedPerHourCents).toBeNull();
  });
});

describe('recovery SQL shape (api/src/db/insights-recovery.ts)', () => {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'db', 'insights-recovery.ts');
  const text = readFileSync(file, 'utf8');
  /** The SQL template literals: the four raw reads and the latest-outcome CTE body. */
  const templates = [...text.matchAll(/(\$queryRaw<[^`]*|Prisma\.sql)`([\s\S]*?)`/gu)].map((m) => ({ kind: m[1]?.startsWith('Prisma.sql') ? 'cte' : 'read', sql: m[2] ?? '' }));
  const reads = templates.filter((t) => t.kind === 'read').map((t) => t.sql);
  const cte = templates.find((t) => t.kind === 'cte')?.sql ?? '';

  it('has four raw reads, each confined to the current tenant with a bound period', () => {
    expect(reads).toHaveLength(4);
    expect(cte).toContain('fr_current_tenant()');
    expect(cte).toContain('${claimFilter(f)}');
    expect(cte).toContain(`o.recorded_at >= \${p.from}::timestamptz AND o.recorded_at < \${p.to}::timestamptz`);
    for (const q of reads) {
      // Every reader goes through the latest-outcome CTE (tenant predicate inside) or filters the outcome rows directly.
      expect(q.includes('${latestOutcomes(f, p)}') || (q.includes('fr_current_tenant()') && q.includes('${claimFilter(f)}'))).toBe(true);
    }
  });

  it('takes the latest OUTCOME row per claim and never interpolates text or unsafe SQL', () => {
    expect(cte).toContain("o.kind = 'OUTCOME'");
    expect(cte).toContain('ORDER BY o.claim_id, o.recorded_at DESC, o.id DESC');
    expect(reads.some((q) => q.includes("o.kind = 'AUDITED_NO_FINDING'"))).toBe(true);
    expect(text).not.toMatch(/Prisma\.raw\(|\$queryRawUnsafe|\$executeRaw/u);
    // The only template holes are the period, the cap, the claim filter and the CTE body.
    const holes = templates.flatMap((t) => [...t.sql.matchAll(/\$\{([^}]+)\}/gu)].map((m) => m[1]));
    expect(new Set(holes)).toEqual(new Set(['p.from', 'p.to', 'claimFilter(f)', 'latestOutcomes(f, p)', 'capMs']));
    for (const t of templates) expect(t.sql).not.toMatch(/\bnote\b/u);
  });
});