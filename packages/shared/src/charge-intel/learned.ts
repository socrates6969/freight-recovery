/**
 * Learned layer of the analysis (REQ-20261011-charge-intelligence, Part C C4; RD7-RD9). Runs AFTER the
 * unchanged step-5 rules and only looks at unique invoice lines the keyword rules call `other`:
 * - a line whose nearest labelled example is an accessorial, on a bundle with a rate confirmation, not
 *   authorized there and not equal to the contracted linehaul/fuel amount -> one review-only
 *   `LRN-ACCESSORIAL-REVIEW` finding (confidence 0.5, always needs human review, pending total only);
 * - a line whose nearest labelled example is detention ("look-alike") -> every DET-UNBILLED /
 *   DET-UNDERBILLED finding switches to needs-human-review with one extra calculation step per look-alike.
 * Nothing else changes; with no LRN finding and no look-alike the step-5 result is returned unchanged.
 * Pure and deterministic. The step-5 modules are imported, never modified.
 */
import type { ExtractedBundle } from '../extraction.js';
import { PACKET_DISCLAIMER, renderPacketMarkdown } from '../analysis/markdown.js';
import { applyRulesTraced, type TracedResult } from '../analysis/engine.js';
import { packetLoadNumber, utcDate, type Evidence } from '../analysis/evidence.js';
import { classifyLine, dedupe, type CheckedLine, type FindingTrace } from '../analysis/invoice-checks.js';
import { buildDemandLetter } from '../analysis/letter.js';
import { Dec, compare, gt, q2, sumDec } from '../analysis/py-decimal.js';
import { normText, pyReprList } from '../analysis/py-text.js';
import { AnalysisInputError, type AnalysisPerspective, type AnalysisSettings, type EvidenceDoc, type RecoveryResult, type RuleFinding, type RuleId } from '../analysis/types.js';
import type { ChargeSuggestion, NearestExample } from '../charge-intel-dto.js';
import { plain } from '../text-sanitize.js';

import { formatSimilarity, type ChargeClassifier } from './classifier.js';
import type { LearnedRuleId } from './constants.js';

/** Confidence of a learned finding (fixed; always needs human review). */
export const LEARNED_CONFIDENCE = 0.5;
/** At most this many influencing label ids are reported (audit sanitizer keeps 50 array items). */
export const LEARNED_LABEL_IDS_MAX = 50;
/** Cap of a nearest-example text quoted in findings. */
const EXAMPLE_TEXT_LIMIT = 200;
const REVIEW_FLAG_RULES: ReadonlySet<string> = new Set(['DET-UNBILLED', 'DET-UNDERBILLED']);

/** A finding of the combined result: a step-5 rule finding or a learned one. */
export type AnalysisFinding = Omit<RuleFinding, 'rule_id'> & { rule_id: RuleId | LearnedRuleId };

/** RecoveryResult whose findings may include learned findings. */
export type LearnedRecoveryResult = Omit<RecoveryResult, 'findings' | 'ignored_findings'> & {
  findings: AnalysisFinding[];
  ignored_findings: AnalysisFinding[];
};

export type LearnedEvidence = Omit<Evidence, 'result'> & { result: LearnedRecoveryResult };

export interface LearnedOutcome {
  result: LearnedRecoveryResult;
  /** Traces aligned with `result.findings` (step-5 traces, then one per LRN finding). */
  traces: FindingTrace[];
  /** Per final own finding: the look-alike line indices of a flagged DET finding, else []. */
  extraLines: number[][];
  learnedFindingsCount: number;
  reviewFlagsCount: number;
  /**
   * Fix round 1 (S3): ids of tenant labels that were the nearest example of an LRN finding or a detention
   * look-alike in this analysis (distinct, line order, at most LEARNED_LABEL_IDS_MAX).
   */
  labelIds: string[];
}

function originText(n: NearestExample): string {
  return n.origin === 'seed' ? `public tariff example, ${n.sourceLabel}` : "your team's label";
}

