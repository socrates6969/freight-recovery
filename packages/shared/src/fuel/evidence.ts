/**
 * Evidence with the fuel check (Part C F5.4-F5.5, spec A3). Runs the step-5 rules and the step-6 learned
 * layer exactly as `buildEvidenceLearned` does (`applyRulesTraced` + `applyLearning`), then places the
 * fuel finding (if any) and renders the letter and Markdown from the final result. Without a finding the
 * evidence equals `buildEvidenceLearned(...)` exactly. The step-5 and step-6 modules are not modified.
 */
import type { ExtractedBundle } from '../extraction.js';
import { applyRulesTraced } from '../analysis/engine.js';
import { packetLoadNumber, utcDate, type Evidence } from '../analysis/evidence.js';
import type { FindingTrace } from '../analysis/invoice-checks.js';
import { buildDemandLetter } from '../analysis/letter.js';
import { PACKET_DISCLAIMER, renderPacketMarkdown } from '../analysis/markdown.js';
import { Dec, q2, sumDec } from '../analysis/py-decimal.js';
import type { AnalysisPerspective, AnalysisSettings, EvidenceDoc, RecoveryResult } from '../analysis/types.js';
import type { ChargeClassifier } from '../charge-intel/classifier.js';
import { applyLearning, type LearnedOutcome } from '../charge-intel/learned.js';
import type { FuelCheckResultDto } from '../fuel-dto.js';

import { checkFuel, type FuelAnalysisFinding, type FuelCheckInput } from './check.js';

/** RecoveryResult whose findings may include learned and fuel findings. */
export type FuelRecoveryResult = Omit<RecoveryResult, 'findings' | 'ignored_findings'> & {
  findings: FuelAnalysisFinding[];
  ignored_findings: FuelAnalysisFinding[];
};

export type FuelEvidence = Omit<Evidence, 'result'> & { result: FuelRecoveryResult };

export type FuelEvidenceOutcome = { evidence: FuelEvidence } & Omit<LearnedOutcome, 'result'> & {
    fuel: FuelCheckResultDto;
    /** Own-perspective FSC findings stored (0 or 1). */
    fuelFindingsCount: number;
  };

/**
 * The renderers (`buildDemandLetter`, `renderPacketMarkdown`) only print `rule_id` (through `plain`) and
 * never branch on it, so a result with learned or fuel rule ids renders exactly like a step-5 result
 * (the same cast as the step-6 `asRenderable`).
 */
function asRenderable(result: FuelRecoveryResult): RecoveryResult {
  return result as unknown as RecoveryResult;
}

/**
 * `buildEvidenceLearned` plus the fuel check (F5). `input === null` (no fuel inputs) gives exactly the
 * `buildEvidenceLearned(...)` evidence with `fuel.status = 'no_inputs'`.
 */
export function buildEvidenceFuel(
  docs: readonly EvidenceDoc[],
  bundle: ExtractedBundle,
  perspective: AnalysisPerspective,
  settings: AnalysisSettings,
  now: Date,
  classifier: ChargeClassifier | null,
  input: FuelCheckInput | null,
): FuelEvidenceOutcome {
  const traced = applyRulesTraced(bundle, perspective, settings);
  const classify = classifier === null ? null : (d: string) => classifier.classify(d);
  const learned = applyLearning(bundle, traced, traced.result.perspective, classify);
  const fuel = checkFuel(bundle, input, classify, settings);
  const persp = learned.result.perspective;

  let result: FuelRecoveryResult = learned.result;
  let traces: FindingTrace[] = learned.traces;
  let extraLines: number[][] = learned.extraLines;
  let fuelFindingsCount = 0;
  if (fuel.finding !== null) {
    const mine = (fuel.finding.direction === 'overcharge') === (persp === 'shipper');
    if (mine) {
      const findings = [...learned.result.findings, fuel.finding];
      const amountOf = (f: FuelAnalysisFinding): Dec => Dec.parse(f.amount);
      result = {
        perspective: persp,
        findings,
        recoverable_total: q2(sumDec(findings.filter((f) => !f.needs_human_review).map(amountOf))).toString(),
        pending_review_total: q2(sumDec(findings.filter((f) => f.needs_human_review).map(amountOf))).toString(),
        ignored_findings: [...learned.result.ignored_findings],
      };
      traces = [...learned.traces, { lines: [...fuel.traceLines], total: false, detention: null }];
      extraLines = [...learned.extraLines, []];
      fuelFindingsCount = 1;
    } else {
      result = { ...learned.result, ignored_findings: [...learned.result.ignored_findings, fuel.finding] };
    }
  }

  const load = packetLoadNumber(bundle);
  const letter = buildDemandLetter(bundle, asRenderable(result), utcDate(now), settings.disputeWindowDays);
  return {
    evidence: {
      load_number: load,
      perspective: result.perspective,
      generated_at: now.toISOString(),
      documents: [...docs],
      result,
      demand_letter: letter,
      markdown: renderPacketMarkdown(load, result.perspective, docs, bundle, asRenderable(result), letter),
      disclaimer: PACKET_DISCLAIMER,
    },
    traces,
    extraLines,
    learnedFindingsCount: learned.learnedFindingsCount,
    reviewFlagsCount: learned.reviewFlagsCount,
    labelIds: learned.labelIds,
    fuel: fuel.result,
    fuelFindingsCount,
  };
}
