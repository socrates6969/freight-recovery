/* eslint-disable */
// REQ-20261010-step5-analysis database guarantees AN-D01..AN-D08 (test-spec T10; Part C P8). SQL runs as the runtime
// role freight_app with the tenant set; every statement runs inside a transaction that is rolled back.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Session, buildTestApp, claimId, closeApps, sessionFor } from './helpers/client.js';
import * as A from './helpers/analysis.js';
import { type PgClient, appDb } from './helpers/db.js';
import * as H from './helpers/imp.js';
import { reseed } from './helpers/seed.js';

const ROOT = resolve(__dirname, '..', '..');
const MIG = resolve(ROOT, 'api', 'prisma', 'migrations');
// sha256 of each earlier migration.sql as committed at d678827 (feat/four-eyes; `git show d678827:<path>`).
const FROZEN: Record<string, string> = {
  '20261008000000_init': 'bea2ee6796b489535845722913651534400ebac10e36aa6517b57306a378126c',
  '20261009000000_import_export': '8699637753c358bddef3863c9b281e4114c30dfa6bd77d9f7ef977b8c730b36c',
  '20261010000000_intelligence': '4f9717fc5428503c5e005c08cc7808b54514bdf5a077c9c8b98d2e301378d916',
  '20261011000000_four_eyes': '2ad97a26f2b93813773ee990bfb58748d4cd9e6ede1c4631eb0977feb5790d1d',
};
// sha256 of schema.prisma at d678827 with comments removed, lines trimmed, internal whitespace runs collapsed and blank
// lines dropped (models/enums/datasource). REQ-20261011-charge-intelligence pin update: whitespace collapsing added.
const SCHEMA_NORMALIZED_D678827_WS = '24697067fb307aba98ffdf6153af73e6cd7643c28b83e4237dd14cd39c795a1f';

let app: FastifyInstance;
let an: Session, rv: Session, m: Session, gx: Session;
let acme = '', globex = '';
let awaiting: A.Made;
let pendingSeeded = '', approvedTarget = '';
let c: PgClient;

const upd = (sql: string, id: string) => ({ sql, params: [id] });
function expectRefused(o: A.Outcome[], msg: 'claim_transition_invalid' | 'analysis_packet_invalid', label: string) {
  const last = o[o.length - 1]!;
  expect(last.ok, `${label} must fail`).toBe(false);
  expect(last.code, `${label}: ${last.message}`).toBe('P0001');
  expect(last.message, label).toBe(msg);
}
function expectOk(o: A.Outcome[], label: string, rows = 1) {
  for (const [i, x] of o.entries()) {
    expect(x.ok, `${label} step ${i}: ${x.message}`).toBe(true);
    expect(x.rowCount, `${label} step ${i} rowCount`).toBe(rows);
  }
}

beforeAll(async () => {
  await H.assertS3Reachable();
  reseed();
  app = await buildTestApp();
  an = await sessionFor(app, ACCOUNTS.ANALYST);
  rv = await sessionFor(app, ACCOUNTS.REVIEWER);
  m = await sessionFor(app, ACCOUNTS.MANAGER);
  gx = await sessionFor(app, 'owner@globex.test');
  acme = m.user.tenant.id;
  globex = gx.user.tenant.id;
  awaiting = await A.smallClaim(an, rv, 'D');
  pendingSeeded = await claimId(m, 'CLM-0004');
  approvedTarget = await claimId(m, 'CLM-0005');
  expect((await m.get(`/claims/${pendingSeeded}`)).body.status).toBe('PENDING_REVIEW');
  c = await appDb();
  expect((await c.query('select current_user u')).rows[0].u).toBe('freight_app');
}, 180000);
afterAll(async () => { try { await c?.end(); } finally { await closeApps(); reseed(); } });

