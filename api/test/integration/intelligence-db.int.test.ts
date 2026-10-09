/**
 * Integration (real PostgreSQL, migrated + seeded): database-level guarantees of the step 4 tables
 * (Q11, Q13 Database): feature_flags, eval_runs, eval_case_results, api_keys and
 * fr_platform_pipeline_stats. Fixture rows are written by the owner role; assertions run as freight_app.
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
let ownerId = '';
let keyRowId = '';
const keyId = randomUUID().replace(/-/gu, '').slice(0, 16);
const HASH = 'b'.repeat(64);

async function asApp<T>(mode: { tenant?: string; system?: boolean }, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  await app.query('BEGIN');
  try {
    if (mode.tenant) await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [mode.tenant]);
    if (mode.system) await app.query(`SELECT set_config('app.system', 'on', true)`);
    return await fn(app);
  } finally {
    await app.query('ROLLBACK');
  }
}

const EVAL_INSERT = `INSERT INTO eval_runs (eval_set_id, eval_set_version, eval_set_sha256, stage, k, started_at, finished_at, provider_name,
  provider_version, parser_version, case_count, runs_total, runs_passed, pass_hat_k_count, pass_at_least_one_count, flaky_case_count,
  always_fail_count, deterministic_cases, wilson_low, wilson_high, pass_pow_curve, run_ms_p50, run_ms_p95)
  VALUES ('db-test', '1', $1, 'extraction', 2, now(), now(), 'deterministic', '1', '1', 2, 4, 3, 1, 2, 1, 0, 2, 0.1, 0.9, ARRAY[0.75, 0.5], 1, 2)
  RETURNING id`;

describe.skipIf(!appUrl || !adminUrl)('step 4 tables: database guarantees', () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    app = new pg.Client({ connectionString: appUrl });
    await admin.connect();
    await app.connect();
    const t = await admin.query<{ id: string; slug: string }>(`SELECT id, slug FROM tenants WHERE slug IN ('acme', 'globex')`);
    tenantId = t.rows.find((r) => r.slug === 'acme')?.id ?? '';
    otherTenantId = t.rows.find((r) => r.slug === 'globex')?.id ?? '';
    ownerId = (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = 'owner@acme.test'`)).rows[0]?.id ?? '';
    keyRowId = randomUUID();
    await admin.query(
      `INSERT INTO api_keys (id, tenant_id, key_id, name, secret_hash, scopes, created_by_id, expires_at)
       VALUES ($1, $2, $3, 'db-test', $4, ARRAY['claims.read'], $5, now() + interval '1 day')`,
      [keyRowId, tenantId, keyId, HASH, ownerId],
    );
  });

  afterAll(async () => {
    await admin.query('BEGIN');
    await admin.query('SET LOCAL session_replication_role = replica');
    await admin.query(`DELETE FROM api_keys WHERE id = $1`, [keyRowId]);
    await admin.query(`DELETE FROM eval_case_results WHERE run_id IN (SELECT id FROM eval_runs WHERE eval_set_id = 'db-test')`);
    await admin.query(`DELETE FROM eval_runs WHERE eval_set_id = 'db-test'`);
    await admin.query('COMMIT');
    await app.end();
    await admin.end();
  });

  it('feature_flags: readable without context; UPDATE/INSERT/DELETE/TRUNCATE refused without system mode', async () => {
    await asApp({}, async (c) => {
      const r = await c.query(`SELECT key FROM feature_flags ORDER BY key`);
      expect(r.rows.map((x: { key: string }) => x.key)).toEqual(['intelligence.provenance', 'intelligence.similar_claims', 'intelligence.worklist']);
      const u = await c.query(`UPDATE feature_flags SET enabled = NOT enabled, version = version + 1 WHERE key = 'intelligence.worklist'`);
      expect(u.rowCount).toBe(0);
    });
    await expect(asApp({}, (c) => c.query(`INSERT INTO feature_flags (key, enabled) VALUES ('x.y.z', true)`))).rejects.toThrow(/permission denied/u);
    await expect(asApp({ system: true }, (c) => c.query(`DELETE FROM feature_flags`))).rejects.toThrow(/permission denied/u);
    await expect(asApp({ system: true }, (c) => c.query(`TRUNCATE feature_flags`))).rejects.toThrow(/permission denied|must be owner/u);
  });

  it('feature_flags: system-mode UPDATE must keep the key and increment version by exactly one (owner too)', async () => {
    await asApp({ system: true }, async (c) => {
      const ok = await c.query(`UPDATE feature_flags SET enabled = enabled, version = version + 1 WHERE key = 'intelligence.worklist'`);
      expect(ok.rowCount).toBe(1);
    });
    await expect(asApp({ system: true }, (c) => c.query(`UPDATE feature_flags SET version = version + 2 WHERE key = 'intelligence.worklist'`))).rejects.toThrow(
      /feature_flag_version/u,
    );
    await expect(asApp({ system: true }, (c) => c.query(`UPDATE feature_flags SET enabled = false WHERE key = 'intelligence.worklist'`))).rejects.toThrow(
      /feature_flag_version/u,
    );
    await admin.query('BEGIN');
    try {
      await expect(admin.query(`UPDATE feature_flags SET key = 'intelligence.other', version = version + 1 WHERE key = 'intelligence.worklist'`)).rejects.toThrow(
        /feature_flag_key_immutable|permission/u,
      );
    } finally {
      await admin.query('ROLLBACK');
    }
    await admin.query('BEGIN');
    try {
      await expect(admin.query(`DELETE FROM feature_flags WHERE key = 'intelligence.worklist'`)).rejects.toThrow(/append_only/u);
    } finally {
      await admin.query('ROLLBACK');
    }
  });

  it('eval tables: zero rows and no inserts without system mode; inserts with it; never updated or deleted', async () => {
    await asApp({}, async (c) => {
      expect((await c.query(`SELECT count(*)::int AS n FROM eval_runs`)).rows[0]).toEqual({ n: 0 });
      expect((await c.query(`SELECT count(*)::int AS n FROM eval_case_results`)).rows[0]).toEqual({ n: 0 });
    });
    await expect(asApp({ tenant: tenantId }, (c) => c.query(EVAL_INSERT, ['c'.repeat(64)]))).rejects.toThrow(/row-level security/u);
    const runId = await asApp({ system: true }, async (c) => {
      const r = await c.query<{ id: string }>(EVAL_INSERT, ['c'.repeat(64)]);
      const id = r.rows[0]?.id ?? '';
      await c.query(
        `INSERT INTO eval_case_results (run_id, case_id, category, runs_passed, k, passed_all, distinct_outputs, first_failure_code, median_duration_ms)
         VALUES ($1, 'a', 'cat', 2, 2, true, 1, NULL, 1.5), ($1, 'b', 'cat', 1, 2, false, 2, 'field_mismatch', 2)`,
        [id],
      );
      await expect(c.query(`SAVEPOINT s; UPDATE eval_runs SET k = 3 WHERE id = '${id}'`)).rejects.toThrow(/append_only|permission/u);
      return id;
    });
    expect(runId).toMatch(/^[0-9a-f-]{36}$/u);
    // CHECK: passed_all must equal (runs_passed = k); failure code iff not passed.
    await expect(
      asApp({ system: true }, async (c) => {
        const r = await c.query<{ id: string }>(EVAL_INSERT, ['d'.repeat(64)]);
        await c.query(
          `INSERT INTO eval_case_results (run_id, case_id, category, runs_passed, k, passed_all, distinct_outputs, first_failure_code, median_duration_ms)
           VALUES ($1, 'a', 'cat', 1, 2, true, 1, NULL, 1)`,
          [r.rows[0]?.id],
        );
      }),
    ).rejects.toThrow(/check constraint/u);
    // CHECK: counts must tie together.
    await expect(asApp({ system: true }, (c) => c.query(EVAL_INSERT.replace('2, 4, 3, 1, 2, 1, 0, 2', '2, 4, 5, 1, 2, 1, 0, 2'), ['e'.repeat(64)]))).rejects.toThrow(
      /check constraint/u,
    );
  });

  it('fr_platform_pipeline_stats: system mode only, range-checked, aggregate columns only', async () => {
    await expect(asApp({}, (c) => c.query(`SELECT * FROM fr_platform_pipeline_stats(3600, 600)`))).rejects.toThrow(/system mode required/u);
    await expect(asApp({ tenant: tenantId }, (c) => c.query(`SELECT * FROM fr_platform_pipeline_stats(3600, 600)`))).rejects.toThrow(/system mode required/u);
    await expect(asApp({ system: true }, (c) => c.query(`SELECT * FROM fr_platform_pipeline_stats(59, 600)`))).rejects.toThrow(/window_seconds/u);
    await expect(asApp({ system: true }, (c) => c.query(`SELECT * FROM fr_platform_pipeline_stats(3600, 0)`))).rejects.toThrow(/stale_seconds/u);
    const r = await asApp({ system: true }, (c) => c.query(`SELECT * FROM fr_platform_pipeline_stats(604800, 600)`));
    expect(r.fields.map((f) => f.name)).toEqual(['metric', 'label', 'n', 'p50_ms', 'p95_ms']);
    const metrics = new Set(r.rows.map((x: { metric: string }) => x.metric));
    for (const m of ['upload_to_parse', 'review_queue', 'stale_received', 'awaiting_analysis']) expect(metrics.has(m)).toBe(true);
    const src = (await admin.query<{ src: string }>(`SELECT prosrc AS src FROM pg_proc WHERE proname = 'fr_platform_pipeline_stats'`)).rows[0]?.src ?? '';
    for (const col of ['tenant_id', 'display_name', 'storage_key', 'sha256', 'claim_number', 'uploaded_by_id', 'email', 'name', 'text_key', 'batch_id']) {
      expect([col, new RegExp(`\\b${col}\\b`, 'u').test(src)]).toEqual([col, false]);
    }
  });

  it('api_keys: tenant RLS, system lookup, immutable columns, one-way revocation, no delete', async () => {
    await asApp({}, async (c) => expect((await c.query(`SELECT count(*)::int AS n FROM api_keys`)).rows[0]).toEqual({ n: 0 }));
    await asApp({ tenant: otherTenantId }, async (c) => expect((await c.query(`SELECT count(*)::int AS n FROM api_keys WHERE id = $1`, [keyRowId])).rows[0]).toEqual({ n: 0 }));
    await asApp({ system: true }, async (c) => expect((await c.query(`SELECT tenant_id FROM api_keys WHERE key_id = $1`, [keyId])).rows[0]).toEqual({ tenant_id: tenantId }));
    await expect(
      asApp({}, (c) => c.query(`INSERT INTO api_keys (id, tenant_id, key_id, name, secret_hash, scopes, created_by_id) VALUES ($1, $2, 'aaaaaaaaaaaaaaaa', 'x', $3, ARRAY['claims.read'], $4)`, [randomUUID(), tenantId, HASH, ownerId])),
    ).rejects.toThrow(/row-level security/u);
    await expect(
      asApp({ tenant: tenantId }, (c) =>
        c.query(`INSERT INTO api_keys (id, tenant_id, key_id, name, secret_hash, scopes, created_by_id) VALUES ($1, $2, 'aaaaaaaaaaaaaaab', 'x', $3, ARRAY['claims.read','claims.read'], $4)`, [randomUUID(), tenantId, HASH, ownerId]),
      ),
    ).rejects.toThrow(/check constraint/u);
    await expect(
      asApp({ tenant: tenantId }, (c) =>
        c.query(`INSERT INTO api_keys (id, tenant_id, key_id, name, secret_hash, scopes, created_by_id) VALUES ($1, $2, 'aaaaaaaaaaaaaaac', 'x', $3, ARRAY['admin'], $4)`, [randomUUID(), tenantId, HASH, ownerId]),
      ),
    ).rejects.toThrow(/check constraint/u);
    await expect(asApp({ tenant: tenantId }, (c) => c.query(`UPDATE api_keys SET secret_hash = $2 WHERE id = $1`, [keyRowId, 'c'.repeat(64)]))).rejects.toThrow(/permission denied/u);
    await expect(asApp({ tenant: tenantId }, (c) => c.query(`UPDATE api_keys SET revoked_at = now() WHERE id = $1`, [keyRowId]))).rejects.toThrow(/check constraint/u);
    await expect(asApp({ tenant: tenantId }, (c) => c.query(`DELETE FROM api_keys WHERE id = $1`, [keyRowId]))).rejects.toThrow(/permission denied/u);
    await asApp({ tenant: tenantId }, async (c) => {
      await c.query(`UPDATE api_keys SET revoked_at = now(), revoked_by_id = $2, revoke_reason = 'rotation for the test' WHERE id = $1`, [keyRowId, ownerId]);
      await expect(c.query(`UPDATE api_keys SET revoked_at = NULL, revoked_by_id = NULL, revoke_reason = NULL WHERE id = $1`, [keyRowId])).rejects.toThrow(
        /api_key_revocation_final/u,
      );
    });
    await admin.query('BEGIN');
    try {
      await expect(admin.query(`UPDATE api_keys SET scopes = ARRAY['imports.write'] WHERE id = $1`, [keyRowId])).rejects.toThrow(/api_key_immutable/u);
    } finally {
      await admin.query('ROLLBACK');
    }
    await admin.query('BEGIN');
    try {
      await expect(admin.query(`DELETE FROM api_keys WHERE id = $1`, [keyRowId])).rejects.toThrow(/append_only/u);
    } finally {
      await admin.query('ROLLBACK');
    }
  });
});
