/* eslint-disable */
// REQ-20261011-charge-intelligence Tier L: T2 features and suggestions without tenant labels (CI-S06..S12) and
// T3 tenant labels (CI-S13..S15). Every case is checked against the fixed test-spec values AND the test-owned C3
// oracle (helpers/charge-oracle.ts; it never imports the product classifier).
import { beforeAll, describe, expect, it } from 'vitest';
import { oExamples, oFeatures, oNearestRaw, oRng, oSuggest } from './helpers/charge-oracle.js';
import { performance } from 'node:perf_hooks';

let C: any;
let L0: any;
let ex0: ReturnType<typeof oExamples>;
beforeAll(async () => {
  C = await import('@fr/shared/charge-intel');
  L0 = C.buildChargeClassifier([]);
  // REQ-20261019-seed-v2: the product's default seed is SEED_V2, so the oracle runs over SEED_V2 / SEED_V2_SOURCES.
  ex0 = oExamples(C.SEED_V2);
});
const oracle = (q: string, labels: any[] = []) => oSuggest(labels.length ? oExamples(C.SEED_V2, labels) : ex0, q, C.SEED_V2_SOURCES);
const plainSug = (s: any) => JSON.parse(JSON.stringify(s));
const fmap = (m: any): Record<string, number> => (m instanceof Map ? Object.fromEntries(m) : { ...m });

describe('T2 chargeFeatures (C3)', () => {
  it('CI-S06 empty inputs give an empty map', () => {
    for (const s of ['', '---', '  ']) expect(Object.keys(fmap(C.chargeFeatures(s))), JSON.stringify(s)).toEqual([]);
  });
  it('CI-S07 Lumper has exactly the 16 features, |f|^2 = 19; LUMPER!! is identical', () => {
    const exp: Record<string, number> = { ' lu': 1, lum: 1, ump: 1, mpe: 1, per: 1, 'er ': 1, ' lum': 1, lump: 1, umpe: 1, mper: 1, 'per ': 1, ' lump': 1, lumpe: 1, umper: 1, 'mper ': 1, 'w:lumper': 2 };
    const f = fmap(C.chargeFeatures('Lumper'));
    expect(f).toEqual(exp);
    expect(Object.keys(f)).toHaveLength(16);
    expect(Object.values(f).reduce((s, v) => s + v * v, 0)).toBe(19);
    expect(fmap(C.chargeFeatures('LUMPER!!'))).toEqual(exp);
    expect(f).toEqual(Object.fromEntries(oFeatures('Lumper')));
  });
  it('features agree with the oracle on a word-repeat and digits case', () => {
    for (const s of ['Re-delivery re delivery', 'Stop off 2', 'a', 'ab', 'Lift gate / LIFTGATE']) expect(fmap(C.chargeFeatures(s)), s).toEqual(Object.fromEntries(oFeatures(s)));
  });
});

type Row = [string, string | null, number, boolean, string | null, string | null, string | null];
const S08: Row[] = [
  ['Sort and segregate', 'accessorial', 0.836, false, null, 'SORT AND SEGREGATE SERVICE', 'dohrn_2025'],
  ['Appointment fee', 'accessorial', 0.825, false, null, 'Appointment', 'xpo_2025'],
  ['Driver waiting time', 'detention', 0.45, false, null, 'DETENTION - DRIVER WAIT', 'gardewine_2025'],
  // REQ-20261019-seed-v2: the GSA name 'OVERWEIGHT FREIGHT' (0.500) is nearer than v1's 'HEAVY LIFT CHARGES' (0.445).
  ['Freight charges', 'accessorial', 0.5, false, null, 'OVERWEIGHT FREIGHT', 'gsa_2021'],
  ['Customs', 'accessorial', 0.542, false, null, 'Customs Broker Service', 'xpo_2025'],
  ['Lumper', 'accessorial', 0.549, false, null, 'Lumper Service Fee', 'xpo_2025'],
  ['Inside delivery', 'accessorial', 1, false, null, 'Inside Delivery', 'states_2023'],
  ['Base Rates', 'linehaul', 1, false, null, 'Base Rates', 'xpo_2025'],
  ['Detention', 'detention', 1, false, null, 'DETENTION', 'magnum_2026'],
  ['Wait time', null, 0.271, true, 'below_threshold', 'DETENTION - DRIVER WAIT', 'gardewine_2025'],
  ['Pallet jack rental', null, 0.282, true, 'below_threshold', 'PALLET RETURNS (EXCLUDING C.P.C. OR CHEP PALLETS)', 'gardewine_2025'],
  // REQ-20261019-seed-v2: the nearest name is now the GSA scale-weight item (0.148, still below the threshold).
  ['Scale ticket', null, 0.148, true, 'below_threshold', 'WEIGHT - VERIFICATION- SECURE CERTIFIED PUBLIC SCALE WEIGHT ACTUAL CHARGES', 'gsa_2021'],
  ['Linehaul', null, 0.043, true, 'below_threshold', 'HYDRAULIC LIFTGATE SERVICE', 'dohrn_2025'],
  ['---', null, 0, true, 'empty', null, null],
];

