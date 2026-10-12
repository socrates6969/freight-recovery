/**
 * Hardening (REQ-20261012-hardening, C5.1): the bulk-analysis candidates of the tenant. Same filter as before
 * (AWAITING_ANALYSIS, kind FREIGHT, at least one linked ACCEPTED document); claims WITHOUT a
 * `claim.analysis_failed` event come first, then oldest createdAt, then id. Runs inside the caller's tenant
 * transaction (RLS applies) and matches tenant_id explicitly (defence in depth). The failure lookup uses the
 * `(tenant_id, target_type, target_id)` audit index. `take` is a bound parameter.
 */
import { unwrapRawTx, type TenantTx } from './tenant.js';

export interface AnalysisCandidate {
  id: string;
  claimNumber: string;
}

/** Upper bound of `take` (the bulk scan cap is min(4 x limit, 100)). */
const MAX_TAKE = 100;

export async function analysisCandidates(tx: TenantTx, take: number): Promise<AnalysisCandidate[]> {
  if (!Number.isInteger(take) || take < 1 || take > MAX_TAKE) throw new RangeError('take out of range');
  const raw = unwrapRawTx(tx);
  const rows = await raw.$queryRaw<{ id: string; claim_number: string }[]>`
    SELECT c.id::text AS id, c.claim_number
    FROM claims c
    WHERE c.tenant_id = fr_current_tenant()
      AND c.status = 'AWAITING_ANALYSIS'
      AND c.kind = 'FREIGHT'
      AND EXISTS (SELECT 1
                    FROM claim_documents cd
                    JOIN import_documents d ON d.id = cd.document_id AND d.tenant_id = cd.tenant_id
                   WHERE cd.claim_id = c.id AND cd.tenant_id = c.tenant_id AND d.status = 'ACCEPTED')
    ORDER BY EXISTS (SELECT 1
                       FROM audit_events e
                      WHERE e.tenant_id = c.tenant_id AND e.target_type = 'claim'
                        AND e.target_id = c.id::text AND e.action = 'claim.analysis_failed') ASC,
             c.created_at ASC,
             c.id ASC
    LIMIT ${take}`;
  return rows.map((r) => ({ id: r.id, claimNumber: r.claim_number }));
}
