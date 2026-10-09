/**
 * Tenant API key material (Q13). Format `fr_live_<keyId>_<secret>`: keyId = 8 random bytes as lowercase
 * hex (public identifier), secret = 32 random bytes as base64url (43 chars, 256 bits). Only
 * HMAC-SHA-256(pepper, secret) is stored (a 256-bit random secret needs no slow KDF; lookup is O(1) by
 * keyId). Verification compares digests with timingSafeEqual; an unknown keyId is checked against a fixed
 * dummy digest so that timing does not reveal whether a key exists.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { API_KEY_FORMAT_RE } from '@fr/shared';

export const KEY_PREFIX = 'fr_live_';

export interface GeneratedKey {
  keyId: string;
  /** The full key string, returned exactly once (R80 response). */
  plaintext: string;
  secretHash: string;
}

export function hashSecret(pepper: string, secret: string): string {
  return createHmac('sha256', pepper).update(secret, 'utf8').digest('hex');
}

export function generateKey(pepper: string): GeneratedKey {
  const keyId = randomBytes(8).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  return { keyId, plaintext: `${KEY_PREFIX}${keyId}_${secret}`, secretHash: hashSecret(pepper, secret) };
}

/** Split a presented key; null when it does not match the exact format. */
export function parseKey(presented: string): { keyId: string; secret: string } | null {
  if (!API_KEY_FORMAT_RE.test(presented)) return null;
  return { keyId: presented.slice(8, 24), secret: presented.slice(25) };
}

/** A fixed digest compared against when the key id is unknown or the key is malformed. */
const DUMMY_HASH = '0'.repeat(64);

/**
 * Constant-time check of a presented secret against a stored hash (or the dummy when `stored` is null).
 * Always performs one HMAC and one timingSafeEqual.
 */
export function verifySecret(pepper: string, secret: string, stored: string | null): boolean {
  const presented = Buffer.from(hashSecret(pepper, secret), 'hex');
  const expected = Buffer.from(stored !== null && /^[0-9a-f]{64}$/u.test(stored) ? stored : DUMMY_HASH, 'hex');
  const equal = timingSafeEqual(presented, expected);
  return stored !== null && equal;
}
