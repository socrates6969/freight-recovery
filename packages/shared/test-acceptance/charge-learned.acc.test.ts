/* eslint-disable */
// REQ-20261011-charge-intelligence Tier L: T4 learned analysis layer through `buildEvidenceLearned` (CI-L01..L12;
// Part C C4). Fixed expectations from test-spec; the CI-L12 property uses a test-owned oracle of C4.2-C4.5 built on
// the test-owned C3 oracle and the step-5 public functions (applyRules, buildDemandLetter, renderPacketMarkdown).
import { beforeAll, describe, expect, it } from 'vitest';
import { oExamples, oRng, oSuggest, type OExample } from './helpers/charge-oracle.js';

let R: any;
let C: any;
let L0: any;
beforeAll(async () => {
  R = await import('@fr/shared');
  C = await import('@fr/shared/charge-intel');
  L0 = C.buildChargeClassifier([]);
});

const NOW = new Date('2026-10-11T12:00:00.000Z');
const TODAY = '2026-10-11';
const ST = () => R.DEFAULT_ANALYSIS_SETTINGS;
const rc = (o: any = {}) => ({ ...R.emptyRateConfirmation(), ...o });
const bol = (o: any = {}) => ({ ...R.emptyBillOfLading(), ...o });
const inv = (lines: [string, string][], o: any = {}) => ({ ...R.emptyInvoice(), lines: lines.map(([description, amount]) => ({ description, amount })), ...o });
const bundle = (o: any = {}) => ({ invoice: o.invoice ?? null, rate_confirmation: o.rate_confirmation ?? null, bol: o.bol ?? null, warnings: [] });
const learned = (b: any, p: 'shipper' | 'carrier', cls: any) => C.buildEvidenceLearned([], b, p, ST(), NOW, cls);
const step5 = (b: any, p: 'shipper' | 'carrier') => R.buildEvidence([], b, p, ST(), NOW);
const NO_CONFIRMED = '(No confirmed discrepancies.';

const B1 = () => bundle({
  invoice: inv([['Linehaul', '1500.00'], ['Fuel surcharge', '300.00'], ['Sort and segregate', '85.00'], ['Lumper fee', '150.00'], ['Scale ticket', '12.00'], ['Appointment fee', '40.00']], { total: '2087.00' }),
  rate_confirmation: rc({ linehaul_rate: '1500.00', fuel_surcharge: '300.00', authorized_accessorials: ['Appointment'] }),
});
const B3 = (desc = 'Driver waiting time') => bundle({
  invoice: inv([['Linehaul', '1200.00'], [desc, '75.00']], { total: null }),
  rate_confirmation: rc({ linehaul_rate: '1200.00', fuel_surcharge: null, detention_free_hours: '2', detention_rate_per_hour: '50.00', detention_max_hours: null, authorized_accessorials: [] }),
  bol: bol({ arrival_time: '2026-03-02T08:00:00', departure_time: '2026-03-02T12:30:00', appointment_time: null }),
});
const LRN_B1 = {
  rule_id: 'LRN-ACCESSORIAL-REVIEW', title: 'Possible unauthorized accessorial (suggestion)', direction: 'overcharge', amount: '85.00',
  explanation: "'Sort and segregate' ($85.00) is not recognised by the fixed rules. Its nearest labelled example is 'SORT AND SEGREGATE SERVICE' (public tariff example, Dohrn Rules Tariff DHRN 100 (2025)), labelled accessorial, and it is not listed as authorized on the rate confirmation. Suggestion only - verify before disputing.",
  calculation: ["Nearest labelled example: 'SORT AND SEGREGATE SERVICE' (public tariff example, Dohrn Rules Tariff DHRN 100 (2025)) = accessorial, similarity 0.836.", 'A suggestion needs similarity of at least 0.30.', "Authorized accessorials: ['Appointment'].", "Charged: 'Sort and segregate' = $85.00."],
  confidence: 0.5, needs_human_review: true,
};
const DET_EXTRA_B3 = "Possible detention billed under another name: 'Driver waiting time' = $75.00 (nearest labelled example 'DETENTION - DRIVER WAIT', public tariff example, Gardewine GWN Tariff 100 (2025), similarity 0.450). Confirm before claiming.";

