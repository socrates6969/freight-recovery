/**
 * The request security pipeline, run as ONE global onRequest hook so the observable order is exact (C1):
 *   rate limit -> Origin check -> CSRF (unsafe methods) -> authentication -> permission
 * Body parsing and schema validation happen later (preHandler), so authN/authZ failures win over
 * invalid bodies. Also: security response headers on every response (onSend).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AppConfig } from '../config.js';
import { checkCsrf } from '../security/csrf.js';

import type { RequestCtx, RouteAccess, UserRateGroup } from './context.js';
import { errors } from './errors.js';

export const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface RateCheck {
  allowed: boolean;
  retryAfterSeconds: number;
  /** Hits still allowed in the current window after this one (absent when the limiter does not report it). */
  remaining?: number;
}

/** A rate limiter bucket: `check(req)` counts one hit and reports whether it is allowed. */
export type Limiter = (req: FastifyRequest) => Promise<RateCheck>;

export interface PipelineDeps {
  cfg: AppConfig;
  /**
   * global/auth: per client address, before anything else. upload/export: per authenticated user, a
   * second stage right after authentication (keyed by user id).
   */
  limiters: {
    global: Limiter | null;
    auth: Limiter | null;
    upload?: Limiter | null;
    export?: Limiter | null;
    /** Step 4: R60-R68 (RATE_LIMIT_PLATFORM_MAX) and R71-R73 (RATE_LIMIT_INTELLIGENCE_MAX), per user. */
    platform?: Limiter | null;
    intelligence?: Limiter | null;
  };
  authenticate: (token: string, meta: { ip: string; requestId: string }) => Promise<RequestCtx | null>;
  /**
   * Step 4 (Q13): tenant API key authentication for bearer values starting with `fr_live_`. Returns the
   * request context or throws the fixed 401/403/429 error. Absent -> every key request is 401.
   */
  authenticateApiKey?: (req: FastifyRequest, presented: string, access: RouteAccess | undefined) => Promise<RequestCtx>;
  /** Called once a key-authenticated context exists (audit attribution). */
  onApiKeyContext?: (req: FastifyRequest, ctx: RequestCtx) => void;
  onForbidden: (req: FastifyRequest, ctx: RequestCtx, access: RouteAccess) => Promise<void>;
}

/** Origin policy for unsafe methods: an Origin, if present, must equal APP_ORIGIN; without Origin the
 * request must not be a cross-site fetch per Sec-Fetch-Site. */
export function originAllowed(appOrigin: string, origin: string | undefined, secFetchSite: string | undefined): boolean {
  if (origin !== undefined) return origin === appOrigin;
  return secFetchSite !== 'cross-site';
}

function headerValue(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  if (Array.isArray(v)) return v.length === 1 ? v[0] : '\u0000invalid';
  return v;
}

export const API_KEY_BEARER_PREFIX = 'Bearer fr_live_';

/** A request presents an API key when its Authorization header is `Bearer fr_live_...` (any suffix). */
function presentedApiKey(req: FastifyRequest): string | null {
  const h = headerValue(req, 'authorization');
  if (h === undefined || !h.startsWith(API_KEY_BEARER_PREFIX)) return null;
  return h.slice('Bearer '.length);
}

function bearerToken(req: FastifyRequest): string | null {
  const h = headerValue(req, 'authorization');
  if (!h) return null;
  const m = /^Bearer ([A-Za-z0-9._~+/=-]+)$/u.exec(h);
  return m?.[1] ?? null;
}

function userRateGroup(group: string | undefined): UserRateGroup | null {
  return group === 'upload' || group === 'export' || group === 'platform' || group === 'intelligence' ? group : null;
}

