/**
 * Bundled public price history (REQ-20261011-fuel-outlook, Part C F2, F8, F9): the strict manifest schema,
 * the default data directory and a guarded file reader (relative path inside the directory, regular file,
 * no symlink, at most 1 MiB). Used by `eval:outlook` and `prices:import --bundled`. No network, no writes.
 */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PRICE_CSV_MAX_BYTES, PRICE_SERIES, PRICE_SERIES_KEYS } from '@fr/shared/outlook';
import { z } from 'zod';

export class PriceDataError extends Error {}

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
const FILE = /^[A-Za-z0-9_-]{1,64}\.csv$/u;

export const PriceManifestEntry = z.strictObject({
  series: z.enum(PRICE_SERIES_KEYS),
  file: z.string().regex(FILE),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  sourceUrl: z.string(),
  retrievedAt: z.string().regex(DATE),
  rows: z.int().min(1).max(5000),
  firstDate: z.string().regex(DATE),
  lastDate: z.string().regex(DATE),
});
export type PriceManifestEntryDto = z.infer<typeof PriceManifestEntry>;

export const PriceManifest = z
  .strictObject({ version: z.literal(1), files: z.array(PriceManifestEntry).min(1).max(PRICE_SERIES_KEYS.length) })
  .refine((m) => new Set(m.files.map((f) => f.series)).size === m.files.length, { message: 'a series is listed twice' })
  .refine((m) => m.files.every((f) => f.sourceUrl === PRICE_SERIES[f.series].sourceUrl), { message: 'sourceUrl is not the pinned URL of the series' });
export type PriceManifestDto = z.infer<typeof PriceManifest>;

/** Manifest size cap (the real one is < 1 KiB). */
const MANIFEST_MAX_BYTES = 65_536;

/**
 * `api/data/public-prices/` from this module: `src/platform/` (tsx, vitest) is two levels below `api/`,
 * `dist/src/platform/` (built) is three.
 */
export function defaultPriceDataDir(moduleUrl: string = import.meta.url): string {
  const up = moduleUrl.includes('/dist/src/') ? '../../../' : '../../';
  return fileURLToPath(new URL(`${up}data/public-prices/`, moduleUrl));
}

/** Guarded read of `rel` inside `dir`: relative, no escape, regular file (no symlink), size cap. */
export function readGuardedFile(dir: string, rel: string, maxBytes: number): Buffer {
  if (path.isAbsolute(rel) || rel.includes('\0')) throw new PriceDataError(`file must be relative: ${rel}`);
  let root: string;
  try {
    root = realpathSync(dir);
  } catch {
    throw new PriceDataError('data directory not found');
  }
  const full = path.resolve(root, rel);
  const relToRoot = path.relative(root, full);
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) throw new PriceDataError(`file escapes the data directory: ${rel}`);
  let st;
  try {
    st = lstatSync(full);
  } catch {
    throw new PriceDataError(`file missing: ${rel}`);
  }
  if (st.isSymbolicLink() || !st.isFile()) throw new PriceDataError(`not a regular file: ${rel}`);
  if (st.size > maxBytes) throw new PriceDataError(`file too large: ${rel}`);
  return readFileSync(full);
}

export function sha256OfBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface BundledFile {
  entry: PriceManifestEntryDto;
  bytes: Uint8Array;
}

/** Read and validate `manifest.json`, then read every listed file and check its sha256. */
export function readBundledPrices(dir: string): { manifest: PriceManifestDto; files: BundledFile[] } {
  const raw = readGuardedFile(dir, 'manifest.json', MANIFEST_MAX_BYTES);
  let json: unknown;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new PriceDataError('manifest.json is not valid JSON');
  }
  const parsed = PriceManifest.safeParse(json);
  if (!parsed.success) throw new PriceDataError('manifest.json does not match the schema');
  const files = parsed.data.files.map((entry) => {
    const bytes = new Uint8Array(readGuardedFile(dir, entry.file, PRICE_CSV_MAX_BYTES));
    if (sha256OfBytes(bytes) !== entry.sha256) throw new PriceDataError(`sha256 mismatch: ${entry.file}`);
    return { entry, bytes };
  });
  return { manifest: parsed.data, files };
}
