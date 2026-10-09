/**
 * R65/R66: read-only views of recorded evaluation runs (Q5.4). The evaluation tool is the only writer.
 * Rates are rounded to 6 decimals; no document content, extracted value or file name exists in these
 * tables.
 */
import { EVAL_FAILURE_CODES, type EvalCaseResultDto, type EvalFailureCode, type EvalRunDetailDto, type EvalRunSummaryDto } from '@fr/shared';

import { isUuid } from '../db/errors.js';
import type { SystemTx } from '../db/system.js';

export function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

const RUN_SELECT = {
  id: true,
  evalSetId: true,
  evalSetVersion: true,
  evalSetSha256: true,
  stage: true,
  k: true,
  startedAt: true,
  finishedAt: true,
  gitSha: true,
  providerName: true,
  providerVersion: true,
  parserVersion: true,
  caseCount: true,
  runsTotal: true,
  runsPassed: true,
  passHatKCount: true,
  passAtLeastOneCount: true,
  flakyCaseCount: true,
  alwaysFailCount: true,
  deterministicCases: true,
  wilsonLow: true,
  wilsonHigh: true,
  passPowCurve: true,
  runMsP50: true,
  runMsP95: true,
} as const;

interface RunRow {
  id: string;
  evalSetId: string;
  evalSetVersion: string;
  evalSetSha256: string;
  stage: string;
  k: number;
  startedAt: Date;
  finishedAt: Date;
  gitSha: string | null;
  providerName: string;
  providerVersion: string;
  parserVersion: string;
  caseCount: number;
  runsTotal: number;
  runsPassed: number;
  passHatKCount: number;
  passAtLeastOneCount: number;
  flakyCaseCount: number;
  alwaysFailCount: number;
  deterministicCases: number;
  wilsonLow: { toString(): string };
  wilsonHigh: { toString(): string };
  passPowCurve: number[];
  runMsP50: number;
  runMsP95: number;
}

function toSummary(r: RunRow): EvalRunSummaryDto {
  return {
    id: r.id,
    basis: 'synthetic_fixtures',
    evalSetId: r.evalSetId,
    evalSetVersion: r.evalSetVersion,
    evalSetSha256: r.evalSetSha256,
    stage: 'extraction',
    k: r.k,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt.toISOString(),
    gitSha: r.gitSha,
    providerName: r.providerName,
    providerVersion: r.providerVersion,
    parserVersion: r.parserVersion,
    cases: r.caseCount,
    runsTotal: r.runsTotal,
    runsPassed: r.runsPassed,
    perRunPassRate: round6(r.runsPassed / r.runsTotal),
    passHatKCount: r.passHatKCount,
    passHatK: round6(r.passHatKCount / r.caseCount),
    passAtLeastOneCount: r.passAtLeastOneCount,
    flakyCaseCount: r.flakyCaseCount,
    alwaysFailCount: r.alwaysFailCount,
    deterministicCases: r.deterministicCases,
    wilson95: { low: round6(Number(r.wilsonLow.toString())), high: round6(Number(r.wilsonHigh.toString())) },
    passPowCurve: r.passPowCurve.map(round6),
    durationMs: { p50: round6(r.runMsP50), p95: round6(r.runMsP95) },
  };
}

function failureCode(v: string | null): EvalFailureCode | null {
  return v !== null && (EVAL_FAILURE_CODES as readonly string[]).includes(v) ? (v as EvalFailureCode) : null;
}

export async function listEvalRuns(tx: SystemTx, limit: number): Promise<EvalRunSummaryDto[]> {
  const rows = await tx.evalRun.findMany({ select: RUN_SELECT, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit });
  return rows.map((r) => toSummary(r as RunRow));
}

/** null when the id is not a UUID or no such run exists (both answered 404). */
export async function getEvalRun(tx: SystemTx, id: string): Promise<EvalRunDetailDto | null> {
  if (!isUuid(id)) return null;
  const row = await tx.evalRun.findUnique({ where: { id }, select: { ...RUN_SELECT, results: { orderBy: { caseId: 'asc' } } } });
  if (!row) return null;
  const results: EvalCaseResultDto[] = row.results.map((c) => ({
    caseId: c.caseId,
    category: c.category,
    runsPassed: c.runsPassed,
    k: c.k,
    passedAll: c.passedAll,
    distinctOutputs: c.distinctOutputs,
    firstFailureCode: failureCode(c.firstFailureCode),
    medianDurationMs: round6(c.medianDurationMs),
  }));
  return { ...toSummary(row as RunRow), results };
}
