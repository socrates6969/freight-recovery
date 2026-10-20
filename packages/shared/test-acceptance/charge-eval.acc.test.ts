/* eslint-disable */
// REQ-20261011-charge-intelligence Tier L: T5 evaluation (CI-S16..S22; Part C C11). Exact numbers from test-spec,
// reproduced independently by the test-owned oracle (helpers/charge-oracle.ts oLoco). The oracle's keyword
// baseline uses the step-5 `classifyLine` (Python-parity verified in step 5), as C11 defines.
import { beforeAll, describe, expect, it } from 'vitest';
import { oLoco } from './helpers/charge-oracle.js';

let R: any;
let C: any;
let rep: any;
beforeAll(async () => {
  R = await import('@fr/shared');
  C = await import('@fr/shared/charge-intel');
  // REQ-20261019-seed-v2: the T5 numbers are the tariff-seed-v1 numbers, reproduced on an explicit SEED_V1 run; the
  // default (SEED_V2) report is checked against the oracle in T5b below.
  rep = C.evaluateLeaveOneCarrierOut(C.SEED_V1);
});

const PER = [
  ['magnum_2026', 27, 27, 25, 25, 24, 1, 0],
  ['gardewine_2025', 27, 27, 24, 24, 20, 4, 0],
  ['dohrn_2025', 30, 29, 27, 26, 25, 1, 1],
  ['states_2023', 19, 19, 17, 17, 16, 1, 0],
  ['xpo_2025', 43, 42, 39, 39, 37, 3, 0],
  ['estes_2025', 29, 29, 27, 27, 23, 4, 0],
] as const;
const ERRORS = [
  { text: 'INTERNATIONAL SECURITY SURCHARGE', source: 'dohrn_2025', expected: 'accessorial', predicted: 'fuel', similarity: 0.413, nearestText: 'FUEL SURCHARGE', nearestSource: 'magnum_2026', suggested: true },
  { text: 'Base Rates', source: 'xpo_2025', expected: 'linehaul', predicted: 'accessorial', similarity: 0.196, nearestText: 'SPECIAL SERVICES - WEEKENDS, HOLIDAYS - HOURLY RATES / EXTRA LABOR', nearestSource: 'dohrn_2025', suggested: false },
];

describe('T5 leave-one-carrier-out report (C11)', () => {
  it('CI-S16 header', () => {
    expect(rep.evaluation).toBe('leave-one-carrier-out');
    expect(rep.classifierVersion).toBe('charge-knn-v1');
    expect(rep.seedVersion).toBe('tariff-seed-v2');
    expect(rep.threshold).toBe(0.3);
    expect(rep.note).toBe(R.CHARGE_EVAL_NOTE);
    expect(rep.examples).toBe(175);
    expect(rep.carriers).toBe(6);
    expect(Object.keys(rep).sort()).toEqual(['atThreshold', 'carriers', 'classifierVersion', 'distinctName', 'errors', 'evaluation', 'examples', 'keywordBaseline', 'note', 'perCarrier', 'pipelineAccessorialCovered', 'seedVersion', 'threshold', 'top1'].sort());
  });
  it('CI-S17 top1', () => {
    expect([rep.top1.correct, rep.top1.total]).toEqual([173, 175]);
    expect(rep.top1.byCategory).toEqual({ detention: { correct: 12, total: 12 }, fuel: { correct: 3, total: 3 }, linehaul: { correct: 0, total: 1 }, accessorial: { correct: 158, total: 159 } });
  });
  it('CI-S18 atThreshold', () => {
    expect([rep.atThreshold.suggested, rep.atThreshold.correct, rep.atThreshold.wrong, rep.atThreshold.abstained]).toEqual([161, 160, 1, 14]);
    expect(rep.atThreshold.byCategory).toEqual({
      detention: { recognised: 12, abstained: 0, wrong: 0, total: 12 },
      fuel: { recognised: 3, abstained: 0, wrong: 0, total: 3 },
      linehaul: { recognised: 0, abstained: 1, wrong: 0, total: 1 },
      accessorial: { recognised: 145, abstained: 13, wrong: 1, total: 159 },
    });
  });
  it('CI-S19 distinctName, keywordBaseline, pipelineAccessorialCovered', () => {
    expect(rep.distinctName).toEqual({ top1Correct: 173, suggested: 157, correct: 156, wrong: 1, abstained: 18, accessorialRecognised: 141 });
    expect(rep.keywordBaseline).toEqual({ correct: 34, accessorialRecognised: 19 });
    expect(rep.pipelineAccessorialCovered).toBe(145);
  });
  it('CI-S20 perCarrier in SEED_SOURCES order', () => {
    expect(rep.perCarrier).toEqual(PER.map(([source, examples, top1Correct, accessorialTotal, accessorialTop1, accessorialRecognised, abstained, wrongSuggested]) => ({
      source, label: C.SEED_SOURCES[source].label, examples, top1Correct, accessorialTotal, accessorialTop1, accessorialRecognised, abstained, wrongSuggested,
    })));
  });
  it('CI-S21 errors exactly', () => {
    expect(rep.errors).toEqual(ERRORS);
  });
  it('CI-S22 the oracle reproduces every number; schema parses; deterministic', () => {
    const o = oLoco(C.SEED_V1, Object.keys(C.SEED_SOURCES), C.SEED_SOURCES, (t) => R.classifyLine(t));
    for (const k of ['examples', 'carriers', 'top1', 'atThreshold', 'distinctName', 'keywordBaseline', 'pipelineAccessorialCovered', 'perCarrier', 'errors'] as const) expect(rep[k], `oracle ${k}`).toEqual(JSON.parse(JSON.stringify(o[k])));
    const schema = R.ChargeEvalReport ?? C.ChargeEvalReport;
    expect(schema, 'ChargeEvalReport schema exported').toBeTruthy();
    const parsed = schema.parse(rep);
    expect(parsed).toEqual(rep);
    expect(C.evaluateLeaveOneCarrierOut(C.SEED_V1)).toEqual(rep);
    expect(JSON.parse(JSON.stringify(rep))).toEqual(rep);
  });
  it('the report is honest: note wording and no accuracy claim', () => {
    expect(rep.note).toContain('not an accuracy measure');
    expect(JSON.stringify(rep)).not.toMatch(/accuracy"|"accuracy|guarantee/i);
  });
});

