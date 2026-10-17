/**
 * Row and advisory locks for the import/commit paths (raw SQL is confined to api/src/db/**). All run in
 * the caller's tenant transaction (RLS applies: another tenant's id behaves like an unknown id).
 */
import { assertUuid } from './errors.js';
import { unwrapRawTx, type TenantTx } from './tenant.js';

/** Transaction-scoped advisory lock on an arbitrary key (released at commit/rollback). */
export async function advisoryXactLock(tx: TenantTx, key: string): Promise<void> {
  const raw = unwrapRawTx(tx);
  await raw.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/**
 * Serialize writers of one import batch. import_batches has no UPDATE grant (append-only), so
 * `SELECT ... FOR UPDATE` is not available; an advisory lock keyed by the batch id is used instead.
 */
export async function lockImportBatch(tx: TenantTx, batchId: string): Promise<void> {
  assertUuid(batchId, 'batchId');
  await advisoryXactLock(tx, `import-batch:${batchId}`);
}

/** Row-lock an import document (SELECT ... FOR UPDATE); false when it is not visible (unknown/other tenant). */
export async function lockImportDocument(tx: TenantTx, documentId: string): Promise<boolean> {
  assertUuid(documentId, 'documentId');
  const raw = unwrapRawTx(tx);
  const rows = await raw.$queryRaw<{ id: string }[]>`SELECT id FROM import_documents WHERE id = ${documentId}::uuid FOR UPDATE`;
  return rows.length === 1;
}
