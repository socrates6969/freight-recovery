/** Cost outlook backtest CLI (F8): arguments, bounds, exit codes and data checks (no build, no database). */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { OUTLOOK_EVAL_NOTE, OutlookEvalReport } from '@fr/shared/outlook';
import { afterAll, describe, expect, it } from 'vitest';

import { OutlookEvalUsageError, main, parseArgs } from '../src/eval/outlook.js';
import { defaultPriceDataDir } from '../src/platform/price-files.js';

const CI_BOUNDS = ['--min-coverage', '0.70', '--max-coverage', '0.90', '--require-model', 'diesel_us:1,diesel_us:4,ppi_tl:1'];
const dataDir = defaultPriceDataDir();
const temps: string[] = [];

function run(argv: string[]): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, (s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join(''), err: err.join('') };
}

function tempCopy(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'fr-prices-'));
  temps.push(dir);
  cpSync(dataDir, dir, { recursive: true });
  return dir;
}

afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

describe('eval:outlook data directory', () => {
  it('resolves api/data/public-prices from src/ and from dist/src/', () => {
    expect(existsSync(path.join(dataDir, 'manifest.json'))).toBe(true);
    const apiRoot = path.resolve(dataDir, '..', '..');
    const fromDist = defaultPriceDataDir(pathToFileURL(path.join(apiRoot, 'dist', 'src', 'platform', 'price-files.js')).href);
    expect(path.resolve(fromDist)).toBe(path.resolve(dataDir));
  });
});

describe('eval:outlook arguments', () => {
  it('parses flags', () => {
    expect(parseArgs([])).toEqual({ json: false, dataDir: null, minCoverage: null, maxCoverage: null, requireModel: [] });
    expect(parseArgs(['--json', '--data-dir', 'x', ...CI_BOUNDS])).toEqual({
      json: true,
      dataDir: 'x',
      minCoverage: 0.7,
      maxCoverage: 0.9,
      requireModel: [
        { series: 'diesel_us', h: 1 },
        { series: 'diesel_us', h: 4 },
        { series: 'ppi_tl', h: 1 },
      ],
    });
  });

  it('rejects unknown flags, missing values, values outside 0..1 and malformed or unknown series:h', () => {
    for (const bad of [
      ['--bogus'],
      ['--min-coverage'],
      ['--min-coverage', '1.5'],
      ['--min-coverage', '-0.1'],
      ['--min-coverage', '.7'],
      ['--max-coverage', '1.01'],
      ['--require-model', 'diesel_us'],
      ['--require-model', 'diesel_us:2'],
      ['--require-model', 'deep_sea:1'],
      ['--require-model', 'diesel_us:1,'],
      ['--data-dir', ''],
    ]) {
      expect(() => parseArgs(bad)).toThrow(OutlookEvalUsageError);
      expect(run(bad).code).toBe(2);
    }
  });
});

describe('eval:outlook exit codes', () => {
  it('exit 0 with the CI bounds; the summary starts with the title and the note', () => {
    const r = run(CI_BOUNDS);
    expect([r.code, r.err]).toEqual([0, '']);
    const lines = r.out.split('\n');
    expect(lines[0]).toBe('Cost outlook backtest (walk-forward), outlook-v1, gate: MASE vs no change < 1 and DM >= 1.96 over >= 100 origins');
    expect(lines[1]).toBe(OUTLOOK_EVAL_NOTE);
  });

  it('--json prints one schema-valid JSON line with the reproduced backtest', () => {
    const r = run(['--json']);
    expect(r.code).toBe(0);
    const report = OutlookEvalReport.parse(JSON.parse(r.out));
    expect(r.out.trimEnd().split('\n')).toHaveLength(1);
    expect(report.results.map((x) => [x.series, x.h, x.method, x.reason])).toEqual([
      ['diesel_us', 1, 'ar2', 'model_beats_naive'],
      ['diesel_us', 4, 'combo', 'model_beats_naive'],
      ['diesel_us', 8, 'naive', 'naive_by_design'],
      ['diesel_us', 13, 'naive', 'naive_by_design'],
      ['ppi_tl', 1, 'ar2', 'model_beats_naive'],
    ]);
    expect(report.data.map((d) => [d.series, d.rows, d.firstDate, d.lastDate])).toEqual([
      ['diesel_us', 1699, '1994-03-21', '2026-10-05'],
      ['ppi_tl', 411, '1992-06-01', '2026-08-01'],
    ]);
  });

  it('exit 1 with each failing bound on stderr', () => {
    const r = run(['--min-coverage', '0.79', '--max-coverage', '0.77']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('bound not met: --min-coverage (diesel_us:1 ');
    expect(r.err).toContain('bound not met: --max-coverage (diesel_us:4 ');
  });

  it('exit 2 on a tampered file (sha mismatch), a bad manifest or a missing directory', () => {
    const tampered = tempCopy();
    const f = path.join(tampered, 'GASDESW.csv');
    writeFileSync(f, readFileSync(f, 'utf8').replace('1994-03-21,1.106', '1994-03-21,1.107'));
    const t = run(['--data-dir', tampered]);
    expect([t.code, t.out]).toEqual([2, '']);
    expect(t.err).toContain('sha256 mismatch');

    const badManifest = tempCopy();
    const m = JSON.parse(readFileSync(path.join(badManifest, 'manifest.json'), 'utf8')) as { files: { series: string }[] };
    (m.files[0] as { series: string }).series = 'deep_sea';
    writeFileSync(path.join(badManifest, 'manifest.json'), JSON.stringify(m));
    expect(run(['--data-dir', badManifest]).code).toBe(2);

    const escape = tempCopy();
    const m2 = JSON.parse(readFileSync(path.join(escape, 'manifest.json'), 'utf8')) as { files: { file: string }[] };
    (m2.files[0] as { file: string }).file = '../GASDESW.csv';
    writeFileSync(path.join(escape, 'manifest.json'), JSON.stringify(m2));
    expect(run(['--data-dir', escape]).code).toBe(2);

    expect(run(['--data-dir', path.join(tampered, 'nope')]).code).toBe(2);
  });
});
