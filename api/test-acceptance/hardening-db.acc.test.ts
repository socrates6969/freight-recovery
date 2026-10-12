/* eslint-disable */
// REQ-20261012-hardening Tier H: T3 database guards HD-D01..HD-D10 (Part C C2). SQL as the runtime role freight_app
// in a tenant transaction (rolled back unless a COMMIT is the subject), owner SQL where stated. Fixtures are built
// through the API (influenced claim, D&D claim with an intermediate editor) and the seed.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Session, buildTestApp, closeApps, sessionFor } from './helpers/client.js';
import * as A from './helpers/analysis.js';
import * as D from './helpers/dd.js';
import { type PgClient, adminDb, appDb, withAdmin } from './helpers/db.js';
import * as F from './helpers/fe.js';
import * as X from './helpers/hardening.js';
import * as H from './helpers/imp.js';
import * as K from './helpers/keys.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
let O1: Session, M1: Session, AN1: Session, V1: Session, R1: Session, R2: Session, R4: Session, M3: Session;
let tid = '';
let c: PgClient;
let own: PgClient;
let inf: X.Influenced;
let dd: { claimId: string; packet: any } = { claimId: '', packet: null };

const refused = (o: X.Outcome, msg: string, label: string) => {
  expect(o.ok, `${label} must fail`).toBe(false);
  expect(o.code, `${label}: ${o.message}`).toBe('P0001');
  expect(o.message, label).toBe(msg);
};

beforeAll(async () => {
  await H.assertS3Reachable();
  reseed(); // HD-D09: the seed runs on the migrated schema (throws when db:seed --reset exits non-zero)
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50', FLAGS_CACHE_TTL_MS: '0' });
  O1 = await sessionFor(app, ACCOUNTS.OWNER);
  M1 = await sessionFor(app, ACCOUNTS.MANAGER);
  AN1 = await sessionFor(app, ACCOUNTS.ANALYST);
  V1 = await sessionFor(app, ACCOUNTS.VIEWER);
  R1 = await sessionFor(app, ACCOUNTS.REVIEWER);
  R2 = (await K.newSession(app, O1, 'REVIEWER')).s;
  R4 = (await K.newSession(app, O1, 'REVIEWER')).s;
  M3 = (await K.newSession(app, O1, 'MANAGER')).s;
  tid = O1.user.tenant.id;
  await X.clearLabels(tid);
  const x = await X.putLabelOk(R1, X.PJ, 'accessorial', 'created');
  inf = await X.influenced(tid, AN1, M1, AN1, [x], 'HD-D');
  // D&D claim: R2 creates the invoice (created_by_id), M3 edits it in between (only in the audit chain as a
  // dd_invoice.updated actor), R4 edits it last (updated_by_id); M1 runs the audit (revision author).
  const tariff = await D.newTariff(O1, D.MAERSK);
  const num = D.uniq('SYN-DD-HDD');
  const body = (n: string) => ({ ...D.si4(), invoiceNumber: n, tariffId: tariff, calendarId: null });
  const created = await D.newInvoice(R2, { ...D.si4(), invoiceNumber: num }, tariff);
  expect((await D.putInvoice(M3, created.id, { version: 1, invoice: { ...body(num), dueDate: '2026-04-27' } })).status).toBe(200);
  expect((await D.putInvoice(R4, created.id, { version: 2, invoice: { ...body(num), dueDate: '2026-04-28' } })).status).toBe(200);
  const a = await D.audit(M1, created.id);
  expect(a.status, a.text).toBe(201);
  const row = await withAdmin(async (q) => (await q.query('select created_by_id, updated_by_id from dd_invoices where id = $1', [created.id])).rows[0]);
  expect([row.created_by_id, row.updated_by_id], 'M3 is only in the audit chain').toEqual([R2.user.id, R4.user.id]);
  dd = { claimId: a.body.claim.id, packet: (await V1.get(`/claims/${a.body.claim.id}/packet`)).body };
  c = await appDb();
  own = await adminDb();
  expect((await c.query('select current_user u')).rows[0].u).toBe('freight_app');
}, 300000);
afterAll(async () => { try { await c?.end(); await own?.end(); await closeApps(); } finally { reseed(); } });

