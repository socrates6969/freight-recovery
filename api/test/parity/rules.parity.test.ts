/**
 * Rules parity harness (REQ-20261010-step5-analysis, spec A6): the TypeScript rules engine and evidence
 * renderers (`@fr/shared/analysis`) against the Python reference (tools/parity/rules_dump.py) on the
 * fixtures (end to end through the TS parser), the in-domain inputs of tests/test_rules.py and
 * tests/test_regressions_rules.py, and a seeded generated corpus. Comparisons are exact string equality.
 * Registered divergences RD1-RD6 are the only allowed differences; the corpus avoids their inputs
 * (no offsets, years >= 1000, no case-mapping edge code points, same `now` on both sides, the same docs).
 *
 * Runs in `npm run test:integration`. Needs Python with the repository's runtime deps; in CI a missing
 * interpreter FAILS the suite, locally it is skipped with a message.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AnalysisInputError,
  applyRules,
  buildEvidence,
  classifyLine,
  computeDetention,
  type AnalysisPerspective,
  type AnalysisSettings,
  type BillOfLading,
  type EvidenceDoc,
  type ExtractedBundle,
  type RateConfirmation,
} from '@fr/shared';
import { beforeAll, describe, expect, it } from 'vitest';

import { assembleBundle } from '../../src/imports/bundle.js';
import { parseDocument } from '../../src/imports/parse/pipeline.js';
import type { DetectedType } from '../../src/imports/parse/types.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LIMITS = { pdfPages: 50, textChars: 2_000_000, imagePixels: 50_000_000 };
/** Recorded PRNG seed of the generated corpus. */
export const CORPUS_SEED = 20261010;
const GENERATED_BUNDLES = 1200;
const GENERATED_DETENTIONS = 300;

function findPython(): string | null {
  const candidates = [process.env['PYTHON'], 'python3', 'python'].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    const r = spawnSync(c, ['-c', 'import freight_recovery.rules, freight_recovery.evidence, pydantic; print("ok")'], {
      env: { ...process.env, PYTHONPATH: path.join(repoRoot, 'src') },
      encoding: 'utf8',
    });
    if (r.status === 0 && r.stdout.trim() === 'ok') return c;
  }
  return null;
}

const python = findPython();
const inCi = Boolean(process.env['CI']);

// ---------------------------------------------------------------------------------------------
// Case model
// ---------------------------------------------------------------------------------------------

interface PySettings {
  increment: number;
  tolerance: string;
  window: number;
}

type Case =
  | { id: string; kind: 'bundle'; bundle: ExtractedBundle; docs: EvidenceDoc[]; perspective: AnalysisPerspective; settings: PySettings; now: string }
  | { id: string; kind: 'files'; files: { name: string; b64: string }[]; perspective: AnalysisPerspective; settings: PySettings; now: string }
  | { id: string; kind: 'classify'; descriptions: string[]; settings: PySettings }
  | { id: string; kind: 'detention'; bol: BillOfLading; rc: RateConfirmation; settings: PySettings };

interface PyOut {
  id: string;
  error?: string;
  result?: unknown;
  letter?: string;
  markdown?: string;
  load_number?: string | null;
  classes?: string[];
  detention?: unknown;
}

const DEFAULT_PY: PySettings = { increment: 15, tolerance: '0.01', window: 90 };
const toSettings = (s: PySettings): AnalysisSettings => ({ detentionIncrementMinutes: s.increment, amountTolerance: s.tolerance, disputeWindowDays: s.window });

function inv(lines: [string, string][], total: string | null = null, extra: Partial<NonNullable<ExtractedBundle['invoice']>> = {}): NonNullable<ExtractedBundle['invoice']> {
  return {
    invoice_number: null,
    load_number: null,
    carrier: null,
    shipper: null,
    invoice_date: null,
    lines: lines.map(([description, amount]) => ({ description, amount })),
    total,
    extraction_warnings: [],
    ...extra,
  };
}

function rc(extra: Partial<RateConfirmation> = {}): RateConfirmation {
  return {
    load_number: null,
    carrier: null,
    linehaul_rate: null,
    fuel_surcharge: null,
    detention_free_hours: null,
    detention_rate_per_hour: null,
    detention_max_hours: null,
    authorized_accessorials: [],
    extraction_warnings: [],
    ...extra,
  };
}

