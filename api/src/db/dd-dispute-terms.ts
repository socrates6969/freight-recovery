/**
 * REQ-20261020-dd-deadline: the dispute terms of OCEAN_DD claims, read inside the caller's tenant transaction
 * (RLS applies; the tenant id is also matched explicitly). Returns per claim the claim's invoice date as a UTC
 * `YYYY-MM-DD` and the request window the linked D&D invoice states (`data.disputeRequestDays`, read with a
 * JSON-path expression so the invoice document is never loaded). Claims without a linked invoice are absent.
 * One query per call (the claims list calls it once per page).
 */
import { assertUuid } from './errors.js';
import { unwrapRawTx, type TenantTx } from './tenant.js';

export interface DdDisputeTermsRow {
  invoiceDate: string | null;
  statedDays: number | null;
}

/** Claim id -> dispute terms (OCEAN_DD claims with a linked D&D invoice only). */
export async function ddDisputeTermsByClaim(tx: TenantTx, claimIds: readonly string[]): Promise<Map<string, DdDisputeTermsRow>> {
  const out = new Map<string, DdDisputeTermsRow>();
  if (claimIds.length === 0) return out;
  for (const id of claimIds) assertUuid(id, 'claimId');
  const raw = unwrapRawTx(tx);
  const ids = [...claimIds];
  const rows = await raw.$queryRaw<{ claim_id: string; invoice_day: string | null; stated_days: number | null }[]>`
    SELECT c.id::text AS claim_id,
           to_char((c.invoice_date AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS invoice_day,
           CASE WHEN jsonb_typeof(i.data->'disputeRequestDays') = 'number' THEN (i.data->>'disputeRequestDays')::int END AS stated_days
    FROM claims c
    JOIN dd_invoices i ON i.claim_id = c.id AND i.tenant_id = c.tenant_id
    WHERE c.tenant_id = fr_current_tenant() AND c.kind = 'OCEAN_DD' AND c.id = ANY(${ids}::uuid[])`;
  for (const r of rows) out.set(r.claim_id, { invoiceDate: r.invoice_day, statedDays: r.stated_days === null ? null : Number(r.stated_days) });
  return out;
}