/**
 * Configuration: read once at startup, validated, fail-fast (C5). Errors name the offending keys only;
 * they never contain a secret value.
 */
import { existsSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';

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
    /** Server-side encryption for every object write (N8). */
    sse: 'aws:kms' | 'none';
    kmsKeyId: string | null;
  };
  /** Step 3 import/export knobs (N3). */
  imports: ImportConfig;
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

export interface ImportConfig {
  maxFileBytes: number;
  maxFilesPerBatch: number;
  tenantStorageQuotaBytes: number;
  uploadRequestTimeoutSeconds: number;
  uploadIdleTimeoutSeconds: number;
  uploadMaxConcurrentPerTenant: number;
  parseTimeoutMs: number;
  parseMemoryMb: number;
  parseMaxConcurrency: number;
  parseQueueTimeoutMs: number;
  parseMaxOutputBytes: number;
  parseMaxPdfPages: number;
  parseMaxTextChars: number;
  parseMaxImagePixels: number;
  reviewConfidenceThreshold: number;
  exportMaxRows: number;
  exportMaxConcurrentPerTenant: number;
  rateLimitUploadMax: number;
  rateLimitExportMax: number;
  staleSeconds: number;
  /** Absolute path of the built parse worker entry (dist/src/imports/sandbox/worker-main.js). */
  workerEntry: string;
}

/** Runtime facts the production guards depend on (injectable for tests). */
export interface ConfigRuntime {
  /** Whether this Node binary supports the permission model flag (`--permission`). */
  permissionFlagAvailable: boolean;
  /**
   * Whether `module.registerHooks` exists (Node >= 22.15.0 / 23.5.0, per the Node docs). The parse
   * worker's guard needs it; the worker runs this same Node binary.
   */
  moduleHooksAvailable: boolean;
  fileExists: (path: string) => boolean;
}

export const DEFAULT_RUNTIME: ConfigRuntime = {
  permissionFlagAvailable: process.allowedNodeEnvironmentFlags.has('--permission'),
  moduleHooksAvailable: typeof (nodeModule as { registerHooks?: unknown }).registerHooks === 'function',
  fileExists: (p) => existsSync(p),
};

/**
 * Default worker entry: the compiled worker next to the compiled config (dist/src/...). When the API
 * runs from source (tsx/vitest), the built worker under api/dist is used (`npm run build` first).
 */
