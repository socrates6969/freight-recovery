/**
 * API key units (A12.11): key format and entropy, HMAC-only storage, constant-time comparison (spy on
 * timingSafeEqual, also on the unknown-id dummy path), and pipeline behavior that needs no database:
 * keys in URLs (400), malformed keys (401 without any lookup), unknown URLs (404).
 */
import * as crypto from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:crypto', async (orig) => {
  const real = await orig<typeof crypto>();
  return { ...real, timingSafeEqual: vi.fn(real.timingSafeEqual) };
});

const { generateKey, hashSecret, parseKey, verifySecret } = await import('../src/apikeys/key-material.js');
const { buildApp } = await import('../src/app.js');

const PEPPER = 'unit-pepper-for-api-keys-0123456789abcdef0123456789';

describe('key material', () => {
  it('generates fr_live_<16 hex>_<43 base64url> keys with only the HMAC of the secret retained', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const k = generateKey(PEPPER);
      expect(k.plaintext).toMatch(/^fr_live_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/u);
      expect(k.plaintext.length).toBe(68);
      const parsed = parseKey(k.plaintext);
      expect(parsed?.keyId).toBe(k.keyId);
      expect(k.secretHash).toBe(crypto.createHmac('sha256', PEPPER).update(parsed?.secret ?? '').digest('hex'));
      expect(k.secretHash).not.toContain(parsed?.secret ?? 'x');
      seen.add(k.keyId);
    }
    expect(seen.size).toBe(200);
  });

  it('parses only the exact format', () => {
    expect(parseKey('fr_live_x')).toBeNull();
    expect(parseKey(`fr_live_${'a'.repeat(16)}_${'b'.repeat(43)}\n`)).toBeNull();
    expect(parseKey(`fr_test_${'a'.repeat(16)}_${'b'.repeat(43)}`)).toBeNull();
  });

  it('verifies in constant time, including the dummy path for unknown ids', () => {
    const spy = vi.mocked(crypto.timingSafeEqual);
    spy.mockClear();
    const k = generateKey(PEPPER);
    const secret = parseKey(k.plaintext)?.secret ?? '';
    expect(verifySecret(PEPPER, secret, k.secretHash)).toBe(true);
    expect(verifySecret(PEPPER, `${secret.slice(0, -1)}A`, k.secretHash)).toBe(secret.endsWith('A'));
    expect(verifySecret('other-pepper-0123456789abcdef0123456789abcdef', secret, k.secretHash)).toBe(false);
    // Unknown id: same work against a dummy digest, never true (even for the all-zero digest input).
    expect(verifySecret(PEPPER, secret, null)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(4);
    expect(hashSecret(PEPPER, 'a')).toMatch(/^[0-9a-f]{64}$/u);
  });
});

const ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:1/none',
  JWT_SECRET: 'unit-jwt-secret-0123456789abcdef0123456789abcdef',
  CSRF_SECRET: 'unit-csrf-secret-0123456789abcdef0123456789abcdef',
  REFRESH_PEPPER: 'unit-pepper-0123456789abcdef0123456789abcdef0123',
  MFA_ENC_KEY: Buffer.alloc(32, 3).toString('base64'),
  APP_ORIGIN: 'http://127.0.0.1:8080',
  COOKIE_SECURE: 'false',
  LOG_LEVEL: 'silent',
  REDIS_URL: '',
  RATE_LIMIT_ENABLED: 'true',
  RATE_LIMIT_API_KEY_FAIL_MAX: '3',
};

let app: FastifyInstance | null = null;
afterEach(async () => {
  if (app) await app.close();
  app = null;
});

describe('pipeline (no database)', () => {
  it('refuses any URL containing fr_live_ with 400 before authentication, without echoing it', async () => {
    app = await buildApp(ENV);
    const key = `fr_live_${'a'.repeat(16)}_${'Z'.repeat(43)}`;
    for (const url of [`/api/v1/claims?key=${key}`, `/api/v1/claims/${key}`, '/api/v1/claims?x=fr_live_']) {
      const r = await app.inject({ method: 'GET', url });
      expect([url, r.statusCode]).toEqual([url, 400]);
      expect(r.body).not.toContain('Z'.repeat(43));
    }
  });

  it('malformed keys are 401 without a lookup; the failure budget turns into 429; unknown URLs stay 404', async () => {
    app = await buildApp(ENV);
    const codes = [];
    for (let i = 0; i < 5; i += 1) {
      codes.push((await app.inject({ method: 'GET', url: '/api/v1/claims', headers: { authorization: 'Bearer fr_live_malformed' } })).statusCode);
    }
    expect(codes).toEqual([401, 401, 401, 401, 429]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/nope', headers: { authorization: 'Bearer fr_live_malformed' } })).statusCode).toBe(404);
  });

  it('key requests with a foreign Origin are refused (any method)', async () => {
    app = await buildApp(ENV);
    const r = await app.inject({ method: 'GET', url: '/api/v1/claims', headers: { authorization: 'Bearer fr_live_x', origin: 'https://evil.example' } });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: { code: 'origin_not_allowed' } });
  });
});
