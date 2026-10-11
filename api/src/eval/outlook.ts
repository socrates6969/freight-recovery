/**
 * Cost outlook backtest CLI (REQ-20261011-fuel-outlook, Part C F8):
 *   npm run eval:outlook -- [--json] [--data-dir <dir>] [--min-coverage <x>] [--max-coverage <x>]
 *                           [--require-model <series:h,...>]
 * Walk-forward backtest (F7) of every configured horizon on the bundled public price history. The
 * manifest is read with a strict schema and every file's sha256 is checked. Exit codes: 0 every given
 * bound met, 1 a bound not met (named on stderr), 2 usage, manifest, sha or parse error. A regression check
 * of the forecast and range rules, not a guarantee about future prices. No database, no network, no file
 * writes, no environment variables.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  GATE_MIN_DM,
  GATE_MIN_ORIGINS,
  OUTLOOK_EVAL_NOTE,
  OUTLOOK_SERIES,
  OUTLOOK_VERSION,
  OutlookEvalReport,
  PriceCsvError,
  backtestSeries,
  isPriceSeriesKey,
  parsePriceCsv,
  type OutlookEvalReportDto,
  type PriceSeriesKey,
} from '@fr/shared/outlook';

import { PriceDataError, defaultPriceDataDir, readBundledPrices } from '../platform/price-files.js';

export interface OutlookEvalArgs {
  json: boolean;
  dataDir: string | null;
  minCoverage: number | null;
  maxCoverage: number | null;
  requireModel: { series: PriceSeriesKey; h: number }[];
}

export class OutlookEvalUsageError extends Error {}

const COVERAGE = /^(0(\.[0-9]+)?|1(\.0+)?)$/u;
const REQUIRE = /^[a-z_]+:[0-9]+(,[a-z_]+:[0-9]+)*$/u;

function coverageValue(flag: string, v: string): number {
  if (!COVERAGE.test(v)) throw new OutlookEvalUsageError(`${flag} must be a number between 0 and 1`);
  return Number(v);
}

function requireValue(v: string): { series: PriceSeriesKey; h: number }[] {
  if (!REQUIRE.test(v)) throw new OutlookEvalUsageError('--require-model must be series:h[,series:h...]');
  return v.split(',').map((pair) => {
    const [s, h] = pair.split(':');
    const n = Number(h);
    if (!isPriceSeriesKey(s) || !OUTLOOK_SERIES[s].horizons.some((x) => x.h === n)) throw new OutlookEvalUsageError(`--require-model: ${pair} is not a configured series and horizon`);
    return { series: s, h: n };
  });
}

export function parseArgs(argv: readonly string[]): OutlookEvalArgs {
  const args: OutlookEvalArgs = { json: false, dataDir: null, minCoverage: null, maxCoverage: null, requireModel: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (a === '--json') {
      args.json = true;
      continue;
    }
    if (a !== '--data-dir' && a !== '--min-coverage' && a !== '--max-coverage' && a !== '--require-model') throw new OutlookEvalUsageError(`unknown argument: ${a}`);
    const v = argv[i + 1];
    if (v === undefined || v === '') throw new OutlookEvalUsageError(`${a} needs a value`);
    i += 1;
    if (a === '--data-dir') args.dataDir = v;
    else if (a === '--min-coverage') args.minCoverage = coverageValue(a, v);
    else if (a === '--max-coverage') args.maxCoverage = coverageValue(a, v);
    else args.requireModel = requireValue(v);
  }
  return args;
}

/** Run F7 on the bundled files; throws PriceDataError / PriceCsvError on bad data. */
export function buildReport(dir: string): OutlookEvalReportDto {
  const { files } = readBundledPrices(dir);
  const data: OutlookEvalReportDto['data'] = [];
  const results: OutlookEvalReportDto['results'] = [];
  for (const { entry, bytes } of files) {
    const parsed = parsePriceCsv(bytes, entry.series);
    if (parsed.rows.length !== entry.rows || parsed.firstDate !== entry.firstDate || parsed.lastDate !== entry.lastDate) {
      throw new PriceDataError(`manifest rows or dates do not match ${entry.file}`);
    }
    data.push({ series: entry.series, file: entry.file, sha256: parsed.sha256, rows: parsed.rows.length, firstDate: parsed.firstDate, lastDate: parsed.lastDate });
    const bt = backtestSeries(
      parsed.rows.map((r) => r.date),
      parsed.rows.map((r) => r.value),
      entry.series,
    );
    for (const r of bt) {
      results.push({
        series: entry.series,
        h: r.h,
        candidate: r.candidate,
        method: r.method,
        reason: r.reason,
        origins: r.origins,
        firstOrigin: r.firstOrigin,
        naiveMae: r.naiveMae,
        candidateMae: r.candidateMae,
        maeRatio: r.maeRatio,
        dm: r.dm,
        coverage: r.coverage,
        coverageHits: r.coverageHits,
        coverageCases: r.coverageCases,
      });
    }
  }
  return OutlookEvalReport.parse({ evaluation: 'walk-forward', outlookVersion: OUTLOOK_VERSION, note: OUTLOOK_EVAL_NOTE, data, results });
}

