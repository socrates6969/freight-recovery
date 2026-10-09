/** Unit tests: content sniffing (D1/D3/D4), display-name sanitation and the bounded body reader. */
import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { BodyIdleError, BodyTooLargeError, readLimitedBody } from '../../src/imports/body.js';
import { displayNameFor } from '../../src/imports/display-name.js';
import { lastExtension, sniff } from '../../src/imports/sniff.js';
import { VerifyingStream } from '../../src/imports/service.js';

const enc = (s: string) => new TextEncoder().encode(s);
const bytes = (...b: number[]) => Uint8Array.from(b);

describe('sniff', () => {
  it.each([
    ['a.pdf', enc('%PDF-1.7\n'), { ok: true, detectedType: 'PDF' }],
    ['A.PDF', enc('%PDF-1.7\n'), { ok: true, detectedType: 'PDF' }],
    ['scan.png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0), { ok: true, detectedType: 'PNG' }],
    ['scan.jpeg', bytes(0xff, 0xd8, 0xff, 0xe0), { ok: true, detectedType: 'JPEG' }],
    ['scan.jpg', bytes(0xff, 0xd8, 0xff, 0xe0), { ok: true, detectedType: 'JPEG' }],
    ['inv.csv', enc('a,b\r\n\f1,2\t'), { ok: true, detectedType: 'CSV' }],
    ['inv.txt', enc('\u{feff}Load: 1'), { ok: true, detectedType: 'TXT' }],
    ['x.txt', new Uint8Array(), { ok: false, reason: 'empty_file' }],
    ['x.pdf', enc(' %PDF-1.7'), { ok: false, reason: 'type_mismatch' }],
    ['x.txt', enc('%PDF-1.7'), { ok: false, reason: 'type_mismatch' }],
    ['x.png', bytes(0xff, 0xd8, 0xff), { ok: false, reason: 'type_mismatch' }],
    ['x.docx', enc('PK\u0003\u0004'), { ok: false, reason: 'unsupported_type' }],
    ['x.txt', bytes(0x1f, 0x8b, 8, 0), { ok: false, reason: 'unsupported_type' }],
    ['x.gif', enc('GIF89a'), { ok: false, reason: 'unsupported_type' }],
    ['x.html', enc('hello'), { ok: false, reason: 'unsupported_type' }],
    ['noext', enc('hello'), { ok: false, reason: 'unsupported_type' }],
    ['x.pdf.exe', enc('%PDF-1.4'), { ok: false, reason: 'unsupported_type' }],
    ['x.txt', enc('a\u0000b'), { ok: false, reason: 'binary_content' }],
    ['x.txt', enc('a\u000bb'), { ok: false, reason: 'binary_content' }],
    // SQ2 (leader ruling): DEL 0x7F is binary content too.
    ['x.csv', enc('a,b\n1,\u{7f}'), { ok: false, reason: 'binary_content' }],
    ['x.txt', enc('a\u{1b}b'), { ok: false, reason: 'binary_content' }],
    ['x.csv', enc('\u{feff}\n  <SVG onload=x>'), { ok: false, reason: 'markup_content' }],
    ['x.txt', enc('<?php system($_GET[1]);'), { ok: false, reason: 'markup_content' }],
    ['x.txt', enc('Total: 5 <html> later is fine'), { ok: true, detectedType: 'TXT' }],
  ])('%s', (name, data, expected) => {
    expect(sniff(data, name)).toEqual(expected);
  });

  it('takes the last extension only', () => {
    expect(lastExtension('a.tar.gz')).toBe('.gz');
    expect(lastExtension('README')).toBe('');
  });
});

describe('displayNameFor', () => {
  it.each([
    ['in/vo:ice  "q".txt', 'in_vo_ice _q_.txt'],
    ['a\u0000b\u{202e}c.txt', 'abc.txt'],
    // Controls (incl. tab) are removed before whitespace is collapsed (R43 rejects them anyway).
    ['  spaced\t\tname .pdf ', 'spacedname .pdf'],
    ['  spaced \u{3000} name .pdf ', 'spaced name .pdf'],
    ['', 'unnamed'],
    ['\u{202e}', 'unnamed'],
    ['e\u{301}.txt', '\u{e9}.txt'],
    // Fix round 1 (D1): bidi and other format characters are stripped, not refused.
    ['invoice\u{202e}fdp.txt', 'invoicefdp.txt'],
    ['a\u{202e}txt\u{202c}.txt', 'atxt.txt'],
    ['invoice\u{202e}txt.exe', 'invoicetxt.exe'],
    ['zw\u{200b}\u{200d}\u{feff}\u{2066}j\u{2069}.csv', 'zwj.csv'],
    // Fix round 1 (D2): leading/trailing spaces and dots trimmed.
    ['  .lead and trail.txt  ', 'lead and trail.txt'],
    ['..a.txt', 'a.txt'],
    ['a.txt. . ', 'a.txt'],
    ['...', 'unnamed'],
  ])('%j -> %j', (raw, expected) => {
    expect(displayNameFor(raw)).toBe(expected);
  });

  it('caps at 255 code points and keeps the extension', () => {
    const n = displayNameFor(`${'x'.repeat(400)}.pdf`);
    expect([...n]).toHaveLength(255);
    expect(n.endsWith('.pdf')).toBe(true);
  });
});

describe('readLimitedBody', () => {
  it('reads, hashes and enforces the limit while streaming', async () => {
    const s = new PassThrough();
    const p = readLimitedBody(s, { limit: 10, idleMs: 1000 });
    s.write('hello ');
    s.end('world');
    await expect(p).rejects.toBeInstanceOf(BodyTooLargeError);
    const ok = new PassThrough();
    const q = readLimitedBody(ok, { limit: 100, idleMs: 1000, expectedLength: 3 });
    ok.write('abc');
    ok.end('def');
    const r = await q;
    expect(new TextDecoder().decode(r.bytes)).toBe('abcdef');
    expect(r.sha256).toBe(createHash('sha256').update('abcdef').digest('hex'));
  });

  it('times out when no bytes arrive', async () => {
    const s = new PassThrough();
    await expect(readLimitedBody(s, { limit: 100, idleMs: 30 })).rejects.toBeInstanceOf(BodyIdleError);
  });
});

describe('VerifyingStream (download integrity)', () => {
  const collect = (s: NodeJS.ReadableStream) =>
    new Promise<{ data: string; error: boolean }>((resolve) => {
      let data = '';
      s.on('data', (c: Buffer) => (data += c.toString()));
      s.on('end', () => resolve({ data, error: false }));
      s.on('error', () => resolve({ data, error: true }));
    });

  it('passes matching content through and withholds the last chunk on a mismatch', async () => {
    const good = new VerifyingStream(createHash('sha256').update('abcdef').digest('hex'), () => undefined);
    const pg = collect(good);
    good.write('abc');
    good.end('def');
    expect(await pg).toEqual({ data: 'abcdef', error: false });
    let alerted = false;
    const bad = new VerifyingStream('0'.repeat(64), () => (alerted = true));
    const pb = collect(bad);
    bad.write('abc');
    bad.end('def');
    const r = await pb;
    expect(r.error).toBe(true);
    expect(r.data).toBe('abc');
    expect(alerted).toBe(true);
  });
});
