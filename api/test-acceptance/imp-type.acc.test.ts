/* eslint-disable */
// T-IMP-TYPE: sniffing and extension rules. Each table row is one test; rejected rows are also checked for
// "no document row / no object / audit event with documentId null".
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, buildTestApp, closeApps, expectError, sessionFor, type Res, type Session } from './helpers/client.js';
import * as H from './helpers/imp.js';

let app: FastifyInstance;
let analyst: Session, admin: Session;
let tenantId = '';
let seq0 = 0;
let rejBatch = '';
const auditedReasons: string[] = [];
const S = (s: string) => Buffer.from(s, 'utf8');
const TXT = S('DOCUMENT: BILL OF LADING\nLoad Number: LD-TYPE-1\nFacility: Dock 4\n');
const CSV = S('Document,Bill of Lading\nLoad Number,LD-TYPE-2\n');
const PDF = () => H.buildPdf(['DOCUMENT: RATE CONFIRMATION', 'Load Number: LD-TYPE-3']);

beforeAll(async () => {
  await H.assertS3Reachable();
  app = await buildTestApp();
  analyst = H.wrap(await sessionFor(app, ACCOUNTS.ANALYST));
  admin = await sessionFor(app, ACCOUNTS.ADMIN);
  tenantId = H.tenantIdOf(analyst);
  seq0 = await H.lastSeq(admin);
  rejBatch = await H.newBatch(analyst, 'type rejects');
});
afterAll(async () => {
  try { H.assertRecorded('imp-type'); } finally { await closeApps(); }
});

/** Upload expecting 415 {reason}; nothing stored. */
async function rej(name: string, bytes: Buffer | string, reason: string | string[], status = 415) {
  const r = await H.upload(analyst, rejBatch, name, bytes);
  expect(r.status, `rejected row ${name} hex=${Buffer.from(bytes).subarray(0, 80).toString('hex')} got ${r.status}`).toBe(status);
  expectError(r, status, status === 413 ? 'payload_too_large' : 'unsupported_media_type');
  const got = r.body.error.details?.[0]?.code;
  const ok = Array.isArray(reason) ? reason : [reason];
  expect(ok, `${name}: reason ${got} (${r.text})`).toContain(got);
  if (status !== 413) auditedReasons.push(got);
  return r;
}
async function acc(name: string, bytes: Buffer | string, o: H.UpOpts = {}) {
  const batchId = await H.newBatch(analyst);
  const r = await H.upload(analyst, batchId, name, bytes, o);
  expect(r.status, `${name}: ${r.text}`).toBe(201);
  return r.body;
}

