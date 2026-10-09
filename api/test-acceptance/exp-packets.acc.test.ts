/* eslint-disable */
// EXP-06 audit, EXP-09 packets, EXP-10 outcomes, EXP-11 no PII.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, buildTestApp, claimId, closeApps, sessionFor, type Session } from './helpers/client.js';
import * as H from './helpers/imp.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
let mgr: Session, rev: Session, owner: Session;
const PH = ['Claim Number', 'Load Number', 'Packet Revision', 'Packet Status', 'Content Hash', 'Verifier Status', 'Rule ID', 'Finding', 'Direction', 'Amount (USD)', 'Confidence', 'Needs Human Review', 'Explanation', 'Clause', 'Citations'];
const OH = ['Claim Number', 'Packet Revision', 'Action', 'From Status', 'To Status', 'Reason', 'Actor Role', 'Content Hash', 'Decided At'];
beforeAll(async () => {
  await H.assertS3Reachable();
  app = await buildTestApp();
  mgr = H.wrap(await sessionFor(app, ACCOUNTS.MANAGER));
  rev = H.wrap(await sessionFor(app, ACCOUNTS.REVIEWER));
  owner = H.wrap(await sessionFor(app, ACCOUNTS.OWNER));
});
afterAll(async () => { try { H.assertRecorded('exp-packets'); } finally { await closeApps(); reseed(); } });