describe('T2 suggestions with no tenant labels (C3)', () => {
  it('CI-S08 fixed table', () => {
    for (const [q, cat, sim, abst, reason, nt, src] of S08) {
      const s = L0.classify(q);
      expect([s.category, s.similarity, s.abstained, s.reason], q).toEqual([cat, sim, abst, reason]);
      if (nt === null) { expect(s.nearest, q).toBeNull(); continue; }
      const seedEntry = C.SEED_V2.find((e: any) => e.text === nt && e.source === src);
      expect(s.nearest, q).toEqual({ text: nt, category: seedEntry.label, origin: 'seed', source: src, sourceLabel: C.SEED_V2_SOURCES[src!].label, labelId: null });
      expect(plainSug(s), `${q} = oracle`).toEqual(oracle(q));
    }
  });
  it('CI-S08 suggestion key set', () => {
    expect(Object.keys(L0.classify('Lumper')).sort()).toEqual(['abstained', 'category', 'nearest', 'reason', 'similarity']);
    expect(Object.keys(L0.classify('Lumper').nearest).sort()).toEqual(['category', 'labelId', 'origin', 'source', 'sourceLabel', 'text']);
  });
  it('CI-S09 ties: earliest example wins', () => {
    const st = L0.classify('Storage');
    expect(C.SEED_V1.filter((e: any) => e.text.toLowerCase() === 'storage').length).toBeGreaterThanOrEqual(4);
    expect([st.nearest.source, st.similarity]).toEqual(['magnum_2026', 1]);
    const fs = L0.classify('Fuel surcharge');
    expect([fs.category, fs.similarity, fs.nearest.source]).toEqual(['fuel', 1, 'magnum_2026']);
    expect(plainSug(st)).toEqual(oracle('Storage'));
    expect(plainSug(fs)).toEqual(oracle('Fuel surcharge'));
  });
  it('CI-S10 no shared feature -> no_match', () => {
    const q = 'zzzzzz qqqqqq';
    expect(oNearestRaw(ex0, q).ex, 'oracle: every dot product is 0').toBeNull();
    expect(plainSug(L0.classify(q))).toEqual({ category: null, similarity: 0, abstained: true, reason: 'no_match', nearest: null });
  });
  it('formatSimilarity: 3 decimals text', () => {
    expect(C.formatSimilarity(0.45)).toBe('0.450');
    expect(C.formatSimilarity(1)).toBe('1.000');
    expect(C.formatSimilarity(0.8357)).toBe('0.836');
    expect(C.formatSimilarity(0)).toBe('0.000');
  });

  // CI-S11 corpus: PRNG mulberry32, seed 20261011 (recorded).
  const CORPUS_SEED = 20261011;
  const corpus = (n: number): string[] => {
    const rnd = oRng(CORPUS_SEED);
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)] as T;
    const out: string[] = [];
    const names: string[] = C.SEED_V1.map((e: any) => e.text);
    const noise = ['', '!', '  ', ' - ', '#', '/', '...', ' & ', '(', ')'];
    for (let i = 0; i < n; i++) {
      const base = pick(names);
      const kind = i % 6;
      if (kind === 0) out.push(base);
      else if (kind === 1) { const w = base.split(/\s+/); for (let j = w.length - 1; j > 0; j--) { const k = Math.floor(rnd() * (j + 1)); [w[j], w[k]] = [w[k]!, w[j]!]; } out.push(w.join(' ')); }
      else if (kind === 2) out.push(base.slice(0, 1 + Math.floor(rnd() * base.length)));
      else if (kind === 3) out.push([...base].map((ch) => (rnd() < 0.5 ? ch.toUpperCase() : ch.toLowerCase())).join('') + pick(noise) + pick(noise));
      else if (kind === 4) { let s = ''; const len = Math.floor(rnd() * 24); for (let j = 0; j < len; j++) s += String.fromCharCode(32 + Math.floor(rnd() * 95)); out.push(s); }
      else out.push(`${pick(names).split(' ')[0]} ${pick(['fee', 'charge', 'service', 'time', 'rental', 'surcharge', 'wait'])} ${pick(names).split(' ').at(-1)}`);
    }
    return out;
  };
  it('CI-S11 oracle agreement on 2,000 seeded random queries (seed 20261011)', () => {
    const qs = corpus(2000);
    let abstained = 0; let suggested = 0;
    for (const q of qs) {
      const s = L0.classify(q);
      const o = oracle(q);
      expect([s.category, s.abstained, s.reason, s.similarity, s.nearest?.text ?? null, s.nearest?.source ?? null], JSON.stringify(q)).toEqual([o.category, o.abstained, o.reason, o.similarity, o.nearest?.text ?? null, o.nearest?.source ?? null]);
      if (o.abstained) abstained++; else suggested++;
    }
    expect(abstained, 'corpus exercises abstentions').toBeGreaterThan(50);
    expect(suggested, 'corpus exercises suggestions').toBeGreaterThan(500);
  });
  it('CI-S12 determinism: twice, and through two separately built classifiers', () => {
    const qs = corpus(200);
    const A = C.buildChargeClassifier([]);
    const B = C.buildChargeClassifier([]);
    const r1 = qs.map((q) => A.classify(q));
    const r2 = qs.map((q) => A.classify(q));
    const r3 = qs.map((q) => B.classify(q));
    expect(r2).toEqual(r1);
    expect(r3).toEqual(r1);
  });
});

