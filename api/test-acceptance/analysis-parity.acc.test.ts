/* eslint-disable */
// REQ-20261010-step5-analysis parity against the Python reference: AN-P01..AN-P06 (test-spec T4; Part C P6).
// Oracle: helpers/rules_oracle.py (test-owned; public freight_recovery modules only; explicit Settings).
// Exact string equality everywhere (decimals as strings, lists element-wise). Missing Python fails in CI
// (CI=true) and skips locally with a message (existing convention, helpers/imp.ts pythonOrSkip).
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Session, buildTestApp, closeApps, sessionFor } from './helpers/client.js';
import * as A from './helpers/analysis.js';
import { projectFinding } from './helpers/analysis-vectors.js';
import * as H from './helpers/imp.js';
import { reseed } from './helpers/seed.js';

const ORACLE = resolve(__dirname, 'helpers', 'rules_oracle.py');
const SEED = Number(process.env.ACC_PARITY_SEED ?? 20261010);
const N_GENERATED = 1000;
const py = H.pythonOrSkip();
let S: any;
const counts: Record<string, number> = {};

function oracle(cases: any[]): any[] {
  const out: any[] = [];
  const dir = join(tmpdir(), 'fr-acc-py');
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < cases.length; i += 400) {
    const f = join(dir, `rules-${process.pid}-${i}.json`);
    writeFileSync(f, JSON.stringify(cases.slice(i, i + 400)));
    const r = spawnSync(py!.cmd, [ORACLE, f], { env: py!.env, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0) throw new Error(`rules oracle failed: ${r.stderr}`);
    out.push(...JSON.parse(r.stdout));
  }
  return out;
}

// ---- bundle builders (TS shape == Python model JSON) ----
const inv = (o: any = {}) => ({ ...S.emptyInvoice(), ...o, lines: (o.lines ?? []).map(([description, amount]: [string, string]) => ({ description, amount })) });
const rc = (o: any = {}) => ({ ...S.emptyRateConfirmation(), ...o });
const bol = (o: any = {}) => ({ ...S.emptyBillOfLading(), ...o });
const bundle = (o: { invoice?: any; rate_confirmation?: any; bol?: any } = {}) => ({ invoice: o.invoice ?? null, rate_confirmation: o.rate_confirmation ?? null, bol: o.bol ?? null, warnings: [] });
const settings = (inc = 15, tol = '0.01', win = 90) => ({ detentionIncrementMinutes: inc, amountTolerance: tol, disputeWindowDays: win });

/** TS side of one oracle case. Returns the same projection the oracle prints, or {error}. */
function tsRun(c: any): any {
  try {
    if (c.op === 'classify') return { category: S.classifyLine(c.description) };
    if (c.op === 'detention') {
      const r = S.computeDetention(c.bol, c.rc, c.inc ?? 15);
      return { calc: r === null ? null : { billable_hours: String(r.billable_hours), amount: String(r.amount), steps: [...r.steps] } };
    }
    const st = c.settings ?? settings();
    const res = S.applyRules(c.bundle, c.perspective, st);
    const out: any = { result: projResult(res) };
    if (c.op === 'letter') out.letter = S.buildDemandLetter(c.bundle, res, c.today, st.disputeWindowDays);
    if (c.op === 'markdown') {
      const b = c.bundle;
      const load = [b.invoice, b.rate_confirmation, b.bol].find((x: any) => x && x.load_number)?.load_number ?? null;
      const letter = S.buildDemandLetter(b, res, c.now.slice(0, 10), st.disputeWindowDays);
      out.letter = letter;
      out.markdown = S.renderPacketMarkdown(load, c.perspective, c.docs, b, res, letter);
      out.load_number = load;
    }
    return out;
  } catch (e: any) {
    return { error: e instanceof S.AnalysisInputError ? 'AnalysisInputError' : `${e?.name ?? 'Error'}: ${e?.message}` };
  }
}
const projF = (f: any) => ({ rule_id: f.rule_id, title: f.title, direction: f.direction, amount: String(f.amount), explanation: f.explanation, calculation: [...f.calculation], confidence: f.confidence, needs_human_review: f.needs_human_review });
const projResult = (r: any) => ({ perspective: r.perspective, findings: r.findings.map(projF), recoverable_total: String(r.recoverable_total), pending_review_total: String(r.pending_review_total), ignored_findings: r.ignored_findings.map(projF) });