// REQ-20261019-seed-v2: the default report is over tariff-seed-v2 (256 names, 8 sources); the oracle reproduces it.
describe('T5b leave-one-carrier-out over tariff-seed-v2 (default)', () => {
  let v2: any;
  beforeAll(() => { v2 = C.evaluateLeaveOneCarrierOut(); });
  it('header and the measured seed-v2 numbers (the CI gate: top-1 254, accessorial top-1 233, accessorial recognised 215, wrong 1)', () => {
    expect([v2.seedVersion, v2.examples, v2.carriers, v2.note]).toEqual(['tariff-seed-v2', 256, 8, R.CHARGE_EVAL_NOTE]);
    expect([v2.top1.correct, v2.top1.total, v2.top1.byCategory.accessorial.correct]).toEqual([254, 256, 233]);
    expect([v2.atThreshold.suggested, v2.atThreshold.correct, v2.atThreshold.wrong, v2.atThreshold.abstained, v2.atThreshold.byCategory.accessorial.recognised]).toEqual([236, 235, 1, 20, 215]);
    expect(v2.distinctName).toEqual({ top1Correct: 254, suggested: 236, correct: 235, wrong: 1, abstained: 20, accessorialRecognised: 215 });
    expect(v2.keywordBaseline).toEqual({ correct: 49, accessorialRecognised: 28 });
    expect(v2.perCarrier.map((p: any) => p.source)).toEqual(Object.keys(C.SEED_V2_SOURCES));
    expect(v2.errors.map((e: any) => e.text)).toEqual(['INTERNATIONAL SECURITY SURCHARGE', 'Base Rates']);
  });
  it('the oracle reproduces every number of the seed-v2 report; deterministic', () => {
    const o = oLoco(C.SEED_V2, Object.keys(C.SEED_V2_SOURCES), C.SEED_V2_SOURCES, (t) => R.classifyLine(t));
    for (const k of ['examples', 'carriers', 'top1', 'atThreshold', 'distinctName', 'keywordBaseline', 'pipelineAccessorialCovered', 'perCarrier', 'errors'] as const) expect(v2[k], `oracle `).toEqual(JSON.parse(JSON.stringify(o[k])));
    expect((R.ChargeEvalReport ?? C.ChargeEvalReport).parse(v2)).toEqual(v2);
    expect(C.evaluateLeaveOneCarrierOut()).toEqual(v2);
  });
});
