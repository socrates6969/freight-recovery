/* eslint-disable */
// T-TEN-IMP: tenant isolation (IDOR) on every new route and object, plus database-level guarantees (N11).
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, buildTestApp, closeApps, expectError, sessionFor, strip, type Session } from './helpers/client.js';
import { buildInsert, inRollback, tryQuery, withAdmin, withApp } from './helpers/db.js';
import * as H from './helpers/imp.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
let acmeAn: Session, acmeRev: Session, acmeMgr: Session, gxMgr: Session, gxOwner: Session;
let acmeT = '', gxT = '';
const S = (s: string) => Buffer.from(s, 'utf8');
const CAN_A = `CANARY-ACME-${H.RUN}`, CAN_G = `CANARY-GLX-${H.RUN}`;
interface Side { b: string; d: string; f: string; claim: string; docs: any[] }
let A: Side, G: Side;

async function build(s: Session, rev: Session, canary: string): Promise<Side> {
  const load = H.uniqLoad('TN');
  const b = await H.newBatch(s, canary);
  const inv = await H.putOk(s, b, `${canary}.txt`, S(H.invoiceTxt(load, { carrier: `${canary} Freight` })));
  const pdf = await H.putOk(s, b, 'rc.pdf', H.buildPdf(['DOCUMENT: RATE CONFIRMATION', `Load Number: ${load}`, `Carrier: ${canary} Carrier`, 'Linehaul Rate: 5.00']));
  const bol = await H.putOk(s, b, 'bol.txt', S(H.bolTxt(load)));
  const c = await H.commit(s, b);
  expect(c.status, c.text).toBe(200);
  return { b, d: pdf.id, f: pdf.fields[0].id, claim: c.body.created[0].claimId, docs: [inv, pdf, bol] };
}
beforeAll(async () => {
  await H.assertS3Reachable();
  app = await buildTestApp();
  acmeAn = H.wrap(await sessionFor(app, ACCOUNTS.ANALYST));
  acmeRev = H.wrap(await sessionFor(app, ACCOUNTS.REVIEWER));
  acmeMgr = H.wrap(await sessionFor(app, ACCOUNTS.MANAGER));
  gxMgr = H.wrap(await sessionFor(app, 'manager@globex.test'));
  gxOwner = H.wrap(await sessionFor(app, 'owner@globex.test'));
  acmeT = H.tenantIdOf(acmeAn);
  gxT = H.tenantIdOf(gxMgr);
  A = await build(acmeAn, acmeRev, CAN_A);
  G = await build(gxMgr, gxMgr, CAN_G);
});
afterAll(async () => {
  try { H.assertRecorded('imp-tenant'); } finally { await closeApps(); reseed(); }
});

type Call = [string, (x: Side) => string, ((x: Side) => any)?];
const REASON = 'cross tenant probe reason';
const CALLS: Call[] = [
  ['GET', (x) => `/imports/${x.b}`], ['GET', (x) => `/imports/${x.b}/documents/${x.d}`], ['GET', (x) => `/imports/${x.b}/documents/${x.d}/original`],
  ['PATCH', (x) => `/imports/${x.b}/documents/${x.d}`, () => ({ docType: 'INVOICE' })],
  ['POST', (x) => `/imports/${x.b}/documents/${x.d}/fields`, () => ({ key: 'rate_confirmation.carrier', value: 'x', reason: REASON })],
  ['POST', (x) => `/imports/${x.b}/documents/${x.d}/fields/${x.f}/resolve`, () => ({ action: 'CONFIRM', reason: REASON })],
  ['POST', (x) => `/imports/${x.b}/documents/${x.d}/accept`, () => ({ reason: REASON })],
  ['POST', (x) => `/imports/${x.b}/documents/${x.d}/reject`, () => ({ reason: REASON })],
  ['POST', (x) => `/imports/${x.b}/commit`, () => ({ perspective: 'SHIPPER' })],
  ['GET', (x) => `/claims/${x.claim}/documents`], ['GET', (x) => `/exports/packets?format=csv&claimId=${x.claim}`], ['GET', (x) => `/exports/outcomes?format=csv&claimId=${x.claim}`],
];
const RAND: Side = { b: randomUUID(), d: randomUUID(), f: randomUUID(), claim: randomUUID(), docs: [] };

