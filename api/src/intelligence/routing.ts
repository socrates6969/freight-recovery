/**
 * REQ-20261020-dd-deadline: reviewer-routing SHADOW (routing-shadow-v1). Pure assembly over rows read by
 * `db/routing.ts`: per reviewer and per finding rule the nearest-rank median time from a packet revision to
 * its first approve/reject decision and decision counts over a period; for each open claim the current
 * assignee and what two fixed policies would choose; a prequential replay of the period's decisions. The
 * result is shown next to the actual assignee and changes nothing; nothing is stored. Statistics here are
 * descriptive of the tenant's own history, not a learned model and not a performance measure.
 *
 *   fastest_for_rule: for each rule of the claim, the reviewer with the lowest median duration on past packets
 *                     carrying that rule (ties: more decisions, then lower id); over the claim's rules, the
 *                     lowest median wins. The revision's author is never chosen (four-eyes). No history -> null.
 *   least_loaded:     the eligible reviewer (role with packets:approve, active account, not the author) with the
 *                     fewest open claims assigned now (ties: lower id). No eligible reviewer -> null.
 *   prequential:      decisions replayed in time order; the fastest_for_rule pick before each decision is
 *                     compared with the actual decider, and on disagreement its median then with the actual
 *                     duration. Only this policy can be replayed: past assignment loads are not stored.
 */
import {
  ROUTING_POLICY_TEXT,
  ROUTING_PREQUENTIAL_NOTE,
  ROUTING_SHADOW_NOTE,
  ROUTING_SHADOW_VERSION,
  can,
  isRole,
  type RoutingChoiceDto,
  type RoutingOpenClaimDto,
  type RoutingReviewerDto,
  type RoutingRuleDto,
  type RoutingShadowDto,
} from '@fr/shared';

import type { DecisionEventRow, ImportDecisionStatRow, OpenClaimRow, OpenLoadRow, PoolMemberRow, RoutingPeriod } from '../db/routing.js';
import { basisPoints, hours, meta } from '../insights/service.js';

export interface RoutingInputs {
  now: Date;
  period: RoutingPeriod;
  decisions: readonly DecisionEventRow[];
  decisionsTruncated: boolean;
  imports: readonly ImportDecisionStatRow[];
  open: readonly OpenClaimRow[];
  openTruncated: boolean;
  load: readonly OpenLoadRow[];
  pool: readonly PoolMemberRow[];
}

/** Nearest-rank median (the same value percentile_disc(0.5) gives): the ceil(n/2)-th smallest. */
export function medianNearestRank(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length / 2) - 1] ?? null;
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface ReviewerStats {
  durations: number[];
  approve: number;
  reject: number;
  name: string;
  role: string;
}

interface Candidate {
  reviewerId: string;
  medianMs: number;
  decisions: number;
  ruleId: string;
}

/** Better candidate first: lower median, then more decisions, then lower id (a strict total order). */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.medianMs !== b.medianMs) return a.medianMs - b.medianMs;
  if (a.decisions !== b.decisions) return b.decisions - a.decisions;
  return byId(a.reviewerId, b.reviewerId);
}

/** Decision history that grows one event at a time (used both for the replay and the final tables). */
export class DecisionHistory {
  readonly byReviewer = new Map<string, ReviewerStats>();
  /** rule id -> reviewer id -> durations (ms). */
  readonly byRule = new Map<string, Map<string, number[]>>();

  add(d: DecisionEventRow): void {
    const ms = Math.max(0, d.decidedAt.getTime() - d.packetCreatedAt.getTime());
    const s = this.byReviewer.get(d.actorId) ?? { durations: [], approve: 0, reject: 0, name: d.actorName, role: d.actorRole };
    s.durations.push(ms);
    if (d.action === 'APPROVE') s.approve += 1;
    else s.reject += 1;
    s.name = d.actorName;
    s.role = d.actorRole;
    this.byReviewer.set(d.actorId, s);
    for (const rule of new Set(d.ruleIds)) {
      const perReviewer = this.byRule.get(rule) ?? new Map<string, number[]>();
      const list = perReviewer.get(d.actorId) ?? [];
      list.push(ms);
      perReviewer.set(d.actorId, list);
      this.byRule.set(rule, perReviewer);
    }
  }

