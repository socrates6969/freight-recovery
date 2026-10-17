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
  // Step 3: document-derived content is never logged (ids, sizes, sha256 prefixes and codes only).
  'displayname',
  'filename',
  'rawvalue',
  'correctedvalue',
  'excerpt',
  'value',
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
  'displayName',
  'filename',
  'rawValue',
  'correctedValue',
  'excerpt',
  'value',
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

/**
 * Keys whose values are handed untouched to the Pino serializers below (Fastify passes its request and
 * reply objects there; their fields are prototype getters that a generic copy would lose). The
 * serializers extract only safe fields, and the redact paths still cover their headers.
 */
const SERIALIZED_KEYS: ReadonlySet<string> = new Set(['req', 'res']);

/** Recursively replace sensitive values. Returns a new object; never mutates the input. */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return { type: value.name };
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) out[k] = REDACT_CENSOR;
    else if (depth === 0 && SERIALIZED_KEYS.has(k)) out[k] = v;
    else out[k] = scrub(v, depth + 1);
  }
  return out;
}

interface ReqLike {
  id?: unknown;
  method?: unknown;
  url?: unknown;
  ip?: unknown;
  routeOptions?: { url?: unknown };
  socket?: { remoteAddress?: unknown };
}

function pathOf(url: unknown): string {
  const u = typeof url === 'string' ? url : '';
  const q = u.indexOf('?');
  return q === -1 ? u : u.slice(0, q);
}

/** Request line fields: requestId, method, path (query string dropped), route pattern, client address. */
export function serializeReq(req: ReqLike): Record<string, unknown> {
  const route = req.routeOptions?.url;
  return {
    requestId: req.id,
    method: req.method,
    path: pathOf(req.url),
    ...(typeof route === 'string' ? { route } : {}),
    remoteAddress: req.ip ?? req.socket?.remoteAddress,
  };
}

interface ResLike {
  statusCode?: unknown;
  elapsedTime?: unknown;
  request?: ReqLike;
}

/** Completion line fields: requestId, method, path, status and duration (ms). */
export function serializeRes(res: ResLike): Record<string, unknown> {
  const req = res.request;
  const out: Record<string, unknown> = { statusCode: res.statusCode };
  if (req) {
    out['requestId'] = req.id;
    out['method'] = req.method;
    out['path'] = pathOf(req.url);
  }
  if (typeof res.elapsedTime === 'number') out['durationMs'] = Math.round(res.elapsedTime * 1000) / 1000;
  return out;
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