/** Failing bounds: `bound not met: <flag> (<detail>)`. */
export function boundFailures(r: OutlookEvalReportDto, args: OutlookEvalArgs): string[] {
  const out: string[] = [];
  for (const x of r.results) {
    if (args.minCoverage !== null && x.coverage < args.minCoverage) out.push(`bound not met: --min-coverage (${x.series}:${x.h} coverage ${x.coverage.toFixed(4)} < ${args.minCoverage})`);
    if (args.maxCoverage !== null && x.coverage > args.maxCoverage) out.push(`bound not met: --max-coverage (${x.series}:${x.h} coverage ${x.coverage.toFixed(4)} > ${args.maxCoverage})`);
  }
  for (const req of args.requireModel) {
    const x = r.results.find((y) => y.series === req.series && y.h === req.h);
    if (x === undefined) out.push(`bound not met: --require-model (${req.series}:${req.h} has no result)`);
    else if (x.method === 'naive') out.push(`bound not met: --require-model (${req.series}:${req.h} uses naive, reason ${x.reason})`);
  }
  return out;
}

const fmt = (x: number | null, d: number): string => (x === null ? 'n/a' : x.toFixed(d));

export function humanSummary(r: OutlookEvalReportDto): string {
  const lines = [
    `Cost outlook backtest (walk-forward), ${r.outlookVersion}, gate: MASE vs no change < 1 and DM >= ${GATE_MIN_DM} over >= ${GATE_MIN_ORIGINS} origins`,
    r.note,
    ...r.data.map((d) => `data ${d.series}: ${d.file} sha256 ${d.sha256.slice(0, 12)} rows ${d.rows} ${d.firstDate}..${d.lastDate}`),
    ...r.results.map(
      (x) =>
        `${x.series} h=${x.h}: method ${x.method} (${x.reason}; candidate ${x.candidate}) origins ${x.origins} from ${x.firstOrigin}  MASE vs no change ${fmt(x.maeRatio, 3)}  DM ${fmt(x.dm, 2)}  80% range coverage ${x.coverageHits}/${x.coverageCases} = ${fmt(x.coverage, 3)}`,
    ),
  ];
  return `${lines.join('\n')}\n`;
}

export function main(argv: readonly string[], out: (s: string) => void, err: (s: string) => void): number {
  let args: OutlookEvalArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    err(`usage error: ${(e as Error).message}\n`);
    return 2;
  }
  let report: OutlookEvalReportDto;
  try {
    report = buildReport(args.dataDir ?? defaultPriceDataDir());
  } catch (e) {
    if (e instanceof PriceDataError) {
      err(`data error: ${e.message}\n`);
      return 2;
    }
    if (e instanceof PriceCsvError) {
      err(`data error: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
  out(args.json ? `${JSON.stringify(report)}\n` : humanSummary(report));
  const failures = boundFailures(report, args);
  for (const f of failures) err(`${f}\n`);
  return failures.length > 0 ? 1 : 0;
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url : false;
if (invoked) {
  process.exitCode = main(process.argv.slice(2), (s) => process.stdout.write(s), (s) => process.stderr.write(s));
}
