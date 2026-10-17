/* eslint-disable */
// T-EXP EXP-01, 02, 07, 08, 12, 13: claims CSV/XLSX, RBAC, scope, headers, unicode.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, ALL_ROLES, Client, buildTestApp, closeApps, expectError, expectSecurityHeaders, sessionFor, type Res, type RoleName, type Session } from './helpers/client.js';
import { has, type Role } from './helpers/matrix.js';
import * as H from './helpers/imp.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
let an: Session, rev: Session, mgr: Session, gx: Session;
const SS = {} as Record<RoleName, Session>;
const S = (s: string) => Buffer.from(s, 'utf8');
export const CLAIM_HEADERS = ['Claim Number', 'Load Number', 'Invoice Number', 'Invoice Date', 'Carrier', 'Shipper', 'Perspective', 'Status', 'Amount Claimed (USD)', 'Recoverable (USD)', 'Pending Review (USD)', 'Currency', 'Latest Packet Revision', 'Packet Status', 'Created At', 'Updated At'];
const NUMERIC = new Set(['Amount Claimed (USD)', 'Recoverable (USD)', 'Pending Review (USD)', 'Latest Packet Revision']);
const UNI = 'Caf\u00e9 \u00c5ngstr\u00f6m \ud83d\ude9a \u05d3\u05d5\u05d7';
let awaiting = '';

beforeAll(async () => {
  await H.assertS3Reachable();
  app = await buildTestApp();
  for (const r of ALL_ROLES) SS[r] = H.wrap(await sessionFor(app, ACCOUNTS[r]));
  an = SS.ANALYST; rev = SS.REVIEWER; mgr = SS.MANAGER;
  gx = H.wrap(await sessionFor(app, 'manager@globex.test'));
  for (const [carrier, s] of [[UNI, an], ['Plain Carrier', an], ['Globex Only Carrier', gx]] as [string, Session][]) {
    const load = H.uniqLoad('EX');
    const b = await H.newBatch(s);
    await H.putOk(s, b, 'inv.txt', S(H.invoiceTxt(load, { carrier })));
    const c = await H.commit(s, b, 'SHIPPER');
    if (s === an && carrier === 'Plain Carrier') awaiting = c.body.created[0].claimNumber;
  }
});
afterAll(async () => {
  try { H.assertRecorded('exp-basic'); } finally { await closeApps(); reseed(); }
});

export async function getExport(s: Session, entity: string, q: string) {
  const r = await H.download(s, `/exports/${entity}?${q}`);
  return r;
}
async function csvOf(s: Session, entity: string, q = 'format=csv') {
  const r = await getExport(s, entity, q);
  expect(r.status, r.text.slice(0, 300)).toBe(200);
  expect([...r.buf.subarray(0, 3)], 'UTF-8 BOM').toEqual([0xef, 0xbb, 0xbf]);
  const text = r.buf.toString('utf8');
  expect(text.endsWith('\r\n'), 'CRLF-terminated').toBe(true);
  const rows = H.parseCsvDetailed(text);
  return { r, rows, header: rows[0]!.map((c) => c.v), data: rows.slice(1) };
}
async function claimsApi(s: Session, q: string): Promise<{ items: any[]; total: number }> {
  const items: any[] = [];
  let total = 0;
  for (let p = 1; p < 30; p++) {
    const r = await s.get(`/claims?${q ? q + '&' : ''}page=${p}&pageSize=100`);
    expect(r.status, r.text).toBe(200);
    total = r.body.total;
    items.push(...r.body.items);
    if (items.length >= total || r.body.items.length === 0) break;
  }
  return { items, total };
}
const detailCache = new Map<string, any>();
async function detailOf(s: Session, c: any) { if (!detailCache.has(c.id)) detailCache.set(c.id, (await s.get('/claims/' + c.id)).body); return detailCache.get(c.id); }
const rowOf = (c: any) => [c.claimNumber, c.loadNumber, c.invoiceNumber ?? '', String(c.invoiceDate ?? '').slice(0, 10), c.carrierName, c.shipperName, c.perspective, c.status, H.dollars(c.amountClaimedCents), H.dollars(c.recoverableCents), H.dollars(c.pendingReviewCents), c.currency, c.latestPacket ? String(c.latestPacket.revision) : '', c.latestPacket?.status ?? ''];

