/**
 * Test helper: hand-built text-layer PDFs (port of tests/test_ingest_extract.py `_minimal_pdf`), plus a
 * multi-page variant. Latin-1 only; parentheses and backslashes in lines are escaped.
 */

function escapePdfString(s: string): string {
  return s.replace(/[\\()]/gu, (c) => `\\${c}`);
}

function assemble(objs: string[]): Uint8Array {
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff);
}

/** One page, one text line per entry (Helvetica 12pt, 14pt leading) - identical to Python's helper. */
export function minimalPdf(lines: string[]): Uint8Array {
  const content = `BT /F1 12 Tf 50 750 Td 14 TL ${lines.map((l) => `(${escapePdfString(l)}) '`).join(' ')} ET`;
  return assemble([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

/** Several pages, each with its own lines. */
export function multiPagePdf(pages: string[][]): Uint8Array {
  const n = pages.length;
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`];
  const fontObj = 3 + n * 2;
  pages.forEach((lines, i) => {
    const content = `BT /F1 12 Tf 50 750 Td 14 TL ${lines.map((l) => `(${escapePdfString(l)}) '`).join(' ')} ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${fontObj} 0 R >> >> >>`);
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  return assemble(objs);
}
