/**
 * Short-lived JWTs via jose, HS256 pinned. Each purpose has its own HKDF-derived key, `typ` header and
 * audience, so a token minted for one purpose is never accepted for another. Authorization never trusts
 * claims beyond `sub`/`sid`: role and tenant are reloaded from the database on every request.
 */
import { randomUUID } from 'node:crypto';

import { SignJWT, jwtVerify } from 'jose';

import { deriveKey } from './crypto.js';

export type TokenPurpose = 'access' | 'mfa' | 'mfa_enroll';

const ISSUER = 'freight-recovery-api';
const ALG = 'HS256';

const PURPOSES: Record<TokenPurpose, { aud: string; typ: string }> = {
  access: { aud: 'fr-web', typ: 'at+jwt' },
  mfa: { aud: 'fr-mfa', typ: 'mfa+jwt' },
  mfa_enroll: { aud: 'fr-mfa-enroll', typ: 'mfa-enroll+jwt' },
};

export interface VerifiedToken {
  sub: string;
  sid: string | null;
  jti: string;
  iat: number;
  exp: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export class JwtService {
  private readonly keys: Record<TokenPurpose, Uint8Array>;

  constructor(secret: string) {
    this.keys = {
      access: deriveKey(secret, 'access'),
      mfa: deriveKey(secret, 'mfa'),
      mfa_enroll: deriveKey(secret, 'mfa_enroll'),
    };
  }

  async sign(purpose: TokenPurpose, sub: string, ttlSeconds: number, sid?: string): Promise<string> {
    const p = PURPOSES[purpose];
    const now = Math.floor(Date.now() / 1000);
    const payload: Record<string, string> = {};
    if (purpose === 'access') {
      if (!sid) throw new Error('access tokens require a session id');
      payload['sid'] = sid;
    }
    return new SignJWT(payload)
      .setProtectedHeader({ alg: ALG, typ: p.typ })
      .setIssuer(ISSUER)
      .setAudience(p.aud)
      .setSubject(sub)
      .setJti(randomUUID())
      .setIssuedAt(now)
      .setExpirationTime(now + ttlSeconds)
      .sign(this.keys[purpose]);
  }

  /** Returns null for any invalid, expired, wrong-purpose or malformed token (never throws). */
  async verify(purpose: TokenPurpose, token: string): Promise<VerifiedToken | null> {
    if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return null;
    const p = PURPOSES[purpose];
    try {
      const { payload } = await jwtVerify(token, this.keys[purpose], {
        algorithms: [ALG],
        issuer: ISSUER,
        audience: p.aud,
        typ: p.typ,
        requiredClaims: ['sub', 'jti', 'iat', 'exp'],
        clockTolerance: 0,
      });
      const sub = payload.sub;
      const sid = typeof payload['sid'] === 'string' ? payload['sid'] : null;
      if (!sub || !UUID_RE.test(sub) || typeof payload.jti !== 'string') return null;
      if (purpose === 'access' && (!sid || !UUID_RE.test(sid))) return null;
      return { sub, sid, jti: payload.jti, iat: payload.iat ?? 0, exp: payload.exp ?? 0 };
    } catch {
      return null;
    }
  }
}
