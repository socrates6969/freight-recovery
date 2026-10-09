/**
 * The ONLY writer of evaluation data (Q7 --record): one system transaction inserts the run, all case rows
 * and appends `eval.run_recorded` to the PLATFORM audit chain (actor null). Any error rolls everything back.
 */
import type { EvalReportDto } from '@fr/shared';

import { appendAudit } from '../audit/audit.js';
import { createDb } from '../db/client.js';
import { withSystemTx } from '../db/system.js';

export async function recordRun(databaseUrl: string, report: EvalReportDto): Promise<string> {
  const base = createDb(databaseUrl, { max: 2 });
  try {
    return await withSystemTx(
      base,
      async (tx) => {
        const run = await tx.evalRun.create({
          data: {
            evalSetId: report.evalSetId,
            evalSetVersion: report.evalSetVersion,
            evalSetSha256: report.evalSetSha256,
            stage: report.stage,
            k: report.k,
            startedAt: new Date(report.startedAt),
            finishedAt: new Date(report.finishedAt),
            gitSha: report.gitSha,
            providerName: report.providerName,
            providerVersion: report.providerVersion,
            parserVersion: report.parserVersion,
            caseCount: report.cases,
            runsTotal: report.runsTotal,
            runsPassed: report.runsPassed,
            passHatKCount: report.passHatKCount,
            passAtLeastOneCount: report.passAtLeastOneCount,
            flakyCaseCount: report.flakyCaseCount,
            alwaysFailCount: report.alwaysFailCount,
            deterministicCases: report.deterministicCases,
            wilsonLow: report.wilson95.low.toFixed(6),
            wilsonHigh: report.wilson95.high.toFixed(6),
            passPowCurve: report.passPowCurve,
            runMsP50: report.durationMs.p50,
            runMsP95: report.durationMs.p95,
          },
          select: { id: true },
        });
        await tx.evalCaseResult.createMany({
          data: report.results.map((r) => ({
            runId: run.id,
            caseId: r.caseId,
            category: r.category,
            runsPassed: r.runsPassed,
            k: r.k,
            passedAll: r.passedAll,
            distinctOutputs: r.distinctOutputs,
            firstFailureCode: r.firstFailureCode,
            medianDurationMs: r.medianDurationMs,
          })),
        });
        await appendAudit(tx, {
          tenantId: null,
          action: 'eval.run_recorded',
          actorId: null,
          actorRole: null,
          targetType: 'eval_run',
          targetId: run.id,
          metadata: { runId: run.id, evalSetId: report.evalSetId, k: report.k, cases: report.cases, passHatKCount: report.passHatKCount },
        });
        return run.id;
      },
      { timeoutMs: 60_000 },
    );
  } finally {
    await base.$disconnect();
  }
}
