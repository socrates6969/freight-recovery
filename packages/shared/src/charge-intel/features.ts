/**
 * Charge-name features (Part C C3): character 3-, 4- and 5-grams of `" " + normText(s) + " "` (1 per
 * occurrence) plus one `"w:" + word` token per word (2 per occurrence). Integer counts only, so norms
 * and dot products are exact integers.
 */
import { normText } from '../analysis/py-text.js';

import { CHARGE_QUERY_TEXT_MAX } from './constants.js';

const NGRAM_SIZES = [3, 4, 5] as const;
const WORD_PREFIX = 'w:';
const WORD_WEIGHT = 2;

export type ChargeFeatures = ReadonlyMap<string, number>;

/**
 * The text features are built from (fix round 1, S1): `normText(text)` cut to its first
 * CHARGE_QUERY_TEXT_MAX characters, trailing space removed. Bounds the CPU of one classification; labels
 * (<= 200) and seed names (<= 82) are never cut.
 */
export function featureText(text: string): string {
  const n = normText(text);
  return n.length <= CHARGE_QUERY_TEXT_MAX ? n : n.slice(0, CHARGE_QUERY_TEXT_MAX).replace(/ +$/u, '');
}

/** Feature map of a charge description; empty when its (capped) normalized text is empty. */
export function chargeFeatures(text: string): Map<string, number> {
  const m = new Map<string, number>();
  const s = featureText(text);
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
