/**
 * Dev dashboard routes R60-R68 (Q3). Platform context only (no tenant id is ever accepted). Every read
 * is audited on the PLATFORM chain in its own system transaction before the body is released (a failed
 * append answers 500 with no data). Every outgoing body is parsed with the strict shared schema first,
 * so a field that is not in the contract can never leave the API (fail closed).
 */
import {
  AuditEventsQuery,
  EvalRunDetail,
  EvalRunList,
  EvalRunsQuery,
  FeatureFlag,
  FeatureFlagList,
  FlagChangeBody,
  FlagParams,
  IdParams,
  LogView,
  LogsQuery,
  PipelineHealth,
  PipelineQuery,
  PlatformAuditPage,
  PlatformAuditVerify,
  Telemetry,
  type AuditAction,
} from '@fr/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { appendAudit, listAuditEvents, verifyChain } from '../audit/audit.js';
import type { BaseClient } from '../db/client.js';
import { platformPipelineStats, withSystemTx } from '../db/system.js';
import { errors } from '../http/errors.js';
import { defineRoute, requireCtx } from '../http/route.js';
import { strictBody } from '../http/strict-body.js';
import type { ParserCounters } from '../observability/metrics.js';

import { getEvalRun, listEvalRuns } from './eval-read.js';
import type { FlagService } from './flags.js';
import { assemblePipelineHealth, windowSeconds } from './pipeline.js';
import { API_VERSION } from './routes.js';

const P = '/api/v1/platform';

export interface DashboardDeps {
  base: BaseClient;
  flags: FlagService;
  staleSeconds: number;
  parserCounters: () => ParserCounters;
  now: () => Date;
}

function platformActor(req: FastifyRequest) {
  const ctx = requireCtx(req);
  // Defense in depth: these routes are reachable only by platform roles (no tenant context).
  if (ctx.tenantId !== null || ctx.db !== null) throw errors.forbidden();
  return { userId: ctx.user.id, role: ctx.role, ip: req.ip, requestId: req.frRequestId };
}

async function auditPlatform(base: BaseClient, req: FastifyRequest, action: AuditAction, metadata: Record<string, unknown>, target?: { type: string; id: string }): Promise<void> {
  const a = platformActor(req);
  await withSystemTx(base, (tx) =>
    appendAudit(tx, {
      tenantId: null,
      action,
      actorId: a.userId,
      actorRole: a.role,
      targetType: target?.type ?? 'platform_dashboard',
      targetId: target?.id ?? null,
      metadata,
      ip: a.ip,
      requestId: a.requestId,
    }),
  );
}