describe('T3 tenant labels (C3 example order, C5)', () => {
  const U1 = '11111111-1111-4111-8111-111111111111';
  const U2 = '22222222-2222-4222-8222-222222222222';
  const U3 = '33333333-3333-4333-8333-333333333333';
  const labels = [
    { id: U1, description: 'Pallet jack rental', category: 'accessorial' },
    { id: U2, description: 'Sort and segregate', category: 'other' },
    { id: U3, description: 'Freight charges', category: 'linehaul' },
  ];
  const idOf: Record<string, string> = { 'Pallet jack rental': U1, 'Sort and segregate': U2, 'Freight charges': U3 };
  const S13: [string, string | null, number, boolean, string, 'tenant' | 'seed', string | null][] = [
    ['Pallet jack rental', 'accessorial', 1, false, 'Pallet jack rental', 'tenant', null],
    ['PALLET JACK RENTAL!!', 'accessorial', 1, false, 'Pallet jack rental', 'tenant', null],
    ['Pallet jack rentals', 'accessorial', 0.868, false, 'Pallet jack rental', 'tenant', null],
    ['Sort and segregate', 'other', 1, false, 'Sort and segregate', 'tenant', null],
    ['Sort & segregate service', 'accessorial', 0.839, false, 'SORT AND SEGREGATE SERVICE', 'seed', 'dohrn_2025'],
    ['Freight charges', 'linehaul', 1, false, 'Freight charges', 'tenant', null],
    ['Freight charge', 'linehaul', 0.825, false, 'Freight charges', 'tenant', null],
    // REQ-20261019-seed-v2: the GSA seed name 'OVERWEIGHT FREIGHT' (0.753) is nearer than the tenant label 'Freight charges' (0.663).
    ['Freight', 'accessorial', 0.753, false, 'OVERWEIGHT FREIGHT', 'seed', 'gsa_2021'],
    ['Wait time', null, 0.271, true, 'DETENTION - DRIVER WAIT', 'seed', 'gardewine_2025'],
  ];
  it('CI-S13 fixed table + oracle', () => {
    const L = C.buildChargeClassifier(labels);
    for (const [q, cat, sim, abst, nt, origin, src] of S13) {
      const s = L.classify(q);
      expect([s.category, s.similarity, s.abstained, s.nearest.text, s.nearest.origin], q).toEqual([cat, sim, abst, nt, origin]);
      if (origin === 'tenant') expect([s.nearest.source, s.nearest.sourceLabel, s.nearest.labelId], q).toEqual([null, "Your team's label", idOf[nt]]);
      else expect([s.nearest.source, s.nearest.sourceLabel, s.nearest.labelId], q).toEqual([src, C.SEED_V2_SOURCES[src!].label, null]);
      expect(plainSug(s), `${q} = oracle`).toEqual(oracle(q, labels));
    }
  });
  it('CI-S14 a tenant label overrides seed entries with the same normalized text', () => {
    const id = '44444444-4444-4444-8444-444444444444';
    const L = C.buildChargeClassifier([{ id, description: 'Storage', category: 'other' }]);
    for (const q of ['Storage', 'STORAGE ']) {
      const s = L.classify(q);
      expect([s.category, s.similarity, s.abstained, s.nearest.origin, s.nearest.labelId, s.nearest.text], q).toEqual(['other', 1, false, 'tenant', id, 'Storage']);
    }
    // a near-variant must never reach the overridden seed 'Storage' entries
    const v = L.classify('Storage fee');
    expect(v.nearest.text === 'STORAGE' || v.nearest.text === 'Storage' ? v.nearest.origin : 'n/a').not.toBe('seed');
    expect(plainSug(v)).toEqual(oracle('Storage fee', [{ id, description: 'Storage', category: 'other' }]));
  });
  it('CI-S15 input order independence', () => {
    const qs = [...S13.map((r) => r[0]), 'Pallet', 'segregate', 'Freight service', 'Jack', 'charges'];
    const base = C.buildChargeClassifier(labels);
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const p of perms) {
      const L = C.buildChargeClassifier(p.map((i) => labels[i]));
      for (const q of qs) expect(L.classify(q), `${p} ${q}`).toEqual(base.classify(q));
    }
  });
  it('labels do not mutate the shared seed or other classifiers', () => {
    const before = L0.classify('Sort and segregate');
    C.buildChargeClassifier(labels).classify('Sort and segregate');
    expect(L0.classify('Sort and segregate')).toEqual(before);
    expect(C.SEED_V1).toHaveLength(175);
  });
});

