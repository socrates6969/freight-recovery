/**
 * Feature flags (Q4, A5.4): registry-bound global flags stored in `feature_flags`. Reads go through a
 * per-instance cache with TTL FLAGS_CACHE_TTL_MS (0 disables caching); any read error yields OFF (fail
 * closed) and a failure is cached for at most 1 s. Changes run in ONE system transaction: row lock,
 * optimistic version check, update (version + 1), platform audit event; the cache of this instance is
 * invalidated after commit. Tenant code reads flags ONLY through this service. A flag never gates an
 * authentication, CSRF, tenant-isolation, rate-limit or audit code path.
 */
import { FEATURE_FLAGS, isKnownFlag, plain, type FeatureFlagDto, type FeatureFlagKey } from '@fr/shared';

import { appendAudit } from '../audit/audit.js';
import type { BaseClient } from '../db/client.js';
import { lockFeatureFlag, withSystemTx, type SystemTx } from '../db/system.js';
import { errors } from '../http/errors.js';

const FAILURE_CACHE_MS = 1000;

export interface FlagActor {
  userId: string;
  role: string;
  ip: string;
  requestId: string;
}

export interface FlagChange {
  enabled: boolean;
  expectedVersion: number;
  reason: string;
}

interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

type FlagRow = {
  key: string;
  enabled: boolean;
  version: number;
  updatedAt: Date | null;
  lastReason: string | null;
  updatedBy: { id: string; name: string } | null;
};

const FLAG_SELECT = {
  key: true,
  enabled: true,
  version: true,
  updatedAt: true,
  lastReason: true,
  updatedBy: { select: { id: true, name: true } },
} as const;

function toDto(row: FlagRow): FeatureFlagDto {
  const def = FEATURE_FLAGS.find((f) => f.key === row.key);
  if (!def) throw new Error('flag row outside the registry');
  return {
    key: row.key,
    description: def.description,
    enabled: row.enabled,
    defaultEnabled: def.defaultEnabled,
    tenantVisible: def.tenantVisible,
    version: row.version,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    updatedBy: row.updatedBy ? { id: row.updatedBy.id, name: row.updatedBy.name } : null,
    lastReason: row.lastReason,
  };
}

/**
 * The reason is single-line text; it is stored as given (trimmed) only when the shared `plain()`
 * sanitizer would not change it beyond trimming (no control/bidi characters, no `<`, `>` or backticks,
 * no double spaces). Otherwise the request is invalid.
 */
export function validFlagReason(reason: string): string {
  const trimmed = reason.trim();
  if (plain(trimmed, 500) !== trimmed) throw errors.validation([{ path: 'reason', code: 'invalid_string' }]);
  return trimmed;
}

export class FlagService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly base: BaseClient,
    private readonly cacheTtlMs: number,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  /** Current value of a registry flag; OFF when unknown, missing or unreadable (fail closed). */
  async isEnabled(key: FeatureFlagKey): Promise<boolean> {
    if (!isKnownFlag(key)) return false;
    const now = this.nowMs();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now) return hit.value;
    try {
      const row = await withSystemTx(this.base, (tx) => tx.featureFlag.findUnique({ where: { key }, select: { enabled: true } }));
      const value = row?.enabled === true;
      if (this.cacheTtlMs > 0) this.cache.set(key, { value, expiresAt: now + this.cacheTtlMs });
      return value;
    } catch {
      const ttl = Math.min(this.cacheTtlMs, FAILURE_CACHE_MS);
      if (ttl > 0) this.cache.set(key, { value: false, expiresAt: now + ttl });
      else this.cache.delete(key);
      return false;
    }
  }

  /** Values of every registry flag (sequential reads; each fails closed on its own). */
  async snapshot(): Promise<Record<FeatureFlagKey, boolean>> {
    const out = {} as Record<FeatureFlagKey, boolean>;
    for (const f of FEATURE_FLAGS) out[f.key] = await this.isEnabled(f.key);
    return out;
  }

  /** Drop this instance's cached values (after a change). */
  invalidate(key?: string): void {
    if (key === undefined) this.cache.clear();
    else this.cache.delete(key);
  }

  /** R63 body: every registry flag with a stored row, ordered by key. Runs in the caller's system tx. */
  async list(tx: SystemTx): Promise<FeatureFlagDto[]> {
    const rows = await tx.featureFlag.findMany({ where: { key: { in: FEATURE_FLAGS.map((f) => f.key) } }, select: FLAG_SELECT, orderBy: { key: 'asc' } });
    return rows.map((r) => toDto(r as FlagRow));
  }

  /** R64. Registry lookup happens before any database access (unknown key -> 404). */
  async change(actor: FlagActor, key: string, change: FlagChange): Promise<FeatureFlagDto> {
    if (!isKnownFlag(key)) throw errors.notFound();
    const reason = validFlagReason(change.reason);
    const dto = await withSystemTx(this.base, async (tx) => {
      const row = await lockFeatureFlag(tx, key);
      if (!row) throw errors.invalidState();
      if (row.version !== change.expectedVersion) throw errors.staleRevision();
      if (row.enabled === change.enabled) throw errors.conflict();
      const version = row.version + 1;
      const updated = await tx.featureFlag.update({
        where: { key },
        data: { enabled: change.enabled, version, updatedById: actor.userId, updatedAt: new Date(this.nowMs()), lastReason: reason },
        select: FLAG_SELECT,
      });
      await appendAudit(tx, {
        tenantId: null,
        action: 'platform.flag_changed',
        actorId: actor.userId,
        actorRole: actor.role,
        targetType: 'feature_flag',
        targetId: key,
        metadata: { key, from: row.enabled, to: change.enabled, version, reason },
        ip: actor.ip,
        requestId: actor.requestId,
      });
      return toDto(updated as FlagRow);
    });
    this.invalidate(key);
    return dto;
  }
}
