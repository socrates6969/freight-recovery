// REQ-20261011-fuel-outlook Tier H (written now; run after the owner's go-ahead): T14 database, RLS and cross-tenant
// (CI-D01..D03, CI-D05; Part C F14). CI-D04 (migration files) is Tier L in fuel-static.acc.test.ts. SQL as the
// runtime role freight_app with the tenant set, or as the owner for catalog reads; every write is rolled back.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Session, buildTestApp, closeApps, sessionFor } from './helpers/client.js';
import * as A from './helpers/analysis.js';
import { type PgClient, adminDb, appDb, buildInsert, inRollback, tryQuery, withAdmin } from './helpers/db.js';
import * as H from './helpers/imp.js';
import * as I from './helpers/intel.js';
import { reseed } from './helpers/seed.js';

const T1_BODY = { name: 'DB T1', kind: 'step', unit: 'per_mile', priceSeries: 'diesel_us', effectiveOffsetDays: 2, params: { basePrice: '1.20', stepSize: '0.06', ratePerStep: '0.01', bracket: 'above_base' } };
const GRANTS = {
  fsc_tables: { table: ['INSERT', 'SELECT'], update: ['archived_at', 'effective_offset_days', 'kind', 'name', 'params', 'price_series', 'unit', 'updated_at', 'updated_by_id', 'version'] },
  claim_fuel_inputs: { table: ['DELETE', 'INSERT', 'SELECT'], update: ['fsc_table_id', 'miles', 'ship_date', 'updated_at', 'updated_by_id', 'version'] },
};

let app: FastifyInstance;
let owner: Session, gxo: Session, an: Session, rv: Session;
let tid = '', gtid = '', tA = '', tB = '', claimA = '', userA = '';
let c: PgClient;
let own: PgClient;
async function asTenant(tenant: string | null, sql: string, params?: unknown[]) {
  return inRollback(c, async () => {
    if (tenant) await c.query(`select set_config('app.tenant_id', $1, true)`, [tenant]);
    return tryQuery(c, sql, params);
  });
}
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

beforeAll(async () => {
  await H.assertS3Reachable();
  reseed();
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50', PRICE_CACHE_TTL_MS: '0' });
  owner = await sessionFor(app, ACCOUNTS.OWNER);
  an = await sessionFor(app, ACCOUNTS.ANALYST);
  rv = await sessionFor(app, ACCOUNTS.REVIEWER);
  gxo = await sessionFor(app, I.GLOBEX.OWNER);
  tid = owner.user.tenant.id;
  gtid = gxo.user.tenant.id;
  userA = owner.user.id;
  tA = (await owner.post('/fuel-tables', T1_BODY)).body.id;
  tB = (await gxo.post('/fuel-tables', { ...T1_BODY, name: 'DB T1 Globex' })).body.id;
  const load = H.uniqLoad('FDB');
  const made = await A.makeClaim(an, rv, [A.invoiceFile(load, [['Linehaul', '2150.00'], ['Fuel surcharge', '435.00']], { total: '2585.00' }), A.rateFile(load, { linehaul: '2150.00' })], 'SHIPPER', load);
  claimA = made.claimId;
  expect((await I.put(an, `/claims/${claimA}/fuel-inputs`, { shipDate: '2026-10-07', miles: '500', fscTableId: tA })).status).toBe(200);
  c = await appDb();
  own = await adminDb();
}, 180000);
afterAll(async () => { try { await c.end(); await own.end(); } finally { await closeApps(); reseed(); } });

