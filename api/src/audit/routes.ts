/** R24 GET /audit/events and R25 GET /audit/verify (this tenant's chain only). */
import { AuditEventsQuery } from '@fr/shared';
import type { FastifyInstance } from 'fastify';

import { defineRoute, requireTenant } from '../http/route.js';

import { appendAudit, listAuditEvents, verifyChain } from './audit.js';

export function registerAuditRoutes(app: FastifyInstance): void {
  defineRoute(app, {
    method: 'GET',
    url: '/api/v1/audit/events',
    access: { kind: 'permission', permission: 'audit:read' },
    schema: { query: AuditEventsQuery },
    handler: async (req, _reply, { query }) => {
      const ctx = requireTenant(req);
      return ctx.db.tx((tx) => listAuditEvents(tx, ctx.tenantId, query));
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/api/v1/audit/verify',
    access: { kind: 'permission', permission: 'audit:read' },
    handler: async (req) => {
      const ctx = requireTenant(req);
      // Verify first, then record the verification (so the check is not self-referential).
      const result = await ctx.db.tx((tx) => verifyChain(tx, ctx.tenantId));
      await ctx.db.tx((tx) =>
        appendAudit(tx, {
          tenantId: ctx.tenantId,
          action: 'audit.verify',
          actorId: ctx.user.id,
          actorRole: ctx.role,
          targetType: 'audit_chain',
          targetId: ctx.tenantId,
          metadata: { valid: result.valid, eventsChecked: result.eventsChecked, brokenAtSeq: result.brokenAtSeq },
          ip: req.ip,
          requestId: req.frRequestId,
        }),
      );
      return result;
    },
  });
}
