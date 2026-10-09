/**
 * Fix round 1 (D4-D7): deterministic PDF structure / size rejections. Each hostile PDF is hand-built;
 * every case is checked both on `prescanPdf` and end-to-end through `parseDocument`.
 */
import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { parseDocument } from '../../src/imports/parse/pipeline.js';
import { countContentStringChars, filterChain, prescanPdf, PDF_MAX_FILTERS } from '../../src/imports/parse/pdf-prescan.js';
import { ParseRejection } from '../../src/imports/parse/types.js';
import { minimalPdf, multiPagePdf } from '../helpers/pdf-fixtures.js';

const LIMITS = { pdfPages: 50, textChars: 100_000 };

type Obj = string | { dict: string; data: Buffer };

/** Assemble objects (1-based) with a classic xref table; `trailerExtra` is appended to the trailer dict. */
function assemble(objs: Obj[], opts: { trailerExtra?: string; prevSelf?: boolean } = {}): Uint8Array {
  const parts: Buffer[] = [Buffer.from('%PDF-1.5\n', 'latin1')];
  let len = parts[0]?.length ?? 0;
  const offsets: number[] = [];
  const push = (b: Buffer) => {
    parts.push(b);
    len += b.length;
  };
  objs.forEach((o, i) => {
    offsets.push(len);
    if (typeof o === 'string') push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1'));
    else {
      push(Buffer.from(`${i + 1} 0 obj\n${o.dict.replace('%LEN%', String(o.data.length))}\nstream\n`, 'latin1'));
      push(o.data);
      push(Buffer.from('\nendstream\nendobj\n', 'latin1'));
    }
  });
  const xref = len;
  const prev = opts.prevSelf ? ` /Prev ${xref}` : '';
  let tail = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  tail += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  tail += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R${prev}${opts.trailerExtra ?? ''} >>\nstartxref\n${xref}\n%%EOF`;
  push(Buffer.from(tail, 'latin1'));
  return new Uint8Array(Buffer.concat(parts));
}

const FONT = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

function pageWithContent(content: { dict: string; data: Buffer }): Obj[] {
  return [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    content,
    FONT,
  ];
}

function reason(f: () => unknown): string | null {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof ParseRejection ? e.reason : `threw ${String(e)}`;
  }
}

async function parse(bytes: Uint8Array, limits = LIMITS) {
  return parseDocument({ bytes, filename: 'x.pdf', detectedType: 'PDF', limits: { ...limits, imagePixels: 1_000_000 }, threshold: 0.9 });
}

describe('prescanPdf', () => {
  it('accepts ordinary PDFs and reports a small page tree', () => {
    expect(prescanPdf(minimalPdf(['Invoice Number: 1']), LIMITS)).toMatchObject({ pageTreeNodes: 1 });
    const multi = prescanPdf(multiPagePdf([['a'], ['b'], ['c']]), LIMITS);
    expect(multi.pageTreeNodes).toBe(1);
    expect(multi.textUpperBound).toBe(3);
  });

  it('D5: rejects filter chains longer than the limit and decompression bombs', async () => {
    let data: Buffer = Buffer.from('BT /F1 12 Tf 50 700 Td (Hello) Tj ET', 'latin1');
    const chain: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      data = deflateSync(data);
      chain.push('/FlateDecode');
    }
    const nested = assemble(pageWithContent({ dict: `<< /Length %LEN% /Filter [${chain.join(' ')}] >>`, data }));
    expect(reason(() => prescanPdf(nested, LIMITS))).toBe('malformed_pdf');
    // Deterministic: the same verdict every time.
    for (let k = 0; k < 3; k += 1) expect(await parse(nested)).toEqual({ ok: false, reason: 'malformed_pdf' });

    const ok = assemble(pageWithContent({ dict: '<< /Length %LEN% /Filter [/FlateDecode /FlateDecode] >>', data: deflateSync(deflateSync(Buffer.from('BT (Hi) Tj ET'))) }));
    expect(prescanPdf(ok, LIMITS).textUpperBound).toBe(2);
    expect(PDF_MAX_FILTERS).toBe(3);

    const bomb = assemble(pageWithContent({ dict: '<< /Length %LEN% /Filter /FlateDecode >>', data: deflateSync(Buffer.alloc(40 * 1024 * 1024)) }));
    expect(reason(() => prescanPdf(bomb, LIMITS))).toBe('malformed_pdf');
  });

  it('refuses an indirect /Filter', () => {
    expect(reason(() => filterChain('<< /Length 3 /Filter 7 0 R >>'))).toBe('malformed_pdf');
    expect(filterChain('<< /Filter [/Fl /AHx] >>')).toEqual(['FlateDecode', 'ASCIIHexDecode']);
  });

  it('D4: rejects a /Prev self loop and a deep /Kids chain', async () => {
    const loop = assemble(pageWithContent({ dict: '<< /Length %LEN% >>', data: Buffer.from('BT (A) Tj ET') }), { prevSelf: true });
    expect(reason(() => prescanPdf(loop, LIMITS))).toBe('malformed_pdf');
    expect(await parse(loop)).toEqual({ ok: false, reason: 'malformed_pdf' });

    const depth = 5000;
    const objs: Obj[] = ['<< /Type /Catalog /Pages 2 0 R >>'];
    for (let i = 0; i < depth; i += 1) objs.push(`<< /Type /Pages /Kids [${i + 3} 0 R] /Count 1 >>`);
    const leaf = depth + 2;
    objs.push(`<< /Type /Page /Parent ${leaf - 1} 0 R /MediaBox [0 0 612 792] /Contents ${leaf + 1} 0 R /Resources << /Font << /F1 ${leaf + 2} 0 R >> >> >>`);
    objs.push({ dict: '<< /Length %LEN% >>', data: Buffer.from('BT /F1 12 Tf 50 700 Td (Deep) Tj ET') });
    objs.push(FONT);
    const deep = assemble(objs);
    expect(reason(() => prescanPdf(deep, LIMITS))).toBe('malformed_pdf');
    expect(await parse(deep)).toEqual({ ok: false, reason: 'malformed_pdf' });
  });

  it('D6: counts text drawn outside the page box and rejects over the cap', async () => {
    const offPage = minimalPdf(Array.from({ length: 6000 }, (_, i) => `Line ${i} ${'x'.repeat(60)}`));
    expect(reason(() => prescanPdf(offPage, LIMITS))).toBe('text_too_large');
    expect(await parse(offPage)).toEqual({ ok: false, reason: 'text_too_large' });

    const longLine = assemble(
      pageWithContent({ dict: '<< /Length %LEN% /Filter /FlateDecode >>', data: deflateSync(Buffer.from(`BT /F1 12 Tf 50 700 Td (${'y'.repeat(300_000)}) Tj ET`)) }),
    );
    expect(await parse(longLine)).toEqual({ ok: false, reason: 'text_too_large' });
    // Under the cap the same structure is fine.
    expect((await parse(longLine, { pdfPages: 50, textChars: 400_000 })).ok).toBe(true);
  });

  it('D7: rejects a zero-page PDF as malformed_pdf', async () => {
    const empty = assemble(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [] /Count 0 >>']);
    expect(await parse(empty)).toEqual({ ok: false, reason: 'malformed_pdf' });
  });
});

describe('countContentStringChars', () => {
  const c = (s: string) => countContentStringChars(Buffer.from(s, 'latin1'), 1e9);
  it('counts literal and hex strings, escapes, nesting; skips comments, dicts and inline images', () => {
    expect(c('BT (abc) Tj ET')).toBe(3);
    expect(c('(a\\(b\\)c) Tj (x\\101y) Tj')).toBe(8);
    expect(c('(a(b)c) Tj')).toBe(5);
    expect(c('<41424344> Tj [<4142> 120 (C)] TJ')).toBe(7);
    expect(c('% (comment)\n(z) Tj')).toBe(1);
    expect(c('/P << /MCID 0 >> BDC (q) Tj EMC')).toBe(1);
    expect(c('BI /W 1 /H 1 ID (((((( EI (k) Tj')).toBe(1);
    expect(c('(line\\\ncontinued) Tj')).toBe(13);
  });
});
