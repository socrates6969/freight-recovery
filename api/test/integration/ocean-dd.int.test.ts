/**
 * Integration (real PostgreSQL, migrated + seeded): step 8 ocean D&D audit (REQ-20261011-ocean-dd, Part C
 * C11-C17). Written by the builder; run only with the owner's go-ahead (Tier H).
 * - database: RLS ENABLE + FORCE, the one tenant policy and the exact grants of dd_tariffs / dd_calendars /
 *   dd_invoices (no TRUNCATE, refused UPDATE columns), cross-tenant read/update/delete refusal as
 *   freight_app, no rows without app.tenant_id, triggers (insert AUDITED refused, AUDITED update/delete
 *   refused, claims.kind change refused, AUDITED with a FREIGHT claim refused), the flag row, claims.kind;
 * - routes: tariffs/calendars CRUD + audit key sets, cap, stale/conflict; invoices CRUD, reference 400s,
 *   AUDITED 409s; audit run -> OCEAN_DD claim + packet revision 1 + `dd_invoice.audited`; step-5 analyze
 *   refuses OCEAN_DD (409); four-eyes (the auditor cannot approve; another approver can); audit chain still
 *   verifies; RBAC (VIEWER/ANALYST); API keys 403; flag OFF 404; byte-identical cross-tenant 404.
 */
import { createHash, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { ApiKeyCreated, DD_INVOICE_PAGE_SIZE_MAX, DD_TARIFF_PRESETS, DdAuditResponse, DdCalendarView, DdInvoiceDetail, DdInvoiceList, DdTariffList, DdTariffView, canonicalJson } from '@fr/shared';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';

import { Client, adminUrl, appUrl, canRunDb, step4Env } from './step4-helpers.js';

type Inject = Awaited<ReturnType<FastifyInstance['inject']>>;
const errorOf = (r: Inject) => (r.json() as { error: { code: string; message: string; details?: { path: string; code: string }[] } }).error;
const marker = `zz dd ${Date.now().toString(36)}`;
const REASON = 'Checked against the original invoice.';
const sha = (v: unknown): string => createHash('sha256').update(canonicalJson(v), 'utf8').digest('hex');
const MAERSK = DD_TARIFF_PRESETS[0]?.data;

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

/** A synthetic invoice body (Maersk 40DV detention charged at $290/day). */
function invoiceBody(number: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    invoiceNumber: number,
    billingPartyName: `${marker} line`,
    billingPartyType: 'OCEAN_CARRIER',
    billedPartyName: 'Example Importer LLC',
    direction: 'IMPORT',
    invoiceDate: '2026-03-25',
    dueDate: '2026-04-24',
    upstreamInvoiceDate: null,
    billOfLadingNumbers: ['SYNBL0001'],
    portOfDischarge: 'Port of Example',
    liabilityBasis: 'Consignee named on the bill of lading',
    totalDue: '4350.00',
    ruleReference: 'Synthetic tariff rule 1',
    disputeContact: 'disputes@example.test',
    disputeDigitalMeans: 'https://example.test/dd-disputes',
    disputeRequestDays: 30,
    disputeResolutionDays: 30,
    certifiesFmcRules: true,
    certifiesPerformance: true,
    containers: [
      {
        containerNumber: 'SYNU0000001',
        sizeType: '40DV',
        chargeType: 'DETENTION',
        freeDays: 4,
        freeTimeStart: '2026-03-02',
        freeTimeEnd: '2026-03-05',
        availabilityDate: '2026-03-01',
        earliestReturnDate: null,
        periods: [{ from: '2026-03-06', to: '2026-03-20', rate: '290.00', amount: '4350.00' }],
        evidence: { clockStart: null, clockStop: null, cargoAvailableDate: null, emptyReturnRefusedDates: [] },
      },
    ],
    tariffId: null,
    calendarId: null,
    ...over,
  };
}

async function insertDraft(tenant: string, user: string, number: string): Promise<string> {
  const id = randomUUID();
  const { tariffId: _t, calendarId: _c, ...data } = invoiceBody(number);
  await admin.query(
    `INSERT INTO dd_invoices (id, tenant_id, invoice_number, billing_party_name, data, created_by_id, updated_by_id, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6, now())`,
    [id, tenant, number, `${marker} line`, JSON.stringify(data), user],
  );
  return id;
}

