/**
 * Evaluation tool units (A7, A8.6): argument parsing and exit codes, manifest guards (traversal, symlink,
 * size, duplicates, unknown stage), canonical output, failure-code mapping, percentiles, set digest, and
 * a full runEval with a fake executor (k runs, flaky/deterministic accounting).
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { EvalReport } from '@fr/shared';
import { afterAll, describe, expect, it } from 'vitest';

import { canonicalOutput, digest } from '../src/eval/canonical.js';
import { UsageError, main, parseArgs } from '../src/eval/cli.js';
import { ManifestError, loadSet } from '../src/eval/manifest.js';
import { evalSetSha256, judge, median, percentileCont, runEval } from '../src/eval/runner.js';
import type { ParseExecutor } from '../src/imports/sandbox/executor.js';

const dirs: string[] = [];
function setDir(manifest: unknown, files: Record<string, string | Buffer> = {}): string {
  const d = mkdtempSync(path.join(tmpdir(), 'fr-eval-'));
  dirs.push(d);
  for (const [n, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(d, n)), { recursive: true });
    writeFileSync(path.join(d, n), c);
  }
  writeFileSync(path.join(d, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const parsedCase = (id: string, file: string, fields: { key: string; groupIndex: number | null; value: string | null }[] = []) => ({
  id,
  category: 'c',
  file,
  filename: 'invoice.txt',
  expectedBasis: 'hand_authored',
  expect: { outcome: 'parsed', docType: 'INVOICE', fields },
});
const manifestOf = (cases: unknown[], stage = 'extraction') => ({ evalSetId: 't', version: '1', stage, description: '', cases });

describe('CLI arguments', () => {
  it('parses flags and rejects bad values', () => {
    expect(parseArgs(['--set', 'x'])).toEqual({ set: 'x', k: 3, minPassHatK: null, record: false, json: false });
    expect(parseArgs(['--set', 'x', '--k', '5', '--min-pass-hat-k', '0.75', '--record', '--json'])).toEqual({ set: 'x', k: 5, minPassHatK: 0.75, record: true, json: true });
    for (const bad of [[], ['--set'], ['--set', 'x', '--k', '0'], ['--set', 'x', '--k', '21'], ['--set', 'x', '--min-pass-hat-k', '1.5'], ['--set', 'x', '--bogus']]) {
      expect(() => parseArgs(bad)).toThrow(UsageError);
    }
  });

  it('exit 2 for usage and manifest errors, never touching a database', async () => {
    const out: string[] = [];
    const err: string[] = [];
    expect(await main(['--k', '3'], {}, (s) => out.push(s), (s) => err.push(s))).toBe(2);
    expect(await main(['--set', path.join(tmpdir(), 'does-not-exist-eval')], {}, (s) => out.push(s), (s) => err.push(s))).toBe(2);
    const d = setDir(manifestOf([parsedCase('a', 'a.txt')], 'rules'), { 'a.txt': 'x' });
    expect(await main(['--set', d, '--record'], { DATABASE_URL: 'postgresql://secret-user:secret-pw@h/db' }, (s) => out.push(s), (s) => err.push(s))).toBe(2);
    expect(err.join('')).not.toContain('secret-pw');
  });
});

describe('manifest guards', () => {
  it('rejects traversal, absolute paths, symlinks, oversize files, duplicate ids, unknown keys', () => {
    const outside = setDir(manifestOf([]), { 'secret.txt': 's' });
    expect(() => loadSet(setDir(manifestOf([parsedCase('a', '../x.txt')])))).toThrow(ManifestError);
    expect(() => loadSet(setDir(manifestOf([parsedCase('a', path.join(outside, 'secret.txt'))])))).toThrow(ManifestError);
    expect(() => loadSet(setDir(manifestOf([parsedCase('a', 'a.txt'), parsedCase('a', 'a.txt')]), { 'a.txt': 'x' }))).toThrow(/duplicate/u);
    expect(() => loadSet(setDir(manifestOf([parsedCase('a', 'big.txt')]), { 'big.txt': Buffer.alloc(5 * 1024 * 1024 + 1) }))).toThrow(/too large/u);
    expect(() => loadSet(setDir({ ...manifestOf([parsedCase('a', 'a.txt')]), extra: 1 }, { 'a.txt': 'x' }))).toThrow(ManifestError);
    expect(() => loadSet(setDir('{not json'))).toThrow(ManifestError);
    const linkDir = setDir(manifestOf([parsedCase('a', 'link.txt')]));
    let symlinked = true;
    try {
      symlinkSync(path.join(outside, 'secret.txt'), path.join(linkDir, 'link.txt'));
    } catch {
      symlinked = false; // Windows without symlink privilege: nothing to test.
    }
    if (symlinked) expect(() => loadSet(linkDir)).toThrow(ManifestError);
  });
});

describe('judge, canonical output, statistics helpers', () => {
  const exp = { outcome: 'parsed' as const, docType: 'INVOICE' as const, fields: [{ key: 'invoice.total', groupIndex: null, value: '1.00' }] };
  it('maps failures in the documented order', () => {
    expect(judge(exp, { docType: 'INVOICE', fields: [['invoice.total', null, '1.00']] })).toBeNull();
    expect(judge(exp, { rejected: 'malformed_csv' })).toBe('unexpected_reject');
    expect(judge(exp, { rejected: 'parse_timeout' })).toBe('timeout');
    expect(judge(exp, { rejected: 'parse_failed' })).toBe('infrastructure');
    expect(judge(exp, { docType: 'OTHER', fields: [] })).toBe('wrong_doc_type');
    expect(judge(exp, { docType: 'INVOICE', fields: [] })).toBe('missing_field');
    expect(judge(exp, { docType: 'INVOICE', fields: [['invoice.total', null, '1.00'], ['invoice.carrier', null, 'x']] })).toBe('unexpected_field');
    expect(judge(exp, { docType: 'INVOICE', fields: [['invoice.total', null, '2.00']] })).toBe('field_mismatch');
    const rej = { outcome: 'rejected' as const, reason: 'empty_file' };
    expect(judge(rej, { rejected: 'empty_file' })).toBeNull();
    expect(judge(rej, { rejected: 'markup_content' })).toBe('wrong_reject_reason');
    expect(judge(rej, { docType: 'OTHER', fields: [] })).toBe('not_rejected');
  });
  it('canonical output is order-independent and digests differ when values differ', () => {
    const a = { docType: 'INVOICE', fields: [['b', null, 'x'], ['a', 1, 'y'], ['a', 0, null]] as [string, number | null, string | null][] };
    const b = { docType: 'INVOICE', fields: [['a', 0, null], ['b', null, 'x'], ['a', 1, 'y']] as [string, number | null, string | null][] };
    expect(canonicalOutput(a)).toBe(canonicalOutput(b));
    expect(digest(a)).toBe(digest(b));
    expect(digest({ rejected: 'x' })).not.toBe(digest({ rejected: 'y' }));
  });
  it('percentile_cont and median', () => {
    expect(percentileCont([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentileCont([10, 20, 30, 40, 50], 0.95)).toBeCloseTo(48, 12);
    expect(median([5, 1, 3])).toBe(3);
    expect(percentileCont([], 0.5)).toBe(0);
  });
});

describe('runEval with a fake executor', () => {
  it('runs k times, detects flaky cases and non-deterministic outputs, computes the set digest', async () => {
    const d = setDir(
      manifestOf([
        parsedCase('stable', 'a.txt', [{ key: 'invoice.total', groupIndex: null, value: '1.00' }]),
        parsedCase('flaky', 'b.txt', [{ key: 'invoice.total', groupIndex: null, value: '1.00' }]),
        { ...parsedCase('rejected', 'e.txt'), expect: { outcome: 'rejected', reason: 'empty_file' } },
      ]),
      { 'a.txt': 'DOCUMENT: INVOICE\nTotal: 1.00\n', 'b.txt': 'DOCUMENT: INVOICE\nTotal: 2.00\n', 'e.txt': '' },
    );
    const set = loadSet(d);
    let calls = 0;
    const executor: ParseExecutor = {
      run: async (job) => {
        calls += 1;
        const text = Buffer.from(job.bytes).toString('utf8');
        const value = text.includes('2.00') && calls % 2 === 0 ? '2.00' : '1.00';
        return {
          ok: true,
          result: { docType: 'INVOICE', fields: [{ key: 'invoice.total', groupIndex: null, value }] },
        } as never;
      },
    };
    const r = EvalReport.parse(await runEval(set, { k: 4, executor, maxFileBytes: 1000, now: () => new Date('2026-10-09T00:00:00Z'), gitSha: null }));
    expect(r.cases).toBe(3);
    expect(r.passHatKCount).toBe(2);
    expect(r.flakyCaseCount).toBe(1);
    expect(r.deterministicCases).toBe(2);
    expect(r.results.map((x) => [x.caseId, x.runsPassed, x.distinctOutputs])).toEqual([
      ['flaky', 2, 2],
      ['rejected', 4, 1],
      ['stable', 4, 1],
    ]);
    expect(r.results.find((x) => x.caseId === 'flaky')?.firstFailureCode).toBe('field_mismatch');
    expect(r.evalSetSha256).toBe(evalSetSha256(set));
    expect(r.basis).toBe('synthetic_fixtures');
    expect(r.passPowCurve).toHaveLength(4);
  });
});
