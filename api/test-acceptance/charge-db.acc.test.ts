/* eslint-disable */
// REQ-20261011-charge-intelligence Tier H (written now; run after the owner's go-ahead): T12 database guarantees
// CI-D01..D04 (Part C C10). SQL as the runtime role freight_app with the tenant set (rolled back), catalog queries and
// CHECK probes as the owner role (rolled back).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Session, buildTestApp, closeApps, sessionFor } from './helpers/client.js';
import * as A from './helpers/analysis.js';
import { type PgClient, appDb, withAdmin } from './helpers/db.js';
import * as I from './helpers/intel.js';
import { reseed } from './helpers/seed.js';

const ROOT = resolve(__dirname, '..', '..');
const MIG = resolve(ROOT, 'api', 'prisma', 'migrations');
/** Committed migrations are immutable: sha256 of migration.sql (d678827 for the first four, 51ea826 for analysis). */
const FROZEN: Record<string, string> = {
  '20261008000000_init': 'bea2ee6796b489535845722913651534400ebac10e36aa6517b57306a378126c',
  '20261009000000_import_export': '8699637753c358bddef3863c9b281e4114c30dfa6bd77d9f7ef977b8c730b36c',
  '20261010000000_intelligence': '4f9717fc5428503c5e005c08cc7808b54514bdf5a077c9c8b98d2e301378d916',
  '20261011000000_four_eyes': '2ad97a26f2b93813773ee990bfb58748d4cd9e6ede1c4631eb0977feb5790d1d',
  '20261012000000_analysis': '29102ab01c76c1e5f1d215dae0d901b4cffb81ce86d596dfee6dd9b5b55ac934',
};

let app: FastifyInstance;
let rvA: Session, gxm: Session;
let acme = '', globex = '';
let aId = '';
let c: PgClient;

beforeAll(async () => {
  reseed();
  app = await buildTestApp();
  rvA = await sessionFor(app, ACCOUNTS.REVIEWER);
  gxm = await sessionFor(app, I.GLOBEX.MANAGER);
  acme = rvA.user.tenant.id;
  globex = gxm.user.tenant.id;
  const r = await I.put(rvA, '/charge-labels', { description: 'Pallet jack rental', category: 'accessorial' });
  expect(r.status, r.text).toBe(200);
  aId = r.body.label.id;
  c = await appDb();
  expect((await c.query('select current_user u')).rows[0].u).toBe('freight_app');
}, 180000);
afterAll(async () => { try { await c?.end(); } finally { await closeApps(); reseed(); } });

describe('CI-D01 RLS as freight_app', () => {
  it('tenant B sees, updates and deletes none of tenant A rows; insert for A fails; no tenant -> nothing', async () => {
    const sel = await A.txSteps(c, globex, [{ sql: 'select * from charge_labels where id = $1', params: [aId] }]);
    expect([sel[0]!.ok, sel[0]!.rowCount]).toEqual([true, 0]);
    const all = await A.txSteps(c, globex, [{ sql: 'select * from charge_labels where tenant_id = $1', params: [acme] }]);
    expect(all[0]!.rowCount).toBe(0);
    const up = await A.txSteps(c, globex, [{ sql: `update charge_labels set category = 'other' where id = $1`, params: [aId] }]);
    expect([up[0]!.ok, up[0]!.rowCount]).toEqual([true, 0]);
    const del = await A.txSteps(c, globex, [{ sql: 'delete from charge_labels where id = $1', params: [aId] }]);
    expect([del[0]!.ok, del[0]!.rowCount]).toEqual([true, 0]);
    const ins = await A.txSteps(c, globex, [{ sql: `insert into charge_labels (id, tenant_id, normalized_text, description, category, created_by_id, created_at, updated_by_id, updated_at, version) values (gen_random_uuid(), $1, 'rls probe', 'RLS probe', 'other', $2, now(), $2, now(), 1)`, params: [acme, rvA.user.id] }]);
    expect(ins[0]!.ok, 'insert for another tenant must fail').toBe(false);
    expect(ins[0]!.message).toMatch(/row-level security|violates/i);
    const none = await A.txSteps(c, null, [{ sql: 'select * from charge_labels' }]);
    expect(none[0]!.rowCount).toBe(0);
    const own = await A.txSteps(c, acme, [{ sql: 'select * from charge_labels where id = $1', params: [aId] }]);
    expect(own[0]!.rowCount, 'own tenant sees its row').toBe(1);
    const row = await withAdmin(async (a) => (await a.query('select category, version from charge_labels where id = $1', [aId])).rows[0]);
    expect(row).toEqual({ category: 'accessorial', version: 1 });
  });
});

