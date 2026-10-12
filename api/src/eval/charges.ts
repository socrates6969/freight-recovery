/**
 * Charge classifier evaluation CLI (REQ-20261011-charge-intelligence, Part C C11):
 *   npm run eval:charges -- [--json] [--min-top1 N] [--min-accessorial-top1 N]
 *                           [--min-accessorial-recognised N] [--max-wrong-suggested N]
 * Leave-one-carrier-out over the committed seed set `tariff-seed-v1`. Exit codes: 0 every given bound
 * met, 1 a bound not met (named on stderr), 2 usage error. A regression check on the seed set, not an
 * accuracy measure on invoices. No database, no network, no file writes, no environment variables.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { CHARGE_EVAL_NOTE, ChargeEvalReport, evaluateLeaveOneCarrierOut, type ChargeEvalReportDto } from '@fr/shared/charge-intel';

export interface ChargeEvalArgs {
  json: boolean;
  minTop1: number | null;
  minAccessorialTop1: number | null;
  minAccessorialRecognised: number | null;
  maxWrongSuggested: number | null;
}

export class ChargeEvalUsageError extends Error {}

const BOUND_FLAGS = {
  '--min-top1': 'minTop1',
  '--min-accessorial-top1': 'minAccessorialTop1',
  '--min-accessorial-recognised': 'minAccessorialRecognised',
  '--max-wrong-suggested': 'maxWrongSuggested',
} as const satisfies Record<string, keyof ChargeEvalArgs>;

type BoundFlag = keyof typeof BOUND_FLAGS;

const isBoundFlag = (a: string): a is BoundFlag => Object.hasOwn(BOUND_FLAGS, a);

export function parseArgs(argv: readonly string[]): ChargeEvalArgs {
  const args: ChargeEvalArgs = { json: false, minTop1: null, minAccessorialTop1: null, minAccessorialRecognised: null, maxWrongSuggested: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (a === '--json') {
      args.json = true;
      continue;
    }
    if (!isBoundFlag(a)) throw new ChargeEvalUsageError(`unknown argument: ${a}`);
    const v = argv[i + 1];
    if (v === undefined) throw new ChargeEvalUsageError(`${a} needs a value`);
    if (!/^[0-9]+$/u.test(v) || !Number.isSafeInteger(Number(v))) throw new ChargeEvalUsageError(`${a} must be a non-negative integer`);
    args[BOUND_FLAGS[a]] = Number(v);
    i += 1;
  }
  return args;
}

/** Failing bounds, in flag order: `bound not met: <flag> (<actual> vs <bound>)`. */
export function boundFailures(r: ChargeEvalReportDto, args: ChargeEvalArgs): string[] {
  const out: string[] = [];
  const min = (flag: BoundFlag, actual: number, bound: number | null) => {
    if (bound !== null && actual < bound) out.push(`bound not met: ${flag} (${actual} vs ${bound})`);
  };
  min('--min-top1', r.top1.correct, args.minTop1);
  min('--min-accessorial-top1', r.top1.byCategory.accessorial.correct, args.minAccessorialTop1);
  min('--min-accessorial-recognised', r.atThreshold.byCategory.accessorial.recognised, args.minAccessorialRecognised);
  if (args.maxWrongSuggested !== null && r.atThreshold.wrong > args.maxWrongSuggested) {
    out.push(`bound not met: --max-wrong-suggested (${r.atThreshold.wrong} vs ${args.maxWrongSuggested})`);
  }
  return out;
}

export function humanSummary(r: ChargeEvalReportDto): string {
  const acc = r.top1.byCategory.accessorial;
  const accT = r.atThreshold.byCategory.accessorial;
  const lines = [
    `Charge classifier evaluation (leave-one-carrier-out), seed ${r.seedVersion}, classifier ${r.classifierVersion}, threshold ${r.threshold.toFixed(2)}`,
    CHARGE_EVAL_NOTE,
    `examples ${r.examples}  carriers ${r.carriers}`,
    `top-1: ${r.top1.correct}/${r.top1.total} nearest example has the same label (accessorial ${acc.correct}/${acc.total})`,
    `at threshold: ${r.atThreshold.suggested} suggested, ${r.atThreshold.correct} correct, ${r.atThreshold.wrong} wrong, ${r.atThreshold.abstained} abstained (accessorial recognised ${accT.recognised}/${accT.total})`,
    `distinct names: top-1 ${r.distinctName.top1Correct}, ${r.distinctName.suggested} suggested, ${r.distinctName.correct} correct, ${r.distinctName.wrong} wrong, ${r.distinctName.abstained} abstained (accessorial recognised ${r.distinctName.accessorialRecognised})`,
    `keyword rules alone: ${r.keywordBaseline.correct}/${r.examples} (accessorial ${r.keywordBaseline.accessorialRecognised}); keyword rules + suggestions cover ${r.pipelineAccessorialCovered} accessorial names`,
    '',
    'carrier                                    names  top-1  acc top-1  acc recognised  abstained  wrong',
    ...r.perCarrier.map(
      (p) =>
        `${p.label.padEnd(42)} ${String(p.examples).padEnd(6)} ${String(p.top1Correct).padEnd(6)} ${`${p.accessorialTop1}/${p.accessorialTotal}`.padEnd(10)} ${`${p.accessorialRecognised}/${p.accessorialTotal}`.padEnd(15)} ${String(p.abstained).padEnd(10)} ${p.wrongSuggested}`,
    ),
  ];
  return `${lines.join('\n')}\n`;
}

export function main(argv: readonly string[], out: (s: string) => void, err: (s: string) => void): number {
  let args: ChargeEvalArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    err(`usage error: ${(e as Error).message}\n`);
    return 2;
  }
  const report = ChargeEvalReport.parse(evaluateLeaveOneCarrierOut());
  out(args.json ? `${JSON.stringify(report)}\n` : humanSummary(report));
  const failures = boundFailures(report, args);
  for (const f of failures) err(`${f}\n`);
  return failures.length > 0 ? 1 : 0;
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url : false;
if (invoked) {
  process.exitCode = main(process.argv.slice(2), (s) => process.stdout.write(s), (s) => process.stderr.write(s));
}
