/**
 * Parse worker entry (A6). Started by spawn.ts with an empty environment under the Node permission
 * model and the preloaded guard. Protocol: stdin = one JSON header line + `\n` + exactly `size` bytes;
 * stdout = one JSON response. Exit codes: 0 response written; 1 any exception (no output); 2 invalid
 * header; 3 more input than declared. Reads no environment variables and no files of its own.
 */
import { exit, stdin, stdout } from 'node:process';

import { parseDocument } from '../parse/pipeline.js';
import type { DetectedType } from '../parse/types.js';

const MAX_HEADER = 4096;
const DETECTED: readonly DetectedType[] = ['PDF', 'PNG', 'JPEG', 'CSV', 'TXT'];

interface Header {
  v: 1;
  filename: string;
  detectedType: DetectedType;
  limits: { pdfPages: number; textChars: number; imagePixels: number };
  threshold: number;
  size: number;
}

function posInt(v: unknown, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
}

function parseHeader(line: string): Header | null {
  let h: unknown;
  try {
    h = JSON.parse(line);
  } catch {
    return null;
  }
  const o = h as Partial<Header> | null;
  const l = o?.limits;
  if (
    o?.v !== 1 ||
    typeof o.filename !== 'string' ||
    o.filename.length > 1024 ||
    !DETECTED.includes(o.detectedType as DetectedType) ||
    typeof o.threshold !== 'number' ||
    o.threshold < 0.5 ||
    o.threshold > 1 ||
    !posInt(o.size, 64 * 1024 * 1024) ||
    !l ||
    !posInt(l.pdfPages, 100_000) ||
    !posInt(l.textChars, 50_000_000) ||
    !posInt(l.imagePixels, 4_000_000_000)
  ) {
    return null;
  }
  return o as Header;
}

async function readInput(): Promise<{ header: Header; body: Uint8Array } | number> {
  let headerBuf = Buffer.alloc(0);
  let header: Header | null = null;
  let body: Buffer | null = null;
  let filled = 0;
  for await (const chunk of stdin) {
    let c = chunk as Buffer;
    if (!header) {
      headerBuf = Buffer.concat([headerBuf, c]);
      const nl = headerBuf.indexOf(0x0a);
      if (nl === -1) {
        if (headerBuf.length > MAX_HEADER) return 2;
        continue;
      }
      header = parseHeader(headerBuf.subarray(0, nl).toString('utf8'));
      if (!header) return 2;
      body = Buffer.alloc(header.size);
      c = headerBuf.subarray(nl + 1);
    }
    if (!body) return 2;
    if (filled + c.length > body.length) return 3;
    c.copy(body, filled);
    filled += c.length;
  }
  if (!header || !body || filled !== body.length) return 2;
  return { header, body };
}

async function main(): Promise<number> {
  const input = await readInput();
  if (typeof input === 'number') return input;
  const { header, body } = input;
  const result = await parseDocument({
    bytes: body,
    filename: header.filename,
    detectedType: header.detectedType,
    limits: header.limits,
    threshold: header.threshold,
  });
  const payload = JSON.stringify(result.ok ? { ok: true, result } : { ok: false, reason: result.reason });
  await new Promise<void>((resolve, reject) => {
    stdout.write(payload, (err) => (err ? reject(err) : resolve()));
  });
  return 0;
}

main().then(
  (code) => exit(code),
  () => exit(1),
);
