/* eslint-disable */
// Step-3 (Import + Export) acceptance helpers. Black-box only (api/src is reached only through buildTestApp).
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import zlib from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { type Res, type Session, expectSecurityHeaders } from './client.js';
import { REPO, have } from './sh.js';

export const sha256 = (b: Buffer | Uint8Array | string) => createHash('sha256').update(b).digest('hex');
export const RUN = randomBytes(3).toString('hex');
let seqN = 0;
export const uniqLoad = (tag: string) => `LD-T${tag}-${RUN}${++seqN}`;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const RAND_UUID = '00000000-0000-4000-8000-0000000000cc';

// seeded PRNG (mulberry32); property tests print their seed
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.assign(next, {
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
    bytes: (n: number) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = Math.floor(next() * 256); return b; },
  });
}
export const ACC_SEED = Number(process.env.ACC_SEED ?? 20261008);

export function pySplitlines(t: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (c === '\r') { if (t[i + 1] === '\n') i++; out.push(cur); cur = ''; }
    else if ('\n\v\f\x1c\x1d\x1e\x85\u2028\u2029'.includes(c)) { out.push(cur); cur = ''; }
    else cur += c;
  }
  if (cur !== '') out.push(cur);
  return out;
}

// Contract constants (N7)
export const INVOICE_KEYS = ['invoice.invoice_number', 'invoice.load_number', 'invoice.carrier', 'invoice.shipper', 'invoice.invoice_date', 'invoice.total', 'invoice.charge.description', 'invoice.charge.amount'];
export const RATE_KEYS = ['rate_confirmation.load_number', 'rate_confirmation.carrier', 'rate_confirmation.linehaul_rate', 'rate_confirmation.fuel_surcharge', 'rate_confirmation.detention_free_hours', 'rate_confirmation.detention_rate_per_hour', 'rate_confirmation.detention_max_hours', 'rate_confirmation.authorized_accessorials'];
export const BOL_KEYS = ['bol.load_number', 'bol.facility', 'bol.appointment_time', 'bol.arrival_time', 'bol.departure_time'];
export const ALLOWED_KEYS = new Set([...INVOICE_KEYS, ...RATE_KEYS, ...BOL_KEYS]);
export const KEY_ORDER = [...INVOICE_KEYS, ...RATE_KEYS, ...BOL_KEYS];

export const FIX = (rel: string) => readFileSync(resolve(REPO, 'tests', 'fixtures', rel));
export const FIXTURE_FILES = ['ld5001/bol.txt', 'ld5001/invoice.txt', 'ld5001/rate_confirmation.txt', 'ld5002/bol.csv', 'ld5002/ratecon.csv', 'ld5002/invoice.csv'];
export const base = (p: string) => p.split('/').pop()!;

export const bolTxt = (load: string, eol = '\r\n') =>
  ['DOCUMENT: BILL OF LADING', `Load Number: ${load}`, 'Facility: Widget Co DC 4', 'Appointment Time: 2025-03-03 08:00', 'Arrival Time: 2025-03-03 07:45', 'Departure Time: 2025-03-03 11:30'].join(eol) + eol;
export const invoiceTxt = (load: string, o: { carrier?: string | undefined; shipper?: string | undefined; invoice?: string | undefined; eol?: string | undefined } = {}) => {
  const eol = o.eol ?? '\r\n';
  return ['DOCUMENT: FREIGHT INVOICE', `Invoice Number: ${o.invoice ?? 'INV-1001'}`, `Carrier: ${o.carrier ?? 'Acme Freight LLC'}`, `Shipper: ${o.shipper ?? 'Widget Co'}`, `Load Number: ${load}`, 'Invoice Date: 2025-03-10', 'Charge: Linehaul | 1500.00', 'Charge: Fuel Surcharge | 168.00', 'Charge: Detention | 300.00', 'Charge: Lumper | 150.00', 'Total: $2,118.00'].join(eol) + eol;
};
export const rateTxt = (load: string, eol = '\r\n') =>
  ['DOCUMENT: RATE CONFIRMATION', `Load Number: ${load}`, 'Carrier: Acme Freight LLC', 'Linehaul Rate: 1400.00', 'Fuel Surcharge: 168.00', 'Detention Free Hours: 2', 'Detention Rate Per Hour: 50.00', 'Detention Max Hours: 8', 'Authorized Accessorials: Detention'].join(eol) + eol;

// CRC32 / ZIP
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function zipStored(entries: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const cd: Buffer[] = [];
  let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const crc = crc32(e.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(e.data.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, e.data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(e.data.length, 20); ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    cd.push(ch, name);
    off += 30 + name.length + e.data.length;
  }
  const cdBuf = Buffer.concat(cd);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}
export function unzip(buf: Buffer): Map<string, Buffer> {
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('not a ZIP: no end-of-central-directory record');
  const n = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString('utf8');
    const lnl = buf.readUInt16LE(lho + 26), lxl = buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(lho + 30 + lnl + lxl, lho + 30 + lnl + lxl + csize);
    out.set(name, method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw));
    p += 46 + nl + xl + cl;
  }
  return out;
}

