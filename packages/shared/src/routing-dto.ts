/**
 * REQ-20261020-dd-deadline: reviewer-routing SHADOW contract (`GET /api/v1/insights/routing`). Read-only
 * aggregates over the caller's own tenant: per reviewer and per finding rule, the median time to the first
 * approve/reject decision and decision counts over a period; for each open claim the current assignee and
 * what two fixed shadow policies would choose; prequential bookkeeping computed from history. Nothing here
 * changes an assignment and nothing is stored. Names of the tenant's own reviewers appear by design (this
 * is the one insights route that carries actors); it is flag-gated (intelligence.routing_shadow, default OFF).
 */
import { z } from 'zod';

import { CLAIM_KINDS, CLAIM_STATUSES } from './dto.js';
import { InsightsMeta, checkInsightsPeriod, insightsInstant } from './insights-dto.js';

export const ROUTING_SHADOW_VERSION = 'routing-shadow-v1';
export const ROUTING_POLICIES = ['fastest_for_rule', 'least_loaded'] as const;
export type RoutingPolicy = (typeof ROUTING_POLICIES)[number];
/** Caps of one request: decisions replayed and open claims shown (the response says when a cap was hit). */
export const ROUTING_DECISIONS_MAX = 5000;
export const ROUTING_OPEN_CLAIMS_MAX = 500;

const count = z.int().min(0);
const hoursN = z.number().min(0);
const basisPoints = z.int().min(0).max(10_000);
const iso = z.string();
const id = z.string();

export const RoutingShadowQuery = z.strictObject({ from: insightsInstant, to: insightsInstant }).superRefine((q, ctx) => checkInsightsPeriod(q.from, q.to, ctx));
export type RoutingShadowQueryInput = z.output<typeof RoutingShadowQuery>;

export const RoutingReviewer = z.strictObject({
  id,
  name: z.string(),
  role: z.string(),
  /** Role may approve packets and the account is active (the least-loaded pool). */
  eligible: z.boolean(),
  packetDecisions: count,
  approveCount: count,
  rejectCount: count,
  medianHoursToFirstDecision: hoursN.nullable(),
  importDecisions: count,
  importMedianHours: hoursN.nullable(),
  openAssigned: count,
});
export type RoutingReviewerDto = z.infer<typeof RoutingReviewer>;

export const RoutingRuleReviewer = z.strictObject({ reviewerId: id, decisions: count, medianHours: hoursN });
export const RoutingRule = z.strictObject({ ruleId: z.string(), decisions: count, reviewers: z.array(RoutingRuleReviewer) });
export type RoutingRuleDto = z.infer<typeof RoutingRule>;

export const RoutingChoice = z.strictObject({ reviewerId: id, name: z.string(), basis: z.string() });
export type RoutingChoiceDto = z.infer<typeof RoutingChoice>;

export const RoutingOpenClaim = z.strictObject({
  claim: z.strictObject({ id, claimNumber: z.string(), kind: z.enum(CLAIM_KINDS), status: z.enum(CLAIM_STATUSES) }),
  packet: z.strictObject({ id, revision: z.int().min(1), createdAt: iso, authorId: id.nullable() }),
  ruleIds: z.array(z.string()),
  actual: z.strictObject({ id, name: z.string() }).nullable(),
  fastestForRule: RoutingChoice.nullable(),
  leastLoaded: RoutingChoice.nullable(),
  /** null when there is no actual assignee or no shadow choice to compare with. */
  agreement: z.strictObject({ fastestForRule: z.boolean().nullable(), leastLoaded: z.boolean().nullable() }),
  /** What a later scorer needs: when the clock started, when this was observed and how long the claim has been open. */
  prequential: z.strictObject({ observedAt: iso, clockStartedAt: iso, openHoursSoFar: hoursN }),
});
export type RoutingOpenClaimDto = z.infer<typeof RoutingOpenClaim>;

const agreementOf = z.strictObject({ agreed: count, compared: count, rateBasisPoints: basisPoints.nullable() });

export const RoutingShadow = z.strictObject({
  meta: InsightsMeta,
  version: z.literal(ROUTING_SHADOW_VERSION),
  shadow: z.literal(true),
  label: z.string(),
  policies: z.strictObject({ fastest_for_rule: z.string(), least_loaded: z.string() }),
  coverage: z.strictObject({
    decisionsConsidered: count,
    decisionsTruncated: z.boolean(),
    openClaimsConsidered: count,
    openClaimsTruncated: z.boolean(),
    eligibleReviewers: count,
  }),
  reviewers: z.array(RoutingReviewer),
  rules: z.array(RoutingRule),
  openClaims: z.array(RoutingOpenClaim),
  agreement: z.strictObject({ fastestForRule: agreementOf, leastLoaded: agreementOf }),
  prequential: z.strictObject({
    policy: z.literal('fastest_for_rule'),
    evaluated: count,
    noHistory: count,
    agreed: count,
    disagreedShadowMedianFaster: count,
    disagreedShadowMedianNotFaster: count,
    note: z.string(),
  }),
});
export type RoutingShadowDto = z.infer<typeof RoutingShadow>;