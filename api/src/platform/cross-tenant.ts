/**
 * The ONLY path that lets a caller choose a tenant other than its own (SUPER_ADMIN support access).
 * One transaction: scope to the target tenant, append `platform.cross_tenant_read` to the TARGET
 * tenant's own audit chain FIRST (any failure aborts), then run the read. Read-only by construction:
 * callers pass read functions; the audit row and the read commit together.
 */
import type { Role } from '@fr/shared';

import { appendAudit } from '../audit/audit.js';
import type { BaseClient } from '../db/client.js';
import { isUuid } from '../db/errors.js';
import { withSystemTx } from '../db/system.js';
import { withTenantTx, type TenantTx } from '../db/tenant.js';
import { errors } from '../http/errors.js';

export interface CrossTenantActor {
  userId: string;
  role: Role;
  ip: string;
  requestId: string;
}

export async function crossTenantRead<T>(
  base: BaseClient,
  actor: CrossTenantActor,
  targetTenantId: string,
  reason: string,
  metadata: Record<string, unknown>,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (actor.role !== 'SUPER_ADMIN') throw errors.forbidden();
  if (!isUuid(targetTenantId)) throw errors.notFound();
  const exists = await withSystemTx(base, (tx) => tx.tenant.findUnique({ where: { id: targetTenantId }, select: { id: true } }));
  if (!exists) throw errors.notFound();
  return withTenantTx(base, targetTenantId, async (tx) => {
    await appendAudit(tx, {
      tenantId: targetTenantId,
      action: 'platform.cross_tenant_read',
      actorId: actor.userId,
      actorRole: actor.role,
      targetType: 'tenant',
      targetId: targetTenantId,
      metadata: { ...metadata, reason, targetTenantId },
      ip: actor.ip,
      requestId: actor.requestId,
    });
    return fn(tx);
  });
}
