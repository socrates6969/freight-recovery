/* eslint-disable */
// REQ-20261009-four-eyes, claims: FE-C01..FE-C17 and concurrency FE-P01/FE-P02 (test-spec T3, T6; Part C P1-P4, P6).
// Claim allocation (one reseed in beforeAll, one in afterAll):
//   C01/C02/C14 CLM-0001, C03 CLM-0002, C04 CLM-0003, C05 CLM-0004, C06 CLM-0005, C07 CLM-0006, C08 CLM-0007,
//   C09+C10 CLM-0008, P02 CLM-0009, C12/C13 CLM-0010, C15/C16 CLM-0011, C17 CLM-0012, C11 CLM-0013, P01 CLM-0014.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Session, buildTestApp, claimId, closeApps, expectError, sessionFor } from './helpers/client.js';
import * as F from './helpers/fe.js';
import * as H from './helpers/imp.js';
import * as K from './helpers/keys.js';
import { reseed } from './helpers/seed.js';
import { deepKeys } from './helpers/users.js';

let app: FastifyInstance;
let m: Session, rv: Session, owner: Session, admin: Session, an: Session, vw: Session, gxm: Session;
/** claimId -> user ids that created a revision of it (the test's own oracle of P1 "revision authors"). */
const authors = new Map<string, Set<string>>();
const track = (s: Session, id: string) => { if (!authors.has(id)) authors.set(id, new Set()); authors.get(id)!.add(s.user.id); };
async function edit(s: Session, id: string, base: number) { const r = await F.editOk(s, id, base); track(s, id); return r; }
const idOf = (n: string) => claimId(m, n);
const pk = async (id: string, qs = '') => (await owner.get(`/claims/${id}/packet${qs}`)).body;

interface Refusal { label: string; actor: Session; claim: string; packetId: string; packetRevision: number; action: 'APPROVE' | 'REJECT'; events: any[] }
const refusals: Refusal[] = [];

/** Issue a request that must be refused with four_eyes_required; asserts P2 body + no side effects; records audit evidence. */
async function refused(label: string, actor: Session, id: string, action: 'APPROVE' | 'REJECT', rev: number, ack: boolean | null = true) {
  const cur = await pk(id);
  const seq0 = await H.lastSeq(owner);
  const before = await F.claimState(owner, id);
  const res = action === 'APPROVE' ? await F.approve(actor, id, rev, ack) : await F.reject(actor, id, rev);
  F.expectFourEyes(res, label);
  expect(await F.claimState(owner, id), `${label}: no side effects`).toBe(before);
  const events = await F.eventsSince(owner, seq0);
  expect(events.filter((e) => F.isWorkflowEvent(e.action)), `${label}: no approval.*/review.* event`).toEqual([]);
  refusals.push({ label, actor, claim: id, packetId: cur.id, packetRevision: cur.revision, action, events });
  return res;
}

beforeAll(async () => {
  reseed();
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
  m = await sessionFor(app, ACCOUNTS.MANAGER);
  rv = await sessionFor(app, ACCOUNTS.REVIEWER);
  owner = await sessionFor(app, ACCOUNTS.OWNER);
  admin = await sessionFor(app, ACCOUNTS.ADMIN);
  an = await sessionFor(app, ACCOUNTS.ANALYST);
  vw = await sessionFor(app, ACCOUNTS.VIEWER);
  gxm = await sessionFor(app, 'manager@globex.test');
}, 120000);
afterAll(async () => { try { await K.revokeActive(owner); } finally { await closeApps(); reseed(); } });