describe('EXP-01 claims CSV', () => {
  const queries = ['', 'status=PENDING_REVIEW', 'status=APPROVED,REJECTED', 'perspective=CARRIER', 'q=CLM-000', 'sort=claimNumber:asc', 'sort=recoverableCents:desc', 'status=AWAITING_ANALYSIS'];
  for (const q of queries) {
    it(`filters "${q}": header, row count, values and order equal the JSON API`, async () => {
      const x = await csvOf(mgr, 'claims', `format=csv${q ? '&' + q : ''}`);
      expect(x.header).toEqual(CLAIM_HEADERS);
      const api = await claimsApi(mgr, q);
      expect(x.data.length).toBe(api.total);
      for (let i = 0; i < x.data.length; i++) { api.items[i] = await detailOf(mgr, api.items[i]); }
      x.data.forEach((row, i) => {
        const c = api.items[i];
        const want = rowOf(c);
        expect(row.length).toBe(CLAIM_HEADERS.length);
        want.forEach((w, k) => expect(row[k]!.v, `${c.claimNumber} ${CLAIM_HEADERS[k]}`).toBe(H.neutralize(w)));
        expect(Date.parse(row[14]!.v)).toBe(Date.parse(c.createdAt));
        expect(Date.parse(row[15]!.v)).toBe(Date.parse(c.updatedAt));
        expect(row[14]!.v).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
        CLAIM_HEADERS.forEach((h, k) => {
          if (NUMERIC.has(h) && row[k]!.v === '') expect(row[k]!.quoted).toBe(false);
          else expect(row[k]!.quoted, `${h} quoting`).toBe(!NUMERIC.has(h));
        });
      });
    });
  }
  it('AWAITING_ANALYSIS claims have empty packet columns', async () => {
    const x = await csvOf(mgr, 'claims', 'format=csv&status=AWAITING_ANALYSIS');
    const mine = x.data.find((r) => r[0]!.v === awaiting);
    expect(mine, 'awaiting claim row').toBeTruthy();
    expect(mine![12]!.v).toBe('');
    expect(mine![13]!.v).toBe('');
    expect(mine![7]!.v).toBe('AWAITING_ANALYSIS');
    expect(mine![8]!.v).toBe('0.00');
  });
  it('seeded money example: 32500 cents renders 325.00', async () => {
    const x = await csvOf(mgr, 'claims');
    expect(x.data.some((r) => r[9]!.v === '325.00' || r[8]!.v === '325.00')).toBe(true);
  });
  it('invalid sort/filter -> 400 like R26; page, pageSize and unknown keys -> 400', async () => {
    for (const q of ['sort=bogus:asc', 'status=BOGUS', 'perspective=NOPE', 'page=1', 'pageSize=10', 'bogus=1']) expectError(await mgr.get(`/exports/claims?format=csv&${q}`), 400, 'validation_error');
  });
});