describe('CI-D02 catalog', () => {
  it('RLS enabled and forced; policy; grants exactly SELECT, INSERT, DELETE + column UPDATE; PUBLIC none', async () => {
    await withAdmin(async (a) => {
      const rel = (await a.query(`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'charge_labels' and relkind = 'r'`)).rows[0];
      expect(rel).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const pol = (await a.query(`select polname, polcmd, pg_get_expr(polqual, polrelid) q, pg_get_expr(polwithcheck, polrelid) w from pg_policy where polrelid = 'charge_labels'::regclass`)).rows;
      expect(pol.map((p: any) => p.polname)).toEqual(['charge_labels_tenant_isolation']);
      expect(pol[0].polcmd).toBe('*');
      expect(pol[0].q).toMatch(/tenant_id = fr_current_tenant\(\)/);
      expect(pol[0].w).toMatch(/tenant_id = fr_current_tenant\(\)/);
      const tp = (await a.query(`select privilege_type from information_schema.role_table_grants where table_name = 'charge_labels' and grantee = 'freight_app' order by 1`)).rows.map((r: any) => r.privilege_type);
      expect(tp).toEqual(['DELETE', 'INSERT', 'SELECT']);
      const cp = (await a.query(`select column_name from information_schema.column_privileges where table_name = 'charge_labels' and grantee = 'freight_app' and privilege_type = 'UPDATE' order by 1`)).rows.map((r: any) => r.column_name);
      expect(cp).toEqual(['category', 'description', 'updated_at', 'updated_by_id', 'version']);
      const pub = (await a.query(`select count(*)::int n from information_schema.role_table_grants where table_name = 'charge_labels' and grantee = 'PUBLIC'`)).rows[0].n;
      expect(pub).toBe(0);
      const trunc = (await a.query(`select has_table_privilege('freight_app', 'charge_labels', 'TRUNCATE') t`)).rows[0].t;
      expect(trunc).toBe(false);
      const bypass = (await a.query(`select rolbypassrls from pg_roles where rolname = 'freight_app'`)).rows[0].rolbypassrls;
      expect(bypass).toBe(false);
    });
  });
  it('freight_app cannot update other columns (tenant_id, normalized_text, id)', async () => {
    for (const col of ['tenant_id = tenant_id', `normalized_text = 'x'`, 'id = id', 'created_by_id = created_by_id']) {
      const o = await A.txSteps(c, acme, [{ sql: `update charge_labels set ${col} where id = $1`, params: [aId] }]);
      expect(o[0]!.ok, col).toBe(false);
      expect(o[0]!.code, col).toBe('42501');
    }
  });
});

describe('CI-D03 CHECKs and uniqueness (as owner, rolled back)', () => {
  const ins = (o: Record<string, unknown>) => ({
    sql: `insert into charge_labels (id, tenant_id, normalized_text, description, category, created_by_id, created_at, updated_by_id, updated_at, version) values (gen_random_uuid(), $1, $2, $3, $4, $5, now(), $5, now(), $6)`,
    params: [acme, o.n ?? 'check probe', o.d ?? 'Check probe', o.c ?? 'other', rvA.user.id, o.v ?? 1],
  });
  it('refusals', async () => {
    await withAdmin(async (a) => {
      const cases: [string, Record<string, unknown>][] = [
        ['category misc', { c: 'misc' }], ['normalized Pallet', { n: 'Pallet' }], ['normalized leading space', { n: ' pallet' }], ['normalized double space', { n: 'a  b' }],
        ['normalized empty', { n: '' }], ['normalized 201', { n: 'a'.repeat(201) }], ['description empty', { d: '' }], ['description 201', { d: 'a'.repeat(201) }], ['version 0', { v: 0 }],
      ];
      for (const [label, o] of cases) {
        const r = await A.txSteps(a, null, [ins(o)]);
        expect(r[0]!.ok, label).toBe(false);
        expect(r[0]!.code, `${label}: ${r[0]!.message}`).toBe('23514');
      }
      const okv = await A.txSteps(a, null, [ins({ n: 'a'.repeat(200), d: 'b'.repeat(200) })]);
      expect(okv[0]!.ok, okv[0]!.message).toBe(true);
      const dup = await A.txSteps(a, null, [ins({ n: 'pallet jack rental' })]);
      expect(dup[0]!.ok).toBe(false);
      expect(dup[0]!.code).toBe('23505');
    });
  });
});

describe('CI-D04 migrations, flag row, reseed', () => {
  it('new folder exists; earlier migrations byte-identical', () => {
    expect(existsSync(resolve(MIG, '20261013000000_charge_intelligence', 'migration.sql'))).toBe(true);
    for (const [dir, sha] of Object.entries(FROZEN)) expect(createHash('sha256').update(readFileSync(resolve(MIG, dir, 'migration.sql'))).digest('hex'), dir).toBe(sha);
  });
  it('feature_flags has the new row (enabled, version 1 after reset)', async () => {
    const r = await withAdmin(async (a) => (await a.query(`select enabled, version from feature_flags where key = 'intelligence.charge_suggestions'`)).rows);
    expect(r).toHaveLength(1);
    expect(r[0].enabled).toBe(true);
    expect(r[0].version).toBeGreaterThanOrEqual(1);
  });
  it('db:seed -- --reset succeeds with labels present', async () => {
    const n0 = await withAdmin(async (a) => (await a.query('select count(*)::int n from charge_labels')).rows[0].n);
    expect(n0).toBeGreaterThan(0);
    reseed(); // throws when the seed command exits non-zero
    const n1 = await withAdmin(async (a) => (await a.query('select count(*)::int n from charge_labels')).rows[0].n);
    console.log(`[CI-D04] charge_labels rows before/after reset: ${n0}/${n1}`);
    const f = await withAdmin(async (a) => (await a.query(`select enabled, version from feature_flags where key = 'intelligence.charge_suggestions'`)).rows[0]);
    expect(f).toEqual({ enabled: true, version: 1 });
  }, 180000);
});
