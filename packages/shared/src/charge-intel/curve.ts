/**
 * Learning curve of the charge classifier `charge-knn-v1` over the seed set (scoup Labs, "Recall"): how
 * recognition grows with the number of labelled public tariff names. Leave-one-source-out: every seed name
 * is classified from the names of the OTHER sources only, (a) with that candidate pool subsampled to a
 * fraction (mulberry32 PRNG, fixed seed, the same seeding and sampling order as the hive experiment
 * e1_charges.ts of 2026-10-19, so its numbers reproduce) and (b) restricted to every subset of k other
 * sources. Distinct-name rule: a candidate whose normalized text equals the query is excluded, so an
 * identical name at another source never counts as recognition. Ranking and the exact threshold are those
 * of classification. A research and regression check on tariff charge names, not an accuracy measure on
 * invoices (CHARGE_EVAL_NOTE). Pure and deterministic; no I/O.
 */
import { classifyLine } from '../analysis/invoice-checks.js';

import { accepts, rankNearest, seedExamples, type ChargeExample } from './classifier.js';
import { CHARGE_CLASSIFIER_VERSION, SEED_VERSION, SUGGESTION_THRESHOLD, type ChargeCategory } from './constants.js';
import { CHARGE_EVAL_NOTE } from './copy.js';
import { SEED_V1 } from './seed-v1.js';
import { SEED_V2, SEED_V2_SOURCES, type SeedExampleV2, type SeedSourceIdV2 } from './seed-v2.js';

/** PRNG seed of the subsampling (the date of the first measurement). */
export const CURVE_RNG_SEED = 20261019;
/** Random subsamples per fraction below 100 %. */
export const CURVE_RESAMPLES = 50;
/** Fractions of the other sources' names used as candidates. */
export const CURVE_FRACTIONS: readonly number[] = Object.freeze([0.1, 0.25, 0.5, 0.75, 1]);

type EvalCategory = Exclude<ChargeCategory, 'other'>;
const CATEGORIES: readonly EvalCategory[] = Object.freeze(['detention', 'linehaul', 'fuel', 'accessorial']);

/** Percent over the resamples: mean and the 2.5 / 97.5 percentiles (equal to the mean for one resample). */
export interface CurveStat {
  mean: number;
  lo: number;
  hi: number;
}

export interface CurveCategoryPoint {
  total: number;
  /** Mean recognition over the resamples, percent of the category's names. */
  recognition: number;
  wrong: number;
}

export interface CurveFractionPoint {
  fraction: number;
  resamples: number;
  /** Mean number of candidate names per held-out source. */
  trainNamesMean: number;
  recognition: CurveStat;
  wrong: CurveStat;
  abstain: CurveStat;
  top1: CurveStat;
  accessorialRecognition: CurveStat;
  byCategory: Record<EvalCategory, CurveCategoryPoint>;
}

export interface CurveSourceCountPoint {
  otherSources: number;
  /** Subsets of other sources averaged per held-out source. */
  subsets: number;
  trainNamesMean: number;
  recognition: number;
  wrong: number;
  accessorialRecognition: number;
}

/** Held-out detail of one source at 100 % of the other sources' names. */
export interface CurveSourceDetail {
  source: string;
  label: string;
  examples: number;
  recognised: number;
  wrong: number;
  abstained: number;
}

export interface CurveBaseline {
  recognition: number;
  wrong: number;
  accessorialRecognition: number;
}

export interface CurveReport {
  evaluation: 'learning-curve';
  classifierVersion: string;
  seedVersion: string;
  /** Which seed set the curve is over: `v1` (the 175 names of 6 carriers) or `v2` (the shipped seed). */
  seed: 'v1' | 'v2';
  threshold: number;
  note: string;
  rngSeed: number;
  resamples: number;
  examples: number;
  sources: number;
  distinctName: true;
  baselines: { keyword: CurveBaseline; majority: CurveBaseline };
  byFraction: CurveFractionPoint[];
  bySourceCount: CurveSourceCountPoint[];
  perSource: CurveSourceDetail[];
  /** Seed v2 only: the 175 v1 names held out with every other v2 source as candidates (the seed-v2 gate). */
  v1HeldOut: { examples: number; recognised: number; wrong: number; abstained: number } | null;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(a: readonly number[], rnd: () => number): number[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    const x = b[i];
    const y = b[j];
    if (x !== undefined && y !== undefined) {
      b[i] = y;
      b[j] = x;
    }
  }
  return b;
}