/** The letter and Markdown must be built from the combined result (C4 applied before rendering). */
function expectRendered(ev: any, b: any) {
  const letter = R.buildDemandLetter(b, ev.result, TODAY, ST().disputeWindowDays);
  expect(ev.demand_letter).toBe(letter);
  expect(ev.markdown).toBe(R.renderPacketMarkdown(R.packetLoadNumber(b), ev.result.perspective, [], b, ev.result, letter));
}

describe('T4 bundle B1 (C4.1-C4.5)', () => {
  it('CI-L01 shipper with L0', () => {
    const out = learned(B1(), 'shipper', L0);
    const r = out.evidence.result;
    expect(r.findings.map((f: any) => f.rule_id)).toEqual(['INV-ACCESSORIAL-UNAUTH', 'LRN-ACCESSORIAL-REVIEW']);
    expect([r.findings[0].amount, r.findings[0].needs_human_review]).toEqual(['150.00', true]);
    expect(r.findings[0].explanation).toContain("'Lumper fee'");
    expect(r.findings[1]).toEqual(LRN_B1);
    expect([r.recoverable_total, r.pending_review_total]).toEqual(['0.00', '235.00']);
    expect([out.learnedFindingsCount, out.reviewFlagsCount]).toEqual([1, 0]);
    expect(r.findings.filter((f: any) => /Appointment fee|Scale ticket/.test(f.explanation))).toEqual([]);
    expect(r.findings.filter((f: any) => f.rule_id === 'LRN-ACCESSORIAL-REVIEW' && f.explanation.includes('Lumper fee'))).toEqual([]);
    expect(out.evidence.demand_letter).toContain(NO_CONFIRMED);
    expect(out.evidence.demand_letter).not.toContain('Sort and segregate');
    expectRendered(out.evidence, B1());
    // everything outside `result`, the letter and the Markdown is as step 5
    const s5 = step5(B1(), 'shipper');
    for (const k of ['load_number', 'perspective', 'generated_at', 'documents', 'disclaimer']) expect(out.evidence[k], k).toEqual(s5[k]);
  });
  it('CI-L02 carrier with L0: LRN is ignored (other direction), not own', () => {
    const out = learned(B1(), 'carrier', L0);
    const s5 = R.applyRules(B1(), 'carrier', ST());
    const r = out.evidence.result;
    expect([r.findings, r.recoverable_total, r.pending_review_total]).toEqual([[], '0.00', '0.00']);
    expect(r.ignored_findings).toEqual([...s5.ignored_findings, LRN_B1]);
    expect(out.learnedFindingsCount).toBe(0);
    expect(out.reviewFlagsCount).toBe(0);
    expectRendered(out.evidence, B1());
  });
  it('CI-L03 parity-unchanged: null classifier equals buildEvidence exactly (both perspectives)', () => {
    for (const p of ['shipper', 'carrier'] as const) {
      const out = learned(B1(), p, null);
      expect(out.evidence, p).toEqual(step5(B1(), p));
      expect([out.learnedFindingsCount, out.reviewFlagsCount]).toEqual([0, 0]);
    }
  });
  it('CI-L04 contract-amount guard', () => {
    const mk = (amount: string, o: any) => bundle({ invoice: inv([['Freight charges', amount]]), rate_confirmation: rc({ authorized_accessorials: [], ...o }) });
    const a = mk('1500.00', { linehaul_rate: '1500.00', fuel_surcharge: null });
    const ea = learned(a, 'shipper', L0);
    expect(ea.learnedFindingsCount).toBe(0);
    expect(ea.evidence).toEqual(step5(a, 'shipper'));
    // numeric (not textual) comparison with the contract amount
    const a2 = mk('1500', { linehaul_rate: '1500.00', fuel_surcharge: null });
    expect(learned(a2, 'shipper', L0).evidence).toEqual(step5(a2, 'shipper'));
    const b = mk('1600.00', { linehaul_rate: '1500.00', fuel_surcharge: null });
    const eb = learned(b, 'shipper', L0);
    const lrn = eb.evidence.result.findings.filter((f: any) => f.rule_id === 'LRN-ACCESSORIAL-REVIEW');
    expect(lrn).toHaveLength(1);
    expect(lrn[0].amount).toBe('1600.00');
    expect(lrn[0].calculation[0]).toBe("Nearest labelled example: 'HEAVY LIFT CHARGES' (public tariff example, Gardewine GWN Tariff 100 (2025)) = accessorial, similarity 0.445.");
    expect(lrn[0].calculation).toContain('Authorized accessorials: none.');
    const c = mk('1600.00', { linehaul_rate: null, fuel_surcharge: '1600.00' });
    const ec = learned(c, 'shipper', L0);
    expect(ec.learnedFindingsCount).toBe(0);
    expect(ec.evidence).toEqual(step5(c, 'shipper'));
  });
  it('CI-L05 no rate confirmation, zero/negative amounts, repeated identical line', () => {
    const noRc = bundle({ invoice: inv([['Sort and segregate', '85.00']]) });
    expect(learned(noRc, 'shipper', L0).evidence).toEqual(step5(noRc, 'shipper'));
    for (const amt of ['0.00', '-85.00']) {
      const b = bundle({ invoice: inv([['Sort and segregate', amt]]), rate_confirmation: rc({ authorized_accessorials: [] }) });
      const e = learned(b, 'shipper', L0);
      expect(e.learnedFindingsCount, amt).toBe(0);
      expect(e.evidence.result.findings.concat(e.evidence.result.ignored_findings).filter((f: any) => f.rule_id === 'LRN-ACCESSORIAL-REVIEW'), amt).toEqual([]);
    }
    const dup = bundle({ invoice: inv([['Sort and segregate', '85.00'], ['Sort and segregate', '85.00']]), rate_confirmation: rc({ authorized_accessorials: [] }) });
    const e = learned(dup, 'shipper', L0);
    const ids = e.evidence.result.findings.map((f: any) => f.rule_id);
    expect(ids.filter((x: string) => x === 'LRN-ACCESSORIAL-REVIEW')).toHaveLength(1);
    expect(ids).toContain('INV-DUPLICATE');
    expect(e.learnedFindingsCount).toBe(1);
  });
});

