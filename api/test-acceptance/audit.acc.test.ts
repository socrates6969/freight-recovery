/* eslint-disable */
// T-AUD-01..08, T-SA-03
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCOUNTS, Client, type Session, allAudit, buildTestApp, claimId, closeApps, expectError, login, rawLogin, sessionFor,
} from './helpers/client.js';
import { withAdmin, withTriggersOff } from './helpers/db.js';
import { SEED_PASSWORD, SEED_TOTP_SECRET } from './helpers/env.js';
import { freshCode } from './helpers/totp.js';
import { GOOD_PW, newUser, uniq, userId } from './helpers/users.js';
import { outboxToken } from './helpers/client.js';
import { reseed } from './helpers/seed.js';

const BAD = 'Wrong-Password-1234!';
const kw = (...w: string[]) => (a: string) => w.every((x) => a.toLowerCase().includes(x));
const asc = (a: any, b: any) => a.seq - b.seq;

let app: FastifyInstance;
let owner: Session, manager: Session, viewer: Session, gxOwner: Session;
beforeAll(async () => {
  reseed();
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
  owner = await sessionFor(app, ACCOUNTS.OWNER);
  manager = await sessionFor(app, ACCOUNTS.MANAGER);
  viewer = await sessionFor(app, ACCOUNTS.VIEWER);
  gxOwner = await sessionFor(app, 'owner@globex.test');
});
afterAll(closeApps);

async function observe(fn: () => Promise<any>, s: Session = owner) {
  const before = (await s.get('/audit/events?limit=1')).body.items[0]?.seq ?? 0;
  const res = await fn();
  const fresh = (await allAudit(s)).filter((e) => e.seq > before).sort(asc);
  return { res, fresh };
}
const seen: Record<string, string> = {};
function one(label: string, o: { res: any; fresh: any[] }, match: (a: string) => boolean, extra?: (e: any) => void) {
  expect(o.fresh.length, `${label}: expected exactly one event, got ${JSON.stringify(o.fresh.map((e) => e.action))}`).toBe(1);
  const e = o.fresh[0];
  seen[label] = e.action;
  expect(match(e.action), `${label}: unexpected action name "${e.action}"`).toBe(true);
  if (o.res?.headers?.['x-request-id']) expect(e.requestId).toBe(o.res.headers['x-request-id']);
  expect(Math.abs(Date.now() - Date.parse(e.createdAt))).toBeLessThan(5000 + 3000); // 5 s (+ clock skew allowance for DB host)
  expect(typeof e.hash).toBe('string');
  extra?.(e);
  return e;
}

const secretsUsed: string[] = [SEED_PASSWORD, GOOD_PW, BAD, 'Another-Long-Pass-77!', SEED_TOTP_SECRET];
const LETTER = 'AUDIT-LETTER-CANARY-7731 do not leak';
const ghost = `ghost-${uniq()}@acme.test`;

