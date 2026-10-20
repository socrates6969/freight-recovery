/**
 * Hardening (REQ-20261012-hardening, C4.3): the failed analyses of a claim, read from the tenant audit chain
 * inside the caller's tenant transaction (RLS applies; tenant_id is also matched explicitly). Uses the
 * `(tenant_id, target_type, target_id)` index of migration 20261017000000_audit_target_index. One query.
 */
import { ANALYSIS_FAILURE_REASONS, isAnalysisFailureReason, type AnalysisFailureReason } from '@fr/shared';

import { assertUuid } from '../db/errors.js';
import type { InsightsFilter, InsightsPeriod } from '../db/insights.js';
import { unwrapRawTx, type TenantTx } from '../db/tenant.js';

export interface AnalysisFailureSummary {
  lastFailedAt: Date;
  /** The latest event's reason; an unknown stored value reads as `input_values`. */
  reasonCode: AnalysisFailureReason;
  failedAttempts: number;
}

/** Latest `claim.analysis_failed` event of the claim and the number of such events; null when there is none. */
export async function analysisFailureOf(tx: TenantTx, claimId: string): Promise<AnalysisFailureSummary | null> {
  assertUuid(claimId, 'claimId');
  const raw = unwrapRawTx(tx);
  const id = claimId.toLowerCase();
  const rows = await raw.$queryRaw<{ created_at: Date; reason_code: string | null; attempts: number }[]>`
    SELECT e.created_at, e.metadata ->> 'reasonCode' AS reason_code, count(*) OVER ()::int AS attempts
    FROM audit_events e
    WHERE e.tenant_id = fr_current_tenant()
      AND e.target_type = 'claim'
      AND e.target_id = ${id}
      AND e.action = 'claim.analysis_failed'
    ORDER BY e.seq DESC
    LIMIT 1`;
  const r = rows[0];
  if (!r || r.attempts < 1) return null;
  return {
    lastFailedAt: r.created_at,
    reasonCode: isAnalysisFailureReason(r.reason_code) ? r.reason_code : 'input_values',
    failedAttempts: r.attempts,
  };
}

export interface AnalysisFailureCounts {
  total: number;
  /** All three reasons in ANALYSIS_FAILURE_REASONS order. */
  byReason: { reasonCode: AnalysisFailureReason; count: number }[];
}

/**
 * REQ-20261018-exec-dashboard (S4): `claim.analysis_failed` events of this tenant's chain in [from, to),
 * restricted to claims passing the kind/perspective filter, grouped by reason. An unknown or null stored
 * reason counts as `input_values`, as in `analysisFailureOf`. One query in the caller's transaction.
 */
export async function analysisFailureCounts(tx: TenantTx, period: InsightsPeriod, filters: InsightsFilter): Promise<AnalysisFailureCounts> {
  if (Number.isNaN(period.from.getTime()) || Number.isNaN(period.to.getTime()) || period.from >= period.to) throw new RangeError('invalid period');
  if (filters.kind !== null && filters.kind !== 'FREIGHT' && filters.kind !== 'OCEAN_DD') throw new RangeError('invalid kind');
  if (filters.perspective !== null && filters.perspective !== 'SHIPPER' && filters.perspective !== 'CARRIER') throw new RangeError('invalid perspective');
  const raw = unwrapRawTx(tx);
  const rows = await raw.$queryRaw<{ reason_code: string | null; n: number }[]>`
    SELECT e.metadata ->> 'reasonCode' AS reason_code, count(*)::int AS n
    FROM audit_events e
    JOIN claims c ON c.id::text = e.target_id AND c.tenant_id = e.tenant_id
    WHERE e.tenant_id = fr_current_tenant()
      AND e.target_type = 'claim'
      AND e.action = 'claim.analysis_failed'
      AND e.created_at >= ${period.from}::timestamptz
      AND e.created_at < ${period.to}::timestamptz
      AND (${filters.kind}::text IS NULL OR c.kind = ${filters.kind}::text::"ClaimKind")
      AND (${filters.perspective}::text IS NULL OR c.perspective = ${filters.perspective}::text::"Perspective")
    GROUP BY 1`;
  const counts = new Map<AnalysisFailureReason, number>(ANALYSIS_FAILURE_REASONS.map((r) => [r, 0]));
  for (const r of rows) {
    const reason = isAnalysisFailureReason(r.reason_code) ? r.reason_code : 'input_values';
    if (!Number.isSafeInteger(r.n) || r.n < 0) throw new RangeError('count out of range');
    counts.set(reason, (counts.get(reason) ?? 0) + r.n);
  }
  const byReason = ANALYSIS_FAILURE_REASONS.map((reasonCode) => ({ reasonCode, count: counts.get(reasonCode) ?? 0 }));
  return { total: byReason.reduce((s, r) => s + r.count, 0), byReason };
}