/** Compare a corpus; Python errors must be TS AnalysisInputError (domain refusals), everything else string-identical. */
function compare(corpus: string, cases: any[]) {
  const pys = oracle(cases);
  const diffs: string[] = [];
  cases.forEach((c, i) => {
    const p = pys[i];
    const t = tsRun(c);
    if (p.error) {
      if (t.error !== 'AnalysisInputError') diffs.push(`#${i} ${c.op}: python ${p.error} (${p.message}) vs ts ${JSON.stringify(t).slice(0, 300)}`);
      return;
    }
    const pp = { ...p };
    const tt = { ...t };
    if (JSON.stringify(pp) !== JSON.stringify(tt)) {
      const keys = new Set([...Object.keys(pp), ...Object.keys(tt)]);
      const which = [...keys].filter((k) => JSON.stringify(pp[k]) !== JSON.stringify(tt[k]));
      diffs.push(`#${i} ${c.op} ${c.perspective ?? ''} differs in [${which}]\n input ${JSON.stringify(c).slice(0, 600)}\n py ${JSON.stringify(which.map((k) => pp[k])).slice(0, 900)}\n ts ${JSON.stringify(which.map((k) => tt[k])).slice(0, 900)}`);
    }
  });
  counts[corpus] = cases.length;
  console.log(`[AN-P06] ${corpus}: ${cases.length} cases compared, ${diffs.length} differences`);
  expect(diffs.slice(0, 5).join('\n\n'), `${corpus}: ${diffs.length} unregistered differences`).toBe('');
}

const ops = (b: any, persps: ('shipper' | 'carrier')[] = ['shipper', 'carrier'], extra: { settings?: any; docs?: any[]; now?: string } = {}) =>
  persps.map((p) => ({ op: 'markdown', bundle: b, perspective: p, settings: extra.settings ?? settings(), docs: extra.docs ?? [], now: extra.now ?? '2026-10-08T12:00:00' }));

