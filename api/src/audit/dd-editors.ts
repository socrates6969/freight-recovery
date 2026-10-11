/**
 * Step 8 fix round 3 (review F1/F2, spec A3.2 item 4, C14): the invoice editors of OCEAN_DD claims, read from
 * the tenant audit chain inside the caller's tenant transaction (RLS applies to both tables). An invoice
 * editor is the actor of any `dd_invoice.created` or `dd_invoice.updated` event that targets the
 * `dd_invoices` row linked to the claim: the creator, every intermediate editor and the last editor. Running
 * the audit is not an editor event. Fix round 4 (re-review R1): defence in depth, the set also contains the
 * invoice row's created_by_id and updated_by_id (the audit run never writes updated_by_id). One query per
 * call (the approval queue calls it once per page).
 */
import { unwrapRawTx, type TenantTx } from '../db/tenant.js';
import { assertUuid } from '../db/errors.js';

/** Claim id -> the user ids of its D&D invoice editors (claims without a D&D invoice are absent). */
export async function ddInvoiceEditorsByClaim(tx: TenantTx, claimIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (claimIds.length === 0) return out;
  for (const id of claimIds) assertUuid(id, 'claimId');
  const raw = unwrapRawTx(tx);
  const ids = [...claimIds];
  const rows = await raw.$queryRaw<{ claim_id: string; actor_id: string }[]>`
    SELECT i.claim_id::text AS claim_id, e.actor_id::text AS actor_id
    FROM dd_invoices i
    JOIN audit_events e
      ON e.tenant_id = i.tenant_id
     AND e.target_type = 'dd_invoice'
     AND e.target_id = i.id::text
     AND e.action IN ('dd_invoice.created', 'dd_invoice.updated')
    WHERE i.claim_id = ANY(${ids}::uuid[])
      AND e.actor_id IS NOT NULL
    UNION
    SELECT i.claim_id::text, i.created_by_id::text FROM dd_invoices i WHERE i.claim_id = ANY(${ids}::uuid[])
    UNION
    SELECT i.claim_id::text, i.updated_by_id::text FROM dd_invoices i WHERE i.claim_id = ANY(${ids}::uuid[])`;
  for (const r of rows) {
    const set = out.get(r.claim_id) ?? new Set<string>();
    set.add(r.actor_id);
    out.set(r.claim_id, set);
  }
  return out;
}