describe('T17 query cap and performance (C3 featureText, fix round 1)', () => {
  it('CI-S24 the 200-character featureText cap', () => {
    const L1 = 'Sort and segregate ' + 'x'.repeat(300);
    const P1 = 'sort and segregate ' + 'x'.repeat(181);
    expect(P1).toHaveLength(200);
    expect(L0.classify(L1)).toEqual(L0.classify(P1));
    expect(fmap(C.chargeFeatures(L1))).toEqual(fmap(C.chargeFeatures(P1)));
    expect(plainSug(L0.classify(L1))).toEqual(oracle(L1));
    const L2 = 'a'.repeat(199) + ' ' + 'lumper service fee';
    expect(fmap(C.chargeFeatures(L2))).toEqual(fmap(C.chargeFeatures('a'.repeat(199))));
    expect(fmap(C.chargeFeatures(L2))).toEqual(Object.fromEntries(oFeatures(L2)));
    expect(Object.keys(fmap(C.chargeFeatures(L2)))).not.toContain('w:lumper');
    // texts whose normText is <= 200 characters are unaffected (CI-S08/S11/S13 above still pass unchanged)
    const exactly200 = 'b'.repeat(200);
    expect(fmap(C.chargeFeatures(exactly200))).toEqual(Object.fromEntries(oFeatures(exactly200)));
    expect(Object.keys(fmap(C.chargeFeatures(exactly200)))).toContain('w:' + 'b'.repeat(200));
  });

  // CI-S25: PRNG mulberry32 seed 25062026 (recorded). Bound 20 s wall time for build + 250 classifications.
  it('CI-S25 2,000 labels x 200 chars, 250 lines x 4,000 chars: < 20 s; 25-line sample equals the oracle', () => {
    const rnd = oRng(25062026);
    const vocab = [...new Set<string>(C.SEED_V1.flatMap((e: any) => e.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')))].filter((w: string) => w.length > 0);
    const word = () => (rnd() < 0.7 ? vocab[Math.floor(rnd() * vocab.length)]! : Math.floor(rnd() * 1e9).toString(36));
    const text = (len: number) => { let t = word(); while (t.length < len) t += ' ' + word(); t = t.slice(0, len); return t.endsWith(' ') ? t.slice(0, -1) + 'z' : t; };
    const cats = ['detention', 'linehaul', 'fuel', 'accessorial', 'other'];
    const seen = new Set<string>();
    const labels: any[] = [];
    while (labels.length < 2000) {
      const d = text(200);
      if (d.length !== 200 || seen.has(d)) continue;
      seen.add(d);
      labels.push({ id: `00000000-0000-4000-8000-${String(labels.length).padStart(12, '0')}`, description: d, category: cats[labels.length % 5] });
    }
    const lines = new Set<string>();
    while (lines.size < 250) lines.add(text(4000));
    const qs = [...lines];
    const t0 = performance.now();
    const L = C.buildChargeClassifier(labels);
    const out = qs.map((q) => L.classify(q));
    const ms = performance.now() - t0;
    console.log(`[CI-S25] build + 250 classifications: ${ms.toFixed(0)} ms (bound 20000 ms)`);
    expect(ms).toBeLessThan(20000);
    const ex = oExamples(C.SEED_V2, labels);
    for (let i = 0; i < 250; i += 10) expect(plainSug(out[i]), `line ${i}`).toEqual(oSuggest(ex, qs[i]!, C.SEED_V2_SOURCES));
  }, 180000);
});