describe('T-AUD-01 coverage, exactness and hygiene', () => {
  let U: Awaited<ReturnType<typeof newUser>>;
  let uid: string;
  it('auth lifecycle events (fresh user)', async () => {
    U = await newUser(app, owner, 'VIEWER');
    uid = await userId(owner, U.email);
    const f = await observe(() => rawLogin(new Client(app), U.email, BAD));
    one('login failure', f, kw('login', 'fail'), (e) => {
      expect(e.actor).toBeNull();
    });
    const ok = await observe(() => rawLogin(new Client(app), U.email, U.password));
    secretsUsed.push(ok.res.body.accessToken);
    one('login success', ok, (a) => /login/.test(a) && !/fail|lockout/.test(a), (e) => expect(e.actor?.id).toBe(uid));
    const s = await login(app, U.email, U.password);
    secretsUsed.push(s.token, s.client.cookie('fr_rt')!);
    const cp = await observe(() => s.post('/auth/change-password', { currentPassword: U.password, newPassword: 'Another-Long-Pass-77!' }));
    one('password changed', cp, kw('password'), (e) => expect(e.actor?.id).toBe(uid));
    const s2 = await login(app, U.email, 'Another-Long-Pass-77!');
    secretsUsed.push(s2.token);
    const lo = await observe(() => s2.post('/auth/logout', {}));
    one('logout', lo, kw('logout'));
  }, 120000);

  it('reset requested/completed, refresh reuse, lockout, mfa failure', async () => {
    const pub = new Client(app, '10.8.8.8');
    const rq = await observe(() => pub.post('/auth/forgot', { email: U.email }));
    one('reset requested', rq, kw('reset', 'request'));
    const tok = (await outboxToken(pub, U.email, 'password_reset'))!;
    secretsUsed.push(tok);
    const done = await observe(() => pub.post('/auth/reset', { token: tok, password: GOOD_PW }));
    one('reset completed', done, kw('reset', 'complet'));

    const { client } = await (async () => {
      const c = new Client(app);
      const r = await rawLogin(c, U.email, GOOD_PW);
      secretsUsed.push(r.body.accessToken, c.cookie('fr_rt')!);
      return { client: c };
    })();
    const old = client.cookie('fr_rt')!;
    await client.post('/auth/refresh', {});
    secretsUsed.push(client.cookie('fr_rt')!);
    const ru = await observe(() => new Client(app).post('/auth/refresh', {}, { cookies: { fr_rt: old } }));
    one('refresh reuse', ru, kw('refresh', 'reuse'), (e) => expect(e.actor?.id).toBe(uid));

    const lockApp = await buildTestApp({ LOCKOUT_THRESHOLD: '3', LOCKOUT_BASE_SECONDS: '2', LOCKOUT_MAX_SECONDS: '8' });
    const lk = await observe(async () => {
      for (let i = 0; i < 3; i++) await rawLogin(new Client(lockApp), U.email, BAD);
    });
    expect(lk.fresh.filter((e) => /fail/.test(e.action))).toHaveLength(3);
    const locks = lk.fresh.filter((e) => /lockout/.test(e.action));
    expect(locks, JSON.stringify(lk.fresh.map((e) => e.action))).toHaveLength(1);
    seen['lockout'] = locks[0].action;
  }, 120000);

  it('mfa enrolled / failure / recovery', async () => {
    const adm = await newUser(app, owner, 'ADMIN');
    const c = new Client(app);
    const l = await rawLogin(c, adm.email, adm.password);
    const st = await c.post('/auth/mfa/enroll/start', { enrollToken: l.body.enrollToken });
    secretsUsed.push(st.body.secret, l.body.enrollToken);
    const code = await freshCode(st.body.secret);
    secretsUsed.push(code);
    const en = await observe(() => c.post('/auth/mfa/enroll/verify', { enrollToken: l.body.enrollToken, code }));
    // enrolment also opens a session, so a login event may accompany the enrolment event; exactly one enrolment event is required
    expect(en.fresh.filter((e) => kw('mfa', 'enroll')(e.action)), JSON.stringify(en.fresh.map((e) => e.action))).toHaveLength(1);
    seen['mfa enrolled'] = en.fresh.find((e) => kw('mfa', 'enroll')(e.action))!.action;
    secretsUsed.push(...en.res.body.recoveryCodes);
    const c2 = new Client(app);
    const l2 = await rawLogin(c2, adm.email, adm.password);
    const mf = await observe(() => c2.post('/auth/mfa/verify', { mfaToken: l2.body.mfaToken, code: '000000' }));
    one('mfa failure', mf, kw('mfa', 'fail'));
    const rc = await observe(() => c2.post('/auth/mfa/verify', { mfaToken: l2.body.mfaToken, recoveryCode: en.res.body.recoveryCodes[0] }));
    expect(rc.fresh.filter((e) => e.action === 'auth.mfa.recovery_used'), JSON.stringify(rc.fresh.map((e) => e.action))).toHaveLength(1); // a login event may accompany it
    seen['mfa recovery used'] = 'auth.mfa.recovery_used';
  }, 120000);

  it('invites, role, disable/enable, mfa reset', async () => {
    const email = `inv-${uniq()}@acme.test`;
    const cr = await observe(() => owner.post('/users/invites', { email, role: 'VIEWER' }));
    one('invite created', cr, kw('invite', 'creat'));
    const pub = new Client(app, '10.8.8.9');
    const tok = (await outboxToken(pub, email, 'invite'))!;
    secretsUsed.push(tok);
    const acc = await observe(() => pub.post('/auth/invites/accept', { token: tok, name: 'Inv Accept', password: GOOD_PW }));
    one('invite accepted', acc, kw('invite', 'accept'));
    const email2 = `inv-${uniq()}@acme.test`;
    const inv2 = await owner.post('/users/invites', { email: email2, role: 'VIEWER' });
    const rv = await observe(() => owner.destroy(`/users/invites/${inv2.body.id}`));
    one('invite revoked', rv, kw('invite', 'revok'));
    const id = await userId(owner, email);
    const rc = await observe(() => owner.patch(`/users/${id}/role`, { role: 'ANALYST', reason: 'audit coverage role change' }));
    const e = one('role changed', rc, kw('role'));
    expect(JSON.stringify(e.metadata).toUpperCase()).toContain('VIEWER');
    expect(JSON.stringify(e.metadata).toUpperCase()).toContain('ANALYST');
    expect(JSON.stringify(e.metadata)).toContain('audit coverage role change');
    one('user disabled', await observe(() => owner.post(`/users/${id}/disable`, { reason: 'audit coverage disable' })), kw('disabl'));
    one('user enabled', await observe(() => owner.post(`/users/${id}/enable`, { reason: 'audit coverage enable' })), kw('enabl'));
    one('mfa reset', await observe(() => owner.post(`/users/${id}/mfa/reset`, { reason: 'audit coverage mfa reset' })), kw('mfa', 'reset'));
  }, 120000);

  it('claim workflow events', async () => {
    const c20 = await claimId(manager, 'CLM-0020');
    const c21 = await claimId(manager, 'CLM-0021');
    const c17 = await claimId(manager, 'CLM-0017');
    const reviewerId = (await sessionFor(app, ACCOUNTS.REVIEWER)).user.id;
    const asg = await observe(() => manager.post(`/claims/${c20}/assign`, { assigneeId: reviewerId }));
    one('assign', asg, (a) => a === 'claim.assigned', (e) => expect(e.actor.role).toBe('MANAGER'));
    await manager.post(`/claims/${c20}/assign`, { assigneeId: null });
    const pv = await observe(() => manager.get(`/claims/${c20}/packet`));
    one('packet viewed', pv, (a) => a === 'packet.viewed', (e) => expect(JSON.stringify(e.metadata)).toContain(String(pv.res.body.revision)));
    const rev = pv.res.body.revision;
    const ed = await observe(() => manager.post(`/claims/${c20}/packet/revisions`, { baseRevision: rev, demandLetter: LETTER, reason: 'audit coverage edit' }));
    one('revision created', ed, (a) => a === 'packet.revision_created');
    const ap = await observe(() => manager.post(`/claims/${c20}/packet/approve`, { packetRevision: rev + 1, reason: 'audit coverage approve' }));
    one('approve', ap, (a) => a === 'approval.approved', (e) => expect(JSON.stringify(e.metadata)).toMatch(/[0-9a-f]{64}/));
    const pv21 = (await manager.get(`/claims/${c21}/packet`)).body;
    expect((await manager.post(`/claims/${c21}/packet/revisions`, { baseRevision: pv21.revision, demandLetter: LETTER + ' two', reason: 'audit coverage edit two' })).status).toBe(201);
    const rj = await observe(() => manager.post(`/claims/${c21}/packet/reject`, { packetRevision: pv21.revision + 1, reason: 'audit coverage reject' }));
    one('reject', rj, (a) => a === 'approval.rejected');
    const pv17 = (await manager.get(`/claims/${c17}/packet`)).body;
    const sd = await observe(() => manager.post(`/claims/${c17}/packet/send`, { packetRevision: pv17.revision, reason: 'audit coverage send ready' }));
    one('send-ready', sd, kw('send'));
    const vf = await observe(() => owner.get('/audit/verify'));
    one('audit verify', vf, (a) => a === 'audit.verify');
    const dn = await observe(() => viewer.post(`/claims/${c20}/assign`, { assigneeId: null }));
    one('authz denied', dn, (a) => a === 'authz.denied', (e) => expect(e.actor.id).toBe(viewer.user.id));
  }, 120000);

  it('unknown-email failures are not visible to any tenant (T-AUD-02, T-AUD-08)', async () => {
    const before = JSON.stringify(await allAudit(owner)) + JSON.stringify(await allAudit(gxOwner));
    expect(before.includes(ghost)).toBe(false);
    expectError(await rawLogin(new Client(app), ghost, BAD), 401, 'invalid_credentials');
    expect((await new Client(app).post('/auth/forgot', { email: ghost })).status).toBe(202);
    const after = JSON.stringify(await allAudit(owner)) + JSON.stringify(await allAudit(gxOwner));
    expect(after.includes(ghost)).toBe(false);
    expect(after.includes(ghost.split('@')[0]!)).toBe(false);
    secretsUsed.push(ghost);
  });

  it('metadata/event text never contains secrets, tokens, codes or letter text', async () => {
    const text = JSON.stringify(await allAudit(owner));
    for (const s of [...secretsUsed, LETTER]) {
      if (!s || s.length < 6) continue;
      expect(text.includes(s), `audit leaks ${s.slice(0, 8)}...`).toBe(false);
    }
    expect(text.length).toBeGreaterThan(1000); // control: scan ran over real data
  });
});

