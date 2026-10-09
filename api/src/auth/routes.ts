/** Auth routes R3-R15 (C3). */
import {
  ChangePasswordBody,
  EmptyBody,
  EnrollStartBody,
  EnrollVerifyBody,
  ForgotBody,
  InviteAcceptBody,
  InviteInspectBody,
  LoginBody,
  MfaVerifyBody,
  ResetBody,
  permissionsFor,
} from '@fr/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { errors } from '../http/errors.js';
import { defineRoute, requireCtx, userRole } from '../http/route.js';
import type { Limiter } from '../http/security.js';

import { clearCsrfCookie, clearRefreshCookie, issueCsrfCookie, REFRESH_COOKIE, setRefreshCookie } from './cookies.js';
import type { AuthDeps, RequestMeta } from './deps.js';
import {
  acceptInvite,
  changePassword,
  enrollStart,
  enrollVerify,
  forgotPassword,
  inspectInvite,
  login,
  mfaVerify,
  resetPassword,
  type SessionResult,
} from './service.js';
import { logoutWithRefreshToken, mintAccessToken, rotateRefreshToken, toSessionUser } from './session.js';

const P = '/api/v1';

function meta(req: FastifyRequest): RequestMeta {
  const ua = req.headers['user-agent'];
  return { ip: req.ip, requestId: req.frRequestId, userAgent: typeof ua === 'string' ? ua : undefined };
}

function sendSession(reply: FastifyReply, deps: AuthDeps, s: SessionResult) {
  setRefreshCookie(reply, deps.cfg, s.refreshToken);
  issueCsrfCookie(reply, deps.cfg);
  return { status: 'ok' as const, accessToken: s.accessToken, tokenType: 'Bearer' as const, expiresIn: s.expiresIn, user: s.user };
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps, forgotLimiter: Limiter | null): void {
  defineRoute(app, {
    method: 'GET',
    url: `${P}/auth/csrf`,
    access: { kind: 'public' },
    handler: async (_req, reply) => ({ csrfToken: issueCsrfCookie(reply, deps.cfg) }),
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/auth/login`,
    access: { kind: 'public' },
    rateGroup: 'auth',
    schema: { body: LoginBody },
    handler: async (req, reply, { body }) => {
      const r = await login(deps, body.email, body.password, meta(req));
      if (r.status === 'ok') return sendSession(reply, deps, r);
      return r;
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/auth/mfa/verify`,
    access: { kind: 'public' },
    rateGroup: 'auth',
    schema: { body: MfaVerifyBody },
    handler: async (req, reply, { body }) => {
      const input = 'code' in body ? { mfaToken: body.mfaToken, code: body.code } : { mfaToken: body.mfaToken, recoveryCode: body.recoveryCode };
      return sendSession(reply, deps, await mfaVerify(deps, input, meta(req)));
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/auth/mfa/enroll/start`,
    access: { kind: 'public' },
    rateGroup: 'auth',
    schema: { body: EnrollStartBody },
    handler: async (_req, _reply, { body }) => enrollStart(deps, body.enrollToken),
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/auth/mfa/enroll/verify`,
    access: { kind: 'public' },
    rateGroup: 'auth',
    schema: { body: EnrollVerifyBody },
    handler: async (req, reply, { body }) => {
      const r = await enrollVerify(deps, body, meta(req));
      return { ...sendSession(reply, deps, r), recoveryCodes: r.recoveryCodes };
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/auth/refresh`,
    access: { kind: 'cookie-session' },
    rateGroup: 'auth',
    schema: { body: EmptyBody },
    handler: async (req, reply) => {
      const presented = req.cookies[REFRESH_COOKIE] ?? '';
      const r = presented ? await rotateRefreshToken(deps, presented, meta(req)) : ({ kind: 'invalid' } as const);
      if (r.kind !== 'ok') {
        clearRefreshCookie(reply, deps.cfg);
        throw errors.unauthenticated();
      }
      setRefreshCookie(reply, deps.cfg, r.refreshToken);
      issueCsrfCookie(reply, deps.cfg);
      return {
        accessToken: await mintAccessToken(deps, r.user.id, r.familyId),
        tokenType: 'Bearer' as const,
        expiresIn: deps.cfg.accessTokenTtlSeconds,
        user: toSessionUser(r.user),
      };
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/auth/logout`,
    access: { kind: 'cookie-session' },
    schema: { body: EmptyBody },
    handler: async (req, reply) => {
      const presented = req.cookies[REFRESH_COOKIE] ?? '';
      if (presented) await logoutWithRefreshToken(deps, presented, meta(req));
      clearRefreshCookie(reply, deps.cfg);
      clearCsrfCookie(reply, deps.cfg);
      return reply.code(204).send();
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/auth/forgot`,
    access: { kind: 'public' },
    rateGroup: 'auth',
    schema: { body: ForgotBody },
    handler: async (req, reply, { body }) => {
      if (deps.cfg.rateLimitEnabled && forgotLimiter) {
        const r = await forgotLimiter(req);
        if (!r.allowed) throw errors.rateLimited(r.retryAfterSeconds);
      }
      await forgotPassword(deps, body.email, meta(req));
      return reply.code(202).send({ status: 'accepted' });
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/auth/reset`,
    access: { kind: 'public' },
    rateGroup: 'auth',
    schema: { body: ResetBody },
    handler: async (req, reply, { body }) => {
      await resetPassword(deps, body.token, body.password, meta(req));
      return reply.code(204).send();
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/auth/invites/inspect`,
    access: { kind: 'public' },
    rateGroup: 'auth',
    schema: { body: InviteInspectBody },
    handler: async (_req, _reply, { body }) => inspectInvite(deps, body.token),
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/auth/invites/accept`,
    access: { kind: 'public' },
    rateGroup: 'auth',
    schema: { body: InviteAcceptBody },
    handler: async (req, reply, { body }) => {
      await acceptInvite(deps, body, meta(req));
      return reply.code(204).send();
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: `${P}/auth/change-password`,
    access: { kind: 'authenticated' },
    schema: { body: ChangePasswordBody },
    handler: async (req, reply, { body }) => {
      const ctx = requireCtx(req);
      await changePassword(deps, { userId: ctx.user.id, sessionId: ctx.sessionId }, body.currentPassword, body.newPassword, meta(req));
      return reply.code(204).send();
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: `${P}/me`,
    access: { kind: 'authenticated' },
    handler: async (req) => {
      const ctx = requireCtx(req);
      return {
        user: {
          id: ctx.user.id,
          email: ctx.user.email,
          name: ctx.user.name,
          role: ctx.role,
          tenant: ctx.tenantId && ctx.tenantName ? { id: ctx.tenantId, name: ctx.tenantName } : null,
          mfaEnabled: ctx.user.mfaEnabled,
        },
        permissions: [...permissionsFor(userRole(ctx))],
      };
    },
  });
}
