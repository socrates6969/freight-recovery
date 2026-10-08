/**
 * R38 GET /api/v1/dev/outbox - dev/test only. Registered ONLY when ENABLE_DEV_OUTBOX=true and
 * NODE_ENV!=production; otherwise the route does not exist (404). Production config refuses the flag.
 */
import { DevOutboxQuery } from '@fr/shared';
import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config.js';
import { withSystemTx } from '../db/system.js';
import { defineRoute } from '../http/route.js';
import { normalizeEmail } from '../security/crypto.js';

import type { AuthDeps } from './deps.js';

export function devOutboxEnabled(cfg: AppConfig): boolean {
  return cfg.enableDevOutbox && cfg.nodeEnv !== 'production';
}

export function registerDevOutbox(app: FastifyInstance, deps: AuthDeps): void {
  if (!devOutboxEnabled(deps.cfg)) return;
  defineRoute(app, {
    method: 'GET',
    url: '/api/v1/dev/outbox',
    access: { kind: 'public' },
    schema: { query: DevOutboxQuery },
    handler: async (_req, _reply, { query }) => {
      const rows = await withSystemTx(deps.base, (tx) =>
        tx.mailOutbox.findMany({
          where: query.to ? { toEmail: normalizeEmail(query.to) } : {},
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 50,
        }),
      );
      return {
        items: rows.map((r) => ({
          to: r.toEmail,
          kind: r.kind === 'PASSWORD_RESET' ? 'password_reset' : 'invite',
          token: r.token,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  });
}
