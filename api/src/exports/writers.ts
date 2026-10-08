/**
 * Streaming CSV and XLSX writers (A10.4-A10.5). Both consume an async iterable of row batches and yield
 * Uint8Array chunks (memory bounded by one batch). Text cells always go through the N9 normalization and
 * formula neutralization; numeric cells are pre-formatted numbers and are written as numbers.
 *
 * XLSX is a minimal OOXML package written with fflate (zero dependencies): exactly
 * [Content_Types].xml, _rels/.rels, xl/workbook.xml, xl/_rels/workbook.xml.rels, xl/styles.xml and
 * xl/worksheets/sheet1.xml. Cells are inline strings or numbers only: no formulas, hyperlinks,
 * drawings, external relationships, macros, defined names or document properties - formulas are
 * structurally impossible in the output.
 */
import { Zip, ZipDeflate } from 'fflate';

import { textCell } from './neutralize.js';

export type Cell = { t: 's'; v: string | null } | { t: 'n'; v: string | null; money?: boolean };

export interface Column {
  header: string;
  /** Approximate width in characters (XLSX). */
  width: number;
}

const NUMERIC = /^-?\d+(\.\d+)?$/u;
const enc = new TextEncoder();

function numeric(v: string | null): string | null {
  if (v === null) return null;
  if (!NUMERIC.test(v)) throw new RangeError('numeric cell is not a plain number');
  return v;
}

// ---------------------------------------------------------------------------------------------
// CSV: UTF-8 BOM, CRLF, comma, header first, text quoted with "" doubling, numbers unquoted.
// ---------------------------------------------------------------------------------------------

function csvText(v: string): string {
  return `"${v.replace(/"/gu, '""')}"`;
}

function csvCell(c: Cell): string {
  if (c.t === 's') return csvText(textCell(c.v));
  return numeric(c.v) ?? '';
}

export async function* csvStream(columns: readonly Column[], batches: AsyncIterable<Cell[][]>): AsyncGenerator<Uint8Array> {
  yield Uint8Array.from([0xef, 0xbb, 0xbf]);
  yield enc.encode(`${columns.map((c) => csvText(textCell(c.header))).join(',')}\r\n`);
  for await (const rows of batches) {
    if (rows.length === 0) continue;
    yield enc.encode(rows.map((r) => `${r.map(csvCell).join(',')}\r\n`).join(''));
  }
}

// ---------------------------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------------------------

export const XLSX_MAX_ROWS = 1_048_576;
export const XLSX_MAX_COLUMNS = 16_384;

/** XML 1.0 escaping; characters illegal in XML 1.0 (controls, lone surrogates, U+FFFE/FFFF) dropped. */
export function xmlEscape(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        out += s.slice(i, i + 2);
        i += 1;
      }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    if (c === 0xfffe || c === 0xffff) continue;
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) continue;
    const ch = s.charAt(i);
    out += ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : ch === "'" ? '&apos;' : ch;
  }
  return out;
}

function columnName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const STYLE_HEADER = 1;
const STYLE_MONEY = 2;

function staticParts(sheetName: string): [string, string][] {
  return [
    [
      '[Content_Types].xml',
      `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ],
    ['_rels/.rels', `${HEAD}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    [
      'xl/workbook.xml',
      `${HEAD}<workbook xmlns="${NS}" xmlns:r="${REL_NS}"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `${HEAD}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`,
    ],
    [
      'xl/styles.xml',
      `${HEAD}<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    ],
  ];
}

function xlsxCell(c: Cell, ref: string, header: boolean): string {
  if (c.t === 's') {
    const v = textCell(c.v);
    if (v === '' && !header) return '';
    return `<c r="${ref}" t="inlineStr"${header ? ` s="${STYLE_HEADER}"` : ''}><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
  }
  const n = numeric(c.v);
  if (n === null) return '';
  return `<c r="${ref}"${c.money ? ` s="${STYLE_MONEY}"` : ''}><v>${n}</v></c>`;
}

function xlsxRow(cells: Cell[], rowNumber: number, header = false): string {
  return `<row r="${rowNumber}">${cells.map((c, i) => xlsxCell(c, `${columnName(i)}${rowNumber}`, header)).join('')}</row>`;
}

export async function* xlsxStream(sheetName: string, columns: readonly Column[], batches: AsyncIterable<Cell[][]>): AsyncGenerator<Uint8Array> {
  if (columns.length > XLSX_MAX_COLUMNS) throw new RangeError('too many columns');
  const out: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) failure = err;
    else out.push(chunk);
  });
  const drain = function* () {
    if (failure) throw failure;
    while (out.length > 0) {
      const c = out.shift();
      if (c) yield c;
    }
  };

  for (const [name, content] of staticParts(sheetName)) {
    const f = new ZipDeflate(name, { level: 6 });
    zip.add(f);
    f.push(enc.encode(content), true);
    yield* drain();
  }
  const sheet = new ZipDeflate('xl/worksheets/sheet1.xml', { level: 6 });
  zip.add(sheet);
  const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join('');
  sheet.push(
    enc.encode(
      `${HEAD}<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${xlsxRow(
        columns.map((c) => ({ t: 's', v: c.header })),
        1,
        true,
      )}`,
    ),
  );
  yield* drain();
  let rowNumber = 1;
  for await (const rows of batches) {
    if (rows.length === 0) continue;
    if (rowNumber + rows.length > XLSX_MAX_ROWS) throw new RangeError('too many rows');
    sheet.push(enc.encode(rows.map((r) => xlsxRow(r, (rowNumber += 1))).join('')));
    yield* drain();
  }
  sheet.push(enc.encode('</sheetData></worksheet>'), true);
  zip.end();
  yield* drain();
}
