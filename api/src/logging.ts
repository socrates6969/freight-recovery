/**
 * Structured logging (A9): Pino JSON, ISO timestamps, redaction of credentials and secrets at any depth
 * (Pino `redact` for known paths + a recursive scrubber for every log object), minimal req/res
 * serializers (no query strings, no headers, no bodies).
 */
import pino, { type DestinationStream, type Logger } from 'pino';

export const REDACT_CENSOR = '[REDACTED]';

/** Keys whose values are never logged, wherever they appear. */
export const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'token',
  'mfatoken',
  'enrolltoken',
  'code',
  'recoverycode',
  'recoverycodes',
  'secret',
  'otpauthuri',
  'accesstoken',
  'refreshtoken',
  'csrftoken',
  'passwordhash',
  'demandletter',
  'authorization',
  'cookie',
  'set-cookie',
  'x-csrf-token',
]);

const SENSITIVE_FIELDS = [
  'password',
  'currentPassword',
  'newPassword',
  'token',
  'mfaToken',
  'enrollToken',
  'code',
  'recoveryCode',
  'recoveryCodes',
  'secret',
  'otpauthUri',
  'accessToken',
  'refreshToken',
  'csrfToken',
  'passwordHash',
  'demandLetter',
];

export const REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_FIELDS,
  ...SENSITIVE_FIELDS.map((f) => `*.${f}`),
  ...SENSITIVE_FIELDS.map((f) => `*.*.${f}`),
];

const MAX_DEPTH = 8;

/** Recursively replace sensitive values. Returns a new object; never mutates the input. */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return { type: value.name };
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? REDACT_CENSOR : scrub(v, depth + 1);
  }
  return out;
}

interface ReqLike {
  id?: unknown;
  method?: unknown;
  url?: unknown;
  ip?: unknown;
  socket?: { remoteAddress?: unknown };
}

export function serializeReq(req: ReqLike): Record<string, unknown> {
  const url = typeof req.url === 'string' ? req.url : '';
  const q = url.indexOf('?');
  return {
    id: req.id,
    method: req.method,
    path: q === -1 ? url : url.slice(0, q),
    remoteAddress: req.ip ?? req.socket?.remoteAddress,
  };
}

export function serializeRes(res: { statusCode?: unknown }): Record<string, unknown> {
  return { statusCode: res.statusCode };
}

export function createLogger(level: string, stream?: DestinationStream | NodeJS.WritableStream): Logger {
  const options: pino.LoggerOptions = {
    level,
    base: { service: 'fr-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
    serializers: {
      req: serializeReq,
      res: serializeRes,
      err: (e: unknown) => {
        if (e instanceof Error) return { type: e.name, code: (e as { code?: unknown }).code };
        return { type: 'unknown' };
      },
    },
    formatters: {
      log: (obj) => scrub(obj) as Record<string, unknown>,
    },
  };
  return stream ? pino(options, stream as DestinationStream) : pino(options);
}
