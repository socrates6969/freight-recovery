/**
 * CSRF tokens (A8): `<nonce_b64url(16 bytes)>.<HMAC-SHA256(CSRF_SECRET, nonce) b64url>`.
 * Double-submit: the cookie `fr_csrf` and header `X-CSRF-Token` must be equal (constant time) AND the
 * token must carry a valid signature. Not bound to a session so login CSRF is blocked as well.
 */
import { randomBytes } from 'node:crypto';

import { hmacSha256B64url, safeEqual } from './crypto.js';

const NONCE_BYTES = 16;
const TOKEN_RE = /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/u;

export function mintCsrfToken(secret: string): string {
  const nonce = randomBytes(NONCE_BYTES).toString('base64url');
  return `${nonce}.${hmacSha256B64url(secret, nonce)}`;
}

export function isValidCsrfSignature(secret: string, token: string): boolean {
  if (!TOKEN_RE.test(token)) return false;
  const dot = token.indexOf('.');
  const nonce = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  return safeEqual(sig, hmacSha256B64url(secret, nonce));
}

/** Full double-submit check. */
export function checkCsrf(secret: string, cookieValue: string | undefined, headerValue: string | undefined): boolean {
  if (!cookieValue || !headerValue) return false;
  if (!safeEqual(cookieValue, headerValue)) return false;
  return isValidCsrfSignature(secret, headerValue);
}