describe('FE-C01/C02 (a)(b) author cannot approve; another approver can', () => {
  it('CLM-0001: M edits rev 2 -> approve(M,2) 403 fixed body, no side effects; approve(R,2) 200', async () => {
    const id = await idOf('CLM-0001');
    expect(await edit(m, id, 1)).toBe(2);
    await refused('FE-C01', m, id, 'APPROVE', 2);
    const ok = await F.approve(rv, id, 2);
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.claim.status).toBe('APPROVED');
    const p = await pk(id);
    const ap = p.approvals.filter((a: any) => a.action === 'APPROVE' && a.packetRevision === 2);
    expect(ap).toHaveLength(1);
    expect(ap[0].actor.id).toBe(rv.user.id);
    expect(p.approvals.some((a: any) => a.action === 'APPROVE' && a.actor.id === m.user.id)).toBe(false);
  });
});

describe('FE-C03 (c) authors of superseded revisions stay excluded', () => {
  it('CLM-0002: A edits rev 2, B edits rev 3 -> A 403, B 403, C 200', async () => {
    const id = await idOf('CLM-0002');
    await edit(m, id, 1);
    await edit(admin, id, 2);
    await refused('FE-C03 A (superseded author)', m, id, 'APPROVE', 3);
    await refused('FE-C03 B (current author)', admin, id, 'APPROVE', 3);
    const ok = await F.approve(rv, id, 3);
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.claim.status).toBe('APPROVED');
  });
});

describe('FE-C04 (d) a revision without a recorded creator restricts nobody', () => {
  it('CLM-0003 never edited: approve(M,1) 200', async () => {
    const id = await idOf('CLM-0003');
    const p = await pk(id);
    expect(p.revision).toBe(1);
    expect(p.createdBy).toBeNull();
    const ok = await F.approve(m, id, 1);
    expect(ok.status, ok.text).toBe(200);
  });
});

describe('FE-C05 (f) author cannot reject; another approver can', () => {
  it('CLM-0004: M edits -> reject(M,2) 403 no side effects; reject(R,2) 200 REJECTED', async () => {
    const id = await idOf('CLM-0004');
    await edit(m, id, 1);
    await refused('FE-C05', m, id, 'REJECT', 2);
    const ok = await F.reject(rv, id, 2);
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.claim.status).toBe('REJECTED');
  });
});

describe('FE-C06/C07 send-ready is unrestricted', () => {
  it('FE-C06 CLM-0005: author M may send what R approved', async () => {
    const id = await idOf('CLM-0005');
    await edit(m, id, 1);
    expect((await F.approve(rv, id, 2)).status).toBe(200);
    const s = await F.send(m, id, 2);
    expect(s.status, s.text).toBe(200);
    expect(s.body.claim.status).toBe('SEND_READY');
    expect(s.body.delivery).toEqual({ sent: false, mode: 'send_ready_only' });
  });
  it('FE-C07 CLM-0006: the approver (second MANAGER) may also mark send-ready', async () => {
    const id = await idOf('CLM-0006');
    const { s: m2 } = await K.newSession(app, owner, 'MANAGER');
    await edit(m, id, 1);
    const a = await F.approve(m2, id, 2);
    expect(a.status, a.text).toBe(200);
    const s = await F.send(m2, id, 2);
    expect(s.status, s.text).toBe(200);
    expect(s.body.claim.status).toBe('SEND_READY');
    expect(s.body.delivery).toEqual({ sent: false, mode: 'send_ready_only' });
  }, 120000);
});

describe('FE-C08 edit after approval', () => {
  it('CLM-0007: M r2, R approves, R edits r3 -> R 403, M 403, OWNER 200', async () => {
    const id = await idOf('CLM-0007');
    await edit(m, id, 1);
    expect((await F.approve(rv, id, 2)).status).toBe(200);
    await edit(rv, id, 2);
    await refused('FE-C08 R', rv, id, 'APPROVE', 3);
    await refused('FE-C08 M', m, id, 'APPROVE', 3);
    const ok = await F.approve(owner, id, 3);
    expect(ok.status, ok.text).toBe(200);
  });
});

