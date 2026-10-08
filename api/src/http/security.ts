/**
 * The request security pipeline, run as ONE global onRequest hook so the observable order is exact (C1):
 *   rate limit -> Origin check -> CSRF (unsafe methods) -> authentication -> permission
 * Body parsing and schema validation happen later (preHandler), so authN/authZ failures win over
 * invalid bodies. Also: security response headers on every response (onSend).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AppConfig } from '../config.js';
import { checkCsrf } from '../security/csrf.js';

import type { RequestCtx, RouteAccess } from './context.js';
import { errors } from './errors.js';

export const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface RateCheck {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** A rate limiter bucket: `check(req)` counts one hit and reports whether it is allowed. */
export type Limiter = (req: FastifyRequest) => Promise<RateCheck>;

export interface PipelineDeps {
  cfg: AppConfig;
  limiters: { global: Limiter | null; auth: Limiter | null };
  authenticate: (token: string, meta: { ip: string; requestId: string }) => Promise<RequestCtx | null>;
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

function bearerToken(req: FastifyRequest): string | null {
  const h = headerValue(req, 'authorization');
  if (!h) return null;
  const m = /^Bearer ([A-Za-z0-9._~+/=-]+)$/u.exec(h);
  return m?.[1] ?? null;
}

export function registerSecurityPipeline(app: FastifyInstance, deps: PipelineDeps): void {
  app.decorateRequest('ctx', null);
  app.decorateRequest('frRequestId', '');

  app.addHook('onRequest', async (req: FastifyRequest) => {
    req.frRequestId = String(req.id);
    req.ctx = null;
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

    const access = config?.access;
    if (!access || access.kind === 'public' || access.kind === 'cookie-session') return;

    // 4. Authentication (Bearer access token; state reloaded from the database).
    const token = bearerToken(req);
    if (!token) throw errors.unauthenticated();
    const ctx = await deps.authenticate(token, { ip: req.ip, requestId: req.frRequestId });
    if (!ctx) throw errors.unauthenticated();
    req.ctx = ctx;

    // 5. Permission.
    if (access.kind === 'permission' && !ctx.permissions.has(access.permission)) {
      await deps.onForbidden(req, ctx, access);
      throw errors.forbidden();
    }
  });
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