function bol(arrival: string | null, departure: string | null, appointment: string | null = null, extra: Partial<BillOfLading> = {}): BillOfLading {
  return { load_number: null, facility: null, appointment_time: appointment, arrival_time: arrival, departure_time: departure, extraction_warnings: [], ...extra };
}

const bundleOf = (b: Partial<ExtractedBundle>): ExtractedBundle => ({ invoice: null, rate_confirmation: null, bol: null, warnings: [], ...b });

// ---------------------------------------------------------------------------------------------
// Reference-test inputs (tests/test_rules.py, tests/test_regressions_rules.py), in the P6 domain
// ---------------------------------------------------------------------------------------------

function referenceCases(): Case[] {
  const out: Case[] = [];
  const now = '2025-03-15T00:00:00';
  const add = (id: string, b: ExtractedBundle, perspective: AnalysisPerspective, settings = DEFAULT_PY) => {
    out.push({ id, kind: 'bundle', bundle: b, docs: [], perspective, settings, now });
  };
  const det = (id: string, b: BillOfLading, r: RateConfirmation, increment = 15) => {
    out.push({ id, kind: 'detention', bol: b, rc: r, settings: { ...DEFAULT_PY, increment } });
  };
  // test_rules.py
  const rcA = (x: Partial<RateConfirmation> = {}) => rc({ detention_free_hours: '2', detention_rate_per_hour: '50', detention_max_hours: '8', ...x });
  det('tr-early', bol('2025-03-03T07:45:00', '2025-03-03T11:30:00', '2025-03-03T08:00:00'), rcA());
  det('tr-round', bol('2025-03-04T09:00:00', '2025-03-04T14:20:00'), rcA());
  det('tr-free', bol('2025-03-04T09:00:00', '2025-03-04T10:30:00'), rcA());
  det('tr-cap', bol('2025-03-04T06:00:00', '2025-03-04T22:00:00'), rcA());
  det('tr-missing-bol', bol(null, null), rcA());
  det('tr-missing-rc', bol('2025-03-04T09:00:00', '2025-03-04T14:00:00'), rc());
  add('tr-underbilled', bundleOf({ invoice: inv([['Detention', '50.00']]), rate_confirmation: rcA(), bol: bol('2025-03-04T09:00:00', '2025-03-04T14:20:00') }), 'carrier');
  add('tr-dup-total', bundleOf({ invoice: inv([['Linehaul', '1000'], ['Linehaul', '1000']], '2100'), rate_confirmation: rc({ linehaul_rate: '1000' }) }), 'shipper');
  add('tr-clean', bundleOf({ invoice: inv([['Linehaul', '1400']], '1400'), rate_confirmation: rc({ linehaul_rate: '1400' }) }), 'shipper');
  add('tr-empty', bundleOf({}), 'shipper');
  add('tr-empty-carrier', bundleOf({}), 'carrier');
  // test_regressions_rules.py
  const T0 = Date.UTC(2025, 0, 1, 8, 0, 0);
  const at = (ms: number) => new Date(ms).toISOString().slice(0, 19);
  const bolMin = (minutes: number, appt: string | null = null) => bol(at(T0), at(T0 + minutes * 60_000), appt);
  const rcB = (x: Partial<RateConfirmation> = {}) => rc({ detention_free_hours: '2', detention_rate_per_hour: '60', ...x });
  for (const i of [1, 5, 6, 7, 10, 12, 15, 20, 30, 45, 60]) det(`rr-one-inc-${i}`, bolMin(120 + i), rcB(), i);
  det('rr-under-inc', bolMin(139), rcB(), 20);
  for (const i of [6, 7, 10, 15, 20, 25, 30]) for (let onSite = 100; onSite < 400; onSite += 7) det(`rr-inv-${i}-${onSite}`, bolMin(onSite), rcB(), i);
  det('rr-max-zero', bolMin(400), rcB({ detention_max_hours: '0' }));
  det('rr-dep-before', bol(at(T0), at(T0 - 6 * 3_600_000)), rcB());
  add('rr-dup-det', bundleOf({ invoice: inv([['Detention', '60'], ['Detention', '60']], '120'), rate_confirmation: rcB(), bol: bolMin(180) }), 'shipper');
  add('rr-review-only', bundleOf({ invoice: inv([['Lumper', '150']]), rate_confirmation: rc() }), 'shipper');
  add('rr-two-lumpers', bundleOf({ invoice: inv([['Lumper', '100'], ['Lumper', '100']]), rate_confirmation: rc({ authorized_accessorials: ['lumper'] }) }), 'shipper');
  add('rr-lh-incl-fuel', bundleOf({ invoice: inv([['Linehaul incl fuel', '1000'], ['Fuel Surcharge', '100']]), rate_confirmation: rc({ linehaul_rate: '1000', fuel_surcharge: '100' }) }), 'shipper');
  add('rr-hyphen', bundleOf({ invoice: inv([['Stop-off', '75']]), rate_confirmation: rc({ authorized_accessorials: ['stop off'] }) }), 'shipper');
  add('rr-blank-auth', bundleOf({ invoice: inv([['Lumper fee', '100']]), rate_confirmation: rc({ authorized_accessorials: [''] }) }), 'shipper');
  add('rr-carrier-review', bundleOf({ invoice: inv([['Detention', '50']]), rate_confirmation: rcB(), bol: bolMin(260) }), 'carrier');
  const grid: [string, string][][] = [
    [],
    [['Linehaul', '1000']],
    [['Linehaul', '1500'], ['Fuel Surcharge', '300']],
    [['Detention', '60'], ['Detention', '60']],
    [['Detention', '300'], ['Lumper', '150'], ['Lumper', '150']],
    [['Linehaul incl fuel', '1000'], ['Fuel Surcharge', '100'], ['Stop-off', '75']],
  ];
  const totals = [null, '0', '500', '1000', '2500', '99999'];
  const bols = [null, bolMin(100), bolMin(180), bolMin(900)];
  grid.forEach((lines, li) =>
    totals.forEach((total, ti) =>
      bols.forEach((b, bi) => {
        for (const p of ['shipper', 'carrier'] as const) {
          add(`rr-grid-${li}-${ti}-${bi}-${p}`, bundleOf({ invoice: inv(lines, total), rate_confirmation: rcB({ linehaul_rate: '1000', fuel_surcharge: '100', authorized_accessorials: ['detention'] }), bol: b }), p);
        }
      }),
    ),
  );
  // Refused by both sides (the reference raises ValueError for a zero increment).
  det('refuse-zero-inc', bolMin(200), rcB(), 0);
  out.push({
    id: 'rr-classify',
    kind: 'classify',
    descriptions: ['Linehaul incl fuel', 'Linehaul including fuel surcharge', 'Fuel Surcharge', 'FSC', 'Linehaul', 'Detention - fuel stop', 'Stop-off', 'Misc'],
    settings: DEFAULT_PY,
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Fixtures end to end (both fixtures x both perspectives)
// ---------------------------------------------------------------------------------------------

function fixtureCases(): Case[] {
  const out: Case[] = [];
  for (const dir of ['ld5001', 'ld5002']) {
    const base = path.join(repoRoot, 'tests', 'fixtures', dir);
    const files = readdirSync(base)
      .sort()
      .map((name) => ({ name, b64: readFileSync(path.join(base, name)).toString('base64') }));
    for (const p of ['shipper', 'carrier'] as const) out.push({ id: `fx-${dir}-${p}`, kind: 'files', files, perspective: p, settings: DEFAULT_PY, now: '2025-03-15T09:30:00' });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Seeded generated corpus
// ---------------------------------------------------------------------------------------------

/** mulberry32: small deterministic PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const KEYWORDS = [
  'Linehaul', 'Line haul', 'LINEHAUL incl fuel', 'Linehaul including fuel surcharge', 'Inc. linehaul', 'linehaul (included)', 'Fuel Surcharge', 'FSC', 'Fuel FSC', 'fuel',
  'Fuel adj', 'Detention', 'Dwell time', 'Detention - fuel stop', 'DETENTION/LAYOVER', 'Lumper', 'Lumper fee', 'Layover', 'TONU', 'Truck order not used', 'Stop-off', 'Stop off',
  'Driver assist', 'Liftgate', 'Reconsign', 'Redeliver', 'Inside delivery', 'Residential', 'Misc', 'Accessorial', 'Lumper (incl. receipt)', 'Storage', 'Hazmat', '',
];
const DECOR = [
  '', '', '', ' ', '  ', ' ', "'", '"', "O'Brien ", 'Ö', 'é', '\u{1f600}', '　', '­', '\\', '’', '<b>', '`', '*', '#', '|', '[x](y)', 'Ж', '中', '&amp;', '_', '~',
];
const AMOUNT_SPECIALS = [
  '0', '0.00', '-0.00', '-0', '1', '100', '100.00', '1500.00', '150', '300.00', '0.005', '0.015', '0.025', '0.125', '2.675', '1.000001', '999999999999999', '999999999999999.999999',
  '-5', '-100.50', '12.345', '0.000001', '123456789012345.5', '60', '75', '0.01', '0.1', '10.5', '-0.005', '-2.675', '0.0050', '1.005',
];
const HOURS = ['0', '1', '2', '2.5', '0.25', '1.333333', '15', '-1', '0.000001', '8', '24'];

function makeGen(seed: number) {
  const r = prng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const chance = (p: number) => r() < p;
  const digits = (n: number) => Array.from({ length: n }, () => String(int(0, 9))).join('');
  const randomAmount = (): string => {
    const intLen = int(1, 15);
    const head = intLen === 1 ? String(int(0, 9)) : String(int(1, 9)) + digits(intLen - 1);
    const frac = chance(0.6) ? `.${digits(int(1, 6))}` : '';
    return `${chance(0.1) ? '-' : ''}${head}${frac}`;
  };
  const smallAmount = (): string => `${int(0, 3000)}${chance(0.7) ? `.${digits(int(1, 3))}` : ''}`;
  const amount = (): string => (chance(0.3) ? pick(AMOUNT_SPECIALS) : chance(0.5) ? smallAmount() : randomAmount());
  const text = (): string => `${pick(DECOR)}${pick(KEYWORDS)}${pick(DECOR)}`;
  const maybe = <T,>(p: number, f: () => T): T | null => (chance(p) ? f() : null);
  const iso = (ms: number) => {
    const d = new Date(ms);
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  };
  const baseMs = () => Date.UTC(int(1001, 9998), int(0, 11), int(1, 28), int(0, 23), int(0, 59), chance(0.5) ? int(0, 59) : 0);
  const settings = (): PySettings => ({
    increment: chance(0.4) ? 15 : int(1, 240),
    tolerance: pick(['0', '0.01', '1.00', '0.01', '0.01']),
    window: chance(0.5) ? 90 : int(1, 3650),
  });
  const bolGen = (): BillOfLading => {
    const a = baseMs();
    const dep = a + (int(-600, 3000) * 60 + (chance(0.5) ? int(0, 59) : 0)) * 1000;
    const appt = a + int(-240, 240) * 60_000 + (chance(0.3) ? int(1, 59) * 1000 : 0);
    return bol(chance(0.9) ? iso(a) : null, chance(0.9) ? iso(dep) : null, chance(0.6) ? iso(appt) : null, {
      load_number: maybe(0.5, () => pick(['LD-1', '', 'L\u{1f600}', "O'Neil", 'LD-2'])),
      facility: maybe(0.5, () => pick(['DC 4', 'Widget <Co>', 'Ångström'])),
    });
  };
  const rcGen = (): RateConfirmation =>
    rc({
      load_number: maybe(0.5, () => pick(['LD-1', '', 'LD-3'])),
      linehaul_rate: maybe(0.75, amount),
      fuel_surcharge: maybe(0.6, amount),
      detention_free_hours: maybe(0.85, () => (chance(0.7) ? pick(HOURS) : amount())),
      detention_rate_per_hour: maybe(0.85, () => (chance(0.5) ? pick(['50', '60', '75.00', '62.50', '0.01']) : amount())),
      detention_max_hours: maybe(0.5, () => (chance(0.7) ? pick(['0', '8', '1.5', '0.1', '2', '3.25']) : amount())),
      authorized_accessorials: Array.from({ length: int(0, 3) }, () => (chance(0.2) ? pick(['', ' ', "it's", 'a"b', ' x', '　lumper', '­']) : text())),
    });
  const invGen = () => {
    const n = int(0, 6);
    const lines: [string, string][] = [];
    for (let i = 0; i < n; i += 1) {
      if (lines.length > 0 && chance(0.2)) lines.push([...(pick(lines) as [string, string])]);
      else lines.push([text(), amount()]);
    }
    return inv(lines, maybe(0.6, amount), {
      invoice_number: maybe(0.7, () => pick(['INV-1', '', 'I\u{1f600}', "<script>'"])),
      load_number: maybe(0.6, () => pick(['LD-1', '', 'LD-9', 'L`1'])),
      carrier: maybe(0.6, () => pick(['Acme Freight LLC', '', 'Cö *bold*'])),
      shipper: maybe(0.6, () => pick(['Widget Co', '', 'S#1'])),
      invoice_date: maybe(0.5, () => pick(['2025-03-10', '03/10/2025', 'x'])),
    });
  };
  const docsGen = (): EvidenceDoc[] =>
    Array.from({ length: int(0, 3) }, () => ({
      filename: pick(['invoice.txt', 'bol.csv', 'a`b<c>.pdf', 'réc.txt', 'x'.repeat(int(1, 250))]),
      doc_type: pick(['invoice', 'rate_confirmation', 'bol', 'unknown'] as const),
      sha256: createHash('sha256').update(String(r())).digest('hex'),
    }));
  const now = () => iso(Date.UTC(int(2000, 2099), int(0, 11), int(1, 28), int(0, 23), int(0, 59), int(0, 59)));
  return {
    bundle(id: string): Case {
      const b = bundleOf({
        invoice: chance(0.85) ? invGen() : null,
        rate_confirmation: chance(0.85) ? rcGen() : null,
        bol: chance(0.75) ? bolGen() : null,
        warnings: Array.from({ length: int(0, 2) }, () => pick(['x.txt: unrecognised document type; skipped', 'Load numbers disagree across documents: [\'A\', \'B\']', '*_[x]_* <b>', 'w'.repeat(int(1, 450))])),
      });
      return { id, kind: 'bundle', bundle: b, docs: docsGen(), perspective: chance(0.5) ? 'shipper' : 'carrier', settings: settings(), now: now() };
    },
    detention(id: string): Case {
      return { id, kind: 'detention', bol: bolGen(), rc: rcGen(), settings: settings() };
    },
    classify(id: string): Case {
      return { id, kind: 'classify', descriptions: Array.from({ length: 200 }, () => (chance(0.5) ? text() : `${text()} ${text()}`)), settings: DEFAULT_PY };
    },
  };
}

function generatedCases(): Case[] {
  const g = makeGen(CORPUS_SEED);
  const out: Case[] = [];
  for (let i = 0; i < GENERATED_BUNDLES; i += 1) out.push(g.bundle(`gen-b-${i}`));
  for (let i = 0; i < GENERATED_DETENTIONS; i += 1) out.push(g.detention(`gen-d-${i}`));
  for (let i = 0; i < 5; i += 1) out.push(g.classify(`gen-c-${i}`));
  return out;
}

// ---------------------------------------------------------------------------------------------
// TypeScript side
// ---------------------------------------------------------------------------------------------

const DOC_TYPE: Record<string, EvidenceDoc['doc_type']> = { INVOICE: 'invoice', RATE_CONFIRMATION: 'rate_confirmation', BILL_OF_LADING: 'bol', OTHER: 'unknown' };

function detected(name: string): DetectedType {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return ext === '.pdf' ? 'PDF' : ext === '.csv' ? 'CSV' : 'TXT';
}

function refused(e: unknown): { error: string } {
  if (e instanceof AnalysisInputError) return { error: 'refused' };
  throw e;
}

async function runTs(c: Case): Promise<Omit<PyOut, 'id'>> {
  try {
    if (c.kind === 'classify') return { classes: c.descriptions.map(classifyLine) };
    if (c.kind === 'detention') return { detention: computeDetention(c.bol, c.rc, c.settings.increment) };
    let bundle: ExtractedBundle;
    let docs: EvidenceDoc[];
    if (c.kind === 'files') {
      const parsed = [];
      for (const f of c.files) {
        const bytes = Buffer.from(f.b64, 'base64');
        const p = await parseDocument({ bytes, filename: f.name, detectedType: detected(f.name), limits: LIMITS, threshold: 0.9 });
        if (!p.ok) throw new Error(`fixture ${f.name} rejected: ${p.reason}`);
        parsed.push({ name: f.name, sha256: createHash('sha256').update(bytes).digest('hex'), p });
      }
      bundle = assembleBundle(
        parsed.map(({ name, p }) => ({ displayName: name, docType: p.docType, warnings: p.warnings, fields: p.fields.map((x) => ({ key: x.key, groupIndex: x.groupIndex, effectiveValue: x.value })) })),
      );
      docs = parsed.map(({ name, sha256, p }) => ({ filename: name, doc_type: DOC_TYPE[p.docType] ?? 'unknown', sha256 }));
    } else {
      bundle = c.bundle;
      docs = c.docs;
    }
    const ev = buildEvidence(docs, bundle, c.perspective, toSettings(c.settings), new Date(`${c.now}Z`));
    // applyRules is buildEvidence's own engine run; checked separately for the public entry point.
    expect(applyRules(bundle, c.perspective, toSettings(c.settings))).toEqual(ev.result);
    return { result: ev.result, letter: ev.demand_letter, markdown: ev.markdown, load_number: ev.load_number };
  } catch (e) {
    return refused(e);
  }
}

function runPython(cases: Case[]): PyOut[] {
  if (!python) throw new Error('python unavailable');
  const r = spawnSync(python, [path.join(repoRoot, 'tools', 'parity', 'rules_dump.py')], {
    env: { ...process.env, PYTHONPATH: path.join(repoRoot, 'src'), PYTHONIOENCODING: 'utf-8' },
    input: JSON.stringify({ cases }),
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`rules_dump.py failed: ${r.stderr}`);
  return JSON.parse(r.stdout) as PyOut[];
}

describe.skipIf(!python && !inCi)('parity: TypeScript rules engine + evidence vs Python reference', () => {
  let cases: Case[] = [];
  let py: PyOut[] = [];
  const ts = new Map<string, Omit<PyOut, 'id'>>();

  beforeAll(async () => {
    if (!python) throw new Error('Python with freight_recovery deps is required for the parity suite in CI');
    cases = [...fixtureCases(), ...referenceCases(), ...generatedCases()];
    py = runPython(cases);
    for (const c of cases) ts.set(c.id, await runTs(c));
  }, 300_000);

  it('covers a meaningful corpus (fixtures, reference-test inputs, >= 1000 seeded bundles)', () => {
    expect(py).toHaveLength(cases.length);
    expect(cases.filter((c) => c.kind === 'files')).toHaveLength(4);
    expect(cases.filter((c) => c.id.startsWith('gen-b-')).length).toBeGreaterThanOrEqual(1000);
    // The corpus must exercise every rule and real findings on both sides.
    const ruleIds = new Set<string>();
    for (const t of ts.values()) {
      const r = t.result as { findings: { rule_id: string }[]; ignored_findings: { rule_id: string }[] } | undefined;
      for (const f of [...(r?.findings ?? []), ...(r?.ignored_findings ?? [])]) ruleIds.add(f.rule_id);
    }
    expect([...ruleIds].sort()).toEqual(['DET-OVERBILLED', 'DET-UNBILLED', 'DET-UNDERBILLED', 'INV-ACCESSORIAL-UNAUTH', 'INV-DUPLICATE', 'INV-FUEL-SURCHARGE', 'INV-LINEHAUL-RATE', 'INV-TOTAL-MISMATCH']);
  });

  it('agrees exactly on classification, detention, results, letters, Markdown, load numbers and refusals', () => {
    const diffs: string[] = [];
    cases.forEach((c, i) => {
      const p = py[i];
      const t = ts.get(c.id);
      if (!p || !t || p.id !== c.id) {
        diffs.push(`${c.id}: missing result`);
        return;
      }
      if (p.error !== undefined || t.error !== undefined) {
        if (p.error === undefined || t.error === undefined) diffs.push(`${c.id}: refusal differs (python ${p.error ?? 'ok'}, ts ${t.error ?? 'ok'})`);
        return;
      }
      for (const k of ['classes', 'detention', 'result', 'letter', 'markdown', 'load_number'] as const) {
        const a = JSON.stringify(p[k]);
        const b = JSON.stringify(t[k]);
        if (a !== b) diffs.push(`${c.id}: ${k}\n  py ${a}\n  ts ${b}`);
      }
    });
    expect(diffs.slice(0, 20)).toEqual([]);
  });

  it('refuses exactly the expected reference inputs on both sides', () => {
    const refusedTs = cases.filter((c) => !c.id.startsWith('gen-') && ts.get(c.id)?.error !== undefined).map((c) => c.id);
    const refusedPy = py.filter((p) => !p.id.startsWith('gen-') && p.error !== undefined).map((p) => p.id);
    expect(refusedTs).toEqual(['refuse-zero-inc']);
    expect(refusedPy).toEqual(['refuse-zero-inc']);
  });
});

describe.runIf(!python && !inCi)('rules parity (skipped locally)', () => {
  it('needs Python: set PYTHON to an interpreter with the repo runtime deps (requirements.txt)', () => {
    expect(python).toBeNull();
  });
});