// PDF builders
const BS = String.fromCharCode(92), Q = String.fromCharCode(39);
const pdfEsc = (s: string) => s.replace(/[\x5c()]/g, (c) => BS + c).replace(/[^\x20-\x7e]/g, '?');
export function pdfAssemble(objs: (string | Buffer)[], o: { root?: number; prev?: 'self' | number; header?: string } = {}): Buffer {
  const chunks: Buffer[] = [Buffer.from(o.header ?? '%PDF-1.4\n', 'latin1')];
  let len = chunks[0]!.length;
  const offs: number[] = [];
  objs.forEach((b, i) => {
    offs.push(len);
    const body = typeof b === 'string' ? Buffer.from(b, 'latin1') : b;
    const pre = Buffer.from(`${i + 1} 0 obj\n`, 'latin1');
    const post = Buffer.from('\nendobj\n', 'latin1');
    chunks.push(pre, body, post);
    len += pre.length + body.length + post.length;
  });
  const xref = len;
  let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((v) => `${String(v).padStart(10, '0')} 00000 n \n`).join('');
  const prev = o.prev === 'self' ? ` /Prev ${xref}` : o.prev ? ` /Prev ${o.prev}` : '';
  x += `trailer\n<< /Size ${objs.length + 1} /Root ${o.root ?? 1} 0 R${prev} >>\nstartxref\n${xref}\n%%EOF\n`;
  chunks.push(Buffer.from(x, 'latin1'));
  return Buffer.concat(chunks);
}
const streamObj = (dict: string, data: Buffer | string) => {
  const b = typeof data === 'string' ? Buffer.from(data, 'latin1') : data;
  return Buffer.concat([Buffer.from(`<< ${dict} /Length ${b.length} >>\nstream\n`, 'latin1'), b, Buffer.from('\nendstream', 'latin1')]);
};
const pageContent = (lines: string[]) => `BT\n/F1 12 Tf\n14 TL\n72 770 Td\n${lines.map((l) => `(${pdfEsc(l)}) Tj T*`).join('\n')}\nET`;
const FONT = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
const PAGE1 = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>';

/** Text-layer PDF: one text line per entry; `pages` is a list of pages (each a list of lines) or one flat list. */
export function buildPdf(pages: string[][] | string[], o: { compress?: boolean } = {}): Buffer {
  const pg: string[][] = pages.length && Array.isArray(pages[0]) ? (pages as string[][]) : [pages as string[]];
  const objs: (string | Buffer)[] = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pg.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pg.length} >>`, FONT];
  pg.forEach((lines, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    const c = pageContent(lines);
    objs.push(o.compress ? streamObj('/Filter /FlateDecode', zlib.deflateSync(Buffer.from(c, 'latin1'))) : streamObj('', c));
  });
  return pdfAssemble(objs);
}
export function pdfWithContent(content: Buffer, filterSpec: string): Buffer {
  return pdfAssemble(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [4 0 R] /Count 1 >>', FONT, PAGE1.replace('/Contents 5 0 R', '/Contents 5 0 R'), streamObj(filterSpec, content)].map((x, i) => (i === 3 ? '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>' : x)));
}
export async function deflateZeros(total: number, chunk = 1 << 20): Promise<Buffer> {
  const cacheFile = join(tmpdir(), `fr-acc-zeros-${total}.z`);
  if (existsSync(cacheFile)) return readFileSync(cacheFile);
  const d = zlib.createDeflate({ level: 9, memLevel: 9, strategy: zlib.constants.Z_RLE });
  const parts: Buffer[] = [];
  d.on('data', (c: Buffer) => parts.push(c));
  const done = new Promise<void>((r, j) => { d.on('end', () => r()); d.on('error', j); });
  const z = Buffer.alloc(chunk);
  for (let sent = 0; sent < total; sent += chunk) if (!d.write(z)) await new Promise((r) => d.once('drain', r));
  d.end();
  await done;
  const out = Buffer.concat(parts);
  try { writeFileSync(cacheFile, out); } catch { /* cache is best effort */ }
  return out;
}
export async function flateBombPdf(): Promise<Buffer> { return pdfWithContent(await deflateZeros(2 * 1024 ** 3), '/Filter /FlateDecode'); }
export async function nestedFlatePdf(layers = 20): Promise<Buffer> {
  let d = await deflateZeros(512 * 1024 ** 2);
  for (let i = 1; i < layers; i++) d = zlib.deflateSync(d);
  return pdfWithContent(d, `/Filter [${Array(layers).fill('/FlateDecode').join(' ')}]`);
}
export function deepKidsPdf(depth = 5000): Buffer {
  const objs: string[] = ['<< /Type /Catalog /Pages 2 0 R >>'];
  for (let i = 0; i < depth; i++) objs.push(`<< /Type /Pages /Kids [${i + 3} 0 R] /Count 1${i ? ` /Parent ${i + 1} 0 R` : ''} >>`);
  objs.push(`<< /Type /Page /Parent ${depth + 1} 0 R /MediaBox [0 0 612 792] >>`);
  return pdfAssemble(objs);
}
export const cyclicKidsPdf = () => pdfAssemble(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [2 0 R] /Count 1 >>']);
export const prevLoopPdf = () => pdfAssemble(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>'], { prev: 'self' });
export const bigCountPdf = () => pdfAssemble(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1000000 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>']);
export const zeroPagesPdf = () => pdfAssemble(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [] /Count 0 >>']);
export function manyPagesPdf(n: number): Buffer {
  return buildPdf(Array.from({ length: n }, (_, i) => (i === 0 ? ['DOCUMENT: RATE CONFIRMATION', 'Load Number: LD-PG'] : [`Page ${i + 1}`])), { compress: true });
}
export function hugeTextPdf(bytes: number): Buffer {
  const word = 'lorem ipsum dolor sit amet ';
  const text = word.repeat(Math.ceil(bytes / word.length)).slice(0, bytes);
  return pdfWithContent(zlib.deflateSync(Buffer.from(`BT /F1 12 Tf 72 700 Td (${text}) Tj ET`, 'latin1')), '/Filter /FlateDecode');
}
/** Active content + egress triggers; the text layer says Document: Rate Confirmation. */
export function activePdf(port: number): Buffer {
  const c = pageContent(['DOCUMENT: RATE CONFIRMATION', 'Load Number: LD-PDF-ACTIVE', 'Carrier: Acme Freight LLC']);
  const u = (p: string) => `http://127.0.0.1:${port}/${p}`;
  const js = `app.alert${BS}(${Q}Load Number: LD-JS${Q}${BS}); this.submitForm${BS}(${Q}${u('js')}${Q}${BS});`;
  return pdfAssemble([
    '<< /Type /Catalog /Pages 2 0 R /OpenAction 7 0 R /AA << /O 7 0 R >> /Names << /EmbeddedFiles << /Names [(evil.txt) 9 0 R] >> >> >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FontFile3 << /F (${u('font')}) >> >>`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> /Annots [6 0 R 8 0 R] /AA << /O 7 0 R >> >>',
    streamObj('', c),
    `<< /Type /Annot /Subtype /Link /Rect [0 0 100 100] /A << /S /URI /URI (${u('ping')}) >> >>`,
    `<< /Type /Action /S /JavaScript /JS (${js}) >>`,
    `<< /Type /Annot /Subtype /Link /Rect [0 0 50 50] /A << /S /Launch /F << /FS /URL /F (${u('launch')}) >> >> >>`,
    `<< /Type /Filespec /F (evil.txt) /EF << /F 10 0 R >> /FS /URL /UF (${u('remote')}) >>`,
    streamObj('/Type /EmbeddedFile', 'DOCUMENT: INVOICE\nLoad Number: LD-EMBEDDED\nInvoice Number: EMBED-1'),
  ]);
}
export function pdfZipPolyglot(): Buffer {
  const pdf = buildPdf(['DOCUMENT: RATE CONFIRMATION', 'Load Number: LD-POLY-PDF', 'Carrier: Acme Freight LLC']);
  return Buffer.concat([pdf, zipStored([{ name: '../evil.txt', data: Buffer.from('DOCUMENT: INVOICE\nLoad Number: LD-ZIP-EVIL') }, { name: '..' + BS + '..' + BS + 'evil2.txt', data: Buffer.from('Load Number: LD-ZIP-EVIL2') }])]);
}
/** Encrypted PDF via qpdf when installed (null otherwise). */
export function encryptedPdf(): Buffer | null {
  if (!have('qpdf')) return null;
  const dir = join(tmpdir(), 'fr-acc-enc');
  mkdirSync(dir, { recursive: true });
  const src = join(dir, 'in.pdf'), dst = join(dir, 'out.pdf');
  writeFileSync(src, buildPdf(['DOCUMENT: RATE CONFIRMATION', 'Load Number: LD-ENC']));
  const r = spawnSync('qpdf', ['--encrypt', 'userpw', 'ownerpw', '256', '--', src, dst], { encoding: 'utf8' });
  return r.status === 0 || r.status === 3 ? readFileSync(dst) : null;
}