  /** The fastest_for_rule pick for a claim with `ruleIds`, never `excludeId` (the revision's author). */
  fastestFor(ruleIds: readonly string[], excludeId: string | null): Candidate | null {
    let best: Candidate | null = null;
    for (const rule of [...new Set(ruleIds)].sort(byId)) {
      const perReviewer = this.byRule.get(rule);
      if (!perReviewer) continue;
      for (const [reviewerId, durations] of perReviewer) {
        if (reviewerId === excludeId) continue;
        const medianMs = medianNearestRank(durations);
        if (medianMs === null) continue;
        const c: Candidate = { reviewerId, medianMs, decisions: durations.length, ruleId: rule };
        if (best === null || compareCandidates(c, best) < 0) best = c;
      }
    }
    return best;
  }
}

function decisionsText(n: number): string {
  return n === 1 ? '1 decision' : `${n} decisions`;
}

function fastestChoice(c: Candidate, names: ReadonlyMap<string, string>): RoutingChoiceDto {
  return { reviewerId: c.reviewerId, name: names.get(c.reviewerId) ?? '', basis: `median ${hours(c.medianMs)} h over ${decisionsText(c.decisions)} on ${c.ruleId}` };
}

/** The least_loaded pick: eligible pool members by open load, then id; never `excludeId`. */
export function leastLoaded(pool: readonly PoolMemberRow[], load: ReadonlyMap<string, number>, excludeId: string | null): RoutingChoiceDto | null {
  const eligible = pool.filter((m) => isEligible(m) && m.id !== excludeId);
  if (eligible.length === 0) return null;
  const best = [...eligible].sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || byId(a.id, b.id))[0];
  if (!best) return null;
  const n = load.get(best.id) ?? 0;
  return { reviewerId: best.id, name: best.name, basis: `${n === 1 ? '1 open claim' : `${n} open claims`} assigned now` };
}

export function isEligible(m: PoolMemberRow): boolean {
  return m.active && isRole(m.role) && can(m.role, 'packets:approve');
}

function agreementOf(actual: { id: string } | null, choice: RoutingChoiceDto | null): boolean | null {
  return actual === null || choice === null ? null : choice.reviewerId === actual.id;
}

function rate(agreed: number, compared: number): { agreed: number; compared: number; rateBasisPoints: number | null } {
  return { agreed, compared, rateBasisPoints: compared === 0 ? null : basisPoints(agreed, compared) };
}

