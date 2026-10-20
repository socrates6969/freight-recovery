/**
 * REQ-20261018-exec-dashboard: executive insights routes (read-only). Tenant users holding `insights:read`
 * (OWNER, ADMIN, MANAGER, VIEWER) only; no API-key scope, so keys are refused by the pipeline. Each handler
 * reads through ONE read-only REPEATABLE READ tenant transaction, assembles the body in service.ts and
 * returns it parsed with the strict shared schema. Reads are not audited (like GET /api/v1/claims), and no
 * handler writes anything. Tenant and role come only from the request context.
 */
import {
  DD_DISPUTE_MIN_DAYS,
  InsightsDeadlines,
  InsightsDeadlinesQuery,
  InsightsLeakage,
  InsightsLeakageQuery,
  InsightsStages,
  InsightsStagesQuery,
  InsightsSummary,
  InsightsSummaryQuery,
  InsightsThroughput,
  InsightsThroughputQuery,
} from '@fr/shared';
import type { FastifyInstance } from 'fastify';

import { analysisFailureCounts } from '../audit/analysis-failures.js';
import {
  ageingRows,
  approvalWeeks,
  claimsByStatus,
  ddShareTotals,
  deadlineRows,
  firstDecisionDurations,
  insightsRead,
  intakeCounts,
  periodMoney,
  sendReadyDurations,
  type InsightsFilter,
  type InsightsPeriod,
} from '../db/insights.js';
import { carrierHeader, carrierLeakage, ruleLeakage } from '../db/insights-leakage.js';
import { defineRoute, requireTenant } from '../http/route.js';
import { strictBody } from '../http/strict-body.js';

import { carrierBody, deadlinesBody, ruleBody, stagesBody, summaryBody, throughputBody } from './service.js';

const P = '/api/v1';

export interface InsightsDeps {
  now: () => Date;
}

function filterOf(q: { kind?: InsightsFilter['kind'] | undefined; perspective?: InsightsFilter['perspective'] | undefined }): InsightsFilter {
  return { kind: q.kind ?? null, perspective: q.perspective ?? null };
}

export function registerInsightsRoutes(app: FastifyInstance, deps: InsightsDeps): void {
  // M1-M7, S1, T4.
  defineRoute(app, {
    method: 'GET',
    url: `${P}/insights/summary`,
    access: { kind: 'permission', permission: 'insights:read' },
    rateGroup: 'intelligence',
    schema: { query: InsightsSummaryQuery },
    handler: async (req, _reply, { query }) => {
      const ctx = requireTenant(req);
      const now = deps.now();
      const f = filterOf(query);
      const period: InsightsPeriod = { from: query.from, to: query.to };
      const body = await insightsRead(ctx.db, async (tx) => {
        const statusRows = await claimsByStatus(tx, f);
        const money = await periodMoney(tx, f, period);
        const dd = await ddShareTotals(tx, f);
        const age = await ageingRows(tx, f, now);
        return summaryBody(now, period, f, statusRows, money, dd, age);
      });
      return strictBody(InsightsSummary, body);
    },
  });

  // S1-S4 (S3 and S4 only with a period).
  defineRoute(app, {
    method: 'GET',
    url: `${P}/insights/stages`,
    access: { kind: 'permission', permission: 'insights:read' },
    rateGroup: 'intelligence',
    schema: { query: InsightsStagesQuery },
    handler: async (req, _reply, { query }) => {
      const ctx = requireTenant(req);
      const now = deps.now();
      const f = filterOf(query);
      const period: InsightsPeriod | null = query.from !== undefined && query.to !== undefined ? { from: query.from, to: query.to } : null;
      const body = await insightsRead(ctx.db, async (tx) => {
        const statusRows = await claimsByStatus(tx, f);
        const age = await ageingRows(tx, f, now);
        const intake = await intakeCounts(tx, period);
        const failures = period === null ? null : await analysisFailureCounts(tx, period, f);
        return stagesBody(now, period, f, statusRows, age, intake, failures);
      });
      return strictBody(InsightsStages, body);
    },
  });

  // D1, D2 (no period).
  defineRoute(app, {
    method: 'GET',
    url: `${P}/insights/deadlines`,
    access: { kind: 'permission', permission: 'insights:read' },
    rateGroup: 'intelligence',
    schema: { query: InsightsDeadlinesQuery },
    handler: async (req, _reply, { query }) => {
      const ctx = requireTenant(req);
      const now = deps.now();
      const f = filterOf(query);
      const rows = await insightsRead(ctx.db, (tx) => deadlineRows(tx, f, now, DD_DISPUTE_MIN_DAYS));
      return strictBody(InsightsDeadlines, deadlinesBody(now, f, rows));
    },
  });

  // L1 (by=carrier), L2 (by=rule), L3 (by=rule with carrier).
  defineRoute(app, {
    method: 'GET',
    url: `${P}/insights/leakage`,
    access: { kind: 'permission', permission: 'insights:read' },
    rateGroup: 'intelligence',
    schema: { query: InsightsLeakageQuery },
    handler: async (req, _reply, { query }) => {
      const ctx = requireTenant(req);
      const now = deps.now();
      const f = filterOf(query);
      const period: InsightsPeriod = { from: query.from, to: query.to };
      const body = await insightsRead(ctx.db, async (tx) => {
        if (query.by === 'carrier') {
          const { totals, rows } = await carrierLeakage(tx, f, period, query.limit);
          return carrierBody(now, period, f, query.limit, totals, rows);
        }
        const carrier = query.carrier ?? null;
        const header = carrier === null ? null : await carrierHeader(tx, f, period, carrier);
        const rows = await ruleLeakage(tx, f, period, carrier);
        return ruleBody(now, period, f, header, rows);
      });
      return strictBody(InsightsLeakage, body);
    },
  });

  // T1, T2, T3, T5.
  defineRoute(app, {
    method: 'GET',
    url: `${P}/insights/throughput`,
    access: { kind: 'permission', permission: 'insights:read' },
    rateGroup: 'intelligence',
    schema: { query: InsightsThroughputQuery },
    handler: async (req, _reply, { query }) => {
      const ctx = requireTenant(req);
      const now = deps.now();
      const f = filterOf(query);
      const period: InsightsPeriod = { from: query.from, to: query.to };
      const body = await insightsRead(ctx.db, async (tx) => {
        const weekRows = await approvalWeeks(tx, f, period);
        const first = await firstDecisionDurations(tx, f, period);
        const send = await sendReadyDurations(tx, f, period);
        return throughputBody(now, period, f, weekRows, first, send);
      });
      return strictBody(InsightsThroughput, body);
    },
  });
}