const sample = (pool: readonly number[], k: number, rnd: () => number): number[] => shuffle(pool, rnd).slice(0, k).sort((x, y) => x - y);

const pct = (x: number, n: number): number => (n === 0 ? 0 : +((100 * x) / n).toFixed(2));

interface Outcome {
  predicted: ChargeCategory | null;
  suggested: boolean;
}

interface Agg {
  recognised: number;
  wrong: number;
  abstained: number;
  top1: number;
  accRec: number;
  accTotal: number;
  total: number;
  byCategory: Record<EvalCategory, { recognised: number; wrong: number; total: number }>;
}

const zero = (): Agg => ({
  recognised: 0,
  wrong: 0,
  abstained: 0,
  top1: 0,
  accRec: 0,
  accTotal: 0,
  total: 0,
  byCategory: { detention: { recognised: 0, wrong: 0, total: 0 }, linehaul: { recognised: 0, wrong: 0, total: 0 }, fuel: { recognised: 0, wrong: 0, total: 0 }, accessorial: { recognised: 0, wrong: 0, total: 0 } },
});

function add(a: Agg, label: EvalCategory, o: Outcome, w = 1): void {
  const ok = o.predicted === label;
  const c = a.byCategory[label];
  a.total += w;
  c.total += w;
  if (ok) a.top1 += w;
  if (o.suggested && ok) {
    a.recognised += w;
    c.recognised += w;
  } else if (o.suggested) {
    a.wrong += w;
    c.wrong += w;
  } else a.abstained += w;
  if (label === 'accessorial') {
    a.accTotal += w;
    if (o.suggested && ok) a.accRec += w;
  }
}

function stat(values: number[]): CurveStat {
  const v = [...values].sort((x, y) => x - y);
  const n = v.length;
  const mean = v.reduce((s, x) => s + x, 0) / n;
  return { mean: +mean.toFixed(2), lo: +(v[Math.floor(0.025 * (n - 1))] ?? 0).toFixed(2), hi: +(v[Math.ceil(0.975 * (n - 1))] ?? 0).toFixed(2) };
}

function summarize(runs: readonly Agg[]): Omit<CurveFractionPoint, 'fraction' | 'resamples' | 'trainNamesMean'> {
  const over = (f: (r: Agg) => number): CurveStat => stat(runs.map(f));
  const byCategory = {} as Record<EvalCategory, CurveCategoryPoint>;
  for (const c of CATEGORIES) {
    const total = runs[0]?.byCategory[c].total ?? 0;
    const mean = (f: (r: Agg) => number): number => +(runs.reduce((s, r) => s + f(r), 0) / runs.length).toFixed(2);
    byCategory[c] = { total, recognition: mean((r) => (100 * r.byCategory[c].recognised) / Math.max(1, total)), wrong: mean((r) => (100 * r.byCategory[c].wrong) / Math.max(1, total)) };
  }
  return {
    recognition: over((r) => (100 * r.recognised) / r.total),
    wrong: over((r) => (100 * r.wrong) / r.total),
    abstain: over((r) => (100 * r.abstained) / r.total),
    top1: over((r) => (100 * r.top1) / r.total),
    accessorialRecognition: over((r) => (100 * r.accRec) / r.accTotal),
    byCategory,
  };
}

function subsets<T>(a: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (a.length < k) return [];
  const [h, ...t] = a;
  if (h === undefined) return [];
  return [...subsets(t, k - 1).map((s) => [h, ...s]), ...subsets(t, k)];
}

/**
 * The learning curve over `seed` (`v2` = the shipped SEED_V2, `v1` = SEED_V1). `resamples` subsamples per
 * fraction below 100 % (default CURVE_RESAMPLES; the first measurement used 50).
 */
