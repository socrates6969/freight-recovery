import { describe, expect, it } from 'vitest';

import { checkCsrf, isValidCsrfSignature, mintCsrfToken } from '../src/security/csrf.js';
import { emailHash, normalizeEmail, openAesGcm, safeEqual, sealAesGcm } from '../src/security/crypto.js';
import { JwtService } from '../src/security/jwt.js';
import { isLocked, lockDurationSeconds, retryAfterSeconds } from '../src/security/lockout.js';
import { PasswordHasher } from '../src/security/password.js';
import { checkPasswordPolicy } from '../src/security/password-policy.js';
import {
  generateRecoveryCode,
  generateRecoveryCodes,
  isRecoveryCodeShape,
  matchTotpStep,
  totpCodeAt,
  totpUri,
} from '../src/security/totp.js';

const SECRET_A = 'unit-test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SECRET_B = 'unit-test-secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('CSRF tokens', () => {
  it('mints signed tokens that verify only with the same secret', () => {
    const t = mintCsrfToken(SECRET_A);
    expect(t).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/u);
    expect(isValidCsrfSignature(SECRET_A, t)).toBe(true);
    expect(isValidCsrfSignature(SECRET_B, t)).toBe(false);
  });
  it('requires cookie == header and a valid signature', () => {
    const t = mintCsrfToken(SECRET_A);
    const other = mintCsrfToken(SECRET_A);
    expect(checkCsrf(SECRET_A, t, t)).toBe(true);
    expect(checkCsrf(SECRET_A, t, other)).toBe(false);
    expect(checkCsrf(SECRET_A, undefined, t)).toBe(false);
    expect(checkCsrf(SECRET_A, t, undefined)).toBe(false);
    const [nonce] = t.split('.');
    const forged = `${nonce}.${'A'.repeat(43)}`;
    expect(checkCsrf(SECRET_A, forged, forged)).toBe(false);
    expect(checkCsrf(SECRET_A, 'x', 'x')).toBe(false);
  });
});

describe('crypto helpers', () => {
  it('AES-256-GCM round-trips and rejects tampering or a wrong AAD', () => {
    const key = Buffer.alloc(32, 7);
    const box = sealAesGcm(key, Buffer.from('JBSWY3DPEHPK3PXP'), 'user-1');
    expect(openAesGcm(key, box, 'user-1').toString()).toBe('JBSWY3DPEHPK3PXP');
    expect(() => openAesGcm(key, box, 'user-2')).toThrow();
    const tampered = { ...box, ciphertext: Buffer.from(box.ciphertext) };
    tampered.ciphertext[0] = (tampered.ciphertext[0] ?? 0) ^ 1;
    expect(() => openAesGcm(key, tampered, 'user-1')).toThrow();
    expect(sealAesGcm(key, Buffer.from('x'), 'a').nonce).not.toEqual(sealAesGcm(key, Buffer.from('x'), 'a').nonce);
  });
  it('normalizes emails and hashes them with a pepper', () => {
    expect(normalizeEmail('  Owner@ACME.test ')).toBe('owner@acme.test');
    expect(emailHash('p', 'Owner@acme.test')).toBe(emailHash('p', 'owner@acme.test '));
    expect(emailHash('p', 'a@b.test')).not.toBe(emailHash('q', 'a@b.test'));
    expect(emailHash('p', 'a@b.test')).toMatch(/^[0-9a-f]{64}$/u);
  });
  it('safeEqual compares exactly', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
  });
});

describe('lockout math', () => {
  const p = { threshold: 5, baseSeconds: 30, maxSeconds: 900 };
  it('locks at the threshold with exponential backoff capped at max', () => {
    expect([0, 1, 4].map((f) => lockDurationSeconds(f, p))).toEqual([0, 0, 0]);
    expect(lockDurationSeconds(5, p)).toBe(30);
    expect(lockDurationSeconds(6, p)).toBe(60);
    expect(lockDurationSeconds(7, p)).toBe(120);
    expect(lockDurationSeconds(9, p)).toBe(480);
    expect(lockDurationSeconds(10, p)).toBe(900);
    expect(lockDurationSeconds(500, p)).toBe(900);
  });
  it('computes Retry-After in whole seconds (at least 1)', () => {
    const now = new Date(1_000_000);
    expect(retryAfterSeconds(new Date(1_000_000 + 29_001), now)).toBe(30);
    expect(retryAfterSeconds(new Date(1_000_000 + 10), now)).toBe(1);
    expect(isLocked(new Date(1_000_001), now)).toBe(true);
    expect(isLocked(new Date(1_000_000), now)).toBe(false);
    expect(isLocked(null, now)).toBe(false);
  });
});

