/**
 * Integration (real PostgreSQL, migrated + seeded incl. the bundled price import): step 7 fuel check,
 * public price store and cost outlook (REQ-20261011-fuel-outlook, Part C F6, F9-F14).
 * - database: RLS ENABLE + FORCE and column grants of fsc_tables / claim_fuel_inputs, cross-tenant refusal
 *   as freight_app, CHECKs, the global price tables (SELECT-only for freight_app, append-only for the
 *   owner, pinned-URL CHECK), the flag rows;
 * - importer: --bundled is idempotent (unchanged) on the seeded database; a shrinking file is refused;
 * - routes: fuel tables CRUD + audit, the cap (serialized), fuel inputs created/changed/unchanged + audit,
 *   AWAITING_ANALYSIS only, 422s, fuel-check view + intelligence.viewed, outlook (pinned values, S2 rates),
 *   RBAC, flag OFF 404, byte-identical cross-tenant 404.
 */
import { createHash, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { ApiKeyCreated, FscTable, FscTableList, FuelCheckView, OutlookResponse, SetFuelInputsResponse, canonicalJson } from '@fr/shared';
import { parsePriceCsv } from '@fr/shared/outlook';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { main as pricesMain } from '../../src/platform/prices-cli.js';

import { Client, adminUrl, appUrl, canRunDb, step4Env } from './step4-helpers.js';

type Inject = Awaited<ReturnType<FastifyInstance['inject']>>;
const errorOf = (r: Inject) => (r.json() as { error: { code: string; message: string } }).error;
const marker = `zz fuel ${Date.now().toString(36)}`;
const STEP = { basePrice: '1.20', stepSize: '0.06', ratePerStep: '0.01', bracket: 'above_base' };
/** Fix round 1 (L2): sha256 of the canonical params JSON. */
const PARAMS_SHA = createHash('sha256').update(canonicalJson(STEP), 'utf8').digest('hex');

let admin: pg.Client;
let app: pg.Client;
let acme = '';
let globex = '';
let ownerId = '';
let globexOwnerId = '';

async function asApp<T>(tenant: string | null, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  await app.query('BEGIN');
  try {
    if (tenant) await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
    return await fn(app);
  } finally {
    await app.query('ROLLBACK');
  }
}

async function auditOf(action: string, targetId: string): Promise<Record<string, unknown>[]> {
  const r = await admin.query<{ metadata: Record<string, unknown> }>(`SELECT metadata FROM audit_events WHERE action = $1 AND target_id = $2 ORDER BY seq`, [action, targetId]);
  return r.rows.map((x) => x.metadata);
}

async function insertTable(tenant: string, user: string, name: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `INSERT INTO fsc_tables (id, tenant_id, name, kind, unit, price_series, params, created_by_id, updated_by_id, updated_at)
     VALUES ($1, $2, $3, 'step', 'per_mile', 'diesel_us', $4::jsonb, $5, $5, now())`,
    [id, tenant, name, JSON.stringify(STEP), user],
  );
  return id;
}

async function insertAwaitingClaim(tenant: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `INSERT INTO claims (id, tenant_id, claim_number, carrier_name, shipper_name, perspective, status, amount_claimed_cents, recoverable_cents, pending_review_cents, updated_at)
     VALUES ($1, $2, $3, '', '', 'SHIPPER', 'AWAITING_ANALYSIS', 0, 0, 0, now())`,
    [id, tenant, `FU-${randomUUID().slice(0, 8)}`],
  );
  return id;
}

