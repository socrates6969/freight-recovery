/* eslint-disable */
// T-PKT-01..07
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Session, allAudit, buildTestApp, claimId, closeApps, expectError, sessionFor } from './helpers/client.js';
import { withAdmin, withTriggersOff } from './helpers/db.js';
import { allStrings, validatePacket } from './helpers/packet.js';
import { reseed } from './helpers/seed.js';

const REPO = resolve(__dirname, '..', '..');
let app: FastifyInstance;
let m: Session, owner: Session;
beforeAll(async () => {
  reseed();
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
  m = await sessionFor(app, ACCOUNTS.MANAGER);
  owner = await sessionFor(app, ACCOUNTS.OWNER);
});
afterAll(closeApps);
const packet = async (num: string, qs = '') => (await m.get(`/claims/${await claimId(m, num)}/packet${qs}`));

describe('T-PKT-01 shape', () => {
  it('CLM-0001 validates against the C4 DTO and is internally consistent', async () => {
    const r = await packet('CLM-0001');
    expect(r.status, r.text).toBe(200);
    const p = r.body;
    validatePacket(p);
    expect(p.sources.length).toBeGreaterThanOrEqual(1);
    expect(p.timeline.length).toBeGreaterThanOrEqual(3);
    expect(p.findings.length).toBeGreaterThanOrEqual(1);
    expect(p.integrity.valid).toBe(true);
    expect(p.integrity.contentHash).toBe(p.integrity.recomputedHash);
    expect(p.verifier.status).toBe('PASSED');
    expect(p.revision).toBe(1);
  });
  it('every seeded packet validates and has integrity.valid=true (seed contract)', async () => {
    const list = (await m.get('/claims?pageSize=100')).body.items;
    for (const c of list) {
      const p = (await m.get(`/claims/${c.id}/packet`)).body;
      validatePacket(p);
      expect(p.integrity.valid, c.claimNumber).toBe(true);
      expect(p.status, c.claimNumber).toBe(c.status); // ClaimSummary.status == latest packet status
      expect(c.latestPacket).toMatchObject({ revision: p.revision, status: p.status });
      const want = c.claimNumber === 'CLM-0001' ? 'PASSED' : c.claimNumber === 'CLM-0002' ? 'NEEDS_REVIEW' : 'NOT_RUN';
      if (/^CLM-/.test(c.claimNumber)) expect(p.verifier.status, c.claimNumber).toBe(want);
    }
  }, 120000);
});

