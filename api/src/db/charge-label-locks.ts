/**
 * Step 6 fix round 1 (S2): per-tenant transaction-scoped advisory lock for charge-label writers, so the
 * cap check (count) and the insert of PUT /charge-labels cannot interleave across concurrent requests.
 * Released at commit/rollback. Runs in the caller's tenant transaction (raw SQL is confined to db/**).
 */
import { assertUuid } from './errors.js';
import { advisoryXactLock } from './import-locks.js';
import type { TenantTx } from './tenant.js';

export async function lockChargeLabels(tx: TenantTx, tenantId: string): Promise<void> {
  assertUuid(tenantId, 'tenantId');
  await advisoryXactLock(tx, `charge-labels:${tenantId}`);
}