describe('FE-C09/C10 precedence: stale_revision and invalid_state win over four-eyes', () => {
  it('CLM-0008: approve(M,1) after M created rev 2 -> 409 stale_revision; after R approved rev 2, approve(M,2) -> 409 invalid_state', async () => {
    const id = await idOf('CLM-0008');
    await edit(m, id, 1);
    expectError(await F.approve(m, id, 1), 409, 'stale_revision');
    expectError(await F.reject(m, id, 1), 409, 'stale_revision');
    expect((await F.approve(rv, id, 2)).status).toBe(200);
    expectError(await F.approve(m, id, 2), 409, 'invalid_state');
    expectError(await F.reject(m, id, 2), 409, 'invalid_state');
  });
});

describe('FE-C11 precedence: four-eyes before the pending-findings acknowledgement', () => {
  it('CLM-0013: author without ack -> 403 four_eyes_required (not 422); R without ack -> 422', async () => {
    const id = await idOf('CLM-0013');
    await edit(m, id, 1);
    const p = await pk(id);
    expect(p.findings.some((f: any) => f.needsHumanReview), 'revision has pending findings').toBe(true);
    await refused('FE-C11 no ack', m, id, 'APPROVE', 2, null);
    expectError(await F.approve(rv, id, 2, null), 422, 'unprocessable');
  });
});

describe('FE-C12/C13 precedence: RBAC and tenant checks unchanged', () => {
  it('ANALYST/VIEWER -> 403 forbidden with authz.denied; Globex MANAGER -> 404', async () => {
    const id = await idOf('CLM-0010');
    await edit(m, id, 1);
    for (const s of [an, vw]) {
      const seq0 = await H.lastSeq(owner);
      expectError(await F.approve(s, id, 2), 403, 'forbidden');
      expectError(await F.reject(s, id, 2), 403, 'forbidden');
      const ev = await F.eventsSince(owner, seq0);
      expect(ev.filter((e) => e.action === 'authz.denied' && e.actor?.id === s.user.id).length, `${s.email} authz.denied`).toBe(2);
      expect(ev.filter((e) => e.action === 'authz.four_eyes_denied')).toEqual([]);
    }
    expectError(await F.approve(gxm, id, 2), 404, 'not_found');
    expectError(await F.reject(gxm, id, 2), 404, 'not_found');
    expect((await pk(id)).status).toBe('PENDING_REVIEW');
  });
});

describe('FE-C14 audit of refusals', () => {
  it('exactly one authz.four_eyes_denied per refused request with the exact metadata; no authz.denied; chain valid', async () => {
    expect(refusals.length).toBeGreaterThanOrEqual(7);
    for (const r of refusals) {
      const fe = r.events.filter((e) => e.action === 'authz.four_eyes_denied');
      expect(fe, `${r.label}: one four_eyes_denied`).toHaveLength(1);
      const e = fe[0];
      expect(e.actor, r.label).toEqual({ id: r.actor.user.id, role: r.actor.user.role });
      expect(e.targetType, r.label).toBe('claim');
      expect(e.targetId, r.label).toBe(r.claim);
      expect(e.metadata, r.label).toEqual({ claimId: r.claim, packetId: r.packetId, packetRevision: r.packetRevision, action: r.action, basis: 'revision_author' });
      expect(r.events.filter((x) => x.action === 'authz.denied'), `${r.label}: no authz.denied`).toEqual([]);
    }
    const labels = refusals.map((r) => r.label);
    expect(labels).toContain('FE-C01');
    expect(labels).toContain('FE-C05');
    const v = await owner.get('/audit/verify');
    expect(v.status).toBe(200);
    expect(v.body.valid).toBe(true);
  });
});

