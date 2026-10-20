/**
 * REQ-20261020-claim-outcomes: the claim outcome contract. An outcome is what happened after a claim was
 * marked ready to demand: how the demand was sent, what the carrier or terminal answered and what was
 * credited or paid, as typed in by a person. Rows are append-only (a correction is a new row; the latest
 * row of a claim counts). The second kind, AUDITED_NO_FINDING, records that an invoice was audited and
 * nothing was found, so audited volume can be counted. Money is integer cents; no field carries a user
 * name, e-mail or free text beyond the bounded note.
 */
import { z } from 'zod';

import { singleLine } from './dto.js';
import { InsightsMeta, InsightsThroughputQuery } from './insights-dto.js';

export const OUTCOME_KINDS = ['OUTCOME', 'AUDITED_NO_FINDING'] as const;
export const OUTCOME_CHANNELS = ['EMAIL', 'PORTAL', 'PHONE', 'MAIL', 'OTHER'] as const;
export const CARRIER_RESPONSES = ['NONE_YET', 'ACCEPTED', 'PARTIAL', 'REJECTED', 'DISPUTED', 'WITHDRAWN'] as const;
export type OutcomeKind = (typeof OUTCOME_KINDS)[number];
export type OutcomeChannel = (typeof OUTCOME_CHANNELS)[number];
export type CarrierResponse = (typeof CARRIER_RESPONSES)[number];

/** Fixed policy. */
export const OUTCOME_NOTE_MAX = 500;
/** PostgreSQL INTEGER bound of the cents columns. */
export const OUTCOME_CENTS_MAX = 2_147_483_647;
/** Newest-first rows returned per claim. */
export const OUTCOME_LIST_MAX = 200;
/** Reviewer-hour approximation: per-claim cap in hours (packet creation to ready-to-demand). */
export const OUTCOME_REVIEWER_HOURS_CAP = 8;
const OUTCOME_YEAR_MIN = 2000;
const OUTCOME_YEAR_MAX = 2100;

const uuid = z.uuid();
const iso = z.string();
const count = z.int().min(0);
const cents = z.int().min(0).max(OUTCOME_CENTS_MAX);
const basisPoints = z.int().min(0);

/** A UTC instant (`YYYY-MM-DDTHH:MM:SS[.sss]Z`) of a plausible year. */
export const outcomeInstant = z.iso.datetime().refine(
  (v) => {
    const d = new Date(v);
    return !Number.isNaN(d.getTime()) && d.getUTCFullYear() >= OUTCOME_YEAR_MIN && d.getUTCFullYear() <= OUTCOME_YEAR_MAX;
  },
  { message: 'instant out of range' },
);

const note = singleLine(0, OUTCOME_NOTE_MAX).default('');

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

/** kind OUTCOME: the claim must be SEND_READY. closedAt may not precede sentAt. */
export const OutcomeRecordBody = z
  .strictObject({
    kind: z.literal('OUTCOME'),
    channel: z.enum(OUTCOME_CHANNELS),
    carrierResponse: z.enum(CARRIER_RESPONSES),
    sentAt: outcomeInstant.nullable().default(null),
    creditedCents: cents.nullable().default(null),
    paidCents: cents.nullable().default(null),
    closedAt: outcomeInstant.nullable().default(null),
    note,
  })
  .superRefine((b, ctx) => {
    if (b.sentAt !== null && b.closedAt !== null && new Date(b.closedAt).getTime() < new Date(b.sentAt).getTime()) {
      ctx.addIssue({ code: 'custom', path: ['closedAt'], message: 'closedAt before sentAt' });
    }
  });
export type OutcomeRecordBodyInput = z.output<typeof OutcomeRecordBody>;

/** kind AUDITED_NO_FINDING: any analysed claim (status other than AWAITING_ANALYSIS). */
export const NoFindingRecordBody = z.strictObject({
  kind: z.literal('AUDITED_NO_FINDING'),
  closedAt: outcomeInstant.nullable().default(null),
  note,
});
export type NoFindingRecordBodyInput = z.output<typeof NoFindingRecordBody>;

export const ClaimOutcomeBody = z.discriminatedUnion('kind', [OutcomeRecordBody, NoFindingRecordBody]);
export type ClaimOutcomeBodyInput = z.output<typeof ClaimOutcomeBody>;

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export const ClaimOutcomeView = z.strictObject({
  id: uuid,
  claimId: uuid,
  kind: z.enum(OUTCOME_KINDS),
  channel: z.enum(OUTCOME_CHANNELS),
  carrierResponse: z.enum(CARRIER_RESPONSES),
  sentAt: iso.nullable(),
  creditedCents: cents.nullable(),
  paidCents: cents.nullable(),
  closedAt: iso.nullable(),
  note: z.string().max(OUTCOME_NOTE_MAX),
  version: z.int().min(1),
  recordedAt: iso,
  recordedBy: z.strictObject({ id: uuid, name: z.string() }),
});
export type ClaimOutcomeViewDto = z.infer<typeof ClaimOutcomeView>;

export const ClaimOutcomeList = z.strictObject({ claimId: uuid, items: z.array(ClaimOutcomeView).max(OUTCOME_LIST_MAX) });
export type ClaimOutcomeListDto = z.infer<typeof ClaimOutcomeList>;