describe('password policy', () => {
  it('enforces length, common passwords, and email local part', () => {
    expect(checkPasswordPolicy('short', 'a@b.test').ok).toBe(false);
    expect(checkPasswordPolicy('x'.repeat(129), 'a@b.test').ok).toBe(false);
    expect(checkPasswordPolicy('Password1234', 'a@b.test')).toEqual({ ok: false, reason: 'common' });
    expect(checkPasswordPolicy('verylongname', 'VeryLongName@acme.test')).toEqual({ ok: false, reason: 'email' });
    expect(checkPasswordPolicy('aaaaaaaaaaaaaa', 'a@b.test')).toEqual({ ok: false, reason: 'repetitive' });
    expect(checkPasswordPolicy('Synthetic-Pass-2026!', 'owner@acme.test')).toEqual({ ok: true });
  });
});

describe('TOTP', () => {
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const now = 1_760_000_000_000;
  it('matches the current step and +-1 window, nothing further', () => {
    const step = Math.floor(now / 30000);
    expect(matchTotpStep(secret, totpCodeAt(secret, now), now)).toBe(step);
    expect(matchTotpStep(secret, totpCodeAt(secret, now - 30000), now)).toBe(step - 1);
    expect(matchTotpStep(secret, totpCodeAt(secret, now + 30000), now)).toBe(step + 1);
    expect(matchTotpStep(secret, totpCodeAt(secret, now - 90000), now)).toBeNull();
  });
  it('rejects malformed codes', () => {
    expect(matchTotpStep(secret, '12345', now)).toBeNull();
    expect(matchTotpStep(secret, 'abcdef', now)).toBeNull();
    expect(matchTotpStep(secret, '1234567', now)).toBeNull();
  });
  it('builds an otpauth URI with issuer and account', () => {
    const uri = totpUri(secret, 'FreightRecovery', 'owner@acme.test');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('issuer=FreightRecovery');
    expect(uri).toContain('secret=');
  });
  it('generates 10 distinct recovery codes of 50 bits in xxxxx-xxxxx form', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(isRecoveryCodeShape(c)).toBe(true);
    expect(generateRecoveryCode()).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/u);
    expect(isRecoveryCodeShape('  ABCDE-FGHJK ')).toBe(true);
    expect(isRecoveryCodeShape('abc')).toBe(false);
  });
});

describe('JWT purposes', () => {
  const jwt = new JwtService(SECRET_A);
  const sub = '11111111-1111-4111-8111-111111111111';
  const sid = '22222222-2222-4222-8222-222222222222';

  it('verifies a token only for its own purpose', async () => {
    const access = await jwt.sign('access', sub, 60, sid);
    expect((await jwt.verify('access', access))?.sid).toBe(sid);
    expect(await jwt.verify('mfa', access)).toBeNull();
    const mfa = await jwt.sign('mfa', sub, 60);
    expect((await jwt.verify('mfa', mfa))?.sub).toBe(sub);
    expect(await jwt.verify('access', mfa)).toBeNull();
    expect(await jwt.verify('mfa_enroll', mfa)).toBeNull();
  });

  it('rejects other keys, alg=none, expired and garbage tokens', async () => {
    const other = new JwtService(SECRET_B);
    expect(await jwt.verify('access', await other.sign('access', sub, 60, sid))).toBeNull();
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'at+jwt' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub, sid, iss: 'freight-recovery-api', aud: 'fr-web', jti: 'x', iat: 1, exp: 9999999999 }),
    ).toString('base64url');
    expect(await jwt.verify('access', `${header}.${payload}.`)).toBeNull();
    expect(await jwt.verify('access', await jwt.sign('access', sub, -10, sid))).toBeNull();
    expect(await jwt.verify('access', 'not.a.token')).toBeNull();
    expect(await jwt.verify('access', '')).toBeNull();
  });
});

describe('argon2id hasher (prebuilt binary works with install scripts disabled)', () => {
  const hasher = new PasswordHasher({ memoryKib: 1024, timeCost: 1 });
  it('hashes, verifies, and does dummy work for unknown users', async () => {
    const h = await hasher.hash('Synthetic-Pass-2026!');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await hasher.verify(h, 'Synthetic-Pass-2026!')).toBe(true);
    expect(await hasher.verify(h, 'wrong-password-xx')).toBe(false);
    expect(await hasher.verify('not-a-hash', 'x')).toBe(false);
    expect(await hasher.verifyDummy('anything')).toBe(false);
    expect(hasher.needsRehash(h)).toBe(false);
    expect(new PasswordHasher({ memoryKib: 2048, timeCost: 1 }).needsRehash(h)).toBe(true);
  });
});