describe('FE-C15/C16 selfAuthored on the approvals queue', () => {
  const queue = async (s: Session) => {
    const r = await s.get('/approvals?status=PENDING_REVIEW,APPROVED&pageSize=100');
    expect(r.status, r.text).toBe(200);
    return r;
  };
  const expectFlags = (items: any[], s: Session) => {
    for (const it of items) {
      expect(typeof it.selfAuthored, `${it.claimNumber} selfAuthored boolean`).toBe('boolean');
      const exp = authors.get(it.id)?.has(s.user.id) ?? false;
      expect(it.selfAuthored, `${s.email} on ${it.claimNumber} (rev ${it.packetRevision})`).toBe(exp);
      if (it.packetRevision === 1 && !authors.has(it.id)) expect(it.selfAuthored).toBe(false);
    }
  };
  it('FE-C15: flag per requester and claim; stays true after approval; schema otherwise unchanged', async () => {
    const x = await idOf('CLM-0011');
    await edit(m, x, 1);
    const qm = (await queue(m)).body.items as any[];
    const qr = (await queue(rv)).body.items as any[];
    expect(qm.find((i) => i.id === x).selfAuthored).toBe(true);
    expect(qr.find((i) => i.id === x).selfAuthored).toBe(false);
    expect(qm.some((i) => i.packetRevision === 1)).toBe(true);
    expectFlags(qm, m);
    expectFlags(qr, rv);
    for (const s of [owner, admin, vw]) expectFlags((await queue(s)).body.items, s);
    // schema: claim summary keys + the three existing queue keys + selfAuthored, nothing else
    const summary = (await m.get(`/claims/${x}`)).body;
    const item = qm.find((i) => i.id === x);
    const listItem = (await m.get(`/claims?q=CLM-0011&pageSize=100`)).body.items.find((i: any) => i.id === x);
    expect(Object.keys(item).sort()).toEqual([...new Set([...Object.keys(listItem), 'packetRevision', 'pendingFindingsCount', 'waitingSince', 'selfAuthored'])].sort());
    void summary;
    expect((await F.approve(rv, x, 2)).status).toBe(200);
    const after = (await queue(m)).body.items.find((i: any) => i.id === x);
    expect(after.status).toBe('APPROVED');
    expect(after.selfAuthored, 'any status').toBe(true);
    expect((await queue(rv)).body.items.find((i: any) => i.id === x).selfAuthored).toBe(false);
  });
  it('FE-C16: payloads for M and R are identical except selfAuthored; no other user identity added', async () => {
    const a = (await queue(m)).body;
    const b = (await queue(rv)).body;
    const drop = (p: any) => JSON.parse(JSON.stringify(p, (k, v) => (k === 'selfAuthored' ? undefined : v)));
    expect(drop(a)).toEqual(drop(b));
    expect(a.items.some((i: any, k: number) => i.selfAuthored !== b.items[k].selfAuthored), 'flags differ somewhere').toBe(true);
    // every identifier in the queue already appears in the claim list (claim ids, assignees): nothing new is exposed
    const list = JSON.stringify((await m.get('/claims?pageSize=100')).body);
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
    for (const p of [a, b]) {
      const t = JSON.stringify(p);
      for (const u of t.match(UUID) ?? []) expect(list.includes(u), `identifier ${u} not in the claim list`).toBe(true);
      for (const u of [m.user, rv.user, owner.user, admin.user]) {
        if (!list.includes(u.id)) expect(t.includes(u.id), `user id ${u.email}`).toBe(false);
        expect(t.includes(u.email), `email ${u.email}`).toBe(false);
      }
      for (const k of deepKeys(p)) if (k !== 'selfAuthored') expect(/createdBy|author|editor|actor/i.test(k), `key ${k}`).toBe(false); // the contract flag itself is allowed
    }
  });
});

describe('FE-C17 API keys cannot decide (unchanged refusal, never four_eyes_required)', () => {
  it('key created by a revision author: approve/reject/send -> 403 forbidden', async () => {
    const id = await idOf('CLM-0012');
    await edit(owner, id, 1);
    const k = await K.mkKey(owner, [...K.SCOPES]);
    const before = await F.claimState(owner, id);
    for (const [p, body] of [['approve', { packetRevision: 2, reason: F.R, acknowledgePendingFindings: true }], ['reject', { packetRevision: 2, reason: F.R }], ['send', { packetRevision: 2, reason: F.R }]] as const) {
      const r = await K.keyReq(app, k.secret, 'POST', `/claims/${id}/packet/${p}`, { body });
      expect(r.status, `${p}: ${r.text}`).toBe(403);
      expect(r.body.error.code, p).toBe('forbidden');
    }
    expect(await F.claimState(owner, id)).toBe(before);
    await K.revokeActive(owner);
  });
});

