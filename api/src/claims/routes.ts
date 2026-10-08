/**
 * Claims, packets and approvals routes R26-R34. No mailer, HTTP client or AWS client is imported here:
 * "send" only marks a demand send-ready (asserted by api/test/send-no-egress.test.ts).
 */
import {
  ApproveBody,
  ApprovalsQuery,
  AssignBody,
  ClaimsQuery,
  IdParams,
  PacketQuery,
  RevisionBody,
  TransitionBody,
} from '@fr/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { defineRoute, requireTenant } from '../http/route.js';

import { assignClaim, createRevision, getClaim, getPacket, listApprovalQueue, listClaims, transition, type Actor } from './service.js';

const P = '/api/v1';

function actorOf(req: FastifyRequest): Actor {
  const ctx = requireTenant(req);
  return { userId: ctx.user.id, role: ctx.role, ip: req.ip, requestId: req.frRequestId };
}

export function registerClaimRoutes(app: FastifyInstance): void {
  defineRoute(app, {
    method: 'GET',
    url: `${P}/claims`,
    access: { kind: 'permission', permission: 'claims:read' },
    schema: { query: ClaimsQuery },
    handler: async (req, _reply, { query }) => requireTenant(req).db.tx((tx) => listClaims(tx, query)),
  });

  defineRoute(app, {
    method: 'GET',
    url: `${P}/claims/:id`,
    access: { kind: 'permission', permission: 'claims:read' },
    schema: { params: IdParams },
    handler: async (req, _reply, { params }) => requireTenant(req).db.tx((tx) => getClaim(tx, params.id)),
  });

  defineRoute(app, {
    method: 'GET',
    url: `${P}/claims/:id/packet`,
    access: { kind: 'permission', permission: 'claims:read' },
    schema: { params: IdParams, query: PacketQuery },
    handler: async (req, _reply, { params, query }) =>
      requireTenant(req).db.tx((tx) => getPacket(tx, params.id, query.revision, actorOf(req))),
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/claims/:id/assign`,
    access: { kind: 'permission', permission: 'claims:assign' },
    schema: { params: IdParams, body: AssignBody },
    handler: async (req, _reply, { params, body }) =>
      requireTenant(req).db.tx((tx) => assignClaim(tx, params.id, body.assigneeId, actorOf(req))),
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/claims/:id/packet/revisions`,
    access: { kind: 'permission', permission: 'packets:edit' },
    schema: { params: IdParams, body: RevisionBody },
    handler: async (req, reply, { params, body }) => {
      const r = await requireTenant(req).db.tx((tx) => createRevision(tx, params.id, body, actorOf(req)));
      return reply.code(201).send(r);
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/claims/:id/packet/approve`,
    access: { kind: 'permission', permission: 'packets:approve' },
    schema: { params: IdParams, body: ApproveBody },
    handler: async (req, _reply, { params, body }) =>
      requireTenant(req).db.tx((tx) => transition(tx, 'approve', params.id, body, actorOf(req))),
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/claims/:id/packet/reject`,
    access: { kind: 'permission', permission: 'packets:approve' },
    schema: { params: IdParams, body: TransitionBody },
    handler: async (req, _reply, { params, body }) =>
      requireTenant(req).db.tx((tx) => transition(tx, 'reject', params.id, body, actorOf(req))),
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/claims/:id/packet/send`,
    access: { kind: 'permission', permission: 'demands:send' },
    schema: { params: IdParams, body: TransitionBody },
    handler: async (req, _reply, { params, body }) =>
      requireTenant(req).db.tx((tx) => transition(tx, 'send', params.id, body, actorOf(req))),
  });

  defineRoute(app, {
    method: 'GET',
    url: `${P}/approvals`,
    access: { kind: 'permission', permission: 'claims:read' },
    schema: { query: ApprovalsQuery },
    handler: async (req, _reply, { query }) => requireTenant(req).db.tx((tx) => listApprovalQueue(tx, query)),
  });
}
