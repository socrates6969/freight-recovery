/**
 * Global public price store (REQ-20261011-fuel-outlook, Part C F9, F14). `price_imports` and
 * `price_observations` hold public U.S. government data only (no tenant content). Reads run in a system
 * transaction (the runtime role has SELECT only). Writes happen ONLY through `insertImport`, called by
 * the owner-connection importer CLI and the seed: one system transaction takes a per-series advisory lock,
 * re-reads the active import, refuses a shrinking snapshot, inserts the import row and all observations and
 * appends `price_data.imported` to the PLATFORM audit chain (actor null). Fix round 1 (L1): a snapshot that
 * changes any value of a date the active import already covers (a source revision) is refused unless the
 * caller passes `acceptRevisions`; the count is reported and audited (`revisedValues`). The tables are append-only
 * (triggers); the newest import per series (imported_at desc, id desc) is the active one.
 */
import type { ParsedPriceCsv, PriceSeriesKey } from '@fr/shared/outlook';

import { appendAudit } from '../audit/audit.js';

import type { BaseClient } from './client.js';
import { withSystemTx, type SystemTx } from './system.js';

/** Observations per createMany statement. */
const INSERT_CHUNK = 1000;
/** Transaction timeout of one import (a few thousand rows). */
const IMPORT_TX_TIMEOUT_MS = 60_000;

export type PriceSourceKind = 'file' | 'bundled' | 'fetch';

export interface ActiveImportRow {
  id: string;
  seriesKey: PriceSeriesKey;
  sourceKind: PriceSourceKind;
  sourceUrl: string;
  retrievedAt: string;
  sha256: string;
  rowCount: number;
  firstDate: string;
  lastDate: string;
  importedAt: string;
}

