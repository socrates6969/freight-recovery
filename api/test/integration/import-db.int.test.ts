/**
 * Integration (real PostgreSQL, migrated + seeded): database-level guarantees of the step-3 import
 * tables (N11). Fixture rows are written by the owner role; every assertion is made as freight_app.
 */
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const appUrl = process.env['TEST_DATABASE_URL'];
const adminUrl = process.env['TEST_ADMIN_DATABASE_URL'];

let admin: pg.Client;
let app: pg.Client;
let tenantId = '';
let otherTenantId = '';
let userId = '';
let batchId = '';
let docId = '';
let fieldId = '';
let claimId = '';

const SHA = 'a'.repeat(64);

async function asApp<T>(tenant: string | null, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  await app.query('BEGIN');
  try {
    if (tenant) await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
    return await fn(app);
  } finally {
    await app.query('ROLLBACK');
  }
}

async function expectDbError(p: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(p).rejects.toThrow(pattern);
}

describe.skipIf(!appUrl || !adminUrl)('import tables: database guarantees (N11)', () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    app = new pg.Client({ connectionString: appUrl });
    await admin.connect();
    await app.connect();
    const t = await admin.query<{ id: string; slug: string }>(`SELECT id, slug FROM tenants WHERE slug IN ('acme', 'globex')`);
    tenantId = t.rows.find((r) => r.slug === 'acme')?.id ?? '';
    otherTenantId = t.rows.find((r) => r.slug === 'globex')?.id ?? '';
    userId = (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = 'analyst@acme.test'`)).rows[0]?.id ?? '';
    claimId = (await admin.query<{ id: string }>(`SELECT id FROM claims WHERE tenant_id = $1 LIMIT 1`, [tenantId])).rows[0]?.id ?? '';
    batchId = randomUUID();
    docId = randomUUID();
    fieldId = randomUUID();
    await admin.query(`INSERT INTO import_batches (id, tenant_id, created_by_id) VALUES ($1, $2, $3)`, [batchId, tenantId, userId]);
    await admin.query(
      `INSERT INTO import_documents (id, tenant_id, batch_id, uploaded_by_id, source, display_name, detected_type, size_bytes, sha256,
         storage_key, doc_type, doc_type_basis, status, provider_name, provider_version, parser_version, updated_at)
       VALUES ($1, $2, $3, $4, 'UPLOAD', 'int-test.txt', 'TXT', 10, $5, $6, 'INVOICE', 'HEADER', 'NEEDS_REVIEW', 'deterministic', '1', '1', now())`,
      [docId, tenantId, batchId, userId, SHA, `t/${tenantId}/imports/${batchId}/${docId}/original`],
    );
    await admin.query(
      `INSERT INTO extracted_fields (id, tenant_id, document_id, key, ordinal, kind, value, raw_value, confidence, needs_review,
         origin, line, start_col, end_col, excerpt)
       VALUES ($1, $2, $3, 'invoice.total', 0, 'DECIMAL', '5', '5', 0.85, true, 'EXTRACTED', 1, 7, 8, 'Total: 5')`,
      [fieldId, tenantId, docId],
    );
  });

  afterAll(async () => {
    // Remove the fixture rows (owner, dev/test only: append-only triggers off inside this transaction).
    if (admin && docId) {
      await admin.query('BEGIN');
      await admin.query('SET LOCAL session_replication_role = replica');
      await admin.query(`DELETE FROM claim_documents WHERE document_id = $1`, [docId]);
      await admin.query(`DELETE FROM import_review_decisions WHERE document_id = $1`, [docId]);
      await admin.query(`DELETE FROM extracted_fields WHERE document_id = $1`, [docId]);
      await admin.query(`DELETE FROM import_documents WHERE id = $1`, [docId]);
      await admin.query(`DELETE FROM import_batches WHERE id = $1`, [batchId]);
      await admin.query('COMMIT');
    }
    await app?.end();
    await admin?.end();
  });

  it('returns zero rows and rejects inserts without a tenant context', async () => {
    for (const table of ['import_batches', 'import_documents', 'extracted_fields', 'import_review_decisions', 'claim_documents']) {
      const r = await asApp(null, (c) => c.query(`SELECT count(*)::int AS n FROM ${table}`));
      expect([table, r.rows[0]?.n]).toEqual([table, 0]);
    }
    await expectDbError(
      asApp(null, (c) => c.query(`INSERT INTO import_batches (id, tenant_id, created_by_id) VALUES ($1, $2, $3)`, [randomUUID(), tenantId, userId])),
      /row-level security/u,
    );
  });

  it('hides other tenants and refuses cross-tenant inserts', async () => {
    const r = await asApp(otherTenantId, (c) => c.query(`SELECT count(*)::int AS n FROM import_documents WHERE id = $1`, [docId]));
    expect(r.rows[0]?.n).toBe(0);
    await expectDbError(
      asApp(otherTenantId, (c) => c.query(`INSERT INTO import_batches (id, tenant_id, created_by_id) VALUES ($1, $2, $3)`, [randomUUID(), tenantId, userId])),
      /row-level security/u,
    );
  });

  it('import_documents: identity/content columns and DELETE are rejected; storage key must stay in the tenant prefix', async () => {
    const own = (c: pg.Client, sql: string, params: unknown[] = []) => c.query(sql, [docId, ...params]);
    for (const [sql, params] of [
      [`UPDATE import_documents SET sha256 = $2 WHERE id = $1`, ['b'.repeat(64)]],
      [`UPDATE import_documents SET size_bytes = 11 WHERE id = $1`, []],
      [`UPDATE import_documents SET detected_type = 'PDF' WHERE id = $1`, []],
      [`UPDATE import_documents SET batch_id = $2 WHERE id = $1`, [randomUUID()]],
      [`UPDATE import_documents SET tenant_id = $2 WHERE id = $1`, [otherTenantId]],
      [`UPDATE import_documents SET storage_key = $2 WHERE id = $1`, [`t/${tenantId}/imports/x/y/original`]],
      [`DELETE FROM import_documents WHERE id = $1`, []],
    ] as [string, unknown[]][]) {
      await expectDbError(asApp(tenantId, (c) => own(c, sql, params)), /permission denied|import_document|append_only|row-level/u);
    }
    // Owner role (BYPASSRLS) still cannot put a key outside the tenant prefix (CHECK).
    await expectDbError(
      admin.query(`UPDATE import_documents SET storage_key = $2, status = 'REJECTED' WHERE id = $1`, [docId, `t/${otherTenantId}/x`]),
      /storage_key_tenant|import_document/u,
    );
    // Allowed: a legal status transition.
    const ok = await asApp(tenantId, (c) => own(c, `UPDATE import_documents SET status = 'ACCEPTED', updated_at = now() WHERE id = $1`));
    expect(ok.rowCount).toBe(1);
  });

  it('import_documents: illegal status transitions are rejected', async () => {
    await expectDbError(
      asApp(tenantId, (c) => c.query(`UPDATE import_documents SET status = 'RECEIVED' WHERE id = $1`, [docId])),
      /invalid_import_document_transition/u,
    );
  });

  it('extracted_fields: value/confidence/key/pointer updates and DELETE are rejected; resolution is allowed once', async () => {
    for (const sql of [
      `UPDATE extracted_fields SET value = '6' WHERE id = $1`,
      `UPDATE extracted_fields SET raw_value = '6' WHERE id = $1`,
      `UPDATE extracted_fields SET confidence = 1 WHERE id = $1`,
      `UPDATE extracted_fields SET key = 'invoice.carrier' WHERE id = $1`,
      `UPDATE extracted_fields SET line = 2 WHERE id = $1`,
      `DELETE FROM extracted_fields WHERE id = $1`,
    ]) {
      await expectDbError(asApp(tenantId, (c) => c.query(sql, [fieldId])), /permission denied|extracted_field|append_only/u);
    }
    await asApp(tenantId, async (c) => {
      const r = await c.query(`UPDATE extracted_fields SET status = 'CONFIRMED', resolved_by_id = $2, resolved_at = now() WHERE id = $1`, [fieldId, userId]);
      expect(r.rowCount).toBe(1);
      await expect(c.query(`UPDATE extracted_fields SET status = 'REJECTED' WHERE id = $1`, [fieldId])).rejects.toThrow(/invalid_extracted_field_transition/u);
    });
  });

  it('import_review_decisions rejects UPDATE, DELETE and TRUNCATE; claim_documents is insert-only', async () => {
    const decisionId = randomUUID();
    await admin.query(
      `INSERT INTO import_review_decisions (id, tenant_id, document_id, field_id, action, reason, actor_id, actor_role)
       VALUES ($1, $2, $3, $4, 'CONFIRM', 'integration test reason', $5, 'REVIEWER')`,
      [decisionId, tenantId, docId, fieldId, userId],
    );
    for (const sql of [`UPDATE import_review_decisions SET reason = 'changed reason text' WHERE id = $1`, `DELETE FROM import_review_decisions WHERE id = $1`]) {
      await expectDbError(asApp(tenantId, (c) => c.query(sql, [decisionId])), /permission denied|append_only/u);
    }
    await expectDbError(admin.query(`UPDATE import_review_decisions SET reason = 'changed reason text' WHERE id = $1`, [decisionId]), /append_only/u);
    await expectDbError(asApp(tenantId, (c) => c.query(`TRUNCATE import_review_decisions`)), /permission denied|append_only/u);
    const linkId = randomUUID();
    await asApp(tenantId, async (c) => {
      await c.query(`INSERT INTO claim_documents (id, tenant_id, claim_id, document_id, linked_by_id) VALUES ($1, $2, $3, $4, $5)`, [
        linkId,
        tenantId,
        claimId,
        docId,
        userId,
      ]);
      await expect(c.query(`DELETE FROM claim_documents WHERE id = $1`, [linkId])).rejects.toThrow(/permission denied|append_only/u);
    });
  });
});
