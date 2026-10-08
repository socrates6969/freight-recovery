/* eslint-disable */
// Independent RFC 6238 TOTP + base32 (test-owned; never imports application crypto).
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHA.indexOf(ch);
    if (idx < 0) throw new Error('bad base32 char');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(secretB32: string, counter: number, digits = 6): string {
  const key = base32Decode(secretB32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(buf).digest();
  const off = h[h.length - 1]! & 0xf;
  const code =
    ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(code % 10 ** digits).padStart(digits, '0');
}

export const STEP = 30;
export function stepNow(offsetSteps = 0, nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / STEP) + offsetSteps;
}
export function totp(secretB32: string, offsetSteps = 0, nowMs = Date.now()): string {
  return hotp(secretB32, stepNow(offsetSteps, nowMs));
}

// Cross-process registry of (secret,step) pairs this run has already submitted, so successive
// logins do not trip the server's (correct) replay protection.
const REG = join(tmpdir(), 'fr-acc-totp-used.json');
function load(): Record<string, number> {
  try {
    return existsSync(REG) ? JSON.parse(readFileSync(REG, 'utf8')) : {};
  } catch {
    return {};
  }
}
function save(r: Record<string, number>): void {
  try {
    writeFileSync(REG, JSON.stringify(r));
  } catch {
    /* ignore */
  }
}
/** First not-yet-submitted step within the +-1 window for this secret. */
export function claimFreshCode(secretB32: string, who = ''): { code: string; step: number } | null {
  const reg = load();
  const now = Date.now();
  for (const off of [0, 1, -1]) {
    const step = stepNow(off, now);
    const key = `${who}|${secretB32}:${step}`;
    if (!reg[key]) {
      reg[key] = now;
      save(reg);
      return { code: hotp(secretB32, step), step };
    }
  }
  return null;
}
export async function freshCode(secretB32: string, who = ''): Promise<string> {
  for (let i = 0; i < 4; i++) {
    const c = claimFreshCode(secretB32, who);
    if (c) return c.code;
    const waitMs = STEP * 1000 - (Date.now() % (STEP * 1000)) + 200;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  throw new Error('could not obtain a fresh TOTP code');
}
/** Mark a step as consumed by a test that submitted it by hand. */
export function markUsed(secretB32: string, step: number): void {
  const reg = load();
  reg[`${secretB32}:${step}`] = Date.now();
  save(reg);
}