describe.skipIf(!py)('AN-P02..P05 engine parity (pure)', () => {
  beforeAll(async () => { S = await import('@fr/shared'); });

  it('AN-P02: inputs of tests/test_rules.py and tests/test_regressions_rules.py (P6 domain), both perspectives', () => {
    const rc1 = (o: any = {}) => rc({ detention_free_hours: '2', detention_rate_per_hour: '50', detention_max_hours: '8', ...o });
    const rc2 = (o: any = {}) => rc({ detention_free_hours: '2', detention_rate_per_hour: '60', detention_max_hours: null, ...o });
    const t = (s: string) => s.replace(' ', 'T') + ':00';
    const bol1 = (arr: string, dep: string, appt?: string) => bol({ arrival_time: t(arr), departure_time: t(dep), appointment_time: appt ? t(appt) : null });
    const T0 = Date.UTC(2025, 0, 1, 8, 0, 0);
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19);
    const bol2 = (min: number) => bol({ arrival_time: iso(T0), departure_time: iso(T0 + min * 60000) });
    const cases: any[] = [];
    // detention math (test_rules)
    for (const [b, r] of [
      [bol1('2025-03-03 07:45', '2025-03-03 11:30', '2025-03-03 08:00'), rc1()],
      [bol1('2025-03-04 09:00', '2025-03-04 14:20'), rc1()],
      [bol1('2025-03-04 09:00', '2025-03-04 10:30'), rc1()],
      [bol1('2025-03-04 06:00', '2025-03-04 22:00'), rc1()],
      [bol(), rc1()],
      [bol1('2025-03-04 09:00', '2025-03-04 14:00'), rc()],
    ] as const) cases.push({ op: 'detention', bol: b, rc: r, inc: 15 });
    // regressions: increments, invariants, caps, departure before arrival
    for (const inc of [1, 5, 6, 7, 10, 12, 15, 20, 30, 45, 60]) cases.push({ op: 'detention', bol: bol2(120 + inc), rc: rc2(), inc });
    cases.push({ op: 'detention', bol: bol2(139), rc: rc2(), inc: 20 });
    for (const inc of [6, 7, 10, 15, 20, 25, 30]) for (let on = 100; on < 400; on += 7) cases.push({ op: 'detention', bol: bol2(on), rc: rc2(), inc });
    cases.push({ op: 'detention', bol: bol2(200), rc: rc2(), inc: 0 }); // Python ValueError <-> TS AnalysisInputError
    cases.push({ op: 'detention', bol: bol2(400), rc: rc2({ detention_max_hours: '0' }), inc: 15 });
    cases.push({ op: 'detention', bol: bol({ arrival_time: iso(T0), departure_time: iso(T0 - 6 * 3600000) }), rc: rc2(), inc: 15 });
    // classify_line
    for (const d of ['Linehaul incl fuel', 'Linehaul including fuel surcharge', 'Fuel Surcharge', 'FSC', 'Linehaul', 'Detention - fuel stop', 'Stop-off', 'Misc']) cases.push({ op: 'classify', description: d });
    // rule bundles
    const ld5001 = bundle({
      invoice: inv({ invoice_number: 'INV-1001', load_number: 'LD-5001', carrier: 'Acme Freight LLC', shipper: 'Widget Co', invoice_date: '2025-03-10', lines: [['Linehaul', '1500.00'], ['Fuel Surcharge', '168.00'], ['Detention', '300.00'], ['Lumper', '150.00']], total: '2118.00' }),
      rate_confirmation: rc({ load_number: 'LD-5001', carrier: 'Acme Freight LLC', linehaul_rate: '1400.00', fuel_surcharge: '168.00', detention_free_hours: '2', detention_rate_per_hour: '50.00', detention_max_hours: '8', authorized_accessorials: ['Detention'] }),
      bol: bol({ load_number: 'LD-5001', facility: 'Widget Co DC 4', appointment_time: '2025-03-03T08:00:00', arrival_time: '2025-03-03T07:45:00', departure_time: '2025-03-03T11:30:00' }),
    });
    const ld5002 = bundle({
      invoice: inv({ invoice_number: 'INV-2002', load_number: 'LD-5002', carrier: 'Acme Freight LLC', shipper: 'Widget Co', invoice_date: '2025-03-12', lines: [['Linehaul', '1400.00'], ['Fuel Surcharge', '168.00']], total: '1568.00' }),
      rate_confirmation: rc({ load_number: 'LD-5002', carrier: 'Acme Freight LLC', linehaul_rate: '1400.00', fuel_surcharge: '168.00', detention_free_hours: '2', detention_rate_per_hour: '50.00', detention_max_hours: '8', authorized_accessorials: ['Detention'] }),
      bol: bol({ load_number: 'LD-5002', facility: 'Widget Co DC 4', appointment_time: '2025-03-04T09:00:00', arrival_time: '2025-03-04T09:00:00', departure_time: '2025-03-04T14:20:00' }),
    });
    const docs = [{ filename: 'invoice.txt', doc_type: 'invoice', sha256: 'a'.repeat(64) }, { filename: 'rate_confirmation.txt', doc_type: 'rate_confirmation', sha256: 'b'.repeat(64) }, { filename: 'bol.txt', doc_type: 'bol', sha256: 'c'.repeat(64) }];
    const bundles = [
      ld5001, ld5002,
      bundle({ invoice: inv({ lines: [['Detention', '50.00']] }), rate_confirmation: rc1(), bol: bol1('2025-03-04 09:00', '2025-03-04 14:20') }),
      bundle({ invoice: inv({ lines: [['Linehaul', '1000'], ['Linehaul', '1000']], total: '2100' }), rate_confirmation: rc({ linehaul_rate: '1000' }) }),
      bundle({ invoice: inv({ lines: [['Linehaul', '1400']], total: '1400' }), rate_confirmation: rc({ linehaul_rate: '1400' }) }),
      bundle(),
      bundle({ invoice: inv({ lines: [['Detention', '60'], ['Detention', '60']], total: '120' }), rate_confirmation: rc2(), bol: bol2(180) }),
      bundle({ invoice: inv({ lines: [['Lumper', '150']] }), rate_confirmation: rc({ authorized_accessorials: [] }) }),
      bundle({ invoice: inv({ lines: [['Lumper', '100'], ['Lumper', '100']] }), rate_confirmation: rc({ authorized_accessorials: ['lumper'] }) }),
      bundle({ invoice: inv({ lines: [['Linehaul incl fuel', '1000'], ['Fuel Surcharge', '100']] }), rate_confirmation: rc({ linehaul_rate: '1000', fuel_surcharge: '100' }) }),
      bundle({ invoice: inv({ lines: [['Stop-off', '75']] }), rate_confirmation: rc({ authorized_accessorials: ['stop off'] }) }),
      bundle({ invoice: inv({ lines: [['Lumper fee', '100']] }), rate_confirmation: rc({ authorized_accessorials: [''] }) }),
      bundle({ invoice: inv({ lines: [['Detention', '50']] }), rate_confirmation: rc2(), bol: bol2(260) }),
    ];
    const LINES: [string, string][][] = [[], [['Linehaul', '1000']], [['Linehaul', '1500'], ['Fuel Surcharge', '300']], [['Detention', '60'], ['Detention', '60']], [['Detention', '300'], ['Lumper', '150'], ['Lumper', '150']], [['Linehaul incl fuel', '1000'], ['Fuel Surcharge', '100'], ['Stop-off', '75']]];
    for (const lines of LINES) for (const total of [null, '0', '500', '1000', '2500', '99999']) for (const b of [null, 100, 180, 900])
      bundles.push(bundle({ invoice: inv({ lines, total }), rate_confirmation: rc2({ linehaul_rate: '1000', fuel_surcharge: '100', authorized_accessorials: ['detention'] }), bol: b === null ? null : bol2(b) }));
    bundles.forEach((b, i) => cases.push(...ops(b, ['shipper', 'carrier'], { docs: i < 2 ? docs : [], now: i % 2 ? '2025-03-15T00:00:00' : '2026-10-08T12:00:00' })));
    for (const b of bundles) cases.push({ op: 'letter', bundle: b, perspective: 'shipper', settings: settings(), today: '2025-03-15' });
    compare('P02 python-tests', cases);
  }, 300000);

  it(`AN-P03: generated corpus, seed ${SEED} (mulberry32), ${N_GENERATED} bundles x 2 perspectives`, () => {
    const R = H.rng(SEED);
    const DESC = ['Linehaul', 'LINEHAUL', 'line haul', 'Line-Haul', 'linehaul.', 'Fuel Surcharge', 'fuel surcharge', 'FUEL SURCHARGE', 'Fuel', 'fuel adj', 'Fuel FSC', 'FSC', 'Detention', 'DETENTION', 'detention fee', 'Dwell time', 'Lumper', 'lumper fee', 'LUMPER', 'Layover', 'TONU', 'Truck order not used', 'Stop off', 'Stop-off', 'stop off', 'STOP-OFF', 'Driver assist', "Driver's assist", 'Liftgate', 'Reconsign', 'Redeliver', 'Inside delivery', 'Residential', 'Linehaul incl fuel', 'Linehaul including fuel surcharge', 'Linehaul (inc. fuel)', 'Misc', 'Accessorial charge', 'Handling', 'He said "rush"', "O'Brien handling", 'Lumper fee', 'Détention', 'Café stop', 'Ünloading', '运费', '附加费 fuel', '  padded lumper  ', ''];
    const FIXED_AMT = ['0', '-0.00', '0.01', '1.005', '1.015', '0.000001', '999999999999999.999999', '-1.00', '-250.5', '100', '100.00', '60', '1400.00'];
    const randAmt = () => {
      const intPart = String(R.int(100000));
      const d = R.int(7);
      const frac = d ? '.' + Array.from({ length: d }, () => R.int(10)).join('') : '';
      return (R() < 0.05 ? '-' : '') + intPart + frac;
    };
    const amt = () => (R() < 0.4 ? R.pick(FIXED_AMT) : randAmt());
    const MICRO = 1000000n;
    const toMicros = (d: string) => { const neg = d.startsWith('-'); const [i, f = ''] = d.replace('-', '').split('.'); const v = BigInt(i!) * MICRO + BigInt((f + '000000').slice(0, 6)); return neg ? -v : v; };
    const fromMicros = (m: bigint) => { const neg = m < 0n; const a = neg ? -m : m; const i = (a / MICRO).toString(); const f = (a % MICRO).toString().padStart(6, '0').replace(/0+$/, ''); return (neg ? '-' : '') + i + (f ? '.' + f : ''); };
    const inDomain = (d: string) => /^-?(0|[1-9][0-9]{0,14})(\.[0-9]{1,6})?$/.test(d);
    const p2 = (n: number) => String(n).padStart(2, '0');
    const dt = (ms: number) => { const x = new Date(ms); return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${p2(x.getUTCHours())}:${p2(x.getUTCMinutes())}:${p2(x.getUTCSeconds())}`; };
    const STR = ['Acme Freight LLC', 'Widget Co', 'O\'Hare Logistics', 'Spedition Müller', '北京物流', 'A "quoted" carrier', 'Load *bold* _x_', 'Pipe | Co', 'Hash # Co', 'x'.repeat(200), null];
    const ACC = ['Detention', 'Lumper', 'stop off', '', "Driver's assist", 'a b', 'Liftgate', 'TONU', 'layover'];
    const cases: any[] = [];
    for (let n = 0; n < N_GENERATED; n++) {
      const lines: [string, string][] = [];
      const k = R.int(9);
      for (let j = 0; j < k; j++) {
        if (lines.length && R() < 0.2) {
          const [d, a] = R.pick(lines);
          const alt = R() < 0.5 ? a : /^-?\d+$/.test(a) ? a + '.00' : a.endsWith('.00') ? a.slice(0, -3) : a;
          lines.push([d, inDomain(alt) ? alt : a]);
        } else lines.push([R.pick(DESC), amt()]);
      }
      const sum = lines.reduce((s, [, a]) => s + toMicros(a), 0n);
      let total: string | null = null;
      const tr = R();
      if (tr < 0.33) total = fromMicros(sum);
      else if (tr < 0.66) total = fromMicros(sum + BigInt(R.int(2000001) - 1000000) * 10000n);
      if (total !== null && !inDomain(total)) total = null;
      const hasInv = R() > 0.1, hasRc = R() > 0.1, hasBol = R() > 0.15;
      const nul = (v: any) => (R() < 0.2 ? null : v);
      const invoice = hasInv ? inv({ invoice_number: R.pick(['INV-1', 'INV `x`', '<b>INV</b>', null]), load_number: R.pick(['LD-1', 'LD [x](y)', null, '']), carrier: R.pick(STR), shipper: R.pick(STR), invoice_date: R.pick(['2025-03-10', '03/10/2025', null]), lines, total }) : null;
      const rate = hasRc ? rc({ load_number: R.pick(['LD-1', null]), carrier: R.pick(STR), linehaul_rate: nul(amt()), fuel_surcharge: nul(amt()), detention_free_hours: nul(R.pick(['0', '1', '2', '2.0', '2.5', '2.50', '3', '0.25'])), detention_rate_per_hour: nul(R.pick(['50', '50.00', '33.333333', '60', '75.5', '0.000001', '999999999999999.999999'])), detention_max_hours: R() < 0.5 ? null : R.pick(['0', '8', '8.0', '4.5', '100']), authorized_accessorials: ACC.filter(() => R() < 0.3) }) : null;
      let b: any = null;
      if (hasBol) {
        const arr = Date.UTC(2025, 0, 1) + R.int(364 * 86400) * 1000;
        const appt = R() < 0.3 ? null : arr + (R.int(241) - 120) * 60000 + R.int(60) * 1000;
        const dep = R() < 0.05 ? arr - R.int(600) * 60000 - R.int(60) * 1000 : arr + R.int(1200) * 60000 + R.int(60) * 1000;
        b = bol({ load_number: R.pick(['LD-1', null]), facility: R.pick(['Widget Co DC 4', 'Dock <7>', null]), arrival_time: R() < 0.05 ? null : dt(arr), departure_time: R() < 0.05 ? null : dt(dep), appointment_time: appt === null ? null : dt(appt) });
      }
      const st = settings(1 + R.int(240), R.pick(['0', '0.01', '1.00']), 1 + R.int(3650));
      const docs = Array.from({ length: R.int(4) }, (_, i) => ({ filename: R.pick(['invoice.txt', 'rc `1`.pdf', '<x>.csv', 'bol|1.txt', 'scan#2.png']), doc_type: R.pick(['invoice', 'rate_confirmation', 'bol', 'unknown']), sha256: i.toString(16).repeat(64).slice(0, 64) }));
      const now = dt(Date.UTC(2025, 0, 1) + R.int(2 * 365 * 86400) * 1000);
      const bun = bundle({ invoice, rate_confirmation: rate, bol: b });
      cases.push(...ops(bun, ['shipper', 'carrier'], { settings: st, docs, now }));
      if (b && rate) cases.push({ op: 'detention', bol: b, rc: rate, inc: st.detentionIncrementMinutes });
      for (const [d] of lines) cases.push({ op: 'classify', description: d });
    }
    console.log(`[AN-P03] seed ${SEED}`);
    compare(`P03 generated seed=${SEED}`, cases);
  }, 600000);

  it('AN-P04: edge list (years 1000/9999, leap day, 15-digit amounts, 6-decimal rate with increment 7, 2.0/2.50 free hours, max 0/8.0, 200-code-point strings, Markdown metacharacters)', () => {
    const META = '` * _ [ ] < > | ~ & # \\';
    const s200 = 'é'.repeat(199) + '#';
    const cases: any[] = [];
    const base = (o: any) => bundle({ invoice: inv({ invoice_number: 'INV-E', load_number: 'LD-E', carrier: 'Carrier E', shipper: 'Shipper E', lines: [['Detention', '10.00'], ['Lumper', '1.00']], total: '20.00', ...o.inv }), rate_confirmation: rc({ detention_free_hours: '2', detention_rate_per_hour: '50', detention_max_hours: '8', linehaul_rate: '1.00', ...o.rc }), bol: bol({ facility: 'Dock', arrival_time: '2025-03-03T08:00:00', departure_time: '2025-03-03T12:00:00', ...o.bol }) });
    const variants = [
      base({ bol: { arrival_time: '1000-01-01T00:00:00', departure_time: '1000-01-01T05:00:00', appointment_time: '1000-01-01T00:30:00' } }),
      base({ bol: { arrival_time: '9999-12-31T18:00:00', departure_time: '9999-12-31T23:59:59' } }),
      base({ bol: { arrival_time: '2024-02-28T22:00:00', departure_time: '2024-02-29T03:07:41', appointment_time: '2024-02-29T00:00:00' } }),
      base({ inv: { lines: [['Linehaul', '999999999999999.99'], ['Linehaul', '999999999999999.99']], total: '999999999999999.999999' }, rc: { linehaul_rate: '0.01' } }),
      base({ rc: { detention_rate_per_hour: '33.333333' } }),
      base({ rc: { detention_free_hours: '2.0' } }),
      base({ rc: { detention_free_hours: '2.50', detention_max_hours: '0' } }),
      base({ rc: { detention_max_hours: '8.0' }, bol: { departure_time: '2025-03-04T08:00:00' } }),
      base({ inv: { carrier: s200, shipper: s200, invoice_number: s200, load_number: s200, lines: [[s200, '5.00'], [s200, '5.00']] }, bol: { facility: s200 } }),
      base({ inv: { carrier: META, shipper: META, invoice_number: META, load_number: META, lines: [[META, '7.00'], [META, '7.00'], ['Lumper ' + META, '3.00']] }, rc: { authorized_accessorials: [META] }, bol: { facility: META } }),
      base({ inv: { carrier: '<script>alert(1)</script>', invoice_number: '`rm -rf`', lines: [['[x](y)', '1.00'], ['| table |', '2.00'], ['# heading', '3.00']] } }),
    ];
    const docs = [{ filename: META, doc_type: 'invoice', sha256: 'e'.repeat(64) }, { filename: s200, doc_type: 'unknown', sha256: 'f'.repeat(64) }];
    for (const v of variants) for (const inc of [7, 15]) cases.push(...ops(v, ['shipper', 'carrier'], { settings: settings(inc, '0.01', 90), docs, now: '2026-10-10T23:30:00' }));
    for (const v of variants) cases.push({ op: 'detention', bol: v.bol, rc: v.rate_confirmation, inc: 7 });
    compare('P04 edge list', cases);
  }, 300000);

  it('AN-P05 (RD1): timezone offsets are not compared; TS throws AnalysisInputError', () => {
    const r = rc({ detention_free_hours: '2', detention_rate_per_hour: '60' });
    for (const t of ['2025-01-01T08:00:00Z', '2025-01-01T08:00:00+02:00', '2025-01-01T08:00:00-05:00']) {
      const b = bol({ arrival_time: t, departure_time: '2025-01-01T13:00:00' });
      expect(() => S.computeDetention(b, r, 15), t).toThrow(S.AnalysisInputError);
      expect(() => S.applyRules(bundle({ invoice: inv(), rate_confirmation: r, bol: b }), 'carrier', settings()), t).toThrow(S.AnalysisInputError);
    }
    counts['P05 RD1 refusals'] = 6;
  });
});

