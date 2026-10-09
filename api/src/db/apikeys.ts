/** Serializes per-tenant API key creation so concurrent creates cannot exceed API_KEY_MAX_ACTIVE. */
import { unwrapRawTx, type TenantTx } from './tenant.js';

export async function lockTenantApiKeys(tx: TenantTx, tenantId: string): Promise<void> {
  const raw = unwrapRawTx(tx);
  await raw.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`apikeys:${tenantId}`}, 0))`;
}