describe('T-TEN-IMP IDOR: foreign ids are indistinguishable from random ids', () => {
  for (const [label, attacker, victim] of [['Globex user vs Acme ids', () => gxOwner, () => A], ['Acme user vs Globex ids', () => acmeMgr, () => G]] as [string, () => Session, () => Side][]) {
    it(label, async () => {
      const s = attacker(), v = victim();
      for (const [m, path, body] of CALLS) {
        const real = await s.as(m, path(v), { body: body?.(v) });
        const fake = await s.as(m, path(RAND), { body: body?.(RAND) });
        expectError(real, 404, 'not_found');
        expect(real.status).toBe(fake.status);
        expect(strip(real.body)).toEqual(strip(fake.body));
        const norm = (t: string) => t.replace(/"requestId":"[^"]*"/, '');
        expect(norm(real.text), `${m} ${path(v)}`).toBe(norm(fake.text));
      }
    });
  }
  it('a real document id under another real batch of the same tenant -> 404', async () => {
    const other = await H.newBatch(acmeAn);
    for (const p of [`/imports/${other}/documents/${A.d}`, `/imports/${other}/documents/${A.d}/original`]) expectError(await acmeAn.get(p), 404, 'not_found');
    expectError(await acmeRev.post(`/imports/${other}/documents/${A.d}/reject`, { reason: REASON }), 404, 'not_found');
    expectError(await acmeRev.post(`/imports/${other}/documents/${A.d}/fields/${A.f}/resolve`, { action: 'CONFIRM', reason: REASON }), 404, 'not_found');
    expectError(await acmeRev.post(`/imports/${A.b}/documents/${A.d}/fields/${G.f}/resolve`, { action: 'CONFIRM', reason: REASON }), 404, 'not_found');
  });
  it('upload into a foreign batch -> 404 and nothing is stored in either tenant', async () => {
    const r = await H.upload(gxMgr, A.b, 'x.txt', S(H.bolTxt(H.uniqLoad('TN'))));
    expectError(r, 404, 'not_found');
    expect((await acmeAn.get(`/imports/${A.b}`)).body.documentCount).toBe(3);
  });
});

describe('T-TEN-IMP lists, exports and objects contain only the caller tenant data', () => {
  const textOf = async (s: Session, paths: string[]) => (await Promise.all(paths.map(async (p) => (await s.get(p)).text))).join('\n');
  it('imports, reviews, claim documents and exports carry only their own canaries', async () => {
    for (const [s, own, other, side] of [[acmeMgr, CAN_A, CAN_G, A], [gxMgr, CAN_G, CAN_A, G]] as [Session, string, string, Side][]) {
      const t = await textOf(s, ['/imports?pageSize=100', `/imports/${side.b}`, '/reviews?pageSize=100', `/claims/${side.claim}/documents`, '/claims?pageSize=100&q=' + own]);
      expect(t).toContain(own);
      expect(t).not.toContain(other);
      const csv = await s.get('/exports/claims?format=csv');
      expect(csv.status, csv.text.slice(0, 200)).toBe(200);
      expect(csv.text).not.toContain(other);
      const all = await textOf(s, ['/imports?pageSize=100']);
      expect(all).not.toContain(other);
    }
  });
  it('identical bytes uploaded by both tenants are both accepted; Globex is not flagged DUPLICATE_OF_EARLIER by Acme', async () => {
    const bytes = S(H.bolTxt(H.uniqLoad('TN')));
    const a = await H.putFresh(acmeAn, 'same.txt', bytes);
    const g = await H.putFresh(gxMgr, 'same.txt', bytes);
    expect(a.res.status).toBe(201);
    expect(g.res.status).toBe(201);
    expect(g.doc.status).toBe('ACCEPTED');
    expect(g.doc.reviewReasons).not.toContain('DUPLICATE_OF_EARLIER');
    expect(g.doc.sha256).toBe(a.doc.sha256);
  });
  it('every object key starts with the owning tenant prefix; no response contains another tenant id; R45 returns the caller bytes only', async () => {
    const keys = await H.s3List('t/');
    for (const k of keys) expect(k).toMatch(H.KEY_RE());
    const mine = keys.filter((k) => k.startsWith(`t/${acmeT}/`)), theirs = keys.filter((k) => k.startsWith(`t/${gxT}/`));
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);
    expect(mine.every((k) => k.startsWith(`t/${acmeT}/imports/`))).toBe(true);
    expect(theirs.every((k) => k.startsWith(`t/${gxT}/imports/`))).toBe(true);
    const aj = await acmeAn.get(`/imports/${A.b}`);
    expect(aj.text).not.toContain(gxT);
    expect(aj.text).not.toMatch(/imports\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/(original|text)/);
    for (const [s, side] of [[acmeAn, A], [gxMgr, G]] as [Session, Side][]) {
      for (const doc of side.docs.filter((d) => d.status !== 'REJECTED')) {
        const dl = await H.download(s, `/imports/${side.b}/documents/${doc.id}/original`);
        expect(dl.status).toBe(200);
        expect(H.sha256(dl.buf)).toBe(doc.sha256);
      }
    }
  });
});

