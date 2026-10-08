/** Small, audited crypto helpers. All comparisons of secrets are constant-time. */
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

export const OPAQUE_TOKEN_BYTES = 32;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hmacSha256Hex(key: string | Buffer, data: string): string {
  return createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

export function hmacSha256B64url(key: string | Buffer, data: string | Buffer): string {
  return createHmac('sha256', key).update(data).digest('base64url');
}

/** 32 random bytes, base64url (refresh, reset and invite tokens). */
export function randomOpaqueToken(): string {
  return randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url');
}

/** Constant-time string equality (length leak only). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** HKDF-SHA256 per-purpose key derivation (key separation). */
export function deriveKey(ikm: string | Buffer, info: string, length = 32): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', ikm, Buffer.from('freight-recovery-api', 'utf8'), info, length));
}

export interface SealedBox {
  ciphertext: Buffer;
  nonce: Buffer;
}

/** AES-256-GCM with a random 96-bit nonce; AAD binds the ciphertext to its owner (e.g. user id). */
export function sealAesGcm(key: Buffer, plaintext: Buffer, aad: string): SealedBox {
  if (key.length !== 32) throw new Error('AES-256-GCM key must be 32 bytes');
  const nonce = randomBytes(GCM_NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: GCM_TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext: Buffer.concat([body, cipher.getAuthTag()]), nonce };
}

export function openAesGcm(key: Buffer, box: SealedBox, aad: string): Buffer {
  if (key.length !== 32) throw new Error('AES-256-GCM key must be 32 bytes');
  if (box.nonce.length !== GCM_NONCE_BYTES || box.ciphertext.length < GCM_TAG_BYTES) throw new Error('sealed box malformed');
  const tag = box.ciphertext.subarray(box.ciphertext.length - GCM_TAG_BYTES);
  const body = box.ciphertext.subarray(0, box.ciphertext.length - GCM_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, box.nonce, { authTagLength: GCM_TAG_BYTES });
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/** Normalize an email for identity purposes: trim, NFKC, lowercase. */
export function normalizeEmail(email: string): string {
  return email.trim().normalize('NFKC').toLowerCase();
}

/** Keyed hash of a normalized email (lockout key; logged/audited instead of the address). */
export function emailHash(pepper: string, email: string): string {
  return hmacSha256Hex(pepper, normalizeEmail(email));
}

/** Short prefix of an email hash, safe for log lines. */
export function emailHashPrefix(hash: string): string {
  return hash.slice(0, 12);
}