describe.skipIf(!py)('AN-P01 end to end: upload + commit + analyze vs Python run_pipeline', () => {
  let app: FastifyInstance;
  let an: Session, rv: Session, vw: Session;
  beforeAll(async () => {
    await H.assertS3Reachable();
    reseed();
    app = await buildTestApp();
    an = await sessionFor(app, ACCOUNTS.ANALYST);
    rv = await sessionFor(app, ACCOUNTS.REVIEWER);
    vw = await sessionFor(app, ACCOUNTS.VIEWER);
  }, 180000);
  afterAll(async () => { try { await closeApps(); } finally { reseed(); } });

  for (const set of ['ld5001', 'ld5002'] as const) for (const persp of ['SHIPPER', 'CARRIER'] as const) {
    it(`${set} x ${persp}`, async () => {
      const load = H.uniqLoad(`P1${set.slice(-1)}${persp[0]}`);
      const files = set === 'ld5001' ? A.LD5001(load) : A.LD5002(load);
      const made = await A.makeClaim(an, rv, files, persp, load);
      const r = await A.analyze(an, made.claimId);
      expect(r.status, r.text).toBe(201);
      const p = (await vw.get(`/claims/${made.claimId}/packet`)).body;
      const now = new Date(p.generatedAt).toISOString().slice(0, 23); // naive UTC (RD6)
      const [out] = oracle([{ op: 'pipeline', perspective: persp.toLowerCase(), now, settings: settings(), files: files.map((f) => ({ name: f.name, b64: f.bytes.toString('base64') })) }]);
      expect(out.error, JSON.stringify(out)).toBeUndefined();
      const pyFindings = out.result.findings.map((f: any) => ({ ruleId: f.rule_id, title: f.title, direction: f.direction.toUpperCase(), amountCents: A.cents(f.amount), explanation: f.explanation, calculation: f.calculation, confidence: f.confidence, needsHumanReview: f.needs_human_review }));
      expect(p.findings.map(projectFinding)).toEqual(pyFindings);
      expect(p.recoverableCents).toBe(A.cents(out.result.recoverable_total));
      expect(p.pendingReviewCents).toBe(A.cents(out.result.pending_review_total));
      expect(r.body.analysis.ignoredFindingsCount).toBe(out.result.ignored_findings.length);
      expect(p.demandLetter).toBe(out.letter);
      expect(p.loadNumber).toBe(out.load_number);
      counts['P01 end-to-end'] = (counts['P01 end-to-end'] ?? 0) + 1;
    }, 180000);
  }
  it('AN-P06 report', () => {
    console.log(`[AN-P06] compared cases per corpus: ${JSON.stringify(counts)}`);
    writeFileSync(join(tmpdir(), 'fr-acc-parity-counts.json'), JSON.stringify({ seed: SEED, python: py?.cmd ?? null, counts }, null, 1));
  });
});
