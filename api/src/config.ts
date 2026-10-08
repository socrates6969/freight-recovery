/**
 * Configuration: read once at startup, validated, fail-fast (C5). Errors name the offending keys only;
 * they never contain a secret value.
 */
import { isIP } from 'node:net';

export type NodeEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  nodeEnv: NodeEnv;
  databaseUrl: string;
  jwtSecret: string;
  csrfSecret: string;
  refreshPepper: string;
  mfaEncKey: Buffer;
  mfaKeyId: string;
  appOrigin: string;
  port: number;
  host: string;
  logLevel: string;
  trustProxy: string[];
  cookieSecure: boolean;
  hstsMaxAgeSeconds: number;
  bodyLimitBytes: number;
  redisUrl: string | null;
  s3: {
    endpoint: string | null;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string | null;
    secretAccessKey: string | null;
  };
  mailTransport: 'outbox' | 'ses';
  enableDevOutbox: boolean;
  totpIssuer: string;
  accessTokenTtlSeconds: number;
  mfaTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  refreshFamilyMaxSeconds: number;
  lockoutThreshold: number;
  lockoutBaseSeconds: number;
  lockoutMaxSeconds: number;
  resetTokenTtlSeconds: number;
  inviteTtlSeconds: number;
  rateLimitEnabled: boolean;
  rateLimitGlobalMax: number;
  rateLimitAuthMax: number;
  rateLimitAuthWindowSeconds: number;
  rateLimitForgotMax: number;
  rateLimitForgotWindowSeconds: number;
  argon2MemoryKib: number;
  argon2TimeCost: number;
}

export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid configuration: ${problems.join('; ')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Public dev/test default secret values that appear in compose.web.yml, CI and docs. Production refuses
 * to start with any of them. Keep in sync with compose.web.yml and .github/workflows/web-ci.yml.
 */
export const DOCUMENTED_DEV_SECRETS: readonly string[] = Object.freeze([
  'local-dev-jwt-secret-not-for-production-0123456789abcdef',
  'local-dev-csrf-secret-not-for-production-0123456789abcdef',
  'local-dev-refresh-pepper-not-for-production-0123456789abc',
  'bG9jYWwtZGV2LW1mYS1rZXktbm90LWZvci1wcm9kISE=',
  'ci-only-jwt-secret-not-for-production-0123456789abcdefghij',
  'ci-only-csrf-secret-not-for-production-0123456789abcdefghi',
  'ci-only-refresh-pepper-not-for-production-0123456789abcdef',
  'Y2ktb25seS1tZmEta2V5LW5vdC1mb3ItcHJvZHVjdCE=',
]);

interface Knob {
  key: string;
  def: number;
  min: number;
  max: number;
  /** Production floor (values below are accepted only outside production). */
  floor: number;
}

const KNOBS = {
  accessTokenTtlSeconds: { key: 'ACCESS_TOKEN_TTL_SECONDS', def: 600, min: 1, max: 3600, floor: 60 },
  mfaTokenTtlSeconds: { key: 'MFA_TOKEN_TTL_SECONDS', def: 300, min: 1, max: 1800, floor: 60 },
  refreshTokenTtlSeconds: { key: 'REFRESH_TOKEN_TTL_SECONDS', def: 604800, min: 1, max: 7776000, floor: 3600 },
  refreshFamilyMaxSeconds: { key: 'REFRESH_FAMILY_MAX_SECONDS', def: 2592000, min: 1, max: 31536000, floor: 86400 },
  lockoutThreshold: { key: 'LOCKOUT_THRESHOLD', def: 5, min: 1, max: 50, floor: 3 },
  lockoutBaseSeconds: { key: 'LOCKOUT_BASE_SECONDS', def: 30, min: 1, max: 86400, floor: 30 },
  lockoutMaxSeconds: { key: 'LOCKOUT_MAX_SECONDS', def: 900, min: 1, max: 604800, floor: 900 },
  resetTokenTtlSeconds: { key: 'RESET_TOKEN_TTL_SECONDS', def: 1800, min: 1, max: 86400, floor: 300 },
  inviteTtlSeconds: { key: 'INVITE_TTL_SECONDS', def: 604800, min: 1, max: 2592000, floor: 3600 },
  rateLimitGlobalMax: { key: 'RATE_LIMIT_GLOBAL_MAX', def: 600, min: 1, max: 100000, floor: 1 },
  rateLimitAuthMax: { key: 'RATE_LIMIT_AUTH_MAX', def: 20, min: 1, max: 100000, floor: 1 },
  rateLimitAuthWindowSeconds: { key: 'RATE_LIMIT_AUTH_WINDOW_SECONDS', def: 60, min: 1, max: 86400, floor: 10 },
  rateLimitForgotMax: { key: 'RATE_LIMIT_FORGOT_MAX', def: 5, min: 1, max: 100000, floor: 1 },
  rateLimitForgotWindowSeconds: { key: 'RATE_LIMIT_FORGOT_WINDOW_SECONDS', def: 900, min: 1, max: 86400, floor: 60 },
  argon2MemoryKib: { key: 'ARGON2_MEMORY_KIB', def: 19456, min: 8, max: 1048576, floor: 19456 },
  argon2TimeCost: { key: 'ARGON2_TIME_COST', def: 2, min: 1, max: 20, floor: 2 },
} as const satisfies Record<string, Knob>;

const MIN_SECRET_CHARS = 43;

function parseBool(raw: string | undefined, def: boolean, key: string, problems: string[]): boolean {
  if (raw === undefined || raw === '') return def;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  problems.push(`${key} must be true or false`);
  return def;
}

function parseIntStrict(raw: string | undefined, key: string, problems: string[]): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!/^\d+$/u.test(raw.trim())) {
    problems.push(`${key} must be a non-negative integer`);
    return undefined;
  }
  return Number.parseInt(raw.trim(), 10);
}

