/** Learning-curve CLI (scoup Labs): argument parsing, output and exit codes (no build, no database). */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CurveEvalUsageError, main, parseArgs } from '../src/eval/curve.js';

function run(argv: string[], env: Record<string, string | undefined> = {}): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, env, (s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join(''), err: err.join('') };
}

describe('eval:curve arguments', () => {
  it('parses flags with the defaults seed v2 and 50 resamples', () => {
    expect(parseArgs([])).toEqual({ seed: 'v2', resamples: 50, json: false, out: null });
    expect(parseArgs(['--seed', 'v1', '--resamples', '3', '--json', '--out', 'x.json'])).toEqual({ seed: 'v1', resamples: 3, json: true, out: 'x.json' });
  });

  it('rejects unknown flags, missing and bad values', () => {
    for (const bad of [['--bogus'], ['--seed'], ['--seed', 'v3'], ['--resamples', '0'], ['--resamples', '1.5'], ['--resamples', '1001'], ['--out'], ['--json=1']]) {
      expect(() => parseArgs(bad)).toThrow(CurveEvalUsageError);
    }
  });
});

describe('eval:curve output', () => {
  it('--json prints one JSON line with the v1 curve (1 resample) and writes the same report to --out', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fr-curve-'));
    try {
      const r = run(['--seed', 'v1', '--resamples', '1', '--json', '--out', 'curve.json'], { INIT_CWD: dir, GITHUB_SHA: 'abcdef0123456789' });
      expect(r.code).toBe(0);
      expect(r.err).toBe('');
      expect(r.out.trim().split('\n')).toHaveLength(1);
      const report = JSON.parse(r.out);
      expect([report.evaluation, report.seed, report.examples, report.sources, report.resamples, report.commit]).toEqual(['learning-curve', 'v1', 175, 6, 1, 'abcdef0123456789']);
      expect(report.byFraction[4]).toMatchObject({ fraction: 1, recognition: { mean: 89.14 }, wrong: { mean: 0.57 } });
      expect(JSON.parse(readFileSync(path.join(dir, 'curve.json'), 'utf8'))).toEqual(report);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('the human summary starts with the title line and the note', () => {
    const r = run(['--seed', 'v1', '--resamples', '1']);
    expect(r.code).toBe(0);
    const lines = r.out.split('\n');
    expect(lines[0]?.startsWith('Charge classifier learning curve (leave-one-source-out, distinct names), seed tariff-seed-v2 (v1), classifier charge-knn-v1, threshold 0.30, PRNG seed 20261019, 1 resamples')).toBe(true);
    expect(lines[1]).toContain('not an accuracy measure');
    expect(r.out).toContain('other sources  names/fold');
  }, 60_000);

  it('exit 2 on a usage error, nothing on stdout', () => {
    const r = run(['--seed', 'x']);
    expect(r.code).toBe(2);
    expect(r.out).toBe('');
    expect(r.err.startsWith('usage error: ')).toBe(true);
  });
});