// ---------------------------------------------------------------------------------------------
// Insights: the Recovery section (read-only aggregates over recorded outcomes)
// ---------------------------------------------------------------------------------------------

export const InsightsRecoveryQuery = InsightsThroughputQuery;
export type InsightsRecoveryQueryInput = z.output<typeof InsightsRecoveryQuery>;

/** Claims counted with the sum of their identified (recoverable) cents. */
export const InsightsRecoveryClaims = z.strictObject({ claimCount: count, identifiedCents: cents });
export type InsightsRecoveryClaimsDto = z.infer<typeof InsightsRecoveryClaims>;

/**
 * One finding type among the claims with an outcome in the period. Credited money belongs to a claim, so a
 * claim whose current packet holds several finding types is grouped under the `mixed` row instead of
 * being split.
 */
export const InsightsRecoveryRuleRow = z.strictObject({
  ruleId: z.string(),
  title: z.string(),
  mixed: z.boolean(),
  claimCount: count,
  findingsSent: count,
  findingsAccepted: count,
  findingsPartial: count,
  findingsRejected: count,
  identifiedCents: cents,
  creditedCents: cents,
  rateBasisPoints: basisPoints.nullable(),
});
export type InsightsRecoveryRuleRowDto = z.infer<typeof InsightsRecoveryRuleRow>;

export const InsightsRecovery = z.strictObject({
  meta: InsightsMeta,
  basis: z.literal('human_entered'),
  /** Claims with at least one OUTCOME row recorded in the period (their latest row decides the response). */
  sent: InsightsRecoveryClaims,
  responses: z.strictObject({
    noneYet: InsightsRecoveryClaims,
    accepted: InsightsRecoveryClaims,
    partial: InsightsRecoveryClaims,
    rejected: InsightsRecoveryClaims,
    disputed: InsightsRecoveryClaims,
    withdrawn: InsightsRecoveryClaims,
  }),
  credited: z.strictObject({ claimCount: count, cents }),
  paid: z.strictObject({ claimCount: count, cents }),
  recoveryRate: z.strictObject({ claimCount: count, creditedCents: cents, identifiedCents: cents, rateBasisPoints: basisPoints.nullable() }),
  reviewerHours: z.strictObject({
    claimCount: count,
    hours: z.number().min(0),
    capHoursPerClaim: z.literal(OUTCOME_REVIEWER_HOURS_CAP),
    creditedPerHourCents: cents.nullable(),
    approximation: z.string(),
  }),
  byRule: z.array(InsightsRecoveryRuleRow),
  auditedNoFinding: z.strictObject({ claimCount: count }),
});
export type InsightsRecoveryDto = z.infer<typeof InsightsRecovery>;

// ---------------------------------------------------------------------------------------------
// Fixed copy (rendered verbatim; states the basis, never a result)
// ---------------------------------------------------------------------------------------------

export const OUTCOME_CHANNEL_TEXT: Readonly<Record<OutcomeChannel, string>> = Object.freeze({
  EMAIL: 'E-mail',
  PORTAL: 'Carrier portal',
  PHONE: 'Phone',
  MAIL: 'Post',
  OTHER: 'Other',
});

export const CARRIER_RESPONSE_TEXT: Readonly<Record<CarrierResponse, string>> = Object.freeze({
  NONE_YET: 'No answer yet',
  ACCEPTED: 'Accepted',
  PARTIAL: 'Partly accepted',
  REJECTED: 'Rejected',
  DISPUTED: 'Disputed',
  WITHDRAWN: 'Withdrawn by us',
});

export const OUTCOME_KIND_TEXT: Readonly<Record<OutcomeKind, string>> = Object.freeze({
  OUTCOME: 'Outcome',
  AUDITED_NO_FINDING: 'Audited, no finding',
});

export const OUTCOME_TEXT = Object.freeze({
  tab: 'Outcomes',
  heading: 'Record outcome',
  intro:
    'Enter how the demand was sent, what the carrier or terminal answered and what was credited or paid. Outcomes are typed in by your team; nothing is reconciled against payments or remittances.',
  appendOnly: 'Outcomes cannot be edited or deleted. To correct one, record a new outcome: the latest entry counts.',
  listHeading: 'Recorded outcomes',
  listEmpty: 'No outcome recorded for this claim yet.',
  success: 'Outcome recorded.',
  conflict: 'This claim is not in a state that accepts this outcome. Reload and try again.',
  failed: 'The outcome could not be recorded.',
  recoveryTitle: 'Recovery',
  recoveryIntro:
    'Carrier responses and credited or paid amounts come from outcomes your team recorded by hand in the period. The latest outcome of each claim counts. Nothing here is reconciled with payments.',
  recoveryEmpty: 'No outcome was recorded in the period.',
  rateNote: 'Credited as a share of the identified amount on the same claims.',
  reviewerHoursNote: `Reviewer hours are approximated from approval timestamps: for each claim with an outcome, the time from the creation of its evidence packet to the moment it was marked ready to demand, capped at ${OUTCOME_REVIEWER_HOURS_CAP} hours per claim. This is not time tracking.`,
  mixedRule: 'Several finding types',
  mixedNote: 'Credited amounts belong to a claim, not to a finding. A claim whose packet holds more than one finding type is grouped under "Several finding types".',
  noFindingLabel: 'Invoices audited with no finding',
} as const);