/**
 * Step 8 (REQ-20261011-ocean-dd): locks of the D&D routes, inside the caller's tenant transaction (raw SQL is
 * confined to db/**; RLS applies).
 * - `lockDdInvoiceForUpdate`: row lock of one invoice (`SELECT ... FOR UPDATE`) so updates, deletes and the
 *   audit run serialize; false when the row is not visible (unknown id or another tenant).
 * - `lockDdCatalog`: per-tenant advisory lock so the cap check (count) and the insert of POST /dd/tariffs or
 *   POST /dd/calendars cannot interleave (same pattern as charge-label-locks.ts).
 */
import { assertUuid } from './errors.js';
import { advisoryXactLock } from './import-locks.js';
import { unwrapRawTx, type TenantTx } from './tenant.js';

export async function lockDdInvoiceForUpdate(tx: TenantTx, id: string): Promise<boolean> {
  assertUuid(id, 'invoiceId');
  const raw = unwrapRawTx(tx);
  const rows = await raw.$queryRaw<{ id: string }[]>`SELECT id FROM dd_invoices WHERE id = ${id}::uuid FOR UPDATE`;
  return rows.length === 1;
}

export async function lockDdCatalog(tx: TenantTx, tenantId: string, kind: 'tariffs' | 'calendars'): Promise<void> {
  assertUuid(tenantId, 'tenantId');
  await advisoryXactLock(tx, `dd:${kind}:${tenantId}`);
}
