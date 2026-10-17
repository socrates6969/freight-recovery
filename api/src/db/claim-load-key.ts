/**
 * Commit grouping (A9.4, fix round 1 D12): find the tenant's claims whose load number has the same
 * grouping key as an import group (NFKC, whitespace runs collapsed to one space, trimmed, upper-cased).
 * The SQL normalization is a pre-filter; the caller re-checks every candidate with the JS key
 * (`normalizeLoadNumber`), so database and JavaScript case-mapping differences can only cause a miss on
 * exotic characters, never a wrong match. Runs inside the caller's tenant transaction (RLS applies).
 */
import { unwrapRawTx, type TenantTx } from './tenant.js';

export async function findClaimIdsByLoadKey(tx: TenantTx, perspective: string, key: string): Promise<string[]> {
  const raw = unwrapRawTx(tx);
  const rows = await raw.$queryRaw<{ id: string }[]>`
    SELECT id FROM claims
    WHERE perspective::text = ${perspective}
      AND load_number IS NOT NULL
      AND upper(btrim(regexp_replace(normalize(load_number, NFKC), '[[:space:]]+', ' ', 'g'))) = ${key}
    ORDER BY created_at DESC, id DESC
    LIMIT 50`;
  return rows.map((r) => r.id);
}