describe('T4 bundle B3 detention look-alike (C4.4)', () => {
  it('CI-L06 carrier, null classifier: step-5 DET-UNBILLED confirmed', () => {
    const out = learned(B3(), 'carrier', null);
    const r = out.evidence.result;
    expect(r.findings.map((f: any) => [f.rule_id, f.amount, f.needs_human_review])).toEqual([['DET-UNBILLED', '125.00', false]]);
    expect([r.recoverable_total, r.pending_review_total]).toEqual(['125.00', '0.00']);
    expect(out.evidence).toEqual(step5(B3(), 'carrier'));
  });
  it('CI-L07 carrier, L0: same finding switched to review with one extra step', () => {
    const base = R.applyRules(B3(), 'carrier', ST()).findings[0];
    const out = learned(B3(), 'carrier', L0);
    const r = out.evidence.result;
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toEqual({ ...base, needs_human_review: true, calculation: [...base.calculation, DET_EXTRA_B3] });
    expect(r.findings[0].confidence).toBe(0.85);
    expect([r.recoverable_total, r.pending_review_total]).toEqual(['0.00', '125.00']);
    expect([out.reviewFlagsCount, out.learnedFindingsCount]).toEqual([1, 0]);
    expect(out.evidence.demand_letter).toContain(NO_CONFIRMED);
    expectRendered(out.evidence, B3());
  });
  it('CI-L08 shipper, L0: own findings unchanged; the ignored DET-UNBILLED is flagged', () => {
    const s5 = R.applyRules(B3(), 'shipper', ST());
    const out = learned(B3(), 'shipper', L0);
    const r = out.evidence.result;
    expect(r.findings).toEqual(s5.findings);
    expect([r.recoverable_total, r.pending_review_total]).toEqual([s5.recoverable_total, s5.pending_review_total]);
    const det = r.ignored_findings.filter((f: any) => f.rule_id === 'DET-UNBILLED');
    expect(det).toHaveLength(1);
    expect(det[0].needs_human_review).toBe(true);
    expect(det[0].calculation.at(-1)).toBe(DET_EXTRA_B3);
    expect(out.reviewFlagsCount).toBe(0);
  });
  it('CI-L09 abstaining description -> equals buildEvidence exactly', () => {
    for (const p of ['carrier', 'shipper'] as const) expect(learned(B3('Wait time'), p, L0).evidence, p).toEqual(step5(B3('Wait time'), p));
  });
});

