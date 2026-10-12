/**
 * Hardening (REQ-20261012-hardening, C3): the team labels that influenced a claim's analysis, i.e. the
 * `learnedLabelIds` of the claim's `claim.analyzed` event (tenant chain). Runs inside the caller's tenant
 * transaction (RLS applies; tenant_id is also matched explicitly). One query.
 */
import { assertUuid, isUuid } from '../db/errors.js';
import { unwrapRawTx, type TenantTx } from '../db/tenant.js';

/** Upper bound of the stored influence list (the analysis records at most 50 label ids). */
export const LEARNED_LABEL_IDS_MAX = 50;

/**
 * The label ids recorded by the claim's `claim.analyzed` event, in stored order (only uuid strings, at most
 * LEARNED_LABEL_IDS_MAX); null when the claim has no such event.
 */
export async function learnedLabelIdsOfClaim(tx: TenantTx, claimId: string): Promise<string[] | null> {
  assertUuid(claimId, 'claimId');
  const raw = unwrapRawTx(tx);
  const rows = await raw.$queryRaw<{ ids: unknown }[]>`
    SELECT e.metadata -> 'learnedLabelIds' AS ids
    FROM audit_events e
    WHERE e.tenant_id = fr_current_tenant()
      AND e.target_type = 'claim'
      AND e.target_id = ${claimId.toLowerCase()}
      AND e.action = 'claim.analyzed'
    ORDER BY e.seq DESC
    LIMIT 1`;
  const row = rows[0];
  if (!row) return null;
  if (!Array.isArray(row.ids)) return [];
  const out: string[] = [];
  for (const v of row.ids) {
    if (out.length >= LEARNED_LABEL_IDS_MAX) break;
    if (!isUuid(v)) continue;
    out.push(v.toLowerCase());
  }
  return out;
}
