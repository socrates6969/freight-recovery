/**
 * Leave-one-carrier-out evaluation of the charge classifier over the seed set (Part C C11). For each
 * seed entry the candidates are the seed entries of the OTHER carriers, in seed order; nearest example
 * and acceptance exactly as in classification. A regression check on this seed set, not an accuracy
 * measure on invoices (CHARGE_EVAL_NOTE). Pure and deterministic.
 */
import { classifyLine } from '../analysis/invoice-checks.js';
import type { ChargeEvalReportDto } from '../charge-intel-dto.js';

import { accepts, rankNearest, rawSimilarity, roundSimilarity, seedExamples } from './classifier.js';
import { CHARGE_CLASSIFIER_VERSION, SEED_VERSION, SUGGESTION_THRESHOLD, type ChargeCategory } from './constants.js';
import { CHARGE_EVAL_NOTE } from './copy.js';
import { SEED_SOURCES, SEED_V1, type SeedExample, type SeedSourceId } from './seed-v1.js';

type EvalCategory = 'detention' | 'linehaul' | 'fuel' | 'accessorial';

/** The report shape (validated with the shared `ChargeEvalReport` schema by the CLI). */
export type ChargeEvalReportData = ChargeEvalReportDto;

interface Outcome {
  predicted: ChargeCategory | null;
  suggested: boolean;
  similarity: number;
  nearestText: string | null;
  nearestSource: string | null;
}

function byCat<T>(make: () => T): Record<EvalCategory, T> {
  return { detention: make(), linehaul: make(), fuel: make(), accessorial: make() };
}

/** Run the leave-one-carrier-out evaluation over `seed` (default SEED_V1) with no tenant labels. */
export function evaluateLeaveOneCarrierOut(seed: readonly SeedExample[] = SEED_V1): ChargeEvalReportData {
  const ex = seedExamples(seed);
  const outcome = (i: number, distinct: boolean): Outcome => {
    const q = ex[i];
    const entry = seed[i];
    if (!q || !entry) throw new RangeError('seed index out of range');
    const candidates = ex.filter((e, j) => seed[j]?.source !== entry.source && (!distinct || e.normalized !== q.normalized));
    const best = rankNearest(q.features, candidates);
    if (best === null) return { predicted: null, suggested: false, similarity: 0, nearestText: null, nearestSource: null };
    return {
      predicted: best.example.nearest.category,
      suggested: accepts(best.dot, q.norm2, best.example.norm2),
      similarity: roundSimilarity(rawSimilarity(best.dot, q.norm2, best.example.norm2)),
      nearestText: best.example.nearest.text,
      nearestSource: best.example.nearest.source,
    };
  };

  const top1 = { correct: 0, total: 0, byCategory: byCat(() => ({ correct: 0, total: 0 })) };
  const atThreshold = { suggested: 0, correct: 0, wrong: 0, abstained: 0, byCategory: byCat(() => ({ recognised: 0, abstained: 0, wrong: 0, total: 0 })) };
  const distinctName = { top1Correct: 0, suggested: 0, correct: 0, wrong: 0, abstained: 0, accessorialRecognised: 0 };
  const keywordBaseline = { correct: 0, accessorialRecognised: 0 };
  let pipelineAccessorialCovered = 0;
  const sources = Object.keys(SEED_SOURCES) as SeedSourceId[];
  const per = new Map(
    sources.map((s) => [
      s,
      { source: s, label: SEED_SOURCES[s].label, examples: 0, top1Correct: 0, accessorialTotal: 0, accessorialTop1: 0, accessorialRecognised: 0, abstained: 0, wrongSuggested: 0 },
    ]),
  );
  const errors: ChargeEvalReportData['errors'] = [];
  const carriers = new Set<string>();

  seed.forEach((entry, i) => {
    carriers.add(entry.source);
    const o = outcome(i, false);
    const d = outcome(i, true);
    const label = entry.label;
    const correct = o.predicted === label;
    const recognised = o.suggested && correct;
    const keyword = classifyLine(entry.text);

    top1.total += 1;
    top1.byCategory[label].total += 1;
    if (correct) {
      top1.correct += 1;
      top1.byCategory[label].correct += 1;
    }
    const cat = atThreshold.byCategory[label];
    cat.total += 1;
    if (o.suggested) {
      atThreshold.suggested += 1;
      if (correct) {
        atThreshold.correct += 1;
        cat.recognised += 1;
      } else {
        atThreshold.wrong += 1;
        cat.wrong += 1;
      }
    } else {
      atThreshold.abstained += 1;
      cat.abstained += 1;
    }

    const dCorrect = d.predicted === label;
    if (dCorrect) distinctName.top1Correct += 1;
    if (d.suggested) {
      distinctName.suggested += 1;
      if (dCorrect) distinctName.correct += 1;
      else distinctName.wrong += 1;
      if (dCorrect && label === 'accessorial') distinctName.accessorialRecognised += 1;
    } else {
      distinctName.abstained += 1;
    }

    if (keyword === label) keywordBaseline.correct += 1;
    if (label === 'accessorial' && keyword === 'accessorial') keywordBaseline.accessorialRecognised += 1;
    if (label === 'accessorial' && (keyword === 'accessorial' || (keyword === 'other' && o.suggested && o.predicted === 'accessorial'))) pipelineAccessorialCovered += 1;

    const pc = per.get(entry.source);
    if (pc) {
      pc.examples += 1;
      if (correct) pc.top1Correct += 1;
      if (label === 'accessorial') {
        pc.accessorialTotal += 1;
        if (correct) pc.accessorialTop1 += 1;
        if (recognised) pc.accessorialRecognised += 1;
      }
      if (!o.suggested) pc.abstained += 1;
      if (o.suggested && !correct) pc.wrongSuggested += 1;
    }

    if (!correct) {
      errors.push({
        text: entry.text,
        source: entry.source,
        expected: label,
        predicted: o.predicted,
        similarity: o.similarity,
        nearestText: o.nearestText,
        nearestSource: o.nearestSource,
        suggested: o.suggested,
      });
    }
  });

  return {
    evaluation: 'leave-one-carrier-out',
    classifierVersion: CHARGE_CLASSIFIER_VERSION,
    seedVersion: SEED_VERSION,
    threshold: SUGGESTION_THRESHOLD,
    note: CHARGE_EVAL_NOTE,
    examples: seed.length,
    carriers: carriers.size,
    top1,
    atThreshold,
    distinctName,
    keywordBaseline,
    pipelineAccessorialCovered,
    perCarrier: sources.map((s) => per.get(s)).filter((x) => x !== undefined),
    errors,
  };
}
