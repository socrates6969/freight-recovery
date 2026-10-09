/* eslint-disable */
// T-RBAC-IMP: authorization matrix R40-R56 x 8 roles x unauthenticated, CSRF / Origin precedence, authz.denied audit.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, ALL_ROLES, Client, buildTestApp, closeApps, expectError, sessionFor, type RoleName, type Session } from './helpers/client.js';
import { has, type Role } from './helpers/matrix.js';
import * as H from './helpers/imp.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
const SS = {} as Record<RoleName, Session>;
let an: Session;
const S = (s: string) => Buffer.from(s, 'utf8');
const R = 'rbac probe reason text';

beforeAll(async () => {
  await H.assertS3Reachable();
  app = await buildTestApp();
  for (const r of ALL_ROLES) SS[r] = H.wrap(await sessionFor(app, ACCOUNTS[r]));
  an = SS.ANALYST;
});
afterAll(async () => {
  try { H.assertRecorded('imp-rbac'); } finally { await closeApps(); reseed(); }
});

interface Fx { b: string; d: string; f: string; claim?: string }
type Kind = 'none' | 'pdf' | 'img' | 'imgtyped' | 'accepted';
async function fixture(kind: Kind): Promise<Fx> {
  const b = await H.newBatch(an);
  if (kind === 'none') return { b, d: H.RAND_UUID, f: H.RAND_UUID };
  if (kind === 'pdf') {
    const d = await H.putOk(an, b, 'rc.pdf', H.buildPdf(['DOCUMENT: RATE CONFIRMATION', `Load Number: ${H.uniqLoad('RB')}`, 'Linehaul Rate: 5.00']));
    return { b, d: d.id, f: d.fields[0].id };
  }
  if (kind === 'accepted') {
    const d = await H.putOk(an, b, 'bol.txt', S(H.bolTxt(H.uniqLoad('RB'))));
    return { b, d: d.id, f: d.fields[0].id };
  }
  const d = await H.putOk(an, b, 'scan.png', H.buildPng());
  if (kind === 'imgtyped') await SS.REVIEWER.patch(`/imports/${b}/documents/${d.id}`, { docType: 'RATE_CONFIRMATION' });
  return { b, d: d.id, f: H.RAND_UUID };
}
interface Route { id: string; perm: string; method: string; kind: Kind; ok: number; path: (x: Fx) => string; body?: (x: Fx) => unknown; bad?: unknown; upload?: boolean }
const P = (x: Fx) => `/imports/${x.b}/documents/${x.d}`;
const ROUTES: Route[] = [
  { id: 'R40 POST /imports', perm: 'import:run', method: 'POST', kind: 'none', ok: 201, path: () => '/imports', body: () => ({ label: 'rbac' }), bad: { label: '' } },
  { id: 'R41 GET /imports', perm: 'import:run', method: 'GET', kind: 'none', ok: 200, path: () => '/imports' },
  { id: 'R42 GET batch', perm: 'import:run', method: 'GET', kind: 'none', ok: 200, path: (x) => `/imports/${x.b}` },
  { id: 'R43 POST upload', perm: 'import:run', method: 'POST', kind: 'none', ok: 201, path: (x) => `/imports/${x.b}/documents`, upload: true },
  { id: 'R44 GET document', perm: 'import:run', method: 'GET', kind: 'accepted', ok: 200, path: P },
  { id: 'R45 GET original', perm: 'import:run', method: 'GET', kind: 'accepted', ok: 200, path: (x) => `${P(x)}/original` },
  { id: 'R46 PATCH docType', perm: 'import:review', method: 'PATCH', kind: 'img', ok: 200, path: P, body: () => ({ docType: 'INVOICE' }), bad: {} },
  { id: 'R47 POST field', perm: 'import:review', method: 'POST', kind: 'imgtyped', ok: 201, path: (x) => `${P(x)}/fields`, body: () => ({ key: 'rate_confirmation.load_number', value: H.uniqLoad('RB'), reason: R }), bad: {} },
  { id: 'R48 resolve', perm: 'import:review', method: 'POST', kind: 'pdf', ok: 200, path: (x) => `${P(x)}/fields/${x.f}/resolve`, body: () => ({ action: 'CONFIRM', reason: R }), bad: {} },
  { id: 'R49 accept', perm: 'import:review', method: 'POST', kind: 'pdf', ok: 200, path: (x) => `${P(x)}/accept`, body: () => ({ reason: R, confirmRemaining: true }), bad: {} },
  { id: 'R50 reject', perm: 'import:review', method: 'POST', kind: 'pdf', ok: 200, path: (x) => `${P(x)}/reject`, body: () => ({ reason: R }), bad: {} },
  { id: 'R51 GET reviews', perm: 'import:review', method: 'GET', kind: 'none', ok: 200, path: () => '/reviews' },
  { id: 'R52 POST commit', perm: 'import:run', method: 'POST', kind: 'accepted', ok: 200, path: (x) => `/imports/${x.b}/commit`, body: () => ({ perspective: 'SHIPPER' }), bad: {} },
  { id: 'R53 GET claim documents', perm: 'claims:read', method: 'GET', kind: 'none', ok: 200, path: (x) => `/claims/${x.claim}/documents` },
  { id: 'R54 GET export claims', perm: 'export:claims', method: 'GET', kind: 'none', ok: 200, path: () => '/exports/claims?format=csv' },
  { id: 'R55 GET export packets', perm: 'export:packets', method: 'GET', kind: 'none', ok: 200, path: () => '/exports/packets?format=csv' },
  { id: 'R56 GET export outcomes', perm: 'export:outcomes', method: 'GET', kind: 'none', ok: 200, path: () => '/exports/outcomes?format=csv' },
];
async function exec(rt: Route, s: Session | null, fx: Fx, denied: boolean) {
  if (rt.upload) {
    return H.upload(s ?? an, fx.b, denied ? null : 'rbac.txt', denied ? Buffer.alloc(0) : S(H.bolTxt(H.uniqLoad('RB'))), s ? {} : { token: null });
  }
  const body = denied ? rt.bad : rt.body?.(fx);
  const c = s ?? ({ as: (m: string, p: string, o: any) => new Client(app).send(m, p, o) } as any);
  return c.as(rt.method, rt.path(fx), { body });
}

