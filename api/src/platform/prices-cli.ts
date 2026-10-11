/**
 * Public price importer CLI (REQ-20261011-fuel-outlook, Part C F9). The ONLY writer of price data and the
 * ONLY module of the API that makes an outbound request for prices (`--fetch`, CLI only):
 *   npm run prices:import -- --series <key> --file <path> --source-url <url> --retrieved-at <YYYY-MM-DD>
 *   npm run prices:import -- --bundled
 *   npm run prices:import -- --list
 *   npm run prices:import -- --series <key> --fetch
 * Uses only MIGRATE_DATABASE_URL (the owner connection) and never prints it. Exit codes: 0 imported,
 * unchanged or the list; 2 usage, validation or parse error, or would_remove_history (nothing written);
 * 3 database or network failure (nothing written).
 */
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { PRICE_CSV_MAX_BYTES, PRICE_SERIES, PRICE_SERIES_KEYS, PriceCsvError, isPriceSeriesKey, parsePriceCsv, type ParsedPriceCsv, type PriceSeriesKey } from '@fr/shared/outlook';

import { createDb } from '../db/client.js';
import { dateText, insertImport, readActiveImport, type ActiveImportRow, type InsertImportArgs, type InsertImportOutcome, type PriceSourceKind } from '../db/prices.js';

import { PriceDataError, defaultPriceDataDir, readBundledPrices } from './price-files.js';

/** Download timeout of `--fetch`. */
const FETCH_TIMEOUT_MS = 20_000;
const HTTP_OK = 200;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;

export type PricesCliArgs =
  | { mode: 'list' }
  | { mode: 'bundled' }
  | { mode: 'file'; series: PriceSeriesKey; file: string; sourceUrl: string; retrievedAt: string }
  | { mode: 'fetch'; series: PriceSeriesKey };

export class PricesUsageError extends Error {}
class PricesNetworkError extends Error {}

/** Database operations of the importer (tests inject a fake). */
export interface PriceImportDb {
  insertImport(args: InsertImportArgs): Promise<InsertImportOutcome>;
  readActiveImport(key: PriceSeriesKey): Promise<ActiveImportRow | null>;
  close(): Promise<void>;
}

export interface PricesCliDeps {
  env?: Readonly<Record<string, string | undefined>>;
  openDb?: (databaseUrl: string) => PriceImportDb;
  fetch?: typeof fetch;
  now?: () => Date;
  dataDir?: string;
}

const FLAGS_WITH_VALUE = new Set(['--series', '--file', '--source-url', '--retrieved-at']);
const BARE_FLAGS = new Set(['--bundled', '--list', '--fetch']);

function isRealDate(v: string): boolean {
  if (!DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && dateText(d) === v;
}

export function parseArgs(argv: readonly string[], today: string): PricesCliArgs {
  const values = new Map<string, string>();
  const bare = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (BARE_FLAGS.has(a)) {
      if (bare.has(a)) throw new PricesUsageError(`${a} given twice`);
      bare.add(a);
      continue;
    }
    if (!FLAGS_WITH_VALUE.has(a)) throw new PricesUsageError(`unknown argument: ${a}`);
    const v = argv[i + 1];
    if (v === undefined || v === '' || v.startsWith('--')) throw new PricesUsageError(`${a} needs a value`);
    if (values.has(a)) throw new PricesUsageError(`${a} given twice`);
    values.set(a, v);
    i += 1;
  }
  const only = (allowedValues: string[], allowedBare: string[]): void => {
    for (const k of values.keys()) if (!allowedValues.includes(k)) throw new PricesUsageError(`${k} is not allowed here`);
    for (const k of bare) if (!allowedBare.includes(k)) throw new PricesUsageError(`${k} is not allowed here`);
  };
  if (bare.has('--list')) {
    only([], ['--list']);
    return { mode: 'list' };
  }
  if (bare.has('--bundled')) {
    only([], ['--bundled']);
    return { mode: 'bundled' };
  }
  const series = values.get('--series');
  if (series === undefined) throw new PricesUsageError('one of --list, --bundled or --series is required');
  if (!isPriceSeriesKey(series)) throw new PricesUsageError(`--series must be one of ${PRICE_SERIES_KEYS.join(', ')}`);
  if (bare.has('--fetch')) {
    only(['--series'], ['--fetch']);
    return { mode: 'fetch', series };
  }
  only(['--series', '--file', '--source-url', '--retrieved-at'], []);
  const file = values.get('--file');
  const sourceUrl = values.get('--source-url');
  const retrievedAt = values.get('--retrieved-at');
  if (file === undefined || sourceUrl === undefined || retrievedAt === undefined) throw new PricesUsageError('--file, --source-url and --retrieved-at are required with --series');
  if (sourceUrl !== PRICE_SERIES[series].sourceUrl) throw new PricesUsageError(`--source-url must be the pinned URL of ${series}`);
  if (!isRealDate(retrievedAt) || retrievedAt > today) throw new PricesUsageError('--retrieved-at must be a real date not after today (UTC)');
  return { mode: 'file', series, file, sourceUrl, retrievedAt };
}

/** Read a local CSV: a regular file (no symlink), at most 1 MiB; the same bytes are hashed and parsed. */
export function readPriceFile(file: string): Uint8Array {
  let st;
  try {
    st = lstatSync(file);
  } catch {
    throw new PricesUsageError('file not found');
  }
  if (st.isSymbolicLink() || !st.isFile()) throw new PricesUsageError('not a regular file');
  if (st.size > PRICE_CSV_MAX_BYTES) throw new PricesUsageError('file larger than 1 MiB');
  return new Uint8Array(readFileSync(file));
}

