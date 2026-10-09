/* eslint-disable */
// T4 (T-PIPE-01..07): pipeline health against a live database, an isolated SQL oracle, delta composition, no identifiers, audit.
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, closeApps, expectError, type RoleName, type Session } from './helpers/client.js';
import { appDb, inRollback, tryQuery, withAdmin, withTriggersOff, type PgClient } from './helpers/db.js';
import * as I from './helpers/intel.js';

let app: FastifyInstance;
let SS: Record<RoleName, Session>;
let tenantId = '';
let userId = '';
let batchId = '';
const planted: string[] = [];
const sha = () => createHash('sha256').update(randomUUID()).digest('hex');

beforeAll(async () => {
  app = await buildTestApp();
  SS = await I.seededOn(app, ['PLATFORM_DEV', 'SUPER_ADMIN', 'OWNER', 'ANALYST']);
  await withAdmin(async (c) => {
    tenantId = (await c.query(`select id from tenants where name like 'Acme%' order by created_at limit 1`)).rows[0].id;
    userId = (await c.query(`select id from users where email='analyst@acme.test'`)).rows[0].id;
    batchId = randomUUID();
    await c.query(`insert into import_batches (id, tenant_id, label, source, created_by_id, created_at) values ($1,$2,'pipeline acc','UPLOAD',$3,now())`, [batchId, tenantId, userId]);
  });
});
afterAll(async () => {
  try {
    await withTriggersOff(['import_documents', 'import_batches', 'extracted_fields', 'import_review_decisions', 'claim_documents'], async (c) => {
      if (planted.length) await c.query(`delete from import_documents where id = any($1::uuid[])`, [planted]);
      await c.query(`delete from import_batches where id=$1 and not exists (select 1 from import_documents d where d.batch_id=import_batches.id)`, [batchId]);
    });
    I.assertHonest('dev-pipeline');
  } finally {
    await closeApps();
  }
});

async function enumFirst(c: PgClient, table: string, col: string): Promise<string> {
  const u = (await c.query(`select udt_name from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2`, [table, col])).rows[0].udt_name;
  const e = await c.query(`select e.enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname=$1 order by e.enumsortorder limit 1`, [u]);
  return `'${e.rows[0].enumlabel}'::"${u}"`;
}
interface D { status: string; type: string; reason?: string | null; createdSql: string; parseMs?: number | null; name?: string; id?: string }
/** INSERT statement for one import document of the fixture batch (storage key satisfies the tenant-prefix rule). */
async function docSql(c: PgClient, d: D, tid = tenantId, bid = batchId): Promise<string> {
  const id = d.id ?? randomUUID();
  const basis = await enumFirst(c, 'import_documents', 'doc_type_basis');
  const stored = d.status === 'REJECTED' || d.status === 'FAILED' ? 'NULL' : `'t/${tid}/imports/${bid}/${id}/original'`;
  const parsed = d.parseMs == null ? 'NULL' : `(${d.createdSql}) + interval '${d.parseMs} milliseconds'`;
  const reason = d.reason ? `'${d.reason}'` : 'NULL';
  return `insert into import_documents (id,tenant_id,batch_id,uploaded_by_id,source,display_name,detected_type,size_bytes,sha256,storage_key,doc_type,doc_type_basis,status,reject_reason,review_reasons,warnings,provider_name,provider_version,parser_version,created_at,updated_at,parsed_at)
    values ('${id}','${tid}','${bid}','${userId}','UPLOAD',${I.lit(d.name ?? `pipe-${id.slice(0, 8)}.bin`)},'${d.type}',10,'${sha()}',${stored},'OTHER',${basis},'${d.status}',${reason},'{}','{}','deterministic','1','1',${d.createdSql},${d.createdSql},${parsed})`;
}
async function plant(d: D): Promise<string> {
  const id = randomUUID();
  await withAdmin(async (c) => { await c.query(await docSql(c, { ...d, id })); });
  planted.push(id);
  return id;
}

