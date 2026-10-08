/**
 * TOTP (RFC 6238): HMAC-SHA1, 6 digits, 30 s step, window +-1. Replay protection is done by the caller:
 * a code is accepted only if its time step is strictly greater than the last accepted step.
 * Recovery codes: 10 per user, `xxxxx-xxxxx`, 50 bits each.
 */
import { randomInt } from 'node:crypto';

import { Secret, TOTP } from 'otpauth';

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;
export const RECOVERY_CODE_COUNT = 10;
const SECRET_BYTES = 20;
const RECOVERY_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // 32 symbols (5 bits each), no l/o/0/1
const RECOVERY_GROUP = 5;

export function generateTotpSecretBase32(): string {
  return new Secret({ size: SECRET_BYTES }).base32;
}

export function totpUri(secretBase32: string, issuer: string, account: string): string {
  return new TOTP({
    issuer,
    label: account,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret: Secret.fromBase32(secretBase32),
  }).toString();
}

/**
 * Validate a code. Returns the absolute time step it matched (for replay protection) or null.
 * Only 6-digit numeric codes are considered.
 */
export function matchTotpStep(secretBase32: string, code: string, nowMs: number = Date.now()): number | null {
  if (!/^\d{6}$/u.test(code)) return null;
  const totp = new TOTP({
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret: Secret.fromBase32(secretBase32),
  });
  const delta = totp.validate({ token: code, timestamp: nowMs, window: TOTP_WINDOW });
  if (delta === null) return null;
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS) + delta;
}

/** Generate a TOTP code for a step (tests and seed tooling). */
export function totpCodeAt(secretBase32: string, nowMs: number): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret: Secret.fromBase32(secretBase32),
  }).generate({ timestamp: nowMs });
}

/** One recovery code: two groups of 5 symbols from a 32-symbol alphabet = 50 bits. */
export function generateRecoveryCode(): string {
  const pick = (): string => {
    let s = '';
    for (let i = 0; i < RECOVERY_GROUP; i += 1) s += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    return s;
  };
  return `${pick()}-${pick()}`;
}

export function generateRecoveryCodes(): string[] {
  const set = new Set<string>();
  while (set.size < RECOVERY_CODE_COUNT) set.add(generateRecoveryCode());
  return [...set];
}

/** Normalize user input of a recovery code (case, surrounding spaces). */
export function normalizeRecoveryCode(input: string): string {
  return input.trim().toLowerCase();
}

export function isRecoveryCodeShape(input: string): boolean {
  return /^[a-z0-9]{5}-[a-z0-9]{5}$/u.test(normalizeRecoveryCode(input));
}