// PNG / JPEG builders
const pngChunk = (type: string, data: Buffer, badCrc = false) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE((crc32(td) ^ (badCrc ? 1 : 0)) >>> 0);
  return Buffer.concat([len, td, crc]);
};
export const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export interface PngOpts { w?: number; h?: number; real?: boolean; badCrc?: boolean; noIdat?: boolean; noIend?: boolean; hugeChunk?: boolean; trailing?: Buffer }
export function buildPng(o: PngOpts = {}): Buffer {
  const w = o.w ?? 1, h = o.h ?? 1;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = o.real ? Buffer.alloc((w + 1) * h) : Buffer.from([0, 0]);
  const parts: Buffer[] = [PNG_SIG, pngChunk('IHDR', ihdr, o.badCrc)];
  if (!o.noIdat) parts.push(pngChunk('IDAT', zlib.deflateSync(raw)));
  if (o.hugeChunk) { const l = Buffer.alloc(4); l.writeUInt32BE(0x7fffffff); parts.push(Buffer.concat([l, Buffer.from('IDAT'), Buffer.alloc(8)])); }
  if (!o.noIend) parts.push(pngChunk('IEND', Buffer.alloc(0)));
  if (o.trailing) parts.push(o.trailing);
  return Buffer.concat(parts);
}
export interface JpegOpts { w?: number; h?: number; noEoi?: boolean; badSegment?: boolean; trailing?: Buffer }
export function buildJpeg(o: JpegOpts = {}): Buffer {
  const w = o.w ?? 1, h = o.h ?? 1;
  const seg = (m: number, body: Buffer) => { const l = Buffer.alloc(2); l.writeUInt16BE(body.length + 2); return Buffer.concat([Buffer.from([0xff, m]), l, body]); };
  const sof = Buffer.alloc(9); sof[0] = 8; sof.writeUInt16BE(h, 1); sof.writeUInt16BE(w, 3); sof[5] = 1; sof[6] = 1; sof[7] = 0x11; sof[8] = 0;
  const dht = (tc: number) => { const b = Buffer.alloc(18); b[0] = tc; b[1] = 1; b[17] = 0; return b; };
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])), seg(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])), seg(0xc0, sof), seg(0xc4, dht(0x00)), seg(0xc4, dht(0x10)), seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), Buffer.from([0x3f])];
  if (o.badSegment) parts.splice(2, 0, Buffer.from([0xff, 0xe1, 0xff, 0xff, 0x41, 0x42]));
  if (!o.noEoi) parts.push(Buffer.from([0xff, 0xd9]));
  if (o.trailing) parts.push(o.trailing);
  return Buffer.concat(parts);
}

