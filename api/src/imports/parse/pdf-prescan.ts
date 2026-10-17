/**
 * PDF structural pre-scan (fix round 1, D4-D6). Runs in the sandboxed worker BEFORE pdf.js sees the
 * bytes, so pathological structure is rejected deterministically instead of depending on how far
 * pdf.js gets within the time/memory limits. Pure and bounded: linear scans over the raw bytes plus
 * size-capped decoding of the few stream kinds that matter for text.
 *
 * Checks (all -> `malformed_pdf` unless noted):
 * - stream count <= PDF_MAX_STREAMS; filter chain length <= PDF_MAX_FILTERS; `/Filter` must be direct;
 * - cross-reference `/Prev` chain: no loop, at most PDF_MAX_XREF_SECTIONS sections;
 * - page-tree size: distinct objects carrying `/Kids` (also inside object streams) <= pages + slack;
 * - content streams (page contents, Form XObjects, Type3 glyph procs) and object streams are decoded
 *   (FlateDecode / ASCIIHexDecode / ASCII85Decode) with a per-stream and a total output cap
 *   (decompression bombs are rejected);
 * - text upper bound: characters in string operands of decoded content streams, INCLUDING text drawn
 *   outside the page box (which pdf.js silently drops) -> over `textChars` gives `text_too_large`.
 *
 * Known limits (documented): streams with other filters (LZW, RunLength, image codecs) and corrupt
 * Flate data are not counted; pdf.js' own extracted-text cap still applies to them.
 */
import { constants, inflateSync } from 'node:zlib';

import { ParseRejection } from './types.js';

export const PDF_MAX_FILTERS = 3;
export const PDF_MAX_STREAMS = 20_000;
export const PDF_MAX_XREF_SECTIONS = 64;
export const PDF_PAGE_TREE_SLACK = 16;
export const PDF_MAX_DECODED_STREAM = 32 * 1024 * 1024;
export const PDF_MAX_DECODED_TOTAL = 64 * 1024 * 1024;
const DICT_SCAN_MAX = 65_536;
const OBJSTM_MAX_OBJECTS = 100_000;

export interface PdfPrescan {
  /** Distinct page-tree (intermediate) nodes: objects that carry `/Kids`. */
  pageTreeNodes: number;
  /** Upper bound of text characters in decoded content streams. */
  textUpperBound: number;
  streams: number;
}

const FILTER_ALIASES: Readonly<Record<string, string>> = {
  Fl: 'FlateDecode',
  AHx: 'ASCIIHexDecode',
  A85: 'ASCII85Decode',
  LZW: 'LZWDecode',
  RL: 'RunLengthDecode',
  CCF: 'CCITTFaxDecode',
  DCT: 'DCTDecode',
};

function malformed(): never {
  throw new ParseRejection('malformed_pdf');
}

function isWs(c: number | undefined): boolean {
  return c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
}

