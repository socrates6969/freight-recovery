/**
 * Evaluation CLI (Q7):
 *   npm run eval -- --set <dir> [--k 3] [--min-pass-hat-k <0..1>] [--record] [--json]
 * Exit codes: 0 ok (threshold met when given), 1 threshold not met, 2 usage/manifest error (nothing
 * recorded), 3 infrastructure error (nothing recorded). Results are on SYNTHETIC fixtures and are not an
 * accuracy measure. Never prints the database URL or document content.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { EVAL_NOTE, EvalReport, type EvalReportDto } from '@fr/shared';

import { loadImportConfig } from '../config.js';
import { ChildProcessExecutor } from '../imports/sandbox/executor.js';

import { currentGitSha } from './git-sha.js';
import { ManifestError, loadSet } from './manifest.js';
import { recordRun } from './record.js';
import { EVAL_STAGES, InfrastructureError, runEval } from './runner.js';

export interface CliArgs {
  set: string;
  k: number;
  minPassHatK: number | null;
  record: boolean;
  json: boolean;
}

export class UsageError extends Error {}

export function parseArgs(argv: readonly string[]): CliArgs {
  let set: string | null = null;
  let k = 3;
  let minPassHatK: number | null = null;
  let record = false;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new UsageError(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--set') set = next();
    else if (a === '--k') {
      const v = next();
      if (!/^\d+$/u.test(v) || Number(v) < 1 || Number(v) > 20) throw new UsageError('--k must be an integer 1..20');
      k = Number(v);
    } else if (a === '--min-pass-hat-k') {
      const v = next();
      if (!/^(0(\.\d+)?|1(\.0+)?)$/u.test(v)) throw new UsageError('--min-pass-hat-k must be a number 0..1');
      minPassHatK = Number(v);
    } else if (a === '--record') record = true;
    else if (a === '--json') json = true;
    else throw new UsageError(`unknown argument: ${String(a)}`);
  }
  if (!set) throw new UsageError('--set <dir> is required');
  return { set, k, minPassHatK, record, json };
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export function humanSummary(r: EvalReportDto): string {
  const lines = [
    `Evaluation set ${r.evalSetId} v${r.evalSetVersion} (sha256 ${r.evalSetSha256}), stage ${r.stage}, k=${r.k}`,
    EVAL_NOTE,
    `cases ${r.cases}  runs ${r.runsPassed}/${r.runsTotal}  per-run pass rate ${pct(r.perRunPassRate)}`,
    `pass^k ${pct(r.passHatK)} (${r.passHatKCount}/${r.cases})  95% interval (Wilson) ${pct(r.wilson95.low)} - ${pct(r.wilson95.high)}`,
    `flaky ${r.flakyCaseCount}  always failing ${r.alwaysFailCount}  deterministic ${r.deterministicCases}/${r.cases}`,
    '',
    'case                                   passed  outputs  first failure',
    ...r.results.map((c) => `${c.caseId.padEnd(38)} ${`${c.runsPassed}/${c.k}`.padEnd(7)} ${String(c.distinctOutputs).padEnd(8)} ${c.firstFailureCode ?? '-'}`),
  ];
  return `${lines.join('\n')}\n`;
}

export async function main(argv: readonly string[], env: Record<string, string | undefined>, out: (s: string) => void, err: (s: string) => void): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    err(`usage error: ${(e as Error).message}\n`);
    return 2;
  }
  let set;
  try {
    // npm runs workspace scripts in api/; INIT_CWD is where the user invoked `npm run eval`.
    set = loadSet(path.resolve(env['INIT_CWD'] ?? process.cwd(), args.set));
    if (!EVAL_STAGES[set.manifest.stage]) throw new ManifestError(`unknown stage: ${set.manifest.stage}`);
  } catch (e) {
    err(`manifest error: ${e instanceof ManifestError ? e.message : 'cannot read the evaluation set'}\n`);
    return 2;
  }
  let report: EvalReportDto;
  try {
    const imp = loadImportConfig(env);
    if (!existsSync(imp.workerEntry)) throw new InfrastructureError('parse worker not built (run npm run build)');
    const executor = new ChildProcessExecutor({
      workerEntry: imp.workerEntry,
      timeoutMs: imp.parseTimeoutMs,
      memoryMb: imp.parseMemoryMb,
      maxConcurrency: imp.parseMaxConcurrency,
      queueTimeoutMs: Math.max(imp.parseQueueTimeoutMs, 60_000),
      maxOutputBytes: imp.parseMaxOutputBytes,
      limits: { pdfPages: imp.parseMaxPdfPages, textChars: imp.parseMaxTextChars, imagePixels: imp.parseMaxImagePixels },
      threshold: imp.reviewConfidenceThreshold,
    });
    report = EvalReport.parse(await runEval(set, { k: args.k, executor, maxFileBytes: imp.maxFileBytes, now: () => new Date(), gitSha: currentGitSha(env, env['INIT_CWD'] ?? process.cwd()) }));
  } catch (e) {
    err(`infrastructure error: ${e instanceof InfrastructureError ? e.message : (e as Error).name}\n`);
    return 3;
  }
  if (args.record) {
    const url = env['DATABASE_URL'];
    if (!url) {
      err('infrastructure error: DATABASE_URL is required for --record\n');
      return 3;
    }
    try {
      const id = await recordRun(url, report);
      if (!args.json) out(`recorded run ${id}\n`);
    } catch (e) {
      err(`infrastructure error: recording failed (${(e as Error).name})\n`);
      return 3;
    }
  }
  out(args.json ? `${JSON.stringify(report)}\n` : humanSummary(report));
  if (args.minPassHatK !== null && report.passHatK < args.minPassHatK) {
    err(`pass^k ${report.passHatK} is below the required ${args.minPassHatK}\n`);
    return 1;
  }
  return 0;
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url : false;
if (invoked) {
  void main(process.argv.slice(2), process.env, (s) => process.stdout.write(s), (s) => process.stderr.write(s)).then((code) => {
    process.exitCode = code;
  });
}
