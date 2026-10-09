/**
 * Evaluation runner (Q7, A7.2): for every case, k runs through the SAME pre-store checks (size, sniff on
 * the sanitized display name) and the SAME sandboxed parse job the API uses. A run is correct iff its
 * canonical output matches the expectation exactly (multiset of (key, groupIndex, value); no tolerance).
 * Statistics come from computePassStats. No network and no database are used here.
 */
import { createHash } from 'node:crypto';

import { computePassStats, type EvalCaseResultDto, type EvalFailureCode, type EvalReportDto } from '@fr/shared';

import { displayNameFor } from '../imports/display-name.js';
import { PARSER_VERSION, PROVIDER_NAME, PROVIDER_VERSION } from '../imports/parse/types.js';
import { ParserBusyError, type ParseExecutor } from '../imports/sandbox/executor.js';
import { sniff } from '../imports/sniff.js';

import { digest, sortFields, type FieldTriple, type RunOutput } from './canonical.js';
import type { EvalCaseDef, LoadedSet } from './manifest.js';

/** Infrastructure failure: the tool aborts with exit 3 and records nothing. */
export class InfrastructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InfrastructureError';
  }
}

export interface RunnerOptions {
  k: number;
  executor: ParseExecutor;
  maxFileBytes: number;
  now: () => Date;
  gitSha: string | null;
}

/** Stage registry: step 5 registers `rules`. A manifest naming any other stage is a usage error. */
export const EVAL_STAGES: Readonly<Record<string, true>> = Object.freeze({ extraction: true });

export async function runOnce(bytes: Uint8Array, filename: string, opts: Pick<RunnerOptions, 'executor' | 'maxFileBytes'>): Promise<RunOutput> {
  if (bytes.byteLength > opts.maxFileBytes) return { rejected: 'too_large' };
  const displayName = displayNameFor(filename);
  const sniffed = sniff(bytes, displayName);
  if (!sniffed.ok) return { rejected: sniffed.reason };
  let outcome;
  try {
    outcome = await opts.executor.run({ bytes, filename: displayName, detectedType: sniffed.detectedType });
  } catch (e) {
    throw new InfrastructureError(e instanceof ParserBusyError ? 'parser busy' : 'executor failed');
  }
  if (!outcome.ok) return { rejected: outcome.reason };
  const fields: FieldTriple[] = outcome.result.fields.map((f) => [f.key, f.groupIndex ?? null, f.value ?? null]);
  return { docType: outcome.result.docType, fields };
}

/** null = correct; otherwise the failure code of this run (A7.2 mapping, checked in order). */
export function judge(expect: EvalCaseDef['expect'], out: RunOutput): EvalFailureCode | null {
  if (expect.outcome === 'rejected') {
    if (!('rejected' in out)) return 'not_rejected';
    return out.rejected === expect.reason ? null : 'wrong_reject_reason';
  }
  if ('rejected' in out) {
    if (out.rejected === 'parse_timeout') return 'timeout';
    if (out.rejected === 'parse_memory' || out.rejected === 'parse_failed') return 'infrastructure';
    return 'unexpected_reject';
  }
  if (out.docType !== expect.docType) return 'wrong_doc_type';
  const exp = sortFields(expect.fields.map((f) => [f.key, f.groupIndex, f.value] as FieldTriple));
  const got = sortFields(out.fields);
  const slot = (t: FieldTriple) => `${t[0]}\u0000${t[1] ?? ''}`;
  const count = (list: FieldTriple[]) => {
    const m = new Map<string, number>();
    for (const t of list) m.set(slot(t), (m.get(slot(t)) ?? 0) + 1);
    return m;
  };
  const ce = count(exp);
  const cg = count(got);
  for (const [s, n] of ce) if ((cg.get(s) ?? 0) < n) return 'missing_field';
  for (const [s, n] of cg) if ((ce.get(s) ?? 0) < n) return 'unexpected_field';
  return JSON.stringify(exp) === JSON.stringify(got) ? null : 'field_mismatch';
}

/** Linear-interpolated percentile (same definition as PostgreSQL percentile_cont). */
export function percentileCont(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = s[lo] ?? 0;
  const b = s[hi] ?? 0;
  return a + (b - a) * (pos - lo);
}

/** Median (mean of the two middle values for an even count). */
export function median(values: readonly number[]): number {
  return percentileCont(values, 0.5);
}

/** SHA-256 over the manifest bytes followed by each case file's bytes in manifest order. */
export function evalSetSha256(set: LoadedSet): string {
  const h = createHash('sha256');
  h.update(set.manifestBytes);
  for (const f of set.files) h.update(f);
  return h.digest('hex');
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

export async function runEval(set: LoadedSet, opts: RunnerOptions): Promise<EvalReportDto> {
  if (!EVAL_STAGES[set.manifest.stage]) throw new Error('unknown stage');
  const startedAt = opts.now();
  const outcomes: boolean[][] = [];
  const results: EvalCaseResultDto[] = [];
  const allDurations: number[] = [];
  for (const [i, c] of set.manifest.cases.entries()) {
    const bytes = new Uint8Array(set.files[i] ?? Buffer.alloc(0));
    const row: boolean[] = [];
    const digests = new Set<string>();
    const durations: number[] = [];
    let firstFailure: EvalFailureCode | null = null;
    for (let run = 0; run < opts.k; run += 1) {
      const t0 = process.hrtime.bigint();
      const out = await runOnce(bytes, c.filename, opts);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      durations.push(ms);
      allDurations.push(ms);
      digests.add(digest(out));
      const code = judge(c.expect, out);
      row.push(code === null);
      if (code !== null && firstFailure === null) firstFailure = code;
    }
    outcomes.push(row);
    const runsPassed = row.filter(Boolean).length;
    results.push({
      caseId: c.id,
      category: c.category,
      runsPassed,
      k: opts.k,
      passedAll: runsPassed === opts.k,
      distinctOutputs: digests.size,
      firstFailureCode: firstFailure,
      medianDurationMs: round6(median(durations)),
    });
  }
  const s = computePassStats(outcomes);
  const finishedAt = opts.now();
  results.sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0));
  return {
    basis: 'synthetic_fixtures',
    evalSetId: set.manifest.evalSetId,
    evalSetVersion: set.manifest.version,
    evalSetSha256: evalSetSha256(set),
    stage: 'extraction',
    k: opts.k,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    gitSha: opts.gitSha,
    providerName: PROVIDER_NAME,
    providerVersion: PROVIDER_VERSION,
    parserVersion: PARSER_VERSION,
    cases: s.cases,
    runsTotal: s.runsTotal,
    runsPassed: s.runsPassed,
    perRunPassRate: round6(s.perRunPassRate),
    passHatKCount: s.passHatKCount,
    passHatK: round6(s.passHatK),
    passAtLeastOneCount: s.passAtLeastOneCount,
    flakyCaseCount: s.flakyCaseCount,
    alwaysFailCount: s.alwaysFailCount,
    deterministicCases: results.filter((r) => r.distinctOutputs === 1).length,
    wilson95: { low: round6(s.wilson95.low), high: round6(s.wilson95.high) },
    passPowCurve: s.passPowCurve.map(round6),
    durationMs: { p50: round6(percentileCont(allDurations, 0.5)), p95: round6(percentileCont(allDurations, 0.95)) },
    results,
  };
}