const STATUSES = ['RECEIVED', 'NEEDS_REVIEW', 'ACCEPTED', 'REJECTED', 'FAILED'];
const TYPES = ['PDF', 'PNG', 'JPEG', 'CSV', 'TXT'];
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
const r4 = (c: number, t: number) => (t === 0 ? null : Math.round((c / t) * 1e4) / 1e4);
/** rounded-to-4-decimals check; an exact half is accepted under either rounding direction */
function expectRate(actual: number | null, c: number, t: number, label: string) {
  if (t === 0) return expect(actual, label).toBeNull();
  const raw = (c / t) * 1e4;
  const lo = Math.floor(raw) / 1e4;
  const hi = Math.ceil(raw) / 1e4;
  const half = Math.abs(raw - Math.floor(raw) - 0.5) < 1e-9;
  const ok = Math.abs(actual! - r4(c, t)!) < 1e-9 || (half && (Math.abs(actual! - lo) < 1e-9 || Math.abs(actual! - hi) < 1e-9));
  expect(ok, `${label}: ${actual} vs ${c}/${t}`).toBe(true);
}

describe('T-PIPE-01 shape and invariants (live database)', () => {
  for (const role of ['PLATFORM_DEV', 'SUPER_ADMIN'] as RoleName[]) {
    it(`${role}: every window`, async () => {
      for (const w of ['1h', '24h', '7d', undefined]) {
        const eff = w ?? '24h';
        const r = await SS[role].get(`/platform/pipeline${w ? `?window=${w}` : ''}`);
        expect(r.status, r.text).toBe(200);
        const b = r.body;
        expect(b.window).toBe(eff);
        expect(b.scope).toBe('all_tenants_aggregate');
        expect(Math.abs(Date.now() - Date.parse(b.generatedAt))).toBeLessThan(30000);
        expect(Object.keys(b.documents.byStatus).sort()).toEqual([...STATUSES].sort());
        expect(Object.keys(b.documents.byDetectedType).sort()).toEqual([...TYPES].sort());
        for (const v of [...Object.values(b.documents.byStatus), ...Object.values(b.documents.byDetectedType)] as number[]) expect(Number.isInteger(v) && v >= 0).toBe(true);
        expect(sum(b.documents.byStatus)).toBe(b.documents.total);
        expect(sum(b.documents.byDetectedType)).toBe(b.documents.total);
        const rej = b.documents.rejectedByReason as Array<{ reason: string; count: number }>;
        expect(rej.reduce((a, x) => a + x.count, 0)).toBe(b.documents.byStatus.REJECTED);
        const sorted = [...rej].sort((x, y) => y.count - x.count || (x.reason < y.reason ? -1 : x.reason > y.reason ? 1 : 0));
        expect(rej).toEqual(sorted);
        const t = b.documents.total;
        expectRate(b.rates.rejected, b.documents.byStatus.REJECTED, t, 'rejected');
        expectRate(b.rates.failed, b.documents.byStatus.FAILED, t, 'failed');
        expectRate(b.rates.needsReview, b.documents.byStatus.NEEDS_REVIEW, t, 'needsReview');
        const u = b.uploadToParseMs;
        expect(u.n).toBeGreaterThanOrEqual(0);
        if (u.n === 0) { expect(u.p50).toBeNull(); expect(u.p95).toBeNull(); } else expect(u.p50).toBeLessThanOrEqual(u.p95);
        const depth = await withAdmin(async (c) => Number((await c.query(`select count(*)::int n from import_documents where status='NEEDS_REVIEW'`)).rows[0].n));
        const aw = await withAdmin(async (c) => Number((await c.query(`select count(*)::int n from claims where status='AWAITING_ANALYSIS'`)).rows[0].n));
        expect(b.reviewQueue.depth).toBe(depth);
        expect(b.claims.awaitingAnalysis).toBe(aw);
        expect(b.staleReceived).toBeGreaterThanOrEqual(0);
        expect(['ok', 'down']).toContain(b.db);
      }
    }, 60000);
  }
});
describe('T-PIPE-02 exact aggregation (isolated SQL, rolled back)', () => {
  const rows = [
    ['d1', 'ACCEPTED', 'CSV', null, 10 * 60, 1000], ['d2', 'ACCEPTED', 'TXT', null, 20 * 60, 2000], ['d3', 'NEEDS_REVIEW', 'PDF', null, 30 * 60, 3000],
    ['d4', 'NEEDS_REVIEW', 'PDF', null, 2 * 3600, 1000], ['d5', 'REJECTED', 'PDF', 'malformed_pdf', 5 * 60, 4000], ['d6', 'REJECTED', 'PDF', 'malformed_pdf', 6 * 60, 5000],
    ['d7', 'REJECTED', 'PNG', 'trailing_data', 7 * 60, null], ['d8', 'FAILED', 'TXT', null, 8 * 60, null], ['d9', 'RECEIVED', 'CSV', null, 15 * 60, null], ['d10', 'RECEIVED', 'TXT', null, 60, null],
  ] as Array<[string, string, string, string | null, number, number | null]>;
  async function stats(c: PgClient, win: number) {
    await c.query(`select set_config('app.system','on',true)`);
    return c.query(`SELECT * FROM fr_platform_pipeline_stats(${win}, 600)`);
  }
  const by = (rs: any[], metric: string) => rs.filter((x) => x.metric === metric);
  const nOf = (rs: any[], metric: string, label: string) => Number(by(rs, metric).find((x) => x.label === label)?.n ?? 0);
  it('1 h window and 24 h window match the hand-computed values; nothing persists', async () => {
    await withAdmin(async (c) => {
      const before = Number((await c.query(`select count(*)::int n from import_documents`)).rows[0].n);
      const awaiting = Number((await c.query(`select count(*)::int n from claims where status='AWAITING_ANALYSIS'`)).rows[0].n);
      await c.query('BEGIN');
      try {
        for (const t of ['import_documents', 'extracted_fields', 'import_review_decisions', 'claim_documents']) await c.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
        for (const t of ['claim_documents', 'import_review_decisions', 'extracted_fields']) await c.query(`DELETE FROM ${t}`);
        await c.query(`DELETE FROM import_documents`);
        for (const [, status, type, reason, ageS, parseMs] of rows) {
          await c.query(await docSql(c, { status, type, reason, createdSql: `now() - interval '${ageS} seconds'`, parseMs }));
        }
        const r1 = await stats(c, 3600);
        expect(Object.keys(r1.rows[0]).join(',')).toBe('metric,label,n,p50_ms,p95_ms');
        const exp: Record<string, number> = { ACCEPTED: 2, NEEDS_REVIEW: 1, REJECTED: 3, FAILED: 1, RECEIVED: 2 };
        for (const [k, v] of Object.entries(exp)) expect(nOf(r1.rows, 'status', k), `status ${k}`).toBe(v);
        for (const [k, v] of Object.entries({ CSV: 2, TXT: 3, PDF: 3, PNG: 1 })) expect(nOf(r1.rows, 'detected_type', k), `type ${k}`).toBe(v);
        expect(nOf(r1.rows, 'reject_reason', 'malformed_pdf')).toBe(2);
        expect(nOf(r1.rows, 'reject_reason', 'trailing_data')).toBe(1);
        const up = by(r1.rows, 'upload_to_parse')[0];
        expect(Number(up.n)).toBe(5);
        expect(Math.abs(Number(up.p50_ms) - 3000)).toBeLessThanOrEqual(1);
        expect(Math.abs(Number(up.p95_ms) - 4800)).toBeLessThanOrEqual(1);
        const rq = by(r1.rows, 'review_queue')[0];
        expect(Number(rq.n)).toBe(2);
        expect(Number(rq.p50_ms)).toBeGreaterThanOrEqual(7190000);
        expect(Number(rq.p50_ms)).toBeLessThanOrEqual(7260000);
        expect(Number(by(r1.rows, 'stale_received')[0].n)).toBe(1);
        expect(Number(by(r1.rows, 'awaiting_analysis')[0].n)).toBe(awaiting);
        const r2 = await stats(c, 86400);
        expect(nOf(r2.rows, 'status', 'NEEDS_REVIEW')).toBe(2);
        expect(Number(by(r2.rows, 'upload_to_parse')[0].n)).toBe(6);
      } finally {
        await c.query('ROLLBACK');
      }
      expect(Number((await c.query(`select count(*)::int n from import_documents`)).rows[0].n)).toBe(before);
    });
  }, 60000);
});