function pythonCmd(): string[] | null {
  const cands = [resolve(REPO, '.venv/Scripts/python.exe'), resolve(REPO, '.venv/bin/python'), 'python3', 'python'];
  for (const c of cands) {
    if (c.includes('.venv') && !existsSync(c)) continue;
    const r = spawnSync(c, ['-c', 'import freight_recovery'], { cwd: REPO, env: { ...process.env, PYTHONPATH: resolve(REPO, 'src') }, encoding: 'utf8' });
    if (r.status === 0) return [c];
  }
  return null;
}
const dollars = (s: string) => Math.round(parseFloat(s.replace(/,/g, '')) * 100);
function parsePython(out: string) {
  const rec = dollars(/\*\*Recoverable[^*]*\*\*\s*\$([\d,.]+)/.exec(out)![1]!);
  const pend = dollars(/\*\*Pending human review[^*]*\*\*\s*\$([\d,.]+)/.exec(out)![1]!);
  const findings = [...out.matchAll(/^### \d+\. (.+?) - \$([\d,.]+)( \*\*\[needs human review\]\*\*)?\s*\nRule `([^`]+)`/gm)].map((x) => ({ title: x[1]!, cents: dollars(x[2]!), review: !!x[3], rule: x[4]! }));
  const sources = [...out.matchAll(/^- `([^`]+)` \(([^)]+)\) sha256 `([0-9a-f]{64})`/gm)].map((x) => ({ file: x[1]!.replace(/\\/g, ''), sha: x[3]! }));
  const other = [...out.matchAll(/^- (.+?): \$([\d,.]+) \((underbilled|overcharge)\)/gm)].map((x) => ({ cents: dollars(x[2]!), dir: x[3]! }));
  return { rec, pend, findings, sources, other };
}

describe('T-PKT-02 fixture parity with the Python tool', () => {
  const cases: Array<[string, string, string[]]> = [
    ['CLM-0001', 'tests/fixtures/ld5001', ['invoice.txt', 'rate_confirmation.txt', 'bol.txt']],
    ['CLM-0002', 'tests/fixtures/ld5002', ['invoice.csv', 'ratecon.csv', 'bol.csv']],
  ];
  for (const [num, dir, files] of cases) {
    it(`${num} matches the reference run on ${dir}`, async (ctx) => {
      const py = pythonCmd();
      if (!py) return ctx.skip('python / freight_recovery not importable in this environment');
      expect(readdirSync(resolve(REPO, dir)).sort()).toEqual([...files].sort());
      const p = (await packet(num)).body;
      const persp = String(p.perspective).toLowerCase();
      const r = spawnSync(py[0]!, ['-m', 'freight_recovery.cli', '--perspective', persp, ...files.map((f) => `${dir}/${f}`)], {
        cwd: REPO, env: { ...process.env, PYTHONPATH: resolve(REPO, 'src') }, encoding: 'utf8',
      });
      expect(r.status, r.stderr).toBe(0);
      const ref = parsePython(r.stdout);
      const dirMine = persp === 'shipper' ? 'OVERCHARGE' : 'UNDERBILLED';
      const mine = p.findings.filter((f: any) => f.direction === dirMine);
      expect(mine.map((f: any) => `${f.ruleId}:${f.amountCents}`).sort()).toEqual(ref.findings.map((f) => `${f.rule}:${f.cents}`).sort());
      expect(mine.filter((f: any) => f.needsHumanReview).map((f: any) => f.ruleId).sort()).toEqual(ref.findings.filter((f) => f.review).map((f) => f.rule).sort());
      expect(p.recoverableCents).toBe(ref.rec);
      expect(p.pendingReviewCents).toBe(ref.pend);
      const excl = mine.filter((f: any) => f.needsHumanReview).reduce((a: number, f: any) => a + f.amountCents, 0);
      expect(p.recoverableCents + excl).toBe(mine.reduce((a: number, f: any) => a + f.amountCents, 0));
      // other-direction items carry no rule id in the reference output and are not part of the parity contract
      // hash the COMMITTED bytes (git blob), so a Windows autocrlf checkout cannot change the reference
      const blob = (f: string) => spawnSync('git', ['show', `HEAD:${dir}/${f}`], { cwd: REPO, maxBuffer: 1 << 24 }).stdout;
      const shaLocal = Object.fromEntries(files.map((f) => [f, createHash('sha256').update(blob(f)).digest('hex')]));
      expect(p.sources.map((s: any) => s.sha256).sort()).toEqual(Object.values(shaLocal).sort());
      expect(ref.sources.map((s) => s.file).sort()).toEqual([...files].sort()); // reference sha256 is of the CRLF working copy on Windows; the committed-bytes hash above is the oracle
      for (const s of p.sources) expect(shaLocal[s.filename], `${s.filename} sha`).toBe(s.sha256);
    });
  }
});

describe('T-PKT-03 revision selection', () => {
  it('?revision=1 returns the superseded first revision; 999 -> 404; abc -> 400', async () => {
    const id = await claimId(m, 'CLM-0018');
    const base = (await m.get(`/claims/${id}/packet`)).body;
    expect(base.revision).toBe(1);
    const ed = await m.post(`/claims/${id}/packet/revisions`, { baseRevision: 1, demandLetter: 'Revision two letter for PKT-03', reason: 'packet revision selection test' });
    expect(ed.status, ed.text).toBe(201);
    const r1 = await m.get(`/claims/${id}/packet?revision=1`);
    expect(r1.body.revision).toBe(1);
    expect(r1.body.status).toBe('SUPERSEDED');
    const latest = (await m.get(`/claims/${id}/packet`)).body;
    expect(latest.revision).toBe(2);
    expect(latest.status).toBe('PENDING_REVIEW');
    expect((await m.get(`/claims/${id}/packet?revision=2`)).body.id).toBe(latest.id);
    expectError(await m.get(`/claims/${id}/packet?revision=999`), 404, 'not_found');
    expectError(await m.get(`/claims/${id}/packet?revision=abc`), 400, 'validation_error');
    expect(r1.body.integrity.valid).toBe(true);
  });
});

describe('T-PKT-04 history', () => {
  it('seeded APPROVED/REJECTED/SEND_READY claims carry attributable approval history', async () => {
    for (const [num, action] of [['CLM-0016', 'APPROVE'], ['CLM-0019', 'REJECT'], ['CLM-0022', 'SEND_READY']] as const) {
      const p = (await packet(num)).body;
      expect(p.approvals.length, num).toBeGreaterThanOrEqual(1);
      expect(p.approvals.some((a: any) => a.action === action), `${num} has ${action}`).toBe(true);
      for (const a of p.approvals) {
        expect(a.reason.trim().length).toBeGreaterThan(0);
        expect(a.actor.name).toBeTruthy();
        expect(a.actor.role).toBeTruthy();
        expect(a.fromStatus).toBeTruthy();
        expect(a.toStatus).toBeTruthy();
      }
    }
  });
});

describe('T-PKT-05 tamper evidence', () => {
  it('editing the stored letter flips integrity.valid; restoring flips it back; app role cannot do it', async () => {
    const id = await claimId(m, 'CLM-0004');
    const before = (await m.get(`/claims/${id}/packet`)).body;
    expect(before.integrity.valid).toBe(true);
    const row = await withAdmin(async (c) => (await c.query(`select p.id, p.demand_letter from evidence_packets p join claims cl on cl.id=p.claim_id where cl.claim_number='CLM-0004' order by p.revision desc limit 1`)).rows[0]);
    try {
      await withTriggersOff(['evidence_packets'], (c) => c.query(`update evidence_packets set demand_letter = demand_letter || 'X' where id=$1`, [row.id]));
      const bad = (await m.get(`/claims/${id}/packet`)).body;
      expect(bad.integrity.valid).toBe(false);
      expect(bad.integrity.contentHash).not.toBe(bad.integrity.recomputedHash);
    } finally {
      await withTriggersOff(['evidence_packets'], (c) => c.query(`update evidence_packets set demand_letter=$2 where id=$1`, [row.id, row.demand_letter]));
    }
    const after = (await m.get(`/claims/${id}/packet`)).body;
    expect(after.integrity.valid).toBe(true);
    expect(after.integrity.contentHash).toBe(before.integrity.contentHash);
    expect(after.demandLetter).toBe(before.demandLetter);
  });
});

describe('T-PKT-06 viewing is audited once per call', () => {
  it('3 views => 3 packet.viewed events carrying the revision', async () => {
    const id = await claimId(m, 'CLM-0007');
    const n = async () => await allAudit(owner, 'action=packet.viewed'); // global count: targetId (claim vs packet) is not pinned by the contract
    const b = await n();
    for (let i = 0; i < 3; i++) expect((await m.get(`/claims/${id}/packet`)).status).toBe(200);
    const a = await n();
    expect(a.length - b.length).toBe(3);
    expect(Object.values(a[0].metadata)).toContain(1); // revision number present in metadata
  });
});

describe('T-PKT-07 hostile data round trip', () => {
  it('attacker strings come back verbatim as JSON strings with safe content type', async () => {
    for (const num of ['CLM-HOSTILE-1', 'CLM-HOSTILE-2']) {
      const r = await packet(num);
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      validatePacket(r.body);
      const strs = allStrings(r.body);
      const joined = strs.join('\n');
      expect(joined).toContain('<script');
      expect(joined).toMatch(/<img[^>]*onerror/i);
      expect(joined).toContain('javascript:');
      expect(joined).toMatch(/[\u202A-\u202E\u2066-\u2069]/);
      expect(strs.some((s) => s.length >= 5000), 'a 5000+ char string survives untruncated').toBe(true);
      expect(typeof r.body.demandLetter).toBe('string');
    }
  });
});