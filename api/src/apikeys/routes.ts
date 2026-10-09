/**
 * API key management routes R80-R82 (Q13). Cookie/JWT users with `apikeys:manage` only (OWNER, ADMIN);
 * none of these routes accepts key authentication (no `apiKeyScope`), platform users get 403. CSRF applies
 * to the unsafe ones. Bodies in and out are parsed with the strict shared schemas.
 */
import { ApiKeyCreated, ApiKeyList, ApiKeyView, CreateApiKeyBody, IdParams, RevokeApiKeyBody } from '@fr/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { defineRoute, requireTenant, userRole } from '../http/route.js';
import { strictBody } from '../http/strict-body.js';

import { createApiKey, listApiKeys, revokeApiKey, type KeyActor, type KeyPolicy } from './service.js';

const P = '/api/v1';

function actorOf(req: FastifyRequest): KeyActor {
  const ctx = requireTenant(req);
  return { userId: ctx.user.id, role: userRole(ctx), permissions: ctx.permissions, ip: req.ip, requestId: req.frRequestId };
}

export function registerApiKeyRoutes(app: FastifyInstance, policy: KeyPolicy, now: () => Date): void {
  defineRoute(app, {
    method: 'POST',
    url: `${P}/api-keys`,
    access: { kind: 'permission', permission: 'apikeys:manage' },
    schema: { body: CreateApiKeyBody },
    handler: async (req, reply, { body }) => {
      const ctx = requireTenant(req);
      const created = await createApiKey(ctx.db, actorOf(req), body, policy, now());
      // The secret leaves the process exactly here; it is never logged (logger scrubs fr_live_ strings).
      return reply.code(201).send(strictBody(ApiKeyCreated, created));
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: `${P}/api-keys`,
    access: { kind: 'permission', permission: 'apikeys:manage' },
    handler: async (req) => {
      const ctx = requireTenant(req);
      actorOf(req);
      return strictBody(ApiKeyList, { items: await listApiKeys(ctx.db, now()) });
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/api-keys/:id/revoke`,
    access: { kind: 'permission', permission: 'apikeys:manage' },
    schema: { params: IdParams, body: RevokeApiKeyBody },
    handler: async (req, _reply, { params, body }) => {
      const ctx = requireTenant(req);
      return strictBody(ApiKeyView, await revokeApiKey(ctx.db, actorOf(req), params.id, body.reason, now()));
    },
  });
}
