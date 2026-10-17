/**
 * Claim numbers for claims created from imports (A9.3): `CLM-%04d`, one more than the highest numeric
 * suffix of the tenant's `CLM-<digits>` numbers (seeded numbers such as CLM-0024 and the CLM-HOSTILE-*
 * names are respected). Serialized per tenant with a transaction-scoped advisory lock, so concurrent
 * commits never compute the same number. Must run inside the caller's tenant transaction.
 */
import { unwrapRawTx, type TenantTx } from './tenant.js';

export async function nextClaimNumber(tx: TenantTx, tenantId: string): Promise<string> {
  const raw = unwrapRawTx(tx);
  await raw.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`claimno:${tenantId}`}, 0))`;
  const rows = await raw.$queryRaw<{ m: bigint | null }[]>`
    SELECT MAX(substring(claim_number FROM 5)::bigint) AS m FROM claims WHERE claim_number ~ '^CLM-[0-9]{4,}$'`;
  const next = (rows[0]?.m ?? 0n) + 1n;
  return `CLM-${next.toString().padStart(4, '0')}`;
}
