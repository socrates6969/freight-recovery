import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ChargeEvalReport, SetChargeLabelBody } from '../charge-intel-dto.js';

import {
  CHARGE_CATEGORIES,
  CHARGE_EVAL_NOTE,
  CHARGE_TEXT,
  SEED_SOURCES,
  SEED_V1,
  accepts,
  buildChargeClassifier,
  chargeFeatures,
  evaluateLeaveOneCarrierOut,
  featureDot,
  featureNorm2,
  formatSimilarity,
  rankNearest,
  roundSimilarity,
  similarityText,
  type SeedExample,
} from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..');

describe('chargeFeatures', () => {
  it('is empty for text without letters or digits', () => {
    expect(chargeFeatures('').size).toBe(0);
    expect(chargeFeatures(' -- / ').size).toBe(0);
  });

  it('counts 3/4/5-grams of the padded normalized text and weights words by 2', () => {
    const f = chargeFeatures('AB');
    expect([...f.entries()]).toEqual([
      [' ab', 1],
      ['ab ', 1],
      [' ab ', 1],
      ['w:ab', 2],
    ]);
    expect(featureNorm2(f)).toBe(7);
    // Repeated grams and words accumulate.
    const g = chargeFeatures('aaa aaa');
    expect(g.get('aaa')).toBe(2);
    expect(g.get('w:aaa')).toBe(4);
    expect(chargeFeatures('Lift-Gate')).toEqual(chargeFeatures('lift gate'));
  });

  it('dot product is symmetric and integer', () => {
    const a = chargeFeatures('lift gate delivery');
    const b = chargeFeatures('liftgate');
    expect(featureDot(a, b)).toBe(featureDot(b, a));
    expect(Number.isInteger(featureDot(a, b))).toBe(true);
  });
});

describe('ranking and threshold (exact)', () => {
  it('accepts exactly at similarity 0.30 and rejects just below', () => {
    expect(accepts(3, 10, 10)).toBe(true); // 100 * 9 = 9 * 100
    expect(accepts(3, 10, 11)).toBe(false);
    expect(accepts(0, 1, 1)).toBe(false);
  });

  it('ties keep the earlier example; dot 0 never matches', () => {
    const ex = ['lumper fee', 'lumper fee', 'xyz'].map((t, i) => {
      const features = chargeFeatures(t);
      return { i, features, norm2: featureNorm2(features) };
    });
    expect(rankNearest(chargeFeatures('lumper'), ex)?.example.i).toBe(0);
    expect(rankNearest(chargeFeatures('qqqqq'), ex)).toBeNull();
  });

  it('formats similarity to three decimals', () => {
    expect(roundSimilarity(0.30049)).toBe(0.3);
    expect(formatSimilarity(0.45)).toBe('0.450');
    expect(formatSimilarity(0.30049)).toBe('0.300');
    expect(similarityText(0.3)).toBe('0.300');
    expect(similarityText(2 / 3)).toBe('0.667');
  });
});

