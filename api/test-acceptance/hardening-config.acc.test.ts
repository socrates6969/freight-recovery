/* eslint-disable */
// REQ-20261012-hardening fix round 1: T10 HP-C05 config refusals for the client-address variables (Part C C11). The
// refusals happen at configuration time, before any database or storage access (Tier L capable). Only `buildApp` is
// imported from application source. Secrets are generated per run and never printed.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, baseEnv } from './helpers/env.js';

const b64 = () => randomBytes(48).toString('base64');
const prod = () => ({
  NODE_ENV: 'production', DATABASE_URL: `${TEST_DATABASE_URL}?sslmode=require`, APP_ORIGIN: 'https://app.example.test',
  JWT_SECRET: b64(), CSRF_SECRET: b64(), REFRESH_PEPPER: b64(), MFA_ENC_KEY: randomBytes(32).toString('base64'), API_KEY_PEPPER: b64(),
  COOKIE_SECURE: 'true', MAIL_TRANSPORT: 'ses', REDIS_URL: 'redis://127.0.0.1:6399/0', ENABLE_DEV_OUTBOX: 'false', RATE_LIMIT_ENABLED: 'true',
  ARGON2_MEMORY_KIB: '19456', LOCKOUT_THRESHOLD: '5', TRUST_PROXY: '', LOG_LEVEL: 'silent',
});
async function rejects(env: Record<string, string>): Promise<Error | null> {
  try {
    const mod: any = await import('../src/app.js');
    const app = await Promise.race([mod.buildApp(env), new Promise((_, rej) => setTimeout(() => rej(new Error('__TIMEOUT__')), 15000))]);
    await (app as any).close?.();
    return null;
  } catch (e) {
    return e as Error;
  }
}
function refusedNaming(e: Error | null, variable: string, secret: string | null, label: string) {
  expect(e, `${label}: start must be refused`).toBeTruthy();
  expect(e!.message, label).not.toBe('__TIMEOUT__');
  expect(e!.message, `${label}: names ${variable}`).toContain(variable);
  if (secret) expect(e!.message.includes(secret), `${label}: value never printed`).toBe(false);
}

describe('HP-C05 config refusals (C11)', () => {
  it('production: CLIENT_IP_HEADER set without ORIGIN_VERIFY_SECRET', async () => {
    refusedNaming(await rejects({ ...prod(), CLIENT_IP_HEADER: 'cloudfront-viewer-address' }), 'ORIGIN_VERIFY_SECRET', null, 'no secret');
  });
  it('set but empty ORIGIN_VERIFY_SECRET is refused in every environment', async () => {
    refusedNaming(await rejects({ ...prod(), CLIENT_IP_HEADER: 'cloudfront-viewer-address', ORIGIN_VERIFY_SECRET: '' }), 'ORIGIN_VERIFY_SECRET', null, 'empty (production)');
    refusedNaming(await rejects(baseEnv({ ORIGIN_VERIFY_SECRET: '' })), 'ORIGIN_VERIFY_SECRET', null, 'empty (test)');
  });
  it('production: a 20-character secret is refused', async () => {
    const s = randomBytes(15).toString('base64'); // 20 characters
    expect(s).toHaveLength(20);
    refusedNaming(await rejects({ ...prod(), CLIENT_IP_HEADER: 'cloudfront-viewer-address', ORIGIN_VERIFY_SECRET: s }), 'ORIGIN_VERIFY_SECRET', s, 'short');
  });
  it('production: a secret equal to JWT_SECRET is refused', async () => {
    const env = prod();
    refusedNaming(await rejects({ ...env, CLIENT_IP_HEADER: 'cloudfront-viewer-address', ORIGIN_VERIFY_SECRET: env.JWT_SECRET }), 'ORIGIN_VERIFY_SECRET', env.JWT_SECRET, 'equals JWT_SECRET');
  });
  it('CLIENT_IP_HEADER=x-forwarded-for is refused (only cloudfront-viewer-address)', async () => {
    refusedNaming(await rejects(baseEnv({ CLIENT_IP_HEADER: 'x-forwarded-for', ORIGIN_VERIFY_SECRET: 'ci-only-origin-verify-test-value-0123456789abcdefABCDEF' })), 'CLIENT_IP_HEADER', null, 'x-forwarded-for (test)');
    refusedNaming(await rejects({ ...prod(), CLIENT_IP_HEADER: 'x-forwarded-for', ORIGIN_VERIFY_SECRET: b64() }), 'CLIENT_IP_HEADER', null, 'x-forwarded-for (production)');
  });
});
