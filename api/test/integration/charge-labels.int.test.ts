/**
 * Integration (real PostgreSQL, migrated + seeded): step-6 tenant charge labels
 * (REQ-20261011-charge-intelligence, Part C C6-C10, C14).
 * - database: RLS ENABLE + FORCE, policy, column grants, CHECKs, unique key, the flag row; as freight_app
 *   another tenant's rows are invisible and cannot be inserted, updated or deleted;
 * - routes: PUT created/changed/unchanged, list order and paging, DELETE, RBAC (charge_labels:manage only
 *   for OWNER/ADMIN/MANAGER/REVIEWER; platform 403; API keys 403), validation 400, byte-identical 404 for
 *   unknown/other-tenant ids, flag OFF -> 404, the per-user cap (409), audit metadata key sets.
 */
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { ChargeLabelsList, ChargeLinesResponse, SetChargeLabelResponse } from '@fr/shared';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';

import { Client, adminUrl, appUrl, canRunDb, step4Env } from './step4-helpers.js';

type Inject = Awaited<ReturnType<FastifyInstance['inject']>>;
const errorOf = (r: Inject) => (r.json() as { error: { code: string; message: string } }).error;

let admin: pg.Client;
let app: pg.Client;
let acme = '';
let globex = '';
let ownerId = '';
let globexOwnerId = '';
const marker = `zz fixture ${Date.now().toString(36)}`;

async function asApp<T>(tenant: string | null, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  await app.query('BEGIN');
  try {
    if (tenant) await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
    return await fn(app);
  } finally {
    await app.query('ROLLBACK');
  }
}

async function auditOf(action: string, labelId: string): Promise<Record<string, unknown>[]> {
  const r = await admin.query<{ metadata: Record<string, unknown> }>(`SELECT metadata FROM audit_events WHERE action = $1 AND target_id = $2 ORDER BY seq`, [action, labelId]);
  return r.rows.map((x) => x.metadata);
}