/** `YYYY-MM-DD` of a DATE column (UTC components). */
export function dateText(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A `YYYY-MM-DD` text as the UTC midnight Date Prisma writes to a DATE column. */
export function dateValue(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

type ImportRow = {
  id: string;
  seriesKey: string;
  sourceKind: string;
  sourceUrl: string;
  retrievedAt: Date;
  sha256: string;
  rowCount: number;
  firstDate: Date;
  lastDate: Date;
  importedAt: Date;
};

function toActive(r: ImportRow): ActiveImportRow {
  return {
    id: r.id,
    seriesKey: r.seriesKey as PriceSeriesKey,
    sourceKind: r.sourceKind as PriceSourceKind,
    sourceUrl: r.sourceUrl,
    retrievedAt: dateText(r.retrievedAt),
    sha256: r.sha256,
    rowCount: r.rowCount,
    firstDate: dateText(r.firstDate),
    lastDate: dateText(r.lastDate),
    importedAt: r.importedAt.toISOString(),
  };
}

async function activeIn(tx: SystemTx, key: PriceSeriesKey): Promise<ActiveImportRow | null> {
  const row = await tx.priceImport.findFirst({ where: { seriesKey: key }, orderBy: [{ importedAt: 'desc' }, { id: 'desc' }] });
  return row === null ? null : toActive(row);
}

/** The active import of a series (one query), or null when none exists. */
export async function readActiveImport(base: BaseClient, key: PriceSeriesKey): Promise<ActiveImportRow | null> {
  return withSystemTx(base, (tx) => activeIn(tx, key));
}

/** Observations of one import in date order: `{ date: YYYY-MM-DD, value: 3-decimal text }`. */
export async function readObservations(base: BaseClient, importId: string): Promise<{ date: string; value: string }[]> {
  const rows = await withSystemTx(base, (tx) =>
    tx.priceObservation.findMany({ where: { importId }, orderBy: { periodDate: 'asc' }, select: { periodDate: true, value: true } }),
  );
  return rows.map((r) => ({ date: dateText(r.periodDate), value: r.value.toFixed(3) }));
}

export interface InsertImportArgs {
  key: PriceSeriesKey;
  sourceKind: PriceSourceKind;
  sourceUrl: string;
  retrievedAt: string;
  parsed: ParsedPriceCsv;
  /** Fix round 1 (L1): allow an import that changes values of dates the active import covers. */
  acceptRevisions?: boolean;
}

export type InsertImportOutcome =
  | { outcome: 'imported'; importId: string; active: ActiveImportRow | null; revisedValues: number }
  | { outcome: 'unchanged'; importId: string; active: ActiveImportRow }
  | { outcome: 'would_remove_history'; importId: null; active: ActiveImportRow }
  | { outcome: 'revisions_refused'; importId: null; active: ActiveImportRow; revisedValues: number };

/** Number of dates present in both snapshots whose value differs (exact 3-decimal text comparison). */
export function countRevisedValues(active: readonly { date: string; value: string }[], next: readonly { date: string; value: string }[]): number {
  const byDate = new Map(active.map((o) => [o.date, o.value]));
  let n = 0;
  for (const o of next) {
    const old = byDate.get(o.date);
    if (old !== undefined && old !== o.value) n += 1;
  }
  return n;
}

/**
 * F9 import semantics for one series, in ONE system transaction on the OWNER connection. Imports of one
 * series are serialized by a transaction-scoped advisory lock.
 */
export async function insertImport(ownerBase: BaseClient, args: InsertImportArgs): Promise<InsertImportOutcome> {
  const { key, parsed } = args;
  return withSystemTx(
    ownerBase,
    async (tx): Promise<InsertImportOutcome> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fr_price_import:' || ${key}))`;
      const active = await activeIn(tx, key);
      if (active !== null && active.sha256 === parsed.sha256) return { outcome: 'unchanged', importId: active.id, active };
      if (active !== null && (parsed.firstDate > active.firstDate || parsed.lastDate < active.lastDate)) {
        return { outcome: 'would_remove_history', importId: null, active };
      }
      let revisedValues = 0;
      if (active !== null) {
        const old = await tx.priceObservation.findMany({ where: { importId: active.id }, orderBy: { periodDate: 'asc' }, select: { periodDate: true, value: true } });
        revisedValues = countRevisedValues(
          old.map((r) => ({ date: dateText(r.periodDate), value: r.value.toFixed(3) })),
          parsed.rows,
        );
        if (revisedValues > 0 && args.acceptRevisions !== true) return { outcome: 'revisions_refused', importId: null, active, revisedValues };
      }
      const created = await tx.priceImport.create({
        data: {
          seriesKey: key,
          sourceKind: args.sourceKind,
          sourceUrl: args.sourceUrl,
          retrievedAt: dateValue(args.retrievedAt),
          sha256: parsed.sha256,
          rowCount: parsed.rows.length,
          firstDate: dateValue(parsed.firstDate),
          lastDate: dateValue(parsed.lastDate),
        },
        select: { id: true },
      });
      for (let i = 0; i < parsed.rows.length; i += INSERT_CHUNK) {
        await tx.priceObservation.createMany({
          data: parsed.rows.slice(i, i + INSERT_CHUNK).map((r) => ({ importId: created.id, periodDate: dateValue(r.date), value: r.value })),
        });
      }
      await appendAudit(tx, {
        tenantId: null,
        action: 'price_data.imported',
        actorId: null,
        actorRole: null,
        targetType: 'price_series',
        targetId: key,
        metadata: {
          seriesKey: key,
          importId: created.id,
          sha256: parsed.sha256,
          rowCount: parsed.rows.length,
          firstDate: parsed.firstDate,
          lastDate: parsed.lastDate,
          sourceKind: args.sourceKind,
          sourceUrl: args.sourceUrl,
          retrievedAt: args.retrievedAt,
          revisedValues,
        },
      });
      return { outcome: 'imported', importId: created.id, active, revisedValues };
    },
    { timeoutMs: IMPORT_TX_TIMEOUT_MS },
  );
}
