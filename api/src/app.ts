/**
 * buildApp (C6): builds a fully configured Fastify instance. Importing this module opens nothing; the
 * database pool and Redis connect lazily on first use after buildApp() is called; app.close() releases them.
 */
import { randomUUID } from 'node:crypto';

import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { Redis } from 'ioredis';
import { ZodError } from 'zod';

import { registerAuditRoutes } from './audit/routes.js';
import { makeOnForbidden } from './auth/authz-denied.js';
import type { AuthDeps } from './auth/deps.js';
import { registerDevOutbox } from './auth/dev-outbox.js';
import { OutboxMailer, SesMailer } from './auth/mailer.js';
import { registerAuthRoutes } from './auth/routes.js';
import { authenticateAccessToken } from './auth/session.js';
import { registerUserRoutes } from './auth/users-routes.js';
import { registerClaimRoutes } from './claims/routes.js';
import { loadConfig, type AppConfig } from './config.js';
import { createDb } from './db/client.js';
import { registerExportRoutes } from './exports/routes.js';
import type { ImportDeps, ObjectStorePort } from './imports/deps.js';
import { registerImportRoutes } from './imports/routes.js';
import { ChildProcessExecutor, type ParseExecutor } from './imports/sandbox/executor.js';
import { KeyedGate } from './imports/sandbox/semaphore.js';
import { TenantScopeError } from './db/errors.js';
import { ERROR_MESSAGES, HttpError, errors } from './http/errors.js';
import { enforceRouteAccess, zodDetails } from './http/route.js';
import { registerSecurityHeaders, registerSecurityPipeline, type Limiter } from './http/security.js';
import { registerIntelligenceRoutes } from './intelligence/routes.js';
import { createLogger } from './logging.js';
import { MetricsRegistry, UNMATCHED_ROUTE, ZERO_PARSER_COUNTERS } from './observability/metrics.js';
import { LogRingBuffer } from './observability/ring-buffer.js';
import { registerPlatformDashboardRoutes } from './platform/dashboard-routes.js';
import { FlagService } from './platform/flags.js';
import { registerHealthRoutes, registerPlatformRoutes } from './platform/routes.js';
import { emailHash } from './security/crypto.js';
import { JwtService } from './security/jwt.js';
import { PasswordHasher } from './security/password.js';
import { ObjectStore } from './storage/s3.js';

export interface BuildAppOptions {
  logStream?: NodeJS.WritableStream;
  /** Test seams (never reachable from configuration). */
  overrides?: {
    objectStore?: ObjectStorePort;
    parseExecutor?: ParseExecutor;
    now?: () => Date;
  };
}

type RateLimitFn = (req: FastifyRequest) => Promise<{ isAllowed: boolean; isExceeded: boolean; ttlInSeconds: number }>;

function wrapLimiter(fn: RateLimitFn): Limiter {
  return async (req) => {
    const r = await fn(req);
    // `isAllowed` means "on the allow-list"; a request is blocked only when the bucket is exceeded.
    const blocked = !r.isAllowed && r.isExceeded;
    return { allowed: !blocked, retryAfterSeconds: Math.max(1, Math.ceil(r.ttlInSeconds || 1)) };
  };
}

function sendError(reply: FastifyReply, req: FastifyRequest, err: HttpError): void {
  if (err.retryAfterSeconds !== undefined) reply.header('retry-after', String(err.retryAfterSeconds));
  const body: { error: { code: string; message: string; requestId: string; details?: unknown } } = {
    error: { code: err.code, message: err.message, requestId: req.frRequestId || String(req.id) },
  };
  if (err.details) body.error.details = err.details;
  void reply.code(err.statusCode).type('application/json; charset=utf-8').send(body);
}

/** Map any thrown value to a fixed-shape HttpError (never forwards unknown messages). */
export function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof ZodError) return errors.validation(zodDetails(err));
  const fe = err as Partial<FastifyError> & { code?: string; statusCode?: number };
  switch (fe.code) {
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return new HttpError(413, 'payload_too_large');
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return new HttpError(415, 'unsupported_media_type');
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
    case 'FST_ERR_CTP_INVALID_CONTENT_LENGTH':
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
    case 'FST_ERR_BAD_URL':
      return errors.validation([]);
    case 'P2002':
      return errors.conflict();
    case 'P2025':
      return errors.notFound();
    default:
      break;
  }
  if (fe.statusCode === 400 && (err instanceof SyntaxError || fe.code?.startsWith('FST_ERR_CTP'))) return errors.validation([]);
  if (fe.statusCode === 413) return new HttpError(413, 'payload_too_large');
  return new HttpError(500, 'internal_error');
}

declare module 'fastify' {
  interface FastifyInstance {
    metrics: MetricsRegistry;
    logRing: LogRingBuffer;
    startedAt: Date;
    flags: FlagService;
  }
}

