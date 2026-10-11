/**
 * Charge-name features (Part C C3): character 3-, 4- and 5-grams of `" " + normText(s) + " "` (1 per
 * occurrence) plus one `"w:" + word` token per word (2 per occurrence). Integer counts only, so norms
 * and dot products are exact integers.
 */
import { normText } from '../analysis/py-text.js';

const NGRAM_SIZES = [3, 4, 5] as const;
const WORD_PREFIX = 'w:';
const WORD_WEIGHT = 2;

export type ChargeFeatures = ReadonlyMap<string, number>;

/** Feature map of a charge description; empty when its normalized text is empty. */
export function chargeFeatures(text: string): Map<string, number> {
  const m = new Map<string, number>();
  const s = normText(text);
  if (s === '') return m;
  const p = ` ${s} `;
  for (const k of NGRAM_SIZES) {
    for (let i = 0; i + k <= p.length; i += 1) {
      const g = p.slice(i, i + k);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
  }
  for (const w of s.split(' ')) {
    const key = WORD_PREFIX + w;
    m.set(key, (m.get(key) ?? 0) + WORD_WEIGHT);
  }
  return m;
}

/** `|f|^2`: sum of squared counts (exact integer). */
export function featureNorm2(f: ChargeFeatures): number {
  let n = 0;
  for (const v of f.values()) n += v * v;
  return n;
}

/** `dot(a, b)` over the keys present in both (iterates the smaller map). */
export function featureDot(a: ChargeFeatures, b: ChargeFeatures): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let d = 0;
  for (const [k, v] of small) {
    const w = large.get(k);
    if (w !== undefined) d += v * w;
  }
  return d;
}
