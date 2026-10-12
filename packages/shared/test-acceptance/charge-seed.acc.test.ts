/* eslint-disable */
// REQ-20261011-charge-intelligence Tier L: T1 seed and attribution (CI-S01..S05), C1 constants and module surface,
// T16 honesty and copy (CI-S23), plus the shared registry pins of C8-C10 (permission, audit actions, flag registry).
// Black-box over `@fr/shared` and `@fr/shared/charge-intel` (dist; run `npm run build -w packages/shared` first).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEED_DIGEST_SHA256, seedDigestInput } from './helpers/charge-oracle.js';

let R: any; // package root
let C: any; // subpath
beforeAll(async () => {
  R = await import('@fr/shared');
  C = await import('@fr/shared/charge-intel');
});

const SOURCES: Record<string, { label: string; document: string; effective: string; url: string }> = {
  magnum_2026: { label: 'Magnum LTL Rules Tariff 125 (2026)', document: 'Magnum LTL 125 Rules and Special Services Tariff', effective: '2026-04-01', url: 'https://magnumlog.com/wp-content/uploads/2026/04/2026-Rules-Tariff-125-04.01.26.pdf' },
  gardewine_2025: { label: 'Gardewine GWN Tariff 100 (2025)', document: 'Gardewine GWN Tariff 100 General Rules, Domestic Canada LTL', effective: '2025-12-01', url: 'https://gardewine.com/wp-content/uploads/2026/06/GWN_RULES_TARIFF_100_DEC_2025_FINAL-V2.pdf' },
  dohrn_2025: { label: 'Dohrn Rules Tariff DHRN 100 (2025)', document: 'Dohrn Transfer Company accessorial recap, Rules Tariff DHRN 100 series', effective: '2025-01-20', url: 'https://dohrn.com/wp-content/uploads/2025/01/Dohrn-Rules-Tariff-Effective-01.20.2025.pdf' },
  states_2023: { label: 'States Logistics LTL accessorials (2023)', document: 'States Logistics Services LTL Accessorials and Miscellaneous Charges', effective: '2023-11-30', url: 'https://stateslogistics.com/wp-content/uploads/2024/07/LTLAccessorialMiscServices.pdf' },
  xpo_2025: { label: 'XPO Tariff CNWY 199-AJ.4 (2025)', document: 'XPO Logistics Freight Tariff CNWY 199-AJ.4, accessorial services', effective: '2025-11-03', url: 'https://www.xpo.com/cdn/download_files/s1/p2831/CNWY_199-AJ.4_Eff_11.3.2025.pdf' },
  estes_2025: { label: 'Estes accessorial charges (2025)', document: 'Estes Express Lines Accessorial Charges (Rules Tariff EXLA 105)', effective: '2025-11-17', url: 'https://www.estes-express.com/downloads/EXLAaccessorialCharges.pdf' },
};

export const C13 = {
  CHARGE_NOTE: "Suggestions compare each charge name with labelled examples: public carrier tariff charge names and your team's labels. They are not verified. A suggestion only adds items for human review; it never confirms an amount.",
  CHARGE_EVAL_NOTE: 'Leave-one-carrier-out check on 175 public tariff charge names from 6 carriers. It is a regression check on this seed set, not an accuracy measure on invoices.',
  CATEGORY_LABELS: { detention: 'Detention', linehaul: 'Linehaul', fuel: 'Fuel', accessorial: 'Accessorial', other: 'Other' },
  CHARGE_TEXT: { tab: 'Charges', heading: 'Charge lines', rules: 'Rules', suggested: 'Suggested', noSuggestion: 'No suggestion', teamLabel: 'Team label', nearest: 'Nearest example', category: 'Category', save: 'Save label', saved: 'Label saved. It applies to future analyses.', empty: 'No invoice charge lines on the accepted documents of this claim.', forbidden: 'You do not have permission to label charges.', limit: 'This organization has reached the maximum number of charge labels.', rateLimited: 'Too many requests. Try again later.', failed: 'Could not save the label. Try again.' },
};
const DISHONEST_RE = /accura|guarantee|verified result|AI\b|machine learning/i;
// CI-S23 requires CHARGE_EVAL_NOTE to contain the mandated negation "not an accuracy measure" AND no match of the
// regex. Both cannot hold literally (the phrase contains "accura"), so exactly that mandated phrase is removed before
// the regex is applied; any other occurrence still fails. Routed to fr-planner (test-spec self-contradiction).
const DISHONEST = { test: (t: string) => DISHONEST_RE.test(t.split('not an accuracy measure').join('')) };
const notDishonest = (t: string) => expect(DISHONEST.test(t), `dishonest wording: ${t}`).toBe(false);