export function registerSecurityPipeline(app: FastifyInstance, deps: PipelineDeps): void {
  app.decorateRequest('ctx', null);
  app.decorateRequest('frRequestId', '');

  app.addHook('onRequest', async (req: FastifyRequest) => {
    req.frRequestId = String(req.id);
    req.ctx = null;
    // 0. API keys are never accepted in URLs (path or query): refuse before anything else is done.
    if (req.url.includes('fr_live_')) throw errors.validation([{ path: 'url', code: 'invalid_string' }]);
    const config = req.routeOptions.config as { access?: RouteAccess; rateGroup?: string } | undefined;

    // 1. Rate limits (global per IP, then the route group's own bucket).
    if (deps.cfg.rateLimitEnabled) {
      if (deps.limiters.global) {
        const r = await deps.limiters.global(req);
        if (!r.allowed) throw errors.rateLimited(r.retryAfterSeconds);
      }
      if (config?.rateGroup === 'auth' && deps.limiters.auth) {
        const r = await deps.limiters.auth(req);
        if (!r.allowed) throw errors.rateLimited(r.retryAfterSeconds);
      }
    }

    const unsafe = UNSAFE_METHODS.has(req.method);
    const apiKey = presentedApiKey(req);
    const access = config?.access;
    if (apiKey !== null) {
      // Machine request: no cookie-derived identity is ever consulted and no CSRF token is needed.
      // 2k. Origin: if present it must equal APP_ORIGIN (any method).
      const origin = headerValue(req, 'origin');
      if (origin !== undefined && origin !== deps.cfg.appOrigin) throw errors.origin();
      // Unknown URL: the standard 404 (no route, nothing to authenticate against).
      if (!access) return;
      if (!deps.authenticateApiKey) throw errors.unauthenticated();
      const ctx = await deps.authenticateApiKey(req, apiKey, access);
      req.ctx = ctx;
      deps.onApiKeyContext?.(req, ctx);
      await userStageLimit(req, config?.rateGroup);
      if (access.kind === 'permission' && !ctx.permissions.has(access.permission)) {
        await deps.onForbidden(req, ctx, access);
        throw errors.forbidden();
      }
      return;
    }

    // 2. Origin check.
    if (unsafe && !originAllowed(deps.cfg.appOrigin, headerValue(req, 'origin'), headerValue(req, 'sec-fetch-site'))) {
      throw errors.origin();
    }
    // 3. CSRF double-submit check.
    if (unsafe) {
      const cookie = req.cookies['fr_csrf'];
      const header = headerValue(req, 'x-csrf-token');
      if (!checkCsrf(deps.cfg.csrfSecret, cookie, header)) {
        req.log.warn({ route: req.routeOptions.url ?? 'unknown' }, 'csrf rejected');
        throw errors.csrf();
      }
    }

    if (!access || access.kind === 'public' || access.kind === 'cookie-session') return;

    // 4. Authentication (Bearer access token; state reloaded from the database).
    const token = bearerToken(req);
    if (!token) throw errors.unauthenticated();
    const ctx = await deps.authenticate(token, { ip: req.ip, requestId: req.frRequestId });
    if (!ctx) throw errors.unauthenticated();
    req.ctx = ctx;

    // 4b. Per-user rate limit for upload/export/platform/intelligence routes (second stage; needs the
    // authenticated user).
    await userStageLimit(req, config?.rateGroup);

    // 5. Permission.
    if (access.kind === 'permission' && !ctx.permissions.has(access.permission)) {
      await deps.onForbidden(req, ctx, access);
      throw errors.forbidden();
    }
  });

  async function userStageLimit(req: FastifyRequest, group: string | undefined): Promise<void> {
    const userGroup = userRateGroup(group);
    if (deps.cfg.rateLimitEnabled && userGroup) {
      const limiter = deps.limiters[userGroup];
      if (limiter) {
        const r = await limiter(req);
        if (!r.allowed) throw errors.rateLimited(r.retryAfterSeconds);
      }
    }
  }
}

/** API security headers (C1), emitted on every response including errors. */
export function securityHeaders(cfg: AppConfig): Record<string, string> {
  const h: Record<string, string> = {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'cross-origin-resource-policy': 'same-origin',
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  };
  if (cfg.hstsMaxAgeSeconds > 0) h['strict-transport-security'] = `max-age=${cfg.hstsMaxAgeSeconds}; includeSubDomains`;
  return h;
}

const STRIPPED_HEADERS = ['x-powered-by', 'server', 'access-control-allow-origin', 'access-control-allow-credentials'];

export function registerSecurityHeaders(app: FastifyInstance, cfg: AppConfig): void {
  const headers = securityHeaders(cfg);
  app.addHook('onSend', async (req: FastifyRequest, reply: FastifyReply, payload) => {
    for (const [k, v] of Object.entries(headers)) reply.header(k, v);
    reply.header('x-request-id', req.frRequestId || String(req.id));
    for (const h of STRIPPED_HEADERS) reply.removeHeader(h);
    return payload;
  });
}