describe('T-PIPE-03 function guards', () => {
  it('callable only in system mode, with bounded arguments', async () => {
    const a = await appDb();
    try {
      const nosys = await tryQuery(a, `SELECT * FROM fr_platform_pipeline_stats(3600,600)`);
      expect(nosys.ok, 'no system mode must raise').toBe(false);
      const ctl = await inRollback(a, async () => {
        await a.query(`select set_config('app.system','on',true)`);
        return tryQuery(a, `SELECT * FROM fr_platform_pipeline_stats(3600,600)`);
      });
      expect(ctl.ok, `control call in system mode must work: ${ctl.error}`).toBe(true);
      for (const args of ['59,600', '604801,600', '3600,0', '3600,86401']) {
        const r = await inRollback(a, async () => {
          await a.query(`select set_config('app.system','on',true)`);
          return tryQuery(a, `SELECT * FROM fr_platform_pipeline_stats(${args})`);
        });
        expect(r.ok, `(${args}) must raise`).toBe(false);
      }
      const tctx = await inRollback(a, async () => {
        await a.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
        return tryQuery(a, `SELECT * FROM fr_platform_pipeline_stats(3600,600)`);
      });
      expect(tctx.ok, 'tenant context must raise').toBe(false);
    } finally {
      await a.end();
    }
  });
});

