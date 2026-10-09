/* eslint-disable */
// EXP-04 row cap, EXP-05 streaming + client abort, EXP-14 limits. Extra Globex claims are inserted through the owner connection
// (removed by the final db:seed --reset).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, buildTestApp, closeApps, expectError, sessionFor, type Session } from './helpers/client.js';
import { buildInsert, tryQuery, withAdmin } from './helpers/db.js';
import * as H from './helpers/imp.js';
import { reseed } from './helpers/seed.js';

let gx: Session, gxOwner: Session;
const S = (s: string) => Buffer.from(s, 'utf8');
const TAG = `EXL${H.RUN}`;

beforeAll(async () => {
  await H.assertS3Reachable();
  const a = await buildTestApp();
  gx = H.wrap(await sessionFor(a, 'manager@globex.test'));
  gxOwner = H.wrap(await sessionFor(a, 'owner@globex.test'));
});
afterAll(async () => {
  try { H.assertRecorded('exp-limits'); } finally { await closeApps(); reseed(); }
});

async function makeClaims(s: Session, n: number, tag: string) {
  for (let i = 0; i < n; i++) {
    const b = await H.newBatch(s);
    await H.putOk(s, b, 'inv.txt', S(H.invoiceTxt(H.uniqLoad('EXL'), { invoice: `${tag}-${i}` })));
    expect((await H.commit(s, b)).status).toBe(200);
  }
}
const exportEvents = async (seq: number) => (await H.auditSince(gxOwner, seq)).filter((e) => e.action.startsWith('export.'));

describe('EXP-04 row cap (EXPORT_MAX_ROWS=5)', () => {
  it('more than 5 rows -> 422 export_too_large JSON, no file bytes, no export.completed; exactly 5 -> 200; 0 rows -> header only', async () => {
    const app = await buildTestApp({ EXPORT_MAX_ROWS: '5' });
    const s = H.wrap(await sessionFor(app, 'manager@globex.test'));
    await makeClaims(s, 5, TAG);
    const exactly = await H.download(s, `/exports/claims?format=csv&q=${TAG}`);
    expect(exactly.status, exactly.text.slice(0, 200)).toBe(200);
    expect(H.parseCsv(exactly.buf.toString('utf8')).length).toBe(6);
    await makeClaims(s, 1, TAG);
    const seq = await H.lastSeq(gxOwner);
    for (const fmt of ['csv', 'xlsx']) {
      const r = await H.download(s, `/exports/claims?format=${fmt}&q=${TAG}`);
      expect(r.status, r.text.slice(0, 200)).toBe(422);
      expect(String(r.headers['content-type'])).toMatch(/json/);
      const body = JSON.parse(r.text);
      expect(body.error.code).toBe('export_too_large');
      expect(r.buf[0]).toBe('{'.charCodeAt(0));
      expect(r.headers['content-disposition']).toBeUndefined();
    }
    expectError(await s.get('/exports/claims?format=csv'), 422, 'export_too_large');
    const ev = await exportEvents(seq);
    expect(ev.filter((e) => e.action === 'export.completed')).toEqual([]);
    const none = await H.download(s, '/exports/claims?format=csv&q=NO-SUCH-' + H.RUN);
    expect(none.status).toBe(200);
    const rows = H.parseCsv(none.buf.toString('utf8'));
    expect(rows).toHaveLength(1);
    expect(rows[0]![0]).toBe('Claim Number');
  }, 300000);
});

async function insertBulk(n: number): Promise<boolean> {
  return withAdmin(async (adm) => {
    const t = (await adm.query(`select id from tenants where name like 'Globex%'`)).rows[0].id;
    const cols = (await adm.query(`select column_name from information_schema.columns where table_schema='public' and table_name='claims' and is_generated <> 'ALWAYS' and column_name not in ('id','claim_number','load_number','invoice_number') order by ordinal_position`)).rows.map((r: any) => `"${r.column_name}"`);
    const list = cols.join(',');
    const sql = `insert into claims (id, claim_number, load_number, invoice_number, ${list}) select gen_random_uuid(), 'GLX-X' || lpad(g::text, 6, '0'), 'LD-BULK-' || g, 'INV-BULK-' || g, ${list} from (select * from claims where tenant_id = $1 order by claim_number limit 1) c, generate_series(1, ${n}) g`;
    const r = await tryQuery(adm, sql, [t]);
    if (!r.ok) console.warn('[EXP-05] bulk insert failed:', r.error);
    return r.ok;
  });
}

