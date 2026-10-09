/**
 * Parity harness (A13): the TypeScript ingest + deterministic extraction against the Python reference
 * (tools/parity/extract_dump.py, sanitize_dump.py) on the fixtures, the inputs of the Python tests, a
 * generated corpus of valid variants and generated text-layer PDFs. The registered divergences
 * D1-D8 (N7) are the only allowed differences; the corpus avoids inputs where they apply, and the
 * comparisons skip exactly the registered cases (sanitized values D6, decode replacements D4).
 *
 * Runs in `npm run test:integration`. Needs Python with the repository's runtime deps; in CI a missing
 * interpreter FAILS the suite, locally it is skipped with a message.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { md, parseMoney, plain, pySplitlines } from '@fr/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assembleBundle } from '../../src/imports/bundle.js';
import { parseDateTime } from '../../src/imports/parse/datetime.js';
import { parseDocument } from '../../src/imports/parse/pipeline.js';
import type { DetectedType, ParseResult } from '../../src/imports/parse/types.js';
import { minimalPdf, multiPagePdf } from '../helpers/pdf-fixtures.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LIMITS = { pdfPages: 50, textChars: 2_000_000, imagePixels: 50_000_000 };

function findPython(): string | null {
  const candidates = [process.env['PYTHON'], 'python3', 'python'].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    const r = spawnSync(c, ['-c', 'import freight_recovery.extraction, pydantic; print("ok")'], {
      env: { ...process.env, PYTHONPATH: path.join(repoRoot, 'src') },
      encoding: 'utf8',
    });
    if (r.status === 0 && r.stdout.trim() === 'ok') return c;
  }
  return null;
}

const python = findPython();
const inCi = Boolean(process.env['CI']);

function runPython(script: string, args: string[], stdin?: string): unknown {
  if (!python) throw new Error('python unavailable');
  const r = spawnSync(python, [path.join(repoRoot, 'tools', 'parity', script), ...args], {
    env: { ...process.env, PYTHONPATH: path.join(repoRoot, 'src'), PYTHONIOENCODING: 'utf-8' },
    input: stdin,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`${script} failed: ${r.stderr}`);
  return JSON.parse(r.stdout) as unknown;
}

// ---------------------------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------------------------

interface Case {
  name: string;
  bytes: Uint8Array;
}

const enc = (s: string) => new TextEncoder().encode(s);

function corpus(): Case[] {
  const cases: Case[] = [];
  const add = (name: string, content: string | Uint8Array) => cases.push({ name, bytes: typeof content === 'string' ? enc(content) : content });
  let n = 0;
  const uniq = (base: string) => `${String((n += 1)).padStart(3, '0')}_${base}`;

  for (const dir of ['ld5001', 'ld5002']) {
    for (const f of readdirSync(path.join(repoRoot, 'tests', 'fixtures', dir))) add(`${dir}_${f}`, readFileSync(path.join(repoRoot, 'tests', 'fixtures', dir, f)));
  }

  // Inputs of tests/test_ingest_extract.py and tests/test_regressions_ingest_api.py (byte-identical).
  add(uniq('a.txt'), 'DOCUMENT: FREIGHT INVOICE\nLoad Number: L1\nCharge: Linehaul | 1.00');
  add(uniq('b.txt'), 'DOCUMENT: BILL OF LADING\nLoad Number: L2');
  add(uniq('x.txt'), 'Invoice Number: 1\nBOL: 55\nCharge: Linehaul | 1000\nTotal: 1000');
  add(uniq('x.txt'), 'Invoice Number: 1\nNotes: per rate confirmation LD1\nCharge: Linehaul | 1');
  add(uniq('scan.txt'), 'Carrier symbol: ABC');
  add(uniq('invoice.txt'), 'Carrier symbol: ABC');
  add(uniq('invoice_copy.txt'), 'Load Number: L1\nLinehaul Rate: 1000\nDetention Free Hours: 2');
  add(uniq('x.txt'), 'Invoice Number: 1\nLinehaul Rate: 5');
  add(uniq('x.txt'), 'Document: invoice and rate confirmation\nfoo: bar');
  add(uniq('x.txt'), 'Document: Bill of Lading\nInvoice Number: 3\nCharge: x | 1');
  add(uniq('invoice.csv'), 'description,amount\nLinehaul,1000\nDetention,300\n');
  add(uniq('invoice.csv'), 'Description,Notes,Amount\nLinehaul,x,1000\nOops\n');
  add(uniq('bol.csv'), 'Document,Bill of Lading\nLoad Number,L1\n');
  add(uniq('invoice.txt'), 'Document: Invoice\nCharge: Linehaul | NaN\nCharge: Fuel | 5');
  add(uniq('a.csv'), `a,b\n${'x'.repeat(200_000)},1\n`);
  add(uniq('kv.txt'), 'Load Number: L1\nCarrier = Acme\n  Total :  $5 \nno delimiter\n:bad');
  add(uniq('inv.txt'), 'Document: Freight Invoice\nInvoice Number: I1\nCarrier: Acme\n```\n<script>x</script>\nShipper: S\nCharge: [click](http://evil) | 5\nCharge: Linehaul | 2000\nTotal: 2005\n');
  add(uniq('rc.txt'), 'Document: Rate Confirmation\nLinehaul Rate: 1000\n');

  // Aliases and delimiters, per document type.
  const invAliases = ['Invoice Number', 'Invoice', 'Invoice No', 'Load Number', 'Load', 'Load No', 'PRO Number', 'Total Due', 'Amount Due', 'Total'];
  invAliases.forEach((k, i) => add(uniq('invoice.txt'), `Document: Invoice\n${k}${i % 2 ? ' = ' : ': '}V-${i}\nCharge: Lumper | 10\nLine: Fuel | 2.50\n`));
  ['Load Number', 'Load', 'Load No', 'Fuel Surcharge Rate', 'Fuel Surcharge', 'Linehaul Rate', 'Detention Free Hours', 'Detention Rate Per Hour', 'Detention Max Hours'].forEach((k) =>
    add(uniq('ratecon.txt'), `Document: Rate Confirmation\n${k}: 12.5\nAuthorized Accessorials: Detention, Lumper ,, TONU\n`),
  );
  ['Facility', 'Consignee', 'Location', 'Appointment', 'Appointment Time', 'Arrival', 'Check In', 'Check-In', 'Departure', 'Check Out', 'Departure Time'].forEach((k) =>
    add(uniq('bol.txt'), `Document: Bill of Lading\nLoad Number: L-7\n${k}: 2025-03-03 07:45\n`),
  );

  // Money formats and datetime formats.
  for (const m of ['$1,234.50', '(300.00)', '300 USD', 'USD 7.5', '-5', '0012.50', '1,2,3', '($5)', '1e3', 'NaN', '12abc', '123456789012345', '1234567890123456', '1.1234567']) {
    add(uniq('invoice.txt'), `Document: Invoice\nLoad Number: L1\nTotal: ${m}\nCharge: Item | ${m}\n`);
  }
  for (const d of ['2025-03-03 07:45', '2025-03-03T07:45', '2025-03-03t07:45', '2025-03-03 07:45:09', '2025-3-3 7:5', '03/04/2025 09:00', '3/4/2025 9:00', '2025-03- 3 07:45', '2025-03-03\t07:45', '02/29/2024 01:02', '02/29/2023 01:02', '2025-03-03 07:45:60', '2025-03-03 25:00', 'tomorrow']) {
    add(uniq('bol.txt'), `Document: Bill of Lading\nLoad Number: L1\nArrival Time: ${d}\n`);
  }

  // Whitespace, conflicts, header edge cases and key/line limits.
  add(uniq('inv.txt'), 'Document: Invoice\r\nLoad Number:\tL1 \r\nLoad Number: L1\r\nCarrier:\u{a0}Acme\u{3000}\r\n');
  add(uniq('inv.txt'), 'Document: Invoice\nLoad Number: L1\nLoad Number: L2\nTotal: 1\nTotal: 2\n');
  add(uniq('inv.txt'), '   document:   invoice\nLoad: L1\n');
  add(uniq('inv.txt'), `Document: Invoice\n${'K'.repeat(80)}: v\n${'K'.repeat(81)}: w\nLoad Number: ${'x'.repeat(150)}\n`);
  add(uniq('inv.txt'), `Document: Invoice\nLoad Number: L1\nCarrier: ${'y'.repeat(4000)}\n`);
  add(uniq('inv.txt'), 'Document: Invoice\nCharge: no bar\nCharge: | 5\nCharge: Two | Bars | 5\nCharge:  Spaced  |  7.25  \n');
  add(uniq('mixed.txt'), 'Load Number: L1\nInvoice Number: 9\nInvoice Date: 2025-01-01\nTotal: 5');
  add(uniq('note.txt'), 'nothing to see here\nat all');
  add(uniq('bol_scan.txt'), 'random words');
  add(uniq('empty.txt'), '\n\n');
  add(uniq('unicode.txt'), 'Document: Invoice\nLoad Number: L\u{1f600}1\nShipper: \u{c5}ngstr\u{f6}m AB\n');
  add(uniq('separators.txt'), 'Document: Invoice\u{85}Load Number: L1\u{2028}Carrier: C\u{1c}Total: 3\u{2029}');

  // CSV layouts.
  add(uniq('invoice.csv'), 'Invoice Number,Load Number,Carrier,Total\r\nI-1,L-1,"Acme, Inc.",10.00\r\nLinehaul,7.00\r\n"Fuel ""FSC""",3.00\r\n');
  add(uniq('invoice.csv'), 'Item,Qty,Line Total\nLinehaul,1,100\nDetention,2,50\n,,\n');
  add(uniq('invoice.csv'), 'Charge Type,Cost\nLumper,"1,250.00"\n');
  add(uniq('bol.csv'), 'Document,Bill of Lading\nLoad Number,L9\n\n\nArrival,2025-03-03 07:45\n');
  add(uniq('ratecon.csv'), '"Document","Rate Confirmation"\n"Load Number","L5"\n"Authorized Accessorials","Detention, Lumper"\n');
  add(uniq('x.csv'), 'a,b,c\n1,2\n');
  add(uniq('x.csv'), 'Key,Value\n"multi\nline",v\n');
  add(uniq('x.csv'), 'a,"open\nstill');
  add(uniq('x.csv'), '"ab"c,d\nLoad Number,L1\n');
  add(uniq('x.csv'), 'a\rb\n');
  add(uniq('x.csv'), '');
  add(uniq('x.csv'), ' , \n,\n');

  // Text-layer PDFs (D2: simple single-column Helvetica only).
  add(uniq('scan.pdf'), minimalPdf(['DOCUMENT: FREIGHT INVOICE', 'Invoice Number: INV-9', 'Load Number: L9']));
  add(uniq('scan.pdf'), minimalPdf(['DOCUMENT: RATE CONFIRMATION', 'Load Number: L1', 'Linehaul Rate: 1400.00', 'Authorized Accessorials: Detention']));
  add(uniq('bol.pdf'), minimalPdf(['Load Number: L3', 'Arrival Time: 2025-03-03 07:45', 'Departure Time: 2025-03-03 11:30']));
  add(uniq('inv.pdf'), minimalPdf(['Document: Invoice', 'Charge: Linehaul | 1500.00', 'Charge: Fuel Surcharge | 168.00', 'Total: $1,668.00']));
  add(uniq('two.pdf'), multiPagePdf([['DOCUMENT: BILL OF LADING', 'Load Number: L2'], ['Facility: DC 9', 'Arrival Time: 2025-03-04 09:00']]));
  return cases;
}

const DOC_TYPE: Record<string, string> = { invoice: 'INVOICE', rate_confirmation: 'RATE_CONFIRMATION', bol: 'BILL_OF_LADING', unknown: 'OTHER' };

function detected(name: string): DetectedType {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return ext === '.pdf' ? 'PDF' : ext === '.csv' ? 'CSV' : 'TXT';
}

function pyWarningCode(w: string): string {
  if (w.includes('too few columns')) return 'CSV_ROW_TOO_SHORT';
  if (w.includes('data row has')) return 'CSV_ROW_LENGTH_MISMATCH';
  if (w.includes('amount could not be read')) return 'CHARGE_AMOUNT_UNREADABLE';
  return `UNMAPPED:${w}`;
}

interface PyEntry {
  file: string;
  error?: string;
  ingest?: { doc_type: string; sha256: string; warnings: string[]; text: string };
  extracted?: { kind: string; data: Record<string, unknown> } | null;
  bundle_warnings?: string[];
}

describe.skipIf(!python && !inCi)('parity: TypeScript ingest/extraction vs Python reference', () => {
  let dir = '';
  let cases: Case[] = [];
  let py: PyEntry[] = [];
  const ts = new Map<string, ParseResult>();

  beforeAll(async () => {
    if (!python) throw new Error('Python with freight_recovery deps is required for the parity suite in CI');
    dir = mkdtempSync(path.join(tmpdir(), 'fr-parity-'));
    cases = corpus();
    const paths: string[] = [];
    for (const c of cases) {
      const sub = path.join(dir, String(paths.length));
      mkdirSync(sub);
      const p = path.join(sub, c.name);
      writeFileSync(p, c.bytes);
      paths.push(p);
    }
    py = runPython('extract_dump.py', paths) as PyEntry[];
    for (const c of cases) {
      ts.set(c.name, await parseDocument({ bytes: c.bytes, filename: c.name, detectedType: detected(c.name), limits: LIMITS, threshold: 0.9 }));
    }
  }, 120_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('covers a meaningful corpus', () => {
    expect(cases.length).toBeGreaterThan(90);
    expect(py).toHaveLength(cases.length);
  });

  it('agrees on rejection, type, sha256, normalized text, warnings and extracted values', () => {
    const diffs: string[] = [];
    cases.forEach((c, i) => {
      const p = py[i];
      const t = ts.get(c.name);
      if (!p || !t) {
        diffs.push(`${c.name}: missing result`);
        return;
      }
      if (p.error) {
        if (t.ok) diffs.push(`${c.name}: Python raised ${p.error}, TS accepted`);
        return;
      }
      if (!t.ok) {
        diffs.push(`${c.name}: TS rejected (${t.reason}), Python accepted`);
        return;
      }
      const ing = p.ingest;
      if (!ing) return;
      if (DOC_TYPE[ing.doc_type] !== t.docType) diffs.push(`${c.name}: type ${ing.doc_type} vs ${t.docType}`);
      if (createHash('sha256').update(c.bytes).digest('hex') !== ing.sha256) diffs.push(`${c.name}: sha256`);
      if (detected(c.name) === 'PDF') {
        if (JSON.stringify(pySplitlines(ing.text)) !== JSON.stringify(pySplitlines(t.text))) diffs.push(`${c.name}: pdf lines ${JSON.stringify(ing.text)} vs ${JSON.stringify(t.text)}`);
      } else if (ing.text !== t.text) {
        diffs.push(`${c.name}: text differs`);
      }
      const pyWarn = [...ing.warnings.map(pyWarningCode), ...(p.extracted?.data['extraction_warnings'] as string[] | undefined ?? []).map(pyWarningCode)].sort();
      const tsWarn = t.warnings.filter((w) => w !== 'DECODE_REPLACEMENTS').sort();
      if (JSON.stringify(pyWarn) !== JSON.stringify(tsWarn)) diffs.push(`${c.name}: warnings ${JSON.stringify(pyWarn)} vs ${JSON.stringify(tsWarn)}`);

      // Extraction: Python model vs the TS bundle built from the extracted values. Fields the TS side
      // sanitized (D6) are excluded on both sides.
      const sanitized = new Set(t.fields.filter((f) => f.reviewReasons.includes('SANITIZED_VALUE')).map((f) => `${f.key}#${f.groupIndex ?? ''}`));
      const bundle = assembleBundle([
        { displayName: c.name, docType: t.docType, warnings: t.warnings, fields: t.fields.map((f) => ({ key: f.key, groupIndex: f.groupIndex, effectiveValue: f.value })) },
      ]);
      const tsModel = t.docType === 'INVOICE' ? bundle.invoice : t.docType === 'RATE_CONFIRMATION' ? bundle.rate_confirmation : t.docType === 'BILL_OF_LADING' ? bundle.bol : null;
      if (!p.extracted) {
        if (tsModel) diffs.push(`${c.name}: Python extracted nothing`);
        return;
      }
      const prefix = t.docType === 'INVOICE' ? 'invoice' : t.docType === 'RATE_CONFIRMATION' ? 'rate_confirmation' : 'bol';
      const keep = (k: string) => k !== 'extraction_warnings' && !sanitized.has(`${prefix}.${k}#`) && !(k === 'lines' && sanitized.size > 0);
      const pick = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => keep(k)));
      const pyData = pick(p.extracted.data);
      const tsData = pick(tsModel as unknown as Record<string, unknown>);
      if (JSON.stringify(pyData) !== JSON.stringify(tsData)) diffs.push(`${c.name}: extraction ${JSON.stringify(pyData)} vs ${JSON.stringify(tsData)}`);
    });
    expect(diffs).toEqual([]);
  });

  it('plain/md, parse_money and parse_dt primitives agree', () => {
    const strings = ['a\u0000b\u{2028}c', 'x  \u001f\u001f y', '<b>bold</b> `code`', '  ', 'a'.repeat(205), '\u{202e}hi\u{2066}', 'tab\there', 'line\r\nnext', '*_[x](y)#&~|\\', `${'\u{1f600}'.repeat(199)}xyz`, '\u{a0}lead and trail\u{3000}'];
    const money = ['$1,234.50', '(300.00)', '300 USD', '-0.00', '(0.00)', '(-5)', 'USD300USD', '1,2,3', ' \u{a0} $ 1,000 ', '12abc', '1e3', '.5', '5.', 'usd', '($-0)'];
    const dts = ['2025-03-03 07:45', '2025-3-3 7:5', '03/04/2025 09:00', '2025-03-03t07:45', '2025-03- 3 07:45', '2025-03-03 07:45:60', '02/29/2023 01:02', '2025-03-03  07:45'];
    const out = runPython('sanitize_dump.py', [], JSON.stringify({ plain: strings, md: strings, money, dt: dts })) as {
      plain: string[];
      md: string[];
      money: (string | null)[];
      dt: (string | null)[];
    };
    expect(strings.map((s) => plain(s))).toEqual(out.plain);
    expect(strings.map((s) => md(s))).toEqual(out.md);
    expect(money.map((m) => parseMoney(m))).toEqual(out.money);
    expect(dts.map((d) => parseDateTime(d)?.value ?? null)).toEqual(out.dt);
  });
});

describe.runIf(!python && !inCi)('parity (skipped locally)', () => {
  it('needs Python: set PYTHON to an interpreter with the repo runtime deps (requirements.txt)', () => {
    expect(python).toBeNull();
  });
});