/** S3: download the pinned URL (https, no redirects, timeout, 1 MiB cap). */
export async function fetchPinned(key: PriceSeriesKey, fetchImpl: typeof fetch): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetchImpl(PRICE_SERIES[key].sourceUrl, { redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    throw new PricesNetworkError('download failed');
  }
  if (res.status !== HTTP_OK || res.body === null) {
    await res.body?.cancel().catch(() => undefined);
    throw new PricesNetworkError(`download failed: HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > PRICE_CSV_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new PricesUsageError('download larger than 1 MiB');
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof PricesUsageError) throw e;
    throw new PricesNetworkError('download failed');
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function realDb(databaseUrl: string): PriceImportDb {
  const base = createDb(databaseUrl, { max: 2 });
  return {
    insertImport: (args) => insertImport(base, args),
    readActiveImport: (key) => readActiveImport(base, key),
    close: () => base.$disconnect(),
  };
}

interface PendingImport {
  key: PriceSeriesKey;
  sourceKind: PriceSourceKind;
  sourceUrl: string;
  retrievedAt: string;
  parsed: ParsedPriceCsv;
}

function outcomeLine(p: PendingImport, r: InsertImportOutcome): string {
  const range = `rows ${p.parsed.rows.length} ${p.parsed.firstDate}..${p.parsed.lastDate}`;
  if (r.outcome === 'imported') return `${p.key}: imported (import ${r.importId}, sha256 ${p.parsed.sha256}, ${range}, source ${p.sourceKind})\n`;
  if (r.outcome === 'unchanged') return `${p.key}: unchanged (active import ${r.importId} has the same sha256)\n`;
  return `${p.key}: refused: would_remove_history (the file covers ${p.parsed.firstDate}..${p.parsed.lastDate}; the active import covers ${r.active.firstDate}..${r.active.lastDate})\n`;
}

const todayUtc = (now: Date): string => now.toISOString().slice(0, 10);

export async function main(argv: readonly string[], out: (s: string) => void, err: (s: string) => void, deps: PricesCliDeps = {}): Promise<number> {
  const now = deps.now ?? (() => new Date());
  const today = todayUtc(now());
  let args: PricesCliArgs;
  try {
    args = parseArgs(argv, today);
  } catch (e) {
    err(`usage error: ${(e as Error).message}\n`);
    return 2;
  }
  const env = deps.env ?? process.env;
  const url = env['MIGRATE_DATABASE_URL'];
  if (url === undefined || url === '') {
    err('usage error: MIGRATE_DATABASE_URL is required\n');
    return 2;
  }

  // Read and validate everything before touching the database.
  const pending: PendingImport[] = [];
  try {
    if (args.mode === 'file') {
      const parsed = parsePriceCsv(readPriceFile(args.file), args.series);
      pending.push({ key: args.series, sourceKind: 'file', sourceUrl: args.sourceUrl, retrievedAt: args.retrievedAt, parsed });
    } else if (args.mode === 'bundled') {
      for (const { entry, bytes } of readBundledPrices(deps.dataDir ?? defaultPriceDataDir()).files) {
        const parsed = parsePriceCsv(bytes, entry.series);
        if (parsed.rows.length !== entry.rows || parsed.firstDate !== entry.firstDate || parsed.lastDate !== entry.lastDate) throw new PriceDataError(`manifest rows or dates do not match ${entry.file}`);
        pending.push({ key: entry.series, sourceKind: 'bundled', sourceUrl: entry.sourceUrl, retrievedAt: entry.retrievedAt, parsed });
      }
    } else if (args.mode === 'fetch') {
      const bytes = await fetchPinned(args.series, deps.fetch ?? fetch);
      pending.push({ key: args.series, sourceKind: 'fetch', sourceUrl: PRICE_SERIES[args.series].sourceUrl, retrievedAt: today, parsed: parsePriceCsv(bytes, args.series) });
    }
  } catch (e) {
    if (e instanceof PricesNetworkError) {
      err(`network error: ${e.message}\n`);
      return 3;
    }
    if (e instanceof PricesUsageError || e instanceof PriceDataError || e instanceof PriceCsvError) {
      err(`${e instanceof PriceCsvError ? 'parse error' : 'validation error'}: ${e.message}\n`);
      return 2;
    }
    throw e;
  }

  let db: PriceImportDb;
  try {
    db = (deps.openDb ?? realDb)(url);
  } catch {
    err('database error: could not open the owner connection\n');
    return 3;
  }
  try {
    if (args.mode === 'list') {
      for (const key of PRICE_SERIES_KEYS) {
        const a = await db.readActiveImport(key);
        out(
          a === null
            ? `${key}: no import\n`
            : `${key}: import ${a.id} sha256 ${a.sha256} rows ${a.rowCount} ${a.firstDate}..${a.lastDate} source ${a.sourceKind} retrieved ${a.retrievedAt}\n`,
        );
      }
      return 0;
    }
    let refused = false;
    for (const p of pending) {
      const r = await db.insertImport(p);
      out(outcomeLine(p, r));
      if (r.outcome === 'would_remove_history') refused = true;
    }
    return refused ? 2 : 0;
  } catch {
    // Never echo driver messages: they can carry connection details.
    err('database error: the import was not written\n');
    return 3;
  } finally {
    await db.close().catch(() => undefined);
  }
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url : false;
if (invoked) {
  void main(
    process.argv.slice(2),
    (s) => process.stdout.write(s),
    (s) => process.stderr.write(s),
  ).then((code) => {
    process.exitCode = code;
  });
}