let ok = false, total = 0;
describe('EXP-05 streaming and client abort (5000 extra Globex claims)', () => {

  it('CSV and XLSX are chunked without Content-Length, in several chunks, first chunk before the last', async (ctx) => {
    ok = await insertBulk(5000);
    if (!ok) return ctx.skip('could not insert 5000 claims through the owner connection (schema constraints); recorded as not run');
    const app = await buildTestApp();
    const port = await H.listen(app);
    const s = H.wrap(await sessionFor(app, 'manager@globex.test'));
    total = (await s.get('/claims?pageSize=1')).body.total;
    expect(total).toBeGreaterThanOrEqual(5000);
    const hdr = await H.authHdrs(s);
    for (const fmt of ['csv', 'xlsx']) {
      const r = await H.rawHttp(port, { path: `/api/v1/exports/claims?format=${fmt}`, headers: hdr, timeoutMs: 120000 });
      expect(r.status, r.error).toBe(200);
      expect(r.headers['content-length']).toBeUndefined();
      expect(String(r.headers['transfer-encoding'])).toMatch(/chunked/);
      expect(r.chunks, 'several chunks').toBeGreaterThan(1);
      expect(r.firstChunkAt).toBeLessThanOrEqual(r.lastChunkAt);
      if (fmt === 'csv') expect(H.parseCsv(r.body.toString('utf8')).length - 1).toBe(total);
      else expect(H.readXlsx(r.body).rows.length - 1).toBe(total);
    }
  }, 300000);
  it('client abort after the first chunk: the server stays healthy, another export works, export.aborted is audited with rowsWritten < total', async (ctx) => {
    if (!ok) return ctx.skip('bulk data not available');
    const app = await buildTestApp();
    const port = await H.listen(app);
    const s = H.wrap(await sessionFor(app, 'manager@globex.test'));
    const seq = await H.lastSeq(gxOwner);
    const hdr = await H.authHdrs(s);
    await H.rawHttp(port, { path: '/api/v1/exports/claims?format=csv', headers: hdr, destroyAfterFirstChunk: true, timeoutMs: 60000 });
    const t0 = Date.now();
    let aborted: any[] = [];
    while (Date.now() - t0 < 8000 && !aborted.length) { await H.sleep(500); aborted = (await exportEvents(seq)).filter((e) => e.action === 'export.aborted'); }
    expect(aborted.length, 'export.aborted within 5 s').toBeGreaterThan(0);
    const rw = aborted[0].metadata?.rowsWritten;
    expect(typeof rw, 'export.aborted metadata: ' + JSON.stringify(aborted[0].metadata)).toBe('number');
    expect(rw).toBeLessThan(total);
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    const again = await H.download(s, `/exports/claims?format=csv&q=${TAG}`);
    expect(again.status).toBe(200);
  }, 120000);
});

describe('EXP-14 limits', () => {
  it('RATE_LIMIT_EXPORT_MAX=2: the third export by the same user -> 429 with Retry-After; another user unaffected', async () => {
    const app = await buildTestApp({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_EXPORT_MAX: '2', RATE_LIMIT_GLOBAL_MAX: '100000', RATE_LIMIT_AUTH_MAX: '100000' });
    const a = H.wrap(await sessionFor(app, ACCOUNTS.MANAGER));
    const b = H.wrap(await sessionFor(app, ACCOUNTS.REVIEWER));
    for (let i = 0; i < 2; i++) expect((await a.get('/exports/claims?format=csv')).status).toBe(200);
    const r = await a.get('/exports/claims?format=csv');
    expectError(r, 429, 'rate_limited');
    expect(String(r.headers['retry-after'])).toMatch(/^\d+$/);
    expect((await b.get('/exports/claims?format=csv')).status).toBe(200);
  });
  it('EXPORT_MAX_CONCURRENT_PER_TENANT=1: a second simultaneous export while the first is read slowly -> 429', async (ctx) => {
    if (!ok) return ctx.skip('bulk data not available');
    const app = await buildTestApp({ EXPORT_MAX_CONCURRENT_PER_TENANT: '1' });
    const port = await H.listen(app);
    const s = H.wrap(await sessionFor(app, 'manager@globex.test'));
    const hdr = await H.authHdrs(s);
    const first = H.rawHttp(port, { path: '/api/v1/exports/claims?format=csv', headers: hdr, slowRead: 300, timeoutMs: 60000, destroyAfterFirstChunk: false });
    await H.sleep(1200);
    const second = await s.get('/exports/claims?format=csv');
    expectError(second, 429, 'rate_limited');
    const f = await first;
    expect(f.status).toBe(200);
  }, 120000);
});
