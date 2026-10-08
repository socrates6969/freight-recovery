import { describe, expect, it } from 'vitest';

import { ConfigError, DOCUMENTED_DEV_SECRETS, loadConfig } from '../src/config.js';

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