export function buildRoutingShadow(i: RoutingInputs): RoutingShadowDto {
  // 1. Prequential replay in time order (the rows arrive decided_at ascending; sorted again to be sure).
  const ordered = [...i.decisions].sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime() || byId(a.packetId, b.packetId));
  const history = new DecisionHistory();
  const pre = { evaluated: 0, noHistory: 0, agreed: 0, faster: 0, notFaster: 0 };
  for (const d of ordered) {
    pre.evaluated += 1;
    const pick = history.fastestFor(d.ruleIds, d.authorId);
    if (pick === null) pre.noHistory += 1;
    else if (pick.reviewerId === d.actorId) pre.agreed += 1;
    else if (pick.medianMs < Math.max(0, d.decidedAt.getTime() - d.packetCreatedAt.getTime())) pre.faster += 1;
    else pre.notFaster += 1;
    history.add(d);
  }

  // 2. Reviewer table: pool members plus anyone seen deciding or holding open claims.
  const names = new Map<string, string>();
  for (const m of i.pool) names.set(m.id, m.name);
  for (const [id, s] of history.byReviewer) if (!names.has(id)) names.set(id, s.name);
  for (const c of i.open) if (c.assignee && !names.has(c.assignee.id)) names.set(c.assignee.id, c.assignee.name);
  const load = new Map(i.load.map((l) => [l.assigneeId, l.openClaims]));
  const imports = new Map(i.imports.map((x) => [x.actorId, x]));
  const poolById = new Map(i.pool.map((m) => [m.id, m]));
  const ids = new Set<string>([...names.keys(), ...load.keys(), ...imports.keys()]);
  const reviewers: RoutingReviewerDto[] = [...ids]
    .sort(byId)
    .map((id) => {
      const s = history.byReviewer.get(id);
      const m = poolById.get(id);
      const imp = imports.get(id);
      const median = s ? medianNearestRank(s.durations) : null;
      return {
        id,
        name: names.get(id) ?? '',
        role: m?.role ?? s?.role ?? 'FORMER_MEMBER',
        eligible: m !== undefined && isEligible(m),
        packetDecisions: s ? s.durations.length : 0,
        approveCount: s?.approve ?? 0,
        rejectCount: s?.reject ?? 0,
        medianHoursToFirstDecision: median === null ? null : hours(median),
        importDecisions: imp?.decisions ?? 0,
        importMedianHours: imp?.p50Ms === undefined || imp.p50Ms === null ? null : hours(imp.p50Ms),
        openAssigned: load.get(id) ?? 0,
      };
    })
    .sort((a, b) => b.packetDecisions - a.packetDecisions || byId(a.id, b.id));

  // 3. Rule table.
  const rules: RoutingRuleDto[] = [...history.byRule.keys()].sort(byId).map((ruleId) => {
    const perReviewer = history.byRule.get(ruleId) ?? new Map<string, number[]>();
    const rows = [...perReviewer]
      .map(([reviewerId, durations]) => ({ reviewerId, decisions: durations.length, medianMs: medianNearestRank(durations) ?? 0 }))
      .sort((a, b) => a.medianMs - b.medianMs || b.decisions - a.decisions || byId(a.reviewerId, b.reviewerId));
    return { ruleId, decisions: rows.reduce((n, x) => n + x.decisions, 0), reviewers: rows.map((x) => ({ reviewerId: x.reviewerId, decisions: x.decisions, medianHours: hours(x.medianMs) })) };
  });

  // 4. Open claims with both shadow choices and the agreement counts.
  const agree = { fastest: { agreed: 0, compared: 0 }, least: { agreed: 0, compared: 0 } };
  const openClaims: RoutingOpenClaimDto[] = i.open.map((c) => {
    const fastest = history.fastestFor(c.ruleIds, c.packet.authorId);
    const fastestForRule = fastest === null ? null : fastestChoice(fastest, names);
    const least = leastLoaded(i.pool, load, c.packet.authorId);
    const agreement = { fastestForRule: agreementOf(c.assignee, fastestForRule), leastLoaded: agreementOf(c.assignee, least) };
    if (agreement.fastestForRule !== null) {
      agree.fastest.compared += 1;
      if (agreement.fastestForRule) agree.fastest.agreed += 1;
    }
    if (agreement.leastLoaded !== null) {
      agree.least.compared += 1;
      if (agreement.leastLoaded) agree.least.agreed += 1;
    }
    return {
      claim: { id: c.id, claimNumber: c.claimNumber, kind: c.kind, status: c.status },
      packet: { id: c.packet.id, revision: c.packet.revision, createdAt: c.packet.createdAt.toISOString(), authorId: c.packet.authorId },
      ruleIds: [...new Set(c.ruleIds)].sort(byId),
      actual: c.assignee,
      fastestForRule,
      leastLoaded: least,
      agreement,
      prequential: {
        observedAt: i.now.toISOString(),
        clockStartedAt: c.packet.createdAt.toISOString(),
        openHoursSoFar: hours(Math.max(0, i.now.getTime() - c.packet.createdAt.getTime())),
      },
    };
  });

  return {
    meta: meta(i.now, i.period, { kind: null, perspective: null }),
    version: ROUTING_SHADOW_VERSION,
    shadow: true,
    label: ROUTING_SHADOW_NOTE,
    policies: { fastest_for_rule: ROUTING_POLICY_TEXT.fastest_for_rule, least_loaded: ROUTING_POLICY_TEXT.least_loaded },
    coverage: {
      decisionsConsidered: ordered.length,
      decisionsTruncated: i.decisionsTruncated,
      openClaimsConsidered: openClaims.length,
      openClaimsTruncated: i.openTruncated,
      eligibleReviewers: i.pool.filter(isEligible).length,
    },
    reviewers,
    rules,
    openClaims,
    agreement: { fastestForRule: rate(agree.fastest.agreed, agree.fastest.compared), leastLoaded: rate(agree.least.agreed, agree.least.compared) },
    prequential: {
      policy: 'fastest_for_rule',
      evaluated: pre.evaluated,
      noHistory: pre.noHistory,
      agreed: pre.agreed,
      disagreedShadowMedianFaster: pre.faster,
      disagreedShadowMedianNotFaster: pre.notFaster,
      note: ROUTING_PREQUENTIAL_NOTE,
    },
  };
}