const ins = (claim: string, packet: any, action: string, toStatus: string, s: Session, tenant = tid) =>
  X.approvalInsert({ tenant, claim, packet, action, toStatus, actorId: s.user.id, role: s.user.role });

describe('HD-D01..D04 approvals_four_eyes_ext_guard (C2.1)', () => {
  it('HD-D01 label author R1: APPROVE and REJECT inserts -> P0001 four_eyes_required; nothing inserted', async () => {
    const n0 = await X.approvalsOf(inf.made.claimId);
    refused(await X.tx(c, tid, [ins(inf.made.claimId, inf.packet, 'APPROVE', 'APPROVED', R1)], false), 'four_eyes_required', 'HD-D01 APPROVE');
    refused(await X.tx(c, tid, [ins(inf.made.claimId, inf.packet, 'REJECT', 'REJECTED', R1)], false), 'four_eyes_required', 'HD-D01 REJECT');
    expect(await X.approvalsOf(inf.made.claimId)).toBe(n0);
  });
  it('HD-D02 intermediate D&D editor (audit chain only), creator and last editor -> P0001 four_eyes_required', async () => {
    for (const [s, label] of [[M3, 'intermediate'], [R2, 'creator'], [R4, 'last editor']] as const) {
      refused(await X.tx(c, tid, [ins(dd.claimId, dd.packet, 'APPROVE', 'APPROVED', s)], false), 'four_eyes_required', `HD-D02 ${label} APPROVE`);
      refused(await X.tx(c, tid, [ins(dd.claimId, dd.packet, 'REJECT', 'REJECTED', s)], false), 'four_eyes_required', `HD-D02 ${label} REJECT`);
    }
  });
  it('HD-D03 owner connection (BYPASSRLS) and freight_app without app.tenant_id: still refused', async () => {
    refused(await X.tx(own, null, [ins(inf.made.claimId, inf.packet, 'APPROVE', 'APPROVED', R1)], false), 'four_eyes_required', 'HD-D03 owner label author');
    refused(await X.tx(own, null, [ins(dd.claimId, dd.packet, 'APPROVE', 'APPROVED', M3)], false), 'four_eyes_required', 'HD-D03 owner D&D editor');
    refused(await X.tx(c, null, [ins(inf.made.claimId, inf.packet, 'APPROVE', 'APPROVED', R1)], false), 'four_eyes_required', 'HD-D03 tenant unset');
  });
  it('HD-D04 M1 (no basis) is not refused by these triggers; EDIT and SEND_READY rows of a label author are not checked', async () => {
    const ok = await X.tx(c, tid, [ins(inf.made.claimId, inf.packet, 'APPROVE', 'APPROVED', M1)], false);
    expect(ok.ok, ok.message).toBe(true);
    for (const [action, to] of [['EDIT', 'PENDING_REVIEW'], ['SEND_READY', 'SEND_READY']] as const) {
      const o = await X.tx(c, tid, [ins(inf.made.claimId, inf.packet, action, to, R1)], false);
      expect(o.message, `${action} row not refused as four-eyes`).not.toBe('four_eyes_required');
    }
  });
});