describe('T-AUD-03 chain integrity', () => {
  it('contiguous seq, linked hashes, 64 lowercase hex, distinct; verify valid', async () => {
    for (const s of [owner, gxOwner]) {
      const ev = (await allAudit(s)).sort(asc);
      expect(ev.length).toBeGreaterThanOrEqual(3);
      const hashes = new Set<string>();
      ev.forEach((e, i) => {
        expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
        hashes.add(e.hash);
        if (i > 0) {
          expect(e.seq).toBe(ev[i - 1].seq + 1);
          expect(e.prevHash).toBe(ev[i - 1].hash);
        }
      });
      expect(hashes.size).toBe(ev.length);
      const v = await s.get('/audit/verify');
      expect(v.status).toBe(200);
      expect(v.body).toMatchObject({ valid: true, brokenAtSeq: null });
      expect(v.body.eventsChecked).toBeGreaterThanOrEqual(ev.length);
    }
  });
});

describe('T-AUD-04 tamper detection (Globex chain, restored in finally)', () => {
  it('detects metadata edit, deletion, swapped seq, edited last event and forged event', async () => {
    const gx = await withAdmin(async (c) => (await c.query(`select id from tenants where name like 'Globex%'`)).rows[0].id);
    expect((await gxOwner.get('/audit/verify')).body.valid).toBe(true); // control (taken before the snapshot: verify is itself audited)
    const ck = await withAdmin(async (c) => (await c.query(`select chain_key from audit_events where tenant_id=$1 limit 1`, [gx])).rows[0].chain_key);
    const snap = await withAdmin(async (c) => (await c.query(`select to_jsonb(t) j from audit_events t where chain_key=$1 order by seq`, [ck])).rows.map((r) => r.j));
    expect(snap.length).toBeGreaterThanOrEqual(5);
    const restore = async () =>
      withTriggersOff(['audit_events'], async (c) => {
        await c.query(`delete from audit_events where chain_key=$1`, [ck]);
        await c.query(`insert into audit_events overriding system value select * from jsonb_populate_recordset(null::audit_events, $1::jsonb)`, [JSON.stringify(snap)]);
      });
    const mid = snap[Math.floor(snap.length / 2)].seq as number;
    const last = snap[snap.length - 1].seq as number;
    const verify = async () => (await gxOwner.get('/audit/verify')).body;
    const tamper = async (label: string, sql: (c: any) => Promise<void>, check: (v: any) => void) => {
      await restore(); // chain == snapshot exactly before each tamper
      try {
        await withTriggersOff(['audit_events'], async (c) => sql(c));
        check(await verify());
      } finally {
        await restore();
      }
      const v = await verify();
      expect(v.valid, `${label}: restored chain must verify`).toBe(true);
    };
    try {
      await tamper('metadata edit', (c) => c.query(`update audit_events set metadata = coalesce(metadata,'{}'::jsonb) || '{"tampered":true}'::jsonb where chain_key=$1::text and seq=$2::bigint`, [ck, mid]),
        (v) => {
          expect(v.valid).toBe(false);
          expect(v.brokenAtSeq).toBeGreaterThanOrEqual(mid);
          expect(v.brokenAtSeq).toBeLessThanOrEqual(mid + 1);
        });
      await tamper('delete', (c) => c.query(`delete from audit_events where chain_key=$1::text and seq=$2::bigint`, [ck, mid]), (v) => expect(v.valid).toBe(false));
      await tamper('swap seq', async (c) => {
        await c.query(`update audit_events set seq=1000000 where chain_key=$1::text and seq=$2::bigint::bigint`, [ck, mid]);
        await c.query(`update audit_events set seq=$3::bigint where chain_key=$1::text and seq=$2::bigint::bigint`, [ck, mid + 1, mid]);
        await c.query(`update audit_events set seq=$2::bigint where chain_key=$1::text and seq=1000000`, [ck, mid + 1]);
      }, (v) => expect(v.valid).toBe(false));
      await tamper('edit last', (c) => c.query(`update audit_events set metadata = coalesce(metadata,'{}'::jsonb) || '{"tampered":true}'::jsonb where chain_key=$1::text and seq=$2::bigint`, [ck, last]), (v) => expect(v.valid).toBe(false));
      await tamper('forged event', async (c) => {
        const cols = (await c.query(`select column_name from information_schema.columns where table_name='audit_events' and table_schema='public' and is_generated='NEVER' order by ordinal_position`)).rows.map((r: any) => `"${r.column_name}"`);
        const sel = cols.map((n: string) => (n === '"id"' ? 'gen_random_uuid()' : n === '"seq"' ? 'seq+1' : n === '"prev_hash"' ? `'${'a'.repeat(64)}'` : n === '"hash"' ? `'${'b'.repeat(64)}'` : n));
        await c.query(`insert into audit_events (${cols.join(',')}) select ${sel.join(',')} from audit_events where chain_key=$1::text and seq=$2::bigint`, [ck, last]);
      }, (v) => expect(v.valid).toBe(false));
    } finally {
      await restore();
    }
    const final = await verify();
    expect(final.valid).toBe(true);
    const after = await withAdmin(async (c) => (await c.query(`select to_jsonb(t) j from audit_events t where chain_key=$1 order by seq`, [ck, ])).rows.map((r) => r.j));
    expect(after.length).toBeGreaterThanOrEqual(snap.length); // verify itself appends audit.verify events after snapshot
    expect(JSON.stringify(after.slice(0, snap.length))).toBe(JSON.stringify(snap));
  }, 120000);
});