const csv = async (s: Session, ent: string, q = '') => {
  const r = await H.download(s, `/exports/${ent}?format=csv${q}`);
  expect(r.status, r.text.slice(0, 200)).toBe(200);
  return { r, rows: H.parseCsvDetailed(r.buf.toString('utf8')) };
};
async function allClaims() {
  const out: any[] = [];
  for (let p = 1; p < 20; p++) { const r = await mgr.get(`/claims?page=${p}&pageSize=100`); out.push(...r.body.items); if (r.body.items.length < 100) break; }
  return out;
}
async function expectedPacketRows() {
  const exp: { no: string; rev: number; hash: string; n: number }[] = [];
  const letters: string[] = [];
  for (const c of (await allClaims()).filter((x) => x.latestPacket)) {
    const p = (await mgr.get(`/claims/${c.id}/packet`)).body;
    exp.push({ no: c.claimNumber, rev: p.revision, hash: p.integrity.contentHash, n: p.findings.length });
    letters.push(String(p.demandLetter).slice(0, 40));
  }
  return { exp, letters };
}
describe('EXP-09 packets', () => {
  it('rows = findings of the latest packet of every claim with a packet; hash equals; no demand letter; new revision replaces old', async () => {
    const { rows } = await csv(mgr, 'packets');
    expect(rows[0]!.map((c) => c.v)).toEqual(PH);
    const { exp, letters } = await expectedPacketRows();
    const data = rows.slice(1);
    expect(data.length).toBe(exp.reduce((a, e) => a + e.n, 0));
    for (const e of exp) {
      const mine = data.filter((r) => r[0]!.v === e.no);
      expect(mine.length, e.no).toBe(e.n);
      for (const r of mine) { expect(r[2]!.v).toBe(String(e.rev)); expect(r[4]!.v).toBe(e.hash); expect(['true', 'false']).toContain(r[11]!.v); expect(r[3]!.v).not.toBe('SUPERSEDED'); }
    }
    const raw = rows.map((r) => r.map((c) => c.v).join('|')).join('\n');
    for (const l of letters) if (l.trim().length > 20) expect(raw.includes(l)).toBe(false);
    const id = await claimId(mgr, 'CLM-0010');
    const p0 = (await mgr.get(`/claims/${id}/packet`)).body;
    const rv = await rev.post(`/claims/${id}/packet/revisions`, { baseRevision: p0.revision, demandLetter: 'Revised demand letter text for the export test.', reason: 'export test revision' });
    expect(rv.status, rv.text).toBe(201);
    const after = (await csv(mgr, 'packets')).rows.slice(1).filter((r) => r[0]!.v === 'CLM-0010');
    expect(after.length).toBeGreaterThan(0);
    for (const r of after) { expect(r[2]!.v).toBe(String(p0.revision + 1)); expect(r[3]!.v).not.toBe('SUPERSEDED'); }
  });
  it('AWAITING_ANALYSIS claims have no packet rows', async () => {
    const b = await H.newBatch(mgr);
    await H.putOk(mgr, b, 'i.txt', Buffer.from(H.invoiceTxt(H.uniqLoad('PK'))));
    const c = await H.commit(mgr, b);
    const no = c.body.created[0].claimNumber;
    expect((await csv(mgr, 'packets')).rows.some((r) => r[0]!.v === no)).toBe(false);
  });
});
describe('EXP-10 outcomes and EXP-11 PII', () => {
  it('one row per approval record, role only, filters, neutralized reason', async () => {
    const id = await claimId(mgr, 'CLM-0011');
    const p = (await mgr.get(`/claims/${id}/packet`)).body;
    const reason = String.fromCharCode(61) + 'cmd|calc!A0 reviewed';
    const ap = await rev.post(`/claims/${id}/packet/approve`, { packetRevision: p.revision, reason });
    expect([200, 409]).toContain(ap.status);
    const { rows } = await csv(mgr, 'outcomes');
    expect(rows[0]!.map((c) => c.v)).toEqual(OH);
    const data = rows.slice(1);
    const times = data.map((r) => Date.parse(r[8]!.v));
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!);
    const raw = rows.map((r) => r.map((c) => c.v).join('|')).join('\n');
    for (const u of [mgr.user, rev.user, owner.user]) { expect(raw).not.toContain(u.email); expect(raw).not.toContain(u.name); expect(raw).not.toContain(u.id); }
    expect(raw).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    if (ap.status === 200) expect(data.some((r) => r[5]!.v.startsWith(String.fromCharCode(39) + '=cmd'))).toBe(true);
    const only = await csv(mgr, 'outcomes', '&action=APPROVE,REJECT');
    for (const r of only.rows.slice(1)) expect(['APPROVE', 'REJECT']).toContain(r[2]!.v);
    const one = await csv(mgr, 'outcomes', `&claimId=${id}`);
    for (const r of one.rows.slice(1)) expect(r[0]!.v).toBe('CLM-0011');
    const day = data[0]![8]!.v.slice(0, 10);
    const rng = await csv(mgr, 'outcomes', `&from=${day}&to=${day}`);
    for (const r of rng.rows.slice(1)) expect(r[8]!.v.slice(0, 10)).toBe(day);
  });
  it('assigning a claim does not change the claims export; no assignee column', async () => {
    const before = (await csv(mgr, 'claims')).r.buf.toString('utf8');
    const id = await claimId(mgr, 'CLM-0012');
    await mgr.post(`/claims/${id}/assign`, { assigneeId: rev.user.id });
    const after = (await csv(mgr, 'claims')).r.buf.toString('utf8').split('\r\n');
    await mgr.post(`/claims/${id}/assign`, { assigneeId: null });
    expect(after[0]).not.toMatch(/assign/i);
    expect(after.join('\r\n')).not.toContain(rev.user.name);
    expect(before.split('\r\n').length).toBe(after.length);
  });
});
describe('EXP-06 audit', () => {
  it('export.started then export.completed with rowCount, sha256 and bytes of the delivered file; no filter text', async () => {
    const seq = await H.lastSeq(owner);
    const r = await H.download(mgr, '/exports/claims?format=csv&q=CLM-000');
    const ev = (await H.auditSince(owner, seq)).filter((e) => e.action.startsWith('export.'));
    expect(ev.map((e) => e.action)).toEqual(['export.started', 'export.completed']);
    expect(ev[1].actor?.id).toBe(mgr.user.id);
    const m = ev[1].metadata;
    expect(m.sha256).toBe(H.sha256(r.buf));
    expect(m.bytes ?? m.byteLength).toBe(r.buf.length);
    expect(m.rowCount).toBe(H.parseCsv(r.buf.toString('utf8')).length - 1);
    expect(JSON.stringify(ev)).not.toContain('CLM-000');
    expect((await owner.get('/audit/verify')).body.valid).toBe(true);
  });
  it.skip('audit store unavailable at export start -> no bytes sent (needs a throwaway DB copy with INSERT revoked; not run)', () => undefined);
});