describe('C1 constants and module surface', () => {
  it('constants', () => {
    for (const M of [R, C]) {
      expect(M.CHARGE_CLASSIFIER_VERSION).toBe('charge-knn-v1');
      expect(M.SEED_VERSION).toBe('tariff-seed-v1');
      expect(M.SUGGESTION_THRESHOLD).toBe(0.3);
      expect([...M.CHARGE_CATEGORIES]).toEqual(['detention', 'linehaul', 'fuel', 'accessorial', 'other']);
      expect(M.CHARGE_LABELS_MAX).toBe(2000);
      // fix round 1 (C1 amended)
      expect(M.CHARGE_QUERY_TEXT_MAX).toBe(200);
      expect(M.LEARNED_LABEL_IDS_MAX).toBe(50);
      expect([...M.LEARNED_RULE_IDS]).toEqual(['LRN-ACCESSORIAL-REVIEW']);
    }
    expect(R.RULES_VERSION).toBe('rules-v1');
    expect([...R.RULE_IDS]).toHaveLength(8);
    expect(R.RULE_IDS).not.toContain('LRN-ACCESSORIAL-REVIEW');
  });
  it('CI-S05 root does not export the seed or the classifier; the subpath does', () => {
    for (const n of ['SEED_V1', 'SEED_SOURCES', 'buildChargeClassifier', 'chargeFeatures', 'evaluateLeaveOneCarrierOut', 'buildEvidenceLearned']) expect(n in R, `root exports ${n}`).toBe(false);
    for (const n of ['SEED_V1', 'SEED_SOURCES', 'chargeFeatures', 'buildChargeClassifier', 'formatSimilarity', 'evaluateLeaveOneCarrierOut', 'buildEvidenceLearned']) expect(n in C, `subpath exports ${n}`).toBe(true);
    for (const n of ['CHARGE_NOTE', 'CHARGE_TEXT', 'CATEGORY_LABELS', 'CHARGE_EVAL_NOTE']) { expect(n in R, `root ${n}`).toBe(true); expect(n in C, `subpath ${n}`).toBe(true); }
  });
  it('CI-S05 C6 DTO schemas are exported from the root and parse', () => {
    for (const n of ['ChargeSuggestion', 'ChargeLineView', 'ChargeLinesResponse', 'SetChargeLabelBody', 'ChargeLabel', 'SetChargeLabelResponse', 'ChargeLabelsQuery', 'ChargeLabelsList']) {
      expect(R[n], `root schema ${n}`).toBeTruthy();
      expect(typeof R[n].safeParse, `${n} is a schema`).toBe('function');
    }
    const ok = R.SetChargeLabelBody.safeParse({ description: 'Pallet jack rental', category: 'accessorial' });
    expect(ok.success).toBe(true);
    for (const bad of [{ description: 'x', category: 'Other' }, { description: 'x', category: 'unknown' }, { description: 'x' }, { description: 'x', category: 'other', extra: 1 }, { description: '', category: 'other' }, { description: '   ', category: 'other' }, { description: '---', category: 'other' }, { description: 'a'.repeat(201), category: 'other' }, { description: 'a\u0000b', category: 'other' }, { description: 'a‮b', category: 'other' }, { description: 'a\nb', category: 'other' }]) {
      expect(R.SetChargeLabelBody.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(R.SetChargeLabelBody.safeParse({ description: 'a'.repeat(200), category: 'other' }).success).toBe(true);
    const q = R.ChargeLabelsQuery.safeParse({});
    expect(q.success).toBe(true);
    expect(q.data).toMatchObject({ page: 1, pageSize: 25 });
    expect(R.ChargeLabelsQuery.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(R.ChargeLabelsQuery.safeParse({ page: '0' }).success).toBe(false);
  });
  it('step-5 computeDetention and buildEvidence are still exported (RD10)', () => {
    for (const n of ['computeDetention', 'applyRules', 'classifyLine', 'buildEvidence']) expect(typeof R[n], n).toBe('function');
  });
});

describe('T1 seed and attribution (C2)', () => {
  it('CI-S01 175 entries, exact keys, equal to the run-dir data file (pinned digest)', () => {
    expect(C.SEED_V1).toHaveLength(175);
    for (const e of C.SEED_V1) expect(Object.keys(e).sort()).toEqual(['label', 'source', 'text']);
    expect(createHash('sha256').update(seedDigestInput(C.SEED_V1)).digest('hex'), 'digest of the C2 seed (text,label,source)').toBe(SEED_DIGEST_SHA256);
    const file = process.env.CHARGE_SEED_JSON;
    if (file && existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      expect(raw).toHaveLength(175);
      raw.forEach((r: any, i: number) => expect({ ...C.SEED_V1[i] }, `entry ${i}`).toEqual({ text: r.text, label: r.label, source: r.source }));
    }
  });
  it('CI-S02 label and source counts', () => {
    const count = (k: string) => C.SEED_V1.reduce((m: Record<string, number>, e: any) => ({ ...m, [e[k]]: (m[e[k]] ?? 0) + 1 }), {});
    expect(count('label')).toEqual({ accessorial: 159, detention: 12, fuel: 3, linehaul: 1 });
    expect(count('source')).toEqual({ xpo_2025: 43, dohrn_2025: 30, estes_2025: 29, magnum_2026: 27, gardewine_2025: 27, states_2023: 19 });
  });
  it('CI-S03 SEED_SOURCES keys in order with the C2 values', () => {
    expect(Object.keys(C.SEED_SOURCES)).toEqual(['magnum_2026', 'gardewine_2025', 'dohrn_2025', 'states_2023', 'xpo_2025', 'estes_2025']);
    for (const [k, v] of Object.entries(SOURCES)) {
      expect(Object.keys(C.SEED_SOURCES[k]).sort(), k).toEqual(['document', 'effective', 'label', 'retrieved', 'url']);
      expect(C.SEED_SOURCES[k]).toEqual({ ...v, retrieved: '2026-10-11' });
      expect(C.SEED_SOURCES[k].url.startsWith('https://')).toBe(true);
    }
    // key order = first appearance in the seed
    const firsts: string[] = [];
    for (const e of C.SEED_V1) if (!firsts.includes(e.source)) firsts.push(e.source);
    expect(firsts).toEqual(Object.keys(C.SEED_SOURCES));
  });
  it('CI-S04 frozen', () => {
    expect(Object.isFrozen(C.SEED_V1)).toBe(true);
    expect(C.SEED_V1.every((e: any) => Object.isFrozen(e))).toBe(true);
    expect(Object.isFrozen(C.SEED_SOURCES)).toBe(true);
    for (const k of Object.keys(C.SEED_SOURCES)) expect(Object.isFrozen(C.SEED_SOURCES[k]), k).toBe(true);
    const before = JSON.stringify([C.SEED_V1, C.SEED_SOURCES]);
    const attempts: (() => void)[] = [
      () => { C.SEED_V1.push({ text: 'x', label: 'other', source: 'x' }); },
      () => { C.SEED_V1[0] = { text: 'x', label: 'other', source: 'x' }; },
      () => { C.SEED_V1[0].label = 'other'; },
      () => { C.SEED_SOURCES.xpo_2025 = {}; },
      () => { C.SEED_SOURCES.xpo_2025.url = 'http://evil.example'; },
    ];
    for (const a of attempts) { try { a(); } catch { /* strict mode TypeError is fine */ } }
    expect(JSON.stringify([C.SEED_V1, C.SEED_SOURCES])).toBe(before);
  });
  it('test-owned oracle: the api copy is byte-identical to this one', () => {
    const here = readFileSync(new URL('./helpers/charge-oracle.ts', import.meta.url));
    const api = readFileSync(new URL('../../../api/test-acceptance/helpers/charge-oracle.ts', import.meta.url));
    expect(api.equals(here)).toBe(true);
  });
  it('C2 stores only names: no rates or money amounts in seed texts', () => {
    for (const e of C.SEED_V1) expect(e.text, e.text).not.toMatch(/\$\s?\d/);
  });
});

describe('T16 honesty and copy (CI-S23)', () => {
  it('copy equals C13 exactly (root and subpath)', () => {
    for (const M of [R, C]) {
      expect(M.CHARGE_NOTE).toBe(C13.CHARGE_NOTE);
      expect(M.CHARGE_EVAL_NOTE).toBe(C13.CHARGE_EVAL_NOTE);
      expect({ ...M.CATEGORY_LABELS }).toEqual(C13.CATEGORY_LABELS);
      const { confirm, ...rest } = M.CHARGE_TEXT;
      expect(rest).toEqual(C13.CHARGE_TEXT);
      expect(typeof confirm).toBe('function');
      expect(confirm('Accessorial')).toBe('Confirm Accessorial');
      expect(confirm('Detention')).toBe('Confirm Detention');
    }
    expect(R.CHARGE_EVAL_NOTE).toContain('not an accuracy measure');
  });
  it('no dishonest wording in copy or learned-finding texts', () => {
    const texts = [C13.CHARGE_NOTE, C13.CHARGE_EVAL_NOTE, ...Object.values(C13.CATEGORY_LABELS), ...Object.values(C13.CHARGE_TEXT), R.CHARGE_TEXT.confirm('Accessorial'),
      'Possible unauthorized accessorial (suggestion)', 'Suggestion only - verify before disputing.', 'A suggestion needs similarity of at least 0.30.', 'Confirm before claiming.'];
    for (const t of texts) notDishonest(t);
    for (const t of [R.CHARGE_NOTE, R.CHARGE_EVAL_NOTE, ...Object.values(R.CATEGORY_LABELS), ...Object.values(R.CHARGE_TEXT).filter((x) => typeof x === 'string')]) notDishonest(t as string);
  });
});

describe('C8-C10 shared registries (additive)', () => {
  it('charge_labels:manage exactly for OWNER, ADMIN, MANAGER, REVIEWER', () => {
    for (const r of ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER', 'PLATFORM_DEV', 'SUPER_ADMIN']) expect(R.can(r, 'charge_labels:manage'), r).toBe(['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER'].includes(r));
  });
  it('CI-U03 AUDIT_ACTIONS ends with claim.analyzed, claim.bulk_analyzed, charge_label.set, charge_label.deleted', () => {
    // REQ-20261011-fuel-outlook F13 (additive): the six step-7 actions are appended after charge_label.deleted.
    const a = [...R.AUDIT_ACTIONS];
    const i = a.indexOf('charge_label.deleted');
    expect(a.slice(i - 3, i + 1)).toEqual(['claim.analyzed', 'claim.bulk_analyzed', 'charge_label.set', 'charge_label.deleted']);
    expect(a.slice(i + 1)).toEqual(['fsc_table.created', 'fsc_table.updated', 'fsc_table.archived', 'claim.fuel_inputs_set', 'claim.fuel_inputs_cleared', 'price_data.imported',
      // REQ-20261011-ocean-dd C15 (additive): the eight step-8 actions follow price_data.imported.
      'dd_tariff.created', 'dd_tariff.updated', 'dd_calendar.created', 'dd_calendar.updated', 'dd_invoice.created', 'dd_invoice.updated', 'dd_invoice.deleted', 'dd_invoice.audited',
      // REQ-20261012-hardening C9/C15 (additive): the three hardening actions follow dd_invoice.audited.
      'claim.analysis_failed', 'auth.password.change_failed', 'invite.existing_account']);
    expect(new Set(R.AUDIT_ACTIONS).size).toBe(R.AUDIT_ACTIONS.length);
  });
  it('C10 flag registry entry', () => {
    const f = R.FEATURE_FLAGS.find((x: any) => x.key === 'intelligence.charge_suggestions');
    expect({ ...f }).toEqual({ key: 'intelligence.charge_suggestions', description: 'Charge-line suggestions and team labels', defaultEnabled: true, tenantVisible: true });
    // REQ-20261011-fuel-outlook F14 (additive): two step-7 flags, registry ordered by key.
    // REQ-20261011-ocean-dd C16 (additive): intelligence.ocean_dd, registry ordered by key.
    expect(R.FEATURE_FLAGS.map((x: any) => x.key)).toEqual(['intelligence.charge_suggestions', 'intelligence.cost_outlook', 'intelligence.fuel_check', 'intelligence.ocean_dd', 'intelligence.provenance', 'intelligence.similar_claims', 'intelligence.worklist']);
  });
});
