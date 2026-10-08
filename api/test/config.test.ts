import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ConfigError, DOCUMENTED_DEV_SECRETS, loadConfig, secretEntropyProblem } from '../src/config.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const base = {
  DATABASE_URL: 'postgresql://freight_app:x@127.0.0.1:5433/freight_web_test',
  JWT_SECRET: 'j'.repeat(48),
  CSRF_SECRET: 'c'.repeat(48),
  REFRESH_PEPPER: 'r'.repeat(48),
  MFA_ENC_KEY: Buffer.alloc(32, 9).toString('base64'),
  APP_ORIGIN: 'http://127.0.0.1:8080',
};

const prodOk = {
  ...base,
  NODE_ENV: 'production',
  JWT_SECRET: 'Qm9vZ3Vz-prod-like-7f3a9c1e5b2d8f4a6c0e9b7d5f3a1c8e2b4d6f0a',
  CSRF_SECRET: 'Zx81Lq0v-prod-like-c4e6a8f0b2d4c6e8a0b2c4d6e8f0a1b3c5d7e9f1',
  REFRESH_PEPPER: 'Mn5Kp2Ws-prod-like-9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d',
  MFA_ENC_KEY: Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256)).toString('base64'),
  DATABASE_URL: 'postgresql://freight_app:x@db.internal:5432/freight_web?sslmode=require',
  APP_ORIGIN: 'https://app.example.com',
  REDIS_URL: 'rediss://cache.internal:6379',
  MAIL_TRANSPORT: 'ses',
};

function problems(env: Record<string, string>): string[] {
  try {
    loadConfig(env);
    return [];
  } catch (e) {
    if (e instanceof ConfigError) return [...e.problems];
    throw e;
  }
}

