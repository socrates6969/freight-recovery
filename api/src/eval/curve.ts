/**
 * Learning-curve CLI of the charge classifier (scoup Labs, "Recall"):
 *   npm run eval:curve -- [--seed v1|v2] [--resamples N] [--json] [--out <file>]
 * Leave-one-source-out learning curve over the committed seed set (`learningCurve` in @fr/shared/charge-intel):
 * recognition and wrong-suggestion rate against the number of training names (fractions of the other sources'
 * names and 1..S-1 other sources), per-source detail and, for seed v2, the 175 v1 names held out. Deterministic
 * (fixed PRNG seed). Prints a human summary (or one JSON line with --json) and, with --out, writes the JSON report
 * (plus the current commit) to that file. Exit codes: 0 ok, 2 usage error. No database, no network, no
 * environment variables beyond INIT_CWD / GITHUB_SHA. A check on tariff charge names, not an accuracy measure
 * on invoices.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { CURVE_RESAMPLES, learningCurve, type CurveReport } from '@fr/shared/charge-intel';

import { currentGitSha } from './git-sha.js';

export interface CurveEvalArgs {
  seed: 'v1' | 'v2';
  resamples: number;
  json: boolean;
  out: string | null;
}

export class CurveEvalUsageError extends Error {}

export type CurveEvalOutput = CurveReport & { commit: string | null };

export function parseArgs(argv: readonly string[]): CurveEvalArgs {
  const args: CurveEvalArgs = { seed: 'v2', resamples: CURVE_RESAMPLES, json: false, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (a === '--json') {
      args.json = true;
      continue;
    }
    if (a !== '--seed' && a !== '--resamples' && a !== '--out') throw new CurveEvalUsageError(`unknown argument: ${a}`);
    const v = argv[i + 1];
    if (v === undefined || v === '') throw new CurveEvalUsageError(`${a} needs a value`);
    i += 1;
    if (a === '--seed') {
      if (v !== 'v1' && v !== 'v2') throw new CurveEvalUsageError('--seed must be v1 or v2');
      args.seed = v;
    } else if (a === '--resamples') {
      if (!/^[0-9]+$/u.test(v) || Number(v) < 1 || Number(v) > 1000) throw new CurveEvalUsageError('--resamples must be an integer 1..1000');
      args.resamples = Number(v);
    } else args.out = v;
  }
  return args;
}

const f1 = (x: number): string => x.toFixed(1).padStart(6);
const f2 = (x: number): string => x.toFixed(2).padStart(6);

export function humanSummary(r: CurveEvalOutput): string {
  const lines = [
    `Charge classifier learning curve (leave-one-source-out, distinct names), seed ${r.seedVersion} (${r.seed}), classifier ${r.classifierVersion}, threshold ${r.threshold.toFixed(2)}, PRNG seed ${r.rngSeed}, ${r.resamples} resamples, commit ${r.commit ?? 'unknown'}`,
    r.note,
    `examples ${r.examples}  sources ${r.sources}`,
    `baselines: keyword rules ${r.baselines.keyword.recognition.toFixed(2)} % recognised, ${r.baselines.keyword.wrong.toFixed(2)} % wrong; always-accessorial ${r.baselines.majority.recognition.toFixed(2)} % recognised, ${r.baselines.majority.wrong.toFixed(2)} % wrong`,
    '',
    'fraction  names/fold  recognised %  [2.5, 97.5]      wrong %  abstain %  top-1 %  accessorial %',
    ...r.byFraction.map(
      (p) =>
        `${String(Math.round(p.fraction * 100)).padStart(7)} %${f1(p.trainNamesMean).padStart(12)}${f2(p.recognition.mean).padStart(14)}  [${f2(p.recognition.lo)}, ${f2(p.recognition.hi)}]${f2(p.wrong.mean).padStart(9)}${f2(p.abstain.mean).padStart(11)}${f2(p.top1.mean).padStart(9)}${f2(p.accessorialRecognition.mean).padStart(15)}`,
    ),
    '',
    'other sources  names/fold  recognised %  wrong %  accessorial %',
    ...r.bySourceCount.map((p) => `${String(p.otherSources).padStart(13)}${f1(p.trainNamesMean).padStart(12)}${f2(p.recognition).padStart(14)}${f2(p.wrong).padStart(9)}${f2(p.accessorialRecognition).padStart(15)}`),
    '',
    'held-out source                              names  recognised  wrong  abstained',
    ...r.perSource.map((p) => `${p.label.padEnd(42)} ${String(p.examples).padEnd(6)} ${String(p.recognised).padEnd(11)} ${String(p.wrong).padEnd(6)} ${p.abstained}`),
  ];
  if (r.v1HeldOut) lines.push('', `v1 names held out with every other v2 source as candidates: ${r.v1HeldOut.recognised}/${r.v1HeldOut.examples} recognised, ${r.v1HeldOut.wrong} wrong, ${r.v1HeldOut.abstained} abstained`);
  return `${lines.join('\n')}\n`;
}

export function main(argv: readonly string[], env: Record<string, string | undefined>, out: (s: string) => void, err: (s: string) => void): number {
  let args: CurveEvalArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    err(`usage error: ${(e as Error).message}\n`);
    return 2;
  }
  const cwd = env['INIT_CWD'] ?? process.cwd();
  const report: CurveEvalOutput = { ...learningCurve(args.seed, args.resamples), commit: currentGitSha(env, cwd) };
  if (args.out !== null) writeFileSync(path.resolve(cwd, args.out), `${JSON.stringify(report, null, 1)}\n`);
  out(args.json ? `${JSON.stringify(report)}\n` : humanSummary(report));
  return 0;
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url : false;
if (invoked) {
  process.exitCode = main(process.argv.slice(2), process.env, (s) => process.stdout.write(s), (s) => process.stderr.write(s));
}