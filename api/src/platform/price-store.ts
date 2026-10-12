/**
 * Read side of the public price store (REQ-20261011-fuel-outlook, Part C F7.11, F9, F16). Request paths
 * read prices ONLY through this class: it never fetches anything from the network. The active import id
 * per series is cached for PRICE_CACHE_TTL_MS (0 = no cache); observations and the computed outlook are
 * immutable per import id and memoized (at most two imports kept per series), so the outlook is
 * recomputed exactly when the active import changes. Read errors propagate; callers decide (fuel check:
 * price_unavailable; outlook route: 503).
 */
import { computeOutlook, PRICE_SERIES_KEYS, type OutlookComputation, type PriceSeriesData, type PriceSeriesKey } from '@fr/shared/outlook';

import type { BaseClient } from '../db/client.js';
import { readActiveImport, readObservations, type ActiveImportRow } from '../db/prices.js';

/** Imports kept in memory per series (the active one and the previous one). */
const IMPORTS_KEPT = 2;

export interface PriceSnapshot {
  provenance: ActiveImportRow;
  series: PriceSeriesData;
}

export interface PriceOutlook extends PriceSnapshot {
  outlook: OutlookComputation;
}

interface ActiveEntry {
  row: ActiveImportRow | null;
  expiresAt: number;
}

interface DataEntry {
  snapshot: Promise<PriceSnapshot>;
  outlook: Promise<OutlookComputation> | null;
}

/** Dependencies of the store (the DB reads by default; tests inject fakes). */
export interface PriceReader {
  readActiveImport(key: PriceSeriesKey): Promise<ActiveImportRow | null>;
  readObservations(importId: string): Promise<{ date: string; value: string }[]>;
}

export function dbPriceReader(base: BaseClient): PriceReader {
  return {
    readActiveImport: (key) => readActiveImport(base, key),
    readObservations: (importId) => readObservations(base, importId),
  };
}

/** The active diesel import, or null when it cannot be read (the fuel check then reports price_unavailable). */
export async function dieselSeriesOrNull(prices: PriceStore): Promise<PriceSeriesData | null> {
  try {
    return await prices.getSeries('diesel_us');
  } catch {
    return null;
  }
}

export class PriceStore {
  private readonly active = new Map<PriceSeriesKey, ActiveEntry>();
  private readonly data = new Map<PriceSeriesKey, Map<string, DataEntry>>();

  constructor(
    private readonly reader: PriceReader,
    private readonly cacheTtlMs: number,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  /** The active import row of a series (cached for the TTL), or null when nothing was imported. */
  async activeImport(key: PriceSeriesKey): Promise<ActiveImportRow | null> {
    if (!(PRICE_SERIES_KEYS as readonly string[]).includes(key)) throw new RangeError('unknown price series');
    const now = this.nowMs();
    const hit = this.active.get(key);
    if (hit && hit.expiresAt > now) return hit.row;
    const row = await this.reader.readActiveImport(key);
    if (this.cacheTtlMs > 0) this.active.set(key, { row, expiresAt: now + this.cacheTtlMs });
    return row;
  }

  private entry(key: PriceSeriesKey, row: ActiveImportRow): DataEntry {
    let perKey = this.data.get(key);
    if (perKey === undefined) {
      perKey = new Map();
      this.data.set(key, perKey);
    }
    const hit = perKey.get(row.id);
    if (hit !== undefined) return hit;
    const snapshot = this.reader.readObservations(row.id).then((observations) => ({
      provenance: row,
      series: { key, importId: row.id, sha256: row.sha256, sourceUrl: row.sourceUrl, retrievedAt: row.retrievedAt, observations },
    }));
    const created: DataEntry = { snapshot, outlook: null };
    perKey.set(row.id, created);
    snapshot.catch(() => perKey.delete(row.id));
    while (perKey.size > IMPORTS_KEPT) {
      const oldest = perKey.keys().next().value;
      if (oldest === undefined) break;
      perKey.delete(oldest);
    }
    return created;
  }

  /** The active import with its observations, or null when nothing was imported. */
  async getSnapshot(key: PriceSeriesKey): Promise<PriceSnapshot | null> {
    const row = await this.activeImport(key);
    return row === null ? null : this.entry(key, row).snapshot;
  }

  /** `PriceSeriesData` of the active import (the fuel check input), or null. */
  async getSeries(key: PriceSeriesKey): Promise<PriceSeriesData | null> {
    return (await this.getSnapshot(key))?.series ?? null;
  }

  /** The F7 outlook of the active import, memoized per import id; null when nothing was imported. */
  async getOutlook(key: PriceSeriesKey): Promise<PriceOutlook | null> {
    const row = await this.activeImport(key);
    if (row === null) return null;
    const e = this.entry(key, row);
    const snapshot = await e.snapshot;
    if (e.outlook === null) {
      const obs = snapshot.series.observations;
      e.outlook = Promise.resolve().then(() =>
        computeOutlook(
          obs.map((o) => o.date),
          obs.map((o) => o.value),
          key,
        ),
      );
      e.outlook.catch(() => {
        e.outlook = null;
      });
    }
    return { ...snapshot, outlook: await e.outlook };
  }
}
