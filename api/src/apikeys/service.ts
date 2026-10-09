/**
 * Tenant API key management (Q13 R80-R82). Runs in the caller's tenant transaction; every change and its
 * audit event commit together. The plaintext key exists only in the return value of `createApiKey` and is
 * never passed to a logger, error, metric or audit metadata.
 */
import {
  SCOPE_PERMISSION,
  type ApiKeyScope,
  type ApiKeyViewDto,
  type CreateApiKeyInput,
  type Permission,
} from '@fr/shared';

import { appendAudit } from '../audit/audit.js';
import { lockTenantApiKeys } from '../db/apikeys.js';
import { isUuid } from '../db/errors.js';
import type { TenantDb, TenantTx } from '../db/tenant.js';
import { HttpError, errors } from '../http/errors.js';

import { generateKey } from './key-material.js';

export interface KeyPolicy {
  pepper: string;
  maxActive: number;
  defaultTtlDays: number;
  allowNonExpiring: boolean;
}

export interface KeyActor {
  userId: string;
  role: string;
  permissions: ReadonlySet<Permission>;
  ip: string;
  requestId: string;
}

const DAY_MS = 86_400_000;

const VIEW_SELECT = {
  id: true,
  keyId: true,
  name: true,
  scopes: true,
  createdAt: true,
  expiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
  revokeReason: true,
  createdBy: { select: { id: true, name: true } },
  revokedBy: { select: { id: true, name: true } },
} as const;

interface ViewRow {
  id: string;
  keyId: string;
  name: string;
  scopes: string[];
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  revokeReason: string | null;
  createdBy: { id: string; name: string };
  revokedBy: { id: string; name: string } | null;
}

export function toView(r: ViewRow, now: Date): ApiKeyViewDto {
  const status = r.revokedAt ? 'REVOKED' : r.expiresAt && r.expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : 'ACTIVE';
  return {
    id: r.id,
    keyId: `fr_live_${r.keyId}`,
    name: r.name,
    scopes: r.scopes as ApiKeyScope[],
    createdBy: { id: r.createdBy.id, name: r.createdBy.name },
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
    revokedBy: r.revokedBy ? { id: r.revokedBy.id, name: r.revokedBy.name } : null,
    revokeReason: r.revokeReason,
    status,
  };
}

export const quotaExceeded = () => new HttpError(422, 'quota_exceeded', { message: 'API key limit reached.' });

export async function createApiKey(
  db: TenantDb,
  actor: KeyActor,
  input: CreateApiKeyInput,
  policy: KeyPolicy,
  now: Date,
): Promise<{ key: ApiKeyViewDto; secret: string }> {
  for (const s of input.scopes) {
    if (!actor.permissions.has(SCOPE_PERMISSION[s])) throw errors.forbidden();
  }
  let expiresAt: Date | null;
  if (input.expiresInDays === null) {
    if (!policy.allowNonExpiring) throw errors.validation([{ path: 'expiresInDays', code: 'not_allowed' }]);
    expiresAt = null;
  } else {
    expiresAt = new Date(now.getTime() + (input.expiresInDays ?? policy.defaultTtlDays) * DAY_MS);
  }
  const tenantId = db.tenantId;
  return db.tx(async (tx: TenantTx) => {
    await lockTenantApiKeys(tx, tenantId);
    const active = await tx.apiKey.count({ where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } });
    if (active >= policy.maxActive) throw quotaExceeded();
    const generated = generateKey(policy.pepper);
    const row = await tx.apiKey.create({
      data: {
        tenantId,
        keyId: generated.keyId,
        name: input.name,
        secretHash: generated.secretHash,
        scopes: [...input.scopes],
        createdById: actor.userId,
        createdAt: now,
        expiresAt,
      },
      select: VIEW_SELECT,
    });
    await appendAudit(tx, {
      tenantId,
      action: 'apikey.created',
      actorId: actor.userId,
      actorRole: actor.role,
      targetType: 'api_key',
      targetId: row.id,
      metadata: { keyId: generated.keyId, scopes: [...input.scopes], expiresAt: expiresAt ? expiresAt.toISOString() : null },
      ip: actor.ip,
      requestId: actor.requestId,
    });
    return { key: toView(row as ViewRow, now), secret: generated.plaintext };
  });
}

export async function listApiKeys(db: TenantDb, now: Date): Promise<ApiKeyViewDto[]> {
  const rows = await db.tx((tx) => tx.apiKey.findMany({ select: VIEW_SELECT, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }));
  return rows.map((r) => toView(r as ViewRow, now));
}

export async function revokeApiKey(db: TenantDb, actor: KeyActor, id: string, reason: string, now: Date): Promise<ApiKeyViewDto> {
  if (!isUuid(id)) throw errors.notFound();
  const tenantId = db.tenantId;
  return db.tx(async (tx) => {
    const current = await tx.apiKey.findFirst({ where: { id }, select: { id: true, keyId: true, revokedAt: true } });
    if (!current) throw errors.notFound();
    if (current.revokedAt) throw errors.invalidState();
    const changed = await tx.apiKey.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: now, revokedById: actor.userId, revokeReason: reason },
    });
    if (changed.count !== 1) throw errors.invalidState();
    await appendAudit(tx, {
      tenantId,
      action: 'apikey.revoked',
      actorId: actor.userId,
      actorRole: actor.role,
      targetType: 'api_key',
      targetId: id,
      metadata: { keyId: current.keyId, reason },
      ip: actor.ip,
      requestId: actor.requestId,
    });
    const row = await tx.apiKey.findFirst({ where: { id }, select: VIEW_SELECT });
    if (!row) throw errors.notFound();
    return toView(row as ViewRow, now);
  });
}
