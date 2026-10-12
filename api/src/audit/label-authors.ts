/**
 * Hardening (REQ-20261012-hardening, C1, residual SC-1): the label authors of claims, read from the tenant
 * audit chain inside the caller's tenant transaction (RLS applies to both tables; tenant_id is also matched
 * explicitly). For each claim's `claim.analyzed` event A with label ids L = A.metadata.learnedLabelIds, the
 * label authors are the non-null actors of `charge_label.set` events targeting a label in L with seq < A.seq,
 * plus the created_by_id of each still-existing label in L. Mirrors part (b) of the database trigger
 * `fr_approval_four_eyes_ext_guard` (migration 20261018000000_hardening). One query per call.
 */
import { assertUuid } from '../db/errors.js';
import { unwrapRawTx, type TenantTx } from '../db/tenant.js';

/** Claim id -> the user ids of its label authors (claims without label authors are absent). */
export async function labelAuthorsByClaim(tx: TenantTx, claimIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (claimIds.length === 0) return out;
  for (const id of claimIds) assertUuid(id, 'claimId');
  const raw = unwrapRawTx(tx);
  const ids = claimIds.map((id) => id.toLowerCase());
  const rows = await raw.$queryRaw<{ claim_id: string; actor_id: string }[]>`
    WITH influence AS (
      SELECT a.target_id AS claim_id, a.tenant_id, a.seq, l.label_id
      FROM audit_events a
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(a.metadata -> 'learnedLabelIds') = 'array'
             THEN a.metadata -> 'learnedLabelIds' ELSE '[]'::jsonb END) AS l(label_id)
      WHERE a.tenant_id = fr_current_tenant()
        AND a.target_type = 'claim'
        AND a.target_id = ANY(${ids}::text[])
        AND a.action = 'claim.analyzed'
    )
    SELECT f.claim_id, s.actor_id::text AS actor_id
    FROM influence f
    JOIN audit_events s
      ON s.tenant_id = f.tenant_id
     AND s.target_type = 'charge_label'
     AND s.target_id = f.label_id
     AND s.action = 'charge_label.set'
     AND s.seq < f.seq
    WHERE s.actor_id IS NOT NULL
    UNION
    SELECT f.claim_id, c.created_by_id::text
    FROM influence f
    JOIN charge_labels c ON c.tenant_id = f.tenant_id AND c.id::text = f.label_id`;
  for (const r of rows) {
    const set = out.get(r.claim_id) ?? new Set<string>();
    set.add(r.actor_id);
    out.set(r.claim_id, set);
  }
  return out;
}
