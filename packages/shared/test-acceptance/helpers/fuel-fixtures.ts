// REQ-20261011-fuel-outlook: test-owned typing of the Part C surface (F1-F10) and the common fixtures of
// test-spec T3-T5 (DIESEL, T1, bundles F1-F4, inputs I1/TP/TM). Product modules are loaded dynamically and typed
// through these interfaces, so this file never depends on the product's own types.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { oExamples, oSuggest, type SeedEntry, type TenantLabel } from './charge-oracle.js';
import type { ODeps, OFinding, OResult, OSeries, OTable, Obs, OBundle } from './fuel-oracle.js';

export const ROOT = resolve(__dirname, '..', '..', '..', '..');
export const DATA_DIR = resolve(ROOT, 'api', 'data', 'public-prices');
/** The run directory's copies (present only on the owner's machine; CI relies on the sha256 pins). */
export const RUN_DATA_DIR = resolve(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.claude', 'plugins', 'data', 'statsclaw-synced', 'workspace', 'freight-recovery', 'runs', 'REQ-20261011-fuel-outlook', 'data');
export const runDataPresent = (): boolean => existsSync(resolve(RUN_DATA_DIR, 'GASDESW.csv'));

export const SHA_DIESEL = 'aca8fefdbb54bdf16a2ab2c225d8b1f59c033e04d6fb96d8c232c3cc45417bdf';
export const SHA_PPI = '83894390a4fd80d6033f9d18299e97b27e670427bbb5e6aa090cdca0d4a44bea';
export const URL_DIESEL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASDESW';
export const URL_PPI = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=PCU4841214841212';
export const CITE_DIESEL = 'U.S. Energy Information Administration, US Diesel Sales Price [GASDESW], retrieved from FRED, Federal Reserve Bank of St. Louis';
export const CITE_PPI = 'U.S. Bureau of Labor Statistics, Producer Price Index by Industry: General Freight Trucking, Long-Distance Truckload [PCU4841214841212], retrieved from FRED, Federal Reserve Bank of St. Louis';
export const IMPORT_ID = '7e1f0000-0000-4000-8000-000000000001';

export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
export const readData = (file: string): Buffer => readFileSync(resolve(DATA_DIR, file));

// ---------------------------------------------------------------------------------------------------------------
// Typed views of the product modules (contract only)
// ---------------------------------------------------------------------------------------------------------------
export type Finding = OFinding & Record<string, unknown>;
export interface RecoveryResult { perspective: string; findings: Finding[]; ignored_findings: Finding[]; recoverable_total: string; pending_review_total: string; [k: string]: unknown }
export interface Evidence { result: RecoveryResult; demand_letter: string; markdown: string; [k: string]: unknown }
export interface LearnedOut { evidence: Evidence; learnedFindingsCount: number; reviewFlagsCount: number; labelIds: string[] }
export interface FuelOut extends LearnedOut { fuel: OResult; fuelFindingsCount: number }
export interface Settings { amountTolerance: string; disputeWindowDays: number; [k: string]: unknown }
export interface Classifier { classify(description: string): unknown }
/** F5 `classify`: the step-6 suggestion function of a classifier (or null). */
export type ClassifyFn = (description: string) => unknown;
export const classifyOf = (c: Classifier | null): ClassifyFn | null => (c === null ? null : (d: string) => c.classify(d));
export type Bundle = Record<string, unknown>;

export interface Root {
  DEFAULT_ANALYSIS_SETTINGS: Settings;
  emptyInvoice(): Record<string, unknown>;
  emptyRateConfirmation(): Record<string, unknown>;
  classifyLine(description: string): string;
  buildDemandLetter(b: Bundle, r: RecoveryResult, today: string, days: number): string;
  renderPacketMarkdown(load: unknown, perspective: string, docs: unknown[], b: Bundle, r: RecoveryResult, letter: string): string;
  packetLoadNumber(b: Bundle): unknown;
  AUDIT_ACTIONS: readonly string[];
  FEATURE_FLAGS: readonly { key: string; description: string; defaultEnabled: boolean; tenantVisible: boolean }[];
  [k: string]: unknown;
}
export interface ChargeIntel {
  buildChargeClassifier(labels: readonly TenantLabel[]): Classifier;
  buildEvidenceLearned(docs: unknown[], b: Bundle, p: 'shipper' | 'carrier', s: Settings, now: Date, cls: Classifier | null): LearnedOut;
  SEED_V1: readonly SeedEntry[];
  SEED_SOURCES: Record<string, { label: string }>;
  SEED_V2: readonly SeedEntry[];
  SEED_V2_SOURCES: Record<string, { label: string }>;
}
export interface Posting { index: number; date: string; value: string; effectiveFrom: string; effectiveTo: string }
export interface FscEval { rate: string; steps: number | null; row: number | null; reachesFirstStep: boolean }
export interface FuelInput { shipDate: string; miles: string | null; table: OTable & { id?: string }; series: OSeries | null }
export interface FuelMod {
  applicablePosting(obs: readonly Obs[], shipDate: string, offsetDays: number): Posting | null;
  evaluateFscTable(table: OTable & { id?: string }, price: string): FscEval;
  checkFuel(b: Bundle, input: FuelInput | null, classify: ClassifyFn | null): OResult;
  buildEvidenceFuel(docs: unknown[], b: Bundle, p: 'shipper' | 'carrier', s: Settings, now: Date, cls: Classifier | null, input: FuelInput | null): FuelOut;
  [k: string]: unknown;
}
export interface CsvRow { date: string; value: string }
export interface ParsedCsv { rows: CsvRow[]; sha256: string; firstDate: string; lastDate: string }
export interface OutlookMod {
  parsePriceCsv(bytes: Uint8Array, seriesKey: string): ParsedCsv;
  ar2Forecast(y: readonly number[], t: number, h: number, W: number): number;
  backtestSeries: (...args: never[]) => unknown;
  computeOutlook: (...args: never[]) => unknown;
  PriceCsvError?: new (...args: never[]) => Error;
  [k: string]: unknown;
}

export async function loadModules(): Promise<{ R: Root; C: ChargeIntel; F: FuelMod; O: OutlookMod }> {
  const R = (await import('@fr/shared')) as unknown as Root;
  const C = (await import('@fr/shared/charge-intel')) as unknown as ChargeIntel;
  const F = (await import('@fr/shared/fuel')) as unknown as FuelMod;
  const O = (await import('@fr/shared/outlook')) as unknown as OutlookMod;
  return { R, C, F, O };
}

// ---------------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------------
export function csvObs(file: string): Obs[] {
  const lines = readData(file).toString('latin1').replace(/\r\n/g, '\n').split('\n').filter((l) => l !== '');
  return lines.slice(1).map((l) => { const [date = '', value = ''] = l.split(','); return { date, value }; });
}
let dieselCache: OSeries | null = null;
export function DIESEL(): OSeries {
  dieselCache ??= { key: 'diesel_us', importId: IMPORT_ID, sha256: SHA_DIESEL, sourceUrl: URL_DIESEL, retrievedAt: '2026-10-11', observations: csvObs('GASDESW.csv') };
  return dieselCache;
}
export const NOW = new Date('2026-10-11T12:00:00.000Z');
export const TODAY = '2026-10-11';
export const TID = (n: number): string => `0f5c0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Tbl = OTable & { id: string };
export const T1 = (o: Partial<Tbl> = {}): Tbl => ({ id: TID(1), name: 'Std DOE table', version: 1, kind: 'step', unit: 'per_mile', priceSeries: 'diesel_us', effectiveOffsetDays: 2, params: { basePrice: '1.20', stepSize: '0.06', ratePerStep: '0.01', bracket: 'above_base' }, archived: false, ...o } as Tbl);
export const FROM_BASE = (o: Partial<Tbl> = {}): Tbl => T1({ id: TID(2), name: 'Bison-style', params: { basePrice: '1.12', stepSize: '0.05', ratePerStep: '0.01', bracket: 'from_base' }, ...o } as Partial<Tbl>);
export const MPG = (basePrice: string, mpg: string, decimals: 2 | 3 | 4, o: Partial<Tbl> = {}): Tbl => ({ id: TID(3), name: 'MPG table', version: 1, kind: 'mpg', unit: 'per_mile', priceSeries: 'diesel_us', effectiveOffsetDays: 2, params: { basePrice, mpg, decimals }, archived: false, ...o } as Tbl);
export const ROWS_PCT = (o: Partial<Tbl> = {}): Tbl => ({ id: TID(4), name: 'Pct table', version: 1, kind: 'rows', unit: 'percent', priceSeries: 'diesel_us', effectiveOffsetDays: 2, params: { rows: [{ atLeast: '5.00', rate: '30' }, { atLeast: '6.00', rate: '32.5' }, { atLeast: '6.50', rate: '34' }] }, archived: false, ...o } as Tbl);
export const STEP_PCT = (): Tbl => T1({ id: TID(5), name: 'Step pct', unit: 'percent', params: { basePrice: '1.20', stepSize: '0.05', ratePerStep: '0.5', bracket: 'above_base' } } as Partial<Tbl>);

export interface Mk { inv(lines: [string, string][], total?: string | null): Record<string, unknown>; rc(o?: Record<string, unknown>): Record<string, unknown>; bundle(o: { invoice?: unknown; rate_confirmation?: unknown; bol?: unknown }): Bundle }
export function makers(R: Root): Mk {
  const sum = (ls: [string, string][]) => { let c = 0n; for (const [, a] of ls) { const [i = '0', f = ''] = a.split('.'); c += BigInt(i) * 100n + BigInt((f + '00').slice(0, 2)); } return `${c / 100n}.${String(c % 100n).padStart(2, '0')}`; };
  return {
    inv: (lines, total) => ({ ...R.emptyInvoice(), lines: lines.map(([description, amount]) => ({ description, amount })), total: total === undefined ? sum(lines) : total }),
    rc: (o = {}) => ({ ...R.emptyRateConfirmation(), linehaul_rate: '2150.00', fuel_surcharge: null, authorized_accessorials: [], ...o }),
    bundle: (o) => ({ invoice: o.invoice ?? null, rate_confirmation: o.rate_confirmation ?? null, bol: o.bol ?? null, warnings: [] }),
  };
}
/** Bundles F1-F4 of test-spec T4 (invoice total = sum of lines). */
export const fBundle = (mk: Mk, fuel = '435.00', rc: Record<string, unknown> = {}): Bundle => mk.bundle({ invoice: mk.inv([['Linehaul', '2150.00'], ['Fuel surcharge', fuel]]), rate_confirmation: mk.rc(rc) });
export const I1 = (o: Partial<FuelInput> = {}): FuelInput => ({ shipDate: '2026-10-07', miles: '500.0', table: T1(), series: DIESEL(), ...o });

/** Oracle dependencies: step-5 classifyLine and (optionally) the test-owned C3 suggestion oracle. */
export function oracleDeps(R: Root, C: ChargeIntel, labels: readonly TenantLabel[] | null): ODeps {
  const ex = labels === null ? null : oExamples(C.SEED_V2, labels);
  return {
    classifyLine: (d) => R.classifyLine(d),
    suggest: ex === null ? null : (d) => { const s = oSuggest(ex, d, C.SEED_V2_SOURCES); return { abstained: s.abstained, category: s.category }; },
    tolerance: R.DEFAULT_ANALYSIS_SETTINGS.amountTolerance,
    seriesLabel: 'U.S. average diesel price',
    citation: CITE_DIESEL,
  };
}
export const asOBundle = (b: Bundle): OBundle => b as unknown as OBundle;

/** Deep-freezes a value (CI-F11 purity). */
export function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}