describe('AN-D01..D07 triggers', () => {
  it('AN-D01: AWAITING -> PENDING_REVIEW without a packet -> P0001 claim_transition_invalid', async () => {
    expectRefused(await A.txSteps(c, acme, [upd(`UPDATE claims SET status='PENDING_REVIEW' WHERE id=$1`, awaiting.claimId)]), 'claim_transition_invalid', 'AN-D01');
  });
  it('AN-D02: packet revision 1 without an author for an AWAITING claim -> analysis_packet_invalid', async () => {
    expectRefused(await A.txSteps(c, acme, [A.packetInsert({ tenant: acme, claim: awaiting.claimId, revision: 1, createdBy: null })]), 'analysis_packet_invalid', 'AN-D02');
  });
  it('AN-D03: revision 2 with author, or revision 1 APPROVED with author -> analysis_packet_invalid', async () => {
    expectRefused(await A.txSteps(c, acme, [A.packetInsert({ tenant: acme, claim: awaiting.claimId, revision: 2, createdBy: an.user.id })]), 'analysis_packet_invalid', 'AN-D03 rev 2');
    for (const st of ['APPROVED', 'REJECTED', 'SEND_READY', 'SUPERSEDED'])
      expectRefused(await A.txSteps(c, acme, [A.packetInsert({ tenant: acme, claim: awaiting.claimId, revision: 1, status: st, createdBy: an.user.id })]), 'analysis_packet_invalid', `AN-D03 rev 1 ${st}`);
  });
  it('AN-D04: revision 1 with author, then status PENDING_REVIEW -> both succeed (rolled back)', async () => {
    expectOk(await A.txSteps(c, acme, [A.packetInsert({ tenant: acme, claim: awaiting.claimId, revision: 1, createdBy: an.user.id }), upd(`UPDATE claims SET status='PENDING_REVIEW' WHERE id=$1`, awaiting.claimId)]), 'AN-D04');
    expect(await A.packetRows(awaiting.claimId), 'rolled back').toEqual([]);
    expect((await A.dbClaim(awaiting.claimId)).status).toBe('AWAITING_ANALYSIS');
  });
  it('AN-D05: revision 1 with author, then status APPROVED (or REJECTED / SEND_READY) -> claim_transition_invalid', async () => {
    for (const st of ['APPROVED', 'REJECTED', 'SEND_READY'])
      expectRefused(await A.txSteps(c, acme, [A.packetInsert({ tenant: acme, claim: awaiting.claimId, revision: 1, createdBy: an.user.id }), upd(`UPDATE claims SET status='${st}' WHERE id=$1`, awaiting.claimId)]), 'claim_transition_invalid', `AN-D05 ${st}`);
  });
  it('AN-D06: PENDING_REVIEW -> AWAITING_ANALYSIS on a seeded claim -> claim_transition_invalid', async () => {
    expectRefused(await A.txSteps(c, acme, [upd(`UPDATE claims SET status='AWAITING_ANALYSIS' WHERE id=$1`, pendingSeeded)]), 'claim_transition_invalid', 'AN-D06');
  });
  it('AN-D07: updates without a status change, and PENDING_REVIEW -> APPROVED, are unaffected', async () => {
    expectOk(await A.txSteps(c, acme, [upd(`UPDATE claims SET carrier_name=carrier_name, version=version+1 WHERE id=$1`, awaiting.claimId)]), 'AN-D07 no status change');
    expectOk(await A.txSteps(c, acme, [upd(`UPDATE claims SET status=status WHERE id=$1`, awaiting.claimId)]), 'AN-D07 status unchanged (AWAITING)');
    expectOk(await A.txSteps(c, acme, [upd(`UPDATE claims SET status='APPROVED' WHERE id=$1`, approvedTarget)]), 'AN-D07 PENDING_REVIEW -> APPROVED');
    expect((await A.dbClaim(approvedTarget)).status).toBe('PENDING_REVIEW');
  });
  it('P8: guards do not depend on the session tenant (other tenant context / no context never succeed)', async () => {
    const ins = A.packetInsert({ tenant: acme, claim: awaiting.claimId, revision: 1, createdBy: null });
    for (const t of [globex, null]) {
      const o = await A.txSteps(c, t, [ins]);
      expect(o[o.length - 1]!.ok, `tenant ${t}`).toBe(false);
    }
    const u = await A.txSteps(c, globex, [upd(`UPDATE claims SET status='PENDING_REVIEW' WHERE id=$1`, awaiting.claimId)]);
    expect(u[0]!.ok && u[0]!.rowCount === 1, 'cross-tenant update must not change the row').toBe(false);
    expect((await A.dbClaim(awaiting.claimId)).status).toBe('AWAITING_ANALYSIS');
  });
  it('a guard refusal is never visible to an API client as 500 (analysis via the API still works afterwards)', async () => {
    const r = await A.analyze(m, awaiting.claimId);
    expect(r.status, r.text).toBe(201);
    expect(await A.packetRows(awaiting.claimId)).toEqual([{ revision: 1, created_by_id: m.user.id, status: 'PENDING_REVIEW' }]);
  });
});

