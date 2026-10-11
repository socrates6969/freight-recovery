/* eslint-disable */
// REQ-20261011-charge-intelligence Tier H (after `npm run build`): T14 evaluation CLI and CI step (CI-E01..E06;
// Part C C11). Runs the built CLI through npm at the repository root; no database, no network.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const CI_BOUNDS = ['--min-top1', '173', '--min-accessorial-top1', '158', '--min-accessorial-recognised', '145', '--max-wrong-suggested', '1'];
/** sha256 of .github/workflows/web-ci.yml at 51ea826 (LF line endings), before step 6. */
const WORKFLOW_51EA826 = '397c065f2e327bc8630a1e65ea092abfd087ab935617aca7c825fdc8eb5027b8';

function cli(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const r = spawnSync('npm', ['run', '--silent', 'eval:charges', '--', ...args], { cwd: ROOT, env, shell: true, encoding: 'utf8', timeout: 120000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const noDbEnv = () => {
  const e: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(e)) if (/DATABASE_URL|^PG|S3_|AWS_/.test(k)) delete e[k];
  e.HTTP_PROXY = 'http://127.0.0.1:9'; e.HTTPS_PROXY = 'http://127.0.0.1:9';
  return e;
};

let C: any;
let R: any;
beforeAll(async () => {
  C = await import('@fr/shared/charge-intel');
  R = await import('@fr/shared');
});

describe('T14 eval:charges CLI (C11)', () => {
  it('CI-E01 --json prints one JSON line equal to evaluateLeaveOneCarrierOut()', () => {
    const r = cli(['--json']);
    expect(r.code, r.stderr).toBe(0);
    const lines = r.stdout.split(/\r?\n/).filter((l) => l.trim() !== '');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual(C.evaluateLeaveOneCarrierOut());
  });
  it('CI-E02 human mode: second line is CHARGE_EVAL_NOTE', () => {
    const r = cli([]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split(/\r?\n/)[1]).toBe(R.CHARGE_EVAL_NOTE);
    expect(r.stdout).not.toMatch(/\baccurate\b|guarantee/i);
  });
  it('CI-E03 bounds: CI bounds pass; one-too-strict bounds fail with exit 1 naming the bound', () => {
    expect(cli(CI_BOUNDS).code).toBe(0);
    const t = cli(['--min-top1', '174']);
    expect(t.code).toBe(1);
    expect(t.stderr).toContain('--min-top1');
    const w = cli(['--max-wrong-suggested', '0']);
    expect(w.code).toBe(1);
    expect(w.stderr).toContain('--max-wrong-suggested');
    const a = cli(['--min-accessorial-recognised', '146']);
    expect(a.code).toBe(1);
    expect(a.stderr).toContain('--min-accessorial-recognised');
    const b = cli(['--min-accessorial-top1', '159']);
    expect(b.code).toBe(1);
    expect(b.stderr).toContain('--min-accessorial-top1');
  });
  it('CI-E04 usage errors exit 2', () => {
    for (const args of [['--bogus'], ['--min-top1'], ['--min-top1', 'abc'], ['--min-top1', '-1']]) expect(cli(args).code, args.join(' ')).toBe(2);
  });
  it('CI-E06 needs no database or network', () => {
    const r = cli(['--json', ...CI_BOUNDS], noDbEnv());
    expect(r.code, r.stderr).toBe(0);
  });
});

describe('CI-E05 workflow step', () => {
  it('web-ci.yml runs the gate after the build; the diff against 51ea826 is only that addition', () => {
    const y = readFileSync(resolve(ROOT, '.github', 'workflows', 'web-ci.yml'), 'utf8').replace(/\r\n/g, '\n');
    const lines = y.split('\n');
    const cmd = `npm run eval:charges -- ${CI_BOUNDS.join(' ')}`;
    const runIdx = lines.findIndex((l) => l.trim() === `run: ${cmd}`);
    expect(runIdx, 'eval:charges step with the exact CI bounds').toBeGreaterThan(0);
    const buildIdx = lines.findIndex((l) => l.trim() === '- run: npm run build' || l.trim() === 'run: npm run build');
    expect(buildIdx).toBeGreaterThan(0);
    expect(runIdx).toBeGreaterThan(buildIdx);
    expect(lines.filter((l) => l.includes('eval:charges'))).toHaveLength(1);
    const nameIdx = runIdx - 1;
    expect(lines[nameIdx]!.trim()).toMatch(/^- name: /);
    // REQ-20261011-fuel-outlook F8 (additive): the step-7 outlook gate step (name + run line) is also removed before
    // hashing; outlook-eval-cli.acc.test.ts pins its exact text and position.
    const oRun = lines.findIndex((l) => l.trim().startsWith('run: npm run eval:outlook -- '));
    const oName = oRun > 0 && /^- name: Cost outlook backtest gate/.test(lines[oRun - 1]!.trim()) ? oRun - 1 : -1;
    const without = lines.filter((_, i) => i !== runIdx && i !== nameIdx && i !== oRun && i !== oName).join('\n');
    expect(createHash('sha256').update(without).digest('hex'), 'workflow minus the new step equals 51ea826').toBe(WORKFLOW_51EA826);
  });
});
