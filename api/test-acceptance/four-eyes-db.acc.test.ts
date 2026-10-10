/* eslint-disable */
// REQ-20261009-four-eyes, database guarantees FE-B01..FE-B07 (test-spec T5; Part C P5). SQL runs as the runtime role
// freight_app; every write statement runs inside a transaction that is rolled back.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Session, buildTestApp, claimId, closeApps, sessionFor } from './helpers/client.js';
import { type PgClient, appDb, withAdmin } from './helpers/db.js';
import { childEnv } from './helpers/env.js';
import * as F from './helpers/fe.js';
import * as H from './helpers/imp.js';
import { reseed } from './helpers/seed.js';

const ROOT = resolve(__dirname, '..', '..');
const MIG = resolve(ROOT, 'api', 'prisma', 'migrations');
// sha256 of the three earlier migration.sql files as committed on feat/intelligence (git show feat/intelligence:<path>).
const FROZEN: Record<string, string> = {
  '20261008000000_init': 'bea2ee6796b489535845722913651534400ebac10e36aa6517b57306a378126c',
  '20261009000000_import_export': '8699637753c358bddef3863c9b281e4114c30dfa6bd77d9f7ef977b8c730b36c',
  '20261010000000_intelligence': '4f9717fc5428503c5e005c08cc7808b54514bdf5a077c9c8b98d2e301378d916',
};

let app: FastifyInstance;
let m: Session, rv: Session, owner: Session, an: Session, mgr: Session, gx: Session;
let acme = '', globex = '';
let claim = '', packet: any = null;
let pdf: { b: string; d: string } = { b: '', d: '' };
let png: { b: string; d: string } = { b: '', d: '' };
let c: PgClient;
/** approvals rows of the test claim before any rolled-back insert (the beforeAll edit writes one EDIT row). */
let baseApprovals = -1;
const approvalsOfClaim = () => withAdmin(async (x) => (await x.query(`select count(*)::int n from approvals where claim_id = $1`, [claim])).rows[0].n as number);

const approvalSql = (action: string, actorId: string, role: string, p = packet, cl = claim, tenant = acme) => ({
  sql: `INSERT INTO approvals (id, tenant_id, claim_id, packet_id, packet_revision, action, reason, from_status, to_status, content_hash, actor_id, actor_role)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::"ApprovalAction", $6, 'PENDING_REVIEW', 'APPROVED', $7, $8, $9)`,
  params: [tenant, cl, p.id, p.revision, action, F.R, p.integrity.contentHash, actorId, role],
});
const decisionSql = (doc: { d: string }, actorId: string, role: string) => ({
  sql: `INSERT INTO import_review_decisions (id, tenant_id, document_id, field_id, action, reason, actor_id, actor_role)
        VALUES (gen_random_uuid(), $1, $2, NULL, 'ACCEPT'::"ReviewAction", $3, $4, $5)`,
  params: [acme, doc.d, F.R, actorId, role],
});
const expectRefused = (o: F.PgOutcome, label: string) => {
  expect(o.ok, `${label} must fail`).toBe(false);
  expect(o.code, `${label}: ${o.message}`).toBe('P0001');
  expect(o.message, label).toBe(F.FE_CODE);
};

beforeAll(async () => {
  await H.assertS3Reachable();
  reseed();
  app = await buildTestApp();
  m = await sessionFor(app, ACCOUNTS.MANAGER);
  rv = await sessionFor(app, ACCOUNTS.REVIEWER);
  owner = await sessionFor(app, ACCOUNTS.OWNER);
  mgr = m;
  an = await sessionFor(app, ACCOUNTS.ANALYST);
  gx = await sessionFor(app, 'owner@globex.test');
  acme = m.user.tenant.id;
  globex = gx.user.tenant.id;
  claim = await claimId(m, 'CLM-0001');
  await F.editOk(m, claim, 1); // m is now a revision author of CLM-0001
  packet = (await owner.get(`/claims/${claim}/packet`)).body;
  expect(packet.createdBy.id).toBe(m.user.id);
  // document corrected by REVIEWER (uploaded by ANALYST)
  const p = await F.flaggedPdf(an, 'FB5');
  pdf = { b: p.batchId, d: p.doc.id };
  expect((await F.resolveF(rv, pdf.b, pdf.d, F.fid(p.doc, 'rate_confirmation.carrier'), { action: 'CORRECT', correctedValue: 'Corrected Carrier' })).status).toBe(200);
  // image document: type set by REVIEWER, field ADDed by MANAGER
  const ib = await H.newBatch(an);
  const im = await H.putOk(an, ib, 'scan.png', H.buildPng());
  png = { b: ib, d: im.id };
  expect((await rv.patch(F.docPath(ib, im.id), { docType: 'RATE_CONFIRMATION' })).status).toBe(200);
  expect((await mgr.post(`${F.docPath(ib, im.id)}/fields`, { key: 'rate_confirmation.load_number', value: H.uniqLoad('FB5'), reason: F.R })).status).toBe(201);
  c = await appDb();
  expect((await c.query('select current_user u')).rows[0].u).toBe('freight_app');
  baseApprovals = await approvalsOfClaim();
  expect(baseApprovals, 'the API edit wrote its EDIT row').toBeGreaterThanOrEqual(1);
}, 180000);
afterAll(async () => { try { await c?.end(); } finally { await closeApps(); reseed(); } });

