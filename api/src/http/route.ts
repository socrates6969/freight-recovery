/**
 * Route declaration helper (A6). Every route states its access policy; the app refuses to boot if a
 * route is registered without one (see `enforceRouteAccess`). Authentication and permission checks run
 * in the global onRequest security pipeline (before body parsing); request validation runs afterwards
 * in preHandler, so a caller lacking permission gets 403 even for an invalid body.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, HTTPMethods, RouteOptions } from 'fastify';
import { type z } from 'zod';

import type { RateGroup, RequestCtx, RouteAccess } from './context.js';
import { HttpError, errors, type ErrorDetail } from './errors.js';

type AnySchema = z.ZodType;

export interface RouteSchemas<B extends AnySchema | undefined, Q extends AnySchema | undefined, P extends AnySchema | undefined> {
  body?: B;
  query?: Q;
  params?: P;
}

type Out<S> = S extends AnySchema ? z.output<S> : undefined;

export interface RouteInput<B, Q, P> {
  body: B;
  query: Q;
  params: P;
}

export interface RouteDef<B extends AnySchema | undefined, Q extends AnySchema | undefined, P extends AnySchema | undefined> {
  method: HTTPMethods;
  url: string;
  access: RouteAccess;
  rateGroup?: RateGroup;
  schema?: RouteSchemas<B, Q, P>;
  handler: (req: FastifyRequest, reply: FastifyReply, input: RouteInput<Out<B>, Out<Q>, Out<P>>) => Promise<unknown>;
}

export function zodDetails(error: z.ZodError): ErrorDetail[] {
  return error.issues.map((i) => ({ path: i.path.map(String).join('.'), code: i.code }));
}

function parseOrThrow(schema: AnySchema | undefined, value: unknown, emptyAsObject: boolean): unknown {
  if (!schema) return undefined;
  const input = value === undefined || value === null ? (emptyAsObject ? {} : value) : value;
  const r = schema.safeParse(input);
  if (!r.success) throw errors.validation(zodDetails(r.error));
  return r.data;
}

export function defineRoute<
  B extends AnySchema | undefined = undefined,
  Q extends AnySchema | undefined = undefined,
  P extends AnySchema | undefined = undefined,
>(app: FastifyInstance, def: RouteDef<B, Q, P>): void {
  const schema = def.schema ?? {};
  const options: RouteOptions = {
    method: def.method,
    url: def.url,
    config: { access: def.access, ...(def.rateGroup ? { rateGroup: def.rateGroup } : {}) },
    preHandler: async (req) => {
      const body = parseOrThrow(schema.body, req.body, true);
      const query = parseOrThrow(schema.query, req.query, true);
      const params = parseOrThrow(schema.params, req.params, true);
      (req as FastifyRequest & { frInput?: unknown }).frInput = { body, query, params };
    },
    handler: async (req, reply) => {
      const input = (req as FastifyRequest & { frInput?: unknown }).frInput as RouteInput<Out<B>, Out<Q>, Out<P>>;
      return def.handler(req, reply, input);
    },
  };
  app.route(options);
}

/** onRoute guard: every route must declare `config.access`. Throws at registration (boot). */
export function enforceRouteAccess(app: FastifyInstance): void {
  app.addHook('onRoute', (route) => {
    const access = (route.config as { access?: RouteAccess } | undefined)?.access;
    const ok =
      access !== undefined &&
      (access.kind === 'public' ||
        access.kind === 'cookie-session' ||
        access.kind === 'authenticated' ||
        (access.kind === 'permission' && typeof access.permission === 'string'));
    if (!ok) {
      throw new Error(`Route ${String(route.method)} ${route.url} has no access declaration`);
    }
  });
}

/** Narrow helper for handlers on authenticated routes. */
export function requireCtx(req: FastifyRequest): RequestCtx {
  if (!req.ctx) throw errors.unauthenticated();
  return req.ctx;
}

/** Narrow helper for tenant routes (platform users never reach these: permission check rejects them). */
export function requireTenant(req: FastifyRequest): RequestCtx & { tenantId: string; db: NonNullable<RequestCtx['db']> } {
  const ctx = requireCtx(req);
  if (!ctx.tenantId || !ctx.db) throw new HttpError(403, 'forbidden');
  return ctx as RequestCtx & { tenantId: string; db: NonNullable<RequestCtx['db']> };
}