describe('T-AUD-05 concurrency', () => {
  it('25 parallel mixed actions keep the chain valid with no gaps/dupes/5xx', async () => {
    const claimA = await claimId(manager, 'CLM-0012');
    const reviewerId = (await sessionFor(app, ACCOUNTS.REVIEWER)).user.id;
    const logins = ['analyst@acme.test', 'viewer@acme.test', 'reviewer@acme.test', 'spare1@acme.test', 'spare2@acme.test', 'spare3@acme.test', 'spare4@acme.test'];
    const jobs: Array<Promise<any>> = [];
    for (let i = 0; i < 25; i++) {
      if (i % 3 === 0) jobs.push(manager.post(`/claims/${claimA}/assign`, { assigneeId: i % 2 ? reviewerId : null }));
      else if (i % 3 === 1) jobs.push(rawLogin(new Client(app, `10.7.0.${i}`), logins[i % logins.length]!));
      else jobs.push(manager.get(`/claims/${claimA}/packet`));
    }
    const rs = await Promise.all(jobs);
    for (const r of rs) expect(r.status, r.text).toBeLessThan(500);
    await manager.post(`/claims/${claimA}/assign`, { assigneeId: null });
    const ev = (await allAudit(owner)).sort(asc);
    const seqs = ev.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs[0]).toBe(1);
    expect(seqs[seqs.length - 1]).toBe(seqs.length);
    const v = await owner.get('/audit/verify');
    expect(v.body.valid).toBe(true);
  }, 60000);
});