async function guc(table: string): Promise<string | null> {
  return withAdmin(async (c) => {
    const r = await c.query(`select qual from pg_policies where tablename=$1`, [table]);
    for (const row of r.rows) { const m = /current_setting\('([^']+)'/.exec(row.qual ?? ''); if (m) return m[1]!; }
    const fn = await c.query(`select prosrc from pg_proc where proname = 'fr_current_tenant'`);
    const src: string = fn.rows[0]?.prosrc ?? '';
    const k = src.indexOf("current_setting('");
    if (k >= 0) return src.slice(k + 17, src.indexOf("'", k + 17));
    return null;
  });
}
const TABLES = ['import_batches', 'import_documents', 'extracted_fields', 'import_review_decisions', 'claim_documents'];

describe('T-TEN-IMP database guarantees (N11)', () => {
  it('freight_app without application context sees zero rows and cannot insert (owner sees rows and can insert)', async () => {
    await acmeRev.post(`/imports/${A.b}/documents/${A.d}/fields/${A.f}/resolve`, { action: 'CONFIRM', reason: REASON }); // makes sure a review decision row exists
    await withApp(async (a) => withAdmin(async (adm) => {
      for (const t of TABLES) {
        expect((await adm.query(`select count(*)::int n from ${t}`)).rows[0].n, `owner sees ${t}`).toBeGreaterThan(0);
        expect((await a.query(`select count(*)::int n from ${t}`)).rows[0].n, `app w/o context sees ${t}`).toBe(0);
        const ins = await buildInsert(adm, t, { tenant_id: `'${acmeT}'` }).catch(() => null);
        if (!ins) continue;
        const bad = await tryQuery(a, ins);
        expect(bad.ok, `${t}: app role must not insert without context`).toBe(false);
      }
    }));
  });
  it('with the Globex tenant context Acme rows are invisible and an Acme insert fails', async (ctx) => {
    const g = await guc('import_documents');
    if (!g) return ctx.skip('cannot discover the tenant context setting from pg_policies');
    await withApp(async (a) => {
      await a.query('BEGIN');
      try {
        await a.query(`select set_config($1, $2, true)`, [g, gxT]);
        for (const t of TABLES) {
          const r = await a.query(`select count(*)::int n from ${t} where tenant_id = $1`, [acmeT]);
          expect(r.rows[0].n, `${t}: Acme rows visible under Globex context`).toBe(0);
        }
        expect((await a.query(`select count(*)::int n from import_documents`)).rows[0].n).toBeGreaterThan(0);
      } finally { await a.query('ROLLBACK'); }
      await withAdmin(async (adm) => {
        const ins = await buildInsert(adm, 'import_batches', { tenant_id: `'${acmeT}'` });
        await a.query('BEGIN');
        try {
          await a.query(`select set_config($1, $2, true)`, [g, gxT]);
          const bad = await tryQuery(a, ins);
          expect(bad.ok, 'insert for Acme under Globex context must fail').toBe(false);
        } finally { await a.query('ROLLBACK'); }
      });
    });
  });
  it('the owner role cannot insert an import_documents row whose storage_key is outside its tenant prefix (CHECK)', async () => {
    await withAdmin(async (adm) => {
      const batch = (await adm.query(`select id from import_batches where tenant_id=$1 limit 1`, [acmeT])).rows[0].id;
      const user = (await adm.query(`select uploaded_by_id u from import_documents where tenant_id=$1 limit 1`, [acmeT])).rows[0].u;
      const ov = (key: string) => ({ tenant_id: `'${acmeT}'`, batch_id: `'${batch}'`, uploaded_by_id: `'${user}'`, storage_key: `'${key}'`, sha256: `'${'f'.repeat(64)}'` });
      const badIns = await buildInsert(adm, 'import_documents', ov(`t/${gxT}/imports/x/y/original`));
      const r = await inRollback(adm, () => tryQuery(adm, badIns));
      expect(r.ok, 'foreign-prefix storage_key must violate a CHECK').toBe(false);
      expect(r.error).toMatch(/check|constraint|violat/i);
    });
  });
});