describe('T4 learning and rule independence', () => {
  const P = () => bundle({ invoice: inv([['Pallet jack rental', '60.00']]), rate_confirmation: rc({ authorized_accessorials: [], linehaul_rate: null, fuel_surcharge: null }) });
  const ID = '55555555-5555-4555-8555-555555555555';
  it('CI-L10 learning from correction (pure)', () => {
    const e0 = learned(P(), 'shipper', L0);
    expect(e0.learnedFindingsCount).toBe(0);
    expect(e0.evidence).toEqual(step5(P(), 'shipper'));
    const e1 = learned(P(), 'shipper', C.buildChargeClassifier([{ id: ID, description: 'Pallet jack rental', category: 'accessorial' }]));
    const lrn = e1.evidence.result.findings.filter((f: any) => f.rule_id === 'LRN-ACCESSORIAL-REVIEW');
    expect(lrn).toHaveLength(1);
    expect(lrn[0].explanation).toContain("'Pallet jack rental' (your team's label)");
    expect(lrn[0].calculation[0]).toBe("Nearest labelled example: 'Pallet jack rental' (your team's label) = accessorial, similarity 1.000.");
    expect(lrn[0].amount).toBe('60.00');
    expect(e1.evidence.result.pending_review_total).toBe('60.00');
    const e2 = learned(P(), 'shipper', C.buildChargeClassifier([{ id: ID, description: 'Pallet jack rental', category: 'other' }]));
    expect(e2.learnedFindingsCount).toBe(0);
    expect(e2.evidence).toEqual(step5(P(), 'shipper'));
  });
  it('CI-L11 labels never change rule outputs', () => {
    const L = C.buildChargeClassifier([{ id: ID, description: 'Lumper fee', category: 'other' }]);
    const r = learned(B1(), 'shipper', L).evidence.result;
    const unauth = r.findings.filter((f: any) => f.rule_id === 'INV-ACCESSORIAL-UNAUTH');
    expect(unauth).toHaveLength(1);
    expect(unauth[0]).toEqual(R.applyRules(B1(), 'shipper', ST()).findings.find((f: any) => f.rule_id === 'INV-ACCESSORIAL-UNAUTH'));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// CI-L12 property: seeded corpus (mulberry32 seed 6012026, recorded), 360 bundles x 2 perspectives.
// ---------------------------------------------------------------------------------------------------------------
const PROP_SEED = 6012026;
const DESCS = ['Linehaul', 'Fuel surcharge', 'Detention', 'Lumper fee', 'Sort and segregate', 'Appointment fee', 'Scale ticket', 'Wait time', 'Driver waiting time', 'Pallet jack rental', 'Inside delivery', 'Customs', 'Freight charges', 'Storage', 'Stop-off', 'Misc', 'Re-delivery', 'Liftgate', 'Detention - driver wait', 'Residential delivery', 'Hazmat', 'Freight', 'Unloading wait'];
const AUTH = ['Appointment', 'Inside delivery', 'Detention', 'Customs', 'Storage', 'Lumper'];
const LABEL_POOL = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', description: 'Pallet jack rental', category: 'accessorial' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', description: 'Wait time', category: 'detention' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000003', description: 'Freight charges', category: 'linehaul' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000004', description: 'Sort and segregate', category: 'other' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000005', description: 'Unloading wait', category: 'detention' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000006', description: 'Scale ticket', category: 'accessorial' },
];
const cents = (d: string): bigint => { const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(d); if (!m) throw new Error(`amount ${d}`); const v = BigInt(m[2]!) * 100n + BigInt((m[3] ?? '').padEnd(2, '0')); return m[1] ? -v : v; };
const ctext = (c: bigint) => `${c < 0n ? '-' : ''}${(c < 0n ? -c : c) / 100n}.${String((c < 0n ? -c : c) % 100n).padStart(2, '0')}`;
const pyRepr = (xs: string[]) => `[${xs.map((x) => `'${x}'`).join(', ')}]`;

function genCase(rnd: () => number) {
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)] as T;
  const amt = () => { const r = rnd(); if (r < 0.05) return '0.00'; if (r < 0.08) return '-25.00'; return ctext(BigInt(1 + Math.floor(rnd() * 200000))); };
  const n = 1 + Math.floor(rnd() * 6);
  const lines: [string, string][] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0 && rnd() < 0.12) lines.push([...lines[Math.floor(rnd() * lines.length)]!] as [string, string]);
    else lines.push([pick(DESCS), amt()]);
  }
  const hasRc = rnd() < 0.8;
  const contract = () => (rnd() < 0.35 && lines.length ? pick(lines)[1] : rnd() < 0.5 ? null : ctext(BigInt(100000 + Math.floor(rnd() * 100000))));
  const det = rnd() < 0.6;
  const rcv = hasRc ? rc({ linehaul_rate: contract(), fuel_surcharge: contract(), authorized_accessorials: AUTH.filter(() => rnd() < 0.25), ...(det ? { detention_free_hours: '2', detention_rate_per_hour: '50.00', detention_max_hours: rnd() < 0.5 ? null : '8' } : {}) }) : null;
  const dwell = 60 + Math.floor(rnd() * 480);
  const bolv = det && rnd() < 0.85 ? bol({ arrival_time: '2026-03-02T08:00:00', departure_time: new Date(Date.UTC(2026, 2, 2, 8, dwell)).toISOString().slice(0, 19), appointment_time: null }) : null;
  const labels = rnd() < 0.5 ? [] : LABEL_POOL.filter(() => rnd() < 0.5);
  return { b: bundle({ invoice: inv(lines, { total: null }), rate_confirmation: rcv, bol: bolv }), labels };
}

