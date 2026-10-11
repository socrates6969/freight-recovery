// REQ-20261011-fuel-outlook Tier L: T7 evaluation CLI by importing `api/src/eval/outlook.ts` `main` (CI-E01..E06;
// Part C F8) and the F8 CI workflow step. No build, no database, no network.
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Main = (argv: readonly string[], out: (s: string) => void, err: (s: string) => void) => number;
interface Result { series: string; h: number; candidate: string; method: string; reason: string; origins: number; firstOrigin: string; naiveMae: number; candidateMae: number; maeRatio: number | null; dm: number; coverage: number; coverageHits: number; coverageCases: number }
interface Report { evaluation: string; outlookVersion: string; note: string; data: Record<string, unknown>[]; results: Result[] }
interface Schema { parse(v: unknown): unknown }

const ROOT = resolve(__dirname, '..', '..');
const DATA = resolve(ROOT, 'api', 'data', 'public-prices');
const CI_ARGS = ['--min-coverage', '0.70', '--max-coverage', '0.90', '--require-model', 'diesel_us:1,diesel_us:4,ppi_tl:1'];
const NOTE = 'Walk-forward backtest on bundled public price history (U.S. EIA and BLS data via FRED). It is a regression check of the forecast and range rules, not a guarantee about future prices.';
const PINNED = [
  ['diesel_us', 1, 'ar2', 'ar2', 'model_beats_naive', 779, '2011-10-31', 0.041878, 0.035613, 0.850402, 5.6375, 526, 675],
  ['diesel_us', 4, 'combo', 'combo', 'model_beats_naive', 776, '2011-10-31', 0.127272, 0.122219, 0.960302, 2.7485, 530, 672],
  ['diesel_us', 8, 'naive', 'naive', 'naive_by_design', 772, '2011-10-31', 0.207645, 0.207645, 1, 0, 520, 668],
  ['diesel_us', 13, 'naive', 'naive', 'naive_by_design', 767, '2011-10-31', 0.277145, 0.277145, 1, 0, 510, 663],
  ['ppi_tl', 1, 'ar2', 'ar2', 'model_beats_naive', 205, '2009-07-01', 1.723146, 1.502823, 0.872139, 2.3327, 125, 169],
] as const;

let main: Main;
let OutlookEvalReport: Schema;
const tmp: string[] = [];
beforeAll(async () => {
  main = ((await import('../src/eval/outlook.js')) as unknown as { main: Main }).main;
  OutlookEvalReport = ((await import('@fr/shared')) as unknown as { OutlookEvalReport: Schema }).OutlookEvalReport;
});
afterAll(() => { for (const d of tmp) rmSync(d, { recursive: true, force: true }); });

function run(args: string[]) {
  let stdout = '';
  let stderr = '';
  const code = main(args, (s) => { stdout += s; }, (s) => { stderr += s; });
  return { code, stdout, stderr, lines: stdout.split(/\r?\n/).filter((l) => l !== '') };
}
function copyData(mutate: (dir: string) => void): string {
  const d = mkdtempSync(join(tmpdir(), 'fr-outlook-eval-'));
  tmp.push(d);
  cpSync(DATA, d, { recursive: true });
  mutate(d);
  return d;
}
const near = (a: number | null, e: number, abs: number, tag: string) => expect(Math.abs((a ?? NaN) - e), `${tag}: ${a} vs ${e}`).toBeLessThanOrEqual(abs);