/** The dictionary text `<< ... >>` that starts at or after `from` (balanced, bounded), or ''. */
function dictForward(s: string, from: number): string {
  const start = s.indexOf('<<', from);
  if (start === -1 || start - from > 64) return '';
  let depth = 0;
  const end = Math.min(s.length, start + DICT_SCAN_MAX);
  for (let i = start; i < end - 1; i += 1) {
    if (s[i] === '<' && s[i + 1] === '<') {
      depth += 1;
      i += 1;
    } else if (s[i] === '>' && s[i + 1] === '>') {
      depth -= 1;
      i += 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return '';
}

/** The dictionary text that ends at `endIdx` (index just after `>>`), scanning backwards, or ''. */
function dictBackward(s: string, endIdx: number): string {
  let depth = 0;
  const stop = Math.max(0, endIdx - DICT_SCAN_MAX);
  for (let i = endIdx - 1; i > stop; i -= 1) {
    if (s[i] === '>' && s[i - 1] === '>') {
      depth += 1;
      i -= 1;
    } else if (s[i] === '<' && s[i - 1] === '<') {
      depth -= 1;
      i -= 1;
      if (depth === 0) return s.slice(i, endIdx);
    }
  }
  return '';
}

function hasKey(dict: string, key: string): boolean {
  return new RegExp(`/${key}(?![A-Za-z0-9#._-])`, 'u').test(dict);
}

function nameValue(dict: string, key: string): string | null {
  return new RegExp(`/${key}\\s*/([A-Za-z0-9#._-]+)`, 'u').exec(dict)?.[1] ?? null;
}

/** Filter chain of a stream dictionary (aliases expanded). Indirect `/Filter` is refused. */
export function filterChain(dict: string): string[] {
  const m = /\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9#._-]+|\d+\s+\d+\s+R)/u.exec(dict);
  if (!m?.[1]) return [];
  const v = m[1];
  if (/^\d/u.test(v) || /\d+\s+\d+\s+R/u.test(v)) malformed();
  const names = [...v.matchAll(/\/([A-Za-z0-9#._-]+)/gu)].map((x) => x[1] ?? '');
  return names.map((n) => FILTER_ALIASES[n] ?? n);
}

function asciiHex(b: Buffer): Buffer {
  const out: number[] = [];
  let hi = -1;
  for (const c of b) {
    if (c === 0x3e) break;
    const v = c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 55 : c >= 0x61 && c <= 0x66 ? c - 87 : -1;
    if (v < 0) continue;
    if (hi < 0) hi = v;
    else {
      out.push(hi * 16 + v);
      hi = -1;
    }
  }
  if (hi >= 0) out.push(hi * 16);
  return Buffer.from(out);
}

function ascii85(b: Buffer, cap: number): Buffer {
  const out: number[] = [];
  const group: number[] = [];
  const flush = (n: number) => {
    while (group.length < 5) group.push(84);
    let v = 0;
    for (const g of group) v = v * 85 + g;
    const bytes = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    out.push(...bytes.slice(0, n));
    group.length = 0;
  };
  for (const c of b) {
    if (c === 0x7e) break;
    if (isWs(c)) continue;
    if (c === 0x7a && group.length === 0) out.push(0, 0, 0, 0);
    else if (c >= 0x21 && c <= 0x75) {
      group.push(c - 33);
      if (group.length === 5) flush(4);
    } else malformed();
    if (out.length > cap) malformed();
  }
  if (group.length > 1) flush(group.length - 1);
  return Buffer.from(out);
}

/** Decode a chain of supported filters with an output cap; null when a filter is not supported or data is corrupt. */
function decodeChain(data: Buffer, filters: readonly string[], cap: number): Buffer | null {
  let cur = data;
  for (const f of filters) {
    if (f === 'FlateDecode') {
      try {
        cur = inflateSync(cur, { maxOutputLength: cap, finishFlush: constants.Z_SYNC_FLUSH });
      } catch (e) {
        if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE' || e instanceof RangeError) malformed();
        return null;
      }
    } else if (f === 'ASCIIHexDecode') cur = asciiHex(cur);
    else if (f === 'ASCII85Decode') cur = ascii85(cur, cap);
    else return null;
    if (cur.length > cap) malformed();
  }
  return cur;
}

/**
 * Characters in string operands of a content stream (literal strings count decoded characters, hex
 * strings count bytes); inline image data (`ID ... EI`) and comments are skipped. Stops early once
 * `stopAfter` is exceeded.
 */
export function countContentStringChars(c: Uint8Array, stopAfter: number): number {
  let total = 0;
  const n = c.length;
  let i = 0;
  while (i < n && total <= stopAfter) {
    const ch = c[i];
    if (ch === 0x25) {
      while (i < n && c[i] !== 0x0a && c[i] !== 0x0d) i += 1;
    } else if (ch === 0x28) {
      let depth = 1;
      i += 1;
      while (i < n && depth > 0) {
        const x = c[i];
        if (x === 0x5c) {
          const nx = c[i + 1];
          if (nx === 0x0d || nx === 0x0a) {
            i += nx === 0x0d && c[i + 2] === 0x0a ? 3 : 2;
            continue;
          }
          if (nx !== undefined && nx >= 0x30 && nx <= 0x37) {
            let k = 1;
            while (k < 3 && (c[i + 1 + k] ?? 0) >= 0x30 && (c[i + 1 + k] ?? 0) <= 0x37) k += 1;
            i += 1 + k;
          } else i += 2;
          total += 1;
          continue;
        }
        if (x === 0x28) depth += 1;
        else if (x === 0x29) {
          depth -= 1;
          if (depth === 0) break;
        }
        total += 1;
        i += 1;
      }
      i += 1;
    } else if (ch === 0x3c && c[i + 1] === 0x3c) {
      i += 2;
    } else if (ch === 0x3c) {
      let digits = 0;
      i += 1;
      while (i < n && c[i] !== 0x3e) {
        if (!isWs(c[i])) digits += 1;
        i += 1;
      }
      total += Math.ceil(digits / 2);
      i += 1;
    } else if (ch === 0x49 && c[i + 1] === 0x44 && isWs(c[i - 1]) && isWs(c[i + 2])) {
      // Inline image: skip binary data up to a whitespace-delimited EI.
      i += 3;
      while (i < n && !(c[i] === 0x45 && c[i + 1] === 0x49 && isWs(c[i - 1]) && (i + 2 >= n || isWs(c[i + 2])))) i += 1;
      i += 2;
    } else i += 1;
  }
  return total;
}

function checkXrefChain(s: string): void {
  const sx = s.lastIndexOf('startxref');
  if (sx === -1) return;
  const m = /^startxref\s+(\d{1,12})/u.exec(s.slice(sx, sx + 40));
  if (!m?.[1]) return;
  let off = Number(m[1]);
  const seen = new Set<number>();
  while (Number.isSafeInteger(off) && off >= 0 && off < s.length) {
    if (seen.has(off)) malformed();
    seen.add(off);
    if (seen.size > PDF_MAX_XREF_SECTIONS) malformed();
    const head = s.slice(off, off + 64);
    let dict = '';
    if (/^\s*xref\b/u.test(head)) {
      const t = s.indexOf('trailer', off);
      if (t === -1) return;
      dict = dictForward(s, t + 7);
    } else {
      const o = /^\s*\d+\s+\d+\s+obj\b/u.exec(head);
      if (!o) return;
      dict = dictForward(s, off + o[0].length);
    }
    const prev = /\/Prev\s+(\d{1,12})(?!\s+\d+\s+R)/u.exec(dict)?.[1];
    if (prev === undefined) return;
    off = Number(prev);
  }
}

interface StreamInfo {
  dict: string;
  data: Buffer;
}

function* streams(s: string, bytes: Buffer): Generator<StreamInfo> {
  const re = />>\s*stream(\r\n|\n|\r)/gu;
  let count = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    count += 1;
    if (count > PDF_MAX_STREAMS) malformed();
    const dictEnd = m.index + 2;
    const dict = dictBackward(s, dictEnd);
    const start = m.index + m[0].length;
    const len = /\/Length\s+(\d{1,12})(?!\s+\d+\s+R)/u.exec(dict)?.[1];
    let end = -1;
    if (len !== undefined) {
      const e = start + Number(len);
      if (e <= s.length && /^\s*endstream/u.test(s.slice(e, e + 32))) end = e;
    }
    if (end === -1) {
      const k = s.indexOf('endstream', start);
      end = k === -1 ? s.length : k;
    }
    re.lastIndex = Math.max(re.lastIndex, end);
    yield { dict, data: bytes.subarray(start, end) };
  }
}

function addKidsObjects(objText: string, objNum: string, into: Set<string>): void {
  if (/\/Kids\s*\[/u.test(objText)) into.add(objNum);
}

/** Pre-scan; throws ParseRejection (`malformed_pdf` / `text_too_large`) or returns structure counts. */
export function prescanPdf(input: Uint8Array, limits: { pdfPages: number; textChars: number }): PdfPrescan {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const s = bytes.toString('latin1');
  checkXrefChain(s);

  const kidsObjects = new Set<string>();
  // Uncompressed objects: dictionary part only (up to `stream` / `endobj`).
  const objRe = /(\d{1,10})\s+(\d{1,5})\s+obj\b/gu;
  let last: { num: string; at: number } | null = null;
  const flushObj = (until: number) => {
    if (!last) return;
    let body = s.slice(last.at, Math.min(until, last.at + DICT_SCAN_MAX));
    const cut = body.search(/\bstream\b|\bendobj\b/u);
    if (cut !== -1) body = body.slice(0, cut);
    addKidsObjects(body, last.num, kidsObjects);
  };
  for (let m = objRe.exec(s); m; m = objRe.exec(s)) {
    flushObj(m.index);
    last = { num: m[1] ?? '', at: m.index + m[0].length };
  }
  flushObj(s.length);

  let decodedTotal = 0;
  let text = 0;
  let streamCount = 0;
  for (const st of streams(s, bytes)) {
    streamCount += 1;
    const filters = filterChain(st.dict);
    if (filters.length > PDF_MAX_FILTERS) malformed();
    const type = nameValue(st.dict, 'Type');
    const subtype = nameValue(st.dict, 'Subtype');
    const isObjStm = type === 'ObjStm';
    const isContent =
      (type === null && subtype === null && !hasKey(st.dict, 'Length1') && !hasKey(st.dict, 'Length2') && !hasKey(st.dict, 'Length3')) ||
      subtype === 'Form';
    if (!isObjStm && !isContent) continue;
    const cap = Math.min(PDF_MAX_DECODED_STREAM, PDF_MAX_DECODED_TOTAL - decodedTotal);
    const decoded = filters.length === 0 ? st.data : decodeChain(st.data, filters, cap);
    if (!decoded) continue;
    decodedTotal += decoded.length;
    if (decodedTotal > PDF_MAX_DECODED_TOTAL) malformed();
    if (isContent) {
      text += countContentStringChars(decoded, limits.textChars - text);
      if (text > limits.textChars) throw new ParseRejection('text_too_large');
    } else {
      const first = Number(/\/First\s+(\d{1,10})/u.exec(st.dict)?.[1] ?? NaN);
      const count = Number(/\/N\s+(\d{1,10})/u.exec(st.dict)?.[1] ?? NaN);
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(count) || count > OBJSTM_MAX_OBJECTS) continue;
      const body = decoded.toString('latin1');
      const header = body.slice(0, first).trim().split(/\s+/u).map(Number);
      for (let k = 0; k < count; k += 1) {
        const num = header[2 * k];
        const off = header[2 * k + 1];
        if (num === undefined || off === undefined || !Number.isSafeInteger(num) || !Number.isSafeInteger(off)) break;
        const next = header[2 * k + 3];
        const objText = body.slice(first + off, next !== undefined && Number.isSafeInteger(next) ? first + next : body.length);
        addKidsObjects(objText.slice(0, DICT_SCAN_MAX), String(num), kidsObjects);
      }
    }
  }
  if (kidsObjects.size > limits.pdfPages + PDF_PAGE_TREE_SLACK) malformed();
  return { pageTreeNodes: kidsObjects.size, textUpperBound: text, streams: streamCount };
}
