/**
 * Step 7 cost outlook route (REQ-20261011-fuel-outlook, Part C F7.9, F10, F12). `GET /api/v1/outlook`:
 * tenant users with `claims:read`, `intelligence` rate bucket, flag `intelligence.cost_outlook` (OFF -> 404).
 * Public price data only: the outlook is read from the price store (memoized per active import; never
 * computed from data fetched during a request) and writes no audit event. S2: with `fscTableId` (fuel-check
 * flag on, a non-archived diesel table of the tenant) every diesel horizon also carries the table rate at
 * its rounded point, low and high. A price-store read error is 503 `service_unavailable`.
 */
import {
  OUTLOOK_NOTE,
  OUTLOOK_VERSION,
  OutlookQuery,
  OutlookResponse,
  PRICE_SERIES,
  PRICE_SERIES_KEYS,
  type OutlookHorizonDto,
  type OutlookResponseDto,
  type OutlookSeriesDto,
  type PriceSeriesKey,
} from '@fr/shared';
import { evaluateFscTable, type FscTableSpec } from '@fr/shared/fuel';
import type { FastifyInstance } from 'fastify';

import { errors } from '../http/errors.js';
import { defineRoute, requireTenant } from '../http/route.js';
import { strictBody } from '../http/strict-body.js';
import type { FlagService } from '../platform/flags.js';
import type { PriceOutlook, PriceStore } from '../platform/price-store.js';

import { toTableSpec } from './fuel.js';

const P = '/api/v1';
const FLAG = 'intelligence.cost_outlook';
const FUEL_FLAG = 'intelligence.fuel_check';
const RATIO_SCALE = 1000;
const DM_SCALE = 100;
const COVERAGE_SCALE = 1000;

export interface OutlookRouteDeps {
  flags: FlagService;
  prices: PriceStore;
}

const round = (x: number, scale: number): number => Math.round(x * scale) / scale;

/** F7.9 mapping of one series (pure; exported for unit tests). */
export function outlookSeriesDto(key: PriceSeriesKey, data: PriceOutlook | null, table: FscTableSpec | null): OutlookSeriesDto {
  const def = PRICE_SERIES[key];
  const head = { key, label: def.label, unit: def.unit, frequency: def.frequency, citation: def.citation };
  if (data === null) return { ...head, status: 'no_data', provenance: null, latest: null, backtestYears: null, horizons: [] };
  const p = data.provenance;
  const obs = data.series.observations;
  const last = obs[obs.length - 1];
  const fx = (x: number): string => x.toFixed(def.displayDecimals);
  const withFsc = table !== null && key === 'diesel_us';
  const rate = (price: string): string => (table === null ? '0' : evaluateFscTable(table, price).rate);
  const horizons: OutlookHorizonDto[] = data.outlook.horizons.map((h) => {
    const point = fx(h.point);
    const low = fx(h.low);
    const high = fx(h.high);
    return {
      h: h.h,
      unit: h.unit,
      targetDate: h.targetDate,
      method: h.method,
      reason: h.reason,
      point,
      low,
      high,
      backtest: {
        candidate: h.candidate,
        origins: h.origins,
        maeRatio: h.maeRatio === null ? null : round(h.maeRatio, RATIO_SCALE),
        dm: round(h.dm, DM_SCALE),
        coverage: round(h.coverage, COVERAGE_SCALE),
        coverageHits: h.coverageHits,
        coverageCases: h.coverageCases,
      },
      fsc: withFsc ? { point: rate(point), low: rate(low), high: rate(high) } : null,
    };
  });
  return {
    ...head,
    status: data.outlook.status,
    provenance: { importId: p.id, sourceUrl: p.sourceUrl, retrievedAt: p.retrievedAt, sha256: p.sha256, rowCount: p.rowCount, firstDate: p.firstDate, lastDate: p.lastDate },
    latest: last === undefined ? null : { date: last.date, value: last.value },
    backtestYears: data.outlook.backtestYears,
    horizons,
  };
}

export function registerOutlookRoutes(app: FastifyInstance, deps: OutlookRouteDeps): void {
  defineRoute(app, {
    method: 'GET',
    url: `${P}/outlook`,
    access: { kind: 'permission', permission: 'claims:read' },
    rateGroup: 'intelligence',
    schema: { query: OutlookQuery },
    handler: async (req, _reply, { query }) => {
      const ctx = requireTenant(req);
      if (!(await deps.flags.isEnabled(FLAG))) throw errors.notFound();
      let table: FscTableSpec | null = null;
      if (query.fscTableId !== undefined) {
        if (!(await deps.flags.isEnabled(FUEL_FLAG))) throw errors.notFound();
        const id = query.fscTableId;
        const row = await ctx.db.tx((tx) =>
          tx.fscTable.findFirst({
            where: { id, archivedAt: null, priceSeries: 'diesel_us' },
            select: { id: true, name: true, kind: true, unit: true, priceSeries: true, effectiveOffsetDays: true, params: true, version: true, archivedAt: true, createdAt: true, updatedAt: true },
          }),
        );
        if (!row) throw errors.notFound();
        table = toTableSpec(row);
      }
      const series: OutlookSeriesDto[] = [];
      for (const key of PRICE_SERIES_KEYS) {
        let data: PriceOutlook | null;
        try {
          data = await deps.prices.getOutlook(key);
        } catch {
          throw errors.serviceUnavailable();
        }
        series.push(outlookSeriesDto(key, data, table));
      }
      const diesel = series.find((s) => s.key === 'diesel_us');
      const latest = diesel?.latest ?? null;
      const body: OutlookResponseDto = {
        outlookVersion: OUTLOOK_VERSION,
        note: OUTLOOK_NOTE,
        series,
        fscTable:
          table === null || latest === null
            ? null
            : { id: table.id, name: table.name, version: table.version, unit: table.unit, current: evaluateFscTable(table, latest.value).rate },
      };
      return strictBody(OutlookResponse, body);
    },
  });
}