async function insertClaim(tenant: string, kind: 'FREIGHT' | 'OCEAN_DD'): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `INSERT INTO claims (id, tenant_id, claim_number, kind, carrier_name, shipper_name, perspective, status, amount_claimed_cents, recoverable_cents, pending_review_cents, updated_at)
     VALUES ($1, $2, $3, $4, '', '', 'SHIPPER', 'PENDING_REVIEW', 0, 0, 0, now())`,
    [id, tenant, `DD-${randomUUID().slice(0, 8)}`, kind],
  );
  return id;
}

/**
 * P0001 message of a statement run as the owner (admin) connection in its own transaction (committed on
 * success, rolled back on error), or null. Fix: SAVEPOINT needs a transaction block (first DB run).
 */
async function raise(sql: string, params: unknown[]): Promise<string | null> {
  await admin.query('BEGIN');
  try {
    await admin.query(sql, params);
    await admin.query('COMMIT');
    return null;
  } catch (e) {
    await admin.query('ROLLBACK');
    return (e as { code?: string; message?: string }).code === 'P0001' ? ((e as { message: string }).message ?? null) : `other: ${(e as Error).message}`;
  }
}

describe.skipIf(!canRunDb)('ocean D&D audit (PostgreSQL)', () => {
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
    await admin.query('BEGIN');
    await admin.query('SET LOCAL session_replication_role = replica');
    const created = await admin.query<{ claim_id: string | null }>(`SELECT claim_id FROM dd_invoices WHERE billing_party_name LIKE $1`, [`${marker}%`]);
    const ids = [...claims, ...created.rows.flatMap((r) => (r.claim_id ? [r.claim_id] : []))];
    await admin.query(`DELETE FROM dd_invoices WHERE billing_party_name LIKE $1 OR claim_id = ANY($2::uuid[])`, [`${marker}%`, ids]);
    await admin.query(`DELETE FROM approvals WHERE claim_id = ANY($1::uuid[])`, [ids]);
    for (const tbl of ['packet_findings', 'packet_sources', 'packet_timeline_events']) {
      await admin.query(`DELETE FROM ${tbl} WHERE packet_id IN (SELECT id FROM evidence_packets WHERE claim_id = ANY($1::uuid[]))`, [ids]);
    }
    await admin.query(`DELETE FROM evidence_packets WHERE claim_id = ANY($1::uuid[])`, [ids]);
    await admin.query(`DELETE FROM claims WHERE id = ANY($1::uuid[])`, [ids]);
    await admin.query(`DELETE FROM dd_calendars WHERE name LIKE $1`, [`${marker}%`]);
    await admin.query(`DELETE FROM dd_tariffs WHERE name LIKE $1`, [`${marker}%`]);
    await admin.query('COMMIT');
    await app.end();
    await admin.end();
  });

  describe('database guarantees', () => {
    it('RLS forced, one tenant policy, exact grants (no TRUNCATE); flag row; claims.kind', async () => {
      for (const [table, privileges, updatable] of [
        ['dd_tariffs', ['INSERT', 'SELECT'], ['carrier', 'charge_type', 'data', 'direction', 'name', 'updated_at', 'updated_by_id', 'version']],
        ['dd_calendars', ['INSERT', 'SELECT'], ['data', 'name', 'updated_at', 'updated_by_id', 'version']],
        [
          'dd_invoices',
          ['DELETE', 'INSERT', 'SELECT'],
          ['audit_snapshot', 'audited_at', 'billing_party_name', 'calendar_id', 'claim_id', 'data', 'invoice_date', 'invoice_number', 'status', 'tariff_id', 'total_due_cents', 'updated_at', 'updated_by_id', 'version'],
        ],
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
        await expect(asApp(acme, (c) => c.query(`TRUNCATE ${table}`))).rejects.toThrow(/permission denied/u);
      }
      const flag = await admin.query(`SELECT key, enabled, version FROM feature_flags WHERE key = 'intelligence.ocean_dd'`);
      expect(flag.rows).toEqual([{ key: 'intelligence.ocean_dd', enabled: true, version: 1 }]);
      const kind = await admin.query(`SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'kind'`);
      expect(kind.rows[0]).toMatchObject({ is_nullable: 'NO' });
      expect(String((kind.rows[0] as { column_default: string }).column_default)).toContain('FREIGHT');
      const fks = await admin.query<{ conname: string; confdeltype: string }>(`SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = 'dd_invoices'::regclass AND contype = 'f' ORDER BY conname`);
      expect(fks.rows.every((r) => r.confdeltype === 'r')).toBe(true);
    });

    it('as freight_app: own-tenant rows only; cross-tenant insert/update/delete refused; nothing without app.tenant_id', async () => {
      const gInv = await insertDraft(globex, globexOwnerId, `${marker}-G1`);
      expect((await asApp(null, (c) => c.query(`SELECT id FROM dd_invoices WHERE id = $1`, [gInv]))).rowCount).toBe(0);
      expect((await asApp(acme, (c) => c.query(`SELECT id FROM dd_invoices WHERE id = $1`, [gInv]))).rowCount).toBe(0);
      expect((await asApp(globex, (c) => c.query(`SELECT id FROM dd_invoices WHERE id = $1`, [gInv]))).rowCount).toBe(1);
      expect((await asApp(acme, (c) => c.query(`UPDATE dd_invoices SET invoice_number = 'x' WHERE id = $1`, [gInv]))).rowCount).toBe(0);
      expect((await asApp(acme, (c) => c.query(`DELETE FROM dd_invoices WHERE id = $1`, [gInv]))).rowCount).toBe(0);
      await expect(asApp(globex, (c) => c.query(`UPDATE dd_invoices SET tenant_id = $1 WHERE id = $2`, [acme, gInv]))).rejects.toThrow(/permission denied/u);
      await expect(asApp(globex, (c) => c.query(`UPDATE dd_invoices SET created_by_id = $1 WHERE id = $2`, [ownerId, gInv]))).rejects.toThrow(/permission denied/u);
      for (const [table, cols, vals] of [
        ['dd_tariffs', 'id, tenant_id, name, carrier, charge_type, direction, data, created_by_id, updated_by_id, updated_at', `$1, $2, 'x', 'x', 'DETENTION', 'IMPORT', '{}'::jsonb, $3, $3, now()`],
        ['dd_calendars', 'id, tenant_id, name, data, created_by_id, updated_by_id, updated_at', `$1, $2, 'x', '{}'::jsonb, $3, $3, now()`],
        ['dd_invoices', 'id, tenant_id, invoice_number, billing_party_name, data, created_by_id, updated_by_id, updated_at', `$1, $2, 'x', 'x', '{}'::jsonb, $3, $3, now()`],
      ] as const) {
        await expect(asApp(acme, (c) => c.query(`INSERT INTO ${table} (${cols}) VALUES (${vals})`, [randomUUID(), globex, ownerId]))).rejects.toThrow(/row-level security/u);
        await expect(asApp(acme, (c) => c.query(`UPDATE ${table} SET tenant_id = $1`, [globex]))).rejects.toThrow(/permission denied/u);
      }
      await expect(asApp(acme, (c) => c.query(`UPDATE dd_tariffs SET created_at = now()`))).rejects.toThrow(/permission denied/u);
      await expect(asApp(acme, (c) => c.query(`DELETE FROM dd_tariffs`))).rejects.toThrow(/permission denied/u);
      await expect(asApp(acme, (c) => c.query(`DELETE FROM dd_calendars`))).rejects.toThrow(/permission denied/u);
    });

    it('triggers: insert AUDITED, AUDITED update/delete, kind change and AUDITED with a FREIGHT claim are refused', async () => {
      const freight = await insertClaim(acme, 'FREIGHT');
      const ocean = await insertClaim(acme, 'OCEAN_DD');
      claims.push(freight, ocean);
      const { tariffId: _t, calendarId: _c, ...data } = invoiceBody(`${marker}-T0`);
      expect(
        await raise(
          `INSERT INTO dd_invoices (id, tenant_id, status, invoice_number, billing_party_name, data, claim_id, audited_at, audit_snapshot, created_by_id, updated_by_id, updated_at)
           VALUES ($1, $2, 'AUDITED', $3, $4, $5::jsonb, $6, now(), '{}'::jsonb, $7, $7, now())`,
          [randomUUID(), acme, `${marker}-T0`, `${marker} line`, JSON.stringify(data), ocean, ownerId],
        ),
      ).toBe('dd_invoice_insert_invalid');
      const inv = await insertDraft(acme, ownerId, `${marker}-T1`);
      expect(await raise(`UPDATE dd_invoices SET status = 'AUDITED', claim_id = $2, audited_at = now(), audit_snapshot = '{}'::jsonb WHERE id = $1`, [inv, freight])).toBe('dd_invoice_claim_invalid');
      expect(await raise(`UPDATE dd_invoices SET status = 'AUDITED', claim_id = $2, audited_at = now(), audit_snapshot = '{}'::jsonb WHERE id = $1`, [inv, ocean])).toBeNull();
      expect(await raise(`UPDATE dd_invoices SET invoice_number = 'changed' WHERE id = $1`, [inv])).toBe('dd_invoice_immutable');
      expect(await raise(`DELETE FROM dd_invoices WHERE id = $1`, [inv])).toBe('dd_invoice_immutable');
      expect(await raise(`UPDATE claims SET kind = 'FREIGHT' WHERE id = $1`, [ocean])).toBe('claim_kind_immutable');
      expect(await raise(`UPDATE claims SET kind = 'OCEAN_DD' WHERE id = $1`, [freight])).toBe('claim_kind_immutable');
    });
  });

  describe('routes', () => {
    let fastify: FastifyInstance;
    let c: Client;
    const tok = { owner: '', admin: '', manager: '', reviewer: '', analyst: '', viewer: '', globexOwner: '' };

    beforeAll(async () => {
      fastify = await buildApp(step4Env(), { logStream: new Writable({ write: (_c, _e, cb) => cb() }) });
      await fastify.ready();
      c = await new Client(fastify).init();
      tok.owner = await c.login('owner@acme.test');
      tok.manager = await c.login('manager@acme.test');
      tok.admin = await c.login('admin@acme.test');
      tok.reviewer = await c.login('reviewer@acme.test');
      tok.analyst = await c.login('analyst@acme.test');
      tok.viewer = await c.login('viewer@acme.test');
      tok.globexOwner = await c.login('owner@globex.test');
    }, 180_000);

    afterAll(async () => {
      await fastify?.close();
    });

    const del = (url: string, token?: string) => fastify.inject({ method: 'DELETE', url, headers: c.headers(token) });

    it('tariffs and calendars: create 201, conflict, stale, update increments, audit key sets, RBAC', async () => {
      const tariffBody = { ...MAERSK, name: `${marker} maersk` };
      const created = await c.send('POST', '/api/v1/dd/tariffs', tok.reviewer, tariffBody);
      expect(created.statusCode, created.body).toBe(201);
      const t = DdTariffView.parse(created.json());
      expect(t.version).toBe(1);
      expect([(await c.send('POST', '/api/v1/dd/tariffs', tok.reviewer, tariffBody)).statusCode]).toEqual([409]);
      expect(errorOf(await c.send('POST', '/api/v1/dd/tariffs', tok.analyst, { ...tariffBody, name: `${marker} x` })).code).toBe('forbidden');
      const upd = await c.send('PUT', `/api/v1/dd/tariffs/${t.id}`, tok.owner, { version: 1, data: { ...tariffBody, freeDays: 5 } });
      expect(DdTariffView.parse(upd.json())).toMatchObject({ version: 2 });
      const stale = await c.send('PUT', `/api/v1/dd/tariffs/${t.id}`, tok.owner, { version: 1, data: tariffBody });
      expect([stale.statusCode, errorOf(stale).code]).toEqual([409, 'stale_revision']);
      expect(await auditOf('dd_tariff.created', t.id)).toEqual([{ tariffId: t.id, version: 1, chargeType: 'DETENTION', direction: 'IMPORT', tierCount: 3, dataSha256: sha(t.data) }]);
      expect((await auditOf('dd_tariff.updated', t.id)).map((m) => Object.keys(m).sort())).toEqual([['chargeType', 'dataSha256', 'direction', 'tariffId', 'tierCount', 'version']]);
      const list = DdTariffList.parse((await c.get('/api/v1/dd/tariffs?pageSize=100', tok.viewer)).json());
      expect(list.items.some((x) => x.id === t.id)).toBe(true);
      const cal = await c.send('POST', '/api/v1/dd/calendars', tok.manager, { name: `${marker} cal`, closedDates: ['2026-05-25'], shutoutDates: [] });
      expect(cal.statusCode, cal.body).toBe(201);
      const cv = DdCalendarView.parse(cal.json());
      expect(await auditOf('dd_calendar.created', cv.id)).toEqual([{ calendarId: cv.id, version: 1, closedCount: 1, shutoutCount: 0, dataSha256: sha(cv.data) }]);
      const cross = await c.send('PUT', `/api/v1/dd/tariffs/${t.id}`, tok.globexOwner, { version: 2, data: tariffBody });
      const unknown = await c.send('PUT', `/api/v1/dd/tariffs/${randomUUID()}`, tok.globexOwner, { version: 2, data: tariffBody });
      expect([cross.statusCode, unknown.statusCode]).toEqual([404, 404]);
      expect(cross.body.replace(/"requestId":"[^"]*"/u, '')).toBe(unknown.body.replace(/"requestId":"[^"]*"/u, ''));
    });

    it('the cap of 200 tariffs is enforced under concurrency (dd_limit_reached)', async () => {
      const have = Number((await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM dd_tariffs WHERE tenant_id = $1`, [acme])).rows[0]?.n ?? '0');
      for (let i = have; i < 198; i += 1) {
        await admin.query(
          `INSERT INTO dd_tariffs (id, tenant_id, name, carrier, charge_type, direction, data, created_by_id, updated_by_id, updated_at)
           VALUES ($1, $2, $3, 'x', 'DETENTION', 'IMPORT', $4::jsonb, $5, $5, now())`,
          [randomUUID(), acme, `${marker} cap ${i}`, JSON.stringify({ ...MAERSK, name: `${marker} cap ${i}` }), ownerId],
        );
      }
      const results = await Promise.all([0, 1, 2, 3].map((i) => c.send('POST', '/api/v1/dd/tariffs', tok.owner, { ...MAERSK, name: `${marker} race ${i}` })));
      expect(results.filter((r) => r.statusCode === 201)).toHaveLength(Math.max(0, 200 - Math.max(have, 198)));
      for (const r of results.filter((x) => x.statusCode !== 201)) expect([r.statusCode, errorOf(r).code]).toEqual([409, 'dd_limit_reached']);
      await admin.query(`DELETE FROM dd_tariffs WHERE name LIKE $1 OR name LIKE $2`, [`${marker} cap%`, `${marker} race%`]);
    });

    it('invoices: create/update/delete DRAFT, references, duplicates, preview, list; audit run; four-eyes; chain', async () => {
      const tariff = DdTariffView.parse((await c.send('POST', '/api/v1/dd/tariffs', tok.owner, { ...MAERSK, name: `${marker} inv tariff` })).json());
      const badRef = await c.send('POST', '/api/v1/dd/invoices', tok.analyst, invoiceBody(`${marker}-1`, { tariffId: randomUUID() }));
      expect([badRef.statusCode, errorOf(badRef).details]).toEqual([400, [{ path: 'tariffId', code: 'not_found' }]]);
      const created = await c.send('POST', '/api/v1/dd/invoices', tok.analyst, invoiceBody(`${marker}-1`, { tariffId: tariff.id }));
      expect(created.statusCode, created.body).toBe(201);
      const d = DdInvoiceDetail.parse(created.json());
      expect(d).toMatchObject({ status: 'DRAFT', version: 1, claimId: null });
      expect(d.preview.findings.map((f) => [f.ruleId, f.amount])).toEqual([['DD-TARIFF-OVERCHARGE', '440.00']]);
      expect((await c.send('POST', '/api/v1/dd/invoices', tok.analyst, invoiceBody(`${marker}-1`))).statusCode).toBe(409);
      expect((await c.send('POST', '/api/v1/dd/invoices', tok.viewer, invoiceBody(`${marker}-v`))).statusCode).toBe(403);
      const upd = await c.send('PUT', `/api/v1/dd/invoices/${d.id}`, tok.analyst, { version: 1, invoice: invoiceBody(`${marker}-1`, { tariffId: tariff.id, invoiceDate: '2026-04-25' }) });
      expect(DdInvoiceDetail.parse(upd.json())).toMatchObject({ version: 2 });
      const stale = await c.send('PUT', `/api/v1/dd/invoices/${d.id}`, tok.analyst, { version: 1, invoice: invoiceBody(`${marker}-1`) });
      expect([stale.statusCode, errorOf(stale).code]).toEqual([409, 'stale_revision']);
      // pageSize is capped at DD_INVOICE_PAGE_SIZE_MAX (50) since fix round 1 (S1).
      const list = DdInvoiceList.parse((await c.get(`/api/v1/dd/invoices?status=DRAFT&pageSize=${DD_INVOICE_PAGE_SIZE_MAX}`, tok.viewer)).json());
      expect(list.items.find((x) => x.id === d.id)).toMatchObject({ containerCount: 1, totalDueCents: 435000, invoiceDate: '2026-04-25' });
      expect((await auditOf('dd_invoice.created', d.id)).map((m) => Object.keys(m).sort())).toEqual([['containerCount', 'dataSha256', 'invoiceId', 'version']]);

      // Audit run (ANALYST may run it; becomes the author of revision 1).
      const run = await c.send('POST', `/api/v1/dd/invoices/${d.id}/audit`, tok.analyst, {});
      expect(run.statusCode, run.body).toBe(201);
      const out = DdAuditResponse.parse(run.json());
      expect(out.claim).toMatchObject({ status: 'PENDING_REVIEW', recoverableCents: 44000, pendingReviewCents: 391000, amountClaimedCents: 435000 });
      expect(out.audit).toEqual({ rulesVersion: 'dd-rules-v1', findingsCount: 2, pendingFindingsCount: 1 });
      const claimRow = await admin.query(`SELECT kind, perspective, load_number, carrier_name, shipper_name, status FROM claims WHERE id = $1`, [out.claim.id]);
      expect(claimRow.rows[0]).toEqual({ kind: 'OCEAN_DD', perspective: 'SHIPPER', load_number: null, carrier_name: `${marker} line`, shipper_name: 'Example Importer LLC', status: 'PENDING_REVIEW' });
      const meta = (await auditOf('dd_invoice.audited', out.claim.id))[0];
      expect(Object.keys(meta ?? {}).sort()).toEqual(
        ['calendarId', 'claimId', 'claimNumber', 'contentHash', 'findingsCount', 'invoiceId', 'packetId', 'pendingFindingsCount', 'pendingReviewCents', 'recoverableCents', 'revision', 'rulesVersion', 'snapshotSha256', 'tariffId'].sort(),
      );
      const again = await c.send('POST', `/api/v1/dd/invoices/${d.id}/audit`, tok.analyst, {});
      expect([again.statusCode, errorOf(again).code]).toEqual([409, 'invalid_state']);
      expect(errorOf(await c.send('PUT', `/api/v1/dd/invoices/${d.id}`, tok.analyst, { version: 3, invoice: invoiceBody(`${marker}-1`) })).code).toBe('invalid_state');
      expect(errorOf(await del(`/api/v1/dd/invoices/${d.id}`, tok.analyst)).code).toBe('invalid_state');
      const audited = DdInvoiceDetail.parse((await c.get(`/api/v1/dd/invoices/${d.id}`, tok.viewer)).json());
      expect(audited).toMatchObject({ status: 'AUDITED', claimId: out.claim.id, claimNumber: out.claim.claimNumber });
      // A changed tariff never changes an audited invoice's preview.
      await c.send('PUT', `/api/v1/dd/tariffs/${tariff.id}`, tok.owner, { version: 1, data: { ...MAERSK, name: `${marker} inv tariff`, freeDays: 10 } });
      expect(DdInvoiceDetail.parse((await c.get(`/api/v1/dd/invoices/${d.id}`, tok.viewer)).json()).preview).toEqual(audited.preview);

      // Step-5 analysis refuses OCEAN_DD claims; the claim sheet shows the kind.
      const analyze = await c.send('POST', `/api/v1/claims/${out.claim.id}/analyze`, tok.owner, {});
      expect(analyze.statusCode).toBe(409);
      expect((await c.get(`/api/v1/claims/${out.claim.id}`, tok.viewer)).json()).toMatchObject({ kind: 'OCEAN_DD' });

      // Four-eyes: the auditor authored revision 1 (an ANALYST cannot approve anyway); a reviewer can.
      const approve = await c.send('POST', `/api/v1/claims/${out.claim.id}/packet/approve`, tok.reviewer, { packetRevision: 1, reason: REASON, acknowledgePendingFindings: true });
      expect(approve.statusCode, approve.body).toBe(200);
      const verify = await c.get('/api/v1/audit/verify', tok.owner);
      expect((verify.json() as { valid: boolean }).valid).toBe(true);

      // Delete of a DRAFT.
      const d2 = DdInvoiceDetail.parse((await c.send('POST', '/api/v1/dd/invoices', tok.analyst, invoiceBody(`${marker}-2`))).json());
      expect((await del(`/api/v1/dd/invoices/${d2.id}`, tok.analyst)).statusCode).toBe(204);
      expect(await auditOf('dd_invoice.deleted', d2.id)).toEqual([{ invoiceId: d2.id, version: 1 }]);
      // Cross tenant: byte-identical 404.
      const cross = await c.get(`/api/v1/dd/invoices/${d.id}`, tok.globexOwner);
      const unknown = await c.get(`/api/v1/dd/invoices/${randomUUID()}`, tok.globexOwner);
      expect([cross.statusCode, unknown.statusCode]).toEqual([404, 404]);
      expect(cross.body.replace(/"requestId":"[^"]*"/u, '')).toBe(unknown.body.replace(/"requestId":"[^"]*"/u, ''));
    });

    it('API keys are refused on D&D routes (403)', async () => {
      const k = await c.send('POST', '/api/v1/api-keys', tok.owner, { name: `${marker} key`, scopes: ['claims.read'] });
      expect(k.statusCode, k.body).toBe(201);
      const key = ApiKeyCreated.parse(k.json());
      const r = await fastify.inject({ method: 'GET', url: '/api/v1/dd/invoices', headers: { authorization: `Bearer ${key.secret}` } });
      expect([r.statusCode, errorOf(r).code]).toEqual([403, 'forbidden']);
    });

    it('C14 (fix round 3): every editor of the D&D invoice (creator R1, intermediate R2, last R4) is refused; the auditor M1 does not edit; R3 approves', async () => {
      // R1 = reviewer creates, R2 = admin edits, R4 = owner makes the last edit, M1 = analyst audits, R3 = manager approves.
      const r1 = DdInvoiceDetail.parse((await c.send('POST', '/api/v1/dd/invoices', tok.reviewer, invoiceBody(`${marker}-fe`))).json());
      const r2 = await c.send('PUT', `/api/v1/dd/invoices/${r1.id}`, tok.admin, { version: 1, invoice: invoiceBody(`${marker}-fe`, { dueDate: '2026-04-25' }) });
      expect(r2.statusCode, r2.body).toBe(200);
      const r4 = await c.send('PUT', `/api/v1/dd/invoices/${r1.id}`, tok.owner, { version: 2, invoice: invoiceBody(`${marker}-fe`, { dueDate: '2026-04-26' }) });
      expect(r4.statusCode, r4.body).toBe(200);
      const out = DdAuditResponse.parse((await c.send('POST', `/api/v1/dd/invoices/${r1.id}/audit`, tok.analyst, {})).json());
      const ownerRow = await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = 'owner@acme.test'`);
      const row = await admin.query<{ updated_by_id: string; status: string }>(`SELECT updated_by_id::text AS updated_by_id, status FROM dd_invoices WHERE id = $1`, [r1.id]);
      expect(row.rows[0]).toEqual({ updated_by_id: ownerRow.rows[0]?.id, status: 'AUDITED' });
      for (const t of [tok.reviewer, tok.admin, tok.owner]) {
        for (const action of ['approve', 'reject'] as const) {
          // TransitionBody (reject) is strict and has no acknowledgePendingFindings; ApproveBody has it.
          const payload = action === 'approve' ? { packetRevision: 1, reason: REASON, acknowledgePendingFindings: true } : { packetRevision: 1, reason: REASON };
          const r = await c.send('POST', `/api/v1/claims/${out.claim.id}/packet/${action}`, t, payload);
          expect([action, r.statusCode, errorOf(r).code]).toEqual([action, 403, 'four_eyes_required']);
        }
      }
      const denied = await admin.query<{ metadata: { basis: string } }>(`SELECT metadata FROM audit_events WHERE action = 'authz.four_eyes_denied' AND target_id = $1 ORDER BY seq`, [out.claim.id]);
      expect(denied.rows.map((r) => r.metadata.basis)).toEqual(Array.from({ length: 6 }, () => 'dd_invoice_editor'));
      for (const t of [tok.reviewer, tok.admin, tok.owner]) {
        const queue = (await c.get('/api/v1/approvals?pageSize=100', t)).json() as { items: { id: string; selfAuthored: boolean }[] };
        expect(queue.items.find((i) => i.id === out.claim.id)?.selfAuthored).toBe(true);
      }
      const ok = await c.send('POST', `/api/v1/claims/${out.claim.id}/packet/approve`, tok.manager, { packetRevision: 1, reason: REASON, acknowledgePendingFindings: true });
      expect(ok.statusCode, ok.body).toBe(200);
    });

    it('fix round 1 S4: a 50 x 20 invoice is accepted (201); a 262,145-byte body is refused (413)', async () => {
      const containers = Array.from({ length: 50 }, (_, i) => ({
        containerNumber: `SYNU${String(i).padStart(7, '0')}`,
        sizeType: '40DV',
        chargeType: 'DETENTION',
        freeDays: 4,
        freeTimeStart: '2026-01-01',
        freeTimeEnd: '2026-01-05',
        availabilityDate: '2026-01-01',
        earliestReturnDate: null,
        periods: Array.from({ length: 20 }, (_, k) => {
          const day = new Date(Date.UTC(2026, 0, 6 + 2 * k)).toISOString().slice(0, 10);
          return { from: day, to: day, rate: '290.00', amount: '290.00' };
        }),
        evidence: { clockStart: null, clockStop: null, cargoAvailableDate: null, emptyReturnRefusedDates: [] },
      }));
      const big = invoiceBody(`${marker}-big`, { totalDue: '290000.00', containers });
      expect(Buffer.byteLength(JSON.stringify(big))).toBeGreaterThan(65536);
      const r = await c.send('POST', '/api/v1/dd/invoices', tok.analyst, big);
      expect(r.statusCode, r.body.slice(0, 200)).toBe(201);
      const base = JSON.stringify(invoiceBody(`${marker}-pad`));
      const padded = `${base.slice(0, -1)}${' '.repeat(262145 - Buffer.byteLength(base))}}`;
      expect(Buffer.byteLength(padded)).toBe(262145);
      const tooBig = await fastify.inject({ method: 'POST', url: '/api/v1/dd/invoices', headers: { ...c.headers(tok.analyst), 'content-type': 'application/json' }, payload: padded });
      expect([tooBig.statusCode, errorOf(tooBig).code]).toEqual([413, 'payload_too_large']);
    });

    it('fix round 1 S1/S2: list pageSize <= 50; the 2,000-invoice cap answers 409 dd_limit_reached', async () => {
      expect((await c.get('/api/v1/dd/invoices?pageSize=51', tok.viewer)).statusCode).toBe(400);
      const page = DdInvoiceList.parse((await c.get('/api/v1/dd/invoices?pageSize=50', tok.viewer)).json());
      expect(page.items.every((i) => i.containerCount >= 1 && (i.direction === 'IMPORT' || i.direction === 'EXPORT'))).toBe(true);
      const have = Number((await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM dd_invoices WHERE tenant_id = $1`, [acme])).rows[0]?.n ?? '0');
      const { tariffId: _t, calendarId: _c, ...data } = invoiceBody(`${marker}-cap`);
      if (have < 2000) {
        await admin.query(
          `INSERT INTO dd_invoices (id, tenant_id, invoice_number, billing_party_name, data, created_by_id, updated_by_id, updated_at)
           SELECT gen_random_uuid(), $1, $2 || g, $3, $4::jsonb, $5, $5, now() FROM generate_series(1, $6::int) g`,
          [acme, `${marker}-cap-`, `${marker} line`, JSON.stringify(data), ownerId, 2000 - have],
        );
      }
      const r = await c.send('POST', '/api/v1/dd/invoices', tok.analyst, invoiceBody(`${marker}-over`));
      expect([r.statusCode, errorOf(r).code]).toEqual([409, 'dd_limit_reached']);
      await admin.query(`DELETE FROM dd_invoices WHERE invoice_number LIKE $1 AND status = 'DRAFT'`, [`${marker}-cap-%`]);
    });

    it('flag OFF: every D&D route 404s after 401/403/400; OCEAN_DD claims stay readable', async () => {
      await admin.query(`UPDATE feature_flags SET enabled = false, version = version + 1 WHERE key = 'intelligence.ocean_dd'`);
      try {
        const app2 = await buildApp(step4Env(), { logStream: new Writable({ write: (_c, _e, cb) => cb() }) });
        await app2.ready();
        try {
          const c2 = await new Client(app2).init();
          const own = await c2.login('owner@acme.test');
          expect((await c2.get('/api/v1/dd/invoices', own)).statusCode).toBe(404);
          expect((await c2.get('/api/v1/dd/tariffs', own)).statusCode).toBe(404);
          expect((await c2.send('POST', '/api/v1/dd/invoices', own, invoiceBody(`${marker}-off`))).statusCode).toBe(404);
          expect((await c2.send('POST', '/api/v1/dd/invoices', own, {})).statusCode).toBe(400);
          expect((await c2.get('/api/v1/dd/invoices')).statusCode).toBe(401);
          const features = (await c2.get('/api/v1/features', own)).json() as { flags: Record<string, boolean> };
          expect(features.flags['intelligence.ocean_dd']).toBe(false);
        } finally {
          await app2.close();
        }
      } finally {
        await admin.query(`UPDATE feature_flags SET enabled = true, version = version + 1 WHERE key = 'intelligence.ocean_dd'`);
      }
    });
  });
});
