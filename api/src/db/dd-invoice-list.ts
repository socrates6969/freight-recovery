/**
 * Step 8 fix round 1 (S1): the D&D invoice list page without loading `data` or `audit_snapshot`. The two
 * values the list needs from the JSON (direction, container count) are read with JSON-path expressions, so a
 * page of up to 50 invoices never transfers or parses the full invoice documents. Runs inside the caller's
 * tenant transaction (RLS applies); the tenant id is also matched explicitly (defence in depth).
 */
import { Prisma } from './client.js';
import { assertUuid } from './errors.js';
import { unwrapRawTx, type TenantTx } from './tenant.js';

export interface DdInvoiceListRow {
  id: string;
  status: string;
  version: number;
  invoiceNumber: string;
  billingPartyName: string;
  /** `YYYY-MM-DD` or null. */
  invoiceDate: string | null;
  totalDueCents: number | null;
  /** `data->>'direction'` (validated by the caller). */
  direction: string | null;
  /** Length of `data->'containers'` when it is an array, else null. */
  containerCount: number | null;
  claimId: string | null;
  /** ISO 8601 UTC timestamps. */
  auditedAt: string | null;
  updatedAt: string;
}

interface RawRow {
  id: string;
  status: string;
  version: number;
  invoice_number: string;
  billing_party_name: string;
  invoice_date: string | null;
  total_due_cents: number | null;
  direction: string | null;
  container_count: number | null;
  claim_id: string | null;
  audited_at: string | null;
  updated_at: string;
}

const ISO = 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';

export async function listDdInvoiceRows(
  tx: TenantTx,
  tenantId: string,
  opts: { status: 'DRAFT' | 'AUDITED' | undefined; limit: number; offset: number },
): Promise<DdInvoiceListRow[]> {
  assertUuid(tenantId, 'tenantId');
  if (!Number.isSafeInteger(opts.limit) || opts.limit < 1 || !Number.isSafeInteger(opts.offset) || opts.offset < 0) throw new RangeError('bad page');
  const raw = unwrapRawTx(tx);
  const status = opts.status === undefined ? Prisma.empty : Prisma.sql`AND status = ${opts.status}`;
  const rows = await raw.$queryRaw<RawRow[]>`
    SELECT id::text AS id, status, version, invoice_number, billing_party_name,
           to_char(invoice_date, 'YYYY-MM-DD') AS invoice_date, total_due_cents,
           data->>'direction' AS direction,
           CASE WHEN jsonb_typeof(data->'containers') = 'array' THEN jsonb_array_length(data->'containers') END AS container_count,
           claim_id::text AS claim_id,
           to_char(audited_at AT TIME ZONE 'UTC', ${ISO}) AS audited_at,
           to_char(updated_at AT TIME ZONE 'UTC', ${ISO}) AS updated_at
    FROM dd_invoices
    WHERE tenant_id = ${tenantId}::uuid ${status}
    ORDER BY dd_invoices.updated_at DESC, dd_invoices.id ASC
    LIMIT ${opts.limit} OFFSET ${opts.offset}`;
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    version: r.version,
    invoiceNumber: r.invoice_number,
    billingPartyName: r.billing_party_name,
    invoiceDate: r.invoice_date,
    totalDueCents: r.total_due_cents,
    direction: r.direction,
    containerCount: r.container_count,
    claimId: r.claim_id,
    auditedAt: r.audited_at,
    updatedAt: r.updated_at,
  }));
}
