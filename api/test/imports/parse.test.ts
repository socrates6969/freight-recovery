/**
 * Unit tests of the pure parsing core (A5). Python behaviour referenced here was checked with the
 * reference implementation (CPython 3.12/3.14); the parity harness (test/parity) compares exhaustively.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { assembleBundle, pointerToLocator, pyRepr } from '../../src/imports/bundle.js';
import { classify, presentKeys } from '../../src/imports/parse/classify.js';
import { fieldConfidence, fieldReview } from '../../src/imports/parse/confidence.js';
import { CsvError, csvToText, readCsv } from '../../src/imports/parse/csv.js';
import { parseDateTime } from '../../src/imports/parse/datetime.js';
import { convertValue, pairs } from '../../src/imports/parse/deterministic.js';
import { validateJpeg, validatePng } from '../../src/imports/parse/image.js';
import { layoutLines } from '../../src/imports/parse/pdf.js';
import { parseDocument, type ParseInput } from '../../src/imports/parse/pipeline.js';
import { LLMExtractionProvider, getProvider } from '../../src/imports/parse/provider.js';
import { decodeUtf8, normKey } from '../../src/imports/parse/text.js';
import { ParseRejection, type ParseSuccess } from '../../src/imports/parse/types.js';
import { minimalPdf, multiPagePdf } from '../helpers/pdf-fixtures.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LIMITS = { pdfPages: 50, textChars: 2_000_000, imagePixels: 50_000_000 };
const enc = (s: string) => new TextEncoder().encode(s);

async function parse(text: string | Uint8Array, filename: string, detectedType: ParseInput['detectedType'], extra: Partial<ParseInput> = {}) {
  return parseDocument({ bytes: typeof text === 'string' ? enc(text) : text, filename, detectedType, limits: LIMITS, threshold: 0.9, ...extra });
}

async function ok(text: string | Uint8Array, filename: string, detectedType: ParseInput['detectedType'], extra: Partial<ParseInput> = {}): Promise<ParseSuccess> {
  const r = await parse(text, filename, detectedType, extra);
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r;
}

describe('text primitives', () => {
  it('decodes UTF-8 like utf-8-sig/errors=replace and reports real replacements only', () => {
    expect(decodeUtf8(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]))).toEqual({ text: 'a', replacements: false });
    expect(decodeUtf8(Uint8Array.from([0x61, 0xff, 0x62]))).toEqual({ text: 'a\u{fffd}b', replacements: true });
    expect(decodeUtf8(enc('x\u{fffd}y'))).toEqual({ text: 'x\u{fffd}y', replacements: false });
  });

  it('normalizes keys like Python _norm_key', () => {
    expect(normKey('  Invoice Number ')).toBe('invoice_number');
    expect(normKey('Rate/Con #')).toBe('rate_con');
    expect(normKey('__A--b__')).toBe('a_b');
  });
});

describe('classify (loader.classify parity)', () => {
  it.each([
    ['DOCUMENT: RATE CONFIRMATION\nx: y', '', 'RATE_CONFIRMATION', 'HEADER'],
    ['DOCUMENT: BILL OF LADING', '', 'BILL_OF_LADING', 'HEADER'],
    ['DOCUMENT: FREIGHT INVOICE', '', 'INVOICE', 'HEADER'],
    ['nothing useful', 'invoice.csv', 'INVOICE', 'FILENAME'],
    ['nothing useful', 'mystery.bin', 'OTHER', 'NONE'],
    ['Invoice Number: 1\nBOL: 55\nCharge: Linehaul | 1000\nTotal: 1000', 'x.txt', 'INVOICE', 'KEYS'],
    ['Invoice Number: 1\nNotes: per rate confirmation LD1\nCharge: Linehaul | 1', 'x.txt', 'INVOICE', 'KEYS'],
    ['Carrier symbol: ABC', 'scan.txt', 'OTHER', 'NONE'],
    ['Carrier symbol: ABC', 'invoice.txt', 'INVOICE', 'FILENAME'],
    ['Load Number: L1\nLinehaul Rate: 1000\nDetention Free Hours: 2', 'invoice_copy.txt', 'RATE_CONFIRMATION', 'KEYS'],
    ['Invoice Number: 1\nLinehaul Rate: 5', 'x.txt', 'OTHER', 'NONE'],
    ['Document: invoice and rate confirmation\nfoo: bar', 'x.txt', 'OTHER', 'NONE'],
    ['Document: Bill of Lading\nInvoice Number: 3\nCharge: x | 1', '', 'BILL_OF_LADING', 'HEADER'],
    ['rate_confirmation body', 'rate_confirmation.txt', 'RATE_CONFIRMATION', 'FILENAME'],
  ])('%j / %j -> %s (%s)', (text, filename, docType, basis) => {
    expect(classify(text, filename)).toEqual({ docType, basis });
  });

  it('ties of key scores are UNKNOWN even when the file name would decide', () => {
    expect(classify('Invoice Number: 1\nLinehaul Rate: 5', 'invoice.txt')).toEqual({ docType: 'OTHER', basis: 'NONE' });
  });

  it('only scans the first 400 code points for the header and skips over-long keys', () => {
    expect(classify(`${'x'.repeat(401)}\nDocument: Invoice`).basis).not.toBe('HEADER');
    expect(presentKeys(`${'k'.repeat(81)}: v\n${'k'.repeat(80)}: v`)).toEqual(new Set(['k'.repeat(80)]));
  });
});

describe('CSV (CPython csv.reader strict=False parity)', () => {
  it('handles quotes, doubled quotes, embedded newlines and CRLF', () => {
    expect(readCsv('a,"b,c","d""e"\r\n"multi\nline",x\n')).toEqual([
      ['a', 'b,c', 'd"e'],
      ['multi\nline', 'x'],
    ]);
  });

  it('yields an empty record for a blank line and keeps a trailing unterminated quoted field', () => {
    expect(readCsv('a\n\nb')).toEqual([['a'], [], ['b']]);
    expect(readCsv('a,"open\nstill')).toEqual([['a', 'open\nstill']]);
  });

  it('non-strict: a character after a closing quote continues the field', () => {
    expect(readCsv('"ab"c,d\n')).toEqual([['abc', 'd']]);
  });

  it('a bare CR followed by more text is an error; a field over 131072 code points is an error', () => {
    expect(() => readCsv('a\rb\n')).toThrow(CsvError);
    expect(() => readCsv(`a,b\n${'x'.repeat(200_000)},1\n`)).toThrow(CsvError);
    expect(() => readCsv(`${'x'.repeat(131_072)}\n`)).not.toThrow();
  });

  it('flattens the three layouts with warnings and source records', () => {
    const items = csvToText('description,amount\nLinehaul,1000\nDetention,300\n');
    expect(items.text).toBe('Charge: Linehaul | 1000\nCharge: Detention | 300');
    expect(items.entries.map((e) => e.row)).toEqual([2, 3]);
    const short = csvToText('Description,Notes,Amount\nLinehaul,x,1000\nOops\n');
    expect(short.warnings).toEqual(['CSV_ROW_TOO_SHORT']);
    const kv = csvToText('Document,Bill of Lading\nLoad Number,L1\n');
    expect(kv.text).toBe('Document: Bill of Lading\nLoad Number: L1');
    const hdr = csvToText('Invoice Number,Load Number,Total\nI1,L1\nLinehaul,5\n');
    expect(hdr.warnings).toEqual(['CSV_ROW_LENGTH_MISMATCH']);
    expect(hdr.text).toBe('Invoice Number: I1\nLoad Number: L1\nCharge: Linehaul | 5');
  });
});

describe('parse_dt (strptime parity)', () => {
  it.each([
    ['2025-03-03 07:45', '2025-03-03T07:45:00', false],
    ['2025-03-03T07:45', '2025-03-03T07:45:00', false],
    ['2025-03-03t07:45', '2025-03-03T07:45:00', false],
    ['2025-03-03 07:45:05', '2025-03-03T07:45:05', false],
    ['2025-03-03 07:45:5', '2025-03-03T07:45:05', false],
    ['03/04/2025 09:00', '2025-03-04T09:00:00', true],
    ['2025-3-3 7:5', '2025-03-03T07:05:00', false],
    ['2025-03- 3 07:45', '2025-03-03T07:45:00', false],
    ['2025-03-03  07:45', '2025-03-03T07:45:00', false],
    ['2025-03-03\u{a0}07:45', '2025-03-03T07:45:00', false],
    ['02/29/2024 01:02', '2024-02-29T01:02:00', true],
  ])('%j -> %j', (input, expected, us) => {
    expect(parseDateTime(input)).toEqual({ value: expected, usFormat: us });
  });

  it.each(['02/29/2023 01:02', '2025-03-03 07:45:60', '0000-01-01 00:00', '2025-02-30 00:00', '2025-03-03 24:00', '2025-03-03', '\u{663}025-03-03 07:45', '2025-03-03 07:45 x'])(
    'rejects %j',
    (input) => {
      expect(parseDateTime(input)).toBeNull();
    },
  );
});

describe('_pairs parity and value conversion', () => {
  it('reads key/value lines like Python _pairs', () => {
    expect(pairs('Load Number: L1\nCarrier = Acme\n  Total :  $5 \nno delimiter\n:bad').map((p) => [p.key, p.val])).toEqual([
      ['load_number', 'L1'],
      ['carrier', 'Acme'],
      ['total', '$5'],
    ]);
  });

  it('records the value position inside the line', () => {
    const [p] = pairs('  Total :  $5 ');
    expect(p?.valStart).toBe(11);
  });

  it('converts kinds with the shared validators', () => {
    expect(convertValue('DECIMAL', '$2,118.00')).toEqual({ value: '2118.00', sanitized: false, usDateTime: false });
    expect(convertValue('DECIMAL', 'NaN').value).toBeNull();
    expect(convertValue('STRING_LIST', 'Detention, , Lumper ,').value).toBe('["Detention","Lumper"]');
    expect(convertValue('STRING', 'Ac\u{202e}me')).toEqual({ value: 'Acme', sanitized: true, usDateTime: false });
    expect(convertValue('STRING', '\u{202e}').value).toBeNull();
  });
});

describe('confidence (N7)', () => {
  it('applies the base and every cap', () => {
    const base = { isPdf: false, basis: 'HEADER' as const, usDateTime: false, conflicting: false, decodeReplacements: false, sanitized: false, unparseable: false };
    expect(fieldConfidence(base)).toBe(0.95);
    expect(fieldConfidence({ ...base, isPdf: true })).toBe(0.85);
    expect(fieldConfidence({ ...base, basis: 'KEYS' })).toBe(0.85);
    expect(fieldConfidence({ ...base, basis: 'FILENAME' })).toBe(0.7);
    expect(fieldConfidence({ ...base, usDateTime: true })).toBe(0.8);
    expect(fieldConfidence({ ...base, conflicting: true })).toBe(0.5);
    expect(fieldConfidence({ ...base, decodeReplacements: true })).toBe(0.6);
    expect(fieldConfidence({ ...base, sanitized: true })).toBe(0.8);
    expect(fieldConfidence({ ...base, unparseable: true })).toBe(0);
  });

  it('flags below the threshold and always for unparseable/conflicting values', () => {
    expect(fieldReview(0.95, 0.9, { unparseable: false, conflicting: false, sanitized: false })).toEqual({ needsReview: false, reasons: [] });
    expect(fieldReview(0.85, 0.9, { unparseable: false, conflicting: false, sanitized: false })).toEqual({ needsReview: true, reasons: ['LOW_CONFIDENCE'] });
    expect(fieldReview(0.9, 0.9, { unparseable: false, conflicting: false, sanitized: false }).needsReview).toBe(false);
    expect(fieldReview(0.5, 0.5, { unparseable: false, conflicting: true, sanitized: false })).toEqual({ needsReview: true, reasons: ['CONFLICTING_VALUES'] });
  });
});

describe('extraction through the pipeline', () => {
  it('extracts the ld5001 invoice with pointers, ACCEPTED (explicit header, txt)', async () => {
    const bytes = readFileSync(path.join(repoRoot, 'tests/fixtures/ld5001/invoice.txt'));
    const r = await ok(bytes, 'invoice.txt', 'TXT');
    expect(r.status).toBe('ACCEPTED');
    expect(r.docType).toBe('INVOICE');
    const byKey = (k: string, g: number | null = null) => r.fields.find((f) => f.key === k && f.groupIndex === g);
    expect(byKey('invoice.total')?.value).toBe('2118.00');
    expect(byKey('invoice.charge.description', 1)?.value).toBe('Fuel Surcharge');
    expect(byKey('invoice.charge.amount', 1)?.value).toBe('168.00');
    expect(byKey('invoice.invoice_number')?.source).toMatchObject({ line: 2, start: 16, end: 24, page: null, row: null });
    // Fields are ordered by N7 key order, then group index.
    expect(r.fields.map((f) => f.key).slice(0, 6)).toEqual([
      'invoice.invoice_number',
      'invoice.load_number',
      'invoice.carrier',
      'invoice.shipper',
      'invoice.invoice_date',
      'invoice.total',
    ]);
    expect(r.fields.filter((f) => f.key === 'invoice.charge.description').map((f) => f.groupIndex)).toEqual([0, 1, 2, 3]);
    expect(r.loadNumber).toBe('LD-5001');
  });

  it('last occurrence wins with CONFLICTING_VALUES; unreadable charges are reported', async () => {
    const r = await ok('Document: Invoice\nLoad Number: L1\nCharge: Linehaul | NaN\nCharge: Fuel | 5\nLoad Number: L2\n', 'a.txt', 'TXT');
    const load = r.fields.find((f) => f.key === 'invoice.load_number');
    expect(load).toMatchObject({ value: 'L2', confidence: 0.5, needsReview: true, reviewReasons: ['LOW_CONFIDENCE', 'CONFLICTING_VALUES'] });
    expect(load?.source.line).toBe(5);
    expect(r.warnings).toEqual(['CHARGE_AMOUNT_UNREADABLE']);
    expect(r.reviewReasons).toEqual(['IGNORED_CONTENT', 'FLAGGED_FIELDS']);
    expect(r.fields.filter((f) => f.key === 'invoice.charge.description').map((f) => f.value)).toEqual(['Fuel']);
  });

  it('unparseable values become null fields with confidence 0', async () => {
    const r = await ok('Document: Invoice\nLoad Number: L1\nTotal: twelve\n', 'a.txt', 'TXT');
    expect(r.fields.find((f) => f.key === 'invoice.total')).toMatchObject({ value: null, rawValue: 'twelve', confidence: 0, reviewReasons: ['LOW_CONFIDENCE', 'UNPARSEABLE_VALUE'] });
  });

  it('flags every PDF field (0.85 < 0.90) and records pages', async () => {
    const r = await ok(multiPagePdf([['DOCUMENT: BILL OF LADING', 'Load Number: L1'], ['Arrival Time: 2025-03-03 07:45']]), 'x.pdf', 'PDF');
    expect(r.pageCount).toBe(2);
    expect(r.fields.map((f) => [f.key, f.confidence, f.source.page, f.source.line])).toEqual([
      ['bol.load_number', 0.85, 1, 2],
      ['bol.arrival_time', 0.85, 2, 3],
    ]);
    expect(r.status).toBe('NEEDS_REVIEW');
  });

  it('CSV pointers refer to the flattened text and the source record', async () => {
    const r = await ok('Document,Bill of Lading\nLoad Number,LD-5002\n\nFacility,DC 4\n', 'bol.csv', 'CSV');
    expect(r.fields.find((f) => f.key === 'bol.facility')?.source).toMatchObject({ line: 3, row: 3 });
  });

  it('document reasons: unknown type, no fields, missing load number, decode replacements', async () => {
    expect((await ok('hello there', 'note.txt', 'TXT')).reviewReasons).toEqual(['UNKNOWN_DOC_TYPE']);
    expect((await ok('Document: Invoice\n', 'a.txt', 'TXT')).reviewReasons).toEqual(['NO_FIELDS', 'MISSING_LOAD_NUMBER']);
    const bad = await ok(Uint8Array.from([...enc('Document: Invoice\nLoad Number: L'), 0xff, ...enc('1\n')]), 'a.txt', 'TXT');
    expect(bad.warnings).toEqual(['DECODE_REPLACEMENTS']);
    expect(bad.reviewReasons).toEqual(['DECODE_REPLACEMENTS', 'FLAGGED_FIELDS']);
    expect(bad.fields[0]?.confidence).toBe(0.6);
  });

  it('rejects malformed CSV, too much text, too many lines and too many PDF pages', async () => {
    expect(await parse('a\rb\n', 'a.csv', 'CSV')).toEqual({ ok: false, reason: 'malformed_csv' });
    expect(await parse('x'.repeat(101), 'a.txt', 'TXT', { limits: { ...LIMITS, textChars: 100 } })).toEqual({ ok: false, reason: 'text_too_large' });
    expect(await parse('\n'.repeat(200_001), 'a.txt', 'TXT')).toEqual({ ok: false, reason: 'text_too_large' });
    expect(await parse(multiPagePdf([['a'], ['b'], ['c']]), 'a.pdf', 'PDF', { limits: { ...LIMITS, pdfPages: 2 } })).toEqual({ ok: false, reason: 'too_many_pages' });
    expect(await parse(enc('%PDF-1.4 garbage'), 'a.pdf', 'PDF')).toEqual({ ok: false, reason: 'malformed_pdf' });
  });

  it('is deterministic', async () => {
    const bytes = readFileSync(path.join(repoRoot, 'tests/fixtures/ld5002/ratecon.csv'));
    expect(JSON.stringify(await ok(bytes, 'ratecon.csv', 'CSV'))).toBe(JSON.stringify(await ok(bytes, 'ratecon.csv', 'CSV')));
    expect((await ok(minimalPdf(['Invoice Number: 9']), 'scan.pdf', 'PDF')).text).toBe('Invoice Number: 9');
  });
});

describe('provider registry', () => {
  it('resolves deterministic/stub and keeps the LLM placeholder unreachable', () => {
    expect(getProvider().name).toBe('deterministic');
    expect(getProvider('stub').name).toBe('deterministic');
    expect(() => getProvider('llm')).toThrow();
    expect(() => new LLMExtractionProvider().extract()).toThrow(/NotImplemented/u);
  });
});

describe('PDF layout', () => {
  it('groups items by baseline and joins with spaces only across real gaps', () => {
    const item = (str: string, x: number, y: number, w: number) => ({ str, transform: [12, 0, 0, 12, x, y], width: w, height: 12 });
    expect(layoutLines([item('B', 50, 700, 10), item('Total:', 50, 720, 30), item('$5', 90, 721, 10), item('A', 60, 700, 5)])).toEqual(['Total: $5', 'BA']);
    expect(layoutLines([item('ab', 10, 10, 10), item('cd', 21, 10, 10), item('  ', 40, 10, 5)])).toEqual(['abcd']);
    // Fix round 2 (F-04): control characters from glyph mapping are stripped; a control-only item vanishes.
    expect(layoutLines([item('a\u{0}b\u{1b}', 10, 10, 10), item('\u{0}\u{3}', 30, 10, 5), item('c\u{9f}', 21, 10, 10)])).toEqual(['abc']);
  });
});

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(enc(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function png(width: number, height: number, extra: Uint8Array = new Uint8Array()): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', Uint8Array.from([1, 2, 3])), pngChunk('IEND', new Uint8Array()), extra];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function jpeg(width: number, height: number, trailing: number[] = []): Uint8Array {
  const sof = [0xff, 0xc0, 0x00, 0x11, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, 0x00, 0x0c, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0];
  return Uint8Array.from([0xff, 0xd8, ...sof, ...sos, 0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xd9, ...trailing]);
}

describe('images (structure only)', () => {
  it('accepts valid PNG/JPEG and flags them for manual entry', async () => {
    expect(validatePng(png(2, 3), 100)).toEqual({ width: 2, height: 3 });
    expect(validateJpeg(jpeg(4, 5), 100)).toEqual({ width: 4, height: 5 });
    const r = await ok(png(2, 3), 'scan.png', 'PNG');
    expect(r).toMatchObject({ docType: 'OTHER', docTypeBasis: 'NONE', status: 'NEEDS_REVIEW', reviewReasons: ['IMAGE_NO_TEXT_LAYER'], fields: [], pageCount: null });
  });

  it('rejects trailing data, bad CRCs, oversize and malformed structures', () => {
    const reason = (f: () => unknown) => {
      try {
        f();
        return 'ok';
      } catch (e) {
        return e instanceof ParseRejection ? e.reason : 'other';
      }
    };
    // Fix round 1 (D3): up to 16 zero padding bytes after IEND are tolerated (as for JPEG).
    expect(validatePng(png(2, 3, Uint8Array.from([0])), 100)).toEqual({ width: 2, height: 3 });
    expect(validatePng(png(2, 3, new Uint8Array(16)), 100)).toEqual({ width: 2, height: 3 });
    expect(reason(() => validatePng(png(2, 3, new Uint8Array(17)), 100))).toBe('trailing_data');
    expect(reason(() => validatePng(png(2, 3, Uint8Array.from([0, 1])), 100))).toBe('trailing_data');
    const bad = png(2, 3);
    bad[20] = (bad[20] ?? 0) ^ 1;
    expect(reason(() => validatePng(bad, 100))).toBe('malformed_image');
    expect(reason(() => validatePng(png(20001, 1), 1e9))).toBe('image_too_large');
    expect(reason(() => validatePng(png(100, 100), 9999))).toBe('image_too_large');
    expect(reason(() => validatePng(png(0, 1), 100))).toBe('malformed_image');
    expect(reason(() => validateJpeg(jpeg(4, 5, [0, 0]), 100))).toBe('ok');
    expect(reason(() => validateJpeg(jpeg(4, 5, [1]), 100))).toBe('trailing_data');
    expect(reason(() => validateJpeg(jpeg(4, 5, new Array<number>(17).fill(0)), 100))).toBe('trailing_data');
    expect(reason(() => validateJpeg(jpeg(4, 0), 100))).toBe('malformed_image');
    expect(reason(() => validateJpeg(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), 100))).toBe('malformed_image');
  });
});

describe('bundle assembly and locators (Part F)', () => {
  it('builds the ExtractedBundle from effective values; first document of a type wins', () => {
    const b = assembleBundle([
      {
        displayName: 'inv.txt',
        docType: 'INVOICE',
        warnings: ['CHARGE_AMOUNT_UNREADABLE'],
        fields: [
          { key: 'invoice.load_number', groupIndex: null, effectiveValue: 'L1' },
          { key: 'invoice.total', groupIndex: null, effectiveValue: '5' },
          { key: 'invoice.charge.description', groupIndex: 0, effectiveValue: 'Fuel' },
          { key: 'invoice.charge.amount', groupIndex: 0, effectiveValue: '5' },
          { key: 'invoice.charge.description', groupIndex: 1, effectiveValue: 'Rejected' },
          { key: 'invoice.charge.amount', groupIndex: 1, effectiveValue: null },
        ],
      },
      { displayName: 'inv2.txt', docType: 'INVOICE', warnings: [], fields: [] },
      { displayName: 'rc.txt', docType: 'RATE_CONFIRMATION', warnings: [], fields: [{ key: 'rate_confirmation.load_number', groupIndex: null, effectiveValue: 'L2' }, { key: 'rate_confirmation.authorized_accessorials', groupIndex: null, effectiveValue: '["Detention"]' }] },
      { displayName: 'x.png', docType: 'OTHER', warnings: [], fields: [] },
    ]);
    expect(b.invoice).toMatchObject({ load_number: 'L1', total: '5', lines: [{ description: 'Fuel', amount: '5' }] });
    expect(b.rate_confirmation?.authorized_accessorials).toEqual(['Detention']);
    expect(b.warnings).toEqual([
      'inv.txt: A charge line was ignored because its amount could not be read.',
      'inv2.txt: duplicate invoice; ignored',
      'x.png: unrecognised document type; skipped',
      "Load numbers disagree across documents: ['L1', 'L2']",
    ]);
  });

  it('formats locators like the seed (file:L5, PDF file:p2:L5) and Python repr', () => {
    expect(pointerToLocator('rate_confirmation.txt', { page: null, line: 5 })).toBe('rate_confirmation.txt:L5');
    expect(pointerToLocator('scan.pdf', { page: 2, line: 14 })).toBe('scan.pdf:p2:L14');
    expect(pyRepr("it's")).toBe('"it\'s"');
    expect(pyRepr('a\\b')).toBe("'a\\\\b'");
  });
});