describe('T-TEN-IMP immutability for the app role (N11)', () => {
  async function asApp(sql: string, params: unknown[] = []) {
    const g = await guc('import_documents');
    return withApp(async (a) => {
      await a.query('BEGIN');
      try {
        if (g) await a.query(`select set_config($1, $2, true)`, [g, acmeT]);
        return await tryQuery(a, sql, params);
      } finally { await a.query('ROLLBACK'); }
    });
  }
  const rejected = (r: { ok: boolean; rowCount: number }) => r.ok === false || r.rowCount === 0;
  it('import_review_decisions rejects UPDATE, DELETE and TRUNCATE', async (ctx) => {
    if (!(await guc('import_documents'))) return ctx.skip('tenant context setting not discoverable');
    expect([200, 409]).toContain((await acmeRev.post(`/imports/${A.b}/documents/${A.d}/fields/${A.f}/resolve`, { action: 'CONFIRM', reason: REASON })).status);
    const vis = await asApp(`select count(*)::int n from import_review_decisions`);
    expect(vis.rows[0].n).toBeGreaterThan(0);
    expect(rejected(await asApp(`update import_review_decisions set reason='tampered reason text'`))).toBe(true);
    expect(rejected(await asApp(`delete from import_review_decisions`))).toBe(true);
    expect((await asApp(`truncate import_review_decisions`)).ok).toBe(false);
    await withAdmin(async (adm) => {
      expect((await adm.query(`select count(*)::int n from import_review_decisions where reason='tampered reason text'`)).rows[0].n).toBe(0);
    });
  });
  it('import_documents rejects UPDATE of sha256, size_bytes, storage_key, detected_type, tenant_id, batch_id and DELETE', async (ctx) => {
    if (!(await guc('import_documents'))) return ctx.skip('tenant context setting not discoverable');
    const sets = [`sha256='${'0'.repeat(64)}'`, `size_bytes=size_bytes+1`, `storage_key='t/${acmeT}/imports/x/y/original'`, `detected_type='PNG'`, `tenant_id='${gxT}'`, `batch_id=gen_random_uuid()`];
    for (const s of sets) expect(rejected(await asApp(`update import_documents set ${s}`)), s).toBe(true);
    expect(rejected(await asApp(`delete from import_documents`))).toBe(true);
    await withAdmin(async (adm) => {
      expect((await adm.query(`select count(*)::int n from import_documents where sha256='${'0'.repeat(64)}'`)).rows[0].n).toBe(0);
    });
  });
  it('extracted_fields rejects UPDATE of value, confidence, key and DELETE; claim_documents rejects UPDATE and DELETE', async (ctx) => {
    if (!(await guc('import_documents'))) return ctx.skip('tenant context setting not discoverable');
    for (const s of [`value='tampered'`, `confidence=0.01`, `key='invoice.total'`]) expect(rejected(await asApp(`update extracted_fields set ${s}`)), s).toBe(true);
    expect(rejected(await asApp(`delete from extracted_fields`))).toBe(true);
    expect(rejected(await asApp(`update claim_documents set claim_id=gen_random_uuid()`))).toBe(true);
    expect(rejected(await asApp(`delete from claim_documents`))).toBe(true);
    await withAdmin(async (adm) => {
      expect((await adm.query(`select count(*)::int n from extracted_fields where value='tampered'`)).rows[0].n).toBe(0);
    });
  });
});
