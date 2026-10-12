/** Charge classifier evaluation CLI (C11): argument parsing, bounds and exit codes (no build, no database). */
import { CHARGE_EVAL_NOTE, ChargeEvalReport } from '@fr/shared/charge-intel';
import { describe, expect, it } from 'vitest';

import { ChargeEvalUsageError, main, parseArgs } from '../src/eval/charges.js';

function run(argv: string[]): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, (s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join(''), err: err.join('') };
}

const CI_BOUNDS = ['--min-top1', '173', '--min-accessorial-top1', '158', '--min-accessorial-recognised', '145', '--max-wrong-suggested', '1'];

describe('eval:charges arguments', () => {
  it('parses flags', () => {
    expect(parseArgs([])).toEqual({ json: false, minTop1: null, minAccessorialTop1: null, minAccessorialRecognised: null, maxWrongSuggested: null });
    expect(parseArgs(['--json', ...CI_BOUNDS])).toEqual({ json: true, minTop1: 173, minAccessorialTop1: 158, minAccessorialRecognised: 145, maxWrongSuggested: 1 });
  });

  it('rejects unknown flags, missing and non-integer values', () => {
    for (const bad of [['--bogus'], ['--min-top1'], ['--min-top1', '1.5'], ['--min-top1', '-1'], ['--min-top1', 'x'], ['--min-top1', ''], ['--json=1']]) {
      expect(() => parseArgs(bad)).toThrow(ChargeEvalUsageError);
    }
  });
});

describe('eval:charges exit codes', () => {
  it('exit 0 with the CI bounds; the summary starts with the title and the note', () => {
    const r = run(CI_BOUNDS);
    expect(r.code).toBe(0);
    expect(r.err).toBe('');
    const lines = r.out.split('\n');
    expect(lines[0]).toBe('Charge classifier evaluation (leave-one-carrier-out), seed tariff-seed-v1, classifier charge-knn-v1, threshold 0.30');
    expect(lines[1]).toBe(CHARGE_EVAL_NOTE);
  });

  it('--json prints one schema-valid JSON line', () => {
    const r = run(['--json']);
    expect(r.code).toBe(0);
    expect(r.out.endsWith('\n')).toBe(true);
    expect(r.out.trim().split('\n')).toHaveLength(1);
    expect(ChargeEvalReport.safeParse(JSON.parse(r.out)).success).toBe(true);
  });

  it('exit 1 names every failing bound', () => {
    const r = run(['--min-top1', '174', '--max-wrong-suggested', '0', '--min-accessorial-top1', '158']);
    expect(r.code).toBe(1);
    expect(r.err).toBe('bound not met: --min-top1 (173 vs 174)\nbound not met: --max-wrong-suggested (1 vs 0)\n');
  });

  it('exit 2 on a usage error, nothing on stdout', () => {
    const r = run(['--min-top1', 'abc']);
    expect(r.code).toBe(2);
    expect(r.out).toBe('');
    expect(r.err.startsWith('usage error: ')).toBe(true);
  });
});