function checkString(v: unknown): string {
  if (typeof v !== 'string') throw new AnalysisInputError('not a string');
  return v;
}

const optDec = (v: string | null | undefined): Dec | null => (v === null || v === undefined ? null : Dec.parse(v));

/** The step-5 result unchanged (no learned effect). */
function unchanged(traced: TracedResult): LearnedOutcome {
  return { result: traced.result, traces: traced.traces, extraLines: traced.traces.map(() => []), learnedFindingsCount: 0, reviewFlagsCount: 0, labelIds: [] };
}

/**
 * Apply C4.2-C4.5 to a step-5 traced result. `classify` null (flag off / no classifier) -> unchanged.
 * The bundle has already been validated by the engine; amounts are re-parsed with the same parser.
 */
export function applyLearning(
  bundle: ExtractedBundle,
  traced: TracedResult,
  persp: AnalysisPerspective,
  classify: ((description: string) => ChargeSuggestion) | null,
): LearnedOutcome {
  if (classify === null) return unchanged(traced);
  const inv = bundle.invoice;
  if (inv === null) return unchanged(traced);
  const lines: CheckedLine[] = inv.lines.map((ln, index) => ({ index, description: checkString(ln.description), amount: Dec.parse(ln.amount) }));
  const rc = bundle.rate_confirmation;
  const linehaul = rc === null ? null : optDec(rc.linehaul_rate);
  const fuel = rc === null ? null : optDec(rc.fuel_surcharge);
  const authorized = rc === null ? [] : rc.authorized_accessorials.map((a) => normText(checkString(a))).filter((a) => a !== '');
  const listed = rc !== null && rc.authorized_accessorials.length > 0 ? pyReprList(rc.authorized_accessorials) : 'none';
  const zero = Dec.fromInt(0);

  const lrn: { finding: AnalysisFinding; trace: FindingTrace }[] = [];
  const lookAlikes: { line: CheckedLine; nearest: NearestExample; similarity: number }[] = [];
  const labelIds: string[] = [];
  const noteLabel = (id: string | null): void => {
    if (id !== null && !labelIds.includes(id) && labelIds.length < LEARNED_LABEL_IDS_MAX) labelIds.push(id);
  };
  for (const ln of dedupe(lines).unique) {
    if (classifyLine(ln.description) !== 'other' || !gt(ln.amount, zero)) continue;
    const s = classify(ln.description);
    if (s.nearest === null || s.category === null) continue;
    const amt = ln.amount.toString();
    const ex = plain(s.nearest.text, EXAMPLE_TEXT_LIMIT);
    const origin = originText(s.nearest);
    const sim = formatSimilarity(s.similarity);
    if (s.category === 'accessorial' && rc !== null) {
      const d = normText(ln.description);
      const isAuthorized = d !== '' && authorized.some((a) => d.includes(a) || a.includes(d));
      const isContracted = (linehaul !== null && compare(ln.amount, linehaul) === 0) || (fuel !== null && compare(ln.amount, fuel) === 0);
      if (!isAuthorized && !isContracted) {
        noteLabel(s.nearest.labelId);
        lrn.push({
          finding: {
            rule_id: 'LRN-ACCESSORIAL-REVIEW',
            title: 'Possible unauthorized accessorial (suggestion)',
            direction: 'overcharge',
            amount: q2(ln.amount).toString(),
            explanation: `'${ln.description}' ($${amt}) is not recognised by the fixed rules. Its nearest labelled example is '${ex}' (${origin}), labelled accessorial, and it is not listed as authorized on the rate confirmation. Suggestion only - verify before disputing.`,
            calculation: [
              `Nearest labelled example: '${ex}' (${origin}) = accessorial, similarity ${sim}.`,
              'A suggestion needs similarity of at least 0.30.',
              `Authorized accessorials: ${listed}.`,
              `Charged: '${ln.description}' = $${amt}.`,
            ],
            confidence: LEARNED_CONFIDENCE,
            needs_human_review: true,
          },
          trace: { lines: [ln.index], total: false, detention: null },
        });
      }
    } else if (s.category === 'detention') {
      noteLabel(s.nearest.labelId);
      lookAlikes.push({ line: ln, nearest: s.nearest, similarity: s.similarity });
    }
  }
  if (lrn.length === 0 && lookAlikes.length === 0) return unchanged(traced);

  const steps = lookAlikes.map(
    (l) =>
      `Possible detention billed under another name: '${l.line.description}' = $${l.line.amount.toString()} (nearest labelled example '${plain(l.nearest.text, EXAMPLE_TEXT_LIMIT)}', ${originText(l.nearest)}, similarity ${formatSimilarity(l.similarity)}). Confirm before claiming.`,
  );
  const lookAlikeLines = lookAlikes.map((l) => l.line.index);
  const flag = (f: RuleFinding): { finding: AnalysisFinding; flagged: boolean } =>
    lookAlikes.length > 0 && REVIEW_FLAG_RULES.has(f.rule_id) ? { finding: { ...f, needs_human_review: true, calculation: [...f.calculation, ...steps] }, flagged: true } : { finding: f, flagged: false };

  const ownRule = traced.result.findings.map(flag);
  const ignoredRule = traced.result.ignored_findings.map(flag);
  const mineLrn = persp === 'shipper' ? lrn : [];
  const otherLrn = persp === 'shipper' ? [] : lrn;
  const findings = [...ownRule.map((x) => x.finding), ...mineLrn.map((x) => x.finding)];
  const amountOf = (f: AnalysisFinding): Dec => Dec.parse(f.amount);
  const recoverable = q2(sumDec(findings.filter((f) => !f.needs_human_review).map(amountOf)));
  const pending = q2(sumDec(findings.filter((f) => f.needs_human_review).map(amountOf)));
  return {
    result: {
      perspective: traced.result.perspective,
      findings,
      recoverable_total: recoverable.toString(),
      pending_review_total: pending.toString(),
      ignored_findings: [...ignoredRule.map((x) => x.finding), ...otherLrn.map((x) => x.finding)],
    },
    traces: [...traced.traces, ...mineLrn.map((x) => x.trace)],
    extraLines: [...ownRule.map((x) => (x.flagged ? [...lookAlikeLines] : [])), ...mineLrn.map(() => [])],
    learnedFindingsCount: mineLrn.length,
    reviewFlagsCount: ownRule.filter((x) => x.flagged).length,
    labelIds,
  };
}

