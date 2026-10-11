/**
 * Step 7 (REQ-20261011-fuel-outlook) api units without a database: the fuel layer inside
 * buildAnalysisPacket, the price importer CLI with an injected fake DB, the price store cache, the outlook
 * DTO mapping on the bundled history, route declarations and the egress architecture rule (A10).
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OutlookResponse, PRICE_SERIES, type ImportDocType } from '@fr/shared';
import type { FscTableSpec, FuelCheckInput, PriceSeriesData } from '@fr/shared/fuel';
import { parsePriceCsv, type PriceSeriesKey } from '@fr/shared/outlook';
import { afterAll, describe, expect, it } from 'vitest';

import { buildAnalysisPacket } from '../src/claims/analysis.js';
import type { ActiveImportRow, InsertImportArgs, InsertImportOutcome } from '../src/db/prices.js';
import { assembleBundleWithProvenance, type BundleDocument, type BundleField } from '../src/imports/bundle.js';
import { milesText } from '../src/intelligence/fuel.js';
import { outlookSeriesDto } from '../src/intelligence/outlook-routes.js';
import { defaultPriceDataDir } from '../src/platform/price-files.js';
import { PriceStore, dieselSeriesOrNull, type PriceReader } from '../src/platform/price-store.js';
import { PricesUsageError, main as pricesMain, parseArgs as pricesArgs, type PriceImportDb } from '../src/platform/prices-cli.js';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(apiRoot, 'src');
const dataDir = defaultPriceDataDir();
const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------
type F = [key: string, value: string | null, line: number | null, group?: number | null];

function doc(displayName: string, docType: ImportDocType, fields: F[]): BundleDocument {
  return {
    displayName,
    docType,
    warnings: [],
    fields: fields.map(([key, v, line, group]): BundleField => ({ key, groupIndex: group ?? null, effectiveValue: v, ref: { page: null, line, excerpt: `${key}: ${v ?? ''}` } })),
  };
}

function docs(fuelAmount: string, rcFuel: string | null = null): BundleDocument[] {
  return [
    doc('invoice.txt', 'INVOICE', [
      ['invoice.invoice_number', 'INV-7001', 2],
      ['invoice.carrier', 'Acme Freight LLC', 3],
      ['invoice.shipper', 'Widget Co', 4],
      ['invoice.invoice_date', '2026-10-09', 6],
      ['invoice.charge.description', 'Linehaul', 7, 0],
      ['invoice.charge.amount', '1500.00', 7, 0],
      ['invoice.charge.description', 'Fuel Surcharge', 8, 1],
      ['invoice.charge.amount', fuelAmount, 8, 1],
    ]),
    doc('rate_confirmation.txt', 'RATE_CONFIRMATION', [
      ['rate_confirmation.load_number', 'LD-7001', 2],
      ['rate_confirmation.linehaul_rate', '1500.00', 4],
      ...(rcFuel === null ? [] : ([['rate_confirmation.fuel_surcharge', rcFuel, 5]] as F[])),
    ]),
  ];
}

function input(d: BundleDocument[]) {
  const { bundle, provenance } = assembleBundleWithProvenance(d);
  return {
    bundle,
    provenance,
    sources: d.map((x, i) => ({ documentId: `00000000-0000-4000-8000-00000000000${i}`, displayName: x.displayName, sha256: String(i).repeat(64), docType: x.docType, sizeBytes: 100 + i })),
  };
}

const NOW = new Date('2026-10-11T12:00:00.000Z');
const ACTOR = '11111111-1111-4111-8111-111111111111';
const IMPORT_ID = '0b9d7a2e-3c1f-4d5e-8f6a-1b2c3d4e5f60';
const TABLE: FscTableSpec = {
  id: '1f0e2d3c-4b5a-4968-8778-695a4b3c2d1e',
  name: 'Acme FSC',
  version: 2,
  kind: 'step',
  unit: 'per_mile',
  priceSeries: 'diesel_us',
  effectiveOffsetDays: 2,
  params: { basePrice: '1.20', stepSize: '0.06', ratePerStep: '0.01', bracket: 'above_base' },
  archived: false,
};
const SERIES: PriceSeriesData = {
  key: 'diesel_us',
  importId: IMPORT_ID,
  sha256: 'aca8fefdbb54bdf16a2ab2c225d8b1f59c033e04d6fb96d8c232c3cc45417bdf',
  sourceUrl: PRICE_SERIES.diesel_us.sourceUrl,
  retrievedAt: '2026-10-11',
  observations: [
    { date: '2026-09-28', value: '6.382' },
    { date: '2026-10-05', value: '6.199' },
  ],
};
const FUEL: FuelCheckInput = { shipDate: '2026-10-07', miles: '500.0', table: TABLE, series: SERIES };

describe('buildAnalysisPacket with the fuel layer (A12)', () => {
  it('fuel null and within tolerance are identical to step 6 (findings, totals, letter, content hash)', () => {
    const base = buildAnalysisPacket({ input: input(docs('420.00')), claim: { perspective: 'SHIPPER' }, now: NOW, actorId: ACTOR });
    expect(base.summary).toMatchObject({ fuelCheckStatus: 'no_inputs', fuelFindingsCount: 0, fscTableId: null, priceImportId: null, priceDate: null });
    const within = buildAnalysisPacket({ input: input(docs('420.00')), claim: { perspective: 'SHIPPER' }, now: NOW, actorId: ACTOR, fuel: FUEL });
    expect(within.summary).toMatchObject({ fuelCheckStatus: 'within_tolerance', fuelFindingsCount: 0, fscTableId: TABLE.id, fscTableVersion: 2, priceImportId: IMPORT_ID, priceDate: '2026-10-05' });
    expect(within.packet.contentHash).toBe(base.packet.contentHash);
    expect(within.packet.demandLetter).toBe(base.packet.demandLetter);
    expect([within.packet.recoverableCents, within.packet.pendingReviewCents]).toEqual([base.packet.recoverableCents, base.packet.pendingReviewCents]);
  });

  it('a finding is stored review-only with the fuel-line citation and no clause; the letter is unchanged', () => {
    const base = buildAnalysisPacket({ input: input(docs('435.00')), claim: { perspective: 'SHIPPER' }, now: NOW, actorId: ACTOR });
    const b = buildAnalysisPacket({ input: input(docs('435.00')), claim: { perspective: 'SHIPPER' }, now: NOW, actorId: ACTOR, fuel: FUEL });
    expect(b.summary).toMatchObject({ fuelCheckStatus: 'finding', fuelFindingsCount: 1, findingsCount: base.summary.findingsCount + 1, pendingFindingsCount: base.summary.pendingFindingsCount + 1 });
    const f = b.findings.at(-1);
    expect(f).toMatchObject({ ruleId: 'FSC-INDEX-MISMATCH', direction: 'OVERCHARGE', amountCents: 1500, confidence: 0.7, needsHumanReview: true, clauseSourceId: null, clauseLabel: null });
    expect(f?.explanation).toBe("Billed fuel surcharge $435.00 vs $420.00 from fuel table 'Acme FSC' for ship date 2026-10-07. Verify the table, the miles and the ship date before disputing.");
    expect(f?.calculation.at(-1)).toBe('The billed amount equals the table result for the price posted 2026-09-28 ($6.382), 1 week(s) earlier than the applicable posting.');
    expect(f?.citations.map((c) => c.locator)).toEqual(['invoice.txt:L8']);
    expect(b.packet.pendingReviewCents).toBe(base.packet.pendingReviewCents + 1500);
    expect(b.packet.recoverableCents).toBe(base.packet.recoverableCents);
    expect(b.packet.demandLetter).toBe(base.packet.demandLetter);
    expect(b.packet.contentHash).not.toBe(base.packet.contentHash);
    // Carrier perspective: the overcharge goes to ignored findings and is not stored.
    const carrier = buildAnalysisPacket({ input: input(docs('435.00')), claim: { perspective: 'CARRIER' }, now: NOW, actorId: ACTOR, fuel: FUEL });
    expect([carrier.summary.fuelCheckStatus, carrier.summary.fuelFindingsCount, carrier.findings.some((x) => x.ruleId === 'FSC-INDEX-MISMATCH')]).toEqual(['finding', 0, false]);
  });

  it('a contract fuel surcharge skips the check (contract_amount)', () => {
    const b = buildAnalysisPacket({ input: input(docs('435.00', '420.00')), claim: { perspective: 'SHIPPER' }, now: NOW, actorId: ACTOR, fuel: FUEL });
    expect([b.summary.fuelCheckStatus, b.summary.priceDate]).toEqual(['contract_amount', null]);
  });

  it('milesText writes one decimal without leading zeros', () => {
    expect([milesText('500'), milesText('0500.5'), milesText('0.1'), milesText('10000')]).toEqual(['500.0', '500.5', '0.1', '10000.0']);
  });
});

// ---------------------------------------------------------------------------------------------------
// Importer CLI (F9) with an injected fake database
// ---------------------------------------------------------------------------------------------------
function active(key: PriceSeriesKey, over: Partial<ActiveImportRow> = {}): ActiveImportRow {
  return {
    id: IMPORT_ID,
    seriesKey: key,
    sourceKind: 'bundled',
    sourceUrl: PRICE_SERIES[key].sourceUrl,
    retrievedAt: '2026-10-11',
    sha256: 'f'.repeat(64),
    rowCount: 10,
    firstDate: '2000-01-03',
    lastDate: '2000-03-06',
    importedAt: '2026-10-11T00:00:00.000Z',
    ...over,
  };
}

class FakeDb implements PriceImportDb {
  readonly inserted: InsertImportArgs[] = [];
  closed = false;
  constructor(
    private readonly current: Partial<Record<PriceSeriesKey, ActiveImportRow>> = {},
    private readonly fail = false,
  ) {}
  async insertImport(args: InsertImportArgs): Promise<InsertImportOutcome> {
    if (this.fail) throw new Error('connect ECONNREFUSED postgresql://owner:secret@db:5432/x');
    const a = this.current[args.key] ?? null;
    if (a && a.sha256 === args.parsed.sha256) return { outcome: 'unchanged', importId: a.id, active: a };
    if (a && (args.parsed.firstDate > a.firstDate || args.parsed.lastDate < a.lastDate)) return { outcome: 'would_remove_history', importId: null, active: a };
    this.inserted.push(args);
    return { outcome: 'imported', importId: '22222222-2222-4222-8222-222222222222', active: a };
  }
  async readActiveImport(key: PriceSeriesKey): Promise<ActiveImportRow | null> {
    if (this.fail) throw new Error('db down');
    return this.current[key] ?? null;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

async function runCli(argv: string[], db: FakeDb, env: Record<string, string | undefined> = { MIGRATE_DATABASE_URL: 'postgresql://placeholder' }) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await pricesMain(argv, (s) => out.push(s), (s) => err.push(s), { env, openDb: () => db, now: () => NOW });
  return { code, out: out.join(''), err: err.join('') };
}

function tempFile(name: string, text: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'fr-price-file-'));
  temps.push(dir);
  const p = path.join(dir, name);
  writeFileSync(p, text);
  return p;
}

const WEEKLY = 'observation_date,GASDESW\n2000-01-03,1.300\n2000-01-10,1.310\n';
const DIESEL_URL = PRICE_SERIES.diesel_us.sourceUrl;

describe('prices:import CLI (F9)', () => {
  it('parses the four invocations and refuses everything else', () => {
    expect(pricesArgs(['--list'], '2026-10-11')).toEqual({ mode: 'list' });
    expect(pricesArgs(['--bundled'], '2026-10-11')).toEqual({ mode: 'bundled' });
    expect(pricesArgs(['--series', 'ppi_tl', '--fetch'], '2026-10-11')).toEqual({ mode: 'fetch', series: 'ppi_tl' });
    expect(pricesArgs(['--series', 'diesel_us', '--file', 'x.csv', '--source-url', DIESEL_URL, '--retrieved-at', '2026-10-11'], '2026-10-11')).toEqual({
      mode: 'file',
      series: 'diesel_us',
      file: 'x.csv',
      sourceUrl: DIESEL_URL,
      retrievedAt: '2026-10-11',
    });
    for (const bad of [
      [],
      ['--bogus'],
      ['--list', '--bundled'],
      ['--series', 'deep_sea', '--fetch'],
      ['--series', 'diesel_us', '--file', 'x.csv', '--source-url', 'https://evil.example/x.csv', '--retrieved-at', '2026-10-11'],
      ['--series', 'diesel_us', '--file', 'x.csv', '--source-url', DIESEL_URL, '--retrieved-at', '2026-10-12'],
      ['--series', 'diesel_us', '--file', 'x.csv', '--source-url', DIESEL_URL, '--retrieved-at', '2026-02-30'],
      ['--series', 'diesel_us', '--file', 'x.csv', '--source-url', DIESEL_URL],
      ['--series', 'diesel_us', '--fetch', '--file', 'x.csv'],
      ['--series'],
    ]) {
      expect(() => pricesArgs(bad, '2026-10-11')).toThrow(PricesUsageError);
    }
  });

  it('missing MIGRATE_DATABASE_URL is exit 2 with the fixed message', async () => {
    const r = await runCli(['--list'], new FakeDb(), {});
    expect([r.code, r.err]).toEqual([2, 'usage error: MIGRATE_DATABASE_URL is required\n']);
  });

  it('imported, unchanged and would_remove_history; nothing is written on a refusal', async () => {
    const file = tempFile('diesel.csv', WEEKLY);
    const argv = ['--series', 'diesel_us', '--file', file, '--source-url', DIESEL_URL, '--retrieved-at', '2026-10-11'];
    const fresh = new FakeDb();
    const a = await runCli(argv, fresh);
    expect([a.code, fresh.inserted.length, fresh.closed]).toEqual([0, 1, true]);
    expect(a.out).toContain('diesel_us: imported');
    expect(fresh.inserted[0]).toMatchObject({ key: 'diesel_us', sourceKind: 'file', sourceUrl: DIESEL_URL, retrievedAt: '2026-10-11' });
    const sha = parsePriceCsv(new Uint8Array(readFileSync(file)), 'diesel_us').sha256;
    const same = new FakeDb({ diesel_us: active('diesel_us', { sha256: sha }) });
    const b = await runCli(argv, same);
    expect([b.code, same.inserted.length]).toEqual([0, 0]);
    expect(b.out).toContain('unchanged');
    const longer = new FakeDb({ diesel_us: active('diesel_us', { firstDate: '1999-12-27' }) });
    const c = await runCli(argv, longer);
    expect([c.code, longer.inserted.length]).toEqual([2, 0]);
    expect(c.out).toContain('would_remove_history');
  });

  it('bad files are exit 2 before any database access; database failures are exit 3 without the URL', async () => {
    const bad = tempFile('bad.csv', WEEKLY.replace('1.310', 'x'));
    const db = new FakeDb();
    const r = await runCli(['--series', 'diesel_us', '--file', bad, '--source-url', DIESEL_URL, '--retrieved-at', '2026-10-11'], db);
    expect([r.code, db.inserted.length]).toEqual([2, 0]);
    expect(r.err).toContain('parse error');
    const missing = await runCli(['--series', 'diesel_us', '--file', path.join(tmpdir(), 'nope-fr.csv'), '--source-url', DIESEL_URL, '--retrieved-at', '2026-10-11'], new FakeDb());
    expect(missing.code).toBe(2);
    const big = tempFile('big.csv', 'x'.repeat(1_048_577));
    expect((await runCli(['--series', 'diesel_us', '--file', big, '--source-url', DIESEL_URL, '--retrieved-at', '2026-10-11'], new FakeDb())).code).toBe(2);
    const dir = path.dirname(big);
    expect((await runCli(['--series', 'diesel_us', '--file', dir, '--source-url', DIESEL_URL, '--retrieved-at', '2026-10-11'], new FakeDb())).code).toBe(2);
    let link: string | null = null;
    try {
      link = path.join(dir, 'link.csv');
      symlinkSync(tempFile('target.csv', WEEKLY), link);
    } catch {
      link = null; // symlinks need privileges on Windows
    }
    if (link !== null) expect((await runCli(['--series', 'diesel_us', '--file', link, '--source-url', DIESEL_URL, '--retrieved-at', '2026-10-11'], new FakeDb())).code).toBe(2);

    const good = tempFile('good.csv', WEEKLY);
    const down = await runCli(['--series', 'diesel_us', '--file', good, '--source-url', DIESEL_URL, '--retrieved-at', '2026-10-11'], new FakeDb({}, true));
    expect(down.code).toBe(3);
    expect(down.err).toBe('database error: the import was not written\n');
    expect(`${down.out}${down.err}`).not.toMatch(/postgresql:|secret/u);
  });

  it('--bundled imports both manifest series with source kind bundled; --list prints provenance', async () => {
    const db = new FakeDb();
    const r = await runCli(['--bundled'], db);
    expect(r.code).toBe(0);
    expect(db.inserted.map((x) => [x.key, x.sourceKind, x.retrievedAt, x.parsed.rows.length, x.parsed.sha256])).toEqual([
      ['diesel_us', 'bundled', '2026-10-11', 1699, 'aca8fefdbb54bdf16a2ab2c225d8b1f59c033e04d6fb96d8c232c3cc45417bdf'],
      ['ppi_tl', 'bundled', '2026-10-11', 411, '83894390a4fd80d6033f9d18299e97b27e670427bbb5e6aa090cdca0d4a44bea'],
    ]);
    const list = await runCli(['--list'], new FakeDb({ diesel_us: active('diesel_us') }));
    expect(list.code).toBe(0);
    expect(list.out).toBe(
      `diesel_us: import ${IMPORT_ID} sha256 ${'f'.repeat(64)} rows 10 2000-01-03..2000-03-06 source bundled retrieved 2026-10-11\nppi_tl: no import\n`,
    );
  });

  it('S3 --fetch: pinned URL, no redirects, status 200, size cap; network errors are exit 3', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const ok = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(WEEKLY, { status: 200 });
    }) as unknown as typeof fetch;
    const db = new FakeDb();
    const out: string[] = [];
    const code = await pricesMain(['--series', 'diesel_us', '--fetch'], (s) => out.push(s), () => undefined, {
      env: { MIGRATE_DATABASE_URL: 'x' },
      openDb: () => db,
      fetch: ok,
      now: () => NOW,
    });
    expect(code).toBe(0);
    expect(calls[0]?.[0]).toBe(DIESEL_URL);
    expect(calls[0]?.[1]?.redirect).toBe('error');
    expect(calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(db.inserted[0]).toMatchObject({ sourceKind: 'fetch', retrievedAt: '2026-10-11', sourceUrl: DIESEL_URL });
    const status = (async () => new Response('nope', { status: 302 })) as unknown as typeof fetch;
    expect(await pricesMain(['--series', 'diesel_us', '--fetch'], () => undefined, () => undefined, { env: { MIGRATE_DATABASE_URL: 'x' }, openDb: () => new FakeDb(), fetch: status })).toBe(3);
    const thrown = (async () => {
      throw new TypeError('redirect');
    }) as unknown as typeof fetch;
    expect(await pricesMain(['--series', 'diesel_us', '--fetch'], () => undefined, () => undefined, { env: { MIGRATE_DATABASE_URL: 'x' }, openDb: () => new FakeDb(), fetch: thrown })).toBe(3);
    const huge = (async () => new Response('x'.repeat(1_048_577), { status: 200 })) as unknown as typeof fetch;
    expect(await pricesMain(['--series', 'diesel_us', '--fetch'], () => undefined, () => undefined, { env: { MIGRATE_DATABASE_URL: 'x' }, openDb: () => new FakeDb(), fetch: huge })).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------
// Price store (F7.11, F16) and outlook mapping (F7.9)
// ---------------------------------------------------------------------------------------------------
function bundledReader(counter: { active: number; obs: number }, rows: Partial<Record<PriceSeriesKey, ActiveImportRow | null>>): PriceReader {
  const files: Record<PriceSeriesKey, string> = { diesel_us: 'GASDESW.csv', ppi_tl: 'PCU4841214841212.csv' };
  return {
    async readActiveImport(key) {
      counter.active += 1;
      return rows[key] ?? null;
    },
    async readObservations(importId) {
      counter.obs += 1;
      const key = (Object.keys(rows) as PriceSeriesKey[]).find((k) => rows[k]?.id === importId) ?? 'diesel_us';
      return parsePriceCsv(new Uint8Array(readFileSync(path.join(dataDir, files[key]))), key).rows;
    },
  };
}

describe('PriceStore and the outlook DTO', () => {
  it('caches the active import for the TTL and the observations per import id; 0 disables the active cache', async () => {
    let t = 0;
    const counter = { active: 0, obs: 0 };
    const rows = { diesel_us: active('diesel_us', { id: '33333333-3333-4333-8333-333333333333' }) };
    const store = new PriceStore(bundledReader(counter, rows), 1000, () => t);
    const a = await store.getSeries('diesel_us');
    await store.getSeries('diesel_us');
    expect([counter.active, counter.obs, a?.observations.length, a?.importId]).toEqual([1, 1, 1699, '33333333-3333-4333-8333-333333333333']);
    t = 2000;
    await store.getSeries('diesel_us');
    expect([counter.active, counter.obs]).toEqual([2, 1]);
    const noCache = new PriceStore(bundledReader(counter, rows), 0, () => t);
    await noCache.getSeries('diesel_us');
    await noCache.getSeries('diesel_us');
    expect(counter.active).toBe(4);
    expect(await store.getSeries('ppi_tl')).toBeNull();
    const failing = new PriceStore(
      { readActiveImport: async () => Promise.reject(new Error('down')), readObservations: async () => [] },
      0,
    );
    await expect(failing.getOutlook('diesel_us')).rejects.toThrow('down');
    expect(await dieselSeriesOrNull(failing)).toBeNull();
  });

  it('maps the bundled outlook with F7.9 rounding and the S2 fuel-table rates', async () => {
    const rows = {
      diesel_us: active('diesel_us', { id: '44444444-4444-4444-8444-444444444444', sha256: 'aca8fefdbb54bdf16a2ab2c225d8b1f59c033e04d6fb96d8c232c3cc45417bdf', rowCount: 1699, firstDate: '1994-03-21', lastDate: '2026-10-05' }),
      ppi_tl: active('ppi_tl', { id: '55555555-5555-4555-8555-555555555555', rowCount: 411, firstDate: '1992-06-01', lastDate: '2026-08-01' }),
    };
    const store = new PriceStore(bundledReader({ active: 0, obs: 0 }, rows), 60_000);
    const diesel = await store.getOutlook('diesel_us');
    const ppi = await store.getOutlook('ppi_tl');
    expect(diesel?.outlook.status).toBe('ok');
    const d = outlookSeriesDto('diesel_us', diesel, TABLE);
    expect(d.horizons.map((h) => [h.h, h.method, h.reason, h.point, h.low, h.high, h.targetDate])).toEqual([
      [1, 'ar2', 'model_beats_naive', '6.124', '5.903', '6.392', '2026-10-12'],
      [4, 'combo', 'model_beats_naive', '6.136', '5.301', '7.175', '2026-11-02'],
      [8, 'naive', 'naive_by_design', '6.199', '4.777', '8.189', '2026-11-30'],
      [13, 'naive', 'naive_by_design', '6.199', '4.384', '9.395', '2027-01-04'],
    ]);
    expect(d.horizons[0]?.backtest).toEqual({ candidate: 'ar2', origins: 779, maeRatio: 0.85, dm: 5.64, coverage: 0.779, coverageHits: 526, coverageCases: 675 });
    expect(d.horizons[1]?.backtest).toMatchObject({ maeRatio: 0.96, dm: 2.75, coverageHits: 530, coverageCases: 672 });
    // 6.124 -> ceil(4.924 / 0.06) = 83 steps -> 0.83 per mile.
    expect(d.horizons[0]?.fsc).toEqual({ point: '0.83', low: '0.79', high: '0.87' });
    expect([d.latest, d.backtestYears, d.provenance?.rowCount]).toEqual([{ date: '2026-10-05', value: '6.199' }, { from: 2011, to: 2026 }, 1699]);
    const p = outlookSeriesDto('ppi_tl', ppi, TABLE);
    expect(p.horizons.map((h) => [h.point, h.low, h.high, h.fsc, h.targetDate, h.backtest.coverageHits, h.backtest.coverageCases])).toEqual([['218.0', '210.9', '225.9', null, '2026-09-01', 125, 169]]);
    expect(outlookSeriesDto('ppi_tl', null, null)).toMatchObject({ status: 'no_data', provenance: null, latest: null, backtestYears: null, horizons: [] });
    const body = OutlookResponse.parse({ outlookVersion: 'outlook-v1', note: (await import('@fr/shared')).OUTLOOK_NOTE, series: [outlookSeriesDto('diesel_us', diesel, null), p], fscTable: null });
    expect(body.series[0]?.horizons.every((h) => h.fsc === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------
// Declarations and architecture
// ---------------------------------------------------------------------------------------------------
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === 'generated' || name === 'node_modules' || name === 'dist') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/u.test(name) && !/\.test\.ts$/u.test(name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(apiRoot, p).split(path.sep).join('/');
const files = walk(srcRoot).map((p) => ({ path: rel(p), text: readFileSync(p, 'utf8') }));

describe('step 7 declarations', () => {
  it('fuel and outlook routes: permission, intelligence bucket, no API-key scope', () => {
    const blockRe = /defineRoute\(app, \{\s*method: '([A-Z]+)',\s*url: `\$\{P\}([^`]+)`,\s*access: \{ kind: 'permission', permission: '([a-z:_]+)' \},\s*rateGroup: '([a-z]+)',/gu;
    const found: string[] = [];
    for (const f of files.filter((x) => ['src/intelligence/fuel-routes.ts', 'src/intelligence/outlook-routes.ts'].includes(x.path))) {
      for (const m of f.text.matchAll(blockRe)) found.push(`${m[1]} ${m[2]} ${m[3]} ${m[4]}`);
      expect([f.path, /apiKeyScope/u.test(f.text)]).toEqual([f.path, false]);
      expect([f.path, (f.text.match(/defineRoute\(/gu) ?? []).length]).toEqual([f.path, f.path.endsWith('fuel-routes.ts') ? 7 : 1]);
    }
    expect(found.sort()).toEqual(
      [
        'GET /fuel-tables claims:read intelligence',
        'POST /fuel-tables settings:manage intelligence',
        'PUT /fuel-tables/:id settings:manage intelligence',
        'DELETE /fuel-tables/:id settings:manage intelligence',
        'GET /claims/:id/fuel-check claims:read intelligence',
        'PUT /claims/:id/fuel-inputs claims:analyze intelligence',
        'DELETE /claims/:id/fuel-inputs claims:analyze intelligence',
        'GET /outlook claims:read intelligence',
      ].sort(),
    );
  });

  it('no file under api/src except platform/prices-cli.ts calls the global fetch; request paths never import the importer', () => {
    for (const f of files) {
      if (f.path === 'src/platform/prices-cli.ts') continue;
      expect([f.path, /(^|[^.\w])fetch\s*\(/mu.test(f.text)]).toEqual([f.path, false]);
    }
    const requestPaths = files.filter((f) => /^src\/(intelligence|claims|platform\/price-store|http)/u.test(f.path) || f.path === 'src/app.ts');
    expect(requestPaths.length).toBeGreaterThan(5);
    for (const f of requestPaths) expect([f.path, /prices-cli/u.test(f.text)]).toEqual([f.path, false]);
  });

  it('the global price tables stay out of the tenant client', async () => {
    const { TENANT_MODELS } = await import('../src/db/tenant.js');
    expect(['FscTable', 'ClaimFuelInput'].every((m) => TENANT_MODELS.has(m))).toBe(true);
    expect(['PriceImport', 'PriceObservation'].some((m) => TENANT_MODELS.has(m))).toBe(false);
  });
});
