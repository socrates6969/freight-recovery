/**
 * Nearest-example charge classifier `charge-knn-v1` (Part C C3). Examples are the tenant's labels
 * (sorted by normalized text, then id) followed by the seed entries whose normalized text no tenant label
 * overrides. The nearest example and the 0.30 threshold are decided with exact integer arithmetic
 * (BigInt), so no floating-point rounding can change a decision; the reported similarity is one IEEE
 * division rounded to three decimals. Pure and deterministic. `ChargeSuggestion` / `NearestExample` are
 * the C6 DTO types (one definition for the classifier and the API).
 */
import { normText } from '../analysis/py-text.js';
import type { ChargeSuggestion, NearestExample } from '../charge-intel-dto.js';

import { SUGGESTION_THRESHOLD_DEN, SUGGESTION_THRESHOLD_NUM, type ChargeCategory } from './constants.js';
import { chargeFeatures, featureDot, featureNorm2, type ChargeFeatures } from './features.js';
import { SEED_SOURCES, SEED_V1, type SeedExample } from './seed-v1.js';

/** Display origin of a tenant label in suggestions. */
export const TENANT_LABEL_SOURCE_LABEL = "Your team's label";

const SIMILARITY_DECIMALS = 3;
const SIMILARITY_SCALE = 10 ** SIMILARITY_DECIMALS;

export interface TenantLabelInput {
  id: string;
  description: string;
  category: ChargeCategory;
}

export interface ChargeClassifier {
  classify(description: string): ChargeSuggestion;
}

/** One example with its precomputed features (internal; exported for the evaluation). */
export interface ChargeExample {
  readonly nearest: NearestExample;
  readonly features: ChargeFeatures;
  readonly norm2: number;
}

/** Similarity rounded to three decimals, as a number (the `similarity` of a suggestion). */
export function roundSimilarity(x: number): number {
  return Math.round(x * SIMILARITY_SCALE) / SIMILARITY_SCALE;
}

/** C3 text form of a similarity: the rounded number with three decimals (e.g. 0.45 -> `0.450`). */
export function formatSimilarity(x: number): string {
  return roundSimilarity(x).toFixed(SIMILARITY_DECIMALS);
}

/** Alias of `formatSimilarity` (text form). */
export function similarityText(x: number): string {
  return formatSimilarity(x);
}

/** Raw similarity `dot / sqrt(|q|^2 |e|^2)` (0 when dot is 0). */
export function rawSimilarity(dot: number, qNorm2: number, eNorm2: number): number {
  if (dot === 0) return 0;
  return dot / Math.sqrt(qNorm2 * eNorm2);
}

/**
 * Nearest example among those with `dot > 0`: `e` beats the current best iff
 * `dot(q,e)^2 * |best|^2 > dot(q,best)^2 * |e|^2` (strict, so ties keep the earlier example).
 */
export function rankNearest<E extends { features: ChargeFeatures; norm2: number }>(fq: ChargeFeatures, examples: readonly E[]): { example: E; dot: number } | null {
  let best: E | null = null;
  let bestDot = 0;
  for (const e of examples) {
    const d = featureDot(fq, e.features);
    if (d <= 0) continue;
    if (best === null || BigInt(d) ** 2n * BigInt(best.norm2) > BigInt(bestDot) ** 2n * BigInt(e.norm2)) {
      best = e;
      bestDot = d;
    }
  }
  return best === null ? null : { example: best, dot: bestDot };
}

/** Exact threshold test: `DEN^2 * dot^2 >= NUM^2 * |q|^2 * |e|^2` (similarity >= 3/10). */
export function accepts(dot: number, qNorm2: number, eNorm2: number): boolean {
  const den = BigInt(SUGGESTION_THRESHOLD_DEN);
  const num = BigInt(SUGGESTION_THRESHOLD_NUM);
  return den * den * BigInt(dot) ** 2n >= num * num * BigInt(qNorm2) * BigInt(eNorm2);
}

function seedNearest(s: SeedExample): NearestExample {
  return { text: s.text, category: s.label, origin: 'seed', source: s.source, sourceLabel: SEED_SOURCES[s.source].label, labelId: null };
}

/** Seed examples with features, cached per seed array (analysis and the view share them). */
const seedCache = new WeakMap<readonly SeedExample[], readonly (ChargeExample & { normalized: string })[]>();

export function seedExamples(seed: readonly SeedExample[] = SEED_V1): readonly (ChargeExample & { normalized: string })[] {
  let cached = seedCache.get(seed);
  if (!cached) {
    cached = Object.freeze(
      seed.map((s) => {
        const features = chargeFeatures(s.text);
        return { nearest: seedNearest(s), features, norm2: featureNorm2(features), normalized: normText(s.text) };
      }),
    );
    seedCache.set(seed, cached);
  }
  return cached;
}

function suggestion(fq: ChargeFeatures, examples: readonly ChargeExample[]): ChargeSuggestion {
  if (fq.size === 0) return { category: null, similarity: 0, abstained: true, reason: 'empty', nearest: null };
  const best = rankNearest(fq, examples);
  if (best === null) return { category: null, similarity: 0, abstained: true, reason: 'no_match', nearest: null };
  const qn = featureNorm2(fq);
  const similarity = roundSimilarity(rawSimilarity(best.dot, qn, best.example.norm2));
  const nearest = { ...best.example.nearest };
  if (accepts(best.dot, qn, best.example.norm2)) return { category: nearest.category, similarity, abstained: false, reason: null, nearest };
  return { category: null, similarity, abstained: true, reason: 'below_threshold', nearest };
}

/** Build the classifier over the tenant's labels and the seed (C3 example order). */
export function buildChargeClassifier(labels: readonly TenantLabelInput[], seed: readonly SeedExample[] = SEED_V1): ChargeClassifier {
  const tenant = labels
    .map((l) => ({ l, nt: normText(l.description) }))
    .filter((x) => x.nt !== '')
    .sort((a, b) => (a.nt < b.nt ? -1 : a.nt > b.nt ? 1 : a.l.id < b.l.id ? -1 : a.l.id > b.l.id ? 1 : 0));
  const taken = new Set<string>();
  const examples: ChargeExample[] = [];
  for (const { l, nt } of tenant) {
    if (taken.has(nt)) continue;
    taken.add(nt);
    const features = chargeFeatures(l.description);
    examples.push({
      nearest: { text: l.description, category: l.category, origin: 'tenant', source: null, sourceLabel: TENANT_LABEL_SOURCE_LABEL, labelId: l.id },
      features,
      norm2: featureNorm2(features),
    });
  }
  for (const s of seedExamples(seed)) if (!taken.has(s.normalized)) examples.push(s);
  const frozen = Object.freeze(examples);
  return Object.freeze({ classify: (description: string): ChargeSuggestion => suggestion(chargeFeatures(description), frozen) });
}
