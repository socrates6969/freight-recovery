/** Unit tests: export cell normalization, formula neutralization, CSV/XLSX writers and keyset cursors. */
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { cleanText, formatCents, neutralizeFormula, textCell } from '../../src/exports/neutralize.js';
import { exportFilename } from '../../src/exports/routes.js';
import { keysetAfter } from '../../src/exports/rows.js';
import { csvStream, xlsxStream, xmlEscape, type Cell, type Column } from '../../src/exports/writers.js';

async function collect(gen: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const p of gen) parts.push(p);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function* batches(...b: Cell[][][]): AsyncGenerator<Cell[][]> {
  for (const x of b) yield x;
}

describe('text cell normalization and formula neutralization (N9)', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+1', "'+1"],
    ['-12.50', "'-12.50"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['  =HYPERLINK("x")', "'  =HYPERLINK(\"x\")"],
    ['\u{ff1d}1+1', "'\u{ff1d}1+1"],
    ['\u{3000}\u{ff20}x', "'\u{3000}\u{ff20}x"],
    ['\t=cmd', "' =cmd"],
    ['a=1', 'a=1'],
    ['Acme', 'Acme'],
    ['', ''],
  ])('%j -> %j', (input, expected) => {
    expect(textCell(input)).toBe(expected);
  });

  it('removes controls, bidi and zero-width characters and collapses line breaks', () => {
    expect(cleanText('a\r\nb\u{2028}\u{2029}c\td')).toBe('a b c d');
    expect(cleanText('x\u0000\u0007y\u{85}z')).toBe('xyz');
    expect(cleanText('\u{202e}evil\u{2066}\u{200b}\u{feff}')).toBe('evil');
    expect(cleanText('\u{200b}=1')).toBe('=1');
    expect(textCell('\u{200b}=1')).toBe("'=1");
    expect([...cleanText('x'.repeat(10_050))]).toHaveLength(10_000);
    expect(neutralizeFormula('  plain')).toBe('  plain');
  });

  it('formats cents with integer arithmetic', () => {
    expect([formatCents(0), formatCents(5), formatCents(-1250), formatCents(211800), formatCents(-1)]).toEqual(['0.00', '0.05', '-12.50', '2118.00', '-0.01']);
    expect(() => formatCents(1.5)).toThrow(RangeError);
  });

  it('builds the attachment file name', () => {
    expect(exportFilename('claims', 'csv', new Date('2026-10-08T07:05:09.123Z'))).toBe('freight-recovery-claims-20261008T070509Z.csv');
  });
});

const COLS: Column[] = [
  { header: 'Name', width: 10 },
  { header: 'Amount (USD)', width: 10 },
  { header: 'Count', width: 5 },
];

describe('CSV writer', () => {
  it('writes BOM, CRLF, quoted text, unquoted numbers and neutralized cells', async () => {
    const out = await collect(
      csvStream(
        COLS,
        batches(
          [
            [{ t: 's', v: 'Acme "Freight", LLC' }, { t: 'n', v: '-12.50', money: true }, { t: 'n', v: '3' }],
            [{ t: 's', v: '=cmd|calc' }, { t: 'n', v: null }, { t: 's', v: null }],
          ],
          [],
        ),
      ),
    );
    expect([...out.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(out.subarray(3))).toBe('"Name","Amount (USD)","Count"\r\n"Acme ""Freight"", LLC",-12.50,3\r\n"\'=cmd|calc",,""\r\n');
  });

  it('a zero-row export is a valid file with only the header', async () => {
    const out = await collect(csvStream(COLS, batches()));
    expect(new TextDecoder().decode(out.subarray(3))).toBe('"Name","Amount (USD)","Count"\r\n');
  });

  it('refuses non-numeric values in numeric cells', async () => {
    await expect(collect(csvStream(COLS, batches([[{ t: 's', v: 'x' }, { t: 'n', v: '=1' }, { t: 'n', v: '1' }]])))).rejects.toThrow(RangeError);
  });
});

describe('XLSX writer', () => {
  it('produces exactly the six OOXML parts, inline strings, numbers, frozen bold header and no formulas', async () => {
    const out = await collect(
      xlsxStream(
        'claims',
        COLS,
        batches([[{ t: 's', v: '=HYPERLINK("http://evil","x") & <b>' }, { t: 'n', v: '2118.00', money: true }, { t: 'n', v: '2' }]]),
      ),
    );
    const files = unzipSync(out);
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml'] ?? new Uint8Array());
    expect(sheet).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Name</t></is></c>');
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">&apos;=HYPERLINK(&quot;http://evil&quot;,&quot;x&quot;) &amp; &lt;b&gt;</t></is></c>');
    expect(sheet).toContain('<c r="B2" s="2"><v>2118.00</v></c>');
    expect(sheet).toContain('<c r="C2"><v>2</v></c>');
    const all = Object.values(files).map((f) => strFromU8(f)).join('\n');
    for (const forbidden of ['<f>', '<f ', 'hyperlink', 'TargetMode', 'vbaProject', 'definedName', 'docProps', 'drawing']) {
      expect([forbidden, all.includes(forbidden)]).toEqual([forbidden, false]);
    }
    expect(strFromU8(files['xl/workbook.xml'] ?? new Uint8Array())).toContain('<sheet name="claims" sheetId="1" r:id="rId1"/>');
  });

  it('drops characters illegal in XML 1.0', () => {
    expect(xmlEscape('a\u0001b\u{fffe}c\u{d800}d\u{1f600}')).toBe('abcd\u{1f600}');
  });
});

describe('keyset cursors', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  it('handles ascending/descending, nullable and enum sort keys', () => {
    expect(keysetAfter('createdAt', 'desc', new Date(0), id)).toEqual({ OR: [{ createdAt: { lt: new Date(0) } }, { createdAt: new Date(0), id: { lt: id } }] });
    expect(keysetAfter('loadNumber', 'asc', 'L1', id)).toEqual({ OR: [{ loadNumber: { gt: 'L1' } }, { loadNumber: 'L1', id: { gt: id } }, { loadNumber: null }] });
    expect(keysetAfter('loadNumber', 'asc', null, id)).toEqual({ loadNumber: null, id: { gt: id } });
    expect(keysetAfter('loadNumber', 'desc', null, id)).toEqual({ OR: [{ loadNumber: null, id: { lt: id } }, { loadNumber: { not: null } }] });
    expect(keysetAfter('status', 'asc', 'REJECTED', id)).toEqual({
      OR: [{ status: { in: ['SEND_READY', 'AWAITING_ANALYSIS'] } }, { status: 'REJECTED', id: { gt: id } }],
    });
    expect(() => keysetAfter('claimNumber', 'asc', null, id)).toThrow();
  });
});