function isValidCidr(value: string): boolean {
  const [addr, bits, ...rest] = value.split('/');
  if (rest.length > 0 || !addr) return false;
  const family = isIP(addr);
  if (family === 0) return false;
  if (bits === undefined) return true;
  if (!/^\d+$/u.test(bits)) return false;
  const n = Number(bits);
  return family === 4 ? n <= 32 : n <= 128;
}

/** Parse and validate configuration from an env map. Throws ConfigError listing every problem. */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const problems: string[] = [];
  const get = (k: string): string | undefined => {
    const v = env[k];
    return v === undefined || v === '' ? undefined : v;
  };

  const nodeEnvRaw = get('NODE_ENV') ?? 'production';
  let nodeEnv: NodeEnv = 'production';
  if (nodeEnvRaw === 'development' || nodeEnvRaw === 'test' || nodeEnvRaw === 'production') nodeEnv = nodeEnvRaw;
  else problems.push('NODE_ENV must be development, test or production');
  const prod = nodeEnv === 'production';

  const required = (k: string): string => {
    const v = get(k);
    if (v === undefined) problems.push(`${k} is required`);
    return v ?? '';
  };

  const databaseUrl = required('DATABASE_URL');
  if (databaseUrl && !/^postgres(ql)?:\/\//u.test(databaseUrl)) problems.push('DATABASE_URL must be a postgresql:// URL');

  const secret = (k: string): string => {
    const v = required(k);
    if (v && v.length < MIN_SECRET_CHARS) problems.push(`${k} must be at least ${MIN_SECRET_CHARS} characters`);
    if (v && prod && DOCUMENTED_DEV_SECRETS.includes(v)) problems.push(`${k} must not be a documented dev default`);
    return v;
  };
  const jwtSecret = secret('JWT_SECRET');
  const csrfSecret = secret('CSRF_SECRET');
  const refreshPepper = secret('REFRESH_PEPPER');
  if (jwtSecret && (jwtSecret === csrfSecret || jwtSecret === refreshPepper || csrfSecret === refreshPepper)) {
    problems.push('JWT_SECRET, CSRF_SECRET and REFRESH_PEPPER must be distinct');
  }

  const mfaRaw = required('MFA_ENC_KEY');
  let mfaEncKey = Buffer.alloc(0);
  if (mfaRaw) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(mfaRaw)) problems.push('MFA_ENC_KEY must be base64');
    else {
      mfaEncKey = Buffer.from(mfaRaw, 'base64');
      if (mfaEncKey.length !== 32) problems.push('MFA_ENC_KEY must decode to 32 bytes');
    }
    if (prod && DOCUMENTED_DEV_SECRETS.includes(mfaRaw)) problems.push('MFA_ENC_KEY must not be a documented dev default');
  }

  const appOriginRaw = required('APP_ORIGIN');
  let appOrigin = '';
  if (appOriginRaw) {
    try {
      const u = new URL(appOriginRaw);
      if (u.origin !== appOriginRaw || (u.protocol !== 'https:' && u.protocol !== 'http:')) {
        problems.push('APP_ORIGIN must be an exact origin like https://app.example.com');
      } else appOrigin = u.origin;
      if (prod && u.protocol !== 'https:') problems.push('APP_ORIGIN must use https in production');
    } catch {
      problems.push('APP_ORIGIN must be a valid origin');
    }
  }

  const port = parseIntStrict(get('PORT'), 'PORT', problems) ?? 3001;
  if (port < 1 || port > 65535) problems.push('PORT out of range');
  const host = get('HOST') ?? '127.0.0.1';
  const logLevel = get('LOG_LEVEL') ?? 'info';
  if (!['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(logLevel)) problems.push('LOG_LEVEL invalid');

  const trustProxyRaw = get('TRUST_PROXY');
  const trustProxy: string[] = [];
  if (trustProxyRaw) {
    for (const part of trustProxyRaw.split(',').map((p) => p.trim()).filter(Boolean)) {
      if (part === '*' || part.toLowerCase() === 'true') problems.push('TRUST_PROXY must list CIDRs (wildcards are refused)');
      else if (!isValidCidr(part)) problems.push('TRUST_PROXY contains an invalid CIDR');
      else trustProxy.push(part);
    }
  }

  const cookieSecure = parseBool(get('COOKIE_SECURE'), true, 'COOKIE_SECURE', problems);
  if (!cookieSecure && prod) problems.push('COOKIE_SECURE=false is not allowed in production');

  const hsts = parseIntStrict(get('HSTS_MAX_AGE_SECONDS'), 'HSTS_MAX_AGE_SECONDS', problems) ?? (prod ? 31536000 : 0);
  const bodyLimitBytes = parseIntStrict(get('BODY_LIMIT_BYTES'), 'BODY_LIMIT_BYTES', problems) ?? 65536;
  if (bodyLimitBytes < 1024 || bodyLimitBytes > 10485760) problems.push('BODY_LIMIT_BYTES out of range');

  const redisUrl = get('REDIS_URL') ?? null;
  if (prod && !redisUrl) problems.push('REDIS_URL is required in production');
  if (redisUrl && !/^rediss?:\/\//u.test(redisUrl)) problems.push('REDIS_URL must be a redis:// or rediss:// URL');

  const mailRaw = get('MAIL_TRANSPORT') ?? 'outbox';
  let mailTransport: 'outbox' | 'ses' = 'outbox';
  if (mailRaw === 'outbox' || mailRaw === 'ses') mailTransport = mailRaw;
  else problems.push('MAIL_TRANSPORT must be outbox or ses');
  if (prod && mailTransport === 'outbox') {
    problems.push('MAIL_TRANSPORT=outbox is not allowed in production (no real mail transport is implemented yet)');
  }

  const enableDevOutbox = parseBool(get('ENABLE_DEV_OUTBOX'), false, 'ENABLE_DEV_OUTBOX', problems);
  if (prod && enableDevOutbox) problems.push('ENABLE_DEV_OUTBOX=true is not allowed in production');

  const rateLimitEnabled = parseBool(get('RATE_LIMIT_ENABLED'), true, 'RATE_LIMIT_ENABLED', problems);
  if (prod && !rateLimitEnabled) problems.push('RATE_LIMIT_ENABLED=false is not allowed in production');

  if (prod && databaseUrl && !/[?&]sslmode=(require|verify-full)(&|$)/u.test(databaseUrl)) {
    problems.push('DATABASE_URL must set sslmode=require or sslmode=verify-full in production');
  }

  const knobValues = {} as Record<keyof typeof KNOBS, number>;
  for (const [name, k] of Object.entries(KNOBS) as [keyof typeof KNOBS, Knob][]) {
    const v = parseIntStrict(get(k.key), k.key, problems) ?? k.def;
    if (v < k.min || v > k.max) problems.push(`${k.key} must be between ${k.min} and ${k.max}`);
    if (prod && v < k.floor) problems.push(`${k.key} is below its production floor (${k.floor})`);
    knobValues[name] = v;
  }
  if (knobValues.lockoutMaxSeconds < knobValues.lockoutBaseSeconds) {
    problems.push('LOCKOUT_MAX_SECONDS must be >= LOCKOUT_BASE_SECONDS');
  }

  const totpIssuer = get('TOTP_ISSUER') ?? 'FreightRecovery';
  if (!/^[A-Za-z0-9 ._-]{1,64}$/u.test(totpIssuer)) problems.push('TOTP_ISSUER contains invalid characters');

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    nodeEnv,
    databaseUrl,
    jwtSecret,
    csrfSecret,
    refreshPepper,
    mfaEncKey,
    mfaKeyId: 'k1',
    appOrigin,
    port,
    host,
    logLevel,
    trustProxy,
    cookieSecure,
    hstsMaxAgeSeconds: hsts,
    bodyLimitBytes,
    redisUrl,
    s3: {
      endpoint: get('S3_ENDPOINT') ?? null,
      region: get('S3_REGION') ?? 'us-east-1',
      bucket: get('S3_BUCKET') ?? 'fr-documents-dev',
      forcePathStyle: parseBool(get('S3_FORCE_PATH_STYLE'), false, 'S3_FORCE_PATH_STYLE', problems),
      accessKeyId: get('S3_ACCESS_KEY_ID') ?? null,
      secretAccessKey: get('S3_SECRET_ACCESS_KEY') ?? null,
    },
    mailTransport,
    enableDevOutbox,
    totpIssuer,
    rateLimitEnabled,
    ...knobValues,
  };
}
