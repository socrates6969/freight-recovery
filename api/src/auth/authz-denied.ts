/** Audits `authz.denied` for every 403 forbidden of an authenticated user (tenant chain; platform users
 * go to the platform chain). The denial itself is still returned if auditing succeeds; an audit failure
 * fails the request (500) rather than silently dropping the record. */
import type { FastifyRequest } from 'fastify';

import { appendAudit } from '../audit/audit.js';
import type { BaseClient } from '../db/client.js';
import { withSystemTx } from '../db/system.js';
import type { RequestCtx, RouteAccess } from '../http/context.js';

export function makeOnForbidden(base: BaseClient) {
  return async (req: FastifyRequest, ctx: RequestCtx, access: RouteAccess): Promise<void> => {
    const metadata = {
      route: req.routeOptions.url ?? 'unknown',
      method: req.method,
      permission: access.kind === 'permission' ? access.permission : null,
    };
    const event = {
      action: 'authz.denied' as const,
      actorId: ctx.user.id,
      actorRole: ctx.role,
      metadata,
      ip: req.ip,
      requestId: req.frRequestId,
    };
    if (ctx.db && ctx.tenantId) {
      const tenantId = ctx.tenantId;
      await ctx.db.tx((tx) => appendAudit(tx, { ...event, tenantId }));
    } else {
      await withSystemTx(base, (tx) => appendAudit(tx, { ...event, tenantId: null }));
    }
  };
}
