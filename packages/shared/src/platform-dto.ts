/**
 * Step 4 platform contract (Q3, Q5): strict request schemas for R60-R68 and strict response schemas for
 * the Dev dashboard. Responses carry aggregates and telemetry only. The API parses every outgoing body
 * with these schemas (fail closed on drift) and the web parses every incoming body with them.
 */
import { z } from 'zod';

import { singleLine } from './dto.js';

const intFromQuery = z.coerce.number().int();
const iso = z.string();
const count = z.int().min(0);

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

export const PIPELINE_WINDOWS = ['1h', '24h', '7d'] as const;
export type PipelineWindow = (typeof PIPELINE_WINDOWS)[number];
export const PIPELINE_WINDOW_SECONDS: Readonly<Record<PipelineWindow, number>> = Object.freeze({ '1h': 3600, '24h': 86400, '7d': 604800 });

export const PipelineQuery = z.strictObject({ window: z.enum(PIPELINE_WINDOWS).default('24h') });

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevelName = (typeof LOG_LEVELS)[number];

export const LogsQuery = z.strictObject({
  level: z.enum(LOG_LEVELS).default('info'),
  limit: intFromQuery.min(1).max(200).default(100),
  requestId: z.uuid().optional(),
});

export const FlagParams = z.strictObject({ key: z.string().min(1).max(64) });
export const FLAG_REASON_MIN = 10;
export const FLAG_REASON_MAX = 500;
export const FlagChangeBody = z.strictObject({
  enabled: z.boolean(),
  expectedVersion: z.int().min(0),
  reason: singleLine(FLAG_REASON_MIN, FLAG_REASON_MAX),
});

export const EvalRunsQuery = z.strictObject({ limit: intFromQuery.min(1).max(50).default(20) });

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export const PipelineHealth = z.strictObject({
  scope: z.literal('all_tenants_aggregate'),
  window: z.enum(PIPELINE_WINDOWS),
  generatedAt: iso,
  version: z.string(),
  db: z.enum(['ok', 'down']),
  documents: z.strictObject({
    total: count,
    byStatus: z.strictObject({ RECEIVED: count, NEEDS_REVIEW: count, ACCEPTED: count, REJECTED: count, FAILED: count }),
    byDetectedType: z.strictObject({ PDF: count, PNG: count, JPEG: count, CSV: count, TXT: count }),
    rejectedByReason: z.array(z.strictObject({ reason: z.string().max(64), count })),
  }),
  rates: z.strictObject({ rejected: z.number().nullable(), failed: z.number().nullable(), needsReview: z.number().nullable() }),
  uploadToParseMs: z.strictObject({ n: count, p50: z.number().nullable(), p95: z.number().nullable() }),
  reviewQueue: z.strictObject({ depth: count, oldestWaitingSeconds: count.nullable() }),
  staleReceived: count,
  claims: z.strictObject({ awaitingAnalysis: count }),
});
export type PipelineHealthDto = z.infer<typeof PipelineHealth>;

/** Duration bucket upper bounds in ms (null = +Infinity). */
export const DURATION_BUCKET_BOUNDS: readonly (number | null)[] = Object.freeze([5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, null]);

export const DurationBucket = z.strictObject({ leMs: z.number().nullable(), count });
const statusClasses = z.strictObject({ '2xx': count, '3xx': count, '4xx': count, '5xx': count });

export const RouteStat = z.strictObject({
  method: z.string().max(16),
  route: z.string().max(200),
  count,
  byStatusClass: statusClasses,
  durationBuckets: z.array(DurationBucket).length(DURATION_BUCKET_BOUNDS.length),
  p50UpperBoundMs: z.number().nullable(),
  p95UpperBoundMs: z.number().nullable(),
});
export type RouteStatDto = z.infer<typeof RouteStat>;

export const COMPONENT_IDS = ['priority-v1', 'similar-v1'] as const;
export type ComponentId = (typeof COMPONENT_IDS)[number];

export const ComponentStat = z.strictObject({
  id: z.enum(COMPONENT_IDS),
  method: z.literal('fixed_rules'),
  learnedModel: z.literal(false),
  enabled: z.boolean(),
  calls: count,
  errors: count,
  durationBuckets: z.array(DurationBucket).length(DURATION_BUCKET_BOUNDS.length),
  p50UpperBoundMs: z.number().nullable(),
  p95UpperBoundMs: z.number().nullable(),
  avgCandidatesConsidered: z.number().nullable(),
});
export type ComponentStatDto = z.infer<typeof ComponentStat>;

