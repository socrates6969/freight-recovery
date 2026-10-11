/**
 * Step 5 analysis routes (Part C P2): strict request bodies and response DTOs of
 * `POST /api/v1/claims/:id/analyze` and `POST /api/v1/claims/analyze-awaiting`.
 */
import { z } from 'zod';

import { EmptyBody } from './dto.js';

/** Bulk batch bounds (policy D9). */
export const ANALYZE_BATCH_MAX = 25;
export const ANALYZE_BATCH_DEFAULT = 10;

/** Single analyze takes no input (an absent body is treated as `{}`). */
export const AnalyzeBody = EmptyBody;

export const BulkAnalyzeBody = z.strictObject({
  limit: z.int().min(1).max(ANALYZE_BATCH_MAX).default(ANALYZE_BATCH_DEFAULT),
});

const uuid = z.uuid();
const cents = z.int().min(0);

export const AnalyzeResponse = z.object({
  claim: z.object({
    id: uuid,
    status: z.literal('PENDING_REVIEW'),
    recoverableCents: cents,
    pendingReviewCents: cents,
    amountClaimedCents: cents,
  }),
  packet: z.object({ id: uuid, revision: z.literal(1), status: z.literal('PENDING_REVIEW'), contentHash: z.string().regex(/^[0-9a-f]{64}$/u) }),
  analysis: z.object({
    rulesVersion: z.literal('rules-v1'),
    findingsCount: z.int().min(0),
    pendingFindingsCount: z.int().min(0),
    ignoredFindingsCount: z.int().min(0),
    // Step 6 (REQ-20261011-charge-intelligence, C6): null when the charge-suggestions flag is off.
    classifierVersion: z.literal('charge-knn-v1').nullable(),
    learnedFindingsCount: z.int().min(0),
    reviewFlagsCount: z.int().min(0),
  }),
});
export type AnalyzeResponseDto = z.infer<typeof AnalyzeResponse>;

export const BulkAnalyzeResponse = z.object({
  limit: z.int().min(1).max(ANALYZE_BATCH_MAX),
  examined: z.int().min(0),
  analyzed: z.array(
    z.object({
      claimId: uuid,
      claimNumber: z.string(),
      packetId: uuid,
      findingsCount: z.int().min(0),
      recoverableCents: cents,
      pendingReviewCents: cents,
    }),
  ),
  skipped: z.array(z.object({ claimId: uuid, claimNumber: z.string(), code: z.literal('invalid_state') })),
  failed: z.array(z.object({ claimId: uuid, claimNumber: z.string(), code: z.literal('analysis_input_invalid') })),
  remaining: z.int().min(0),
});
export type BulkAnalyzeResponseDto = z.infer<typeof BulkAnalyzeResponse>;
