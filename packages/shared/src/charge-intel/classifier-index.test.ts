/**
 * Fix round 1 (S1): the indexed classifier returns exactly what the full-scan reference returns
 * (nearest example, tie-break, threshold decision, similarity), the query text is capped at 200
 * normalized characters, and classification at the caps (2,000 labels x 250 long lines) stays bounded.
 */
import { describe, expect, it } from 'vitest';

import { CATEGORY_LABELS, CHARGE_CATEGORIES, CHARGE_QUERY_TEXT_MAX, SEED_V1, beats, buildChargeClassifier, buildChargeClassifierByScan, chargeFeatures, featureText, type ChargeCategory, type SeedExample, type TenantLabelInput } from './index.js';

/** Deterministic LCG in [0, 1). */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

const VOCAB = ['lift', 'gate', 'liftgate', 'detention', 'det', 'fuel', 'fee', 'charge', 'pallet', 'stop', 'off', 'redeliver', 'inside', 'a', 'ab', 'aa', 'wait', 'time', 'lumper', 'tonu', 'x1', '2', 'haz', 'mat'];

function phrase(r: () => number, maxWords: number): string {
  const n = 1 + Math.floor(r() * maxWords);
  const words: string[] = [];
  for (let i = 0; i < n; i += 1) words.push(VOCAB[Math.floor(r() * VOCAB.length)] ?? 'a');
  return words.join(r() < 0.2 ? '-' : ' ');
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('indexed classifier = full scan (randomized)', () => {
  it('identical suggestions for 3,000 random queries over random labels, seed duplicates and ties', () => {
    const r = lcg(20261011);
    for (let round = 0; round < 6; round += 1) {
      const labels: TenantLabelInput[] = [];
      const nLabels = Math.floor(r() * 120);
      for (let i = 0; i < nLabels; i += 1) {
        labels.push({ id: uuid(Math.floor(r() * 50)), description: phrase(r, 4), category: CHARGE_CATEGORIES[Math.floor(r() * CHARGE_CATEGORIES.length)] as ChargeCategory });
      }
      // A seed with repeated texts across sources forces exact ties between examples.
      const seed: readonly SeedExample[] = round % 2 === 0 ? SEED_V1 : [...SEED_V1.slice(0, 40), ...SEED_V1.slice(0, 40).map((s) => ({ ...s, source: 'estes_2025' as const }))];
      const fast = buildChargeClassifier(labels, seed);
      const scan = buildChargeClassifierByScan(labels, seed);
      for (let q = 0; q < 500; q += 1) {
        const text = r() < 0.1 ? (SEED_V1[Math.floor(r() * SEED_V1.length)]?.text ?? '') : r() < 0.05 ? ' -- ' : phrase(r, 6);
        expect([text, fast.classify(text)]).toEqual([text, scan.classify(text)]);
      }
    }
  });

  it('beats() equals the BigInt comparison, including beyond 2^53', () => {
    const r = lcg(7);
    const big = (d: number, n1: number, e: number, n2: number) => BigInt(d) ** 2n * BigInt(n1) > BigInt(e) ** 2n * BigInt(n2);
    for (let i = 0; i < 5000; i += 1) {
      const scale = r() < 0.5 ? 1e3 : 1e8;
      const v = () => 1 + Math.floor(r() * scale);
      const [d, n1, e, n2] = [v(), v(), v(), v()];
      expect(beats(d, n1, e, n2)).toBe(big(d, n1, e, n2));
      expect(beats(d, n1, d, n1)).toBe(false);
    }
  });

  it('memoized results are independent copies', () => {
    const c = buildChargeClassifier([]);
    const a = c.classify('Lift gate');
    if (a.nearest) a.nearest.text = 'changed';
    expect(c.classify('Lift gate').nearest?.text).not.toBe('changed');
  });
});

describe('query text cap (200 normalized characters)', () => {
  it('features use the first 200 normalized characters, trailing space removed', () => {
    const long = `${'liftgate '.repeat(30)}tail`;
    expect(featureText(long).length).toBeLessThanOrEqual(CHARGE_QUERY_TEXT_MAX);
    expect(featureText(long)).toBe('liftgate '.repeat(30).slice(0, 200).trimEnd());
    expect(chargeFeatures(long)).toEqual(chargeFeatures(long.slice(0, 260)));
    expect(featureText('Lift-Gate')).toBe('lift gate');
  });
});

describe('performance at the caps', () => {
  it('2,000 labels x 250 distinct 4,000-character lines classify within a generous bound', () => {
    const r = lcg(99);
    const labels: TenantLabelInput[] = [];
    for (let i = 0; i < 2000; i += 1) {
      let d = '';
      while (d.length < 190) d += `${phrase(r, 3)} `;
      labels.push({ id: uuid(i), description: d.slice(0, 200), category: 'accessorial' });
    }
    const lines: string[] = [];
    for (let i = 0; i < 250; i += 1) {
      let d = `line ${i} `;
      while (d.length < 4000) d += `${phrase(r, 3)} `;
      lines.push(d.slice(0, 4000));
    }
    const started = performance.now();
    const c = buildChargeClassifier(labels);
    for (const ln of lines) c.classify(ln);
    const ms = performance.now() - started;
    // Measured about 0.5 s on the development machine (Node 22; the full scan takes about 5.5 s); the bound
    // leaves room for slow CI runners.
    expect(ms).toBeLessThan(20_000);
    expect(Object.keys(CATEGORY_LABELS)).toHaveLength(5);
  }, 60_000);
});
