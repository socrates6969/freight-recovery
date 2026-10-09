import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ConfigError,
  DEFAULT_RUNTIME,
  DEV_API_KEY_PEPPER,
  DOCUMENTED_DEV_SECRETS,
  DOMINANCE_FALSE_REJECT_BOUND,
  PRODUCTION_MAIL_TRANSPORTS,
  dominanceRejectCount,
  dominanceTailBound,
  loadConfig,
  secretEntropyProblem,
} from '../src/config.js';

const SES_PROBLEM = 'MAIL_TRANSPORT=ses is not implemented (stub); production start is refused until a real mail transport exists';

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
  // Step 3: SSE-KMS key and an existing worker entry (any existing file satisfies the existence check).
  S3_KMS_KEY_ID: 'arn:aws:kms:us-east-1:111122223333:key/00000000-0000-4000-8000-000000000000',
  PARSE_WORKER_ENTRY: fileURLToPath(import.meta.url),
  // Step 4: a production-like API key pepper (random-looking, 64 hex = 256 bits).
  API_KEY_PEPPER: '3f9a1c7e5b2d8a4f6c0e9b7d5f3a1c8e2b4d6f0a9c7e5b3d1f8a6c4e2b0d9f7a',
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

  it('refuses to start production with any mail transport until a real one is implemented', () => {
    expect(PRODUCTION_MAIL_TRANSPORTS).toEqual([]);
    // A fully hardened production config fails on exactly one thing: the unimplemented mail transport.
    expect(problems(prodOk)).toEqual([SES_PROBLEM]);
    expect(() => loadConfig(prodOk)).toThrow(ConfigError);
    expect(problems({ ...prodOk, MAIL_TRANSPORT: 'outbox' })).toEqual([
      'MAIL_TRANSPORT=outbox is not allowed in production (no real mail transport is implemented yet)',
    ]);
    expect(problems({ ...prodOk, MAIL_TRANSPORT: 'smtp' })).toContain('MAIL_TRANSPORT must be outbox or ses');
    // Outside production the stub may be selected (forgot-password still answers 202; invites 503).
    expect(loadConfig({ ...base, NODE_ENV: 'test', MAIL_TRANSPORT: 'ses' }).mailTransport).toBe('ses');
  });

  it('hardened production config is otherwise valid (HSTS, secure cookies)', () => {
    const c = loadConfig({ ...prodOk, NODE_ENV: 'development', APP_ORIGIN: 'https://app.example.com' });
    expect(c.cookieSecure).toBe(true);
    expect(loadConfig({ ...prodOk, NODE_ENV: 'development' }).hstsMaxAgeSeconds).toBe(0);
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
    expect(problems(env)).toEqual([SES_PROBLEM]);
  });

  it('accepts a seeded deterministic set of 1000 hex-64, base64-48, base64-32 and base64url-32 secrets', () => {
    // Deterministic byte stream: SHA-256 in counter mode over a fixed seed (same bytes on every run).
    const seeded = (label: string, i: number, bytes: number): Buffer => {
      const out: Buffer[] = [];
      for (let block = 0; out.length * 32 < bytes; block += 1) out.push(createHash('sha256').update(`fr-secret-seed:${label}:${i}:${block}`).digest());
      return Buffer.concat(out).subarray(0, bytes);
    };
    for (let i = 0; i < 1000; i += 1) {
      for (const s of [
        seeded('hex', i, 32).toString('hex'),
        seeded('b64-48', i, 48).toString('base64'),
        seeded('b64-32', i, 32).toString('base64'),
        seeded('b64url-32', i, 32).toString('base64url'),
      ]) {
        expect([s, secretEntropyProblem(s)]).toEqual([s, null]);
      }
    }
  });

  it('dominance rule: alphabet- and length-aware threshold with false-reject bound < 1e-12', () => {
    // Independent exact binomial tail (rational recurrence in doubles) for the four standard encodings.
    const tail = (n: number, a: number, k: number) => {
      const p = 1 / a;
      let pmf = (1 - p) ** n;
      let sum = 0;
      for (let j = 0; j <= n; j += 1) {
        if (j >= k) sum += pmf;
        pmf = (pmf * (n - j) * p) / ((j + 1) * (1 - p));
      }
      return a * sum;
    };
    const cases: [string, number, number, number][] = [
      ['hex-64', 64, 16, 25],
      ['hex-40', 40, 16, 20],
      ['base64-48 (64 chars)', 64, 64, 16],
      ['base64-32 / base64url-32 (43 chars)', 43, 64, 14],
    ];
    for (const [name, n, a, k] of cases) {
      expect([name, dominanceRejectCount(n, a)]).toEqual([name, k]);
      expect([name, tail(n, a, k) < DOMINANCE_FALSE_REJECT_BOUND]).toEqual([name, true]);
      expect([name, tail(n, a, k - 1) >= DOMINANCE_FALSE_REJECT_BOUND]).toEqual([name, true]);
      expect(Math.abs(dominanceTailBound(n, a, k) - tail(n, a, k)) / tail(n, a, k)).toBeLessThan(1e-9);
    }
    expect(dominanceTailBound(64, 16, 0)).toBe(16);
    expect(dominanceTailBound(64, 16, 65)).toBe(0);
    expect(dominanceRejectCount(10_000, 16)).toBeGreaterThan(625);
    // Boundary: 24 of one hex character among 64 is accepted, 25 refused (other chars varied, aperiodic).
    const filler = '0123456789abcde';
    const mk = (count: number) => 'f'.repeat(count) + Array.from({ length: 64 - count }, (_, i) => filler[(i * 7) % filler.length]).join('');
    expect(secretEntropyProblem(mk(24))).toBeNull();
    expect(secretEntropyProblem(mk(25))).toBe('is dominated by one character');
  });

  it('rejects low-entropy, repeated and short secrets in production only', () => {
    const cases: [string, string][] = [
      ['a'.repeat(64), 'is a repeated pattern'],
      ['ab'.repeat(32), 'is a repeated pattern'],
      ['0123456789abcdef'.repeat(4), 'is a repeated pattern'],
      ['0123456789'.repeat(7), 'is a repeated pattern'],
      ['changeme'.repeat(8), 'is a repeated pattern'],
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

describe('config: step 3 import/export knobs (N3)', () => {
  it('has the documented defaults', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'test' });
    expect(c.imports).toMatchObject({
      maxFileBytes: 10485760,
      maxFilesPerBatch: 10,
      tenantStorageQuotaBytes: 1073741824,
      uploadRequestTimeoutSeconds: 60,
      uploadIdleTimeoutSeconds: 10,
      uploadMaxConcurrentPerTenant: 4,
      parseTimeoutMs: 20000,
      parseMemoryMb: 256,
      parseMaxConcurrency: 2,
      parseQueueTimeoutMs: 5000,
      parseMaxOutputBytes: 25165824,
      parseMaxPdfPages: 50,
      parseMaxTextChars: 2000000,
      parseMaxImagePixels: 50000000,
      reviewConfidenceThreshold: 0.9,
      exportMaxRows: 50000,
      exportMaxConcurrentPerTenant: 2,
      rateLimitUploadMax: 60,
      rateLimitExportMax: 10,
      staleSeconds: 600,
    });
    expect(c.s3.sse).toBe('aws:kms');
    expect(c.imports.workerEntry.replaceAll('\\', '/')).toMatch(/api\/dist\/src\/imports\/sandbox\/worker-main\.js$/u);
  });

  it('accepts small limits outside production (tests)', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'test', PARSE_TIMEOUT_MS: '200', PARSE_MEMORY_MB: '32', IMPORT_MAX_FILE_BYTES: '100', S3_SSE: 'none' });
    expect([c.imports.parseTimeoutMs, c.imports.parseMemoryMb, c.imports.maxFileBytes, c.s3.sse]).toEqual([200, 32, 100, 'none']);
  });

  it.each([
    [{ S3_SSE: 'none' }, 'S3_SSE must be aws:kms in production'],
    [{ S3_KMS_KEY_ID: '' }, 'S3_KMS_KEY_ID is required in production'],
    [{ PARSE_TIMEOUT_MS: '999' }, 'PARSE_TIMEOUT_MS is below its production floor (1000)'],
    [{ PARSE_TIMEOUT_MS: '60001' }, 'PARSE_TIMEOUT_MS is above its production ceiling (60000)'],
    [{ PARSE_MEMORY_MB: '63' }, 'PARSE_MEMORY_MB is below its production floor (64)'],
    [{ PARSE_MEMORY_MB: '1025' }, 'PARSE_MEMORY_MB is above its production ceiling (1024)'],
    [{ UPLOAD_REQUEST_TIMEOUT_SECONDS: '121' }, 'UPLOAD_REQUEST_TIMEOUT_SECONDS is above its production ceiling (120)'],
    [{ UPLOAD_IDLE_TIMEOUT_SECONDS: '31' }, 'UPLOAD_IDLE_TIMEOUT_SECONDS is above its production ceiling (30)'],
    [{ PARSE_WORKER_ENTRY: '/nonexistent/worker-main.js' }, 'PARSE_WORKER_ENTRY does not exist (build the API first)'],
  ])('production guard %j', (override, expected) => {
    expect(problems({ ...prodOk, ...override })).toContain(expected);
  });

  it('rejects out-of-range values in every environment', () => {
    expect(problems({ ...base, NODE_ENV: 'test', IMPORT_MAX_FILE_BYTES: '26214401' })).toContain('IMPORT_MAX_FILE_BYTES must be between 1 and 26214400');
    expect(problems({ ...base, NODE_ENV: 'test', PARSE_MAX_TEXT_CHARS: '5000001' })).toContain('PARSE_MAX_TEXT_CHARS must be between 1 and 5000000');
    expect(problems({ ...base, NODE_ENV: 'test', EXPORT_MAX_ROWS: '200001' })).toContain('EXPORT_MAX_ROWS must be between 1 and 200000');
    expect(problems({ ...base, NODE_ENV: 'test', S3_SSE: 'AES256' })).toContain('S3_SSE must be aws:kms or none');
    for (const bad of ['0.49', '1.01', 'abc', '0.9.1', '-1']) {
      expect([bad, problems({ ...base, NODE_ENV: 'test', REVIEW_CONFIDENCE_THRESHOLD: bad })]).toEqual([
        bad,
        ['REVIEW_CONFIDENCE_THRESHOLD must be a decimal between 0.50 and 1.00'],
      ]);
    }
    expect(loadConfig({ ...base, NODE_ENV: 'test', REVIEW_CONFIDENCE_THRESHOLD: '0.5' }).imports.reviewConfidenceThreshold).toBe(0.5);
    expect(loadConfig({ ...base, NODE_ENV: 'test', REVIEW_CONFIDENCE_THRESHOLD: '1.00' }).imports.reviewConfidenceThreshold).toBe(1);
  });

  it('refuses production without the Node permission model', () => {
    const ps = (() => {
      try {
        loadConfig(prodOk, { permissionFlagAvailable: false, moduleHooksAvailable: true, fileExists: () => true });
        return [];
      } catch (e) {
        return e instanceof ConfigError ? [...e.problems] : [];
      }
    })();
    expect(ps).toContain('Node permission model (--permission) is required in production for the parse sandbox');
  });

  it('fix round 2 (F-03): refuses to start, in every environment, on a Node without module.registerHooks', () => {
    const NEED = 'Node.js >= 22.15.0 is required (module.registerHooks, used by the parse sandbox guard)';
    for (const env of [prodOk, { ...prodOk, NODE_ENV: 'development' }, { ...prodOk, NODE_ENV: 'test' }]) {
      let ps: string[] = [];
      try {
        loadConfig(env, { permissionFlagAvailable: true, moduleHooksAvailable: false, fileExists: () => true });
      } catch (e) {
        ps = e instanceof ConfigError ? [...e.problems] : [];
      }
      expect([env.NODE_ENV, ps]).toEqual([env.NODE_ENV, expect.arrayContaining([NEED])]);
    }
    expect(DEFAULT_RUNTIME.moduleHooksAvailable).toBe(true);
  });

  describe('step 4 knobs (Q9, Q13)', () => {
    const dev = { ...base, NODE_ENV: 'development', COOKIE_SECURE: 'false' };
    it('defaults', () => {
      const c = loadConfig(dev);
      expect(c.observability.logBufferSize).toBe(500);
      expect(c.flags.cacheTtlMs).toBe(5000);
      expect(c.intelligence).toEqual({ pendingWeightPercent: 25, similarCandidateLimit: 500 });
      expect(c.rateLimitPlatformMax).toBe(120);
      expect(c.rateLimitIntelligenceMax).toBe(120);
      expect(c.apiKeys).toMatchObject({ maxActive: 20, defaultTtlDays: 90, allowNonExpiring: true, rateLimitMax: 300, rateLimitFailMax: 30 });
      expect(c.apiKeys.pepper).toBe(DEV_API_KEY_PEPPER);
    });
    it('range checks', () => {
      for (const [k, v] of [
        ['LOG_BUFFER_SIZE', '49'],
        ['LOG_BUFFER_SIZE', '5001'],
        ['FLAGS_CACHE_TTL_MS', '60001'],
        ['INTELLIGENCE_PENDING_WEIGHT_PERCENT', '101'],
        ['INTELLIGENCE_PENDING_WEIGHT_PERCENT', '2.5'],
        ['SIMILAR_CANDIDATE_LIMIT', '9'],
        ['SIMILAR_CANDIDATE_LIMIT', '2001'],
        ['API_KEY_MAX_ACTIVE', '201'],
        ['API_KEY_DEFAULT_TTL_DAYS', '366'],
        ['API_KEY_ALLOW_NON_EXPIRING', 'maybe'],
      ] as const) {
        expect([k, v, problems({ ...dev, [k]: v }).length > 0]).toEqual([k, v, true]);
      }
      expect(loadConfig({ ...dev, FLAGS_CACHE_TTL_MS: '0' }).flags.cacheTtlMs).toBe(0);
    });
    it('API_KEY_PEPPER set but empty or whitespace refuses to start in every environment; unset outside production uses the dev default', () => {
      for (const env of [dev, { ...dev, NODE_ENV: 'test' }, prodOk]) {
        for (const blank of ['', ' ', '   	  ', ' '.repeat(64)]) {
          expect([env.NODE_ENV, JSON.stringify(blank), problems({ ...env, API_KEY_PEPPER: blank })]).toEqual([
            env.NODE_ENV,
            JSON.stringify(blank),
            expect.arrayContaining(['API_KEY_PEPPER is set but empty']),
          ]);
        }
      }
      expect('API_KEY_PEPPER' in dev).toBe(false);
      expect(loadConfig(dev).apiKeys.pepper).toBe(DEV_API_KEY_PEPPER);
      expect(loadConfig({ ...dev, NODE_ENV: 'test' }).apiKeys.pepper).toBe(DEV_API_KEY_PEPPER);
    });
    it('production guards: pepper required, not a dev default, distinct, strong; no non-expiring keys; flag TTL ceiling', () => {
      const { API_KEY_PEPPER: _p, ...noPepper } = prodOk;
      expect(problems(noPepper)).toContain('API_KEY_PEPPER is required in production');
      expect(problems({ ...prodOk, API_KEY_PEPPER: DEV_API_KEY_PEPPER })).toContain('API_KEY_PEPPER must not be a documented dev default');
      expect(problems({ ...prodOk, API_KEY_PEPPER: 'ci-only-api-key-pepper-not-for-production-0123456789abcdef' })).toContain(
        'API_KEY_PEPPER must not be a documented dev default',
      );
      // The CI value (job-level env in web-ci.yml) is accepted outside production.
      expect(loadConfig({ ...dev, API_KEY_PEPPER: 'ci-only-api-key-pepper-not-for-production-0123456789abcdef' }).apiKeys.pepper).toContain('ci-only');
      expect(problems({ ...prodOk, API_KEY_PEPPER: prodOk.JWT_SECRET })).toContain('API_KEY_PEPPER must differ from every other secret');
      expect(problems({ ...prodOk, API_KEY_PEPPER: 'ab'.repeat(32) }).some((p) => p.startsWith('API_KEY_PEPPER'))).toBe(true);
      expect(problems({ ...prodOk, API_KEY_PEPPER: '0123456789abcdef0123456789abcdef0123456789ab' }).some((p) => p.startsWith('API_KEY_PEPPER'))).toBe(true);
      expect(problems({ ...prodOk, API_KEY_ALLOW_NON_EXPIRING: 'true' })).toContain('API_KEY_ALLOW_NON_EXPIRING=true is not allowed in production');
      expect(problems({ ...prodOk, FLAGS_CACHE_TTL_MS: '30001' })).toContain('FLAGS_CACHE_TTL_MS is above its production ceiling (30000)');
      expect(loadConfig.length).toBeGreaterThan(0);
      const errs = problems({ ...prodOk, API_KEY_PEPPER: 'Zq9Wv' });
      expect(errs.join(' ')).not.toContain('Zq9Wv');
    });
  });
});