describe('AN-D08 migrations', () => {
  it('new folder 20261012000000_analysis; earlier migration.sql files byte-identical to d678827', () => {
    const f = resolve(MIG, '20261012000000_analysis', 'migration.sql');
    expect(existsSync(f), f).toBe(true);
    for (const [dir, sha] of Object.entries(FROZEN)) {
      const got = createHash('sha256').update(readFileSync(resolve(MIG, dir, 'migration.sql'))).digest('hex');
      expect(got, dir).toBe(sha);
    }
  });
  it('the analysis migration adds no table, column, enum or grant change', () => {
    const sql = readFileSync(resolve(MIG, '20261012000000_analysis', 'migration.sql'), 'utf8').replace(/--.*$/gm, '');
    for (const re of [/CREATE\s+TABLE/i, /ADD\s+COLUMN/i, /DROP\s+COLUMN/i, /ALTER\s+COLUMN/i, /DROP\s+TABLE/i, /CREATE\s+TYPE/i, /ALTER\s+TYPE/i, /\bGRANT\b/i])
      expect(re.test(sql), `migration must not contain ${re}`).toBe(false);
    // P8 "no grant changes" concerns existing objects/roles. The only REVOKE allowed is the hardening of a trigger
    // function created by this same migration (REVOKE ALL ON FUNCTION <new fn>() FROM PUBLIC), which grants nothing.
    const created = new Set([...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"?(\w+)"?\s*\(/gi)].map((m) => m[1]!.toLowerCase()));
    for (const stmt of sql.split(';').map((x) => x.trim().replace(/\s+/g, ' ')).filter((x) => /^REVOKE\b/i.test(x))) {
      const m = /^REVOKE ALL ON FUNCTION "?(\w+)"?\s*\(\s*\) FROM PUBLIC$/i.exec(stmt);
      expect(!!m && created.has(m[1]!.toLowerCase()), `unexpected REVOKE: ${stmt}`).toBe(true);
    }
    expect(/CREATE\s+(OR\s+REPLACE\s+)?(CONSTRAINT\s+)?TRIGGER/i.test(sql), 'adds triggers').toBe(true);
  });
  it('schema.prisma has no model change besides the step-6 ChargeLabel model (normalized content equals d678827)', () => {
    // REQ-20261011-charge-intelligence (C10, additive pin update): step 6 adds `model ChargeLabel { ... }` and its
    // relation fields on Tenant/User. Only those are removed before hashing; everything else must equal d678827.
    const raw = readFileSync(resolve(ROOT, 'api', 'prisma', 'schema.prisma'), 'utf8');
    let s = raw.replace(/^model ChargeLabel \{[\s\S]*?^\}[ \t]*$/m, '').split(/\r?\n/).filter((l) => !/\bChargeLabel\b/.test(l)).join('\n');
    // REQ-20261011-fuel-outlook F14 (additive pin update): step 7 adds the models mapped to fsc_tables,
    // claim_fuel_inputs, price_imports and price_observations, plus their relation fields on other models. Exactly
    // those blocks and the lines naming those models are removed; everything else must still equal d678827.
    const step7 = new Set<string>();
    s = s.replace(/^model (\w+) \{[\s\S]*?^\}[ \t]*$/gm, (block, name: string) => {
      if (!/@@map\("(fsc_tables|claim_fuel_inputs|price_imports|price_observations)"\)/.test(block)) return block;
      step7.add(name);
      return '';
    });
    for (const t of ['fsc_tables', 'claim_fuel_inputs', 'price_imports', 'price_observations']) expect(raw.includes(`@@map("${t}")`), `schema maps ${t}`).toBe(true);
    for (const name of step7) s = s.split(/\r?\n/).filter((l) => !new RegExp(`\\b${name}\\b`).test(l)).join('\n');
    // `prisma format` re-aligns columns when a field is added, so internal whitespace runs are collapsed too. The
    // pinned value below was computed with this normalization from `git show d678827:api/prisma/schema.prisma`.
    const n = s.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '').trim().replace(/\s+/g, ' ')).filter(Boolean).join('\n');
    expect(createHash('sha256').update(n).digest('hex')).toBe(SCHEMA_NORMALIZED_D678827_WS);
  });
});