describe('FE-P01 (g) concurrent approve by author and non-author (20 rounds)', () => {
  it('CLM-0014: exactly one 200 (R); M 403 four_eyes_required or 409 invalid_state; never an APPROVE by M; never 500', async () => {
    const id = await idOf('CLM-0014');
    let rev = (await pk(id)).revision;
    const seen: Record<string, number> = {};
    for (let i = 0; i < 20; i++) {
      rev = await edit(m, id, rev);
      const [rm, rr] = await Promise.all([F.approve(m, id, rev), F.approve(rv, id, rev)]);
      for (const r of [rm, rr]) expect(r.status, `round ${i}: ${r.text}`).not.toBe(500);
      expect(rr.status, `round ${i} R: ${rr.text}`).toBe(200);
      if (rm.status === 403) F.expectFourEyes(rm, `round ${i} M`);
      else expectError(rm, 409, 'invalid_state');
      const k = `${rm.status}/${rm.body?.error?.code}`;
      seen[k] = (seen[k] ?? 0) + 1;
    }
    const p = await pk(id);
    expect(p.approvals.filter((a: any) => a.action === 'APPROVE' && a.actor.id === m.user.id)).toEqual([]);
    expect(p.approvals.filter((a: any) => a.action === 'APPROVE' && a.actor.id === rv.user.id)).toHaveLength(20);
    console.log(`[FE-P01] author outcomes ${JSON.stringify(seen)}`);
  }, 300000);
});

describe('FE-P02 (g) concurrent edit and approve by the same user (20 rounds)', () => {
  it('CLM-0009: outcomes match one serial order; never an APPROVE of a revision by its creator', async () => {
    const id = await idOf('CLM-0009');
    expect((await pk(id)).revision).toBe(1);
    const users: Session[] = [m];
    for (let i = 1; i < 20; i++) users.push((await K.newSession(app, owner, 'REVIEWER')).s);
    let rev = 1;
    const orders: Record<string, number> = {};
    for (let i = 0; i < 20; i++) {
      const u = users[i]!;
      expect(authors.get(id)?.has(u.user.id) ?? false, 'fresh actor is not an author yet').toBe(false);
      const [re, ra] = await Promise.all([F.edit(u, id, rev), F.approve(u, id, rev)]);
      for (const r of [re, ra]) expect(r.status, `round ${i}: ${r.text}`).not.toBe(500);
      expect(re.status, `round ${i} edit: ${re.text}`).toBe(201);
      track(u, id);
      if (ra.status === 200) orders['approve-then-edit'] = (orders['approve-then-edit'] ?? 0) + 1;
      else { expectError(ra, 409, 'stale_revision'); orders['edit-then-approve'] = (orders['edit-then-approve'] ?? 0) + 1; }
      rev += 1;
      const p = await pk(id);
      expect(p.revision).toBe(rev);
      expect(p.status).toBe('PENDING_REVIEW');
      expect(p.createdBy?.id).toBe(u.user.id);
    }
    const p = await pk(id);
    for (const a of p.approvals.filter((x: any) => x.action === 'APPROVE' || x.action === 'REJECT')) {
      const r = await pk(id, `?revision=${a.packetRevision}`);
      expect(r.createdBy?.id ?? null, `APPROVE of rev ${a.packetRevision}`).not.toBe(a.actor.id);
    }
    console.log(`[FE-P02] serial orders ${JSON.stringify(orders)}`);
  }, 600000);
});
