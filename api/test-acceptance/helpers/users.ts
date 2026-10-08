/* eslint-disable */
// Fresh-user factories (invite -> accept -> optional MFA enrollment) so destructive scenarios are repeatable.
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { Client, type Session, makeSession, outboxToken, rawLogin } from './client.js';
import { freshCode } from './totp.js';

export const GOOD_PW = 'Zebra-Quartz-Lantern-7421';

export interface NewUser {
  email: string;
  password: string;
  role: string;
  name: string;
}

export function uniq(prefix = 'u'): string {
  return `${prefix}${randomBytes(4).toString('hex')}`;
}

/** `inviter` must be allowed to invite `role` in its tenant. Returns credentials of the created account. */
export async function newUser(
  app: FastifyInstance,
  inviter: Session,
  role: string,
  password = GOOD_PW,
  domain = 'acme.test',
): Promise<NewUser> {
  const rnd = uniq();
  const email = `fresh-${rnd}-${role.toLowerCase()}@${domain}`;
  const inv = await inviter.post('/users/invites', { email, role });
  expect(inv.status, inv.text).toBe(201);
  const pub = new Client(app, '10.9.9.9');
  const token = await outboxToken(pub, email, 'invite');
  expect(token, 'invite token in dev outbox').toBeTruthy();
  const name = `Fresh ${rnd}`;
  const acc = await pub.post('/auth/invites/accept', { token, name, password });
  expect(acc.status, acc.text).toBe(204);
  return { email, password, role, name };
}

export async function enrollMfa(app: FastifyInstance, email: string, password: string) {
  const client = new Client(app, '10.9.9.8');
  const l = await rawLogin(client, email, password);
  expect(l.status, l.text).toBe(200);
  expect(l.body.status).toBe('mfa_enrollment_required');
  const start = await client.post('/auth/mfa/enroll/start', { enrollToken: l.body.enrollToken });
  expect(start.status, start.text).toBe(200);
  const secret: string = start.body.secret;
  const code = await freshCode(secret);
  const ver = await client.post('/auth/mfa/enroll/verify', { enrollToken: l.body.enrollToken, code });
  expect(ver.status, ver.text).toBe(200);
  return {
    secret,
    recoveryCodes: ver.body.recoveryCodes as string[],
    session: makeSession(client, email, ver),
    otpauthUri: start.body.otpauthUri as string,
    enrollToken: l.body.enrollToken as string,
  };
}

export async function loginWithSecret(app: FastifyInstance, email: string, password: string, secret: string) {
  const client = new Client(app, '10.9.9.7');
  let r = await rawLogin(client, email, password);
  expect(r.body.status).toBe('mfa_required');
  r = await client.post('/auth/mfa/verify', { mfaToken: r.body.mfaToken, code: await freshCode(secret) });
  expect(r.status, r.text).toBe(200);
  return makeSession(client, email, r);
}

export async function userId(s: Session, email: string): Promise<string> {
  for (let page = 1; page < 20; page++) {
    const r = await s.get(`/users?page=${page}&pageSize=100`);
    expect(r.status, r.text).toBe(200);
    const hit = r.body.items.find((u: any) => u.email === email);
    if (hit) return hit.id;
    if (r.body.items.length < 100) break;
  }
  throw new Error(`user ${email} not found`);
}

export function deepKeys(o: any, out = new Set<string>()): Set<string> {
  if (Array.isArray(o)) o.forEach((x) => deepKeys(x, out));
  else if (o && typeof o === 'object')
    for (const [k, v] of Object.entries(o)) {
      out.add(k);
      deepKeys(v, out);
    }
  return out;
}