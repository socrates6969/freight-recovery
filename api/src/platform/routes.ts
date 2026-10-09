/** Health (R1, R2) and platform routes R35-R37. Platform roles never see tenant claim content except
 * SUPER_ADMIN's reason-gated, audited cross-tenant read (R37). */
import { PlatformClaimsQuery, TenantIdParams } from '@fr/shared';
import type { FastifyInstance } from 'fastify';

import type { BaseClient } from '../db/client.js';
import { pingDb, platformTenantStats, withSystemTx } from '../db/system.js';
import { listClaims } from '../claims/service.js';
import { defineRoute, requireCtx, userRole } from '../http/route.js';

import { crossTenantRead } from './cross-tenant.js';

export const API_VERSION = '0.1.0';

export function registerHealthRoutes(app: FastifyInstance, base: BaseClient): void {
  defineRoute(app, {
    method: 'GET',
    url: '/healthz',
    access: { kind: 'public' },
    handler: async () => ({ status: 'ok' }),
  });
  defineRoute(app, {
    method: 'GET',
    url: '/readyz',
    access: { kind: 'public' },
    handler: async (_req, reply) => {
      if (await pingDb(base)) return { status: 'ready' };
      return reply.code(503).send({ status: 'unavailable' });
    },
  });
}

export function registerPlatformRoutes(app: FastifyInstance, base: BaseClient): void {
  defineRoute(app, {
    method: 'GET',
    url: '/api/v1/platform/health',
    access: { kind: 'permission', permission: 'platform:health' },
    handler: async () => {
      const ok = await pingDb(base);
      return { status: ok ? 'ok' : 'degraded', version: API_VERSION, db: ok ? 'ok' : 'down' };
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/api/v1/platform/tenants',
    access: { kind: 'permission', permission: 'platform:tenants:list' },
    handler: async () => {
      const { tenants, stats } = await withSystemTx(base, async (tx) => ({
        tenants: await tx.tenant.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, name: true, status: true } }),
        stats: await platformTenantStats(tx),
      }));
      return {
        items: tenants.map((t) => ({
          id: t.id,
          name: t.name,
          status: t.status,
          userCount: stats.get(t.id)?.userCount ?? 0,
          claimCount: stats.get(t.id)?.claimCount ?? 0,
        })),
      };
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/api/v1/platform/tenants/:tenantId/claims',
    access: { kind: 'permission', permission: 'platform:cross_tenant_read' },
    schema: { params: TenantIdParams, query: PlatformClaimsQuery },
    handler: async (req, _reply, { params, query }) => {
      const ctx = requireCtx(req);
      const { reason, ...filters } = query;
      return crossTenantRead(
        base,
        { userId: ctx.user.id, role: userRole(ctx), ip: req.ip, requestId: req.frRequestId },
        params.tenantId,
        reason,
        {
          filters: {
            q: filters.q ?? null,
            status: filters.status ?? null,
            perspective: filters.perspective ?? null,
            page: filters.page,
            pageSize: filters.pageSize,
          },
        },
        (tx) => listClaims(tx, filters),
      );
    },
  });
}
