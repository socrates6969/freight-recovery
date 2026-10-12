/**
 * Step 6 charge intelligence routes (REQ-20261011-charge-intelligence, Part C C6-C10, C14). Tenant users
 * only; no API-key scope. Each handler first checks the `intelligence.charge_suggestions` flag (OFF -> the
 * standard 404) after the pipeline's authentication, `intelligence` rate bucket, permission and schema
 * checks, exactly like the step-4 intelligence routes. Bodies are parsed with the strict shared schemas.
 */
import { ChargeLabelsList, ChargeLabelsQuery, ChargeLinesResponse, IdParams, SetChargeLabelBody, SetChargeLabelResponse } from '@fr/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Actor } from '../claims/service.js';
import { errors } from '../http/errors.js';
import { defineRoute, requireTenant, userRole } from '../http/route.js';
import { strictBody } from '../http/strict-body.js';
import type { FlagService } from '../platform/flags.js';

import { chargeLines, deleteLabel, listLabels, setLabel } from './charges.js';
import { auditViewed } from './routes.js';

const P = '/api/v1';
const FLAG = 'intelligence.charge_suggestions';

export interface ChargeRouteDeps {
  flags: FlagService;
}

function actorOf(req: FastifyRequest): Actor {
  const ctx = requireTenant(req);
  return { userId: ctx.user.id, role: userRole(ctx), ip: req.clientIp, requestId: req.frRequestId };
}

export function registerChargeRoutes(app: FastifyInstance, deps: ChargeRouteDeps): void {
  const requireFlag = async (): Promise<void> => {
    if (!(await deps.flags.isEnabled(FLAG))) throw errors.notFound();
  };

  defineRoute(app, {
    method: 'GET',
    url: `${P}/claims/:id/charge-lines`,
    access: { kind: 'permission', permission: 'claims:read' },
    rateGroup: 'intelligence',
    schema: { params: IdParams },
    handler: async (req, _reply, { params }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      const body = strictBody(ChargeLinesResponse, await chargeLines(ctx.db, params.id));
      await auditViewed(req, { kind: 'charge_lines', claimId: body.claimId, returned: body.lines.length }, { type: 'claim', id: body.claimId });
      return body;
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: `${P}/charge-labels`,
    access: { kind: 'permission', permission: 'claims:read' },
    rateGroup: 'intelligence',
    schema: { query: ChargeLabelsQuery },
    handler: async (req, _reply, { query }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      return strictBody(ChargeLabelsList, await listLabels(ctx.db, query));
    },
  });

  defineRoute(app, {
    method: 'PUT',
    url: `${P}/charge-labels`,
    access: { kind: 'permission', permission: 'charge_labels:manage' },
    rateGroup: 'intelligence',
    schema: { body: SetChargeLabelBody },
    handler: async (req, _reply, { body }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      return strictBody(SetChargeLabelResponse, await setLabel(ctx.db, actorOf(req), body));
    },
  });

  defineRoute(app, {
    method: 'DELETE',
    url: `${P}/charge-labels/:id`,
    access: { kind: 'permission', permission: 'charge_labels:manage' },
    rateGroup: 'intelligence',
    schema: { params: IdParams },
    handler: async (req, reply, { params }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      await deleteLabel(ctx.db, actorOf(req), params.id);
      return reply.code(204).send();
    },
  });
}
