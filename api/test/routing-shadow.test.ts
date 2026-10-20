/**
 * REQ-20261020-dd-deadline: the reviewer-routing SHADOW assembly (pure). Shape against the strict shared
 * schema, the two policies, four-eyes exclusion of the revision author, the prequential replay and the
 * nearest-rank median. No database.
 */
import { ROUTING_POLICY_TEXT, ROUTING_SHADOW_NOTE, RoutingShadow } from '@fr/shared';
import { describe, expect, it } from 'vitest';

import type { DecisionEventRow, OpenClaimRow, PoolMemberRow } from '../src/db/routing.js';
import { DecisionHistory, buildRoutingShadow, isEligible, leastLoaded, medianNearestRank, type RoutingInputs } from '../src/intelligence/routing.js';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const period = { from: new Date('2026-05-16T00:00:00Z'), to: new Date('2026-06-16T00:00:00Z') };
const H = 3_600_000;
const t = (h: number) => new Date(Date.UTC(2026, 5, 1, 0, 0, 0) + h * H);

const ALICE = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'b0000000-0000-4000-8000-000000000002';
const CARA = 'c0000000-0000-4000-8000-000000000003';
const DAN = 'd0000000-0000-4000-8000-000000000004';

const pool: PoolMemberRow[] = [
  { id: ALICE, name: 'Alice', role: 'REVIEWER', active: true },
  { id: BOB, name: 'Bob', role: 'MANAGER', active: true },
  { id: CARA, name: 'Cara', role: 'ANALYST', active: true },
  { id: DAN, name: 'Dan', role: 'REVIEWER', active: false },
];

function decision(n: number, actor: string, name: string, startH: number, hoursTaken: number, rules: string[], authorId: string | null = null): DecisionEventRow {
  return {
    packetId: `p${n}`,
    claimId: `c${n}`,
    packetCreatedAt: t(startH),
    decidedAt: t(startH + hoursTaken),
    actorId: actor,
    actorName: name,
    actorRole: 'REVIEWER',
    action: n % 3 === 0 ? 'REJECT' : 'APPROVE',
    authorId,
    ruleIds: rules,
  };
}

const decisions: DecisionEventRow[] = [
  decision(1, ALICE, 'Alice', 0, 4, ['R1']),
  decision(2, BOB, 'Bob', 10, 1, ['R1', 'R2']),
  decision(3, ALICE, 'Alice', 20, 2, ['R1']),
  decision(4, BOB, 'Bob', 30, 8, ['R1']),
  decision(5, ALICE, 'Alice', 40, 3, ['R2']),
];

function open(id: string, assignee: { id: string; name: string } | null, rules: string[], authorId: string | null = null): OpenClaimRow {
  return { id, claimNumber: `CLM-${id}`, kind: 'FREIGHT', status: 'PENDING_REVIEW', assignee, packet: { id: `pk-${id}`, revision: 1, createdAt: t(100), authorId }, ruleIds: rules };
}

const base: RoutingInputs = {
  now: NOW,
  period,
  decisions,
  decisionsTruncated: false,
  imports: [{ actorId: CARA, decisions: 7, p50Ms: 90 * 60_000 }],
  open: [open('o1', { id: ALICE, name: 'Alice' }, ['R1']), open('o2', { id: BOB, name: 'Bob' }, ['R2']), open('o3', null, ['R9']), open('o4', { id: BOB, name: 'Bob' }, ['R1'], ALICE)],
  openTruncated: false,
  load: [
    { assigneeId: ALICE, openClaims: 1 },
    { assigneeId: BOB, openClaims: 2 },
  ],
  pool,
};

describe('medianNearestRank', () => {
  it('matches percentile_disc(0.5): the ceil(n/2)-th smallest', () => {
    expect(medianNearestRank([])).toBeNull();
    expect(medianNearestRank([5])).toBe(5);
    expect(medianNearestRank([4, 1])).toBe(1);
    expect(medianNearestRank([3, 1, 2])).toBe(2);
    expect(medianNearestRank([10, 1, 7, 3])).toBe(3);
  });
});

describe('policies', () => {
  it('fastest_for_rule picks the lowest median on the rule, never the revision author, null without history', () => {
    const h = new DecisionHistory();
    for (const d of decisions) h.add(d);
    // R1: Alice medians [4h,2h] -> 2h; Bob [1h,8h] -> 1h. Bob wins.
    expect(h.fastestFor(['R1'], null)).toMatchObject({ reviewerId: BOB, medianMs: 1 * H, decisions: 2, ruleId: 'R1' });
    expect(h.fastestFor(['R1'], BOB)).toMatchObject({ reviewerId: ALICE, medianMs: 2 * H });
    // R2: Bob 1h (1 decision), Alice 3h.
    expect(h.fastestFor(['R2'], null)).toMatchObject({ reviewerId: BOB, ruleId: 'R2' });
    expect(h.fastestFor(['R9'], null)).toBeNull();
    expect(h.fastestFor([], null)).toBeNull();
  });
  it('least_loaded takes the eligible, active, non-author member with the fewest open claims (ties by id)', () => {
    const load = new Map([
      [ALICE, 1],
      [BOB, 2],
    ]);
    expect(pool.map(isEligible)).toEqual([true, true, false, false]);
    expect(leastLoaded(pool, load, null)).toEqual({ reviewerId: ALICE, name: 'Alice', basis: '1 open claim assigned now' });
    expect(leastLoaded(pool, load, ALICE)).toEqual({ reviewerId: BOB, name: 'Bob', basis: '2 open claims assigned now' });
    expect(leastLoaded(pool, new Map(), null)).toEqual({ reviewerId: ALICE, name: 'Alice', basis: '0 open claims assigned now' });
    expect(leastLoaded([], load, null)).toBeNull();
  });
});

