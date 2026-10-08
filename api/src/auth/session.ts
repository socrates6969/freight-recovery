/**
 * Sessions: refresh-token families with rotation and reuse detection (A7 flows 2, 5, 6) and per-request
 * authentication of access tokens (Layer 3: user, role, tenant and session liveness are reloaded from the
 * database on every request; token claims are never trusted for authorization).
 */
import { randomUUID } from 'node:crypto';

import { permissionsFor, type Permission, type Role, type SessionUserDto } from '@fr/shared';

import { appendAudit } from '../audit/audit.js';
import { tenantDb } from '../db/tenant.js';
import { withSystemTx, type SystemTx } from '../db/system.js';
import type { RequestCtx } from '../http/context.js';
import { emailHash, hmacSha256Hex, randomOpaqueToken, sha256Hex } from '../security/crypto.js';

import type { AuthDeps, RequestMeta } from './deps.js';

/** A user row with what authentication and session DTOs need. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  passwordHash: string;
  platformRole: 'PLATFORM_DEV' | 'SUPER_ADMIN' | null;
  membership: { tenantId: string; role: Role; tenant: { id: string; name: string; status: 'ACTIVE' | 'SUSPENDED' } } | null;
  mfaSecret: { verifiedAt: Date | null } | null;
}

export const AUTH_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  status: true,
  passwordHash: true,
  platformRole: true,
  membership: { select: { tenantId: true, role: true, tenant: { select: { id: true, name: true, status: true } } } },
  mfaSecret: { select: { verifiedAt: true } },
} as const;

export function roleOf(u: AuthUser): Role | null {
  if (u.platformRole) return u.platformRole;
  return u.membership?.role ?? null;
}

export function tenantIdOf(u: AuthUser): string | null {
  return u.platformRole ? null : (u.membership?.tenantId ?? null);
}

/** True when the account may hold a session (active user; tenant users need an active tenant). */
export function isUsable(u: AuthUser): boolean {
  if (u.status !== 'ACTIVE') return false;
  if (u.platformRole) return u.membership === null;
  return u.membership !== null && u.membership.tenant.status === 'ACTIVE';
}

export function toSessionUser(u: AuthUser): SessionUserDto {
  const role = roleOf(u);
  if (!role) throw new Error('user has no role');
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role,
    tenant: u.platformRole || !u.membership ? null : { id: u.membership.tenant.id, name: u.membership.tenant.name },
    mfaEnabled: Boolean(u.mfaSecret?.verifiedAt),
  };
}

export function refreshTokenHash(deps: AuthDeps, token: string): string {
  return hmacSha256Hex(deps.cfg.refreshPepper, token);
}

export interface NewSession {
  refreshToken: string;
  familyId: string;
}

/**
 * Create a session inside the caller's system transaction: new refresh family, reset the email's lockout
 * state, stamp lastLoginAt, audit auth.login.success.
 */
export async function createSessionTx(
  deps: AuthDeps,
  tx: SystemTx,
  user: AuthUser,
  meta: RequestMeta,
  extraMeta: Record<string, unknown> = {},
): Promise<NewSession> {
  const now = new Date();
  const familyId = randomUUID();
  const refreshToken = randomOpaqueToken();
  await tx.refreshToken.create({
    data: {
      familyId,
      userId: user.id,
      tokenHash: refreshTokenHash(deps, refreshToken),
      expiresAt: new Date(now.getTime() + deps.cfg.refreshTokenTtlSeconds * 1000),
      familyExpiresAt: new Date(now.getTime() + deps.cfg.refreshFamilyMaxSeconds * 1000),
      ip: meta.ip,
      userAgentHash: meta.userAgent ? sha256Hex(meta.userAgent).slice(0, 32) : null,
    },
  });
  await tx.loginLockout.deleteMany({ where: { emailHash: emailHash(deps.cfg.refreshPepper, user.email) } });
  await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
  await tx.loginAttempt.create({
    data: { emailHash: emailHash(deps.cfg.refreshPepper, user.email), ip: meta.ip, outcome: 'SUCCESS' },
  });
  await appendAudit(tx, {
    tenantId: tenantIdOf(user),
    action: 'auth.login.success',
    actorId: user.id,
    actorRole: roleOf(user),
    targetType: 'user',
    targetId: user.id,
    metadata: { familyId, ...extraMeta },
    ip: meta.ip,
    requestId: meta.requestId,
  });
  return { refreshToken, familyId };
}

export async function mintAccessToken(deps: AuthDeps, userId: string, familyId: string): Promise<string> {
  return deps.jwt.sign('access', userId, deps.cfg.accessTokenTtlSeconds, familyId);
}

/** Revoke every live token of a family. Returns the number revoked. */
export async function revokeFamilyTx(tx: SystemTx, familyId: string, reason: string): Promise<number> {
  const r = await tx.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return r.count;
}