export function learningCurve(seed: 'v1' | 'v2' = 'v2', resamples: number = CURVE_RESAMPLES): CurveReport {
  if (!Number.isInteger(resamples) || resamples < 1) throw new RangeError('resamples must be a positive integer');
  const entries: readonly SeedExampleV2[] = seed === 'v1' ? SEED_V1 : SEED_V2;
  const ex: readonly (ChargeExample & { normalized: string })[] = seedExamples(entries);
  const n = entries.length;
  const label = (i: number): EvalCategory => entries[i]?.label ?? 'accessorial';
  const src = (i: number): string => entries[i]?.source ?? '';
  const sources: SeedSourceIdV2[] = [...new Set(entries.map((s) => s.source))];
  const all = entries.map((_, i) => i);
  const bySource = new Map(sources.map((c) => [c, all.filter((i) => src(i) === c)]));
  const others = (c: string): number[] => all.filter((i) => src(i) !== c);

  const knn = (q: number, cand: readonly number[]): Outcome => {
    const qe = ex[q];
    if (!qe) return { predicted: null, suggested: false };
    const list: ChargeExample[] = [];
    for (const j of cand) {
      const e = ex[j];
      if (e && e.normalized !== qe.normalized) list.push(e);
    }
    const best = rankNearest(qe.features, list);
    if (!best) return { predicted: null, suggested: false };
    return { predicted: best.example.nearest.category, suggested: accepts(best.dot, qe.norm2, best.example.norm2) };
  };

  const kw = zero();
  const maj = zero();
  for (let q = 0; q < n; q += 1) {
    const k = classifyLine(entries[q]?.text ?? '');
    add(kw, label(q), { predicted: k === 'other' ? null : k, suggested: k !== 'other' });
    add(maj, label(q), { predicted: 'accessorial', suggested: true });
  }
  const baseline = (a: Agg): CurveBaseline => ({ recognition: pct(a.recognised, a.total), wrong: pct(a.wrong, a.total), accessorialRecognition: pct(a.accRec, a.accTotal) });

  const byFraction: CurveFractionPoint[] = [];
  const perSource: CurveSourceDetail[] = [];
  for (const f of CURVE_FRACTIONS) {
    const reps = f >= 1 ? 1 : resamples;
    const runs: Agg[] = [];
    let trainSum = 0;
    for (let r = 0; r < reps; r += 1) {
      const rnd = mulberry32(CURVE_RNG_SEED + r + Math.round(f * 1000) * 1000);
      const a = zero();
      for (const c of sources) {
        const pool = others(c);
        const cand = f >= 1 ? pool : sample(pool, Math.max(1, Math.round(f * pool.length)), rnd);
        trainSum += cand.length;
        const detail = { source: c, label: SEED_V2_SOURCES[c].label, examples: 0, recognised: 0, wrong: 0, abstained: 0 };
        for (const q of bySource.get(c) ?? []) {
          const o = knn(q, cand);
          add(a, label(q), o);
          detail.examples += 1;
          if (o.suggested && o.predicted === label(q)) detail.recognised += 1;
          else if (o.suggested) detail.wrong += 1;
          else detail.abstained += 1;
        }
        if (f >= 1) perSource.push(detail);
      }
      runs.push(a);
    }
    byFraction.push({ fraction: f, resamples: reps, trainNamesMean: +(trainSum / reps / sources.length).toFixed(1), ...summarize(runs) });
  }

  const bySourceCount: CurveSourceCountPoint[] = [];
  for (let k = 1; k < sources.length; k += 1) {
    const a = zero();
    let train = 0;
    let count = 0;
    for (const c of sources) {
      const sets = subsets(
        sources.filter((x) => x !== c),
        k,
      );
      for (const s of sets) {
        const chosen = new Set<string>(s);
        const cand = all.filter((i) => chosen.has(src(i)));
        train += cand.length;
        count += 1;
        for (const q of bySource.get(c) ?? []) add(a, label(q), knn(q, cand), 1 / sets.length);
      }
    }
    bySourceCount.push({ otherSources: k, subsets: count / sources.length, trainNamesMean: +(train / count).toFixed(1), recognition: pct(a.recognised, a.total), wrong: pct(a.wrong, a.total), accessorialRecognition: pct(a.accRec, a.accTotal) });
  }

  let v1HeldOut: CurveReport['v1HeldOut'] = null;
  if (seed === 'v2') {
    const a = zero();
    for (let q = 0; q < SEED_V1.length; q += 1) add(a, label(q), knn(q, others(src(q))));
    v1HeldOut = { examples: a.total, recognised: a.recognised, wrong: a.wrong, abstained: a.abstained };
  }

  return {
    evaluation: 'learning-curve',
    classifierVersion: CHARGE_CLASSIFIER_VERSION,
    seedVersion: SEED_VERSION,
    seed,
    threshold: SUGGESTION_THRESHOLD,
    note: CHARGE_EVAL_NOTE,
    rngSeed: CURVE_RNG_SEED,
    resamples,
    examples: n,
    sources: sources.length,
    distinctName: true,
    baselines: { keyword: baseline(kw), majority: baseline(maj) },
    byFraction,
    bySourceCount,
    perSource,
    v1HeldOut,
  };
}