describe('buildRoutingShadow', () => {
  const body = buildRoutingShadow(base);

  it('satisfies the strict schema and is labelled as a shadow', () => {
    expect(RoutingShadow.parse(body)).toEqual(body);
    expect(body.shadow).toBe(true);
    expect(body.version).toBe('routing-shadow-v1');
    expect(body.label).toBe(ROUTING_SHADOW_NOTE);
    expect(body.policies).toEqual(ROUTING_POLICY_TEXT);
    expect(body.meta).toEqual({ asOf: NOW.toISOString(), period: { from: period.from.toISOString(), to: period.to.toISOString() }, filters: { kind: null, perspective: null } });
    expect(body.coverage).toEqual({ decisionsConsidered: 5, decisionsTruncated: false, openClaimsConsidered: 4, openClaimsTruncated: false, eligibleReviewers: 2 });
  });

  it('reviewer rows carry counts, medians, import stats and load; the inactive member is not eligible', () => {
    const by = Object.fromEntries(body.reviewers.map((r) => [r.id, r]));
    expect(body.reviewers.map((r) => r.id)).toEqual([ALICE, BOB, CARA, DAN]);
    expect(by[ALICE]).toEqual({
      id: ALICE,
      name: 'Alice',
      role: 'REVIEWER',
      eligible: true,
      packetDecisions: 3,
      approveCount: 2,
      rejectCount: 1,
      medianHoursToFirstDecision: 3,
      importDecisions: 0,
      importMedianHours: null,
      openAssigned: 1,
    });
    expect(by[BOB]).toMatchObject({ packetDecisions: 2, medianHoursToFirstDecision: 1, openAssigned: 2, eligible: true });
    expect(by[CARA]).toMatchObject({ packetDecisions: 0, importDecisions: 7, importMedianHours: 1.5, eligible: false, openAssigned: 0 });
    expect(by[DAN]).toMatchObject({ eligible: false, packetDecisions: 0 });
  });

  it('rule rows list reviewers fastest first', () => {
    expect(body.rules).toEqual([
      { ruleId: 'R1', decisions: 4, reviewers: [{ reviewerId: BOB, decisions: 2, medianHours: 1 }, { reviewerId: ALICE, decisions: 2, medianHours: 2 }] },
      { ruleId: 'R2', decisions: 2, reviewers: [{ reviewerId: BOB, decisions: 1, medianHours: 1 }, { reviewerId: ALICE, decisions: 1, medianHours: 3 }] },
    ]);
  });

  it('open claims show the actual assignee next to both shadow choices and the agreement', () => {
    const [o1, o2, o3, o4] = body.openClaims;
    expect(o1).toMatchObject({ actual: { id: ALICE, name: 'Alice' }, fastestForRule: { reviewerId: BOB, name: 'Bob', basis: 'median 1 h over 2 decisions on R1' }, leastLoaded: { reviewerId: ALICE }, agreement: { fastestForRule: false, leastLoaded: true } });
    expect(o2).toMatchObject({ actual: { id: BOB }, fastestForRule: { reviewerId: BOB, basis: 'median 1 h over 1 decision on R2' }, leastLoaded: { reviewerId: ALICE }, agreement: { fastestForRule: true, leastLoaded: false } });
    expect(o3).toMatchObject({ actual: null, fastestForRule: null, leastLoaded: { reviewerId: ALICE }, agreement: { fastestForRule: null, leastLoaded: null } });
    // o4: Alice authored the revision, so neither policy may pick her.
    expect(o4).toMatchObject({ fastestForRule: { reviewerId: BOB }, leastLoaded: { reviewerId: BOB }, agreement: { fastestForRule: true, leastLoaded: true } });
    expect(o1?.prequential).toEqual({ observedAt: NOW.toISOString(), clockStartedAt: t(100).toISOString(), openHoursSoFar: 248 });
    expect(body.agreement).toEqual({
      fastestForRule: { agreed: 2, compared: 3, rateBasisPoints: 6666 },
      leastLoaded: { agreed: 2, compared: 3, rateBasisPoints: 6666 },
    });
  });

  it('prequential replay uses only earlier decisions', () => {
    // d1: no history. d2 (Bob, R1+R2): history R1 -> Alice (4h); Bob decided -> disagreed, Alice median 4h > actual 1h -> not faster.
    // d3 (Alice, R1): history R1 -> Bob 1h vs Alice 4h -> pick Bob; actual Alice took 2h; Bob median 1h < 2h -> faster.
    // d4 (Bob, R1): R1 -> Bob 1h (Alice median [4,2]=2h) -> agreed. d5 (Alice, R2): R2 -> Bob 1h; Alice took 3h -> faster.
    expect(body.prequential).toMatchObject({ policy: 'fastest_for_rule', evaluated: 5, noHistory: 1, agreed: 1, disagreedShadowMedianFaster: 2, disagreedShadowMedianNotFaster: 1 });
  });

  it('is deterministic and does not depend on input order', () => {
    const shuffled = buildRoutingShadow({ ...base, decisions: [...decisions].reverse(), pool: [...pool].reverse() });
    expect(shuffled).toEqual(body);
  });

  it('empty inputs give an empty, valid body', () => {
    const empty = buildRoutingShadow({ ...base, decisions: [], imports: [], open: [], load: [], pool: [] });
    expect(RoutingShadow.parse(empty)).toEqual(empty);
    expect(empty.reviewers).toEqual([]);
    expect(empty.agreement.fastestForRule.rateBasisPoints).toBeNull();
    expect(empty.prequential.evaluated).toBe(0);
  });
});