/** Revoke every live session of a user, optionally keeping one family. */
export async function revokeUserSessionsTx(tx: SystemTx, userId: string, reason: string, keepFamilyId?: string): Promise<number> {
  const r = await tx.refreshToken.updateMany({
    where: { userId, revokedAt: null, ...(keepFamilyId ? { NOT: { familyId: keepFamilyId } } : {}) },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return r.count;
}

export type RefreshOutcome =
  | { kind: 'ok'; user: AuthUser; refreshToken: string; familyId: string }
  | { kind: 'reuse' }
  | { kind: 'invalid' };

/** Rotate a refresh token (race-safe); detects reuse of an already-rotated or revoked token. */
export async function rotateRefreshToken(deps: AuthDeps, presented: string, meta: RequestMeta): Promise<RefreshOutcome> {
  if (presented.length === 0 || presented.length > 256) return { kind: 'invalid' };
  const hash = refreshTokenHash(deps, presented);
  return withSystemTx(deps.base, async (tx) => {
    const row = await tx.refreshToken.findUnique({ where: { tokenHash: hash }, include: { user: { select: AUTH_USER_SELECT } } });
    if (!row) return { kind: 'invalid' } as const;
    const user = row.user as AuthUser;
    const now = new Date();
    if (row.usedAt !== null || row.revokedAt !== null) {
      await revokeFamilyTx(tx, row.familyId, 'reuse');
      await appendAudit(tx, {
        tenantId: tenantIdOf(user),
        action: 'auth.refresh_reuse_detected',
        actorId: user.id,
        actorRole: roleOf(user),
        targetType: 'session',
        targetId: row.familyId,
        metadata: { familyId: row.familyId },
        ip: meta.ip,
        requestId: meta.requestId,
      });
      return { kind: 'reuse' } as const;
    }
    if (row.expiresAt <= now || row.familyExpiresAt <= now || !isUsable(user)) return { kind: 'invalid' } as const;
    const claimed = await tx.refreshToken.updateMany({
      where: { id: row.id, usedAt: null, revokedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) {
      // Lost a race with a concurrent rotation of the same token: treat as reuse.
      await revokeFamilyTx(tx, row.familyId, 'reuse');
      await appendAudit(tx, {
        tenantId: tenantIdOf(user),
        action: 'auth.refresh_reuse_detected',
        actorId: user.id,
        actorRole: roleOf(user),
        targetType: 'session',
        targetId: row.familyId,
        metadata: { familyId: row.familyId },
        ip: meta.ip,
        requestId: meta.requestId,
      });
      return { kind: 'reuse' } as const;
    }
    const refreshToken = randomOpaqueToken();
    const expiresAt = new Date(Math.min(now.getTime() + deps.cfg.refreshTokenTtlSeconds * 1000, row.familyExpiresAt.getTime()));
    await tx.refreshToken.create({
      data: {
        familyId: row.familyId,
        userId: user.id,
        tokenHash: refreshTokenHash(deps, refreshToken),
        parentId: row.id,
        expiresAt,
        familyExpiresAt: row.familyExpiresAt,
        ip: meta.ip,
        userAgentHash: meta.userAgent ? sha256Hex(meta.userAgent).slice(0, 32) : null,
      },
    });
    return { kind: 'ok', user, refreshToken, familyId: row.familyId } as const;
  });
}

/** Logout: revoke the family of a currently valid refresh token. Idempotent; never throws for bad input. */
export async function logoutWithRefreshToken(deps: AuthDeps, presented: string, meta: RequestMeta): Promise<void> {
  if (presented.length === 0 || presented.length > 256) return;
  const hash = refreshTokenHash(deps, presented);
  await withSystemTx(deps.base, async (tx) => {
    const row = await tx.refreshToken.findUnique({ where: { tokenHash: hash }, include: { user: { select: AUTH_USER_SELECT } } });
    if (!row || row.usedAt !== null || row.revokedAt !== null) return;
    const n = await revokeFamilyTx(tx, row.familyId, 'logout');
    if (n === 0) return;
    const user = row.user as AuthUser;
    await appendAudit(tx, {
      tenantId: tenantIdOf(user),
      action: 'auth.logout',
      actorId: user.id,
      actorRole: roleOf(user),
      targetType: 'session',
      targetId: row.familyId,
      metadata: { familyId: row.familyId },
      ip: meta.ip,
      requestId: meta.requestId,
    });
  });
}

/**
 * Authenticate a Bearer access token for one request. Returns null for anything invalid (expired,
 * wrong purpose, disabled user, revoked session, suspended tenant). Never distinguishes causes.
 */
export async function authenticateAccessToken(
  deps: AuthDeps,
  token: string,
  meta: { ip: string; requestId: string },
): Promise<RequestCtx | null> {
  const v = await deps.jwt.verify('access', token);
  if (!v || !v.sid) return null;
  const sid = v.sid;
  const loaded = await withSystemTx(deps.base, async (tx) => {
    const user = (await tx.user.findUnique({ where: { id: v.sub }, select: AUTH_USER_SELECT })) as AuthUser | null;
    if (!user || !isUsable(user)) return null;
    const live = await tx.refreshToken.count({
      where: { familyId: sid, userId: user.id, revokedAt: null, familyExpiresAt: { gt: new Date() } },
    });
    return live > 0 ? user : null;
  });
  if (!loaded) return null;
  const role = roleOf(loaded);
  if (!role) return null;
  const tenantId = tenantIdOf(loaded);
  return {
    user: { id: loaded.id, email: loaded.email, name: loaded.name, mfaEnabled: Boolean(loaded.mfaSecret?.verifiedAt) },
    role,
    tenantId,
    tenantName: loaded.membership && !loaded.platformRole ? loaded.membership.tenant.name : null,
    sessionId: sid,
    permissions: new Set<Permission>(permissionsFor(role)),
    db: tenantId ? tenantDb(deps.base, tenantId) : null,
    requestId: meta.requestId,
    ip: meta.ip,
  };
}