describe.skipIf(!canRunDb)('charge labels (PostgreSQL)', () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    app = new pg.Client({ connectionString: appUrl });
    await admin.connect();
    await app.connect();
    const t = await admin.query<{ id: string; slug: string }>(`SELECT id, slug FROM tenants WHERE slug IN ('acme', 'globex')`);
    acme = t.rows.find((r) => r.slug === 'acme')?.id ?? '';
    globex = t.rows.find((r) => r.slug === 'globex')?.id ?? '';
    ownerId = (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = 'owner@acme.test'`)).rows[0]?.id ?? '';
    globexOwnerId = (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = 'owner@globex.test'`)).rows[0]?.id ?? '';
  });

  afterAll(async () => {
    await admin.query(`DELETE FROM charge_labels WHERE normalized_text LIKE 'zz fixture%'`);
    await app.end();
    await admin.end();
  });

  describe('database guarantees', () => {
    it('RLS is enabled and forced; the policy and the column grants are exactly as specified', async () => {
      const rls = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'charge_labels'`,
      );
      expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const pol = await admin.query<{ policyname: string; cmd: string }>(`SELECT policyname, cmd FROM pg_policies WHERE tablename = 'charge_labels'`);
      expect(pol.rows).toEqual([{ policyname: 'charge_labels_tenant_isolation', cmd: 'ALL' }]);
      const tbl = await admin.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.role_table_grants WHERE table_name = 'charge_labels' AND grantee = 'freight_app' ORDER BY privilege_type`,
      );
      expect(tbl.rows.map((r) => r.privilege_type)).toEqual(['DELETE', 'INSERT', 'SELECT']);
      const cols = await admin.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.column_privileges WHERE table_name = 'charge_labels' AND grantee = 'freight_app' AND privilege_type = 'UPDATE' ORDER BY column_name`,
      );
      expect(cols.rows.map((r) => r.column_name)).toEqual(['category', 'description', 'updated_at', 'updated_by_id', 'version']);
      const flag = await admin.query(`SELECT enabled, version FROM feature_flags WHERE key = 'intelligence.charge_suggestions'`);
      expect(flag.rows).toEqual([{ enabled: true, version: 1 }]);
    });

    it('as freight_app: own-tenant rows only; cross-tenant insert/update/delete refused; no context sees nothing', async () => {
      const id = randomUUID();
      await admin.query(
        `INSERT INTO charge_labels (id, tenant_id, normalized_text, description, category, created_by_id, updated_by_id, updated_at)
         VALUES ($1, $2, $3, 'Fixture', 'accessorial', $4, $4, now())`,
        [id, globex, `${marker} globex`, globexOwnerId],
      );
      try {
        expect((await asApp(null, (c) => c.query(`SELECT id FROM charge_labels WHERE id = $1`, [id]))).rowCount).toBe(0);
        expect((await asApp(acme, (c) => c.query(`SELECT id FROM charge_labels WHERE id = $1`, [id]))).rowCount).toBe(0);
        expect((await asApp(globex, (c) => c.query(`SELECT id FROM charge_labels WHERE id = $1`, [id]))).rowCount).toBe(1);
        expect((await asApp(acme, (c) => c.query(`UPDATE charge_labels SET category = 'fuel' WHERE id = $1`, [id]))).rowCount).toBe(0);
        expect((await asApp(acme, (c) => c.query(`DELETE FROM charge_labels WHERE id = $1`, [id]))).rowCount).toBe(0);
        await expect(
          asApp(acme, (c) =>
            c.query(
              `INSERT INTO charge_labels (id, tenant_id, normalized_text, description, category, created_by_id, updated_by_id, updated_at)
               VALUES ($1, $2, $3, 'x', 'fuel', $4, $4, now())`,
              [randomUUID(), globex, `${marker} cross`, ownerId],
            ),
          ),
        ).rejects.toThrow(/row-level security/u);
        await expect(asApp(globex, (c) => c.query(`UPDATE charge_labels SET tenant_id = $1 WHERE id = $2`, [acme, id]))).rejects.toThrow(/permission denied/u);
        await expect(asApp(globex, (c) => c.query(`UPDATE charge_labels SET normalized_text = 'other' WHERE id = $1`, [id]))).rejects.toThrow(/permission denied/u);
        await expect(asApp(globex, (c) => c.query(`TRUNCATE charge_labels`))).rejects.toThrow(/permission denied|must be owner/u);
      } finally {
        await admin.query(`DELETE FROM charge_labels WHERE id = $1`, [id]);
      }
    });

    it('CHECKs and the (tenant, normalized text) unique key', async () => {
      const ins = (nt: string, desc: string, cat: string, version = 1) =>
        admin.query(
          `INSERT INTO charge_labels (id, tenant_id, normalized_text, description, category, created_by_id, updated_by_id, updated_at, version)
           VALUES ($1, $2, $3, $4, $5, $6, $6, now(), $7)`,
          [randomUUID(), acme, nt, desc, cat, ownerId, version],
        );
      await expect(ins(`${marker} a`, 'x', 'bogus')).rejects.toThrow(/charge_labels_category_valid/u);
      await expect(ins('Upper Case', 'x', 'fuel')).rejects.toThrow(/charge_labels_normalized_text_format/u);
      await expect(ins(' lead', 'x', 'fuel')).rejects.toThrow(/charge_labels_normalized_text_format/u);
      await expect(ins('a'.repeat(201), 'x', 'fuel')).rejects.toThrow(/charge_labels_normalized_text_format/u);
      await expect(ins(`${marker} b`, '', 'fuel')).rejects.toThrow(/charge_labels_description_length/u);
      await expect(ins(`${marker} c`, 'x', 'fuel', 0)).rejects.toThrow(/charge_labels_version_positive/u);
      await ins(`${marker} d`, 'x', 'fuel');
      await expect(ins(`${marker} d`, 'y', 'other')).rejects.toThrow(/charge_labels_tenant_id_normalized_text_key/u);
      await admin.query(`DELETE FROM charge_labels WHERE normalized_text = $1`, [`${marker} d`]);
    });
  });

  describe('routes', () => {
    let fastify: FastifyInstance;
    let c: Client;
    let reviewer = '';
    let analyst = '';
    let viewer = '';
    let globexManager = '';
    let dev = '';
    let acmeClaim = '';
    let globexClaim = '';
    const desc = `ZZ Fixture ${Date.now().toString(36)} Lumper-Fee`;

    beforeAll(async () => {
      fastify = await buildApp(step4Env(), { logStream: new Writable({ write: (_c, _e, cb) => cb() }) });
      await fastify.ready();
      c = await new Client(fastify).init();
      reviewer = await c.login('reviewer@acme.test');
      analyst = await c.login('analyst@acme.test');
      viewer = await c.login('viewer@acme.test');
      globexManager = await c.login('manager@globex.test');
      dev = await c.login('dev@platform.test');
      acmeClaim = (await admin.query<{ id: string }>(`SELECT id FROM claims WHERE tenant_id = $1 LIMIT 1`, [acme])).rows[0]?.id ?? '';
      globexClaim = (await admin.query<{ id: string }>(`SELECT id FROM claims WHERE tenant_id = $1 LIMIT 1`, [globex])).rows[0]?.id ?? '';
    }, 120_000);

    afterAll(async () => {
      await fastify?.close();
    });

    const del = (url: string, token?: string) => fastify.inject({ method: 'DELETE', url, headers: c.headers(token) });

    it('PUT creates, changes and keeps a label; the list is ordered; DELETE removes it; audit metadata is exact', async () => {
      const created = await c.send('PUT', '/api/v1/charge-labels', reviewer, { description: `  ${desc} `, category: 'accessorial' });
      expect(created.statusCode, created.body).toBe(200);
      const a = SetChargeLabelResponse.parse(created.json());
      expect(a.outcome).toBe('created');
      expect(a.label).toMatchObject({ description: desc, category: 'accessorial', version: 1 });
      expect(a.label.normalizedText).toMatch(/^zz fixture [a-z0-9]+ lumper fee$/u);

      const same = SetChargeLabelResponse.parse((await c.send('PUT', '/api/v1/charge-labels', reviewer, { description: desc.toUpperCase(), category: 'accessorial' })).json());
      expect(same.outcome).toBe('unchanged');
      expect(same.label).toEqual(a.label);

      const changed = SetChargeLabelResponse.parse((await c.send('PUT', '/api/v1/charge-labels', reviewer, { description: desc, category: 'detention' })).json());
      expect(changed.outcome).toBe('changed');
      expect(changed.label).toMatchObject({ id: a.label.id, category: 'detention', version: 2 });

      const list = ChargeLabelsList.parse((await c.get('/api/v1/charge-labels?pageSize=100', viewer)).json());
      expect(list.items.map((l) => l.id)).toContain(a.label.id);
      const sorted = [...list.items].sort((x, y) => (x.normalizedText < y.normalizedText ? -1 : x.normalizedText > y.normalizedText ? 1 : x.id < y.id ? -1 : 1));
      expect(list.items).toEqual(sorted);

      expect(await auditOf('charge_label.set', a.label.id)).toEqual([
        { labelId: a.label.id, category: 'accessorial', outcome: 'created' },
        { labelId: a.label.id, category: 'detention', previousCategory: 'accessorial', outcome: 'changed' },
      ]);

      // Other tenant: byte-identical 404 to an unknown id.
      const cross = await del(`/api/v1/charge-labels/${a.label.id}`, globexManager);
      const unknown = await del(`/api/v1/charge-labels/${randomUUID()}`, globexManager);
      expect([cross.statusCode, unknown.statusCode]).toEqual([404, 404]);
      expect(errorOf(cross)).toMatchObject({ code: 'not_found', message: errorOf(unknown).message });
      expect((await del('/api/v1/charge-labels/not-a-uuid', reviewer)).statusCode).toBe(404);

      const gone = await del(`/api/v1/charge-labels/${a.label.id}`, reviewer);
      expect(gone.statusCode).toBe(204);
      expect(gone.body).toBe('');
      expect(await auditOf('charge_label.deleted', a.label.id)).toEqual([{ labelId: a.label.id, category: 'detention' }]);
      expect((await del(`/api/v1/charge-labels/${a.label.id}`, reviewer)).statusCode).toBe(404);
    });

    it('RBAC: manage only for OWNER/ADMIN/MANAGER/REVIEWER; reads for tenant roles; platform 403; 401 without a session', async () => {
      const body = { description: `${desc} rbac`, category: 'fuel' };
      expect(errorOf(await c.send('PUT', '/api/v1/charge-labels', analyst, body)).code).toBe('forbidden');
      expect((await c.send('PUT', '/api/v1/charge-labels', viewer, body)).statusCode).toBe(403);
      expect((await c.send('PUT', '/api/v1/charge-labels', dev, body)).statusCode).toBe(403);
      expect((await c.send('PUT', '/api/v1/charge-labels', undefined, body)).statusCode).toBe(401);
      expect((await del(`/api/v1/charge-labels/${randomUUID()}`, analyst)).statusCode).toBe(403);
      expect((await c.get('/api/v1/charge-labels', analyst)).statusCode).toBe(200);
      expect((await c.get('/api/v1/charge-labels', dev)).statusCode).toBe(403);
      expect((await c.get(`/api/v1/claims/${acmeClaim}/charge-lines`, dev)).statusCode).toBe(403);
      const me = (await c.get('/api/v1/me', reviewer)).json() as { permissions: string[] };
      expect(me.permissions).toContain('charge_labels:manage');
      const meAnalyst = (await c.get('/api/v1/me', analyst)).json() as { permissions: string[] };
      expect(meAnalyst.permissions).not.toContain('charge_labels:manage');
    });

    it('validation 400 before 404; strict bodies and queries', async () => {
      for (const bad of [{}, { description: '---', category: 'fuel' }, { description: 'x', category: 'nope' }, { description: 'x'.repeat(201), category: 'fuel' }, { description: 'x', category: 'fuel', tenantId: globex }]) {
        expect([bad, (await c.send('PUT', '/api/v1/charge-labels', reviewer, bad)).statusCode]).toEqual([bad, 400]);
      }
      expect((await c.get('/api/v1/charge-labels?pageSize=101', viewer)).statusCode).toBe(400);
      expect((await c.get('/api/v1/charge-labels?x=1', viewer)).statusCode).toBe(400);
    });

    it('charge lines: own claim 200 with the fixed versions and an audit row; other tenant / unknown 404 byte-identical', async () => {
      const r = await c.get(`/api/v1/claims/${acmeClaim}/charge-lines`, viewer);
      expect(r.statusCode, r.body).toBe(200);
      const body = ChargeLinesResponse.parse(r.json());
      expect(body).toMatchObject({ claimId: acmeClaim, classifierVersion: 'charge-knn-v1', seedVersion: 'tariff-seed-v1', threshold: 0.3 });
      const ev = await admin.query<{ metadata: Record<string, unknown> }>(
        `SELECT metadata FROM audit_events WHERE action = 'intelligence.viewed' AND target_id = $1 ORDER BY seq DESC LIMIT 1`,
        [acmeClaim],
      );
      expect(ev.rows[0]?.metadata).toEqual({ kind: 'charge_lines', claimId: acmeClaim, returned: body.lines.length });
      const cross = await c.get(`/api/v1/claims/${globexClaim}/charge-lines`, viewer);
      const unknown = await c.get(`/api/v1/claims/${randomUUID()}/charge-lines`, viewer);
      expect([cross.statusCode, unknown.statusCode]).toEqual([404, 404]);
      expect(cross.body.replace(/"requestId":"[^"]*"/u, '')).toBe(unknown.body.replace(/"requestId":"[^"]*"/u, ''));
    });

    it('flag OFF: all four routes 404 after 401/403/400', async () => {
      await admin.query(`UPDATE feature_flags SET enabled = false, version = version + 1 WHERE key = 'intelligence.charge_suggestions'`);
      try {
        const app2 = await buildApp(step4Env(), { logStream: new Writable({ write: (_c, _e, cb) => cb() }) });
        await app2.ready();
        try {
          const c2 = await new Client(app2).init();
          const rev = await c2.login('reviewer@acme.test');
          expect((await c2.get(`/api/v1/claims/${acmeClaim}/charge-lines`, rev)).statusCode).toBe(404);
          expect((await c2.get('/api/v1/charge-labels', rev)).statusCode).toBe(404);
          expect((await c2.send('PUT', '/api/v1/charge-labels', rev, { description: `${desc} off`, category: 'fuel' })).statusCode).toBe(404);
          expect((await app2.inject({ method: 'DELETE', url: `/api/v1/charge-labels/${randomUUID()}`, headers: c2.headers(rev) })).statusCode).toBe(404);
          expect((await c2.send('PUT', '/api/v1/charge-labels', rev, { description: '', category: 'fuel' })).statusCode).toBe(400);
          expect((await c2.get('/api/v1/charge-labels')).statusCode).toBe(401);
          const features = (await c2.get('/api/v1/features', rev)).json() as { flags: Record<string, boolean> };
          expect(features.flags['intelligence.charge_suggestions']).toBe(false);
        } finally {
          await app2.close();
        }
      } finally {
        await admin.query(`UPDATE feature_flags SET enabled = true, version = version + 1 WHERE key = 'intelligence.charge_suggestions'`);
      }
    });

    it('cap: inserting beyond CHARGE_LABELS_MAX is 409 label_limit_reached; updates stay allowed', async () => {
      const have = Number((await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM charge_labels WHERE tenant_id = $1`, [acme])).rows[0]?.n ?? '0');
      const keep = `${marker} cap keep`;
      await admin.query(
        `INSERT INTO charge_labels (id, tenant_id, normalized_text, description, category, created_by_id, updated_by_id, updated_at)
         SELECT gen_random_uuid(), $1, $2 || ' ' || g, 'fixture', 'other', $3, $3, now() FROM generate_series(1, $4::int) g`,
        [acme, `${marker} cap`, ownerId, Math.max(0, 2000 - have - 1)],
      );
      await admin.query(
        `INSERT INTO charge_labels (id, tenant_id, normalized_text, description, category, created_by_id, updated_by_id, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $2, 'other', $3, $3, now())`,
        [acme, keep, ownerId],
      );
      const full = await c.send('PUT', '/api/v1/charge-labels', reviewer, { description: `${desc} over`, category: 'fuel' });
      expect(full.statusCode).toBe(409);
      expect(errorOf(full)).toMatchObject({ code: 'label_limit_reached', message: 'This organization has reached the maximum number of charge labels.' });
      const upd = await c.send('PUT', '/api/v1/charge-labels', reviewer, { description: keep, category: 'fuel' });
      expect(SetChargeLabelResponse.parse(upd.json()).outcome).toBe('changed');
      await admin.query(`DELETE FROM charge_labels WHERE normalized_text LIKE $1`, [`${marker} cap%`]);
    });
  });
});