describe('buildChargeClassifier', () => {
  const seed: readonly SeedExample[] = [
    { text: 'Lumper fee', label: 'accessorial', source: 'magnum_2026' },
    { text: 'LUMPER FEE', label: 'detention', source: 'xpo_2025' },
    { text: 'Detention', label: 'detention', source: 'estes_2025' },
  ];

  it('abstains with reason empty / no_match', () => {
    const c = buildChargeClassifier([], seed);
    expect(c.classify('  ** ')).toEqual({ category: null, similarity: 0, abstained: true, reason: 'empty', nearest: null });
    expect(c.classify('qqqqq')).toEqual({ category: null, similarity: 0, abstained: true, reason: 'no_match', nearest: null });
  });

  it('suggests the nearest seed example with attribution; ties go to the earlier entry', () => {
    const s = buildChargeClassifier([], seed).classify('lumper fee');
    expect(s).toEqual({
      category: 'accessorial',
      similarity: 1,
      abstained: false,
      reason: null,
      nearest: { text: 'Lumper fee', category: 'accessorial', origin: 'seed', source: 'magnum_2026', sourceLabel: SEED_SOURCES.magnum_2026.label, labelId: null },
    });
  });

  it('a tenant label comes first and overrides seed entries with the same normalized text', () => {
    const c = buildChargeClassifier([{ id: 'l2', description: 'lumper-fee', category: 'other' }], seed);
    const s = c.classify('Lumper Fee');
    expect(s.category).toBe('other');
    expect(s.nearest).toEqual({ text: 'lumper-fee', category: 'other', origin: 'tenant', source: null, sourceLabel: "Your team's label", labelId: 'l2' });
    // Duplicate normalized texts: the first after sorting by (normalized text, id) wins.
    const d = buildChargeClassifier(
      [
        { id: 'b', description: 'Detention', category: 'fuel' },
        { id: 'a', description: 'detention', category: 'linehaul' },
      ],
      seed,
    ).classify('detention');
    expect(d.nearest?.labelId).toBe('a');
  });

  it('reports below_threshold with the nearest example', () => {
    const s = buildChargeClassifier([], seed).classify('detention lumper fee storage pallets overtime');
    expect(s.nearest).not.toBeNull();
    if (s.reason === 'below_threshold') {
      expect(s.category).toBeNull();
      expect(s.abstained).toBe(true);
    } else {
      expect(s.similarity).toBeGreaterThanOrEqual(0.3);
    }
    const weak = buildChargeClassifier([], [{ text: 'abcdefghijklmnop qrstuvwxyz', label: 'fuel', source: 'xpo_2025' }]).classify('xyz');
    expect(weak.reason).toBe('below_threshold');
    expect(weak.similarity).toBeLessThan(0.3);
    expect(weak.nearest?.category).toBe('fuel');
  });
});

describe('seed set and attribution (C2)', () => {
  it('has 175 frozen entries with the documented label counts', () => {
    expect(SEED_V1).toHaveLength(175);
    expect(Object.isFrozen(SEED_V1)).toBe(true);
    const counts: Record<string, number> = {};
    for (const s of SEED_V1) counts[s.label] = (counts[s.label] ?? 0) + 1;
    expect(counts).toEqual({ detention: 12, fuel: 3, linehaul: 1, accessorial: 159 });
    expect(SEED_V1[0]).toEqual({ text: 'DETENTION', label: 'detention', source: 'magnum_2026' });
    for (const s of SEED_V1) expect(Object.keys(s)).toEqual(['text', 'label', 'source']);
  });

  it('has six frozen sources in first-appearance order', () => {
    expect(Object.keys(SEED_SOURCES)).toEqual(['magnum_2026', 'gardewine_2025', 'dohrn_2025', 'states_2023', 'xpo_2025', 'estes_2025']);
    const firstSeen: string[] = [];
    for (const s of SEED_V1) if (!firstSeen.includes(s.source)) firstSeen.push(s.source);
    expect(firstSeen).toEqual(Object.keys(SEED_SOURCES));
    expect(Object.isFrozen(SEED_SOURCES)).toBe(true);
    for (const v of Object.values(SEED_SOURCES)) {
      expect(Object.keys(v)).toEqual(['label', 'document', 'effective', 'url', 'retrieved']);
      expect(v.retrieved).toBe('2026-10-11');
      expect(v.url.startsWith('https://')).toBe(true);
    }
  });
});