describe('T-IMP-TYPE accepted rows', () => {
  it('a.txt plain text', async () => { expect((await acc('a.txt', TXT)).detectedType).toBe('TXT'); });
  it('upper-case extensions a.TXT a.CSV a.PDF', async () => {
    expect((await acc('a.TXT', TXT)).detectedType).toBe('TXT');
    expect((await acc('a.CSV', CSV)).detectedType).toBe('CSV');
    expect((await acc('a.PDF', PDF())).detectedType).toBe('PDF');
  });
  it('invoice.exe.pdf (only the last extension counts)', async () => { expect((await acc('invoice.exe.pdf', PDF())).detectedType).toBe('PDF'); });
  it('a.txt with form feed, tabs, CRLF', async () => {
    const d = await acc('a.txt', S('DOCUMENT: BILL OF LADING\r\n\tLoad Number: LD-TYPE-4\f\r\nFacility:\tDock 9\r\n'));
    expect(['ACCEPTED', 'NEEDS_REVIEW']).toContain(d.status);
  });
  it('a.txt 1 byte -> NEEDS_REVIEW UNKNOWN_DOC_TYPE', async () => {
    const d = await acc('a.txt', S('x'));
    expect(d.status).toBe('NEEDS_REVIEW');
    expect(d.reviewReasons).toContain('UNKNOWN_DOC_TYPE');
  });
  it('latin-1 / cp1252 bytes -> DECODE_REPLACEMENTS, NEEDS_REVIEW, confidence <= 0.600', async () => {
    const d = await acc('a.txt', Buffer.concat([S('DOCUMENT: FREIGHT INVOICE\nInvoice Number: INV-L1\nLoad Number: LD-TYPE-5\nCarrier: Caf'), Buffer.from([0xe9]), S(' Freight\n')]));
    expect(d.warnings).toContain('DECODE_REPLACEMENTS');
    expect(d.reviewReasons).toContain('DECODE_REPLACEMENTS');
    expect(d.status).toBe('NEEDS_REVIEW');
    expect(d.fields.length).toBeGreaterThan(0);
    for (const f of d.fields) expect(f.confidence, f.key).toBeLessThanOrEqual(0.6);
  });
  it('UTF-8 BOM is not part of any value and the first line is keyed correctly', async () => {
    const d = await acc('a.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), S('DOCUMENT: BILL OF LADING\nLoad Number: LD-TYPE-6\n')]));
    expect(d.docType).toBe('BILL_OF_LADING');
    expect(d.docTypeBasis).toBe('HEADER');
    expect(H.val(d, 'bol.load_number')).toBe('LD-TYPE-6');
    for (const f of d.fields) expect(f.value ?? '').not.toContain(String.fromCharCode(0xfeff));
  });
  for (const [name, bytes] of [['a.png', H.buildPng()], ['a.jpg', H.buildJpeg()], ['a.jpeg', H.buildJpeg()]] as [string, Buffer][]) {
    it(`${name} minimal valid image -> NEEDS_REVIEW OTHER/NONE IMAGE_NO_TEXT_LAYER, no fields`, async () => {
      const d = await acc(name, bytes);
      expect(d.status).toBe('NEEDS_REVIEW');
      expect(d.docType).toBe('OTHER');
      expect(d.docTypeBasis).toBe('NONE');
      expect(d.reviewReasons).toContain('IMAGE_NO_TEXT_LAYER');
      expect(d.reviewReasons.filter((x: string) => x !== 'UNKNOWN_DOC_TYPE' && x !== 'DUPLICATE_OF_EARLIER')).toEqual(['IMAGE_NO_TEXT_LAYER']);
      expect(d.fieldCount).toBe(0);
      expect(d.pageCount).toBeNull();
    });
  }
  it('Content-Type application/octet-stream; charset=binary is accepted', async () => {
    await acc('a.txt', TXT, { ct: 'application/octet-stream; charset=binary' });
  });
});

describe('T-IMP-TYPE rejected rows', () => {
  it('invoice.pdf.exe -> unsupported_type', async () => { await rej('invoice.pdf.exe', PDF(), 'unsupported_type'); });
  it('a.pdf with PNG bytes / a.png with PDF bytes -> type_mismatch', async () => {
    await rej('a.pdf', H.buildPng(), 'type_mismatch');
    await rej('a.png', PDF(), 'type_mismatch');
  });
  it('a.txt and a.csv with PDF / PNG / JPEG bytes -> type_mismatch', async () => {
    for (const n of ['a.txt', 'a.csv']) for (const b of [PDF(), H.buildPng(), H.buildJpeg()]) await rej(n, b, 'type_mismatch');
  });
  it('a.jpg with text bytes -> type_mismatch', async () => { await rej('a.jpg', TXT, 'type_mismatch'); });
  it('a.pdf with a JPEG header then %PDF- later -> type_mismatch', async () => {
    await rej('a.pdf', Buffer.concat([H.buildJpeg({ noEoi: true }).subarray(0, 40), S('%PDF-1.4\n'), PDF()]), 'type_mismatch');
  });
  it('a.pdf with 8 junk bytes before a valid PDF -> 415 (D1: magic must be at offset 0)', async () => {
    await rej('a.pdf', Buffer.concat([S('JUNKJUNK'), PDF()]), ['type_mismatch', 'unsupported_type']);
  });
  it('real ZIP, .docx and .xlsx renamed .txt/.csv -> unsupported_type', async () => {
    const zip = H.zipStored([{ name: 'a.txt', data: S('hello') }]);
    const docx = H.zipStored([{ name: '[Content_Types].xml', data: S('<Types/>') }, { name: 'word/document.xml', data: S('<w:document/>') }]);
    const xlsx = H.zipStored([{ name: '[Content_Types].xml', data: S('<Types/>') }, { name: 'xl/workbook.xml', data: S('<workbook/>') }]);
    for (const n of ['a.txt', 'a.csv']) for (const b of [zip, docx, xlsx]) await rej(n, b, 'unsupported_type');
  });
  it('disallowed extensions with any content -> unsupported_type', async () => {
    for (const ext of ['zip', 'docx', 'xlsx', 'gz', '7z', 'rar', 'exe', 'dll', 'bin', 'html', 'svg', 'xml', 'js', 'php', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'heic']) await rej(`a.${ext}`, TXT, 'unsupported_type');
  });
  it('text file with executable / archive / image / OLE2 / PostScript signatures -> unsupported_type', async () => {
    const sigs: Buffer[] = [Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0]), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0]), S('GIF89a......'), S('RIFF....WEBPVP8 '), Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), S('%!PS-Adobe-3.0\n')];
    for (const b of sigs) await rej('a.txt', b, 'unsupported_type');
  });
  it('markup (html/svg/xml/php) at the start of .txt/.csv, also after blanks or BOM, any case -> markup_content', async () => {
    const starts = ['<!DOCTYPE html><html></html>', '<html><body>x</body></html>', '<script>alert(1)</script>', '<svg xmlns="http://www.w3.org/2000/svg"></svg>', '<?xml version="1.0"?><a/>', '<?php echo 1; ?>'];
    const prefixes: Buffer[] = [Buffer.alloc(0), S('  \r\n\t'), Buffer.from([0xef, 0xbb, 0xbf]), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), S(' \n')])];
    for (const st of starts) for (const pre of prefixes) for (const f of [(x: string) => x, (x: string) => x.toUpperCase()]) for (const n of ['a.txt', 'a.csv']) await rej(n, Buffer.concat([pre, S(f(st))]), 'markup_content');
  });
  it('names without a usable extension -> unsupported_type', async () => {
    for (const n of ['invoice', '.hidden', '...']) await rej(n, TXT, 'unsupported_type');
  });
  it('binary content: UTF-16LE with BOM, NUL, 0x01, 0x1B, 0x7F -> binary_content', async () => {
    await rej('a.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Load Number: X', 'utf16le')]), 'binary_content');
    for (const b of [0x00, 0x01, 0x1b]) await rej('a.txt', Buffer.concat([S('DOCUMENT: BILL OF LADING\nLoad Number: A'), Buffer.from([b]), S('B\n')]), 'binary_content');
    await rej('a.csv', Buffer.concat([S('a,b\n1,'), Buffer.from([0]), S('\n')]), 'binary_content');
  });
  it('DEL 0x7F in text -> binary_content (row of T-IMP-TYPE; N6 defines C0 only: see SPEC_QUESTION)', async () => {
    const b = await H.newBatch(analyst);
    const r = await H.upload(analyst, b, 'a.txt', Buffer.concat([S('DOCUMENT: BILL OF LADING' + String.fromCharCode(10) + 'Load Number: A'), Buffer.from([0x7f]), S('B' + String.fromCharCode(10))]));
    expectError(r, 415, 'unsupported_media_type');
    expect(r.body.error.details?.[0]?.code).toBe('binary_content');
  });
  it('0 bytes -> empty_file', async () => { await rej('a.txt', Buffer.alloc(0), 'empty_file'); });
});