describe('T7 eval:outlook CLI (F8)', () => {
  it('CI-E01 human mode: exit 0; line 1 starts with the title; line 2 is OUTLOOK_EVAL_NOTE', () => {
    const r = run([]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split(/\r?\n/)[0]).toMatch(/^Cost outlook backtest \(walk-forward\)/);
    expect(r.stdout.split(/\r?\n/)[1]).toBe(NOTE);
  });
  it('CI-E02 --json: one JSON line that parses with OutlookEvalReport; results match T5; data matches the manifest', () => {
    const r = run(['--json']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.lines).toHaveLength(1);
    const rep = JSON.parse(r.lines[0] ?? '') as Report;
    expect(OutlookEvalReport.parse(rep)).toEqual(rep);
    expect([rep.evaluation, rep.outlookVersion, rep.note]).toEqual(['walk-forward', 'outlook-v1', NOTE]);
    expect(rep.data).toEqual([
      { series: 'diesel_us', file: 'GASDESW.csv', sha256: 'aca8fefdbb54bdf16a2ab2c225d8b1f59c033e04d6fb96d8c232c3cc45417bdf', rows: 1699, firstDate: '1994-03-21', lastDate: '2026-10-05' },
      { series: 'ppi_tl', file: 'PCU4841214841212.csv', sha256: '83894390a4fd80d6033f9d18299e97b27e670427bbb5e6aa090cdca0d4a44bea', rows: 411, firstDate: '1992-06-01', lastDate: '2026-08-01' },
    ]);
    expect(rep.results.map((x) => [x.series, x.h])).toEqual(PINNED.map((p) => [p[0], p[1]]));
    PINNED.forEach((p, i) => {
      const x = rep.results[i];
      if (!x) throw new Error('missing result');
      const tag = `${p[0]} h${p[1]}`;
      expect([x.candidate, x.method, x.reason, x.origins, x.firstOrigin, x.coverageHits, x.coverageCases], tag).toEqual([p[2], p[3], p[4], p[5], p[6], p[11], p[12]]);
      near(x.naiveMae, p[7], 5e-6, `${tag} naiveMae`);
      near(x.candidateMae, p[8], 5e-6, `${tag} candidateMae`);
      near(x.maeRatio, p[9], 5e-6, `${tag} maeRatio`);
      near(x.dm, p[10], 5e-4, `${tag} dm`);
      expect(x.coverage, tag).toBe(p[11] / p[12]);
    });
  });
  it('CI-E03 the CI bounds give exit 0', () => {
    const r = run(CI_ARGS);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).not.toContain('bound not met');
  });
  it.each([
    ['--min-coverage 0.78', ['--min-coverage', '0.78'], '--min-coverage'],
    ['--max-coverage 0.78', ['--max-coverage', '0.78'], '--max-coverage'],
    ['--require-model diesel_us:8', ['--require-model', 'diesel_us:8'], '--require-model'],
  ])('CI-E04 %s -> exit 1 with "bound not met: <flag> (...)" on stderr', (_l, args, flag) => {
    const r = run(args);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(new RegExp(`bound not met: ${flag} \\(.+\\)`));
  });
  it('CI-E05 usage, manifest and sha errors give exit 2', () => {
    const cases: [string, string[]][] = [
      ['unknown flag', ['--bogus']], ['--min-coverage without a value', ['--min-coverage']], ['--min-coverage 1.5', ['--min-coverage', '1.5']],
      ['--require-model diesel_us', ['--require-model', 'diesel_us']], ['--require-model foo:1', ['--require-model', 'foo:1']], ['--require-model diesel_us:2', ['--require-model', 'diesel_us:2']],
    ];
    const sha = copyData((d) => { const p = join(d, 'GASDESW.csv'); const b = readFileSync(p); b[b.length - 2] = b[b.length - 2] === 0x39 ? 0x38 : 0x39; writeFileSync(p, b); });
    const extra = copyData((d) => { const p = join(d, 'manifest.json'); const m = JSON.parse(readFileSync(p, 'utf8')) as { files: Record<string, unknown>[] }; const f0 = m.files[0]; if (f0) f0.extra = 1; writeFileSync(p, JSON.stringify(m)); });
    cases.push(['sha mismatch', ['--data-dir', sha]], ['manifest with an extra key', ['--data-dir', extra]]);
    for (const [label, args] of cases) expect(run(args).code, label).toBe(2);
    // the unmodified copy is accepted (the refusals above are caused by the mutation only)
    expect(run(['--data-dir', copyData(() => undefined)]).code).toBe(0);
  });
  it('CI-E06 no network, no file writes, no environment input', () => {
    const before = readdirSync(DATA).map((f) => [f, statSync(join(DATA, f)).mtimeMs]);
    const d = copyData(() => undefined);
    const tmpBefore = readdirSync(d).sort();
    const origFetch = globalThis.fetch;
    const saved = { ...process.env };
    try {
      globalThis.fetch = (() => { throw new Error('network access is not allowed'); }) as typeof fetch;
      const base = run(['--json', '--data-dir', d]);
      expect(base.code, base.stderr).toBe(0);
      for (const k of Object.keys(process.env)) if (/DATABASE_URL|^PG|S3_|AWS_|PROXY/i.test(k)) Reflect.deleteProperty(process.env, k);
      Object.assign(process.env, { NODE_ENV: 'production', OUTLOOK_MIN_COVERAGE: '0.99', PRICE_CACHE_TTL_MS: '0', HTTPS_PROXY: 'http://127.0.0.1:9' });
      const again = run(['--json', '--data-dir', d]);
      expect(again.code, again.stderr).toBe(0);
      expect(again.stdout).toBe(base.stdout);
    } finally {
      globalThis.fetch = origFetch;
      for (const k of Object.keys(process.env)) if (!(k in saved)) Reflect.deleteProperty(process.env, k);
      Object.assign(process.env, saved);
    }
    expect(readdirSync(d).sort()).toEqual(tmpBefore);
    expect(readdirSync(DATA).map((f) => [f, statSync(join(DATA, f)).mtimeMs])).toEqual(before);
  });
});

describe('F8 CI step', () => {
  it('web-ci.yml runs the outlook gate after the charge evaluation step with the exact name and bounds', () => {
    const lines = readFileSync(resolve(ROOT, '.github', 'workflows', 'web-ci.yml'), 'utf8').replace(/\r\n/g, '\n').split('\n');
    const runIdx = lines.findIndex((l) => l.trim() === `run: npm run eval:outlook -- ${CI_ARGS.join(' ')}`);
    expect(runIdx, 'eval:outlook step with the exact CI bounds').toBeGreaterThan(0);
    expect(lines[runIdx - 1]?.trim()).toBe('- name: Cost outlook backtest gate (walk-forward on bundled public data; not a guarantee)');
    const chargeIdx = lines.findIndex((l) => l.includes('npm run eval:charges'));
    expect(chargeIdx).toBeGreaterThan(0);
    expect(runIdx).toBeGreaterThan(chargeIdx);
    expect(lines.filter((l) => l.includes('eval:outlook'))).toHaveLength(1);
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['eval:outlook']).toBeDefined();
  });
});