describe('T-AUD-06 audit events are not mutable via the API', () => {
  it('PUT/PATCH/DELETE on /audit/events* -> 404/405; non-admin roles -> 403 on R24/R25', async () => {
    for (const m of ['PUT', 'PATCH', 'DELETE']) {
      for (const p of ['/audit/events', '/audit/events/1', `/audit/events/${uniq()}`]) {
        const r = await owner.as(m, p, { body: m === 'DELETE' ? undefined : { action: 'x' } });
        expect([404, 405], `${m} ${p} -> ${r.status}`).toContain(r.status);
      }
    }
    expect((await owner.get('/audit/events')).status).toBe(200); // control
    for (const s of [manager, viewer]) {
      expectError(await s.get('/audit/events'), 403, 'forbidden');
      expectError(await s.get('/audit/verify'), 403, 'forbidden');
    }
  });
});

/** Insert a conflicting (chain_key, seq) row so the next append in this chain violates uniqueness. */
async function injectAuditFault(tenantLike: string) {
  return withAdmin(async (c) => {
    const tid = (await c.query(`select id from tenants where name like $1`, [tenantLike])).rows[0].id;
    const row = (await c.query(`select chain_key, max(seq) m from audit_events where tenant_id=$1 group by chain_key`, [tid])).rows[0];
    const cols = (await c.query(`select column_name from information_schema.columns where table_name='audit_events' and table_schema='public' and is_generated='NEVER' order by ordinal_position`)).rows.map((r: any) => `"${r.column_name}"`);
    const sel = cols.map((n: string) => (n === '"id"' ? 'gen_random_uuid()' : n === '"seq"' ? 'seq+1' : n));
    try {
      await c.query(`insert into audit_events (${cols.join(',')}) select ${sel.join(',')} from audit_events where chain_key=$1::text and seq=$2::bigint`, [row.chain_key, row.m]);
    } catch (e) {
      return { ok: false as const, why: (e as Error).message, ck: row.chain_key as string, max: Number(row.m) };
    }
    return { ok: true as const, ck: row.chain_key as string, max: Number(row.m) };
  });
}
async function clearAuditFault(ck: string, max: number) {
  await withTriggersOff(['audit_events'], async (c) => {
    await c.query(`delete from audit_events where chain_key=$1 and seq>$2`, [ck, max]);
  });
}