describe('HD-D05..D07 evidence_packets_decision_guard (C2.2)', () => {
  let p: { claimId: string; packet: any };
  let approved: { claimId: string; packet: any };
  it('fixtures: one PENDING_REVIEW packet and one APPROVED packet (via the API)', async () => {
    const a = await A.smallClaim(AN1, M1, 'HD-D05');
    await X.analyzeOk(AN1, a.claimId);
    p = { claimId: a.claimId, packet: (await V1.get(`/claims/${a.claimId}/packet`)).body };
    const b = await A.smallClaim(AN1, M1, 'HD-D05b');
    await X.analyzeOk(AN1, b.claimId);
    const r = await F.approve(M1, b.claimId, 1);
    expect(r.status, r.text).toBe(200);
    approved = { claimId: b.claimId, packet: (await V1.get(`/claims/${b.claimId}/packet`)).body };
    expect(approved.packet.status).toBe('APPROVED');
  }, 180000);
  it('HD-D05 UPDATE status to APPROVED / REJECTED without an approvals row: COMMIT fails packet_decision_unrecorded; status unchanged', async () => {
    for (const st of ['APPROVED', 'REJECTED']) {
      const o = await X.tx(c, tid, [{ sql: `UPDATE evidence_packets SET status = $2::"PacketStatus" WHERE id = $1`, params: [p.packet.id, st] }], true);
      refused(o, 'packet_decision_unrecorded', `HD-D05 ${st}`);
      expect(o.at, `${st}: refused at COMMIT (deferred)`).toBe('commit');
      expect(await X.packetStatus(p.packet.id)).toBe('PENDING_REVIEW');
    }
    const s = await X.tx(c, tid, [{ sql: `UPDATE evidence_packets SET status = 'SEND_READY' WHERE id = $1`, params: [approved.packet.id] }], true);
    refused(s, 'packet_decision_unrecorded', 'HD-D05 SEND_READY');
    expect(s.at).toBe('commit');
    expect(await X.packetStatus(approved.packet.id)).toBe('APPROVED');
  });
  it('HD-D06 SET CONSTRAINTS ... IMMEDIATE: with a matching approvals row the UPDATE passes; without it the UPDATE itself raises', async () => {
    const imm = { sql: 'SET CONSTRAINTS evidence_packets_decision_guard IMMEDIATE' };
    const upd = { sql: `UPDATE evidence_packets SET status = 'APPROVED' WHERE id = $1`, params: [p.packet.id] };
    const ok = await X.tx(c, tid, [imm, ins(p.claimId, p.packet, 'APPROVE', 'APPROVED', M1), upd], false);
    expect(ok.ok, ok.message).toBe(true);
    const bad = await X.tx(c, tid, [imm, upd], false);
    refused(bad, 'packet_decision_unrecorded', 'HD-D06 without row');
    expect(bad.at).toBe('step 1');
    expect(await X.packetStatus(p.packet.id)).toBe('PENDING_REVIEW');
  });
  it('HD-D07 UPDATE to SUPERSEDED without an approvals row (owner, triggers on) is not refused by the decision guard', async () => {
    const o = await X.tx(own, null, [{ sql: 'SET CONSTRAINTS evidence_packets_decision_guard IMMEDIATE' }, { sql: `UPDATE evidence_packets SET status = 'SUPERSEDED' WHERE id = $1`, params: [p.packet.id] }], false);
    expect(o.message, `${o.code} ${o.message}`).not.toBe('packet_decision_unrecorded');
    expect(await X.packetStatus(p.packet.id)).toBe('PENDING_REVIEW');
  });
});

describe('HD-D08 claims_awaiting_amounts_zero (C2.3)', () => {
  it('owner UPDATE of an awaiting claim amount and INSERT of an awaiting claim with an amount -> 23514 claims_awaiting_amounts_zero', async () => {
    const aw = await A.smallClaim(AN1, M1, 'HD-D08');
    for (const col of ['recoverable_cents', 'amount_claimed_cents', 'pending_review_cents']) {
      const u = await X.tx(own, null, [{ sql: `UPDATE claims SET ${col} = 1 WHERE id = $1`, params: [aw.claimId] }], false);
      expect([u.ok, u.code], `${col}: ${u.message}`).toEqual([false, '23514']);
      expect(u.constraint ?? u.message).toContain('claims_awaiting_amounts_zero');
    }
    const i = await X.tx(own, null, [{
      sql: `INSERT INTO claims (id, tenant_id, claim_number, carrier_name, shipper_name, perspective, status, amount_claimed_cents, recoverable_cents, pending_review_cents, currency, version, created_at, updated_at)
            VALUES (gen_random_uuid(), $1, 'HD-D08-INS', 'Synthetic Carrier', 'Synthetic Shipper', 'SHIPPER', 'AWAITING_ANALYSIS', 5, 0, 0, 'USD', 0, now(), now())`, params: [tid],
    }], false);
    expect([i.ok, i.code], i.message).toEqual([false, '23514']);
    expect(i.constraint ?? i.message).toContain('claims_awaiting_amounts_zero');
    const row = await A.dbClaim(aw.claimId);
    expect([row.amount_claimed_cents, row.recoverable_cents, row.pending_review_cents].map(Number)).toEqual([0, 0, 0]);
  }, 120000);
});

