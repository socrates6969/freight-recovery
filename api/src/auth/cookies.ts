/**
 * Cookies (C1): `fr_rt` (refresh token; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age)
 * and `fr_csrf` (NOT HttpOnly; Secure; SameSite=Strict; Path=/). Clearing uses the same attributes with
 * Max-Age=0 and an empty value. No other cookies are ever set.
 */
import type { FastifyReply } from 'fastify';

import type { AppConfig } from '../config.js';
import { mintCsrfToken } from '../security/csrf.js';

export const REFRESH_COOKIE = 'fr_rt';
export const CSRF_COOKIE = 'fr_csrf';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export function setRefreshCookie(reply: FastifyReply, cfg: AppConfig, token: string): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: cfg.cookieSecure,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: cfg.refreshTokenTtlSeconds,
  });
}

export function clearRefreshCookie(reply: FastifyReply, cfg: AppConfig): void {
  reply.setCookie(REFRESH_COOKIE, '', {
    httpOnly: true,
    secure: cfg.cookieSecure,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: 0,
  });
}

/** Mint a fresh CSRF token, set it as `fr_csrf`, and return it. */
export function issueCsrfCookie(reply: FastifyReply, cfg: AppConfig): string {
  const token = mintCsrfToken(cfg.csrfSecret);
  reply.setCookie(CSRF_COOKIE, token, { httpOnly: false, secure: cfg.cookieSecure, sameSite: 'strict', path: '/' });
  return token;
}

export function clearCsrfCookie(reply: FastifyReply, cfg: AppConfig): void {
  reply.setCookie(CSRF_COOKIE, '', { httpOnly: false, secure: cfg.cookieSecure, sameSite: 'strict', path: '/', maxAge: 0 });
}