// oExamples memoized on the exact label list: the corpus draws at most 64 distinct subsets of LABEL_POOL (59 occur), and
// rebuilding the seed features for each of the 360 bundles was about 40 % of this test's run time. The examples are only read.
const examplesMemo = new Map<string, OExample[]>();
const examplesFor = (labels: any[]): OExample[] => {
  const k = JSON.stringify(labels);
  let ex = examplesMemo.get(k);
  if (ex === undefined) { ex = oExamples(C.SEED_V1, labels); examplesMemo.set(k, ex); }
  return ex;
};

/** Oracle of C4.2: the expected LRN findings (in line order) and detention look-alike steps for one bundle. */
function expectC4(b: any, labels: any[]) {
  const ex = examplesFor(labels);
  const seen: { key: string; c: bigint }[] = [];
  const lrn: any[] = [];
  const steps: string[] = [];
  const ids: string[] = []; // C9 learnedLabelIds (fix round 1): tenant nearest of an LRN or a look-alike, line order, distinct
  const addId = (n: any) => { if (n.origin === 'tenant' && !ids.includes(n.labelId)) ids.push(n.labelId); };
  const rcv = b.rate_confirmation;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const auth = rcv ? rcv.authorized_accessorials.map(norm).filter((a: string) => a !== '') : [];
  for (const ln of b.invoice.lines) {
    const key = ln.description.trim().toLowerCase();
    const c = cents(ln.amount);
    if (seen.some((s) => s.key === key && s.c === c)) continue;
    seen.push({ key, c });
    if (R.classifyLine(ln.description) !== 'other' || c <= 0n) continue;
    const s = oSuggest(ex, ln.description, C.SEED_SOURCES);
    if (s.abstained || !s.nearest) continue;
    const exText = R.plain(s.nearest.text, 200);
    const origin = s.nearest.origin === 'seed' ? `public tariff example, ${s.nearest.sourceLabel}` : "your team's label";
    const sim = s.similarity.toFixed(3);
    if (s.category === 'detention') addId(s.nearest);
    if (s.category === 'detention') steps.push(`Possible detention billed under another name: '${ln.description}' = $${ln.amount} (nearest labelled example '${exText}', ${origin}, similarity ${sim}). Confirm before claiming.`);
    if (s.category !== 'accessorial' || !rcv) continue;
    const d = norm(ln.description);
    if (auth.some((a: string) => d.includes(a) || a.includes(d))) continue;
    if ([rcv.linehaul_rate, rcv.fuel_surcharge].some((x: string | null) => x !== null && cents(x) === c)) continue;
    addId(s.nearest);
    lrn.push({
      rule_id: 'LRN-ACCESSORIAL-REVIEW', title: 'Possible unauthorized accessorial (suggestion)', direction: 'overcharge', amount: ctext(c),
      explanation: `'${ln.description}' ($${ln.amount}) is not recognised by the fixed rules. Its nearest labelled example is '${exText}' (${origin}), labelled accessorial, and it is not listed as authorized on the rate confirmation. Suggestion only - verify before disputing.`,
      calculation: [`Nearest labelled example: '${exText}' (${origin}) = accessorial, similarity ${sim}.`, 'A suggestion needs similarity of at least 0.30.', `Authorized accessorials: ${rcv.authorized_accessorials.length ? pyRepr(rcv.authorized_accessorials) : 'none'}.`, `Charged: '${ln.description}' = $${ln.amount}.`],
      confidence: 0.5, needs_human_review: true,
    });
  }
  return { lrn, steps, ids };
}