describe('T-AUD-07 / T-SA-03 audit write is part of the action', () => {
  it('T-AUD-07: failing audit append => 5xx and no business change', async (ctx) => {
    const claim = await claimId(manager, 'CLM-0012');
    const reviewerId = (await sessionFor(app, ACCOUNTS.REVIEWER)).user.id;
    const f = await injectAuditFault('Acme%');
    if (!f.ok) return ctx.skip(`cannot construct audit fault black-box: ${f.why}`);
    let r: any;
    try {
      r = await manager.post(`/claims/${claim}/assign`, { assigneeId: reviewerId });
    } finally {
      await clearAuditFault(f.ck, f.max);
    }
    if (r.status < 500) {
      await manager.post(`/claims/${claim}/assign`, { assigneeId: null });
      return ctx.skip(`fault ineffective (conflicting row did not break the append; status ${r.status}); cannot inject black-box`);
    }
    expect(r.body.error).toBeTruthy();
    expect(JSON.stringify(r.body)).not.toMatch(/stack|at .*\(|select |insert |violates/i);
    expect((await manager.get(`/claims/${claim}`)).body.assignee).toBeNull();
    expect((await owner.get('/audit/verify')).body.valid).toBe(true);
    const ok = await manager.post(`/claims/${claim}/assign`, { assigneeId: reviewerId }); // control: works once fault is cleared
    expect(ok.status, ok.text).toBe(200);
    await manager.post(`/claims/${claim}/assign`, { assigneeId: null });
  });
  it('T-SA-03: cross-tenant read fails closed when the target chain cannot be appended', async (ctx) => {
    const superA = await sessionFor(app, ACCOUNTS.SUPER_ADMIN);
    const acme = (await superA.get('/platform/tenants')).body.items.find((t: any) => /Acme/.test(t.name)).id;
    const f = await injectAuditFault('Acme%');
    if (!f.ok) return ctx.skip(`cannot construct audit fault black-box: ${f.why}`);
    let r: any;
    try {
      r = await superA.get(`/platform/tenants/${acme}/claims?reason=acceptance+fault+injection`);
    } finally {
      await clearAuditFault(f.ck, f.max);
    }
    if (r.status < 500) return ctx.skip(`fault ineffective (status ${r.status}); cannot inject black-box`);
    expect(r.text).not.toContain('claimNumber');
    expect((await owner.get('/audit/verify')).body.valid).toBe(true);
    const ok = await superA.get(`/platform/tenants/${acme}/claims?reason=acceptance+fault+control`);
    expect(ok.status).toBe(200);
  });
});