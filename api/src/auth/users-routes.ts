/**
 * User management R16-R23 (tenant-scoped; users are global rows, so this lives in the auth module with
 * system-mode access and EXPLICIT tenant filters on every membership/invite query).
 */
import {
  IdParams,
  InviteCreateBody,
  PageQuery,
  ReasonBody,
  RoleChangeBody,
  canAssignRole,
  canManageUserWithRole,
  type Role,
} from '@fr/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { appendAudit } from '../audit/audit.js';
import { isUuid } from '../db/errors.js';
import { scopeSystemTxToTenant, withSystemTx, type SystemTx } from '../db/system.js';
import { HttpError, errors } from '../http/errors.js';
import { defineRoute, requireTenant } from '../http/route.js';
import { hmacSha256Hex, normalizeEmail, randomOpaqueToken } from '../security/crypto.js';

import type { AuthDeps } from './deps.js';
import { MailDeliveryError, deliverMail } from './mailer.js';
import { revokeUserSessionsTx } from './session.js';

const P = '/api/v1';

type TenantCtx = ReturnType<typeof requireTenant>;

function auditBase(ctx: TenantCtx, req: FastifyRequest) {
  return { tenantId: ctx.tenantId, actorId: ctx.user.id, actorRole: ctx.role, ip: req.ip, requestId: req.frRequestId };
}

/** Load the subject's membership in the actor's tenant (404 for unknown ids and other tenants alike). */
async function loadSubject(tx: SystemTx, tenantId: string, userId: string) {
  if (!isUuid(userId)) throw errors.notFound();
  const m = await tx.membership.findFirst({
    where: { tenantId, userId },
    include: { user: { select: { id: true, status: true, email: true } } },
  });
  if (!m) throw errors.notFound();
  return m;
}

async function activeOwnerCount(tx: SystemTx, tenantId: string): Promise<number> {
  return tx.membership.count({ where: { tenantId, role: 'OWNER', user: { status: 'ACTIVE' } } });
}

function assertCanManage(ctx: TenantCtx, subjectUserId: string, subjectRole: Role): void {
  if (subjectUserId === ctx.user.id) throw errors.forbidden();
  if (!canManageUserWithRole(ctx.role, subjectRole, ctx.permissions)) throw errors.forbidden();
}

function inviteStatus(i: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now: Date): string {
  if (i.acceptedAt) return 'accepted';
  if (i.revokedAt) return 'revoked';
  if (i.expiresAt <= now) return 'expired';
  return 'pending';
}

