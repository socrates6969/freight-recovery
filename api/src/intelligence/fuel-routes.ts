/**
 * Step 7 fuel-check routes (REQ-20261011-fuel-outlook, Part C F6, F10-F12). Tenant users only; no API-key
 * scope. Each handler first checks the `intelligence.fuel_check` flag (OFF -> the standard 404) after the
 * pipeline's authentication, `intelligence` rate bucket, permission and schema checks, exactly like the
 * step-6 charge routes. Bodies are parsed with the strict shared schemas; responses with `strictBody`.
 */
import { FscTable, FscTableBody, FscTableList, FscTablesQuery, FuelCheckView, IdParams, SetFuelInputsBody, SetFuelInputsResponse, UpdateFscTableBody } from '@fr/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Actor } from '../claims/service.js';
import { errors } from '../http/errors.js';
import { defineRoute, requireTenant, userRole } from '../http/route.js';
import { strictBody } from '../http/strict-body.js';
import type { FlagService } from '../platform/flags.js';
import { dieselSeriesOrNull, type PriceStore } from '../platform/price-store.js';

import { archiveTable, clearInputs, createTable, fuelCheck, listTables, setInputs, updateTable } from './fuel.js';
import { auditViewed } from './routes.js';

const P = '/api/v1';
const FLAG = 'intelligence.fuel_check';
const CHARGE_FLAG = 'intelligence.charge_suggestions';

export interface FuelRouteDeps {
  flags: FlagService;
  prices: PriceStore;
}

function actorOf(req: FastifyRequest): Actor {
  const ctx = requireTenant(req);
  return { userId: ctx.user.id, role: userRole(ctx), ip: req.clientIp, requestId: req.frRequestId };
}

export function registerFuelRoutes(app: FastifyInstance, deps: FuelRouteDeps): void {
  const requireFlag = async (): Promise<void> => {
    if (!(await deps.flags.isEnabled(FLAG))) throw errors.notFound();
  };

  defineRoute(app, {
    method: 'GET',
    url: `${P}/fuel-tables`,
    access: { kind: 'permission', permission: 'claims:read' },
    rateGroup: 'intelligence',
    schema: { query: FscTablesQuery },
    handler: async (req, _reply, { query }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      return strictBody(FscTableList, await listTables(ctx.db, query.includeArchived));
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/fuel-tables`,
    access: { kind: 'permission', permission: 'settings:manage' },
    rateGroup: 'intelligence',
    schema: { body: FscTableBody },
    handler: async (req, reply, { body }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      const table = strictBody(FscTable, await createTable(ctx.db, actorOf(req), body));
      return reply.code(201).send(table);
    },
  });

  defineRoute(app, {
    method: 'PUT',
    url: `${P}/fuel-tables/:id`,
    access: { kind: 'permission', permission: 'settings:manage' },
    rateGroup: 'intelligence',
    schema: { params: IdParams, body: UpdateFscTableBody },
    handler: async (req, _reply, { params, body }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      return strictBody(FscTable, await updateTable(ctx.db, actorOf(req), params.id, body));
    },
  });

  defineRoute(app, {
    method: 'DELETE',
    url: `${P}/fuel-tables/:id`,
    access: { kind: 'permission', permission: 'settings:manage' },
    rateGroup: 'intelligence',
    schema: { params: IdParams },
    handler: async (req, reply, { params }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      await archiveTable(ctx.db, actorOf(req), params.id);
      return reply.code(204).send();
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: `${P}/claims/:id/fuel-check`,
    access: { kind: 'permission', permission: 'claims:read' },
    rateGroup: 'intelligence',
    schema: { params: IdParams },
    handler: async (req, _reply, { params }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      const charges = await deps.flags.isEnabled(CHARGE_FLAG);
      // Read before the tenant transaction (cached per import; a store error is price_unavailable, never 500).
      const series = await dieselSeriesOrNull(deps.prices);
      const body = strictBody(FuelCheckView, await fuelCheck(ctx.db, params.id, series, charges));
      await auditViewed(req, { kind: 'fuel_check', claimId: body.claimId, status: body.result.status }, { type: 'claim', id: body.claimId });
      return body;
    },
  });

  defineRoute(app, {
    method: 'PUT',
    url: `${P}/claims/:id/fuel-inputs`,
    access: { kind: 'permission', permission: 'claims:analyze' },
    rateGroup: 'intelligence',
    schema: { params: IdParams, body: SetFuelInputsBody },
    handler: async (req, _reply, { params, body }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      return strictBody(SetFuelInputsResponse, await setInputs(ctx.db, actorOf(req), params.id, body));
    },
  });

  defineRoute(app, {
    method: 'DELETE',
    url: `${P}/claims/:id/fuel-inputs`,
    access: { kind: 'permission', permission: 'claims:analyze' },
    rateGroup: 'intelligence',
    schema: { params: IdParams },
    handler: async (req, reply, { params }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      await clearInputs(ctx.db, actorOf(req), params.id);
      return reply.code(204).send();
    },
  });
}