describe('CI-L12 property over a seeded corpus (seed 6012026, 360 bundles)', () => {
  it('(a) strip learned -> applyRules; (b) totals; (c) LRN review/0.5; (d) null -> buildEvidence; (e) exact C4 oracle', () => {
    const rnd = oRng(PROP_SEED);
    let nLrn = 0; let nFlag = 0; let nBundles = 0;
    const isDetUn = (f: any) => f.rule_id === 'DET-UNBILLED' || f.rule_id === 'DET-UNDERBILLED';
    for (let i = 0; i < 360; i++) {
      const { b, labels } = genCase(rnd);
      const cls = C.buildChargeClassifier(labels);
      const exp = expectC4(b, labels);
      for (const p of ['shipper', 'carrier'] as const) {
        const tag = `case ${i} ${p} ${JSON.stringify(b.invoice.lines)} labels=${labels.map((l: any) => l.description)}`;
        const s5 = R.applyRules(b, p, ST());
        const out = learned(b, p, cls);
        const r = out.evidence.result;
        const flagged = exp.steps.length > 0;
        const revert = (fs: any[], orig: any[]) => {
          const rest = fs.filter((f) => f.rule_id !== 'LRN-ACCESSORIAL-REVIEW');
          expect(rest.length, `${tag} (a) length`).toBe(orig.length);
          return rest.map((f, k) => {
            if (!isDetUn(f) || !flagged) return f;
            const o = orig[k];
            expect(f.needs_human_review, `${tag} (e) flagged`).toBe(true);
            expect(f.calculation, `${tag} (e) steps`).toEqual([...o.calculation, ...exp.steps]);
            return { ...f, needs_human_review: o.needs_human_review, calculation: f.calculation.slice(0, o.calculation.length) };
          });
        };
        // (a)
        expect(revert(r.findings, s5.findings), `${tag} (a) own`).toEqual(s5.findings);
        expect(revert(r.ignored_findings, s5.ignored_findings), `${tag} (a) ignored`).toEqual(s5.ignored_findings);
        // (e) LRN placement: own for shipper, ignored for carrier, always after the step-5 findings
        const ownL = r.findings.filter((f: any) => f.rule_id === 'LRN-ACCESSORIAL-REVIEW');
        const ignL = r.ignored_findings.filter((f: any) => f.rule_id === 'LRN-ACCESSORIAL-REVIEW');
        expect(p === 'shipper' ? ownL : ignL, `${tag} (e) LRN`).toEqual(exp.lrn);
        expect(p === 'shipper' ? ignL : ownL, `${tag} (e) no LRN on the other side`).toEqual([]);
        expect(r.findings.slice(r.findings.length - ownL.length), `${tag} LRN last`).toEqual(ownL);
        expect(r.ignored_findings.slice(r.ignored_findings.length - ignL.length)).toEqual(ignL);
        expect(out.learnedFindingsCount, tag).toBe(ownL.length);
        expect(out.labelIds, `${tag} labelIds`).toEqual(exp.ids);
        expect(learned(b, p, null).labelIds, `${tag} null labelIds`).toEqual([]);
        expect(out.reviewFlagsCount, tag).toBe(flagged ? s5.findings.filter((f: any) => isDetUn(f) && !f.needs_human_review).length : 0);
        // (b)
        const sum = (fs: any[]) => ctext(fs.reduce((s, f) => s + cents(f.amount), 0n));
        expect(r.recoverable_total, `${tag} (b)`).toBe(sum(r.findings.filter((f: any) => !f.needs_human_review)));
        expect(r.pending_review_total, `${tag} (b)`).toBe(sum(r.findings.filter((f: any) => f.needs_human_review)));
        // (c)
        for (const f of [...r.findings, ...r.ignored_findings].filter((x: any) => x.rule_id === 'LRN-ACCESSORIAL-REVIEW')) expect([f.needs_human_review, f.confidence], tag).toEqual([true, 0.5]);
        // (d)
        expect(learned(b, p, null).evidence, `${tag} (d)`).toEqual(step5(b, p));
        expectRendered(out.evidence, b);
        // C4.7: nothing learned and nothing flagged -> identical to step 5
        if (exp.lrn.length === 0 && (!flagged || ![...s5.findings, ...s5.ignored_findings].some(isDetUn))) expect(out.evidence, `${tag} C4.7`).toEqual(step5(b, p));
        nLrn += ownL.length + ignL.length;
        if (flagged && [...s5.findings, ...s5.ignored_findings].some(isDetUn)) nFlag++;
      }
      nBundles++;
    }
    expect(nBundles).toBe(360);
    expect(nLrn, 'corpus produces LRN findings').toBeGreaterThan(40);
    expect(nFlag, 'corpus produces review flags').toBeGreaterThan(10);
  }, 20_000);
});