export function registerUserRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const sys = <T>(tenantId: string, fn: (tx: SystemTx) => Promise<T>) =>
    withSystemTx(deps.base, async (tx) => {
      await scopeSystemTxToTenant(tx, tenantId);
      return fn(tx);
    });

  defineRoute(app, {
    method: 'GET',
    url: `${P}/users`,
    access: { kind: 'permission', permission: 'users:read' },
    schema: { query: PageQuery },
    handler: async (req, _reply, { query }) => {
      const ctx = requireTenant(req);
      return sys(ctx.tenantId, async (tx) => {
        const where = { tenantId: ctx.tenantId };
        const total = await tx.membership.count({ where });
        const rows = await tx.membership.findMany({
          where,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            user: {
              select: { id: true, email: true, name: true, status: true, lastLoginAt: true, createdAt: true, mfaSecret: { select: { verifiedAt: true } } },
            },
          },
        });
        return {
          items: rows.map((m) => ({
            id: m.user.id,
            email: m.user.email,
            name: m.user.name,
            role: m.role,
            status: m.user.status,
            mfaEnabled: Boolean(m.user.mfaSecret?.verifiedAt),
            lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
            createdAt: m.user.createdAt.toISOString(),
          })),
          page: query.page,
          pageSize: query.pageSize,
          total,
        };
      });
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/users/invites`,
    access: { kind: 'permission', permission: 'users:manage' },
    schema: { body: InviteCreateBody },
    handler: async (req, reply, { body }) => {
      const ctx = requireTenant(req);
      if (!canAssignRole(ctx.role, body.role, ctx.permissions)) throw errors.forbidden();
      const email = normalizeEmail(body.email);
      const token = randomOpaqueToken();
      const now = new Date();
      const invite = await sys(ctx.tenantId, async (tx) => {
        const existingUser = await tx.user.findUnique({ where: { email }, select: { id: true } });
        if (existingUser) throw errors.conflict();
        const pending = await tx.invite.findFirst({
          where: { tenantId: ctx.tenantId, email, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
          select: { id: true },
        });
        if (pending) throw errors.conflict();
        // An expired-but-unrevoked invite would block the partial unique index: retire it first.
        await tx.invite.updateMany({
          where: { tenantId: ctx.tenantId, email, acceptedAt: null, revokedAt: null },
          data: { revokedAt: now },
        });
        const created = await tx.invite.create({
          data: {
            tenantId: ctx.tenantId,
            email,
            role: body.role,
            tokenHash: hmacSha256Hex(deps.cfg.refreshPepper, token),
            invitedById: ctx.user.id,
            expiresAt: new Date(now.getTime() + deps.cfg.inviteTtlSeconds * 1000),
          },
        });
        // Delivery failure throws MailDeliveryError: the whole transaction (invite row) rolls back.
        await deliverMail(deps.mailer, tx, { kind: 'INVITE', to: email, token, tenantId: ctx.tenantId });
        await appendAudit(tx, {
          ...auditBase(ctx, req),
          action: 'invite.created',
          targetType: 'invite',
          targetId: created.id,
          metadata: { inviteId: created.id, role: body.role },
        });
        return created;
      }).catch((e: unknown) => {
        if (!(e instanceof MailDeliveryError)) throw e;
        // Rolled back already; fail cleanly with a fixed message (no transport details).
        req.log.error({ event: 'mail_delivery_failed', kind: 'invite' }, 'invite email could not be delivered');
        throw new HttpError(503, 'service_unavailable', { message: 'Invitations cannot be delivered right now. Try again later.' });
      });
      return reply.code(201).send({ id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt.toISOString() });
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: `${P}/users/invites`,
    access: { kind: 'permission', permission: 'users:read' },
    handler: async (req) => {
      const ctx = requireTenant(req);
      const now = new Date();
      const rows = await sys(ctx.tenantId, (tx) =>
        tx.invite.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 200 }),
      );
      return {
        items: rows.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          createdAt: i.createdAt.toISOString(),
          expiresAt: i.expiresAt.toISOString(),
          status: inviteStatus(i, now),
        })),
      };
    },
  });

  defineRoute(app, {
    method: 'DELETE',
    url: `${P}/users/invites/:id`,
    access: { kind: 'permission', permission: 'users:manage' },
    schema: { params: IdParams },
    handler: async (req, reply, { params }) => {
      const ctx = requireTenant(req);
      await sys(ctx.tenantId, async (tx) => {
        if (!isUuid(params.id)) throw errors.notFound();
        const invite = await tx.invite.findFirst({ where: { id: params.id, tenantId: ctx.tenantId } });
        if (!invite) throw errors.notFound();
        if (invite.acceptedAt) throw errors.conflict();
        if (invite.revokedAt) return;
        await tx.invite.updateMany({ where: { id: invite.id, tenantId: ctx.tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
        await appendAudit(tx, {
          ...auditBase(ctx, req),
          action: 'invite.revoked',
          targetType: 'invite',
          targetId: invite.id,
          metadata: { inviteId: invite.id, role: invite.role },
        });
      });
      return reply.code(204).send();
    },
  });

  defineRoute(app, {
    method: 'PATCH',
    url: `${P}/users/:id/role`,
    access: { kind: 'permission', permission: 'users:manage' },
    schema: { params: IdParams, body: RoleChangeBody },
    handler: async (req, _reply, { params, body }) => {
      const ctx = requireTenant(req);
      return sys(ctx.tenantId, async (tx) => {
        const subject = await loadSubject(tx, ctx.tenantId, params.id);
        assertCanManage(ctx, subject.userId, subject.role);
        if (!canAssignRole(ctx.role, body.role, ctx.permissions)) throw errors.forbidden();
        if (subject.role === 'OWNER' && subject.user.status === 'ACTIVE' && (await activeOwnerCount(tx, ctx.tenantId)) <= 1) {
          throw errors.conflict();
        }
        if (subject.role !== body.role) {
          await tx.membership.updateMany({ where: { id: subject.id, tenantId: ctx.tenantId }, data: { role: body.role } });
          await appendAudit(tx, {
            ...auditBase(ctx, req),
            action: 'user.role_changed',
            targetType: 'user',
            targetId: subject.userId,
            metadata: { fromRole: subject.role, toRole: body.role, reason: body.reason },
          });
        }
        return { id: subject.userId, role: body.role };
      });
    },
  });

  const statusChange = (url: string, target: 'DISABLED' | 'ACTIVE') =>
    defineRoute(app, {
      method: 'POST',
      url,
      access: { kind: 'permission', permission: 'users:manage' },
      schema: { params: IdParams, body: ReasonBody },
      handler: async (req, _reply, { params, body }) => {
        const ctx = requireTenant(req);
        return sys(ctx.tenantId, async (tx) => {
          const subject = await loadSubject(tx, ctx.tenantId, params.id);
          assertCanManage(ctx, subject.userId, subject.role);
          if (target === 'DISABLED') {
            if (subject.role === 'OWNER' && subject.user.status === 'ACTIVE' && (await activeOwnerCount(tx, ctx.tenantId)) <= 1) {
              throw errors.conflict();
            }
            if (subject.user.status !== 'DISABLED') {
              await tx.user.update({ where: { id: subject.userId }, data: { status: 'DISABLED' } });
            }
            const revoked = await revokeUserSessionsTx(tx, subject.userId, 'user_disabled');
            await appendAudit(tx, {
              ...auditBase(ctx, req),
              action: 'user.disabled',
              targetType: 'user',
              targetId: subject.userId,
              metadata: { reason: body.reason, sessionsRevoked: revoked },
            });
          } else {
            if (subject.user.status !== 'ACTIVE') {
              await tx.user.update({ where: { id: subject.userId }, data: { status: 'ACTIVE' } });
            }
            await appendAudit(tx, {
              ...auditBase(ctx, req),
              action: 'user.enabled',
              targetType: 'user',
              targetId: subject.userId,
              metadata: { reason: body.reason },
            });
          }
          return { id: subject.userId, status: target };
        });
      },
    });
  statusChange(`${P}/users/:id/disable`, 'DISABLED');
  statusChange(`${P}/users/:id/enable`, 'ACTIVE');

  defineRoute(app, {
    method: 'POST',
    url: `${P}/users/:id/mfa/reset`,
    access: { kind: 'permission', permission: 'users:manage' },
    schema: { params: IdParams, body: ReasonBody },
    handler: async (req, _reply, { params, body }) => {
      const ctx = requireTenant(req);
      return sys(ctx.tenantId, async (tx) => {
        const subject = await loadSubject(tx, ctx.tenantId, params.id);
        assertCanManage(ctx, subject.userId, subject.role);
        await tx.mfaRecoveryCode.deleteMany({ where: { userId: subject.userId } });
        await tx.mfaSecret.deleteMany({ where: { userId: subject.userId } });
        const revoked = await revokeUserSessionsTx(tx, subject.userId, 'mfa_reset');
        await appendAudit(tx, {
          ...auditBase(ctx, req),
          action: 'user.mfa_reset',
          targetType: 'user',
          targetId: subject.userId,
          metadata: { reason: body.reason, sessionsRevoked: revoked },
        });
        return { id: subject.userId, mfaEnabled: false };
      });
    },
  });
}