describe('T-IMP-TYPE request Content-Type and filename query', () => {
  it('any media type other than application/octet-stream -> 415 unsupported_media_type and no outbound connection', async () => {
    const l = await H.startListener();
    try {
      const b = await H.newBatch(analyst);
      const json = Buffer.from(JSON.stringify({ url: `http://127.0.0.1:${l.port}/x` }));
      for (const [ct, body] of [['application/pdf', PDF()], ['text/plain', TXT], ['multipart/form-data; boundary=x', TXT], ['application/json', json]] as [string, Buffer][]) {
        const r = await H.upload(analyst, b, 'a.txt', body, { ct });
        expectError(r, 415, 'unsupported_media_type');
      }
      const none = await H.upload(analyst, b, 'a.txt', TXT, { ct: null });
      expect([400, 415]).toContain(none.status);
      await H.sleep(500);
      expect(l.hits()).toBe(0);
      expect((await analyst.get(`/imports/${b}`)).body.documentCount).toBe(0);
    } finally { await l.close(); }
  });
  it('bad filename query -> 400 validation_error', async () => {
    const b = await H.newBatch(analyst);
    const bads: [string, H.UpOpts][] = [
      ['missing', { rawQuery: '' }], ['empty', { rawQuery: 'filename=' }], ['256+ chars', { rawQuery: `filename=${'a'.repeat(260)}.txt` }],
      ['%00', { rawQuery: 'filename=a%00b.txt' }], ['raw control char', { rawQuery: 'filename=a%01b.txt' }],
      ['extra key url', { rawQuery: 'filename=a.txt&url=http%3A%2F%2F127.0.0.1%3A9%2Fx' }], ['extra key batch', { rawQuery: 'filename=a.txt&batch=1' }],
    ];
    for (const [label, o] of bads) expectError(await H.upload(analyst, b, null, TXT, o), 400, 'validation_error');
    const rawCtl = await analyst.client.app.inject({ method: 'POST', url: `/api/v1/imports/${b}/documents?filename=a${String.fromCharCode(1)}b.txt`, headers: { authorization: `Bearer ${analyst.token}`, 'content-type': 'application/octet-stream', 'x-csrf-token': await analyst.client.ensureCsrf(), cookie: analyst.client.cookieFor('/api/v1/') }, payload: TXT } as any).catch(() => null);
    if (rawCtl) expect([400, 404]).toContain(rawCtl.statusCode);
    expect((await analyst.get(`/imports/${b}`)).body.documentCount).toBe(0);
  });
});

describe('T-IMP-TYPE rejection side effects', () => {
  it('no document row, no object, and an import.document_rejected audit event (documentId null) per rejection', async () => {
    const b = await analyst.get(`/imports/${rejBatch}`);
    expect(b.status).toBe(200);
    expect(b.body.documentCount).toBe(0);
    expect(b.body.documents).toEqual([]);
    expect(await H.s3List(`t/${tenantId}/imports/${rejBatch}/`)).toEqual([]);
    const ev = (await H.auditSince(admin, seq0, 'import.document_rejected')).filter((e) => H.evDocId(e) === null);
    const got = ev.map((e) => H.evReason(e)).sort();
    expect(got.length, 'one audit event per pre-store rejection').toBeGreaterThanOrEqual(auditedReasons.length);
    const want = [...auditedReasons].sort();
    // every expected reason must be present with at least its multiplicity
    const count = (a: (string | null)[], k: string) => a.filter((x) => x === k).length;
    for (const k of new Set(want)) expect(count(got, k), `audit events with reason ${k}`).toBeGreaterThanOrEqual(count(want, k));
  });
});