describe.skipIf(!canRunDb)('fuel check, price store and outlook (PostgreSQL)', () => {
  const claims: string[] = [];

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
    await admin.query(`DELETE FROM claim_fuel_inputs WHERE claim_id = ANY($1::uuid[]) OR fsc_table_id IN (SELECT id FROM fsc_tables WHERE name LIKE 'zz fuel%')`, [claims]);
    await admin.query(`DELETE FROM fsc_tables WHERE name LIKE 'zz fuel%'`);
    await admin.query(`DELETE FROM claims WHERE id = ANY($1::uuid[])`, [claims]);
    await app.end();
    await admin.end();
  });

  describe('database guarantees', () => {
    it('tenant tables: RLS forced, one tenant policy, exact grants; flag rows', async () => {
      for (const [table, privileges, updatable] of [
        ['fsc_tables', ['INSERT', 'SELECT'], ['archived_at', 'effective_offset_days', 'kind', 'name', 'params', 'price_series', 'unit', 'updated_at', 'updated_by_id', 'version']],
        ['claim_fuel_inputs', ['DELETE', 'INSERT', 'SELECT'], ['fsc_table_id', 'miles', 'ship_date', 'updated_at', 'updated_by_id', 'version']],
      ] as const) {
        const rls = await admin.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`, [table]);
        expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
        const pol = await admin.query<{ policyname: string; cmd: string }>(`SELECT policyname, cmd FROM pg_policies WHERE tablename = $1`, [table]);
        expect(pol.rows).toEqual([{ policyname: `${table}_tenant_isolation`, cmd: 'ALL' }]);
        const tbl = await admin.query<{ privilege_type: string }>(
          `SELECT privilege_type FROM information_schema.role_table_grants WHERE table_name = $1 AND grantee = 'freight_app' ORDER BY privilege_type`,
          [table],
        );
        expect(tbl.rows.map((r) => r.privilege_type)).toEqual([...privileges]);
        const cols = await admin.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.column_privileges WHERE table_name = $1 AND grantee = 'freight_app' AND privilege_type = 'UPDATE' ORDER BY column_name`,
          [table],
        );
        expect(cols.rows.map((r) => r.column_name)).toEqual([...updatable]);
      }
      const flags = await admin.query(`SELECT key, enabled, version FROM feature_flags WHERE key IN ('intelligence.cost_outlook', 'intelligence.fuel_check') ORDER BY key`);
      expect(flags.rows.map((r: { key: string }) => r.key)).toEqual(['intelligence.cost_outlook', 'intelligence.fuel_check']);
    });

    it('as freight_app: own-tenant fuel rows only; cross-tenant insert/update/delete refused', async () => {
      const gTable = await insertTable(globex, globexOwnerId, `${marker} globex`);
      expect((await asApp(null, (c) => c.query(`SELECT id FROM fsc_tables WHERE id = $1`, [gTable]))).rowCount).toBe(0);
      expect((await asApp(acme, (c) => c.query(`SELECT id FROM fsc_tables WHERE id = $1`, [gTable]))).rowCount).toBe(0);
      expect((await asApp(globex, (c) => c.query(`SELECT id FROM fsc_tables WHERE id = $1`, [gTable]))).rowCount).toBe(1);
      expect((await asApp(acme, (c) => c.query(`UPDATE fsc_tables SET name = 'x' WHERE id = $1`, [gTable]))).rowCount).toBe(0);
      await expect(asApp(globex, (c) => c.query(`DELETE FROM fsc_tables WHERE id = $1`, [gTable]))).rejects.toThrow(/permission denied/u);
      await expect(asApp(globex, (c) => c.query(`UPDATE fsc_tables SET tenant_id = $1 WHERE id = $2`, [acme, gTable]))).rejects.toThrow(/permission denied/u);
      await expect(
        asApp(acme, (c) =>
          c.query(
            `INSERT INTO fsc_tables (id, tenant_id, name, kind, unit, price_series, params, created_by_id, updated_by_id, updated_at)
             VALUES ($1, $2, 'x', 'step', 'per_mile', 'diesel_us', '{}'::jsonb, $3, $3, now())`,
            [randomUUID(), globex, ownerId],
          ),
        ),
      ).rejects.toThrow(/row-level security/u);
      const gClaim = await insertAwaitingClaim(globex);
      claims.push(gClaim);
      await admin.query(
        `INSERT INTO claim_fuel_inputs (id, tenant_id, claim_id, ship_date, miles, fsc_table_id, created_by_id, updated_by_id, updated_at)
         VALUES ($1, $2, $3, '2026-10-07', 500.0, $4, $5, $5, now())`,
        [randomUUID(), globex, gClaim, gTable, globexOwnerId],
      );
      expect((await asApp(acme, (c) => c.query(`SELECT id FROM claim_fuel_inputs WHERE claim_id = $1`, [gClaim]))).rowCount).toBe(0);
      expect((await asApp(acme, (c) => c.query(`DELETE FROM claim_fuel_inputs WHERE claim_id = $1`, [gClaim]))).rowCount).toBe(0);
      // Composite FK: an acme input cannot point at a globex table.
      const aClaim = await insertAwaitingClaim(acme);
      claims.push(aClaim);
      await expect(
        admin.query(
          `INSERT INTO claim_fuel_inputs (id, tenant_id, claim_id, ship_date, fsc_table_id, created_by_id, updated_by_id, updated_at)
           VALUES ($1, $2, $3, '2026-10-07', $4, $5, $5, now())`,
          [randomUUID(), acme, aClaim, gTable, ownerId],
        ),
      ).rejects.toThrow(/foreign key/u);
    });

    it('CHECKs of the tenant tables', async () => {
      const ins = (kind: string, unit: string, params: string, name = `${marker} chk ${randomUUID().slice(0, 6)}`, offset = 2, series = 'diesel_us') =>
        admin.query(
          `INSERT INTO fsc_tables (id, tenant_id, name, kind, unit, price_series, effective_offset_days, params, created_by_id, updated_by_id, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $9, now())`,
          [randomUUID(), acme, name, kind, unit, series, offset, params, ownerId],
        );
      await expect(ins('bogus', 'per_mile', '{}')).rejects.toThrow(/fsc_tables_kind_valid/u);
      await expect(ins('step', 'per_gallon', '{}')).rejects.toThrow(/fsc_tables_unit_valid/u);
      await expect(ins('mpg', 'percent', '{}')).rejects.toThrow(/fsc_tables_mpg_per_mile/u);
      await expect(ins('step', 'per_mile', '{}', undefined, 7)).rejects.toThrow(/fsc_tables_offset_range/u);
      await expect(ins('step', 'per_mile', '{}', undefined, 2, 'ppi_tl')).rejects.toThrow(/fsc_tables_price_series_valid/u);
      await expect(ins('step', 'per_mile', '[]')).rejects.toThrow(/fsc_tables_params_object/u);
      await expect(ins('step', 'per_mile', '{}', '')).rejects.toThrow(/fsc_tables_name_length/u);
    });

    it('global price tables: SELECT-only for freight_app, append-only for everyone, pinned URL, seeded import present', async () => {
      for (const table of ['price_imports', 'price_observations']) {
        const tbl = await admin.query<{ privilege_type: string }>(`SELECT privilege_type FROM information_schema.role_table_grants WHERE table_name = $1 AND grantee = 'freight_app'`, [table]);
        expect(tbl.rows.map((r) => r.privilege_type)).toEqual(['SELECT']);
        const rls = await admin.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`, [table]);
        expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      }
      const imp = await admin.query<{ id: string; series_key: string; sha256: string; row_count: number }>(
        `SELECT DISTINCT ON (series_key) id, series_key, sha256, row_count FROM price_imports ORDER BY series_key, imported_at DESC, id DESC`,
      );
      expect(imp.rows.map((r) => [r.series_key, r.row_count])).toEqual([
        ['diesel_us', 1699],
        ['ppi_tl', 411],
      ]);
      const importId = imp.rows[0]?.id ?? '';
      expect((await asApp(null, (c) => c.query(`SELECT count(*) FROM price_observations WHERE import_id = $1`, [importId]))).rows[0]).toEqual({ count: '1699' });
      await expect(asApp(null, (c) => c.query(`UPDATE price_observations SET value = 9 WHERE import_id = $1`, [importId]))).rejects.toThrow(/permission denied/u);
      await expect(asApp(null, (c) => c.query(`DELETE FROM price_imports WHERE id = $1`, [importId]))).rejects.toThrow(/permission denied/u);
      await expect(
        asApp(null, (c) =>
          c.query(`INSERT INTO price_imports (series_key, source_kind, source_url, retrieved_at, sha256, row_count, first_date, last_date) VALUES ('diesel_us', 'file', $1, '2026-10-11', $2, 1, '2026-01-05', '2026-01-05')`, [
            'https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASDESW',
            '0'.repeat(64),
          ]),
        ),
      ).rejects.toThrow(/permission denied/u);
      // Owner: append-only triggers.
      await expect(admin.query(`UPDATE price_imports SET row_count = row_count WHERE id = $1`, [importId])).rejects.toThrow(/append_only/u);
      await expect(admin.query(`DELETE FROM price_observations WHERE import_id = $1`, [importId])).rejects.toThrow(/append_only/u);
      await expect(admin.query(`TRUNCATE price_observations`)).rejects.toThrow(/append_only|cannot truncate/u);
      await admin.query('BEGIN');
      try {
        await expect(
          admin.query(`INSERT INTO price_imports (series_key, source_kind, source_url, retrieved_at, sha256, row_count, first_date, last_date) VALUES ('diesel_us', 'file', 'https://evil.example/x.csv', '2026-10-11', $1, 1, '2026-01-05', '2026-01-05')`, [
            '0'.repeat(64),
          ]),
        ).rejects.toThrow(/price_imports_source_url_pinned/u);
      } finally {
        await admin.query('ROLLBACK');
      }
    });
  });

  describe('importer', () => {
    it('--bundled on the seeded database reports unchanged and writes nothing', async () => {
      const before = await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM price_imports`);
      const out: string[] = [];
      const code = await pricesMain(['--bundled'], (s) => out.push(s), (s) => out.push(s), { env: { MIGRATE_DATABASE_URL: adminUrl } });
      expect(code).toBe(0);
      expect(out.join('')).toMatch(/diesel_us: unchanged[\s\S]*ppi_tl: unchanged/u);
      expect((await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM price_imports`)).rows[0]?.n).toBe(before.rows[0]?.n);
    });

    it('fix round 1 (L1): a re-import that changes covered values is refused without --accept-revisions', async () => {
      const { mkdtempSync, readFileSync, writeFileSync, rmSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const path = await import('node:path');
      const { defaultPriceDataDir } = await import('../../src/platform/price-files.js');
      const dir = mkdtempSync(path.join(tmpdir(), 'fr-int-revise-'));
      try {
        const original = readFileSync(path.join(defaultPriceDataDir(), 'GASDESW.csv'), 'utf8');
        const revised = original.replace('\n2026-10-05,6.199', '\n2026-10-05,6.200');
        expect(revised).not.toBe(original);
        const file = path.join(dir, 'revised.csv');
        writeFileSync(file, revised);
        const args = ['--series', 'diesel_us', '--file', file, '--source-url', 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASDESW', '--retrieved-at', '2026-10-11'];
        const before = (await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM price_imports`)).rows[0]?.n;
        const out: string[] = [];
        expect(await pricesMain(args, (s) => out.push(s), (s) => out.push(s), { env: { MIGRATE_DATABASE_URL: adminUrl } })).toBe(2);
        expect(out.join('')).toContain('refused: 1 revised value(s)');
        expect((await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM price_imports`)).rows[0]?.n).toBe(before);
        // Accepting the revision would change the shared active import for every other test; the accept path is
        // covered by the unit tests (fake DB). Here only the refusal is checked against the real store.
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('a file that does not cover the active range is refused (exit 2, nothing written)', async () => {
      const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const path = await import('node:path');
      const dir = mkdtempSync(path.join(tmpdir(), 'fr-int-prices-'));
      try {
        const file = path.join(dir, 'short.csv');
        writeFileSync(file, 'observation_date,GASDESW\n2026-09-28,6.382\n2026-10-05,6.199\n');
        expect(parsePriceCsv(new TextEncoder().encode('observation_date,GASDESW\n2026-09-28,6.382\n'), 'diesel_us').rows).toHaveLength(1);
        const out: string[] = [];
        const code = await pricesMain(
          ['--series', 'diesel_us', '--file', file, '--source-url', 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASDESW', '--retrieved-at', '2026-10-11'],
          (s) => out.push(s),
          (s) => out.push(s),
          { env: { MIGRATE_DATABASE_URL: adminUrl } },
        );
        expect(code).toBe(2);
        expect(out.join('')).toContain('would_remove_history');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('routes', () => {
    let fastify: FastifyInstance;
    let c: Client;
    let owner = '';
    let analyst = '';
    let viewer = '';
    let globexOwner = '';
    let dev = '';

    beforeAll(async () => {
      fastify = await buildApp(step4Env(), { logStream: new Writable({ write: (_c, _e, cb) => cb() }) });
      await fastify.ready();
      c = await new Client(fastify).init();
      owner = await c.login('owner@acme.test');
      analyst = await c.login('analyst@acme.test');
      viewer = await c.login('viewer@acme.test');
      globexOwner = await c.login('owner@globex.test');
      dev = await c.login('dev@platform.test');
    }, 120_000);

    afterAll(async () => {
      await fastify?.close();
    });

    const del = (url: string, token?: string) => fastify.inject({ method: 'DELETE', url, headers: c.headers(token) });
    const body = (name: string) => ({ name, kind: 'step', unit: 'per_mile', priceSeries: 'diesel_us', params: STEP });

    it('fuel tables: create 201, update with expectedVersion, stale 409, archive 204 (idempotent), audit key sets', async () => {
      const created = await c.send('POST', '/api/v1/fuel-tables', owner, body(`${marker} a`));
      expect(created.statusCode, created.body).toBe(201);
      const t = FscTable.parse(created.json());
      expect(t).toMatchObject({ version: 1, effectiveOffsetDays: 2, archived: false });
      expect((await c.send('POST', '/api/v1/fuel-tables', owner, body(`${marker} a`))).statusCode).toBe(409);
      const same = await c.send('PUT', `/api/v1/fuel-tables/${t.id}`, owner, { ...body(`${marker} a`), expectedVersion: 1 });
      expect(FscTable.parse(same.json()).version).toBe(1);
      const upd = await c.send('PUT', `/api/v1/fuel-tables/${t.id}`, owner, { ...body(`${marker} a`), effectiveOffsetDays: 0, expectedVersion: 1 });
      expect(FscTable.parse(upd.json())).toMatchObject({ version: 2, effectiveOffsetDays: 0 });
      const stale = await c.send('PUT', `/api/v1/fuel-tables/${t.id}`, owner, { ...body(`${marker} a`), expectedVersion: 1 });
      expect([stale.statusCode, errorOf(stale).code]).toEqual([409, 'stale_revision']);
      expect((await del(`/api/v1/fuel-tables/${t.id}`, owner)).statusCode).toBe(204);
      expect((await del(`/api/v1/fuel-tables/${t.id}`, owner)).statusCode).toBe(204);
      const archived = await c.send('PUT', `/api/v1/fuel-tables/${t.id}`, owner, { ...body(`${marker} a`), expectedVersion: 3 });
      expect([archived.statusCode, errorOf(archived).code]).toEqual([409, 'invalid_state']);
      expect(await auditOf('fsc_table.created', t.id)).toEqual([{ fscTableId: t.id, version: 1, kind: 'step', unit: 'per_mile', priceSeries: 'diesel_us', effectiveOffsetDays: 2, paramsSha256: PARAMS_SHA }]);
      expect(await auditOf('fsc_table.updated', t.id)).toEqual([
        {
          fscTableId: t.id,
          version: 2,
          previousVersion: 1,
          kind: 'step',
          unit: 'per_mile',
          priceSeries: 'diesel_us',
          effectiveOffsetDays: 0,
          changedFields: ['effectiveOffsetDays'],
          paramsSha256: PARAMS_SHA,
        },
      ]);
      expect(await auditOf('fsc_table.archived', t.id)).toEqual([{ fscTableId: t.id, version: 3, paramsSha256: PARAMS_SHA }]);
      const list = FscTableList.parse((await c.get('/api/v1/fuel-tables?includeArchived=true', viewer)).json());
      expect(list.items.some((x) => x.id === t.id && x.archived)).toBe(true);
      expect(FscTableList.parse((await c.get('/api/v1/fuel-tables', viewer)).json()).items.some((x) => x.id === t.id)).toBe(false);
      // Cross tenant: byte-identical 404.
      const cross = await del(`/api/v1/fuel-tables/${t.id}`, globexOwner);
      const unknown = await del(`/api/v1/fuel-tables/${randomUUID()}`, globexOwner);
      expect([cross.statusCode, unknown.statusCode]).toEqual([404, 404]);
      expect(cross.body.replace(/"requestId":"[^"]*"/u, '')).toBe(unknown.body.replace(/"requestId":"[^"]*"/u, ''));
    });

    it('the cap of 50 tables is enforced under concurrency', async () => {
      const have = Number((await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM fsc_tables WHERE tenant_id = $1`, [acme])).rows[0]?.n ?? '0');
      for (let i = have; i < 48; i += 1) await insertTable(acme, ownerId, `${marker} cap ${i}`);
      const results = await Promise.all([0, 1, 2, 3].map((i) => c.send('POST', '/api/v1/fuel-tables', owner, body(`${marker} race ${i}`))));
      expect(results.filter((r) => r.statusCode === 201)).toHaveLength(Math.max(0, 50 - Math.max(have, 48)));
      for (const r of results.filter((x) => x.statusCode !== 201)) expect(errorOf(r).code).toBe('fuel_table_limit_reached');
      expect(Number((await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM fsc_tables WHERE tenant_id = $1`, [acme])).rows[0]?.n)).toBeLessThanOrEqual(50);
      await admin.query(`DELETE FROM fsc_tables WHERE name LIKE $1 OR name LIKE $2`, [`${marker} cap%`, `${marker} race%`]);
    });

    it('fuel inputs: created / unchanged / changed, 422s, AWAITING_ANALYSIS only, fuel-check view and audits', async () => {
      const tableId = await insertTable(acme, ownerId, `${marker} inputs`);
      const pctId = randomUUID();
      await admin.query(
        `INSERT INTO fsc_tables (id, tenant_id, name, kind, unit, price_series, params, created_by_id, updated_by_id, updated_at)
         VALUES ($1, $2, $3, 'step', 'percent', 'diesel_us', $4::jsonb, $5, $5, now())`,
        [pctId, acme, `${marker} pct`, JSON.stringify({ ...STEP, ratePerStep: '0.5' }), ownerId],
      );
      const claim = await insertAwaitingClaim(acme);
      claims.push(claim);
      const url = `/api/v1/claims/${claim}/fuel-inputs`;
      const a = SetFuelInputsResponse.parse((await c.send('PUT', url, analyst, { shipDate: '2026-10-07', miles: '500', fscTableId: tableId })).json());
      expect(a).toMatchObject({ outcome: 'created', inputs: { claimId: claim, shipDate: '2026-10-07', miles: '500.0', fscTableId: tableId, version: 1 } });
      expect(SetFuelInputsResponse.parse((await c.send('PUT', url, analyst, { shipDate: '2026-10-07', miles: '500.0', fscTableId: tableId })).json()).outcome).toBe('unchanged');
      expect(SetFuelInputsResponse.parse((await c.send('PUT', url, analyst, { shipDate: '2026-10-08', miles: '500.0', fscTableId: tableId })).json())).toMatchObject({ outcome: 'changed', inputs: { version: 2 } });
      const noMiles = await c.send('PUT', url, analyst, { shipDate: '2026-10-07', miles: null, fscTableId: tableId });
      expect([noMiles.statusCode, errorOf(noMiles).code]).toEqual([422, 'miles_required']);
      expect((await c.send('PUT', url, analyst, { shipDate: '2026-10-07', miles: null, fscTableId: pctId })).statusCode).toBe(200);
      const gone = await c.send('PUT', url, analyst, { shipDate: '2026-10-07', miles: '1', fscTableId: randomUUID() });
      expect([gone.statusCode, errorOf(gone).code]).toEqual([422, 'fuel_table_unavailable']);
      expect(await auditOf('claim.fuel_inputs_set', claim)).toEqual([
        { claimId: claim, fscTableId: tableId, shipDate: '2026-10-07', miles: '500.0', outcome: 'created', version: 1 },
        { claimId: claim, fscTableId: tableId, shipDate: '2026-10-08', miles: '500.0', outcome: 'changed', version: 2 },
        { claimId: claim, fscTableId: pctId, shipDate: '2026-10-07', miles: null, outcome: 'changed', version: 3 },
      ]);

      const view = await c.get(`/api/v1/claims/${claim}/fuel-check`, viewer);
      expect(view.statusCode, view.body).toBe(200);
      const v = FuelCheckView.parse(view.json());
      expect([v.inputs?.fscTableId, v.table?.id, v.result.status]).toEqual([pctId, pctId, 'no_fuel_line']);
      const ev = await admin.query<{ metadata: Record<string, unknown> }>(
        `SELECT metadata FROM audit_events WHERE action = 'intelligence.viewed' AND target_id = $1 ORDER BY seq DESC LIMIT 1`,
        [claim],
      );
      expect(ev.rows[0]?.metadata).toEqual({ kind: 'fuel_check', claimId: claim, status: 'no_fuel_line' });

      expect((await del(url, analyst)).statusCode).toBe(204);
      expect((await del(url, analyst)).statusCode).toBe(204);
      expect(await auditOf('claim.fuel_inputs_cleared', claim)).toEqual([{ claimId: claim }]);

      // Not AWAITING_ANALYSIS -> 409; reads stay allowed.
      const reviewed = await insertAwaitingClaim(acme);
      claims.push(reviewed);
      await admin.query(`SET session_replication_role = replica`);
      try {
        await admin.query(`UPDATE claims SET status = 'PENDING_REVIEW' WHERE id = $1`, [reviewed]);
      } finally {
        await admin.query(`SET session_replication_role = origin`);
      }
      const locked = await c.send('PUT', `/api/v1/claims/${reviewed}/fuel-inputs`, analyst, { shipDate: '2026-10-07', miles: '5', fscTableId: tableId });
      expect([locked.statusCode, errorOf(locked).code]).toEqual([409, 'invalid_state']);
      expect((await c.get(`/api/v1/claims/${reviewed}/fuel-check`, viewer)).statusCode).toBe(200);
    });

    it('RBAC and validation: tables need settings:manage, inputs claims:analyze; platform 403; 401; 400 before 404', async () => {
      expect(errorOf(await c.send('POST', '/api/v1/fuel-tables', analyst, body(`${marker} rbac`))).code).toBe('forbidden');
      expect((await c.send('POST', '/api/v1/fuel-tables', dev, body(`${marker} rbac`))).statusCode).toBe(403);
      expect((await c.send('POST', '/api/v1/fuel-tables', undefined, body(`${marker} rbac`))).statusCode).toBe(401);
      expect((await c.send('PUT', `/api/v1/claims/${randomUUID()}/fuel-inputs`, viewer, { shipDate: '2026-10-07', miles: '5', fscTableId: randomUUID() })).statusCode).toBe(403);
      expect((await c.get('/api/v1/fuel-tables', dev)).statusCode).toBe(403);
      expect((await c.get('/api/v1/outlook', dev)).statusCode).toBe(403);
      for (const bad of [{}, { ...body('x'), kind: 'mpg' }, { ...body('x'), extra: 1 }, { ...body(''), name: '' }]) {
        expect([bad, (await c.send('POST', '/api/v1/fuel-tables', owner, bad)).statusCode]).toEqual([bad, 400]);
      }
      expect((await c.send('PUT', `/api/v1/claims/${randomUUID()}/fuel-inputs`, analyst, { shipDate: '2026-02-30', miles: '5', fscTableId: randomUUID() })).statusCode).toBe(400);
      // Fix round 2: a non-UUID fscTableId is the standard 404 (byte-identical to an unknown id); unknown keys stay 400.
      const badId = await c.get('/api/v1/outlook?fscTableId=x', viewer);
      const unknownId = await c.get(`/api/v1/outlook?fscTableId=${randomUUID()}`, viewer);
      expect([badId.statusCode, unknownId.statusCode]).toEqual([404, 404]);
      expect(badId.body.replace(/"requestId":"[^"]*"/u, '')).toBe(unknownId.body.replace(/"requestId":"[^"]*"/u, ''));
      expect((await c.get('/api/v1/outlook?other=1', viewer)).statusCode).toBe(400);
      expect((await c.get('/api/v1/fuel-tables?includeArchived=yes', viewer)).statusCode).toBe(400);
    });

    it('fix round 1 (I1): an API key (every scope) gets 403 forbidden on all 8 step-7 routes', async () => {
      const created = await c.send('POST', '/api/v1/api-keys', owner, { name: `${marker} key`, scopes: ['claims.read', 'imports.write', 'exports.claims'] });
      expect(created.statusCode, created.body).toBe(201);
      const key = ApiKeyCreated.parse(created.json());
      const id = randomUUID();
      const claimId = randomUUID();
      const routes: [string, string, unknown][] = [
        ['GET', '/api/v1/fuel-tables', undefined],
        ['POST', '/api/v1/fuel-tables', body(`${marker} key`)],
        ['PUT', `/api/v1/fuel-tables/${id}`, { ...body(`${marker} key`), expectedVersion: 1 }],
        ['DELETE', `/api/v1/fuel-tables/${id}`, undefined],
        ['GET', `/api/v1/claims/${claimId}/fuel-check`, undefined],
        ['PUT', `/api/v1/claims/${claimId}/fuel-inputs`, { shipDate: '2026-10-07', miles: '5', fscTableId: id }],
        ['DELETE', `/api/v1/claims/${claimId}/fuel-inputs`, undefined],
        ['GET', '/api/v1/outlook', undefined],
      ];
      try {
        for (const [method, url, payload] of routes) {
          const r = await fastify.inject({
            method: method as 'GET' | 'POST' | 'PUT' | 'DELETE',
            url,
            headers: { authorization: `Bearer ${key.secret}`, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
            ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
          });
          expect([method, url, r.statusCode, errorOf(r).code]).toEqual([method, url, 403, 'forbidden']);
        }
      } finally {
        await c.send('POST', `/api/v1/api-keys/${key.key.id}/revoke`, owner, { reason: 'Fuel integration key cleanup' });
      }
    });

    it('outlook: pinned live values and backtest, S2 rates, archived/foreign table 404', async () => {
      const r = await c.get('/api/v1/outlook', viewer);
      expect(r.statusCode, r.body).toBe(200);
      const o = OutlookResponse.parse(r.json());
      const diesel = o.series[0];
      expect(diesel?.horizons.map((h) => [h.h, h.method, h.point, h.low, h.high])).toEqual([
        [1, 'ar2', '6.124', '5.903', '6.392'],
        [4, 'combo', '6.136', '5.301', '7.175'],
        [8, 'naive', '6.199', '4.777', '8.189'],
        [13, 'naive', '6.199', '4.384', '9.395'],
      ]);
      expect(o.series[1]?.horizons.map((h) => [h.point, h.low, h.high])).toEqual([['218.0', '210.9', '225.9']]);
      expect(o.fscTable).toBeNull();
      const tableId = await insertTable(acme, ownerId, `${marker} outlook`);
      const withTable = OutlookResponse.parse((await c.get(`/api/v1/outlook?fscTableId=${tableId}`, viewer)).json());
      expect(withTable.series[0]?.horizons[0]?.fsc).toEqual({ point: '0.83', low: '0.79', high: '0.87' });
      expect(withTable.fscTable).toMatchObject({ id: tableId, version: 1, unit: 'per_mile', current: '0.84' });
      const foreign = await insertTable(globex, globexOwnerId, `${marker} outlook g`);
      expect((await c.get(`/api/v1/outlook?fscTableId=${foreign}`, viewer)).statusCode).toBe(404);
      await admin.query(`UPDATE fsc_tables SET archived_at = now() WHERE id = $1`, [tableId]);
      expect((await c.get(`/api/v1/outlook?fscTableId=${tableId}`, viewer)).statusCode).toBe(404);
    });

    it('flags OFF: the routes of that flag 404 after 401/403/400', async () => {
      await admin.query(`UPDATE feature_flags SET enabled = false, version = version + 1 WHERE key IN ('intelligence.fuel_check', 'intelligence.cost_outlook')`);
      try {
        const app2 = await buildApp(step4Env(), { logStream: new Writable({ write: (_c, _e, cb) => cb() }) });
        await app2.ready();
        try {
          const c2 = await new Client(app2).init();
          const own = await c2.login('owner@acme.test');
          expect((await c2.get('/api/v1/fuel-tables', own)).statusCode).toBe(404);
          expect((await c2.send('POST', '/api/v1/fuel-tables', own, body(`${marker} off`))).statusCode).toBe(404);
          expect((await c2.get(`/api/v1/claims/${randomUUID()}/fuel-check`, own)).statusCode).toBe(404);
          expect((await c2.get('/api/v1/outlook', own)).statusCode).toBe(404);
          expect((await c2.send('POST', '/api/v1/fuel-tables', own, {})).statusCode).toBe(400);
          expect((await c2.get('/api/v1/outlook')).statusCode).toBe(401);
          const features = (await c2.get('/api/v1/features', own)).json() as { flags: Record<string, boolean> };
          expect([features.flags['intelligence.fuel_check'], features.flags['intelligence.cost_outlook']]).toEqual([false, false]);
        } finally {
          await app2.close();
        }
      } finally {
        await admin.query(`UPDATE feature_flags SET enabled = true, version = version + 1 WHERE key IN ('intelligence.fuel_check', 'intelligence.cost_outlook')`);
      }
    });
  });
});
