/**
 * Audit-agent team (REQ-20261022-audit-agents): JSON contracts between the agents. Every agent input and
 * output is a zod schema, so an LLM answer is validated exactly like a deterministic one, and the JSON
 * Schemas quoted in `.claude/agents/` come from the same source (`agentJsonSchemas`).
 *
 * Money and weights are DecimalStrings (never floats). Dates are `YYYY-MM-DD`; timestamps are local
 * `YYYY-MM-DDTHH:MM:SS` (the step-5 form).
 */
import { z } from 'zod';

const DEC = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/u;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
const LOCAL_DT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$/u;
const TEXT_MAX = 200;

export const Money = z.string().regex(DEC);
export const DateText = z.string().regex(DATE);
const LocalDt = z.string().regex(LOCAL_DT);
const Text = z.string().max(TEXT_MAX);

/** One billed line. `quantity`/`rate` are present when the carrier printed them (LTL cwt, hours, stops). */
export const NormalizedLine = z.strictObject({
  description: Text,
  amount: Money,
  code: Text.nullable(),
  quantity: Money.nullable(),
  rate: Money.nullable(),
});
export type NormalizedLine = z.infer<typeof NormalizedLine>;

/** Intake agent output: one carrier invoice, normalised from EDI 210, CSV or extracted fields. */
export const NormalizedInvoice = z.strictObject({
  invoiceNumber: Text,
  carrier: Text,
  scac: Text.nullable(),
  proNumber: Text.nullable(),
  loadNumber: Text.nullable(),
  bolNumber: Text.nullable(),
  invoiceDate: DateText,
  shipDate: DateText.nullable(),
  origin: Text.nullable(),
  destination: Text.nullable(),
  mode: z.enum(['TL', 'LTL']),
  miles: Money.nullable(),
  billedWeightLbs: Money.nullable(),
  billedClass: Text.nullable(),
  lines: z.array(NormalizedLine).max(200),
  total: Money.nullable(),
  source: z.enum(['edi210', 'csv', 'fields', 'llm']),
  warnings: z.array(Text),
});
export type NormalizedInvoice = z.infer<typeof NormalizedInvoice>;

/** Shipment evidence the shipper holds (BOL, gate log, reweigh certificate, accessorial approvals). */
export const ShipmentEvidence = z.strictObject({
  bolNumber: Text.nullable(),
  bolWeightLbs: Money.nullable(),
  bolClass: Text.nullable(),
  appointmentTime: LocalDt.nullable(),
  arrivalTime: LocalDt.nullable(),
  departureTime: LocalDt.nullable(),
  /** Reweigh / inspection certificate id supplied by the carrier, if any. */
  reweighCertificate: Text.nullable(),
  /** Schedule codes the shipper approved for this load (e.g. `LUMPER` with a receipt). */
  authorizedAccessorials: z.array(Text),
});
export type ShipmentEvidence = z.infer<typeof ShipmentEvidence>;

/** Fuel terms: none, a fixed percent of linehaul, a rate per mile, or a public-index fuel table (step 7). */
export const FuelTerms = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('none'), clause: Text }),
  z.strictObject({ type: z.literal('percent'), percent: Money, clause: Text }),
  z.strictObject({ type: z.literal('per_mile'), ratePerMile: Money, clause: Text }),
  /** `tableId` refers to the case's fuel table (an `FscTableSpec`); the price series comes with the case. */
  z.strictObject({ type: z.literal('table'), tableId: Text, clause: Text }),
]);
export type FuelTerms = z.infer<typeof FuelTerms>;

export const Lane = z.strictObject({
  id: Text,
  origin: Text,
  destination: Text,
  mode: z.enum(['TL', 'LTL']),
  /** TL: flat linehaul per load. */
  linehaul: Money.nullable(),
  /** LTL: rate per hundredweight by class. */
  ratePerCwt: z.record(z.string(), Money).nullable(),
  /** LTL: freight-all-kinds class the contract rates at, or null to rate at the BOL class. */
  fakClass: Text.nullable(),
  minimumCharge: Money.nullable(),
  clause: Text,
});
export type Lane = z.infer<typeof Lane>;