describe('EXP-02 claims XLSX', () => {
  it('valid package, no active content, frozen bold header, typed cells, values equal the CSV export', async () => {
    const csv = await csvOf(mgr, 'claims', 'format=csv&sort=claimNumber:asc');
    const r = await getExport(mgr, 'claims', 'format=xlsx&sort=claimNumber:asc');
    expect(r.status).toBe(200);
    const x = H.readXlsx(r.buf);
    for (const must of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']) expect(x.files, must).toContain(must);
    for (const bad of ['vbaProject', 'externalLinks', 'drawings', 'customXml', 'connections']) expect(x.files.some((f) => f.includes(bad)), bad).toBe(false);
    for (const [name, buf] of x.parts) if (/\.(xml|rels)$/.test(name)) H.assertWellFormedXml(buf.toString('utf8'), name);
    expect(x.sheetName).toBe('claims');
    expect(x.sheetXml).not.toMatch(/<f[\s>\/]/);
    expect(x.parts.get('xl/workbook.xml')!.toString('utf8')).not.toContain('definedName');
    for (const [name, buf] of x.parts) expect(/hyperlink/i.test(buf.toString('utf8')), `hyperlink in ${name}`).toBe(false);
    expect(x.frozen, 'frozen first row').toBe(true);
    expect(x.stylesXml).toMatch(/<b[\s\/>]/);
    expect(x.rows[0]!.every((c) => c.s !== null && c.s !== '0'), 'header cells carry a bold style').toBe(true);
    expect(x.rows[0]!.map((c) => c.v)).toEqual(CLAIM_HEADERS);
    expect(x.rows.length).toBe(csv.rows.length);
    const full = (cells: H.XlsxCell[]) => { const out: H.XlsxCell[] = CLAIM_HEADERS.map((_, k) => ({ ref: '', t: null, s: null, v: '', hasF: false })); for (const c of cells) { let col = 0; for (const ch of c.ref.replace(/[0-9]+/g, '')) col = col * 26 + ch.charCodeAt(0) - 64; out[col - 1] = c; } return out; };
    x.rows.slice(1).forEach((rawRow, i) => {
      full(rawRow).forEach((cell, k) => {
        const h = CLAIM_HEADERS[k]!;
        const want = csv.data[i]![k]!.v;
        if (NUMERIC.has(h)) {
          if (want === '') expect(cell.v).toBe('');
          else { expect(H.isTextCell(cell), `${h} must be numeric`).toBe(false); expect(Number(cell.v)).toBe(Number(want)); }
        } else if (want === '') { expect(cell.v).toBe(''); } else { expect(H.isTextCell(cell), `${h} must be a string`).toBe(true); expect(cell.v).toBe(want); }
      });
    });
  });
});

describe('EXP-07 RBAC', () => {
  const ENT: [string, string][] = [['claims', 'export:claims'], ['packets', 'export:packets'], ['outcomes', 'export:outcomes']];
  it('allow-sets per N2 for csv and xlsx; unauthenticated 401; format missing or invalid -> 400', async () => {
    for (const [ent, perm] of ENT) {
      for (const role of ALL_ROLES) {
        for (const fmt of ['csv', 'xlsx']) {
          const r = await SS[role].get(`/exports/${ent}?format=${fmt}`);
          if (has(role as Role, perm)) expect(r.status, `${role} ${ent} ${fmt}`).toBe(200);
          else expectError(r, 403, 'forbidden');
        }
      }
      expectError(await new Client(app).get(`/exports/${ent}?format=csv`), 401);
      for (const q of ['', 'format=', 'format=pdf', 'format=xls']) expectError(await mgr.get(`/exports/${ent}?${q}`), 400, 'validation_error');
    }
  });
});

describe('EXP-08 scope', () => {
  it('Globex exports contain none of the Acme claim numbers and vice versa; foreign or random claimId -> 404', async () => {
    const acmeNums = (await claimsApi(mgr, '')).items.map((c) => c.claimNumber);
    const gxNums = (await claimsApi(gx, '')).items.map((c) => c.claimNumber);
    const a = await csvOf(mgr, 'claims'), g = await csvOf(gx, 'claims');
    const aSet = new Set(a.data.map((r) => r[0]!.v)), gSet = new Set(g.data.map((r) => r[0]!.v));
    expect([...aSet].sort()).toEqual([...acmeNums].sort());
    expect([...gSet].sort()).toEqual([...gxNums].sort());
    for (const n of gxNums) expect(aSet.has(n) && !acmeNums.includes(n)).toBe(false);
    expect(a.r.text).not.toContain('Globex Only Carrier');
    expect(g.r.text).not.toContain(UNI);
    const acmeClaim = (await claimsApi(mgr, '')).items[0];
    for (const ent of ['packets', 'outcomes']) {
      expectError(await gx.get(`/exports/${ent}?format=csv&claimId=${acmeClaim.id}`), 404, 'not_found');
      expectError(await gx.get(`/exports/${ent}?format=csv&claimId=${H.RAND_UUID}`), 404, 'not_found');
    }
    const narrow = await csvOf(mgr, 'claims', 'format=csv&perspective=CARRIER&status=PENDING_REVIEW');
    const api = await claimsApi(mgr, 'perspective=CARRIER&status=PENDING_REVIEW');
    expect(narrow.data.map((r) => r[0]!.v)).toEqual(api.items.map((c) => c.claimNumber));
  });
});

describe('EXP-12 headers', () => {
  it('content types, Content-Disposition pattern, nosniff, no-store, standard API security headers; chunked without Content-Length', async () => {
    for (const [ent, fmt, ct] of [['claims', 'csv', 'text/csv; charset=utf-8'], ['claims', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], ['packets', 'csv', 'text/csv; charset=utf-8'], ['outcomes', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']] as [string, string, string][]) {
      const r = await getExport(mgr, ent, `format=${fmt}`);
      expect(r.status).toBe(200);
      expect(String(r.headers['content-type']).toLowerCase()).toBe(ct);
      expect(r.headers['content-disposition']).toMatch(new RegExp(`^attachment; filename="freight-recovery-${ent}-[0-9]{8}T[0-9]{6}Z[.]${fmt}"$`));
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.headers['content-length']).toBeUndefined();
      expectSecurityHeaders({ status: 200, headers: r.headers, body: undefined, text: '', setCookies: [], ms: 0 } as Res, { hsts: null });
    }
  });
});

describe('EXP-13 unicode', () => {
  it('accented, emoji and RTL values round-trip identically in CSV and XLSX', async () => {
    const csv = await csvOf(mgr, 'claims', 'format=csv&q=Caf');
    const hit = csv.data.find((r) => r[4]!.v.includes('Caf'));
    expect(hit, 'unicode carrier row').toBeTruthy();
    expect(hit![4]!.v).toBe(H.neutralize(UNI));
    const x = H.readXlsx((await getExport(mgr, 'claims', 'format=xlsx&q=Caf')).buf);
    const row = x.rows.slice(1).find((r) => r[4]!.v.includes('Caf'));
    expect(row![4]!.v).toBe(H.neutralize(UNI));
  });
});