describe('FE-B01..B04 approvals trigger', () => {
  it('FE-B01 (e): APPROVE by a revision author -> P0001 four_eyes_required', async () => {
    const q = approvalSql('APPROVE', m.user.id, 'MANAGER');
    expectRefused(await F.inTx(c, acme, q.sql, q.params), 'FE-B01');
    // authorship of a superseded revision counts too: insert against revision 1 (no creator) by the author of revision 2
    const p1 = (await owner.get(`/claims/${claim}/packet?revision=1`)).body;
    const q1 = approvalSql('APPROVE', m.user.id, 'MANAGER', p1);
    expectRefused(await F.inTx(c, acme, q1.sql, q1.params), 'FE-B01 rev 1 row');
  });
  it('FE-B02: REJECT by the author -> same error', async () => {
    const q = approvalSql('REJECT', m.user.id, 'MANAGER');
    expectRefused(await F.inTx(c, acme, q.sql, q.params), 'FE-B02');
  });
  it('FE-B03: non-author APPROVE/REJECT, author SEND_READY/EDIT succeed (rolled back)', async () => {
    for (const [a, u, r] of [['APPROVE', rv.user.id, 'REVIEWER'], ['REJECT', rv.user.id, 'REVIEWER'], ['SEND_READY', m.user.id, 'MANAGER'], ['EDIT', m.user.id, 'MANAGER']] as const) {
      const q = approvalSql(a, u, r);
      const o = await F.inTx(c, acme, q.sql, q.params);
      expect(o.ok, `${a} by ${r}: ${o.message}`).toBe(true);
    }
    expect(await approvalsOfClaim(), 'everything was rolled back').toBe(baseApprovals);
  });
  it('FE-B04: author insert without tenant context or with another tenant never succeeds', async () => {
    const q = approvalSql('APPROVE', m.user.id, 'MANAGER');
    const none = await F.inTx(c, null, q.sql, q.params);
    const other = await F.inTx(c, globex, q.sql, q.params);
    expect(none.ok, 'no tenant context').toBe(false);
    expect(other.ok, 'other tenant context').toBe(false);
    console.log(`[FE-B04] no context -> ${none.code} ${none.message}; globex context -> ${other.code} ${other.message}`);
    expect(await approvalsOfClaim(), 'nothing inserted').toBe(baseApprovals);
  });
});

describe('FE-B05 import_review_decisions trigger', () => {
  it('ACCEPT by uploader / CORRECT actor / ADD actor -> P0001; by an uninvolved user -> succeeds (rolled back)', async () => {
    const up = decisionSql(pdf, an.user.id, 'ANALYST');
    expectRefused(await F.inTx(c, acme, up.sql, up.params), 'FE-B05 uploader');
    const cor = decisionSql(pdf, rv.user.id, 'REVIEWER');
    expectRefused(await F.inTx(c, acme, cor.sql, cor.params), 'FE-B05 CORRECT actor');
    const add = decisionSql(png, mgr.user.id, 'MANAGER');
    expectRefused(await F.inTx(c, acme, add.sql, add.params), 'FE-B05 ADD actor');
    const settype = decisionSql(png, rv.user.id, 'REVIEWER');
    expect((await F.inTx(c, acme, settype.sql, settype.params)).ok, 'SET_TYPE actor is not an editor').toBe(true);
    const ok = decisionSql(pdf, owner.user.id, 'OWNER');
    const o = await F.inTx(c, acme, ok.sql, ok.params);
    expect(o.ok, o.message).toBe(true);
    const n = await withAdmin(async (x) => (await x.query(`select count(*)::int n from import_review_decisions where document_id = $1 and action = 'ACCEPT'`, [pdf.d])).rows[0].n);
    expect(n).toBe(0);
  });
  it('FE-B05 without tenant context: an uploader ACCEPT never succeeds', async () => {
    const up = decisionSql(pdf, an.user.id, 'ANALYST');
    expect((await F.inTx(c, null, up.sql, up.params)).ok).toBe(false);
    expect((await F.inTx(c, globex, up.sql, up.params)).ok).toBe(false);
  });
});

describe('FE-B06 migrations', () => {
  it('the four-eyes migration exists; the three earlier migration.sql files are byte-identical to feat/intelligence', () => {
    expect(existsSync(resolve(MIG, '20261011000000_four_eyes', 'migration.sql'))).toBe(true);
    for (const [dir, sha] of Object.entries(FROZEN)) {
      const got = createHash('sha256').update(readFileSync(resolve(MIG, dir, 'migration.sql'))).digest('hex');
      expect(got, dir).toBe(sha);
    }
  });
});

describe('FE-B07 migrate + seed on top of the four-eyes migration', () => {
  it('migrate deploy and db:seed -- --reset succeed; seeded APPROVED/REJECTED/SEND_READY history intact', async () => {
    const r = spawnSync('npm', ['run', 'db:migrate:deploy'], { cwd: ROOT, env: childEnv(), shell: true, encoding: 'utf8' });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    reseed();
    const fresh = await buildTestApp();
    const o = await sessionFor(fresh, ACCOUNTS.OWNER);
    for (const [num, actions, status] of [['CLM-0016', ['APPROVE'], 'APPROVED'], ['CLM-0019', ['REJECT'], 'REJECTED'], ['CLM-0022', ['APPROVE', 'SEND_READY'], 'SEND_READY']] as const) {
      const id = await claimId(o, num);
      const p = (await o.get(`/claims/${id}/packet`)).body;
      expect(p.status, num).toBe(status);
      expect(p.approvals.map((a: any) => a.action).sort(), num).toEqual([...actions].sort());
    }
    const n = await withAdmin(async (x) => (await x.query(`select count(*)::int n from approvals`)).rows[0].n);
    expect(n).toBeGreaterThan(0);
  }, 300000);
});
