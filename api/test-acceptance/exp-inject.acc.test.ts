/* eslint-disable */
// EXP-03 formula injection corpus, EXP-15 CSV structural property, P4 neutralization. Claims are created through import.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, buildTestApp, closeApps, sessionFor, type Session } from './helpers/client.js';
import * as H from './helpers/imp.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
let an: Session, rev: Session, mgr: Session;
let listener: Awaited<ReturnType<typeof H.startListener>>;
const S = (s: string) => Buffer.from(s, 'utf8');
const TAG = `INX${H.RUN}`;

beforeAll(async () => {
  await H.assertS3Reachable();
  app = await buildTestApp();
  an = H.wrap(await sessionFor(app, ACCOUNTS.ANALYST));
  rev = H.wrap(await sessionFor(app, ACCOUNTS.REVIEWER));
  mgr = H.wrap(await sessionFor(app, ACCOUNTS.MANAGER));
  listener = await H.startListener();
});
afterAll(async () => {
  try { H.assertRecorded('exp-inject'); await listener.close(); } finally { await closeApps(); reseed(); }
});

const ZW = String.fromCharCode(0x200b), RLO = String.fromCharCode(0x202e);
const corpus = () => [
  '=1+1', `=HYPERLINK("http://127.0.0.1:${listener.port}/x","click")`, '+SUM(A1:A2)', '-2+3', "@SUM(1+1)*cmd|' /C calc'!A0", "=cmd|' /C calc'!A0",
  ' =1+1', '\u00a0=1+1', '\u3000+1', '\uff1d1+1', '\uff0b1', '\uff0d1', '\uff20SUM(1)', "'=1+1", '|calc', '%1', '=', '-', '+', '@', `=${'A'.repeat(299)}`, `${ZW}${RLO}=1+1`,
];
/** One batch of up to 8 invoices; returns claims (by load) with the API values. */
async function importValues(vals: string[], mode: 'carrier' | 'load'): Promise<{ v: string; claim: any }[]> {
  const out: { v: string; claim: any }[] = [];
  for (let i = 0; i < vals.length; i += 8) {
    const slice = vals.slice(i, i + 8);
    const b = await H.newBatch(an);
    const docs: { v: string; d: any; load: string }[] = [];
    for (const [k, v] of slice.entries()) {
      const load = mode === 'load' ? v : H.uniqLoad('EXI');
      const inv = `${TAG}-${i + k}`;
      const text = `DOCUMENT: FREIGHT INVOICE\nInvoice Number: ${inv}\nCarrier: ${mode === 'carrier' ? v : 'Acme Freight LLC'}\nShipper: ${v}\nLoad Number: ${load}\nInvoice Date: 2025-03-10\nCharge: Linehaul | 5.00\nTotal: 5.00\n`;
      const r = await H.upload(an, b, 'inv.txt', S(text));
      if (r.status !== 201 || r.body.status === 'REJECTED') continue;
      let d = r.body;
      if (d.status !== 'ACCEPTED') {
        const a = await H.acceptDoc(rev, b, d.id, true);
        if (a.status !== 200) continue;
        d = a.body;
      }
      docs.push({ v, d, load });
    }
    const c = await H.commit(an, b);
    expect(c.status, c.text).toBe(200);
    for (const cr of [...c.body.created]) {
      const claim = (await mgr.get(`/claims/${cr.claimId}`)).body;
      out.push({ v: docs.find((x) => cr.loadNumber === (x.d.loadNumber ?? x.load))?.v ?? '', claim });
    }
  }
  return out;
}
async function exportRows(q: string) {
  const csv = (await H.download(mgr, `/exports/claims?format=csv&q=${TAG}${q}`));
  expect(csv.status).toBe(200);
  const rows = H.parseCsvDetailed(csv.buf.toString('utf8'));
  const xlsx = H.readXlsx((await H.download(mgr, `/exports/claims?format=xlsx&q=${TAG}${q}`)).buf);
  return { csv, rows, xlsx };
}
const HEAD = ['Claim Number', 'Load Number', 'Invoice Number', 'Invoice Date', 'Carrier', 'Shipper'];

