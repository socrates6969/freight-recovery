/**
 * Fix round 1 (REQ-20261012-hardening, C11, P2): the ONE derived client address of a request.
 *
 * With `CLIENT_IP_HEADER = cloudfront-viewer-address`, a request that carries `x-origin-verify` equal to
 * `ORIGIN_VERIFY_SECRET` (constant-time comparison) and a well-formed `cloudfront-viewer-address`
 * (`<ip>:<port>`, split at the LAST colon, optional brackets, valid IPv4/IPv6 literal, port 1..65535) is
 * attributed to that viewer address. Anything else (unset mode, missing/wrong/malformed headers) falls back to
 * the address derived by the TRUST_PROXY rules (Fastify `req.ip`); a bad header never fails the request.
 * This module is the only place in api/src that reads `req.ip` (architecture test).
 */
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { AppConfig } from '../config.js';

export const ORIGIN_VERIFY_HEADER = 'x-origin-verify';
export const VIEWER_ADDRESS_HEADER = 'cloudfront-viewer-address';
const MAX_PORT = 65535;
/** Upper bound of a viewer-address header value (an IPv6 literal with brackets and port is far shorter). */
const MAX_VIEWER_ADDRESS_LENGTH = 64;

declare module 'fastify' {
  interface FastifyRequest {
    /** Fix round 1 (C11): the derived client address (use this, never `ip`). */
    readonly clientIp: string;
  }
}

/** Constant-time equality of two strings (false for different lengths, without an early content compare). */
export function secretEquals(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    // Same amount of work as a real comparison, then refuse.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** `<ip>:<port>` -> ip (brackets removed), or null when malformed. */
export function parseViewerAddress(value: string): string | null {
  if (value.length === 0 || value.length > MAX_VIEWER_ADDRESS_LENGTH) return null;
  const colon = value.lastIndexOf(':');
  if (colon <= 0) return null;
  let host = value.slice(0, colon);
  const portText = value.slice(colon + 1);
  if (!/^[0-9]{1,5}$/u.test(portText)) return null;
  const port = Number(portText);
  if (port < 1 || port > MAX_PORT) return null;
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  return isIP(host) === 0 ? null : host;
}

function headerValue(req: Pick<FastifyRequest, 'headers'>, name: string): string | null {
  const v = req.headers[name];
  return typeof v === 'string' ? v : null;
}

/** The client address per C11 (see the module comment). */
export function deriveClientIp(
  req: Pick<FastifyRequest, 'headers' | 'ip'>,
  cfg: Pick<AppConfig, 'clientIpHeader' | 'originVerifySecret'>,
): string {
  if (cfg.clientIpHeader !== null && cfg.originVerifySecret !== null) {
    const presented = headerValue(req, ORIGIN_VERIFY_HEADER);
    const viewer = headerValue(req, VIEWER_ADDRESS_HEADER);
    if (presented !== null && viewer !== null && secretEquals(presented, cfg.originVerifySecret)) {
      const ip = parseViewerAddress(viewer);
      if (ip !== null) return ip;
    }
  }
  return req.ip;
}

const CLIENT_IP = Symbol('fr.clientIp');

/**
 * Decorate every request with `clientIp` (computed once, cached) and register the FIRST onRequest hook, which
 * derives it before access enforcement, rate limits and logging of the request's handlers.
 */
export function registerClientIp(app: FastifyInstance, cfg: Pick<AppConfig, 'clientIpHeader' | 'originVerifySecret'>): void {
  app.decorateRequest('clientIp', {
    getter(this: FastifyRequest & { [CLIENT_IP]?: string }): string {
      const cached = this[CLIENT_IP];
      if (cached !== undefined) return cached;
      const ip = deriveClientIp(this, cfg);
      this[CLIENT_IP] = ip;
      return ip;
    },
  });
  app.addHook('onRequest', async (req) => {
    void req.clientIp;
  });
}