export const Telemetry = z.strictObject({
  scope: z.literal('this_instance_since_start'),
  generatedAt: iso,
  instance: z.strictObject({ startedAt: iso, uptimeSeconds: count, version: z.string(), nodeVersion: z.string() }),
  requests: z.strictObject({ total: count, byStatusClass: statusClasses, unauthenticated401: count, forbidden403: count, rateLimited429: count }),
  routes: z.array(RouteStat).max(200),
  parser: z.strictObject({
    jobs: count,
    succeeded: count,
    rejected: count,
    timeouts: count,
    memoryKills: count,
    failures: count,
    busyRejections: count,
    avgQueueWaitMs: z.number().nullable(),
  }),
  components: z.array(ComponentStat).length(COMPONENT_IDS.length),
});
export type TelemetryDto = z.infer<typeof Telemetry>;

export const LogRecord = z.strictObject({
  time: iso,
  level: z.enum(LOG_LEVELS),
  requestId: z.string().nullable(),
  method: z.string().nullable(),
  route: z.string().nullable(),
  statusCode: z.int().nullable(),
  durationMs: z.number().nullable(),
  event: z.string().max(80),
});
export type LogRecordDto = z.infer<typeof LogRecord>;

export const LogView = z.strictObject({
  scope: z.literal('this_instance_recent_window'),
  bufferCapacity: count,
  returned: count,
  oldestTime: iso.nullable(),
  items: z.array(LogRecord),
});
export type LogViewDto = z.infer<typeof LogView>;

export const FeatureFlag = z.strictObject({
  key: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  defaultEnabled: z.boolean(),
  tenantVisible: z.boolean(),
  version: z.int().min(1),
  updatedAt: iso.nullable(),
  updatedBy: z.strictObject({ id: z.string(), name: z.string() }).nullable(),
  lastReason: z.string().nullable(),
});
export type FeatureFlagDto = z.infer<typeof FeatureFlag>;
export const FeatureFlagList = z.strictObject({ items: z.array(FeatureFlag) });

export const EVAL_FAILURE_CODES = [
  'field_mismatch',
  'missing_field',
  'unexpected_field',
  'wrong_doc_type',
  'not_rejected',
  'wrong_reject_reason',
  'unexpected_reject',
  'timeout',
  'infrastructure',
] as const;
export type EvalFailureCode = (typeof EVAL_FAILURE_CODES)[number];

const rate = z.number().min(0).max(1);

const evalSummaryShape = {
  basis: z.literal('synthetic_fixtures'),
  evalSetId: z.string(),
  evalSetVersion: z.string(),
  evalSetSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  stage: z.literal('extraction'),
  k: z.int().min(1).max(20),
  startedAt: iso,
  finishedAt: iso,
  gitSha: z.string().nullable(),
  providerName: z.string(),
  providerVersion: z.string(),
  parserVersion: z.string(),
  cases: z.int().min(1),
  runsTotal: count,
  runsPassed: count,
  perRunPassRate: rate,
  passHatKCount: count,
  passHatK: rate,
  passAtLeastOneCount: count,
  flakyCaseCount: count,
  alwaysFailCount: count,
  deterministicCases: count,
  wilson95: z.strictObject({ low: rate, high: rate }),
  passPowCurve: z.array(rate),
  durationMs: z.strictObject({ p50: z.number().min(0), p95: z.number().min(0) }),
};

export const EvalCaseResult = z.strictObject({
  caseId: z.string(),
  category: z.string(),
  runsPassed: count,
  k: z.int().min(1),
  passedAll: z.boolean(),
  distinctOutputs: z.int().min(1),
  firstFailureCode: z.enum(EVAL_FAILURE_CODES).nullable(),
  medianDurationMs: z.number().min(0),
});
export type EvalCaseResultDto = z.infer<typeof EvalCaseResult>;

export const EvalRunSummary = z.strictObject({ id: z.string(), ...evalSummaryShape });
export type EvalRunSummaryDto = z.infer<typeof EvalRunSummary>;
export const EvalRunDetail = z.strictObject({ id: z.string(), ...evalSummaryShape, results: z.array(EvalCaseResult) });
export type EvalRunDetailDto = z.infer<typeof EvalRunDetail>;
export const EvalRunList = z.strictObject({ items: z.array(EvalRunSummary) });
/** CLI `--json` output: the summary without `id`, plus the per-case results. */
export const EvalReport = z.strictObject({ ...evalSummaryShape, results: z.array(EvalCaseResult) });
export type EvalReportDto = z.infer<typeof EvalReport>;

export const PlatformAuditEvent = z.strictObject({
  seq: z.int(),
  id: z.string(),
  actor: z.strictObject({ id: z.string(), role: z.string() }).nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  requestId: z.string().nullable(),
  createdAt: iso,
  prevHash: z.string(),
  hash: z.string(),
});
export const PlatformAuditPage = z.strictObject({ items: z.array(PlatformAuditEvent), nextBefore: z.int().nullable() });
export const PlatformAuditVerify = z.strictObject({ valid: z.boolean(), eventsChecked: count, brokenAtSeq: z.int().nullable() });