describe('T17 CI-L13 buildEvidenceLearned(...).labelIds (C1, C9 fix round 1)', () => {
  const PJR = '66666666-6666-4666-8666-666666666661';
  const TWT = '66666666-6666-4666-8666-666666666662';
  const pjr = { id: PJR, description: 'Pallet jack rental', category: 'accessorial' };
  const twt = { id: TWT, description: 'Truck waiting time', category: 'detention' };
  const rc0 = () => rc({ authorized_accessorials: [], linehaul_rate: null, fuel_surcharge: null });
  it('LRN lines whose nearest is the label -> [id] (distinct), both perspectives', () => {
    const b = bundle({ invoice: inv([['Pallet jack rental', '60.00'], ['Pallet jack rental', '60.00'], ['Pallet jack rentals', '70.00']]), rate_confirmation: rc0() });
    const cls = C.buildChargeClassifier([pjr]);
    const s = learned(b, 'shipper', cls);
    expect(s.labelIds).toEqual([PJR]);
    expect(s.learnedFindingsCount).toBe(2);
    const c = learned(b, 'carrier', cls);
    expect(c.labelIds).toEqual([PJR]);
    expect(c.learnedFindingsCount).toBe(0);
  });
  it('a detention look-alike whose nearest is a tenant label contributes its id; line order', () => {
    const cls = C.buildChargeClassifier([pjr, twt]);
    const one = bundle({ invoice: inv([['Truck waiting time', '50.00']]), rate_confirmation: rc0() });
    expect(learned(one, 'shipper', cls).labelIds).toEqual([TWT]);
    const both = bundle({ invoice: inv([['Truck waiting time', '50.00'], ['Pallet jack rental', '60.00']]), rate_confirmation: rc0() });
    expect(learned(both, 'shipper', cls).labelIds).toEqual([TWT, PJR]);
    expect(learned(both, 'carrier', cls).labelIds).toEqual([TWT, PJR]);
  });
  it('seed-only nearest examples contribute nothing; null classifier -> []', () => {
    expect(learned(B1(), 'shipper', L0).labelIds).toEqual([]);
    expect(learned(B3(), 'carrier', L0).labelIds).toEqual([]);
    expect(learned(B1(), 'shipper', null).labelIds).toEqual([]);
    expect(learned(B1(), 'shipper', C.buildChargeClassifier([pjr])).labelIds, 'label present but not nearest of any LRN/look-alike').toEqual([]);
  });
});