let sharedClaim = '';
async function ensureClaim() {
  if (sharedClaim) return sharedClaim;
  const f = await fixture('accepted');
  sharedClaim = (await H.commit(an, f.b)).body.created[0].claimId;
  return sharedClaim;
}
const importRoles = new Set(['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST']);

describe('T-RBAC-IMP matrix: 17 routes x 8 roles + unauthenticated', () => {
  for (const rt of ROUTES) {
    it(`${rt.id} (${rt.perm})`, async () => {
      const claim = await ensureClaim();
      for (const role of ALL_ROLES) {
        const allowed = has(role as Role, rt.perm);
        const fx = await fixture(allowed ? rt.kind : 'none');
        fx.claim = claim;
        const r = await exec(rt, SS[role], fx, !allowed);
        if (allowed) expect(r.status, `${role} on ${rt.id}: ${r.text.slice(0, 300)}`).toBe(rt.ok);
        else expectError(r, 403, 'forbidden');
      }
      const fx = await fixture('none');
      fx.claim = claim;
      const u = await exec(rt, null, fx, true);
      expectError(u, 401);
    }, 120000);
  }
  it('import:run roles are exactly OWNER, ADMIN, MANAGER, REVIEWER, ANALYST; platform roles have no import/export permission (GET /me)', async () => {
    for (const role of ALL_ROLES) {
      const me = await SS[role].get('/me');
      const perms: string[] = me.body.permissions;
      for (const p of ['import:run', 'import:review', 'export:claims', 'export:packets', 'export:outcomes']) expect(perms.includes(p), `${role} ${p}`).toBe(has(role as Role, p));
      if (!importRoles.has(role)) expect(perms.includes('import:run')).toBe(false);
    }
  });
});

describe('T-RBAC-IMP CSRF and Origin precedence', () => {
  const unsafe = ROUTES.filter((r) => r.method !== 'GET');
  for (const rt of unsafe) {
    it(`${rt.id}: missing CSRF -> 403 csrf_failed before anything else; wrong Origin -> 403 origin_not_allowed`, async () => {
      const fx = await fixture(rt.kind);
      fx.claim = await ensureClaim();
      for (const s of [an, SS.VIEWER]) {
        if (rt.upload) {
          expectError(await H.upload(s, fx.b, 'x.txt', S('x'), { csrf: false }), 403, 'csrf_failed');
          expectError(await H.upload(s, fx.b, 'x.txt', S('x'), { headers: { origin: H.ORIGIN_BAD } }), 403, 'origin_not_allowed');
        } else {
          expectError(await s.as(rt.method, rt.path(fx), { body: rt.body?.(fx) ?? {}, csrf: false }), 403, 'csrf_failed');
          expectError(await s.as(rt.method, rt.path(fx), { body: rt.body?.(fx) ?? {}, headers: { origin: H.ORIGIN_BAD } }), 403, 'origin_not_allowed');
        }
      }
    }, 120000);
  }
});

describe('T-RBAC-IMP authz.denied audit', () => {
  it('a 403 for an authenticated tenant user is audited as authz.denied with the route pattern and required permission', async () => {
    const owner = SS.OWNER;
    const seq = await H.lastSeq(owner);
    const r1 = await SS.VIEWER.get('/imports');
    const r2 = await SS.ANALYST.get('/reviews');
    const r3 = await SS.VIEWER.get('/exports/claims?format=csv');
    for (const r of [r1, r2, r3]) expectError(r, 403, 'forbidden');
    const ev = await H.auditSince(owner, seq, 'authz.denied');
    const blob = ev.map((e) => JSON.stringify(e.metadata ?? {}));
    for (const perm of ['import:run', 'import:review', 'export:claims']) expect(blob.some((m) => m.includes(perm)), `authz.denied mentioning ${perm}: ${blob.join('|')}`).toBe(true);
    expect(blob.some((m) => /imports/.test(m))).toBe(true);
  });
});
