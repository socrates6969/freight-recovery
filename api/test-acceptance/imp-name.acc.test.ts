/* eslint-disable */
// T-IMP-NAME: file name handling. displayName rules, object keys never contain client names, R45 header is synthesized.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, buildTestApp, closeApps, expectError, sessionFor, type Session } from './helpers/client.js';
import * as H from './helpers/imp.js';

let app: FastifyInstance;
let analyst: Session;
let tenantId = '';
beforeAll(async () => {
  await H.assertS3Reachable();
  app = await buildTestApp();
  analyst = H.wrap(await sessionFor(app, ACCOUNTS.ANALYST));
  tenantId = H.tenantIdOf(analyst);
});
afterAll(async () => {
  try { H.assertRecorded('imp-name'); } finally { await closeApps(); }
});

const TXT = () => Buffer.from(`DOCUMENT: BILL OF LADING\nLoad Number: ${H.uniqLoad('NM')}\nFacility: Dock 4\n`);
const CSV = () => Buffer.from(`Document,Bill of Lading\nLoad Number,${H.uniqLoad('NM')}\n`);
const BIDI = /[\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/;
const CTRL = /[\u0000-\u001f\u007f-\u009f]/;

function expectDisplayName(n: string) {
  expect(/[\/\:*?"<>|]/.test(n), `displayName ${JSON.stringify(n)} has a forbidden char`).toBe(false);
  expect(CTRL.test(n)).toBe(false);
  expect(BIDI.test(n)).toBe(false);
  expect(n).toBe(n.normalize('NFC'));
  expect([...n].length).toBeLessThanOrEqual(255);
  expect(n.length).toBeGreaterThan(0);
}

const OK: [string, string | null][] = [
  ['../../etc/passwd.txt', null], ['..' + String.fromCharCode(92) + '..' + String.fromCharCode(92) + 'windows' + String.fromCharCode(92) + 'config.txt', null], ['/etc/shadow.txt', null], ['C:' + String.fromCharCode(92) + 'x' + String.fromCharCode(92) + 'y.txt', null],
  ['%2e%2e%2f.txt', null], ['a/b.txt', null], ['NUL.txt', null], ['invoice\u202efdp.txt', 'invoicefdp.txt'], ['e\u0301.txt', '\u00e9.txt'],
  [`${'a'.repeat(251)}.txt`, null], ['\u05d3\u05d5\u05d7 \ud83d\ude9a report.txt', '\u05d3\u05d5\u05d7 \ud83d\ude9a report.txt'], ['\u0645\u0644\u0641 \u0627\u062e\u062a\u0628\u0627\u0631.txt', '\u0645\u0644\u0641 \u0627\u062e\u062a\u0628\u0627\u0631.txt'],
  ['a  b   c.txt', 'a b c.txt'], ['  .lead and trail.txt  ', null], ['a\u202etxt\u202c.txt', 'atxt.txt'],
];

describe('T-IMP-NAME accepted names', () => {
  for (const [name, expected] of OK) {
    it(`name ${JSON.stringify(name).slice(0, 60)}`, async () => {
      const batchId = await H.newBatch(analyst);
      const bytes = TXT();
      const r = await H.upload(analyst, batchId, name, bytes);
      expect(r.status, r.text).toBe(201);
      const d = r.body;
      expectDisplayName(d.displayName);
      if (expected) expect(d.displayName).toBe(expected);
      if (name.length === 255) expect([...d.displayName].length).toBeLessThanOrEqual(255);
      if (name.startsWith('  .lead')) { expect(d.displayName.startsWith(' ')).toBe(false); expect(d.displayName.startsWith('.')).toBe(false); expect(d.displayName.endsWith(' ')).toBe(false); }
      const keys = await H.s3List(`t/${tenantId}/imports/${batchId}/`);
      expect(keys.length).toBeGreaterThan(0);
      for (const k of keys) expect(k, 'object key').toMatch(H.KEY_RE(tenantId));
      const dl = await analyst.get(`/imports/${batchId}/documents/${d.id}/original`);
      expect(dl.status).toBe(200);
      const ext = { PDF: 'pdf', PNG: 'png', JPEG: 'jpg', CSV: 'csv', TXT: 'txt' }[d.detectedType as 'TXT'];
      expect(dl.headers['content-disposition']).toBe(`attachment; filename="document-${d.id.slice(0, 8)}.${ext}"`);
      expect(dl.headers['content-type']).toMatch(/^application\/octet-stream/);
      expect(dl.headers['x-content-type-options']).toBe('nosniff');
      expect(dl.headers['cache-control']).toBe('no-store');
    });
  }
  it('CON.csv is accepted as a CSV and shown without path characters', async () => {
    const { doc, res } = await H.putFresh(analyst, 'CON.csv', CSV());
    expect(res.status, res.text).toBe(201);
    expectDisplayName(doc.displayName);
    expect(doc.detectedType).toBe('CSV');
  });
});

describe('T-IMP-NAME rejected names', () => {
  it('NUL in the name (a%00b.txt) -> 400 validation_error', async () => {
    const b = await H.newBatch(analyst);
    expectError(await H.upload(analyst, b, 'a\u0000b.txt', TXT()), 400, 'validation_error');
    expect((await analyst.get(`/imports/${b}`)).body.documentCount).toBe(0);
  });
  it('invoice<RLO>txt.exe -> 415 unsupported_type (the override cannot hide the extension)', async () => {
    const b = await H.newBatch(analyst);
    const r = await H.upload(analyst, b, 'invoice\u202etxt.exe', TXT());
    expectError(r, 415, 'unsupported_media_type');
    expect(r.body.error.details?.[0]?.code).toBe('unsupported_type');
  });
  it('256+ character name -> 400', async () => {
    const b = await H.newBatch(analyst);
    expectError(await H.upload(analyst, b, `${'a'.repeat(300)}.txt`, TXT()), 400, 'validation_error');
    expectError(await H.upload(analyst, b, `${'a'.repeat(252)}.txt`, TXT()), 400, 'validation_error');
  });
  it('no object key anywhere contains a client name fragment', async () => {
    const keys = await H.s3List(`t/${tenantId}/imports/`);
    for (const k of keys) expect(k).toMatch(H.KEY_RE(tenantId));
  });
});
