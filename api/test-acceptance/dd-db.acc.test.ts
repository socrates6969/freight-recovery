// REQ-20261011-ocean-dd Tier H (written now; run after the owner's go-ahead): T10 database (DD-DB01..DB05; Part C C11).
// SQL as the runtime role freight_app with the tenant set, or as the owner where stated; every write is rolled back.
// Rows are created through the API first (a tariff, a calendar, a DRAFT and an AUDITED invoice per tenant).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Session, buildTestApp, closeApps, sessionFor } from './helpers/client.js';
import * as D from './helpers/dd.js';
import { type PgClient, adminDb, appDb, buildInsert, inRollback, tryQuery, withAdmin } from './helpers/db.js';
import * as I from './helpers/intel.js';
import { reseed } from './helpers/seed.js';

const TABLES = ['dd_tariffs', 'dd_calendars', 'dd_invoices'] as const;
const GRANTS: Record<string, { table: string[]; update: string[] }> = {
  dd_tariffs: { table: ['INSERT', 'SELECT'], update: ['carrier', 'charge_type', 'data', 'direction', 'name', 'updated_at', 'updated_by_id', 'version'] },
  dd_calendars: { table: ['INSERT', 'SELECT'], update: ['data', 'name', 'updated_at', 'updated_by_id', 'version'] },
  dd_invoices: { table: ['DELETE', 'INSERT', 'SELECT'], update: ['audit_snapshot', 'audited_at', 'billing_party_name', 'calendar_id', 'claim_id', 'data', 'invoice_date', 'invoice_number', 'status', 'tariff_id', 'total_due_cents', 'updated_at', 'updated_by_id', 'version'] },
};
let app: FastifyInstance;
let owner: Session, an: Session, gxo: Session;
let tid = '', gtid = '', userA = '';
const A: Record<string, string> = {};
const B: Record<string, string> = {};
let c: PgClient;
let own: PgClient;
const lit = I.lit;
async function asTenant(cl: PgClient, tenant: string | null, sql: string, params?: unknown[]) {
  return inRollback(cl, async () => {
    if (tenant) await cl.query(`select set_config('app.tenant_id', $1, true)`, [tenant]);
    return tryQuery(cl, sql, params);
  });
}

beforeAll(async () => {
  reseed();
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
  owner = await sessionFor(app, ACCOUNTS.OWNER);
  an = await sessionFor(app, ACCOUNTS.ANALYST);
  gxo = await sessionFor(app, I.GLOBEX.OWNER);
  tid = owner.user.tenant.id;
  gtid = gxo.user.tenant.id;
  userA = owner.user.id;
  for (const [s, rec, sfx] of [[owner, A, 'A'], [gxo, B, 'B']] as const) {
    rec.tariff = await D.newTariff(s, { ...D.MAERSK, name: `DB tariff ${sfx}` });
    rec.calendar = await D.newCalendar(s, { ...D.HAPAG_CAL, name: `DB calendar ${sfx}` });
    rec.draft = (await D.newInvoice(s === owner ? an : s, { ...D.si1(), invoiceNumber: `SYN-DD-DB-D${sfx}` }, rec.tariff)).id;
    rec.audited = (await D.newInvoice(s === owner ? an : s, { ...D.si4(), invoiceNumber: `SYN-DD-DB-A${sfx}` }, rec.tariff)).id;
    const r = await D.audit(s === owner ? an : s, rec.audited);
    expect(r.status, r.text).toBe(201);
    rec.ddClaim = r.body.claim.id;
  }
  A.freightClaim = await withAdmin(async (x) => (await x.query(`select id from claims where tenant_id = $1 and kind = 'FREIGHT' order by claim_number limit 1`, [tid])).rows[0].id as string);
  c = await appDb();
  own = await adminDb();
}, 180000);
afterAll(async () => { try { await c.end(); await own.end(); } finally { await closeApps(); reseed(); } });