describe('HD-D09 / HD-D11 normal flows after the migration', () => {
  it('seed exit 0 (beforeAll); analyse 201, approve 200, send 200, reject 200, edit 201; no 500', async () => {
    const a = await A.smallClaim(AN1, M1, 'HD-D09a');
    const r1 = await A.analyze(AN1, a.claimId);
    expect(r1.status, r1.text).toBe(201);
    const ap = await F.approve(M1, a.claimId, 1);
    expect(ap.status, ap.text).toBe(200);
    const se = await F.send(M1, a.claimId, 1);
    expect(se.status, se.text).toBe(200);
    const b = await A.smallClaim(AN1, M1, 'HD-D09b');
    const r2 = await A.analyze(AN1, b.claimId);
    expect(r2.status, r2.text).toBe(201);
    const ed = await F.edit(M1, b.claimId, 1);
    expect(ed.status, ed.text).toBe(201);
    const rj = await F.reject(R1, b.claimId, 2);
    expect(rj.status, rj.text).toBe(200);
    X.no500([r1, ap, se, r2, ed, rj], 'HD-D09');
    expect((await O1.get('/audit/verify')).body.valid).toBe(true);
  }, 180000);
});

describe('HD-D10 catalog (C2)', () => {
  it('triggers exist and are enabled; decision guard deferrable/initially deferred; functions definer, search_path, no PUBLIC execute; BASE triggers kept', async () => {
    const trg = (await own.query(`select t.tgname, t.tgenabled, t.tgdeferrable, t.tginitdeferred, c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal or t.tgname = 'evidence_packets_decision_guard'`)).rows as any[];
    const by = new Map(trg.map((t) => [t.tgname, t]));
    expect(by.get('approvals_four_eyes_ext_guard')?.relname).toBe('approvals');
    expect(by.get('approvals_four_eyes_ext_guard')?.tgenabled).toBe('O');
    const dg = by.get('evidence_packets_decision_guard');
    expect(dg?.relname).toBe('evidence_packets');
    expect(dg?.tgenabled).toBe('O');
    expect([dg?.tgdeferrable, dg?.tginitdeferred]).toEqual([true, true]);
    expect(by.get('approvals_four_eyes_guard')?.relname, 'BASE four-eyes trigger still present').toBe('approvals');
    for (const fn of ['fr_approval_four_eyes_ext_guard', 'fr_packet_decision_guard']) {
      const f = (await own.query(`select p.prosecdef, p.proconfig, has_function_privilege('public', p.oid, 'EXECUTE') pub from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn])).rows;
      expect(f, fn).toHaveLength(1);
      expect(f[0].prosecdef, `${fn} SECURITY DEFINER`).toBe(true);
      expect((f[0].proconfig ?? []).join('|'), `${fn} search_path`).toMatch(/search_path=public, ?pg_temp/);
      expect(f[0].pub, `${fn} PUBLIC execute revoked`).toBe(false);
    }
    const con = (await own.query(`select convalidated from pg_constraint where conname = 'claims_awaiting_amounts_zero'`)).rows;
    expect(con).toEqual([{ convalidated: true }]);
  });
  it('BASE trigger set kept: every non-internal trigger present at BASE still exists (count does not drop)', async () => {
    const names = (await own.query(`select t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal`)).rows.map((r: any) => r.tgname as string);
    for (const t of ['approvals_four_eyes_guard', 'approvals_four_eyes_ext_guard']) expect(names, t).toContain(t);
    expect(names.length).toBeGreaterThanOrEqual(10);
  });
});
