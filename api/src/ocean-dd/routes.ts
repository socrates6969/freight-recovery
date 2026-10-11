/**
 * Step 8 ocean D&D routes (REQ-20261011-ocean-dd, Part C C12, C13, C16, C19). Tenant users only; no API-key
 * scope (an API key gets 403). Each handler first checks the `intelligence.ocean_dd` flag (OFF or a read
 * error -> the standard 404) after the pipeline's authentication, rate bucket, permission and schema
 * checks, like the step-6/7 routes. Bodies are parsed with the strict shared schemas; responses with
 * `strictBody`. The audit route uses the per-user `analysis` bucket, all others `intelligence`.
 */
import {
  DdAuditResponse,
  DdCalendarData,
  DdCalendarList,
  DdCalendarPutBody,
  DdCalendarView,
  DdInvoiceBody,
  DdInvoiceDetail,
  DdInvoiceList,
  DdInvoiceListQuery,
  DdInvoicePutBody,
  DdListQuery,
  DdTariffData,
  DdTariffList,
  DdTariffPutBody,
  DdTariffView,
  EmptyBody,
  IdParams,
} from '@fr/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Actor } from '../claims/service.js';
import { errors } from '../http/errors.js';
import { defineRoute, requireTenant, userRole } from '../http/route.js';
import { strictBody } from '../http/strict-body.js';
import type { FlagService } from '../platform/flags.js';

import { runDdAudit } from './audit-run.js';
import { createCalendar, createInvoice, createTariff, deleteInvoice, getInvoice, listCalendars, listInvoices, listTariffs, updateCalendar, updateInvoice, updateTariff } from './service.js';

const P = '/api/v1/dd';
const FLAG = 'intelligence.ocean_dd';

export interface OceanDdRouteDeps {
  flags: FlagService;
}

function actorOf(req: FastifyRequest): Actor {
  const ctx = requireTenant(req);
  return { userId: ctx.user.id, role: userRole(ctx), ip: req.ip, requestId: req.frRequestId };
}

export function registerOceanDdRoutes(app: FastifyInstance, deps: OceanDdRouteDeps): void {
  const requireFlag = async (): Promise<void> => {
    let on = false;
    try {
      on = await deps.flags.isEnabled(FLAG);
    } catch {
      on = false;
    }
    if (!on) throw errors.notFound();
  };

  // Tariffs
  defineRoute(app, {
    method: 'GET',
    url: `${P}/tariffs`,
    access: { kind: 'permission', permission: 'claims:read' },
    rateGroup: 'intelligence',
    schema: { query: DdListQuery },
    handler: async (req, _reply, { query }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      return strictBody(DdTariffList, await listTariffs(ctx.db, query));
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/tariffs`,
    access: { kind: 'permission', permission: 'dd_tariffs:manage' },
    rateGroup: 'intelligence',
    schema: { body: DdTariffData },
    handler: async (req, reply, { body }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      const view = strictBody(DdTariffView, await createTariff(ctx.db, actorOf(req), body));
      return reply.code(201).send(view);
    },
  });

  defineRoute(app, {
    method: 'PUT',
    url: `${P}/tariffs/:id`,
    access: { kind: 'permission', permission: 'dd_tariffs:manage' },
    rateGroup: 'intelligence',
    schema: { params: IdParams, body: DdTariffPutBody },
    handler: async (req, _reply, { params, body }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      return strictBody(DdTariffView, await updateTariff(ctx.db, actorOf(req), params.id, body));
    },
  });

  // Calendars
  defineRoute(app, {
    method: 'GET',
    url: `${P}/calendars`,
    access: { kind: 'permission', permission: 'claims:read' },
    rateGroup: 'intelligence',
    schema: { query: DdListQuery },
    handler: async (req, _reply, { query }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      return strictBody(DdCalendarList, await listCalendars(ctx.db, query));
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/calendars`,
    access: { kind: 'permission', permission: 'dd_tariffs:manage' },
    rateGroup: 'intelligence',
    schema: { body: DdCalendarData },
    handler: async (req, reply, { body }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      const view = strictBody(DdCalendarView, await createCalendar(ctx.db, actorOf(req), body));
      return reply.code(201).send(view);
    },
  });

  defineRoute(app, {
    method: 'PUT',
    url: `${P}/calendars/:id`,
    access: { kind: 'permission', permission: 'dd_tariffs:manage' },
    rateGroup: 'intelligence',
    schema: { params: IdParams, body: DdCalendarPutBody },
    handler: async (req, _reply, { params, body }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      return strictBody(DdCalendarView, await updateCalendar(ctx.db, actorOf(req), params.id, body));
    },
  });

  // Invoices
  defineRoute(app, {
    method: 'GET',
    url: `${P}/invoices`,
    access: { kind: 'permission', permission: 'claims:read' },
    rateGroup: 'intelligence',
    schema: { query: DdInvoiceListQuery },
    handler: async (req, _reply, { query }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      return strictBody(DdInvoiceList, await listInvoices(ctx.db, query));
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/invoices`,
    access: { kind: 'permission', permission: 'dd_invoices:manage' },
    rateGroup: 'intelligence',
    schema: { body: DdInvoiceBody },
    handler: async (req, reply, { body }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      const detail = strictBody(DdInvoiceDetail, await createInvoice(ctx.db, actorOf(req), body));
      return reply.code(201).send(detail);
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: `${P}/invoices/:id`,
    access: { kind: 'permission', permission: 'claims:read' },
    rateGroup: 'intelligence',
    schema: { params: IdParams },
    handler: async (req, _reply, { params }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      return strictBody(DdInvoiceDetail, await getInvoice(ctx.db, params.id));
    },
  });

  defineRoute(app, {
    method: 'PUT',
    url: `${P}/invoices/:id`,
    access: { kind: 'permission', permission: 'dd_invoices:manage' },
    rateGroup: 'intelligence',
    schema: { params: IdParams, body: DdInvoicePutBody },
    handler: async (req, _reply, { params, body }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      return strictBody(DdInvoiceDetail, await updateInvoice(ctx.db, actorOf(req), params.id, body));
    },
  });

  defineRoute(app, {
    method: 'DELETE',
    url: `${P}/invoices/:id`,
    access: { kind: 'permission', permission: 'dd_invoices:manage' },
    rateGroup: 'intelligence',
    schema: { params: IdParams },
    handler: async (req, reply, { params }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      await deleteInvoice(ctx.db, actorOf(req), params.id);
      return reply.code(204).send();
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/invoices/:id/audit`,
    access: { kind: 'permission', permission: 'claims:analyze' },
    rateGroup: 'analysis',
    schema: { params: IdParams, body: EmptyBody },
    handler: async (req, reply, { params }) => {
      const ctx = requireTenant(req);
      await requireFlag();
      const actor = actorOf(req);
      const out = await ctx.db.tx((tx) => runDdAudit(tx, ctx.db.tenantId, params.id, actor));
      return reply.code(201).send(strictBody(DdAuditResponse, out));
    },
  });
}