describe('T10 database (C11)', () => {
  it('DD-DB01 RLS enabled + forced, one policy <table>_tenant_isolation, exact grants, no TRUNCATE, no PUBLIC; other columns not updatable', async () => {
    for (const t of TABLES) {
      const rel = (await own.query(`select relrowsecurity r, relforcerowsecurity f from pg_class where relname = $1 and relkind = 'r'`, [t])).rows[0];
      expect([rel?.r, rel?.f], t).toEqual([true, true]);
      const pol = (await own.query(`select policyname, cmd, qual, with_check from pg_policies where tablename = $1`, [t])).rows as { policyname: string; cmd: string; qual: string; with_check: string }[];
      expect(pol.map((p) => [p.policyname, p.cmd]), t).toEqual([[`${t}_tenant_isolation`, 'ALL']]);
      expect(pol[0]?.qual, t).toMatch(/tenant_id = fr_current_tenant\(\)/);
      expect(pol[0]?.with_check, t).toMatch(/tenant_id = fr_current_tenant\(\)/);
      const tp = (await own.query(`select privilege_type from information_schema.role_table_grants where table_name = $1 and grantee = 'freight_app' order by 1`, [t])).rows.map((r: { privilege_type: string }) => r.privilege_type);
      expect(tp, `${t} table grants`).toEqual(GRANTS[t]?.table);
      const cp = (await own.query(`select column_name from information_schema.column_privileges where table_name = $1 and grantee = 'freight_app' and privilege_type = 'UPDATE' order by 1`, [t])).rows.map((r: { column_name: string }) => r.column_name);
      expect(cp, `${t} UPDATE columns`).toEqual(GRANTS[t]?.update);
      expect((await own.query(`select has_table_privilege('freight_app', $1, 'TRUNCATE') t`, [t])).rows[0].t, `${t} TRUNCATE`).toBe(false);
      expect((await own.query(`select count(*)::int n from information_schema.role_table_grants where table_name = $1 and grantee = 'PUBLIC'`, [t])).rows[0].n, `${t} PUBLIC`).toBe(0);
      for (const col of ['tenant_id', 'created_by_id', 'id']) {
        const r = await asTenant(c, tid, `update ${t} set ${col} = ${col} where id = $1`, [t === 'dd_invoices' ? A.draft : t === 'dd_tariffs' ? A.tariff : A.calendar]);
        expect(r.ok, `${t}.${col} not updatable`).toBe(false);
        expect(r.error).toMatch(/permission denied/i);
      }
    }
    expect((await own.query(`select rolbypassrls from pg_roles where rolname = 'freight_app'`)).rows[0]?.rolbypassrls).toBe(false);
  });
  it('DD-DB02 cross-tenant: invisible, no insert with B tenant id, update/delete of B rows affect 0 rows; no tenant -> nothing visible', async () => {
    for (const t of TABLES) {
      const none = await asTenant(c, null, `select count(*)::int n from ${t}`);
      expect(none.ok ? Number(none.rows[0].n) : 0, `${t} without app.tenant_id`).toBe(0);
    }
    for (const [t, idA, idB] of [['dd_tariffs', A.tariff, B.tariff], ['dd_calendars', A.calendar, B.calendar], ['dd_invoices', A.draft, B.draft]] as const) {
      expect((await asTenant(c, tid, `select id from ${t} where id = $1`, [idB])).rows, `${t} B invisible`).toEqual([]);
      expect((await asTenant(c, tid, `select id from ${t} where id = $1`, [idA])).rows, `${t} A visible`).toHaveLength(1);
      expect((await asTenant(c, tid, `update ${t} set version = version where id = $1`, [idB])).rowCount, `${t} update B`).toBe(0);
    }
    expect((await asTenant(c, tid, `delete from dd_invoices where id = $1`, [B.draft])).rowCount).toBe(0);
    const ins = await inRollback(c, async () => {
      await c.query(`select set_config('app.tenant_id', $1, true)`, [tid]);
      return tryQuery(c, await buildInsert(c, 'dd_calendars', { tenant_id: lit(gtid), name: `'cross'`, data: `'${JSON.stringify({ name: 'cross', closedDates: [], shutoutDates: [] })}'::jsonb`, created_by_id: lit(userA), updated_by_id: lit(userA) }));
    });
    expect(ins.ok, 'insert with another tenant_id is refused').toBe(false);
  });
  it('DD-DB03 triggers and CHECKs: AUDITED insert refused; AUDITED update/delete refused even as owner; FREIGHT claim refused; claims.kind immutable', async () => {
    const auditedIns = await inRollback(own, async () => {
      await own.query(`select set_config('app.tenant_id', $1, true)`, [tid]);
      return tryQuery(own, await buildInsert(own, 'dd_invoices', { tenant_id: lit(tid), status: `'AUDITED'`, invoice_number: `'SYN-DD-DB-X'`, billing_party_name: `'Synthetic'`, data: `'{}'::jsonb`, claim_id: lit(B.ddClaim ?? ''), audited_at: 'now()', audit_snapshot: `'{}'::jsonb`, created_by_id: lit(userA), updated_by_id: lit(userA) }));
    });
    expect(auditedIns.ok).toBe(false);
    for (const cl of [c, own]) {
      const up = await asTenant(cl, tid, `update dd_invoices set version = version + 1 where id = $1`, [A.audited]);
      expect(up.ok, 'update of an AUDITED invoice').toBe(false);
      expect(up.error).toContain('dd_invoice_immutable');
      const del = await asTenant(cl, tid, `delete from dd_invoices where id = $1`, [A.audited]);
      expect(del.ok, 'delete of an AUDITED invoice').toBe(false);
      expect(del.error).toContain('dd_invoice_immutable');
      const kind = await asTenant(cl, tid, `update claims set kind = 'FREIGHT' where id = $1`, [A.ddClaim]);
      expect(kind.ok, 'claims.kind change').toBe(false);
      if (cl === own) expect(kind.error).toContain('claim_kind_immutable');
    }
    const kindOwner = await asTenant(own, tid, `update claims set kind = 'OCEAN_DD' where id = $1`, [A.freightClaim]);
    expect(kindOwner.ok).toBe(false);
    expect(kindOwner.error).toContain('claim_kind_immutable');
    const freight = await asTenant(own, tid, `update dd_invoices set status = 'AUDITED', claim_id = $2, audited_at = now(), audit_snapshot = '{}'::jsonb where id = $1`, [A.draft, A.freightClaim]);
    expect(freight.ok, 'AUDITED with a FREIGHT claim').toBe(false);
    const noSnap = await asTenant(own, tid, `update dd_invoices set status = 'AUDITED', claim_id = $2, audited_at = now() where id = $1`, [A.draft, A.ddClaim]);
    expect(noSnap.ok, 'AUDITED without snapshot').toBe(false);
    const badStatus = await asTenant(own, tid, `update dd_invoices set status = 'SENT' where id = $1`, [A.draft]);
    expect(badStatus.ok, 'status outside DRAFT/AUDITED').toBe(false);
  });
  it('DD-DB04 composite references stay inside the tenant (even as owner)', async () => {
    for (const [col, val] of [['tariff_id', B.tariff], ['calendar_id', B.calendar]] as const) {
      const r = await asTenant(own, tid, `update dd_invoices set ${col} = $2 where id = $1`, [A.draft, val]);
      expect(r.ok, `${col} -> other tenant`).toBe(false);
    }
    const ins = await inRollback(own, async () => {
      await own.query(`select set_config('app.tenant_id', $1, true)`, [tid]);
      return tryQuery(own, await buildInsert(own, 'dd_invoices', { tenant_id: lit(tid), invoice_number: `'SYN-DD-DB-FK'`, billing_party_name: `'Synthetic'`, data: `'{}'::jsonb`, tariff_id: lit(B.tariff ?? ''), created_by_id: lit(userA), updated_by_id: lit(userA) }));
    });
    expect(ins.ok, 'insert referencing another tenant tariff').toBe(false);
  });
  it('DD-DB05 seeded claims are FREIGHT; flag row intelligence.ocean_dd enabled version 1', async () => {
    const kinds = await withAdmin(async (x) => (await x.query(`select kind::text k, count(*)::int n from claims where invoice_number not like 'SYN-DD-%' or invoice_number is null group by 1`)).rows);
    expect(kinds.map((k: { k: string }) => k.k)).toEqual(['FREIGHT']);
    const f = await withAdmin(async (x) => (await x.query(`select enabled, version from feature_flags where key = 'intelligence.ocean_dd'`)).rows);
    expect(f).toEqual([{ enabled: true, version: 1 }]);
  });
});