describe('config', () => {
  it('accepts a minimal dev config with defaults', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'development', COOKIE_SECURE: 'false' });
    expect(c.port).toBe(3001);
    expect(c.lockoutThreshold).toBe(5);
    expect(c.accessTokenTtlSeconds).toBe(600);
    expect(c.hstsMaxAgeSeconds).toBe(0);
    expect(c.cookieSecure).toBe(false);
    expect(c.mailTransport).toBe('outbox');
  });

  it('defaults NODE_ENV to production (fail safe)', () => {
    expect(problems(base).some((p) => p.includes('production'))).toBe(true);
  });

  it('requires secrets and rejects short ones', () => {
    expect(problems({ ...base, NODE_ENV: 'test', JWT_SECRET: '' })).toContain('JWT_SECRET is required');
    expect(problems({ ...base, NODE_ENV: 'test', CSRF_SECRET: 'short' }).some((p) => p.startsWith('CSRF_SECRET must be at least'))).toBe(true);
    expect(problems({ ...base, NODE_ENV: 'test', MFA_ENC_KEY: Buffer.alloc(16).toString('base64') })).toContain(
      'MFA_ENC_KEY must decode to 32 bytes',
    );
  });

  it('accepts a hardened production config', () => {
    const c = loadConfig(prodOk);
    expect(c.nodeEnv).toBe('production');
    expect(c.hstsMaxAgeSeconds).toBe(31536000);
    expect(c.cookieSecure).toBe(true);
  });

  it('enforces every production guard without echoing secret values', () => {
    const cases: [Record<string, string>, string][] = [
      [{ JWT_SECRET: DOCUMENTED_DEV_SECRETS[0] ?? '' }, 'JWT_SECRET must not be a documented dev default'],
      [{ COOKIE_SECURE: 'false' }, 'COOKIE_SECURE=false is not allowed in production'],
      [{ APP_ORIGIN: 'http://app.example.com' }, 'APP_ORIGIN must use https in production'],
      [{ ENABLE_DEV_OUTBOX: 'true' }, 'ENABLE_DEV_OUTBOX=true is not allowed in production'],
      [{ MAIL_TRANSPORT: 'outbox' }, 'MAIL_TRANSPORT=outbox is not allowed in production (no real mail transport is implemented yet)'],
      [{ REDIS_URL: '' }, 'REDIS_URL is required in production'],
      [{ DATABASE_URL: 'postgresql://u:p@h/db' }, 'DATABASE_URL must set sslmode=require or sslmode=verify-full in production'],
      [{ ARGON2_MEMORY_KIB: '8' }, 'ARGON2_MEMORY_KIB is below its production floor (19456)'],
      [{ LOCKOUT_BASE_SECONDS: '1' }, 'LOCKOUT_BASE_SECONDS is below its production floor (30)'],
      [{ RATE_LIMIT_ENABLED: 'false' }, 'RATE_LIMIT_ENABLED=false is not allowed in production'],
      [{ TRUST_PROXY: '*' }, 'TRUST_PROXY must list CIDRs (wildcards are refused)'],
    ];
    for (const [override, expected] of cases) {
      const ps = problems({ ...prodOk, ...override });
      expect(ps).toContain(expected);
    }
    try {
      loadConfig({ ...prodOk, JWT_SECRET: DOCUMENTED_DEV_SECRETS[0] ?? '' });
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(DOCUMENTED_DEV_SECRETS[0]);
    }
  });

  it('rejects every placeholder secret from .env.example in production (and anywhere)', () => {
    const example = readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
    const values: Record<string, string> = {};
    for (const line of example.split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());
      if (m?.[1] && m[2] !== undefined) values[m[1]] = m[2];
    }
    const secrets = ['JWT_SECRET', 'CSRF_SECRET', 'REFRESH_PEPPER', 'MFA_ENC_KEY'] as const;
    for (const k of secrets) expect(values[k], k).toBeTruthy();
    for (const nodeEnv of ['production', 'development']) {
      const env = { ...prodOk, NODE_ENV: nodeEnv, COOKIE_SECURE: 'true' };
      for (const k of secrets) env[k] = values[k] ?? '';
      const ps = problems(env);
      for (const k of secrets) expect([nodeEnv, k, ps.some((p) => p.startsWith(`${k} looks like a placeholder`))]).toEqual([nodeEnv, k, true]);
      expect(ps.join(' ')).not.toContain(values['JWT_SECRET']);
    }
  });

  it('accepts 1000 random hex-64 and 1000 random base64-48 secrets (no false rejects)', () => {
    for (let i = 0; i < 1000; i += 1) {
      const hex = randomBytes(32).toString('hex');
      const b64 = randomBytes(48).toString('base64');
      const b64of32 = randomBytes(32).toString('base64');
      expect([hex, secretEntropyProblem(hex)]).toEqual([hex, null]);
      expect([b64, secretEntropyProblem(b64)]).toEqual([b64, null]);
      expect([b64of32, secretEntropyProblem(b64of32)]).toEqual([b64of32, null]);
    }
    // and through the production config path
    const env = { ...prodOk, JWT_SECRET: randomBytes(32).toString('hex'), CSRF_SECRET: randomBytes(32).toString('hex'), REFRESH_PEPPER: randomBytes(48).toString('base64') };
    expect(problems(env)).toEqual([]);
  });

  it('rejects low-entropy, repeated and short secrets in production only', () => {
    const cases: [string, string][] = [
      ['a'.repeat(64), 'is a repeated pattern'],
      ['ab'.repeat(32), 'is a repeated pattern'],
      ['0123456789abcdef'.repeat(4), 'is a repeated pattern'],
      ['Synthetic-Pass-2026!'.repeat(3), 'is a repeated pattern'],
      ['0a1b2c3d4e5f6789abcdef0123456798', 'is too short for its alphabet'],
      ['deadbeef'.repeat(5) + '0', 'uses too few distinct characters'],
      ['0'.repeat(40) + '0123456789abcdefABCDEFGH', 'is dominated by one character'],
      ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab', 'uses too few distinct characters'],
    ];
    for (const [secret, reason] of cases) {
      expect([secret, secretEntropyProblem(secret)]).toEqual([secret, reason]);
      expect(problems({ ...prodOk, JWT_SECRET: secret })).toContain(`JWT_SECRET ${reason} to be a random secret`);
    }
    expect(problems({ ...base, NODE_ENV: 'test', JWT_SECRET: 'ab'.repeat(30) })).toEqual([]);
  });

  it('allows low tuning knobs outside production only', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'test', LOCKOUT_BASE_SECONDS: '1', ARGON2_MEMORY_KIB: '8', ACCESS_TOKEN_TTL_SECONDS: '2' });
    expect(c.lockoutBaseSeconds).toBe(1);
    expect(c.argon2MemoryKib).toBe(8);
    expect(c.accessTokenTtlSeconds).toBe(2);
  });

  it('validates TRUST_PROXY CIDRs and APP_ORIGIN shape', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'test', TRUST_PROXY: '10.0.0.0/8, 127.0.0.1' }).trustProxy).toEqual(['10.0.0.0/8', '127.0.0.1']);
    expect(problems({ ...base, NODE_ENV: 'test', TRUST_PROXY: '10.0.0.0/99' })).toContain('TRUST_PROXY contains an invalid CIDR');
    expect(problems({ ...base, NODE_ENV: 'test', APP_ORIGIN: 'http://x.test/path' })).toContain(
      'APP_ORIGIN must be an exact origin like https://app.example.com',
    );
  });

  it('documented dev secrets are long enough to be used in dev', () => {
    for (const s of DOCUMENTED_DEV_SECRETS) expect(s.length).toBeGreaterThanOrEqual(43);
  });
});
