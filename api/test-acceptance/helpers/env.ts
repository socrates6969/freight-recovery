// Test environment construction. Secrets are test-only values, deterministic across processes so that
// `npm run db:seed` (which encrypts the seeded TOTP secrets with MFA_ENC_KEY) and the app agree.
import { createHash } from 'node:crypto';

const det = (name: string) => createHash('sha256').update(`fr-acceptance-${name}`).digest('hex'); // 64 hex

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://freight_app:local-dev-only@127.0.0.1:5433/freight_web_test';
export const TEST_ADMIN_DATABASE_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  'postgresql://freight_owner:local-dev-only@127.0.0.1:5433/freight_web_test';
export const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://127.0.0.1:8080';

export const SEED_PASSWORD = 'Synthetic-Pass-2026!';
export const SEED_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

export const SECRETS = {
  JWT_SECRET: process.env.JWT_SECRET ?? det('jwt'),
  CSRF_SECRET: process.env.CSRF_SECRET ?? det('csrf'),
  REFRESH_PEPPER: process.env.REFRESH_PEPPER ?? det('pepper'),
  MFA_ENC_KEY:
    process.env.MFA_ENC_KEY ?? Buffer.from(det('mfa'), 'hex').subarray(0, 32).toString('base64'),
};

// Object storage for step 3 (MinIO or any S3-compatible endpoint; CI/local export S3_* to override).
export const S3_DEFAULTS: Record<string, string> = {
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000',
  S3_REGION: process.env.S3_REGION ?? 'us-east-1',
  S3_BUCKET: process.env.S3_BUCKET ?? 'fr-documents-dev',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'localdev',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'localdev-minio-password',
  S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE ?? 'true',
  S3_SSE: process.env.S3_SSE ?? 'none',
  ...(process.env.S3_KMS_KEY_ID ? { S3_KMS_KEY_ID: process.env.S3_KMS_KEY_ID } : {}),
};

/** Fast, deterministic defaults for acceptance runs. Overrides win. */
export function baseEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    APP_ORIGIN,
    ...SECRETS,
    LOG_LEVEL: 'silent',
    ENABLE_DEV_OUTBOX: 'true',
    RATE_LIMIT_ENABLED: 'false',
    ARGON2_MEMORY_KIB: '8192',
    ...S3_DEFAULTS,
    COOKIE_SECURE: 'true', // CI exports COOKIE_SECURE=false; tests assert the secure default and override per app
    ...overrides,
  };
}

/** Env handed to child processes (db:seed etc.). */
export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...SECRETS,
    DATABASE_URL: TEST_DATABASE_URL,
    MIGRATE_DATABASE_URL: process.env.MIGRATE_DATABASE_URL ?? TEST_ADMIN_DATABASE_URL,
    TEST_DATABASE_URL,
    TEST_ADMIN_DATABASE_URL,
    APP_ORIGIN,
    ...extra,
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));