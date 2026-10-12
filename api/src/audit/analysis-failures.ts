/**
 * Hardening (REQ-20261012-hardening, C4.3): the failed analyses of a claim, read from the tenant audit chain
 * inside the caller's tenant transaction (RLS applies; tenant_id is also matched explicitly). Uses the
 * `(tenant_id, target_type, target_id)` index of migration 20261017000000_audit_target_index. One query.
 */
import { isAnalysisFailureReason, type AnalysisFailureReason } from '@fr/shared';

import { assertUuid } from '../db/errors.js';
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