describe('T-PIPE-04 HTTP composition (committed rows, delta method)', () => {
  it('three REJECTED documents created 6.5 days ago appear in 7d and not in 24h', async () => {
    const dev = SS.PLATFORM_DEV;
    const read = async () => ({ d7: (await dev.get('/platform/pipeline?window=7d')).body, d24: (await dev.get('/platform/pipeline?window=24h')).body });
    const before = await read();
    const old = `now() - interval '6.5 days'`;
    await plant({ status: 'REJECTED', type: 'PDF', reason: 'parse_failed', createdSql: old });
    await plant({ status: 'REJECTED', type: 'PDF', reason: 'parse_failed', createdSql: old });
    await plant({ status: 'REJECTED', type: 'PNG', reason: 'trailing_data', createdSql: old });
    const after = await read();
    const cnt = (b: any, reason: string) => b.documents.rejectedByReason.find((x: any) => x.reason === reason)?.count ?? 0;
    expect(after.d7.documents.total - after.d24.documents.total).toBe(before.d7.documents.total - before.d24.documents.total + 3);
    expect(after.d7.documents.byStatus.REJECTED).toBe(before.d7.documents.byStatus.REJECTED + 3);
    expect(after.d7.documents.byDetectedType.PDF).toBe(before.d7.documents.byDetectedType.PDF + 2);
    expect(after.d7.documents.byDetectedType.PNG).toBe(before.d7.documents.byDetectedType.PNG + 1);
    expect(cnt(after.d7, 'parse_failed')).toBe(cnt(before.d7, 'parse_failed') + 2);
    expect(cnt(after.d7, 'trailing_data')).toBe(cnt(before.d7, 'trailing_data') + 1);
    expect(after.d24.documents.total).toBe(before.d24.documents.total);
    expect(after.d24.documents.byStatus).toEqual(before.d24.documents.byStatus);
  }, 60000);
});

