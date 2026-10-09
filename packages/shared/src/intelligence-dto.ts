/**
 * Step 4 Recovery Intelligence contract (Q3 R70-R73, Q6): strict query schemas and strict response
 * schemas. Every figure is computed from this tenant's own stored data by fixed, documented rules.
 */
import { z } from 'zod';

import { CLAIM_STATUSES, DOC_TYPES, PACKET_STATUSES, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, PERSPECTIVES, commaList } from './dto.js';
import { FIELD_STATUSES, IMPORT_DOC_STATUSES, IMPORT_DOC_TYPES } from './import-fields.js';

const intFromQuery = z.coerce.number().int();
const iso = z.string();
const count = z.int().min(0);
const cents = z.int().min(0);

// ---------------------------------------------------------------------------------------------
// Fixed policy (Q6)
// ---------------------------------------------------------------------------------------------

export const PRIORITY_VERSION = 'priority-v1';
export const SIMILAR_VERSION = 'similar-v1';
export const WORKLIST_STATUSES = ['PENDING_REVIEW', 'APPROVED'] as const;
export type WorklistStatus = (typeof WORKLIST_STATUSES)[number];
export const SIMILAR_CANDIDATE_STATUSES = ['APPROVED', 'SEND_READY', 'REJECTED'] as const;
export const SIMILARITY_WEIGHTS = Object.freeze({ sameCarrier: 35, sharedRules: 40, similarAmount: 15, samePerspective: 10 });
export const SIMILARITY_MIN_PERCENT = 30;
export const NEXT_ACTIONS = ['RESOLVE_FINDINGS', 'REVIEW_AND_APPROVE', 'MARK_SEND_READY'] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];
export const MATCH_KEYS = ['same_carrier', 'shared_rules', 'similar_amount', 'same_perspective'] as const;
export type MatchKey = (typeof MATCH_KEYS)[number];

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

export const WorklistQuery = z.strictObject({
  status: commaList(WORKLIST_STATUSES).default([...WORKLIST_STATUSES]),
  perspective: z.enum(PERSPECTIVES).optional(),
  page: intFromQuery.min(1).default(1),
  pageSize: intFromQuery.min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});
export type WorklistQueryInput = z.output<typeof WorklistQuery>;

export const SimilarQuery = z.strictObject({ limit: intFromQuery.min(1).max(10).default(5) });

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export const FeaturesResponse = z.strictObject({ flags: z.record(z.string(), z.boolean()) });
export type FeaturesResponseDto = z.infer<typeof FeaturesResponse>;

export const ScorePart = z.strictObject({
  key: z.enum(['confirmed_recoverable', 'pending_review']),
  inputCents: cents,
  weightPercent: z.int().min(0).max(100),
  contributionCents: cents,
});

export const WorklistItem = z.strictObject({
  rank: z.int().min(1),
  claim: z.strictObject({
    id: z.string(),
    claimNumber: z.string(),
    loadNumber: z.string().nullable(),
    carrierName: z.string(),
    perspective: z.enum(PERSPECTIVES),
    status: z.enum(CLAIM_STATUSES),
    recoverableCents: cents,
    pendingReviewCents: cents,
    currency: z.literal('USD'),
    assignee: z.strictObject({ id: z.string(), name: z.string() }).nullable(),
    latestPacket: z.strictObject({ revision: z.int().min(1), status: z.enum(PACKET_STATUSES) }),
  }),
  score: z.strictObject({ version: z.literal(PRIORITY_VERSION), valueCents: cents, parts: z.array(ScorePart).length(2) }),
  why: z.array(z.string()),
  nextAction: z.enum(NEXT_ACTIONS),
  pendingFindingsCount: count,
  waitingSince: iso,
  waitingDays: count,
});
export type WorklistItemDto = z.infer<typeof WorklistItem>;

export const Worklist = z.strictObject({
  generatedAt: iso,
  formula: z.strictObject({ version: z.literal(PRIORITY_VERSION), pendingWeightPercent: z.int().min(0).max(100) }),
  label: z.string(),
  notRanked: z.strictObject({ awaitingAnalysis: count }),
  items: z.array(WorklistItem),
  page: z.int().min(1),
  pageSize: z.int().min(1),
  total: count,
});
export type WorklistDto = z.infer<typeof Worklist>;

export const SimilarMatch = z.strictObject({ key: z.enum(MATCH_KEYS), points: z.int().min(1).max(40), detail: z.string() });

export const SimilarItem = z.strictObject({
  claim: z.strictObject({
    id: z.string(),
    claimNumber: z.string(),
    carrierName: z.string(),
    perspective: z.enum(PERSPECTIVES),
    status: z.enum(SIMILAR_CANDIDATE_STATUSES),
    recoverableCents: cents,
    pendingReviewCents: cents,
    updatedAt: iso,
  }),
  similarityPercent: z.int().min(SIMILARITY_MIN_PERCENT).max(100),
  matches: z.array(SimilarMatch),
  handling: z.strictObject({
    finalStatus: z.enum(SIMILAR_CANDIDATE_STATUSES),
    ruleIds: z.array(z.string()),
    sourceDocTypes: z.array(z.enum(DOC_TYPES)),
    findingCount: count,
    decidedAt: iso.nullable(),
  }),
});
export type SimilarItemDto = z.infer<typeof SimilarItem>;

export const SimilarResponse = z.strictObject({
  claimId: z.string(),
  version: z.literal(SIMILAR_VERSION),
  weights: z.strictObject({ sameCarrier: z.literal(35), sharedRules: z.literal(40), similarAmount: z.literal(15), samePerspective: z.literal(10) }),
  minPercent: z.literal(SIMILARITY_MIN_PERCENT),
  label: z.string(),
  reason: z.literal('no_packet').nullable(),
  candidatesConsidered: count,
  computeMs: z.number().min(0),
  items: z.array(SimilarItem),
});
export type SimilarResponseDto = z.infer<typeof SimilarResponse>;

const byFieldStatus = z.strictObject({ PROPOSED: count, CONFIRMED: count, CORRECTED: count, REJECTED: count });

export const ProvenanceDocument = z.strictObject({
  documentId: z.string(),
  displayName: z.string(),
  docType: z.enum(IMPORT_DOC_TYPES),
  status: z.enum(IMPORT_DOC_STATUSES),
  extractedFieldCount: count,
  manualFieldCount: count,
  byFieldStatus,
  unresolvedFlaggedCount: count,
  minConfidence: z.number().min(0).max(1).nullable(),
});
export type ProvenanceDocumentDto = z.infer<typeof ProvenanceDocument>;

export const Provenance = z.strictObject({
  claimId: z.string(),
  basis: z.literal('rule_based_parse_score'),
  label: z.string(),
  documents: z.array(ProvenanceDocument),
  totals: z.strictObject({
    documents: count,
    fields: count,
    manualFields: count,
    proposed: count,
    confirmed: count,
    corrected: count,
    rejected: count,
    unresolvedFlagged: count,
  }),
});
export type ProvenanceDto = z.infer<typeof Provenance>;

/** Field statuses in the order used by the provenance table. */
export const PROVENANCE_STATUSES = FIELD_STATUSES;