export function registerPlatformDashboardRoutes(app: FastifyInstance, deps: DashboardDeps): void {
  const { base } = deps;

  // R60 pipeline health (all tenants, aggregates only).
  defineRoute(app, {
    method: 'GET',
    url: `${P}/pipeline`,
    access: { kind: 'permission', permission: 'platform:health' },
    rateGroup: 'platform',
    schema: { query: PipelineQuery },
    handler: async (req, _reply, { query }) => {
      platformActor(req);
      const rows = await withSystemTx(base, (tx) => platformPipelineStats(tx, windowSeconds(query.window), deps.staleSeconds));
      const body = strictBody(PipelineHealth, assemblePipelineHealth(rows, query.window, deps.now(), API_VERSION));
      await auditPlatform(base, req, 'platform.dashboard_viewed', { section: 'pipeline', window: query.window });
      return body;
    },
  });

  // R61 request telemetry of THIS instance.
  defineRoute(app, {
    method: 'GET',
    url: `${P}/telemetry`,
    access: { kind: 'permission', permission: 'platform:health' },
    rateGroup: 'platform',
    handler: async (req) => {
      platformActor(req);
      const flags = await deps.flags.snapshot();
      const body = strictBody(
        Telemetry,
        app.metrics.snapshot({
          parser: deps.parserCounters(),
          flags: { 'priority-v1': flags['intelligence.worklist'], 'similar-v1': flags['intelligence.similar_claims'] },
          now: deps.now(),
          startedAt: app.startedAt,
          version: API_VERSION,
          nodeVersion: process.version,
        }),
      );
      await auditPlatform(base, req, 'platform.dashboard_viewed', { section: 'telemetry' });
      return body;
    },
  });

  // R62 recent derived log records of THIS instance.
  defineRoute(app, {
    method: 'GET',
    url: `${P}/logs`,
    access: { kind: 'permission', permission: 'platform:logs' },
    rateGroup: 'platform',
    schema: { query: LogsQuery },
    handler: async (req, _reply, { query }) => {
      platformActor(req);
      const r = app.logRing.query({ level: query.level, limit: query.limit, requestId: query.requestId });
      const body = strictBody(LogView, {
        scope: 'this_instance_recent_window',
        bufferCapacity: app.logRing.capacity,
        returned: r.items.length,
        oldestTime: r.oldestTime,
        items: r.items,
      });
      await auditPlatform(base, req, 'platform.logs_viewed', { level: query.level, limit: query.limit, returned: body.returned });
      return body;
    },
  });

  // R63 feature flags.
  defineRoute(app, {
    method: 'GET',
    url: `${P}/flags`,
    access: { kind: 'permission', permission: 'platform:flags' },
    rateGroup: 'platform',
    handler: async (req) => {
      platformActor(req);
      const items = await withSystemTx(base, (tx) => deps.flags.list(tx));
      const body = strictBody(FeatureFlagList, { items });
      await auditPlatform(base, req, 'platform.dashboard_viewed', { section: 'flags' });
      return body;
    },
  });

  // R64 change a flag (CSRF + Origin enforced by the pipeline; audited in the same transaction).
  defineRoute(app, {
    method: 'PUT',
    url: `${P}/flags/:key`,
    access: { kind: 'permission', permission: 'platform:flags' },
    rateGroup: 'platform',
    schema: { params: FlagParams, body: FlagChangeBody },
    handler: async (req, _reply, { params, body }) => {
      const actor = platformActor(req);
      return strictBody(FeatureFlag, await deps.flags.change(actor, params.key, body));
    },
  });

  // R65 evaluation runs (newest first).
  defineRoute(app, {
    method: 'GET',
    url: `${P}/eval/runs`,
    access: { kind: 'permission', permission: 'platform:eval' },
    rateGroup: 'platform',
    schema: { query: EvalRunsQuery },
    handler: async (req, _reply, { query }) => {
      platformActor(req);
      const items = await withSystemTx(base, (tx) => listEvalRuns(tx, query.limit));
      const body = strictBody(EvalRunList, { items });
      await auditPlatform(base, req, 'platform.dashboard_viewed', { section: 'eval' });
      return body;
    },
  });

  // R66 one evaluation run with its per-case results.
  defineRoute(app, {
    method: 'GET',
    url: `${P}/eval/runs/:id`,
    access: { kind: 'permission', permission: 'platform:eval' },
    rateGroup: 'platform',
    schema: { params: IdParams },
    handler: async (req, _reply, { params }) => {
      platformActor(req);
      const run = await withSystemTx(base, (tx) => getEvalRun(tx, params.id));
      if (!run) throw errors.notFound();
      const body = strictBody(EvalRunDetail, run);
      await auditPlatform(base, req, 'platform.dashboard_viewed', { section: 'eval' }, { type: 'eval_run', id: run.id });
      return body;
    },
  });

  // R67 platform audit chain (newest first).
  defineRoute(app, {
    method: 'GET',
    url: `${P}/audit/events`,
    access: { kind: 'permission', permission: 'platform:audit' },
    rateGroup: 'platform',
    schema: { query: AuditEventsQuery },
    handler: async (req, _reply, { query }) => {
      platformActor(req);
      const page = await withSystemTx(base, (tx) => listAuditEvents(tx, null, query));
      return strictBody(PlatformAuditPage, page);
    },
  });

  // R68 verify the platform chain, then record the verification on it.
  defineRoute(app, {
    method: 'GET',
    url: `${P}/audit/verify`,
    access: { kind: 'permission', permission: 'platform:audit' },
    rateGroup: 'platform',
    handler: async (req) => {
      const a = platformActor(req);
      const result = await withSystemTx(base, (tx) => verifyChain(tx, null), { timeoutMs: 60_000 });
      await withSystemTx(base, (tx) =>
        appendAudit(tx, {
          tenantId: null,
          action: 'audit.verify',
          actorId: a.userId,
          actorRole: a.role,
          targetType: 'audit_chain',
          targetId: 'platform',
          metadata: { valid: result.valid, eventsChecked: result.eventsChecked, brokenAtSeq: result.brokenAtSeq },
          ip: a.ip,
          requestId: a.requestId,
        }),
      );
      return strictBody(PlatformAuditVerify, result);
    },
  });
}