describe('T-PIPE-05 no identifiers', () => {
  it('no tenant, user, file or claim identifier occurs in any window; a planted file name is absent', async () => {
    await plant({ status: 'ACCEPTED', type: 'TXT', createdSql: `now() - interval '3 hours'`, parseMs: 500, name: 'needle-name-91@example.com.pdf' });
    const ids: string[] = await withAdmin(async (c) => {
      const out: string[] = [];
      for (const r of (await c.query(`select id::text, name, slug from tenants`)).rows) out.push(r.id, r.name, r.slug);
      for (const r of (await c.query(`select id::text, email, name from users where platform_role is null`)).rows) out.push(r.id, r.email, r.name);
      for (const r of (await c.query(`select display_name, sha256 from import_documents`)).rows) out.push(r.display_name, r.sha256);
      for (const r of (await c.query(`select claim_number from claims`)).rows) out.push(r.claim_number);
      return out;
    });
    const needles = [...new Set(ids)].filter((s) => s && s.length >= 4);
    expect(needles.length).toBeGreaterThan(20);
    for (const role of ['PLATFORM_DEV', 'SUPER_ADMIN'] as RoleName[]) {
      for (const w of ['1h', '24h', '7d']) {
        const r = await SS[role].get(`/platform/pipeline?window=${w}`);
        expect(r.status).toBe(200);
        for (const n of needles) expect(r.text.includes(n), `${role} ${w}: identifier ${n.slice(0, 12)} present`).toBe(false);
        expect(r.text.includes('needle-name-91')).toBe(false);
      }
    }
  }, 60000);
});

describe('T-PIPE-06 audit', () => {
  it('each successful R60 appends exactly one platform event with the documented metadata; failures append nothing', async () => {
    const dev = SS.PLATFORM_DEV;
    const tenantEventsBefore = await withAdmin(async (c) => Number((await c.query(`select count(*)::int n from audit_events where tenant_id is not null`)).rows[0].n));
    for (const [q, win] of [['', '24h'], ['?window=1h', '1h'], ['?window=7d', '7d'], ['?window=24h', '24h']] as Array<[string, string]>) {
      const seq = await I.lastSeq(null);
      const r = await dev.get(`/platform/pipeline${q}`);
      expect(r.status).toBe(200);
      const ev = await I.eventsSince(null, seq);
      expect(ev.map((e) => e.action)).toEqual(['platform.dashboard_viewed']);
      expect(ev[0]!.actor_id).toBe(dev.user.id);
      expect(ev[0]!.actor_role).toBe('PLATFORM_DEV');
      expect(I.keysOf(ev[0]!.metadata)).toEqual(['section', 'window']);
      expect(ev[0]!.metadata).toEqual({ section: 'pipeline', window: win });
    }
    const tenantEventsAfter = await withAdmin(async (c) => Number((await c.query(`select count(*)::int n from audit_events where tenant_id is not null`)).rows[0].n));
    expect(tenantEventsAfter).toBe(tenantEventsBefore);
    const seq = await I.lastSeq(null);
    expectError(await dev.get('/platform/pipeline?window=2h'), 400, 'validation_error');
    expect((await I.eventsSince(null, seq)).length).toBe(0);
    expectError(await SS.OWNER.get('/platform/pipeline'), 403, 'forbidden');
    expect((await I.eventsSince(null, seq)).filter((e) => e.action === 'platform.dashboard_viewed').length).toBe(0);
    const v = await SS.SUPER_ADMIN.get('/platform/audit/verify');
    expect(v.status).toBe(200);
    expect(v.body.valid).toBe(true);
  }, 60000);
});

describe('T-PIPE-07 reads are side-effect free', () => {
  it('row counts of all non-audit tables are unchanged by R60-R66', async () => {
    const dev = SS.PLATFORM_DEV;
    const snap = () => withAdmin((c) => I.rowCounts(c, I.NON_AUDIT_TABLES));
    const before = await snap();
    for (const p of ['/platform/pipeline', '/platform/pipeline?window=7d', '/platform/telemetry', '/platform/logs', '/platform/flags', '/platform/eval/runs', `/platform/eval/runs/${I.RAND_UUID}`]) await dev.get(p);
    expect(await snap()).toEqual(before);
  });
});