export function defaultWorkerEntry(moduleUrl: string = import.meta.url): string {
  const here = fileURLToPath(moduleUrl);
  if (/[\\/]dist[\\/]src[\\/]config\.js$/u.test(here)) return fileURLToPath(new URL('./imports/sandbox/worker-main.js', moduleUrl));
  return fileURLToPath(new URL('../dist/src/imports/sandbox/worker-main.js', moduleUrl));
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

/**
 * Import/export knobs (N3). `floor`/`ceiling` apply in production only; min/max always. The absolute
 * upload maximum equals the DB CHECK on import_documents.size_bytes (25 MiB).
 */
interface ImportKnob {
  key: string;
  def: number;
  min: number;
  max: number;
  floor?: number;
  ceiling?: number;
}

const IMPORT_KNOBS = {
  maxFileBytes: { key: 'IMPORT_MAX_FILE_BYTES', def: 10485760, min: 1, max: 26214400, ceiling: 26214400 },
  maxFilesPerBatch: { key: 'IMPORT_MAX_FILES_PER_BATCH', def: 10, min: 1, max: 1000 },
  tenantStorageQuotaBytes: { key: 'TENANT_STORAGE_QUOTA_BYTES', def: 1073741824, min: 1, max: 1099511627776 },
  uploadRequestTimeoutSeconds: { key: 'UPLOAD_REQUEST_TIMEOUT_SECONDS', def: 60, min: 1, max: 3600, ceiling: 120 },
  uploadIdleTimeoutSeconds: { key: 'UPLOAD_IDLE_TIMEOUT_SECONDS', def: 10, min: 1, max: 600, ceiling: 30 },
  uploadMaxConcurrentPerTenant: { key: 'UPLOAD_MAX_CONCURRENT_PER_TENANT', def: 4, min: 1, max: 1000 },
  parseTimeoutMs: { key: 'PARSE_TIMEOUT_MS', def: 20000, min: 50, max: 600000, floor: 1000, ceiling: 60000 },
  parseMemoryMb: { key: 'PARSE_MEMORY_MB', def: 256, min: 16, max: 8192, floor: 64, ceiling: 1024 },
  parseMaxConcurrency: { key: 'PARSE_MAX_CONCURRENCY', def: 2, min: 1, max: 64 },
  parseQueueTimeoutMs: { key: 'PARSE_QUEUE_TIMEOUT_MS', def: 5000, min: 0, max: 600000 },
  parseMaxOutputBytes: { key: 'PARSE_MAX_OUTPUT_BYTES', def: 25165824, min: 1024, max: 268435456 },
  parseMaxPdfPages: { key: 'PARSE_MAX_PDF_PAGES', def: 50, min: 1, max: 1000 },
  parseMaxTextChars: { key: 'PARSE_MAX_TEXT_CHARS', def: 2000000, min: 1, max: 5000000, ceiling: 5000000 },
  parseMaxImagePixels: { key: 'PARSE_MAX_IMAGE_PIXELS', def: 50000000, min: 1, max: 400000000 },
  exportMaxRows: { key: 'EXPORT_MAX_ROWS', def: 50000, min: 1, max: 200000 },
  exportMaxConcurrentPerTenant: { key: 'EXPORT_MAX_CONCURRENT_PER_TENANT', def: 2, min: 1, max: 1000 },
  rateLimitUploadMax: { key: 'RATE_LIMIT_UPLOAD_MAX', def: 60, min: 1, max: 100000 },
  rateLimitExportMax: { key: 'RATE_LIMIT_EXPORT_MAX', def: 10, min: 1, max: 100000 },
  staleSeconds: { key: 'IMPORT_STALE_SECONDS', def: 600, min: 1, max: 86400 },
} as const satisfies Record<string, ImportKnob>;

/** REVIEW_CONFIDENCE_THRESHOLD: decimal 0.50..1.00 (at most 3 fraction digits). */
const THRESHOLD_RE = /^(0\.[5-9][0-9]{0,2}|1(\.0{1,3})?)$/u;

const MIN_SECRET_CHARS = 43;

/**
 * Mail transports that are actually implemented and allowed in production. EMPTY on purpose: `outbox`
 * is a dev/test sink and `ses` is a stub (SesMailer throws), so production refuses to start until a
 * real transport is implemented and added here.
 */
export const PRODUCTION_MAIL_TRANSPORTS: readonly string[] = Object.freeze([]);
/** Minimum estimated entropy (bits) for a production secret: alphabet bits per character x length. */
export const MIN_SECRET_ENTROPY_BITS = 160;

/**
 * Alphabet-aware low-entropy check for production secrets. Returns a reason, or null if acceptable.
 * Designed to accept random hex (`openssl rand -hex 32`, 64 chars) and base64 (`openssl rand -base64 32`
 * or `-base64 48`) with negligible false rejects, while rejecting repeated/patterned strings:
 *  - estimated entropy = bits per symbol of the detected alphabet (hex 4, base64/base64url 6,
 *    other printable 6.5) x length must be >= 160 bits;
 *  - the string must not be a repetition of a shorter unit (period <= half the length), e.g.
 *    "aaaa...", "abab...", "0123456789abcdef" repeated;
 *  - at least 8 distinct characters, and no single character above 25% of the string.
 * For 64 random hex chars each condition fails with probability far below 1e-6.
 */
export function secretEntropyProblem(value: string): string | null {
  const bitsPerChar = /^[0-9a-fA-F]+$/u.test(value) ? 4 : /^[A-Za-z0-9+/_-]+={0,2}$/u.test(value) ? 6 : 6.5;
  if (value.length * bitsPerChar < MIN_SECRET_ENTROPY_BITS) return 'is too short for its alphabet';
  for (let p = 1; p <= value.length / 2; p += 1) {
    let periodic = true;
    for (let i = p; i < value.length; i += 1) {
      if (value[i] !== value[i - p]) {
        periodic = false;
        break;
      }
    }
    if (periodic) return 'is a repeated pattern';
  }
  const counts = new Map<string, number>();
  for (const c of value) counts.set(c, (counts.get(c) ?? 0) + 1);
  if (counts.size < 8) return 'uses too few distinct characters';
  if (Math.max(...counts.values()) > value.length / 4) return 'is dominated by one character';
  return null;
}

/**
 * Template/placeholder text (e.g. the `<...>` values in .env.example) is never a secret: angle brackets,
 * whitespace, or obvious placeholder words. Rejected in every environment.
 */
export function looksLikePlaceholder(value: string): boolean {
  return /[<>\s]/u.test(value) || /change[-_ ]?me|placeholder|replace[-_ ]?me|your[-_ ]?secret|openssl rand/iu.test(value);
}

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
export function loadConfig(env: Record<string, string | undefined>, runtime: ConfigRuntime = DEFAULT_RUNTIME): AppConfig {
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
    if (v && looksLikePlaceholder(v)) problems.push(`${k} looks like a placeholder, not a secret`);
    if (v && prod && DOCUMENTED_DEV_SECRETS.includes(v)) problems.push(`${k} must not be a documented dev default`);
    const weak = v && prod ? secretEntropyProblem(v) : null;
    if (weak) problems.push(`${k} ${weak} to be a random secret`);
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
    if (looksLikePlaceholder(mfaRaw)) problems.push('MFA_ENC_KEY looks like a placeholder, not a secret');
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
  } else if (prod && !PRODUCTION_MAIL_TRANSPORTS.includes(mailTransport)) {
    problems.push(`MAIL_TRANSPORT=${mailTransport} is not implemented (stub); production start is refused until a real mail transport exists`);
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

  // ---- Step 3 knobs (N3) ----
  const imp = {} as Record<keyof typeof IMPORT_KNOBS, number>;
  for (const [name, k] of Object.entries(IMPORT_KNOBS) as [keyof typeof IMPORT_KNOBS, ImportKnob][]) {
    const v = parseIntStrict(get(k.key), k.key, problems) ?? k.def;
    if (v < k.min || v > k.max) problems.push(`${k.key} must be between ${k.min} and ${k.max}`);
    if (prod && k.floor !== undefined && v < k.floor) problems.push(`${k.key} is below its production floor (${k.floor})`);
    if (prod && k.ceiling !== undefined && v > k.ceiling) problems.push(`${k.key} is above its production ceiling (${k.ceiling})`);
    imp[name] = v;
  }
  const thresholdRaw = get('REVIEW_CONFIDENCE_THRESHOLD');
  let reviewConfidenceThreshold = 0.9;
  if (thresholdRaw !== undefined) {
    if (THRESHOLD_RE.test(thresholdRaw.trim())) reviewConfidenceThreshold = Number(thresholdRaw.trim());
    else problems.push('REVIEW_CONFIDENCE_THRESHOLD must be a decimal between 0.50 and 1.00');
  }
  const sseRaw = get('S3_SSE') ?? 'aws:kms';
  let sse: 'aws:kms' | 'none' = 'aws:kms';
  if (sseRaw === 'aws:kms' || sseRaw === 'none') sse = sseRaw;
  else problems.push('S3_SSE must be aws:kms or none');
  const kmsKeyId = get('S3_KMS_KEY_ID') ?? null;
  if (kmsKeyId !== null && !/^[A-Za-z0-9:/_.-]{1,2048}$/u.test(kmsKeyId)) problems.push('S3_KMS_KEY_ID contains invalid characters');
  if (prod && sse !== 'aws:kms') problems.push('S3_SSE must be aws:kms in production');
  if (prod && sse === 'aws:kms' && !kmsKeyId) problems.push('S3_KMS_KEY_ID is required in production');
  const workerEntry = get('PARSE_WORKER_ENTRY') ?? defaultWorkerEntry();
  if (prod && !runtime.permissionFlagAvailable) problems.push('Node permission model (--permission) is required in production for the parse sandbox');
  // Fail closed in every environment: without it every parse would fail at the worker's guard.
  if (!runtime.moduleHooksAvailable) problems.push('Node.js >= 22.15.0 is required (module.registerHooks, used by the parse sandbox guard)');
  if (prod && !runtime.fileExists(workerEntry)) problems.push('PARSE_WORKER_ENTRY does not exist (build the API first)');

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
      sse,
      kmsKeyId,
    },
    imports: { ...imp, reviewConfidenceThreshold, workerEntry },
    mailTransport,
    enableDevOutbox,
    totpIssuer,
    rateLimitEnabled,
    ...knobValues,
  };
}