describe('T14 database (F14)', () => {
  it('CI-D01 RLS enabled + forced with a tenant policy; exact grants to freight_app; no TRUNCATE; DELETE only on claim_fuel_inputs', async () => {
    for (const [t, g] of Object.entries(GRANTS)) {
      const rel = (await own.query(`select relrowsecurity r, relforcerowsecurity f from pg_class where relname = $1 and relkind = 'r'`, [t])).rows[0];
      expect([rel?.r, rel?.f], t).toEqual([true, true]);
      const pol = (await own.query(`select polcmd, pg_get_expr(polqual, polrelid) q, pg_get_expr(polwithcheck, polrelid) w from pg_policy where polrelid = $1::regclass`, [t])).rows as { polcmd: string; q: string | null; w: string | null }[];
      expect(pol.some((p) => p.polcmd === '*' && /app\.tenant_id/.test(p.q ?? '') && /app\.tenant_id/.test(p.w ?? p.q ?? '')), `${t} tenant policy for ALL`).toBe(true);
      const tp = (await own.query(`select privilege_type from information_schema.role_table_grants where table_name = $1 and grantee = 'freight_app' order by 1`, [t])).rows.map((r: { privilege_type: string }) => r.privilege_type);
      expect(tp, `${t} table grants`).toEqual(g.table);
      const cp = (await own.query(`select column_name from information_schema.column_privileges where table_name = $1 and grantee = 'freight_app' and privilege_type = 'UPDATE' order by 1`, [t])).rows.map((r: { column_name: string }) => r.column_name);
      expect(cp, `${t} UPDATE columns`).toEqual(g.update);
      expect((await own.query(`select has_table_privilege('freight_app', $1, 'TRUNCATE') t`, [t])).rows[0].t, `${t} TRUNCATE`).toBe(false);
      expect((await own.query(`select count(*)::int n from information_schema.role_table_grants where table_name = $1 and grantee = 'PUBLIC'`, [t])).rows[0].n, `${t} PUBLIC`).toBe(0);
    }
    for (const t of ['price_imports', 'price_observations']) {
      const rel = (await own.query(`select relrowsecurity r, relforcerowsecurity f from pg_class where relname = $1 and relkind = 'r'`, [t])).rows[0];
      expect([rel?.r, rel?.f], t).toEqual([true, true]);
      const tp = (await own.query(`select privilege_type from information_schema.role_table_grants where table_name = $1 and grantee = 'freight_app' order by 1`, [t])).rows.map((r: { privilege_type: string }) => r.privilege_type);
      expect(tp, `${t}: SELECT only`).toEqual(['SELECT']);
    }
    const role = (await own.query(`select rolbypassrls from pg_roles where rolname = 'freight_app'`)).rows[0];
    expect(role?.rolbypassrls).toBe(false);
  });
  it('CI-D02 cross-tenant: tenant A cannot see, insert, update or delete tenant B rows; no tenant -> nothing visible; composite FK', async () => {
    for (const t of ['fsc_tables', 'claim_fuel_inputs']) {
      const none = await asTenant(null, `select count(*)::int n from ${t}`);
      expect(none.ok ? Number(none.rows[0].n) : 0, `${t} without app.tenant_id`).toBe(0);
    }
    const seeB = await asTenant(tid, 'select id from fsc_tables where id = $1', [tB]);
    expect(seeB.rows).toEqual([]);
    expect((await asTenant(tid, 'select id from fsc_tables where id = $1', [tA])).rows).toHaveLength(1);
    expect((await asTenant(tid, `update fsc_tables set version = version where id = $1`, [tB])).rowCount).toBe(0);
    expect((await asTenant(gtid, `select claim_id from claim_fuel_inputs where claim_id = $1`, [claimA])).rows).toEqual([]);
    expect((await asTenant(gtid, `delete from claim_fuel_inputs where claim_id = $1`, [claimA])).rowCount).toBe(0);
    const ins = await inRollback(c, async () => {
      await c.query(`select set_config('app.tenant_id', $1, true)`, [tid]);
      const sql = await buildInsert(c, 'fsc_tables', { tenant_id: lit(gtid), name: `'cross'`, kind: `'step'`, unit: `'per_mile'`, price_series: `'diesel_us'`, effective_offset_days: '2', params: `'${JSON.stringify(T1_BODY.params)}'::jsonb`, version: '1' });
      return tryQuery(c, sql);
    });
    expect(ins.ok, 'insert with another tenant_id is refused').toBe(false);
    const fk = await inRollback(own, async () => {
      await own.query(`select set_config('app.tenant_id', $1, true)`, [tid]);
      await own.query('delete from claim_fuel_inputs where claim_id = $1', [claimA]);
      const sql = await buildInsert(own, 'claim_fuel_inputs', { tenant_id: lit(tid), claim_id: lit(claimA), ship_date: `'2026-10-07'`, miles: '500.0', fsc_table_id: lit(tB), version: '1', created_by_id: lit(userA) });
      return tryQuery(own, sql);
    });
    expect(fk.ok, 'inputs pointing to another tenant table are refused').toBe(false);
  });
  it('CI-D03 CHECK constraints refuse invalid rows', async () => {
    const base = { tenant_id: lit(tid), name: `'chk base'`, kind: `'step'`, unit: `'per_mile'`, price_series: `'diesel_us'`, effective_offset_days: '2', params: `'${JSON.stringify(T1_BODY.params)}'::jsonb`, version: '1', created_by_id: lit(userA) };
    const tryFsc = (o: Record<string, string>) => inRollback(own, async () => {
      await own.query(`select set_config('app.tenant_id', $1, true)`, [tid]);
      return tryQuery(own, await buildInsert(own, 'fsc_tables', { ...base, ...o }));
    });
    expect((await tryFsc({})).ok, 'baseline row is valid').toBe(true);
    for (const [label, o] of [['kind x', { kind: `'x'` }], ['mpg + percent', { kind: `'mpg'`, unit: `'percent'`, params: `'{"basePrice":"1.25","mpg":"6","decimals":2}'::jsonb` }], ['offset 7', { effective_offset_days: '7' }], ['params array', { params: `'[]'::jsonb` }], ['price_series ppi_tl', { price_series: `'ppi_tl'` }], ['version 0', { version: '0' }], ['name 81', { name: lit('x'.repeat(81)) }]] as const) {
      expect((await tryFsc(o)).ok, label).toBe(false);
    }
    const baseIn = { tenant_id: lit(tid), claim_id: lit(claimA), ship_date: `'2026-10-07'`, miles: '500.0', fsc_table_id: lit(tA), version: '1', created_by_id: lit(userA) };
    const tryIn = (o: Record<string, string>) => inRollback(own, async () => {
      await own.query(`select set_config('app.tenant_id', $1, true)`, [tid]);
      await own.query('delete from claim_fuel_inputs where claim_id = $1', [claimA]);
      return tryQuery(own, await buildInsert(own, 'claim_fuel_inputs', { ...baseIn, ...o }));
    });
    expect((await tryIn({})).ok, 'baseline inputs row is valid').toBe(true);
    expect((await tryIn({ miles: '0' })).ok, 'miles 0').toBe(false);
    expect((await tryIn({ miles: '10000.1' })).ok, 'miles 10000.1').toBe(false);
    const defs = (await own.query(`select conrelid::regclass::text t, pg_get_constraintdef(oid) d from pg_constraint where contype = 'c' and conrelid in ('price_imports'::regclass, 'price_observations'::regclass)`)).rows as { t: string; d: string }[];
    expect(defs.some((x) => x.t === 'price_imports' && x.d.includes('https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASDESW')), 'price_imports pinned-URL CHECK').toBe(true);
    expect(defs.some((x) => x.t === 'price_observations' && /value\s*>\s*\(?0/.test(x.d)), 'price_observations value > 0 CHECK').toBe(true);
    const badUrl = await inRollback(own, async () => tryQuery(own, `insert into price_imports (id, series_key, source_kind, source_url, retrieved_at, sha256, row_count, first_date, last_date) values (gen_random_uuid(), 'diesel_us', 'file', 'https://example.com/x.csv', '2026-10-11', repeat('a', 64), 1, '2026-10-05', '2026-10-05')`));
    expect(badUrl.ok, 'non-pinned URL refused').toBe(false);
  });
  it('CI-D05 db:seed --reset with fuel tables and inputs present succeeds; price tables untouched', async () => {
    const before = await withAdmin((x) => I.rowCounts(x, ['price_imports', 'price_observations']));
    const n = await withAdmin(async (x) => (await x.query('select count(*)::int n from claim_fuel_inputs')).rows[0].n as number);
    expect(n).toBeGreaterThan(0);
    reseed();
    expect(await withAdmin((x) => I.rowCounts(x, ['price_imports', 'price_observations']))).toEqual(before);
  }, 300000);
});