// CSV (RFC 4180) and XLSX readers
export interface CsvCell { v: string; quoted: boolean }
export function parseCsvDetailed(text: string): CsvCell[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: CsvCell[][] = [];
  let row: CsvCell[] = [], cur = '', q = false, quoted = false, i = 0, any = false;
  const endCell = () => { row.push({ v: cur, quoted }); cur = ''; quoted = false; };
  while (i < text.length) {
    const c = text[i]!;
    any = true;
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i += 2; continue; } q = false; i++; continue; }
      cur += c; i++; continue;
    }
    if (c === '"' && cur === '' && !quoted) { q = true; quoted = true; i++; continue; }
    if (c === ',') { endCell(); i++; continue; }
    if (c === '\r' && text[i + 1] === '\n') { endCell(); rows.push(row); row = []; i += 2; any = false; continue; }
    if (c === '\n' || c === '\r') throw new Error('bare LF/CR record separator in CSV (CRLF required)');
    cur += c; i++;
  }
  if (q) throw new Error('unterminated quote');
  if (any || row.length) { endCell(); rows.push(row); }
  return rows;
}
export const parseCsv = (t: string) => parseCsvDetailed(t).map((r) => r.map((c) => c.v));

const xmlUnesc = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_m, e: string) => e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? String.fromCharCode(39) : e[1] === 'x' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(parseInt(e.slice(1), 10)));
export function assertWellFormedXml(xml: string, label: string) {
  const stack: string[] = [];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>|[^<]+|</g;
  let m: RegExpExecArray | null, last = 0;
  while ((m = re.exec(xml))) {
    expect(m.index, `${label}: unparsable markup at ${m.index}`).toBe(last);
    last = re.lastIndex;
    const t = m[0];
    if (t === '<') throw new Error(`${label}: stray less-than`);
    if (!t.startsWith('<')) { expect(/&(?!(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(t), `${label}: bad entity`).toBe(false); continue; }
    if (m[2]) {
      if (m[1]) expect(stack.pop(), `${label}: mismatched close tag ${m[2]}`).toBe(m[2]);
      else if (!m[4]) stack.push(m[2]);
    }
  }
  expect(last, `${label}: trailing junk`).toBe(xml.length);
  expect(stack, `${label}: unclosed elements`).toEqual([]);
}
export interface XlsxCell { ref: string; t: string | null; s: string | null; v: string; hasF: boolean }
export interface Xlsx { files: string[]; parts: Map<string, Buffer>; sheetName: string; sheetXml: string; rows: XlsxCell[][]; frozen: boolean; stylesXml: string }
export function readXlsx(buf: Buffer): Xlsx {
  const parts = unzip(buf);
  const text = (n: string) => parts.get(n)?.toString('utf8') ?? '';
  const wb = text('xl/workbook.xml');
  const sheetName = xmlUnesc(/<sheet\b[^>]*\bname="([^"]*)"/.exec(wb)?.[1] ?? '');
  const sst: string[] = [];
  for (const m of text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)) sst.push(xmlUnesc([...m[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
  const sheetXml = text('xl/worksheets/sheet1.xml');
  const rows: XlsxCell[][] = [];
  for (const rm of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: XlsxCell[] = [];
    for (const cm of rm[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const at = cm[1] ?? '', inner = cm[2] ?? '';
      const t = /\bt="([^"]*)"/.exec(at)?.[1] ?? null;
      const ref = /\br="([^"]*)"/.exec(at)?.[1] ?? '';
      const s = /\bs="([^"]*)"/.exec(at)?.[1] ?? null;
      let v = '';
      if (t === 'inlineStr') v = xmlUnesc([...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      else if (t === 's') v = sst[Number(/<v>([^<]*)<\/v>/.exec(inner)?.[1])] ?? '';
      else v = xmlUnesc(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '');
      cells.push({ ref, t, s, v, hasF: /<f[\s>\/]/.test(inner) });
    }
    rows.push(cells);
  }
  return { files: [...parts.keys()], parts, sheetName, sheetXml, rows, frozen: /<pane\b[^>]*state="frozen"/.test(sheetXml) && /ySplit="1"/.test(sheetXml), stylesXml: text('xl/styles.xml') };
}
export const isTextCell = (c: XlsxCell) => c.t === 's' || c.t === 'inlineStr' || c.t === 'str';
export const xlsxMatrix = (x: Xlsx): string[][] => x.rows.map((r) => r.map((c) => c.v));

// formula neutralization oracle (N9)
const WS = ['s', 'u0085', 'u00a0', 'u1680', 'u2000-' + String.fromCharCode(92) + 'u200a', 'u2028', 'u2029', 'u202f', 'u205f', 'u3000'].map((x) => String.fromCharCode(92) + x).join('');
const LEAD_WS = new RegExp(`^[${WS}]+`, 'u');
const TRIGGER = /^[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/u;
export function cleanCell(v: string): string {
  let s = v.replace(/[\t\r\n\u2028\u2029]/g, ' ');
  s = s.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '');
  return [...s].slice(0, 10000).join('');
}
export function neutralize(v: string): string {
  const c = cleanCell(v);
  return TRIGGER.test(c.replace(LEAD_WS, '')) ? String.fromCharCode(39) + c : c;
}
export const startsWithTrigger = (s: string) => TRIGGER.test(s.replace(LEAD_WS, ''));
export const dollars = (cents: number) => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;

// S3 inspection client (AWS SDK already in the workspace; variable specifier = no compile-time dependency)
export const S3_ENV = {
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000',
  S3_REGION: process.env.S3_REGION ?? 'us-east-1',
  S3_BUCKET: process.env.S3_BUCKET ?? 'fr-documents-dev',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'localdev',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'localdev-minio-password',
  S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE ?? 'true',
  S3_SSE: process.env.S3_SSE ?? 'none',
  ...(process.env.S3_KMS_KEY_ID ? { S3_KMS_KEY_ID: process.env.S3_KMS_KEY_ID } : {}),
} as Record<string, string>;
let _s3: { c: any; mod: any } | null = null;
async function s3c() {
  if (_s3) return _s3;
  const name = '@aws-sdk/client-s3';
  const mod: any = await import(/* @vite-ignore */ name);
  _s3 = { mod, c: new mod.S3Client({ endpoint: S3_ENV.S3_ENDPOINT, region: S3_ENV.S3_REGION, forcePathStyle: true, credentials: { accessKeyId: S3_ENV.S3_ACCESS_KEY_ID, secretAccessKey: S3_ENV.S3_SECRET_ACCESS_KEY } }) };
  return _s3;
}
export async function assertS3Reachable(): Promise<void> {
  try {
    const { c, mod } = await s3c();
    await c.send(new mod.HeadBucketCommand({ Bucket: S3_ENV.S3_BUCKET }));
  } catch (e) {
    throw new Error(`ACCEPTANCE PRECONDITION FAILED: S3-compatible endpoint ${S3_ENV.S3_ENDPOINT} / bucket ${S3_ENV.S3_BUCKET} unreachable (${(e as Error).message}). Start MinIO and run: npm run ensure-bucket (set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY).`);
  }
}
export async function s3List(prefix = ''): Promise<string[]> {
  const { c, mod } = await s3c();
  const out: string[] = [];
  let token: string | undefined;
  do {
    const r: any = await c.send(new mod.ListObjectsV2Command({ Bucket: S3_ENV.S3_BUCKET, Prefix: prefix, ContinuationToken: token }));
    out.push(...(r.Contents ?? []).map((o: any) => o.Key));
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}
export async function s3Head(key: string): Promise<any | null> {
  const { c, mod } = await s3c();
  try { return await c.send(new mod.HeadObjectCommand({ Bucket: S3_ENV.S3_BUCKET, Key: key })); } catch { return null; }
}
export async function s3Get(key: string): Promise<Buffer> {
  const { c, mod } = await s3c();
  const r: any = await c.send(new mod.GetObjectCommand({ Bucket: S3_ENV.S3_BUCKET, Key: key }));
  return Buffer.from(await r.Body.transformToByteArray());
}
export async function s3Put(key: string, body: Buffer): Promise<void> {
  const { c, mod } = await s3c();
  await c.send(new mod.PutObjectCommand({ Bucket: S3_ENV.S3_BUCKET, Key: key, Body: body, ContentType: 'application/octet-stream' }));
}
export async function s3Tags(key: string): Promise<Record<string, string>> {
  const { c, mod } = await s3c();
  try { const r: any = await c.send(new mod.GetObjectTaggingCommand({ Bucket: S3_ENV.S3_BUCKET, Key: key })); return Object.fromEntries((r.TagSet ?? []).map((t: any) => [t.Key, t.Value])); } catch { return {}; }
}
export const docPrefix = (tenantId: string, batchId: string, docId: string) => `t/${tenantId}/imports/${batchId}/${docId}/`;
export async function waitGone(prefix: string, ms = 3000): Promise<string[]> {
  const t0 = Date.now();
  let k = await s3List(prefix);
  while (k.length && Date.now() - t0 < ms) { await sleep(250); k = await s3List(prefix); }
  return k;
}
export const KEY_RE = (tenantId?: string) => new RegExp(`^t/${tenantId ?? '[0-9a-f-]{36}'}/imports/[0-9a-f-]{36}/[0-9a-f-]{36}/(original|text)$`);

// Python parity oracle (A)
export function findPython(): { cmd: string; env: NodeJS.ProcessEnv } | { cmd: null; reason: string } {
  const src = resolve(REPO, 'src');
  const env = { ...process.env, PYTHONPATH: process.env.PYTHONPATH ?? src, PYTHONIOENCODING: 'utf-8' };
  const cands = [process.env.PYTHON, resolve(REPO, '.venv/Scripts/python.exe'), resolve(REPO, '.venv/bin/python'), 'python3', 'python'].filter(Boolean) as string[];
  const why: string[] = [];
  for (const c of cands) {
    const r = spawnSync(c, ['-c', 'import freight_recovery.ingest, freight_recovery.extraction'], { env, encoding: 'utf8' });
    if (r.status === 0) return { cmd: c, env };
    why.push(`${c}: ${(r.error?.message ?? r.stderr ?? '').toString().trim().split('\n').pop()}`);
  }
  return { cmd: null, reason: why.join(' | ') };
}
/** Returns the interpreter or null (local skip with a loud message); throws when CI=true. */
export function pythonOrSkip(): { cmd: string; env: NodeJS.ProcessEnv } | null {
  const p = findPython();
  if (p.cmd) return p as any;
  const msg = `Python parity oracle unavailable: ${(p as any).reason}`;
  if (process.env.CI === 'true' || process.env.CI === '1') throw new Error(`${msg} (CI=true: parity group must not skip)`);
  console.warn(`[ACCEPTANCE SKIP] ${msg}`);
  return null;
}
export const PY_SCRIPT_PATH = resolve(__dirname, 'parity_oracle.py');
export interface PyResult { error?: string; doc_type?: string; sha256?: string; warnings?: string[]; text?: string; extraction?: any }
export function pyOracle(py: { cmd: string; env: NodeJS.ProcessEnv }, files: { name: string; data: Buffer }[]): PyResult[] {
  const out: PyResult[] = [];
  for (let i = 0; i < files.length; i += 100) {
    const chunk = files.slice(i, i + 100);
    const dir = join(tmpdir(), 'fr-acc-py');
    mkdirSync(dir, { recursive: true });
    const f = join(dir, `in-${process.pid}-${i}.json`);
    writeFileSync(f, JSON.stringify(chunk.map((x) => ({ name: x.name, b64: x.data.toString('base64') }))));
    const r = spawnSync(py.cmd, [PY_SCRIPT_PATH, f], { env: py.env, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0) throw new Error(`python oracle failed: ${r.stderr}`);
    out.push(...JSON.parse(r.stdout));
  }
  return out;
}
const PY_TYPE: Record<string, string> = { invoice: 'INVOICE', rate_confirmation: 'RATE_CONFIRMATION', bol: 'BILL_OF_LADING', unknown: 'OTHER' };
const WARN_CODE = (w: string) => /too few columns/.test(w) ? 'CSV_ROW_TOO_SHORT' : /cells but the header has/.test(w) ? 'CSV_ROW_LENGTH_MISMATCH' : /charge line was ignored/.test(w) ? 'CHARGE_AMOUNT_UNREADABLE' : `UNMAPPED:${w}`;
/** Python oracle result -> the comparable projection. */
export function projectPy(r: PyResult) {
  const e = r.extraction;
  const warnings = [...(r.warnings ?? []), ...(e?.extraction_warnings ?? [])].map(WARN_CODE).sort();
  let ex: any = null;
  if (e) {
    const { extraction_warnings, ...rest } = e;
    ex = rest;
    if (rest.lines) ex = { ...rest, lines: rest.lines.map((l: any) => ({ description: l.description, amount: l.amount })) };
  }
  return { docType: PY_TYPE[r.doc_type!], sha256: r.sha256, warnings, extraction: ex };
}
/** API ImportDocumentDetail -> the same projection. */
export function projectApi(d: any) {
  const live = (d.fields as any[]).filter((f) => f.origin === 'EXTRACTED');
  const eff = (k: string) => { const f = live.filter((x) => x.key === k).at(-1); return f ? f.effectiveValue ?? f.value ?? null : null; };
  let ex: any = null;
  if (d.docType === 'INVOICE') {
    const desc = live.filter((f) => f.key === 'invoice.charge.description').sort((a, b) => a.groupIndex - b.groupIndex);
    const amt = new Map(live.filter((f) => f.key === 'invoice.charge.amount').map((f) => [f.groupIndex, f.effectiveValue ?? f.value]));
    ex = { invoice_number: eff('invoice.invoice_number'), load_number: eff('invoice.load_number'), carrier: eff('invoice.carrier'), shipper: eff('invoice.shipper'), invoice_date: eff('invoice.invoice_date'), lines: desc.map((f) => ({ description: f.effectiveValue ?? f.value, amount: amt.get(f.groupIndex) ?? null })), total: eff('invoice.total') };
  } else if (d.docType === 'RATE_CONFIRMATION') {
    const al = eff('rate_confirmation.authorized_accessorials');
    ex = { load_number: eff('rate_confirmation.load_number'), carrier: eff('rate_confirmation.carrier'), linehaul_rate: eff('rate_confirmation.linehaul_rate'), fuel_surcharge: eff('rate_confirmation.fuel_surcharge'), detention_free_hours: eff('rate_confirmation.detention_free_hours'), detention_rate_per_hour: eff('rate_confirmation.detention_rate_per_hour'), detention_max_hours: eff('rate_confirmation.detention_max_hours'), authorized_accessorials: al ? JSON.parse(al) : [] };
  } else if (d.docType === 'BILL_OF_LADING') {
    ex = { load_number: eff('bol.load_number'), facility: eff('bol.facility'), appointment_time: eff('bol.appointment_time'), arrival_time: eff('bol.arrival_time'), departure_time: eff('bol.departure_time') };
  }
  return { docType: d.docType, sha256: d.sha256, warnings: [...(d.warnings as string[])].filter((w) => /^(CSV_ROW_TOO_SHORT|CSV_ROW_LENGTH_MISMATCH|CHARGE_AMOUNT_UNREADABLE)$/.test(w)).sort(), extraction: ex };
}

// Egress listener: every connection attempt is a failure
export async function startListener(): Promise<{ port: number; hits: () => number; close: () => Promise<void> }> {
  let n = 0;
  const srv = net.createServer((s) => { n++; s.on('error', () => undefined); s.destroy(); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { port: (srv.address() as net.AddressInfo).port, hits: () => n, close: () => new Promise<void>((r) => srv.close(() => r())) };
}

// Response recorder (global header / leak scans)
interface Rec { path: string; status: number; headers: Record<string, any>; text: string }
export const REC: Rec[] = [];
export function record(path: string, r: { status: number; headers: Record<string, any>; text?: string }) {
  const ct = String(r.headers['content-type'] ?? '');
  REC.push({ path, status: r.status, headers: r.headers, text: /json|text\/plain/.test(ct) ? (r.text ?? '') : '' });
  return r;
}
export function wrap(s: Session): Session {
  const w: Session = { ...s, as: async (m, p, o) => { const r = await s.as(m, p, o); record(`${m} ${p}`, r); return r; } } as Session;
  w.get = (p, o) => w.as('GET', p, o);
  w.post = (p, b, o) => w.as('POST', p, { body: b ?? {}, ...o });
  w.patch = (p, b, o) => w.as('PATCH', p, { body: b, ...o });
  w.destroy = (p, o) => w.as('DELETE', p, o);
  return w;
}
export const LEAK_RE = new RegExp(['X-Amz-', 'AWSAccessKeyId', 'node_modules', 'at [a-zA-Z0-9_$.<>]+ [(]', 'at file:', '[A-Za-z]:[/' + String.fromCharCode(92) + String.fromCharCode(92) + '](Users|Windows|Program)', '/usr/(lib|local)', '/home/', '/app/(src|dist)', 'pdfjs', 'pdf-lib', 'pdfplumber', 'pdfminer', 'unpdf', 'fflate', 'TypeError:', 'RangeError:', 'PrismaClient'].join('|'));
export function assertRecorded(label = '') {
  const host = (() => { try { return new URL(S3_ENV.S3_ENDPOINT!).host; } catch { return ''; } })();
  for (const r of REC) {
    if (r.status === 0) continue;
    const res = { status: r.status, headers: r.headers, body: undefined, text: r.text, setCookies: [], ms: 0 } as Res;
    expectSecurityHeaders(res, { hsts: null });
    for (const [k, v] of Object.entries(r.headers)) {
      expect(/x-amz-/i.test(k), `${label} ${r.path}: response header ${k}`).toBe(false);
      expect(LEAK_RE.test(String(v)), `${label} ${r.path}: leak in header ${k}`).toBe(false);
    }
    expect(r.text.length > 0 ? LEAK_RE.test(r.text) : false, `${label} ${r.path} (${r.status}): leak in body: ${r.text.slice(0, 300)}`).toBe(false);
    if (host && r.text) expect(r.text.includes(host), `${label} ${r.path}: S3 endpoint host in body`).toBe(false);
  }
}

// HTTP helpers: injected upload + real HTTP
export interface UpOpts { ct?: string | null; rawQuery?: string; csrf?: 'auto' | false | string; token?: string | null | undefined; headers?: Record<string, string>; ip?: string; extraQuery?: string }
export const enc = (n: string) => encodeURIComponent(n);
function mkRes(r: any, ms: number): Res {
  const sc = r.headers['set-cookie'];
  let body: any;
  try { body = r.body ? JSON.parse(r.body) : undefined; } catch { body = undefined; }
  return { status: r.statusCode, headers: r.headers, body, text: r.body, setCookies: Array.isArray(sc) ? sc : sc ? [sc] : [], ms };
}
export async function upload(s: Session, batchId: string, filename: string | null, bytes: Buffer | Uint8Array | string, o: UpOpts = {}): Promise<Res> {
  const q = o.rawQuery !== undefined ? o.rawQuery : filename === null ? '' : `filename=${enc(filename)}`;
  const url = `/api/v1/imports/${batchId}/documents${q || o.extraQuery ? '?' + [q, o.extraQuery].filter(Boolean).join('&') : ''}`;
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.ct !== null) headers['content-type'] = o.ct ?? 'application/octet-stream';
  const tok = o.token === undefined ? s.token : o.token;
  if (tok) headers['authorization'] = `Bearer ${tok}`;
  if (o.csrf !== false) {
    const t = await s.client.ensureCsrf();
    headers['x-csrf-token'] = o.csrf && o.csrf !== 'auto' ? o.csrf : t;
  }
  const ck = s.client.cookieFor(url);
  if (ck) headers['cookie'] = ck;
  const t0 = Date.now();
  const r = await s.client.app.inject({ method: 'POST', url, headers, payload: Buffer.from(bytes as any), remoteAddress: o.ip ?? s.client.ip } as any);
  const res = mkRes(r, Date.now() - t0);
  record('POST /imports/:b/documents', res);
  return res;
}
export async function newBatch(s: Session, label?: string): Promise<string> {
  const r = await s.post('/imports', label === undefined ? {} : { label });
  expect(r.status, r.text).toBe(201);
  return r.body.id;
}
export async function putOk(s: Session, batchId: string, name: string, bytes: Buffer | string, o: UpOpts = {}): Promise<any> {
  const r = await upload(s, batchId, name, bytes, o);
  expect(r.status, `${name}: ${r.text}`).toBe(201);
  return r.body;
}
/** Fresh batch + one upload. */
export async function putFresh(s: Session, name: string, bytes: Buffer | string, o: UpOpts = {}): Promise<{ batchId: string; doc: any; res: Res }> {
  const batchId = await newBatch(s);
  const res = await upload(s, batchId, name, bytes, o);
  return { batchId, doc: res.body, res };
}
export const getDoc = async (s: Session, b: string, d: string) => s.get(`/imports/${b}/documents/${d}`);
export const commit = (s: Session, batchId: string, perspective: 'SHIPPER' | 'CARRIER' = 'SHIPPER') => s.post(`/imports/${batchId}/commit`, { perspective });
export const tenantIdOf = (s: Session): string => s.user.tenant.id;
export async function acceptDoc(rev: Session, b: string, d: string, confirmRemaining = true) {
  return rev.post(`/imports/${b}/documents/${d}/accept`, { reason: 'Acceptance suite review ok', confirmRemaining });
}
/** Upload a text-layer PDF of the given lines and accept it through review. */
export async function acceptedPdfDoc(up: Session, rev: Session, batchId: string, name: string, lines: string[]) {
  const d = await putOk(up, batchId, name, buildPdf(lines));
  if (d.status === 'ACCEPTED') return d;
  const a = await acceptDoc(rev, batchId, d.id, true);
  expect(a.status, a.text).toBe(200);
  return a.body;
}

// real HTTP
export async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  return (app.server.address() as net.AddressInfo).port;
}
export interface RawResp { status: number; headers: http.IncomingHttpHeaders; body: Buffer; error?: string | undefined; ms: number; chunks: number; firstChunkAt: number; lastChunkAt: number }
export function rawHttp(port: number, o: { method?: string; path: string; headers?: Record<string, string>; body?: Buffer; drive?: (req: http.ClientRequest) => void; timeoutMs?: number; destroyAfterFirstChunk?: boolean; slowRead?: number; onFirst?: () => void; holdAfterFirst?: boolean }): Promise<RawResp> {
  return new Promise((resolveP) => {
    const t0 = Date.now();
    const chunks: Buffer[] = [];
    let n = 0, first = 0, last = 0, status = 0, headers: http.IncomingHttpHeaders = {}, done = false;
    const fin = (error?: string) => { if (done) return; done = true; clearTimeout(timer); resolveP({ status, headers, body: Buffer.concat(chunks), error, ms: Date.now() - t0, chunks: n, firstChunkAt: first, lastChunkAt: last }); };
    const req = http.request({ host: '127.0.0.1', port, method: o.method ?? 'GET', path: o.path, headers: o.headers, agent: false }, (res) => {
      status = res.statusCode ?? 0; headers = res.headers;
      res.on('data', (c: Buffer) => {
        n++; last = Date.now() - t0; if (!first) first = last; chunks.push(c);
        if (n === 1) o.onFirst?.();
        if (o.holdAfterFirst) { res.pause(); return; }
        if (o.destroyAfterFirstChunk) { req.destroy(); res.destroy(); fin(); }
        else if (o.slowRead) { res.pause(); setTimeout(() => res.resume(), o.slowRead); }
      });
      res.on('end', () => fin());
      res.on('error', (e) => fin(e.message));
      res.on('close', () => fin());
    });
    const timer = setTimeout(() => { req.destroy(); fin('client timeout'); }, o.timeoutMs ?? 60000);
    req.on('error', (e) => fin((e as Error).message));
    if (o.drive) o.drive(req); else { if (o.body) req.write(o.body); req.end(); }
  });
}
export async function authHdrs(s: Session, extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const t = await s.client.ensureCsrf();
  return { authorization: `Bearer ${s.token}`, 'x-csrf-token': t, cookie: `fr_csrf=${t}`, ...extra };
}
export const jsonOf = (r: RawResp) => { try { return JSON.parse(r.body.toString('utf8')); } catch { return undefined; } };

// field helpers
export const fld = (d: any, key: string, gi?: number) => (d.fields as any[]).find((f) => f.key === key && (gi === undefined || f.groupIndex === gi));
export const val = (d: any, key: string, gi?: number) => fld(d, key, gi)?.value ?? null;
export function expectDocInvariants(d: any, bytes?: Buffer) {
  if (bytes) expect(d.sha256).toBe(sha256(bytes));
  expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(d.fieldCount).toBe(d.fields.length);
  expect(d.flaggedFieldCount).toBe(d.fields.filter((f: any) => f.needsReview).length);
  expect(d.unresolvedFlaggedCount).toBeLessThanOrEqual(d.flaggedFieldCount);
  for (const f of d.fields) {
    expect(ALLOWED_KEYS.has(f.key), `key ${f.key}`).toBe(true);
    expect(f.confidence).toBeGreaterThanOrEqual(0);
    expect(f.confidence).toBeLessThanOrEqual(1);
    expect(Math.abs(f.confidence * 1000 - Math.round(f.confidence * 1000))).toBeLessThan(1e-6);
  }
  if (d.status === 'ACCEPTED') expect(d.reviewReasons).toEqual([]);
  if (d.status === 'NEEDS_REVIEW') expect(d.reviewReasons.length).toBeGreaterThan(0);
  if (d.fields.length) expect(d.minConfidence).toBe(Math.min(...d.fields.map((f: any) => f.confidence)));
}
export function expectSourceSanity(d: any, text: string) {
  const lines = pySplitlines(text);
  for (const f of d.fields as any[]) {
    if (f.origin !== 'EXTRACTED') continue;
    const s = f.source;
    expect(s, `source of ${f.key}`).toBeTruthy();
    expect(s.line).toBeGreaterThanOrEqual(1);
    expect(s.line).toBeLessThanOrEqual(Math.max(lines.length, 1));
    const line = lines[s.line - 1] ?? '';
    expect(s.start).toBeGreaterThanOrEqual(0);
    expect(s.start).toBeLessThanOrEqual(s.end);
    expect(s.end).toBeLessThanOrEqual(line.length);
    expect(s.excerpt.length).toBeLessThanOrEqual(200);
    expect(/[\u0000-\u001f\u007f-\u009f<>`]/.test(s.excerpt), `excerpt ${JSON.stringify(s.excerpt)}`).toBe(false);
  }
}

// audit helpers
export async function auditSince(admin: Session, seq: number, action?: string): Promise<any[]> {
  const out: any[] = [];
  let before: number | null = null;
  for (let i = 0; i < 100; i++) {
    const r = await admin.get(`/audit/events?limit=100${before ? `&before=${before}` : ''}`);
    expect(r.status, r.text).toBe(200);
    out.push(...r.body.items.filter((e: any) => e.seq > seq));
    if (r.body.nextBefore == null || r.body.items.every((e: any) => e.seq <= seq)) break;
    before = r.body.nextBefore;
  }
  return out.filter((e) => !action || e.action === action).sort((a, b) => a.seq - b.seq);
}
export async function lastSeq(admin: Session): Promise<number> {
  const r = await admin.get('/audit/events?limit=1');
  return r.body.items[0]?.seq ?? 0;
}
/** documentId of an audit event wherever the implementation puts it (metadata or top-level / target). */
export const evDocId = (e: any): string | null => e.metadata?.documentId ?? e.documentId ?? (e.targetType === 'import_document' ? e.targetId : null) ?? null;
export const evReason = (e: any): string | null => e.metadata?.reasonCode ?? e.metadata?.reason ?? e.metadata?.code ?? e.reason ?? null;
export const ORIGIN_BAD = 'http://evil.example';

/** GET returning the raw payload (binary-safe) via app.inject. */
export async function download(s: Session, path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, any>; buf: Buffer; text: string }> {
  const r: any = await s.client.app.inject({ method: 'GET', url: '/api/v1' + path, headers: { authorization: `Bearer ${s.token}`, ...headers }, remoteAddress: s.client.ip } as any);
  const buf: Buffer = Buffer.from(r.rawPayload);
  record(`GET ${path.split('?')[0]}`, { status: r.statusCode, headers: r.headers, text: /json|text/.test(String(r.headers['content-type'])) ? buf.toString('utf8') : '' });
  return { status: r.statusCode, headers: r.headers, buf, text: buf.toString('utf8') };
}