export async function buildApp(env?: Record<string, string>, opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const cfg: AppConfig = loadConfig({ ...process.env, ...(env ?? {}) });
  // Step 4 observability (per instance): derived-log ring buffer (R62) fed by a logger tee, and the
  // request/component metrics registry (R61).
  const logRing = new LogRingBuffer(cfg.observability.logBufferSize);
  const metrics = new MetricsRegistry();
  const startedAt = opts.overrides?.now?.() ?? new Date();
  const logger = createLogger(cfg.logLevel, opts.logStream, logRing);

  const app = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    trustProxy: cfg.trustProxy.length > 0 ? cfg.trustProxy : false,
    bodyLimit: cfg.bodyLimitBytes,
    routerOptions: { ignoreTrailingSlash: false, maxParamLength: 128 },
    // Whole-request timeout; uploads need the longer UPLOAD_REQUEST_TIMEOUT_SECONDS (N1). Headers must still
    // arrive within 10 s (set on the server below) and R43 aborts bodies idle for UPLOAD_IDLE_TIMEOUT_SECONDS.
    requestTimeout: cfg.imports.uploadRequestTimeoutSeconds * 1000,
    connectionTimeout: 10000,
    keepAliveTimeout: 5000,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    exposeHeadRoutes: false,
    onProtoPoisoning: 'error',
    onConstructorPoisoning: 'error',
    return503OnClosing: true,
  });
  app.server.headersTimeout = 10_000;
  app.removeContentTypeParser('text/plain');
  enforceRouteAccess(app);
  app.decorate('metrics', metrics);
  app.decorate('logRing', logRing);
  app.decorate('startedAt', startedAt);
  // Request telemetry: route PATTERN, method, status and duration only (never the URL, query, headers or
  // body). Registered before every route so health routes and 404s are counted.
  app.addHook('onResponse', async (req, reply) => {
    metrics.observeRequest({
      method: req.method,
      route: req.routeOptions.url ?? UNMATCHED_ROUTE,
      status: reply.statusCode,
      durationMs: reply.elapsedTime,
    });
  });

  const base = createDb(cfg.databaseUrl);
  const redis = cfg.redisUrl
    ? new Redis(cfg.redisUrl, { lazyConnect: true, enableOfflineQueue: true, maxRetriesPerRequest: 2, connectTimeout: 2000 })
    : null;

  await app.register(fastifyCookie);
  await app.register(fastifyHelmet, {
    global: true,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    originAgentCluster: false,
    referrerPolicy: { policy: 'no-referrer' },
    strictTransportSecurity: cfg.hstsMaxAgeSeconds > 0 ? { maxAge: cfg.hstsMaxAgeSeconds, includeSubDomains: true, preload: false } : false,
    xContentTypeOptions: true,
    xDnsPrefetchControl: false,
    xDownloadOptions: false,
    xFrameOptions: { action: 'deny' },
    xPermittedCrossDomainPolicies: false,
    xXssProtection: false,
  });
  await app.register(fastifyRateLimit, {
    global: false,
    ...(redis ? { redis, nameSpace: 'fr-rl-' } : {}),
    skipOnError: false,
  });

  const createRateLimit = (app as unknown as { createRateLimit: (o: Record<string, unknown>) => RateLimitFn }).createRateLimit;
  const minute = 60_000;
  const globalLimiter = wrapLimiter(
    createRateLimit({ max: cfg.rateLimitGlobalMax, timeWindow: minute, keyGenerator: (req: FastifyRequest) => `g:${req.ip}` }),
  );
  const authLimiter = wrapLimiter(
    createRateLimit({
      max: cfg.rateLimitAuthMax,
      timeWindow: cfg.rateLimitAuthWindowSeconds * 1000,
      keyGenerator: (req: FastifyRequest) => `a:${req.ip}`,
    }),
  );
  const forgotLimiter = wrapLimiter(
    createRateLimit({
      max: cfg.rateLimitForgotMax,
      timeWindow: cfg.rateLimitForgotWindowSeconds * 1000,
      keyGenerator: (req: FastifyRequest) => {
        const body = req.body as { email?: unknown } | undefined;
        const email = typeof body?.email === 'string' ? body.email : '';
        return `f:${req.ip}:${emailHash(cfg.refreshPepper, email)}`;
      },
    }),
  );

  const tenMinutes = 600_000;
  const userKey = (prefix: string) => (req: FastifyRequest) => `${prefix}:${req.ctx?.user.id ?? req.ip}`;
  const uploadLimiter = wrapLimiter(createRateLimit({ max: cfg.imports.rateLimitUploadMax, timeWindow: tenMinutes, keyGenerator: userKey('u') }));
  const exportLimiter = wrapLimiter(createRateLimit({ max: cfg.imports.rateLimitExportMax, timeWindow: tenMinutes, keyGenerator: userKey('e') }));
  const platformLimiter = wrapLimiter(createRateLimit({ max: cfg.rateLimitPlatformMax, timeWindow: tenMinutes, keyGenerator: userKey('p') }));
  const intelligenceLimiter = wrapLimiter(createRateLimit({ max: cfg.rateLimitIntelligenceMax, timeWindow: tenMinutes, keyGenerator: userKey('i') }));

  const deps: AuthDeps = {
    cfg,
    base,
    jwt: new JwtService(cfg.jwtSecret),
    hasher: new PasswordHasher({ memoryKib: cfg.argon2MemoryKib, timeCost: cfg.argon2TimeCost }),
    mailer: cfg.mailTransport === 'outbox' ? new OutboxMailer() : new SesMailer(),
    log: app.log,
  };

  const onForbidden = makeOnForbidden(base);
  const flags = new FlagService(base, cfg.flags.cacheTtlMs);
  app.decorate('flags', flags);

  registerSecurityPipeline(app, {
    cfg,
    limiters: {
      global: globalLimiter,
      auth: authLimiter,
      upload: uploadLimiter,
      export: exportLimiter,
      platform: platformLimiter,
      intelligence: intelligenceLimiter,
    },
    authenticate: (token, meta) => authenticateAccessToken(deps, token, meta),
    onForbidden,
  });
  registerSecurityHeaders(app, cfg);

  app.setErrorHandler((err: unknown, req, reply) => {
    const httpErr = toHttpError(err);
    if (httpErr.statusCode >= 500) {
      const kind = err instanceof TenantScopeError ? 'tenant_scope_violation' : (err as Error | undefined)?.name ?? 'unknown';
      req.log.error({ errorKind: kind, code: (err as { code?: unknown } | undefined)?.code }, 'request failed');
    }
    sendError(reply, req, httpErr);
  });
  app.setNotFoundHandler((req, reply) => sendError(reply, req, errors.notFound()));

  registerHealthRoutes(app, base);
  registerAuthRoutes(app, deps, forgotLimiter);
  registerUserRoutes(app, deps);
  registerAuditRoutes(app);
  registerClaimRoutes(app);
  registerPlatformRoutes(app, base);
  registerDevOutbox(app, deps);

  // Step 3: imports (sandboxed parsing, per-tenant object storage) and exports.
  const objectStore = opts.overrides?.objectStore ?? ObjectStore.fromConfig(cfg);
  const imp = cfg.imports;
  const parseExecutor =
    opts.overrides?.parseExecutor ??
    new ChildProcessExecutor(
      {
        workerEntry: imp.workerEntry,
        timeoutMs: imp.parseTimeoutMs,
        memoryMb: imp.parseMemoryMb,
        maxConcurrency: imp.parseMaxConcurrency,
        queueTimeoutMs: imp.parseQueueTimeoutMs,
        maxOutputBytes: imp.parseMaxOutputBytes,
        limits: { pdfPages: imp.parseMaxPdfPages, textChars: imp.parseMaxTextChars, imagePixels: imp.parseMaxImagePixels },
        threshold: imp.reviewConfidenceThreshold,
      },
      (e) => app.log.info({ event: 'parse_job', ...e }, 'parse job finished'),
    );
  const importDeps: ImportDeps = {
    cfg,
    store: objectStore,
    executor: parseExecutor,
    uploadGate: new KeyedGate(imp.uploadMaxConcurrentPerTenant),
    exportGate: new KeyedGate(imp.exportMaxConcurrentPerTenant),
    verifyWrites: cfg.nodeEnv === 'production',
    now: opts.overrides?.now ?? (() => new Date()),
    log: app.log,
  };
  registerImportRoutes(app, importDeps);
  registerExportRoutes(app, importDeps);

  // Step 4: Dev dashboard (platform) routes R60-R68.
  const now = opts.overrides?.now ?? (() => new Date());
  registerPlatformDashboardRoutes(app, {
    base,
    flags,
    staleSeconds: imp.staleSeconds,
    parserCounters: () => (parseExecutor instanceof ChildProcessExecutor ? parseExecutor.counters : ZERO_PARSER_COUNTERS),
    now,
  });
  // Step 4: Recovery Intelligence routes R70-R73 (tenant data only).
  registerIntelligenceRoutes(app, {
    flags,
    policy: { pendingWeightPercent: cfg.intelligence.pendingWeightPercent, similarCandidateLimit: cfg.intelligence.similarCandidateLimit },
    now,
    toHttpError,
  });

  app.addHook('onClose', async () => {
    await base.$disconnect();
    if (redis) redis.disconnect();
    if (objectStore instanceof ObjectStore) objectStore.destroy();
  });

  return app;
}

export { ERROR_MESSAGES };
