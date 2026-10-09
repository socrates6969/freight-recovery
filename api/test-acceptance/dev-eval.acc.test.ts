/* eslint-disable */
// T9 (T-EVAL-01..07): the evaluation tool (`npm run eval`), recorded runs and the repository eval set.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApps, expectError, type RoleName, type Session } from './helpers/client.js';
import { appDb, inRollback, buildInsert, tryQuery, withAdmin, withTriggersOff } from './helpers/db.js';
import { childEnv } from './helpers/env.js';
import * as H from './helpers/imp.js';
import * as I from './helpers/intel.js';
import { REPO } from './helpers/sh.js';

let SS: Record<RoleName, Session>;
let TMP = '';
const MINI = () => join(TMP, 'mini');
const INVOICE = readFileSync(resolve(REPO, 'tests', 'fixtures', 'ld5001', 'invoice.txt'));

const INV_FIELDS: Array<{ key: string; groupIndex: number | null; value: string | null }> = [
  { key: 'invoice.invoice_number', groupIndex: null, value: 'INV-1001' },
  { key: 'invoice.load_number', groupIndex: null, value: 'LD-5001' },
  { key: 'invoice.carrier', groupIndex: null, value: 'Acme Freight LLC' },
  { key: 'invoice.shipper', groupIndex: null, value: 'Widget Co' },
  { key: 'invoice.invoice_date', groupIndex: null, value: '2025-03-10' },
  { key: 'invoice.total', groupIndex: null, value: '2118.00' },
  ...[['Linehaul', '1500.00'], ['Fuel Surcharge', '168.00'], ['Detention', '300.00'], ['Lumper', '150.00']].flatMap(([d, a], i) => [
    { key: 'invoice.charge.description', groupIndex: i, value: d! },
    { key: 'invoice.charge.amount', groupIndex: i, value: a! },
  ]),
];
const parsed = (docType: string, fields = INV_FIELDS) => ({ outcome: 'parsed', docType, fields });
const rejected = (reason: string) => ({ outcome: 'rejected', reason });
interface Case { id: string; category: string; file: string; filename: string; expectedBasis: string; expect: any }
const mk = (id: string, file: string, filename: string, expectation: any): Case => ({ id, category: 'acceptance', file, filename, expectedBasis: 'hand_authored', expect: expectation });
const CASES: Case[] = [
  mk('m01', 'cases/invoice.txt', 'invoice.txt', parsed('INVOICE')),
  mk('m02', 'cases/invoice.txt', 'invoice.txt', parsed('INVOICE', INV_FIELDS.map((f) => (f.key === 'invoice.total' ? { ...f, value: '2118.01' } : f)))),
  mk('m03', 'cases/invoice.txt', 'invoice.txt', parsed('INVOICE', INV_FIELDS.filter((f) => f.key !== 'invoice.shipper'))),
  mk('m04', 'cases/invoice.txt', 'invoice.txt', parsed('INVOICE', [...INV_FIELDS, { key: 'bol.facility', groupIndex: null, value: 'Dock 4' }])),
  mk('m05', 'cases/invoice.txt', 'invoice.txt', parsed('RATE_CONFIRMATION')),
  mk('m06', 'cases/empty.txt', 'empty.txt', rejected('empty_file')),
  mk('m07', 'cases/page.txt', 'page.txt', rejected('markup_content')),
  mk('m08', 'cases/bin.txt', 'bin.txt', rejected('binary_content')),
  mk('m09', 'cases/x.exe', 'x.exe', rejected('unsupported_type')),
  mk('m10', 'cases/invoice.txt', 'invoice.txt', rejected('markup_content')),
  mk('m11', 'cases/empty.txt', 'empty.txt', parsed('INVOICE')),
  mk('m12', 'cases/empty.txt', 'empty.txt', rejected('binary_content')),
];
const FAIL: Record<string, string | null> = { m01: null, m02: 'field_mismatch', m03: 'unexpected_field', m04: 'missing_field', m05: 'wrong_doc_type', m06: null, m07: null, m08: null, m09: null, m10: 'not_rejected', m11: 'unexpected_reject', m12: 'wrong_reject_reason' };
const FILES: Record<string, Buffer> = {
  'cases/invoice.txt': INVOICE, 'cases/empty.txt': Buffer.alloc(0), 'cases/page.txt': Buffer.from('<html><body>x</body></html>'),
  'cases/bin.txt': Buffer.from([0x00, 0x01, 0x02, 0x41]), 'cases/x.exe': Buffer.from('hello'),
};
function writeSet(dir: string, manifest: any | string, files: Record<string, Buffer> = FILES) {
  mkdirSync(join(dir, 'cases'), { recursive: true });
  for (const [f, b] of Object.entries(files)) writeFileSync(join(dir, f), b);
  writeFileSync(join(dir, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2));
}
const manifestOf = (cases: Case[] = CASES, over: any = {}) => ({ evalSetId: 'mini', version: '1', stage: 'extraction', description: 'acceptance mini set', cases, ...over });
const lastJson = (stdout: string) => {
  const i = stdout.search(/^\{/m);
  if (i < 0) throw new Error(`no JSON object in output:\n${stdout.slice(0, 500)}`);
  return JSON.parse(stdout.slice(i));
};
function runEval(args: string[], extraEnv: Record<string, string> = {}) {
  const r = spawnSync('npm', ['run', '--silent', 'eval', '--', ...args], { cwd: REPO, env: childEnv(extraEnv), shell: true, encoding: 'utf8', timeout: 240000, maxBuffer: 1 << 26 });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const near = (a: number, b: number, label: string) => expect(Math.abs(a - b) <= 1e-6, `${label}: ${a} vs ${b}`).toBe(true);
const counts = () => withAdmin(async (c) => ({
  runs: Number((await c.query(`select count(*)::int n from eval_runs`)).rows[0].n),
  results: Number((await c.query(`select count(*)::int n from eval_case_results`)).rows[0].n),
  chain: Number((await c.query(`select count(*)::int n from audit_events where tenant_id is null`)).rows[0].n),
}));
async function purgeMini() {
  await withTriggersOff(['eval_case_results', 'eval_runs'], async (c) => {
    await c.query(`delete from eval_case_results where run_id in (select id from eval_runs where eval_set_id in ('mini','extraction-v1'))`);
    await c.query(`delete from eval_runs where eval_set_id in ('mini','extraction-v1')`);
  });
}

beforeAll(async () => {
  SS = await I.seededOn(await I.sharedApp());
  TMP = mkdtempSync(join(tmpdir(), 'fr-acc-eval-'));
  writeSet(MINI(), manifestOf());
  if (process.env.ACC_SKIP_BUILD !== '1') {
    const b = spawnSync('npm run build -w packages/shared && npm run build -w api', { cwd: REPO, shell: true, encoding: 'utf8', timeout: 480000, maxBuffer: 1 << 26 });
    if (b.status !== 0) throw new Error(`build failed (the eval tool runs from build output)\n${b.stdout}\n${b.stderr}`);
  }
  await purgeMini();
}, 600000);
afterAll(async () => {
  try {
    await purgeMini();
    I.assertHonest('dev-eval');
  } finally {
    try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
    await closeApps();
  }
});

let baseline: Awaited<ReturnType<typeof counts>>;
let toolJson: any;
describe('T-EVAL-01 statistics via the tool', () => {
  it('prints the hand-computed statistics, per-case results and a stable set hash', async () => {
    baseline = await counts();
    const r = runEval(['--set', MINI(), '--k', '3', '--json']);
    expect(r.status, r.out).toBe(0);
    const j = lastJson(r.stdout);
    toolJson = j;
    expect(j.cases).toBe(12); expect(j.k).toBe(3); expect(j.runsTotal).toBe(36); expect(j.runsPassed).toBe(15);
    near(j.perRunPassRate, 0.416667, 'perRunPassRate');
    expect(j.passHatKCount).toBe(5); near(j.passHatK, 0.416667, 'passHatK');
    expect(j.passAtLeastOneCount).toBe(5); expect(j.flakyCaseCount).toBe(0); expect(j.alwaysFailCount).toBe(7);
    expect(j.deterministicCases).toBe(12);
    expect(j.passPowCurve.length).toBe(3);
    for (const v of j.passPowCurve) near(v, 0.416667, 'passPowCurve');
    near(j.wilson95.low, 0.19326, 'wilson low'); near(j.wilson95.high, 0.680489, 'wilson high');
    expect(j.stage).toBe('extraction'); expect(j.basis).toBe('synthetic_fixtures');
    expect(j.results.map((x: any) => x.caseId)).toEqual(CASES.map((c) => c.id));
    for (const x of j.results) {
      const ok = ['m01', 'm06', 'm07', 'm08', 'm09'].includes(x.caseId);
      expect(x.runsPassed, x.caseId).toBe(ok ? 3 : 0);
      expect(x.k).toBe(3);
      expect(x.passedAll).toBe(ok);
      expect(x.distinctOutputs).toBe(1);
      expect(x.firstFailureCode, x.caseId).toBe(FAIL[x.caseId]);
      expect(x.medianDurationMs).toBeGreaterThanOrEqual(0);
    }
    const again = lastJson(runEval(['--set', MINI(), '--k', '3', '--json']).stdout);
    for (const k of ['cases', 'k', 'runsTotal', 'runsPassed', 'perRunPassRate', 'passHatKCount', 'passHatK', 'passAtLeastOneCount', 'flakyCaseCount', 'alwaysFailCount', 'passPowCurve', 'wilson95', 'evalSetSha256']) expect(again[k], k).toEqual(j[k]);
  }, 300000);
  it('cross-check of the hand-authored invoice expectation against the Python oracle', async (ctx) => {
    const py = H.pythonOrSkip();
    if (!py) return ctx.skip();
    const ex = H.projectPy(H.pyOracle(py, [{ name: 'invoice.txt', data: INVOICE }])[0]!).extraction;
    expect(ex.invoice_number).toBe('INV-1001');
    expect(ex.load_number).toBe('LD-5001');
    expect(ex.carrier).toBe('Acme Freight LLC');
    expect(ex.shipper).toBe('Widget Co');
    expect(String(ex.invoice_date)).toBe('2025-03-10');
    expect(Number(ex.total)).toBe(2118);
    expect(ex.lines.map((l: any) => [l.description, Number(l.amount)])).toEqual([['Linehaul', 1500], ['Fuel Surcharge', 168], ['Detention', 300], ['Lumper', 150]]);
  });
});

describe('T-EVAL-02 set hash', () => {
  it('equals the independent SHA-256 over manifest bytes then each case file in manifest order; any byte change alters it', () => {
    const h = createHash('sha256');
    h.update(readFileSync(join(MINI(), 'manifest.json')));
    for (const c of CASES) h.update(readFileSync(join(MINI(), c.file)));
    expect(toolJson.evalSetSha256).toBe(h.digest('hex'));
    expect(toolJson.evalSetSha256).toMatch(/^[0-9a-f]{64}$/);
    const alt = join(TMP, 'alt1');
    cpSync(MINI(), alt, { recursive: true });
    const b = readFileSync(join(alt, 'cases/page.txt'));
    b[b.length - 1] = b[b.length - 1]! ^ 1;
    writeFileSync(join(alt, 'cases/page.txt'), b);
    const j1 = lastJson(runEval(['--set', alt, '--k', '1', '--json']).stdout);
    expect(j1.evalSetSha256).not.toBe(toolJson.evalSetSha256);
    const alt2 = join(TMP, 'alt2');
    cpSync(MINI(), alt2, { recursive: true });
    writeFileSync(join(alt2, 'manifest.json'), readFileSync(join(alt2, 'manifest.json'), 'utf8') + '\n');
    const j2 = lastJson(runEval(['--set', alt2, '--k', '1', '--json']).stdout);
    expect(j2.evalSetSha256).not.toBe(toolJson.evalSetSha256);
    expect(j2.evalSetSha256).not.toBe(j1.evalSetSha256);
  }, 300000);
});
describe('T-EVAL-03 exit codes', () => {
  it('--min-pass-hat-k: 0.5 -> exit 1 with the JSON still printed; 0.4 -> exit 0', () => {
    const r1 = runEval(['--set', MINI(), '--k', '3', '--min-pass-hat-k', '0.5', '--json']);
    expect(r1.status, r1.out).toBe(1);
    expect(lastJson(r1.stdout).passHatKCount).toBe(5);
    const r2 = runEval(['--set', MINI(), '--k', '3', '--min-pass-hat-k', '0.4', '--json']);
    expect(r2.status, r2.out).toBe(0);
  }, 300000);

  it('usage and manifest errors exit 2 and record nothing', async () => {
    const before = await counts();
    const sets: Array<[string, string[]]> = [];
    const variant = (name: string, manifest: any | string, files?: Record<string, Buffer>) => {
      const d = join(TMP, `bad-${name}`);
      writeSet(d, manifest, files);
      sets.push([name, ['--set', d, '--k', '2', '--record', '--json']]);
      return d;
    };
    variant('malformed', '{ this is not json');
    variant('stage', manifestOf(CASES, { stage: 'rules' }));
    variant('dup', manifestOf([CASES[0]!, { ...CASES[1]!, id: 'm01' }]));
    writeFileSync(join(TMP, 'outside.txt'), 'outside the set');
    variant('traversal', manifestOf([{ ...CASES[0]!, file: '../outside.txt' }]));
    variant('absolute', manifestOf([{ ...CASES[0]!, file: join(TMP, 'outside.txt') }]));
    variant('missing-file', manifestOf([{ ...CASES[0]!, file: 'cases/does-not-exist.txt' }]));
    variant('outcome', manifestOf([{ ...CASES[0]!, expect: { outcome: 'maybe' } }]));
    variant('reason', manifestOf([{ ...CASES[5]!, expect: { outcome: 'rejected', reason: 'made_up_reason' } }]));
    const sd = variant('symlink', manifestOf([{ ...CASES[0]!, file: 'cases/link.txt' }]));
    let symlinkOk = true;
    try { symlinkSync(join(TMP, 'outside.txt'), join(sd, 'cases', 'link.txt')); } catch { symlinkOk = false; }
    const ok = join(TMP, 'ok-set');
    writeSet(ok, manifestOf());
    const argv: Array<[string, string[]]> = [
      ...sets.filter(([n]) => symlinkOk || n !== 'symlink'),
      ['missing --set', ['--k', '3', '--record']],
      ['nonexistent dir', ['--set', join(TMP, 'no-such-dir'), '--record']],
      ['--k 0', ['--set', ok, '--k', '0', '--record']],
      ['--k 21', ['--set', ok, '--k', '21', '--record']],
      ['--min-pass-hat-k 1.5', ['--set', ok, '--min-pass-hat-k', '1.5', '--record']],
      ['unknown option', ['--set', ok, '--frobnicate', '--record']],
    ];
    for (const [label, args] of argv) {
      const r = runEval(args);
      expect(r.status, `${label}: ${r.out.slice(0, 400)}`).toBe(2);
    }
    expect(await counts()).toEqual(before);
    if (!symlinkOk) console.warn('[ACCEPTANCE SKIP] symlink escape case: symlinks unavailable on this platform');
  }, 600000);
});

describe('T-EVAL-04 no side effects without --record', () => {
  it('rows and audit chain are unchanged by the runs above', async () => {
    expect(await counts()).toEqual(baseline);
  });
});

describe('T-EVAL-05 recording', () => {
  it('--record stores one run and twelve results and appends exactly one platform event; the dashboard reads it back', async () => {
    const before = await counts();
    const seq = await I.lastSeq(null);
    const r = runEval(['--set', MINI(), '--k', '3', '--record', '--json']);
    expect(r.status, r.out).toBe(0);
    const j = lastJson(r.stdout);
    const rows = await withAdmin(async (c) => (await c.query(`select * from eval_runs where eval_set_id='mini'`)).rows);
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.eval_set_id).toBe('mini'); expect(row.k).toBe(3); expect(row.case_count).toBe(12); expect(row.runs_total).toBe(36); expect(row.runs_passed).toBe(15);
    expect(row.pass_hat_k_count).toBe(5); expect(row.pass_at_least_one_count).toBe(5); expect(row.flaky_case_count).toBe(0); expect(row.always_fail_count).toBe(7);
    expect(row.eval_set_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.eval_set_sha256).toBe(j.evalSetSha256);
    const res = await withAdmin(async (c) => (await c.query(`select case_id, first_failure_code, runs_passed, passed_all from eval_case_results where run_id=$1 order by case_id`, [row.id])).rows);
    expect(res.length).toBe(12);
    for (const x of res) expect(x.first_failure_code, x.case_id).toBe(FAIL[x.case_id]);
    expect((await counts()).runs).toBe(before.runs + 1);
    const ev = (await I.eventsSince(null, seq)).filter((e) => e.action === 'eval.run_recorded');
    expect(ev.length).toBe(1);
    expect(ev[0]!.actor_id).toBeNull();
    expect(I.keysOf(ev[0]!.metadata)).toEqual(['cases', 'evalSetId', 'k', 'passHatKCount', 'runId']);
    expect(ev[0]!.metadata).toEqual({ runId: row.id, evalSetId: 'mini', k: 3, cases: 12, passHatKCount: 5 });
    expect((await SS.SUPER_ADMIN.get('/platform/audit/verify')).body.valid).toBe(true);

    const dev = SS.PLATFORM_DEV;
    const s1 = await I.lastSeq(null);
    const list = await dev.get('/platform/eval/runs');
    expect(list.status, list.text).toBe(200);
    const top = list.body.items[0];
    expect(top.id).toBe(row.id);
    expect(top.basis).toBe('synthetic_fixtures');
    expect(top.evalSetId).toBe('mini'); expect(top.k).toBe(3); expect(top.cases).toBe(12); expect(top.runsTotal).toBe(36); expect(top.runsPassed).toBe(15);
    expect(top.passHatKCount).toBe(5); expect(top.passAtLeastOneCount).toBe(5); expect(top.flakyCaseCount).toBe(0); expect(top.alwaysFailCount).toBe(7);
    expect(top.deterministicCases).toBe(12);
    near(top.wilson95.low, 0.19326, 'wilson low'); near(top.wilson95.high, 0.680489, 'wilson high');
    expect(top.passPowCurve.length).toBe(3);
    expect(top.durationMs.p50).toBeGreaterThanOrEqual(0);
    expect(top.durationMs.p95).toBeGreaterThanOrEqual(0);
    expect(top.evalSetSha256).toBe(row.eval_set_sha256);
    const det = await dev.get(`/platform/eval/runs/${row.id}`);
    expect(det.status, det.text).toBe(200);
    expect(det.body.results.map((x: any) => x.caseId)).toEqual(j.results.map((x: any) => x.caseId));
    for (const x of det.body.results) {
      const t = j.results.find((y: any) => y.caseId === x.caseId);
      for (const k of ['category', 'runsPassed', 'k', 'passedAll', 'distinctOutputs', 'firstFailureCode']) expect(x[k], `${x.caseId}.${k}`).toEqual(t[k]);
    }
    for (const n of ['Acme Freight', 'INV-1001', 'invoice.txt']) { expect(list.text.includes(n), n).toBe(false); expect(det.text.includes(n), n).toBe(false); }
    expectError(await dev.get(`/platform/eval/runs/${I.RAND_UUID}`), 404, 'not_found');
    expectError(await dev.get('/platform/eval/runs/not-a-uuid'), 404, 'not_found');
    for (const role of ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER'] as RoleName[]) {
      expectError(await SS[role].get('/platform/eval/runs'), 403, 'forbidden');
      expectError(await SS[role].get(`/platform/eval/runs/${row.id}`), 403, 'forbidden');
    }
    const viewed = (await I.eventsSince(null, s1)).filter((e) => e.action === 'platform.dashboard_viewed');
    expect(viewed.length).toBe(2);
    for (const e of viewed) expect(e.metadata).toEqual({ section: 'eval' });
  }, 300000);
});

describe('T-EVAL-06 immutability and isolation', () => {
  it('recorded rows cannot be changed; the runtime role sees nothing without system mode', async () => {
    await withAdmin(async (c) => {
      for (const sql of [`update eval_runs set k = k`, `update eval_runs set runs_passed = 0`, `delete from eval_runs`, `truncate eval_runs`, `update eval_case_results set passed_all = not passed_all`, `delete from eval_case_results`, `truncate eval_case_results`]) {
        expect((await tryQuery(c, sql)).ok, sql).toBe(false);
      }
    });
    const a = await appDb();
    try {
      expect((await a.query(`select count(*)::int n from eval_runs`)).rows[0].n).toBe(0);
      expect((await a.query(`select count(*)::int n from eval_case_results`)).rows[0].n).toBe(0);
      const ov = {
        id: 'gen_random_uuid()', eval_set_id: `'t'`, eval_set_version: `'1'`, eval_set_sha256: `'${'ab'.repeat(32)}'`, stage: `'extraction'`, k: '1', case_count: '1', runs_total: '1', runs_passed: '1',
        pass_hat_k_count: '1', pass_at_least_one_count: '1', flaky_case_count: '0', always_fail_count: '0', pass_pow_curve: `'{1}'`,
      };
      const good = await withAdmin((c) => buildInsert(c, 'eval_runs', ov));
      expect((await tryQuery(a, good)).ok, 'insert without context must fail').toBe(false);
      const sys = async (sql: string) => inRollback(a, async () => {
        await a.query(`select set_config('app.system','on',true)`);
        return tryQuery(a, sql);
      });
      const okIns = await sys(good);
      expect(okIns.ok, `consistent insert in system mode must succeed: ${okIns.error}`).toBe(true);
      const bads: Array<[string, Record<string, string>]> = [
        ['runs_passed > runs_total', { runs_passed: '2' }],
        ['k = 0', { k: '0', pass_pow_curve: `'{}'` }],
        ['curve length <> k', { pass_pow_curve: `'{1,1}'` }],
      ];
      for (const [label, patch] of bads) {
        const sql = await withAdmin((c) => buildInsert(c, 'eval_runs', { ...ov, ...patch }));
        expect((await sys(sql)).ok, `${label} must be rejected`).toBe(false);
      }
    } finally {
      await a.end();
    }
  }, 120000);
});
describe('T-EVAL-07 repository eval set api/eval/sets/extraction-v1', () => {
  const DIR = resolve(REPO, 'api', 'eval', 'sets', 'extraction-v1');
  const manifest = () => JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
  it('(a) the regression bar: pass^k = 1 with at least 30 deterministic cases', () => {
    expect(existsSync(join(DIR, 'manifest.json')), 'the set must exist').toBe(true);
    const r = runEval(['--set', 'api/eval/sets/extraction-v1', '--k', '3', '--min-pass-hat-k', '1', '--json']);
    expect(r.status, r.out.slice(0, 1500)).toBe(0);
    const j = lastJson(r.stdout);
    expect(j.passHatK).toBe(1);
    expect(j.cases).toBeGreaterThanOrEqual(30);
    expect(j.deterministicCases).toBe(j.cases);
  }, 480000);
  it('(b) manifest invariants and README', () => {
    const m = manifest();
    const ids = m.cases.map((c: any) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of m.cases) {
      const p = join(DIR, c.file);
      expect(existsSync(p), `${c.id}: ${c.file}`).toBe(true);
      expect(readFileSync(p).length, `${c.id} size`).toBeLessThan(20 * 1024);
      expect(['python_oracle', 'hand_authored']).toContain(c.expectedBasis);
    }
    expect(m.cases.filter((c: any) => c.expect.outcome === 'rejected').length).toBeGreaterThanOrEqual(8);
    expect(m.cases.filter((c: any) => c.expectedBasis === 'python_oracle').length).toBeGreaterThanOrEqual(8);
    const readme = readFileSync(join(DIR, 'README.md'), 'utf8');
    expect(readme).toMatch(/synthetic/i);
    expect(readme).toMatch(/not an accuracy/i);
    expect(readme, '(d) the README states that the 100% bar applies to the regression set only').toMatch(/regression/i);
    expect(readme).toMatch(/100\s*%|min-pass-hat-k 1|pass\^k (of|=) 1/); // README words the 100% bar as the --min-pass-hat-k 1 gate
  });
  it('(c) python_oracle expectations equal what the Python reference extracts', (ctx) => {
    const py = H.pythonOrSkip();
    if (!py) return ctx.skip();
    const m = manifest();
    const oracle = m.cases.filter((c: any) => c.expectedBasis === 'python_oracle' && c.expect.outcome === 'parsed');
    expect(oracle.length, 'at least one parsed python_oracle case').toBeGreaterThan(0);
    const proj = H.pyOracle(py, oracle.map((c: any) => ({ name: c.filename, data: readFileSync(join(DIR, c.file)) }))).map(H.projectPy);
    const same = (a: string | null, b: unknown) => {
      if (b === null || b === undefined) return a === null;
      const s = String(b);
      if (a === s) return true;
      if (a !== null && /^-?\d+(\.\d+)?$/.test(a) && /^-?\d+(\.\d+)?$/.test(s)) return Number(a) === Number(s);
      return false;
    };
    oracle.forEach((c: any, idx: number) => {
      const e = proj[idx]!.extraction;
      expect(e, `${c.id}: the Python reference extracted nothing`).toBeTruthy();
      for (const f of c.expect.fields) {
        const [family, ...rest] = String(f.key).split('.');
        let got: unknown;
        if (f.key === 'invoice.charge.description') got = e.lines?.[f.groupIndex]?.description;
        else if (f.key === 'invoice.charge.amount') got = e.lines?.[f.groupIndex]?.amount;
        else got = e[rest.join('.')];
        const ok = Array.isArray(got) ? JSON.stringify(got) === JSON.stringify(JSON.parse(f.value)) : same(f.value, got);
        expect(ok, `${c.id} ${f.key}[${f.groupIndex}]: manifest ${JSON.stringify(f.value)} vs Python ${JSON.stringify(got)}`).toBe(true);
      }
    });
  });
});