describe('EXP-03 formula injection corpus', () => {
  it('no exported text cell can start a formula; cleaned originals keep their text; numeric cells stay numeric; no <f> in XLSX', async () => {
    const made = [...(await importValues(corpus(), 'carrier')), ...(await importValues(corpus(), 'load'))];
    expect(made.length, 'claims created from the corpus').toBeGreaterThan(20);
    const { rows, xlsx } = await exportRows('');
    const header = rows[0]!.map((c) => c.v);
    const byNo = new Map(rows.slice(1).map((r) => [r[0]!.v, r]));
    expect(byNo.size).toBeGreaterThanOrEqual(made.length);
    for (const { claim } of made) {
      const row = byNo.get(claim.claimNumber);
      expect(row, claim.claimNumber).toBeTruthy();
      for (const [k, key] of [[1, 'loadNumber'], [2, 'invoiceNumber'], [4, 'carrierName'], [5, 'shipperName']] as [number, string][]) {
        const want = H.neutralize(claim[key] ?? '');
        expect(row![k]!.v, `${claim.claimNumber} ${header[k]} (api ${JSON.stringify(claim[key])})`).toBe(want);
        expect(row![k]!.quoted).toBe(true);
        expect(claim[key] ?? '', 'GET /claims keeps the un-prefixed text').toBe(claim[key] ?? '');
      }
    }
    for (const r of rows.slice(1)) for (const c of r) if (c.quoted) expect(/^\s*[=+\-@]/u.test(c.v) || H.startsWithTrigger(c.v), `text cell ${JSON.stringify(c.v.slice(0, 40))} starts a formula`).toBe(false);
    for (const r of rows.slice(1)) for (const k of [8, 9, 10]) { expect(r[k]!.quoted).toBe(false); expect(Number.isFinite(Number(r[k]!.v))).toBe(true); }
    expect(xlsx.sheetXml).not.toMatch(/<f[\s>\/]/);
    for (const r of xlsx.rows.slice(1)) {
      for (const c of r) if (H.isTextCell(c)) expect(H.startsWithTrigger(c.v), `xlsx cell ${JSON.stringify(c.v.slice(0, 40))}`).toBe(false);
      for (const k of [8, 9, 10]) expect(H.isTextCell(r[k]!), 'money cell must be numeric').toBe(false);
    }
    await H.sleep(500);
    expect(listener.hits(), 'nobody evaluates the exports').toBe(0);
  }, 600000);
});

describe('EXP-15 CSV structural property (300 random carrier strings) and P4 neutralization', () => {
  const R = H.rng(H.ACC_SEED + 15);
  const ALPHA = 'abcXYZ019  ,,"\'\';;\t\\=+-@\u00e9\u00fc'.split('').concat(['\ud83d\ude9a', '\uff1d', '\uff0b', '\uff0d', '\uff20', '\u05d0', ' ', ',', '"']);
  it(`random carrier strings parse back to exactly neutralize(clean(value)) in CSV and XLSX (seed ${H.ACC_SEED + 15})`, async () => {
    const vals = Array.from({ length: 300 }, () => Array.from({ length: 1 + R.int(24) }, () => R.pick(ALPHA)).join(''));
    const made = await importValues(vals, 'carrier');
    console.log(`[EXP-15] seed=${H.ACC_SEED + 15} generated=300 imported=${made.length}`);
    expect(made.length).toBeGreaterThan(150);
    const { rows, xlsx } = await exportRows('');
    const byNo = new Map(rows.slice(1).map((r) => [r[0]!.v, r]));
    const xByNo = new Map(xlsx.rows.slice(1).map((r) => [r[0]!.v, r]));
    let checked = 0;
    for (const { claim } of made) {
      const want = H.neutralize(claim.carrierName ?? '');
      const row = byNo.get(claim.claimNumber);
      expect(row, claim.claimNumber).toBeTruthy();
      expect(row![4]!.v, `carrier ${JSON.stringify(claim.carrierName)}`).toBe(want);
      expect(xByNo.get(claim.claimNumber)![4]!.v).toBe(want);
      checked++;
    }
    expect(checked).toBe(made.length);
  }, 900000);
  it('P4: integer cents render by integer arithmetic and parse back exactly; text cells never start with a trigger (random sample)', async () => {
    const rr = H.rng(H.ACC_SEED + 4);
    for (let i = 0; i < 2000; i++) {
      const cents = rr.int(2) ? rr.int(100000000) : -rr.int(100000000);
      const s = H.dollars(cents);
      expect(s).toMatch(/^-?\d+\.\d{2}$/);
      const back = Math.round(Number(s) * 100);
      expect(back).toBe(cents === 0 ? 0 : cents);
    }
    for (let i = 0; i < 3000; i++) {
      const v = Array.from({ length: 1 + rr.int(12) }, () => rr.pick(ALPHA.concat([' ', '\u3000', '\u00a0', ZW, RLO]))).join('');
      expect(H.startsWithTrigger(H.neutralize(v)), JSON.stringify(v)).toBe(false);
    }
  });
});