export const AccessorialTerm = z.strictObject({
  code: Text,
  names: z.array(Text).min(1),
  /** Maximum amount per occurrence (null: no cap). */
  maxAmount: Money.nullable(),
  /** Needs a per-load approval in `ShipmentEvidence.authorizedAccessorials`. */
  requiresAuthorization: z.boolean(),
  clause: Text,
});
export type AccessorialTerm = z.infer<typeof AccessorialTerm>;

export const DetentionTerms = z.strictObject({ freeHours: Money, ratePerHour: Money, maxHours: Money.nullable(), clause: Text });
export type DetentionTerms = z.infer<typeof DetentionTerms>;

/** A carrier contract / tariff the shipper is billed under. */
export const Contract = z.strictObject({
  id: Text,
  carrier: Text,
  effectiveFrom: DateText,
  effectiveTo: DateText,
  lanes: z.array(Lane).min(1),
  fuel: FuelTerms,
  accessorials: z.array(AccessorialTerm),
  detention: DetentionTerms.nullable(),
  /** Reweigh adjustments are payable only with a certificate. */
  reweighRequiresCertificate: z.boolean(),
  /** Days after the invoice date in which an overcharge claim must be filed. */
  claimWindowDays: z.number().int().min(1).max(3650),
});
export type Contract = z.infer<typeof Contract>;

export const LineCode = z.strictObject({
  line: z.number().int().min(0),
  code: Text.nullable(),
  by: z.enum(['code', 'keyword', 'classifier', 'llm', 'none']),
});
export type LineCode = z.infer<typeof LineCode>;

/** Contract and tariff agent output: the terms that apply to one invoice, each with its clause. */
export const AppliedTerms = z.strictObject({
  contractId: Text,
  lane: Lane.nullable(),
  fuel: FuelTerms,
  accessorials: z.array(AccessorialTerm),
  /** Accessorial invoice lines mapped to schedule codes (null code: not on the schedule). */
  lineCodes: z.array(LineCode),
  detention: DetentionTerms.nullable(),
  reweighRequiresCertificate: z.boolean(),
  claimDeadline: DateText,
  warnings: z.array(Text),
});
export type AppliedTerms = z.infer<typeof AppliedTerms>;

/** A finding of the audit checks, enriched by the evidence agent. */
export const AuditFinding = z.strictObject({
  id: Text,
  ruleId: Text,
  title: Text,
  direction: z.enum(['overcharge', 'underbilled']),
  amount: Money,
  /** What the contract supports for the cited lines and what was billed (`billed - expected = amount`). */
  expected: Money.nullable(),
  billed: Money.nullable(),
  /** Invoice line indices the finding rests on. */
  lines: z.array(z.number().int().min(0)),
  citations: z.array(z.string()),
  calculation: z.array(z.string()),
  explanation: z.string(),
  confidence: z.number().min(0).max(1),
  needsHumanReview: z.boolean(),
});
export type AuditFinding = z.infer<typeof AuditFinding>;

export const ReviewStatus = z.enum(['confirmed', 'needs_review', 'rejected']);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

/** Reviewer agent output for one finding. */
export const ReviewVerdict = z.strictObject({
  findingId: Text,
  status: ReviewStatus,
  reasons: z.array(z.string()),
  by: z.enum(['deterministic', 'llm']),
});
export type ReviewVerdict = z.infer<typeof ReviewVerdict>;

/** Evidence and claim agent output: one draft claim per invoice. */
export const ClaimDraft = z.strictObject({
  invoiceNumber: Text,
  carrier: Text,
  claimDeadline: DateText,
  windowOpen: z.boolean(),
  confirmedTotal: Money,
  pendingReviewTotal: Money,
  findingIds: z.array(Text),
  letter: z.string(),
});
export type ClaimDraft = z.infer<typeof ClaimDraft>;

/** JSON Schemas of the agent contracts (for `.claude/agents/*.md` and LLM structured output). */
export function agentJsonSchemas(): Record<string, unknown> {
  return {
    NormalizedInvoice: z.toJSONSchema(NormalizedInvoice),
    ShipmentEvidence: z.toJSONSchema(ShipmentEvidence),
    Contract: z.toJSONSchema(Contract),
    AppliedTerms: z.toJSONSchema(AppliedTerms),
    AuditFinding: z.toJSONSchema(AuditFinding),
    ReviewVerdict: z.toJSONSchema(ReviewVerdict),
    ClaimDraft: z.toJSONSchema(ClaimDraft),
  };
}