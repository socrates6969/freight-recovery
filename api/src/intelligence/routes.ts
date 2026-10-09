/**
 * Recovery Intelligence routes R70-R73 (Q3). Tenant users with `claims:read` only (platform users get
 * 403 from the permission check before any query). Each feature route first checks its flag through
 * FlagService (OFF -> the standard 404, before any data access), computes from this tenant's data, records
 * component telemetry, appends `intelligence.viewed` to the tenant chain (own transaction; a failure is a
 * 500 with no data) and returns a body parsed with the strict shared schema.
 */
import {
  FEATURE_FLAGS,
  FeaturesResponse,
  IdParams,
  Provenance,
  SimilarQuery,
  SimilarResponse,
  Worklist,
  WorklistQuery,
  type ComponentId,
} from '@fr/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { appendAudit } from '../audit/audit.js';
import { errors, type HttpError } from '../http/errors.js';
import { defineRoute, requireTenant } from '../http/route.js';
import { strictBody } from '../http/strict-body.js';
import type { FlagService } from '../platform/flags.js';

import { buildWorklist, findSimilar, provenanceFor, similarTarget, type IntelligencePolicy } from './service.js';

const P = '/api/v1';

export interface IntelligenceDeps {
  flags: FlagService;
  policy: IntelligencePolicy;
  now: () => Date;
  toHttpError: (e: unknown) => HttpError;
}

async function auditViewed(req: FastifyRequest, metadata: Record<string, unknown>, target: { type: string; id: string | null }): Promise<void> {
  const ctx = requireTenant(req);
  await ctx.db.tx((tx) =>
    appendAudit(tx, {
      tenantId: ctx.tenantId,
      action: 'intelligence.viewed',
      actorId: ctx.user.id,
      actorRole: ctx.role,
      targetType: target.type,
      targetId: target.id,
      metadata,
      ip: req.ip,
      requestId: req.frRequestId,
    }),
  );
}

/** Run the scoring step and record it as one component call (5xx -> error). */
async function measured<T>(app: FastifyInstance, deps: IntelligenceDeps, id: ComponentId, fn: () => Promise<{ body: T; candidates?: number }>): Promise<T> {
  const started = performance.now();
  try {
    const r = await fn();
    app.metrics.observeComponent(id, { durationMs: performance.now() - started, error: false, ...(r.candidates !== undefined ? { candidates: r.candidates } : {}) });
    return r.body;
  } catch (e) {
    const status = deps.toHttpError(e).statusCode;
    if (status >= 500) app.metrics.observeComponent(id, { durationMs: performance.now() - started, error: true });
    throw e;
  }
}

export function registerIntelligenceRoutes(app: FastifyInstance, deps: IntelligenceDeps): void {
  // R70 tenant-visible feature flags (values only).
  defineRoute(app, {
    method: 'GET',
    url: `${P}/features`,
    access: { kind: 'permission', permission: 'claims:read' },
    handler: async (req) => {
      requireTenant(req);
      const flags: Record<string, boolean> = {};
      for (const f of FEATURE_FLAGS) if (f.tenantVisible) flags[f.key] = await deps.flags.isEnabled(f.key);
      return strictBody(FeaturesResponse, { flags });
    },
  });

  // R71 prioritised worklist (priority-v1).
  defineRoute(app, {
    method: 'GET',
    url: `${P}/intelligence/worklist`,
    access: { kind: 'permission', permission: 'claims:read' },
    rateGroup: 'intelligence',
    schema: { query: WorklistQuery },
    handler: async (req, _reply, { query }) => {
      const ctx = requireTenant(req);
      if (!(await deps.flags.isEnabled('intelligence.worklist'))) throw errors.notFound();
      return measured(app, deps, 'priority-v1', async () => {
        const body = strictBody(Worklist, await buildWorklist(ctx.db, query, deps.policy, deps.now()));
        await auditViewed(req, { kind: 'worklist', returned: body.items.length }, { type: 'worklist', id: null });
        return { body };
      });
    },
  });

  // R72 similar past claims (similar-v1).
  defineRoute(app, {
    method: 'GET',
    url: `${P}/claims/:id/similar`,
    access: { kind: 'permission', permission: 'claims:read' },
    rateGroup: 'intelligence',
    schema: { params: IdParams, query: SimilarQuery },
    handler: async (req, _reply, { params, query }) => {
      const ctx = requireTenant(req);
      if (!(await deps.flags.isEnabled('intelligence.similar_claims'))) throw errors.notFound();
      // Unknown or other-tenant ids end here with the standard 404 (not a component call).
      const target = await similarTarget(ctx.db, params.id);
      return measured(app, deps, 'similar-v1', async () => {
        const body = strictBody(SimilarResponse, await findSimilar(ctx.db, target, query.limit, deps.policy));
        await auditViewed(req, { kind: 'similar', claimId: params.id, returned: body.items.length }, { type: 'claim', id: params.id });
        return { body, candidates: body.candidatesConsidered };
      });
    },
  });

  // R73 provenance summary.
  defineRoute(app, {
    method: 'GET',
    url: `${P}/claims/:id/provenance`,
    access: { kind: 'permission', permission: 'claims:read' },
    rateGroup: 'intelligence',
    schema: { params: IdParams },
    handler: async (req, _reply, { params }) => {
      const ctx = requireTenant(req);
      if (!(await deps.flags.isEnabled('intelligence.provenance'))) throw errors.notFound();
      const body = strictBody(Provenance, await provenanceFor(ctx.db, params.id));
      await auditViewed(req, { kind: 'provenance', claimId: params.id, returned: body.documents.length }, { type: 'claim', id: params.id });
      return body;
    },
  });
}
