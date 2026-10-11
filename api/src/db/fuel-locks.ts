/**
 * Step 7 (REQ-20261011-fuel-outlook, F14): per-tenant transaction-scoped advisory lock for fuel-table
 * creation, so the cap check (count) and the insert of POST /fuel-tables cannot interleave across concurrent
 * requests (same pattern as charge-label-locks.ts). Released at commit/rollback. Runs in the caller's
 * tenant transaction (raw SQL is confined to db/**).
 */
import { assertUuid } from './errors.js';
import { advisoryXactLock } from './import-locks.js';
import type { TenantTx } from './tenant.js';

export async function lockFscTables(tx: TenantTx, tenantId: string): Promise<void> {
  assertUuid(tenantId, 'tenantId');
  await advisoryXactLock(tx, `fsc-tables:${tenantId}`);
}