describe('leave-one-carrier-out evaluation (C11)', () => {
  const r = evaluateLeaveOneCarrierOut();

  it('matches the report schema and the recorded seed-set numbers', () => {
    expect(ChargeEvalReport.parse(r)).toEqual(r);
    expect(r.note).toBe(CHARGE_EVAL_NOTE);
    expect([r.examples, r.carriers]).toEqual([175, 6]);
    expect([r.top1.correct, r.top1.total, r.top1.byCategory.accessorial.correct]).toEqual([173, 175, 158]);
    expect([r.atThreshold.suggested, r.atThreshold.correct, r.atThreshold.wrong, r.atThreshold.abstained]).toEqual([161, 160, 1, 14]);
    expect(r.atThreshold.byCategory.accessorial.recognised).toBe(145);
    expect(r.keywordBaseline).toEqual({ correct: 34, accessorialRecognised: 19 });
    expect([r.distinctName.top1Correct, r.distinctName.suggested, r.distinctName.correct, r.distinctName.wrong, r.distinctName.abstained, r.distinctName.accessorialRecognised]).toEqual([
      173, 157, 156, 1, 18, 141,
    ]);
    expect(r.errors).toHaveLength(2);
    expect(r.perCarrier.map((p) => p.source)).toEqual(Object.keys(SEED_SOURCES));
    expect(r.perCarrier.reduce((a, p) => a + p.examples, 0)).toBe(175);
  });

  it('is deterministic', () => {
    expect(evaluateLeaveOneCarrierOut()).toEqual(r);
  });
});

describe('DTOs and copy', () => {
  it('validates label bodies', () => {
    expect(SetChargeLabelBody.parse({ description: '  Lumper fee ', category: 'accessorial' })).toEqual({ description: 'Lumper fee', category: 'accessorial' });
    for (const bad of [{ description: '---', category: 'accessorial' }, { description: 'x', category: 'nope' }, { description: 'a‮b', category: 'fuel' }, { description: 'x'.repeat(201), category: 'fuel' }, { description: 'x', category: 'fuel', extra: 1 }]) {
      expect(SetChargeLabelBody.safeParse(bad).success).toBe(false);
    }
    expect(CHARGE_CATEGORIES).toEqual(['detention', 'linehaul', 'fuel', 'accessorial', 'other']);
    expect(CHARGE_TEXT.confirm('Detention')).toBe('Confirm Detention');
  });
});

describe('package root isolation', () => {
  const importsOf = (file: string): string[] => [...readFileSync(file, 'utf8').matchAll(/^(?:import|export)[^;]*?from\s+'([^']+)'/gmu)].map((m) => m[1] ?? '');

  it('the root never reaches the seed, classifier, learned layer or evaluation (transitively)', () => {
    const forbidden = ['seed-v1.ts', 'classifier.ts', 'learned.ts', 'evaluate.ts', 'features.ts', path.join('charge-intel', 'index.ts')].map((f) =>
      f.includes(path.sep) ? path.join(srcRoot, f) : path.join(srcRoot, 'charge-intel', f),
    );
    const seen = new Set<string>();
    const queue = [path.join(srcRoot, 'index.ts')];
    while (queue.length > 0) {
      const f = queue.pop() ?? '';
      if (seen.has(f)) continue;
      seen.add(f);
      for (const spec of importsOf(f)) {
        if (!spec.startsWith('.')) continue;
        queue.push(path.resolve(path.dirname(f), spec.replace(/\.js$/u, '.ts')));
      }
    }
    expect(seen.has(path.join(srcRoot, 'charge-intel', 'constants.ts'))).toBe(true);
    for (const f of forbidden) expect([f, seen.has(f)]).toEqual([f, false]);
  });

  it('constants, copy and the DTO module import only what the spec allows', () => {
    expect(importsOf(path.join(srcRoot, 'charge-intel', 'constants.ts'))).toEqual([]);
    expect(importsOf(path.join(srcRoot, 'charge-intel', 'copy.ts'))).toEqual(['./constants.js']);
    expect(importsOf(path.join(srcRoot, 'charge-intel-dto.ts')).sort()).toEqual(['./analysis/py-text.js', './charge-intel/constants.js', './decimal.js', './dto.js', 'zod'].sort());
  });
});