/**
 * The renderers (`buildDemandLetter`, `renderPacketMarkdown`) only print `rule_id` (through `plain`) and
 * never branch on it, so a result with learned rule ids renders exactly like a step-5 result.
 */
function asRenderable(result: LearnedRecoveryResult): RecoveryResult {
  return result as unknown as RecoveryResult;
}

/**
 * `buildEvidenceTraced` with the learned layer applied before the letter and Markdown are built (C1, C4).
 * With `classifier === null` the output equals `buildEvidenceTraced(...)` exactly.
 */
export function buildEvidenceLearned(
  docs: readonly EvidenceDoc[],
  bundle: ExtractedBundle,
  perspective: AnalysisPerspective,
  settings: AnalysisSettings,
  now: Date,
  classifier: ChargeClassifier | null,
): { evidence: LearnedEvidence } & Omit<LearnedOutcome, 'result'> {
  const traced = applyRulesTraced(bundle, perspective, settings);
  const learned = applyLearning(bundle, traced, traced.result.perspective, classifier === null ? null : (d) => classifier.classify(d));
  const result = learned.result;
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
    traces: learned.traces,
    extraLines: learned.extraLines,
    learnedFindingsCount: learned.learnedFindingsCount,
    reviewFlagsCount: learned.reviewFlagsCount,
    labelIds: learned.labelIds,
  };
}
