/**
 * Step 7 fuel-check service (REQ-20261011-fuel-outlook, spec A11, Part C F4, F6, F10, F13).
 *
 * - Fuel tables: a tenant's carrier fuel-surcharge schedules. Created (cap FSC_TABLES_MAX, serialized per
 *   tenant), updated with optimistic versioning, archived (never deleted).
 * - Claim fuel inputs: ship date, miles and table of one claim; set or cleared only while the claim is
 *   AWAITING_ANALYSIS (claim row lock).
 * - Fuel-check view: the F5 result computed now from the claim's current bundle, the current table version,
 *   the active diesel import and (charge flag on) the tenant's charge classifier. A preview; it never
 *   changes a stored packet.
 * Every operation runs in ONE tenant transaction; changes append their audit event in the same
 * transaction. Metadata never carries a table name or invoice text.
 */
import {
  AnalysisInputError,
  DEFAULT_ANALYSIS_SETTINGS,
  FSC_KINDS,
  FSC_TABLES_MAX,
  FSC_UNITS,
  canonicalJson,
  type ClaimFuelInputsDto,
  type FscKind,
  type FscParamsDto,
  type FscTableBodyInput,
  type FscTableDto,
  type FscTableListDto,
  type FscUnit,
  type FuelCheckViewDto,
  type SetFuelInputsInput,
  type SetFuelInputsResponseDto,
  type UpdateFscTableBodyInput,
} from '@fr/shared';
import { checkFuel, type FscTableSpec, type FuelCheckInput, type PriceSeriesData } from '@fr/shared/fuel';

import { appendAudit } from '../audit/audit.js';
import type { Actor } from '../claims/service.js';
import { isUuid } from '../db/errors.js';
import { lockFscTables } from '../db/fuel-locks.js';
import { lockClaimForUpdate, type TenantDb, type TenantTx } from '../db/tenant.js';
import { errors } from '../http/errors.js';
import { loadAnalysisInput } from '../imports/bundle.js';

import { loadClassifier } from './charges.js';

const TABLE_SELECT = {
  id: true,
  name: true,
  kind: true,
  unit: true,
  priceSeries: true,
  effectiveOffsetDays: true,
  params: true,
  version: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface TableRow {
  id: string;
  name: string;
  kind: string;
  unit: string;
  priceSeries: string;
  effectiveOffsetDays: number;
  params: unknown;
  version: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface InputRow {
  claimId: string;
  shipDate: Date;
  miles: { toFixed(n: number): string } | null;
  fscTableId: string;
  version: number;
  updatedAt: Date;
}

const INPUT_SELECT = { claimId: true, shipDate: true, miles: true, fscTableId: true, version: true, updatedAt: true } as const;

/** Fields compared for `changedFields` (sorted). */
const TABLE_FIELDS = ['effectiveOffsetDays', 'kind', 'name', 'params', 'priceSeries', 'unit'] as const;

function dbKind(v: string): FscKind {
  if (!(FSC_KINDS as readonly string[]).includes(v)) throw new Error('fsc_tables.kind outside the registry');
  return v as FscKind;
}

function dbUnit(v: string): FscUnit {
  if (!(FSC_UNITS as readonly string[]).includes(v)) throw new Error('fsc_tables.unit outside the registry');
  return v as FscUnit;
}

function dbSeries(v: string): 'diesel_us' {
  if (v !== 'diesel_us') throw new Error('fsc_tables.price_series outside the registry');
  return v;
}

/** `YYYY-MM-DD` of a DATE column (UTC components). */
const dateText = (d: Date): string => d.toISOString().slice(0, 10);
const dateValue = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

/** A miles text (`^[0-9]{1,5}(\.[0-9])?$`) with exactly one decimal and no leading zeros. */
export function milesText(miles: string): string {
  const [int = '0', frac = '0'] = miles.split('.');
  return `${BigInt(int).toString()}.${frac}`;
}

export function toTableDto(r: TableRow): FscTableDto {
  return {
    id: r.id,
    name: r.name,
    kind: dbKind(r.kind),
    unit: dbUnit(r.unit),
    priceSeries: dbSeries(r.priceSeries),
    effectiveOffsetDays: r.effectiveOffsetDays,
    params: r.params as FscParamsDto,
    version: r.version,
    archived: r.archivedAt !== null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toTableSpec(r: TableRow): FscTableSpec {
  return {
    id: r.id,
    name: r.name,
    version: r.version,
    kind: dbKind(r.kind),
    unit: dbUnit(r.unit),
    priceSeries: dbSeries(r.priceSeries),
    effectiveOffsetDays: r.effectiveOffsetDays,
    params: r.params as FscParamsDto,
    archived: r.archivedAt !== null,
  };
}

function toInputsDto(r: InputRow): ClaimFuelInputsDto {
  return {
    claimId: r.claimId,
    shipDate: dateText(r.shipDate),
    miles: r.miles === null ? null : r.miles.toFixed(1),
    fscTableId: r.fscTableId,
    version: r.version,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/**
 * The claim's fuel inputs with their CURRENT table (analysis and the fuel-check view), or null when the
 * claim has none. `series` is the active diesel import (null when unavailable).
 */
export async function loadFuelInput(
  tx: TenantTx,
  claimId: string,
  series: PriceSeriesData | null,
): Promise<{ input: FuelCheckInput; inputs: ClaimFuelInputsDto; table: FscTableDto } | null> {
  const row = await tx.claimFuelInput.findFirst({ where: { claimId }, select: INPUT_SELECT });
  if (!row) return null;
  const table = await tx.fscTable.findFirst({ where: { id: row.fscTableId }, select: TABLE_SELECT });
  if (!table) return null;
  const inputs = toInputsDto(row);
  return { input: { shipDate: inputs.shipDate, miles: inputs.miles, table: toTableSpec(table), series }, inputs, table: toTableDto(table) };
}

/** GET /fuel-tables: name asc, then id; archived tables only when asked. */
export async function listTables(db: TenantDb, includeArchived: boolean): Promise<FscTableListDto> {
  return db.tx(async (tx) => {
    const rows = await tx.fscTable.findMany({
      where: includeArchived ? {} : { archivedAt: null },
      select: TABLE_SELECT,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return { items: rows.map(toTableDto) };
  });
}

const isUniqueViolation = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';

function auditTable(tx: TenantTx, db: TenantDb, actor: Actor, action: 'fsc_table.created' | 'fsc_table.updated' | 'fsc_table.archived', id: string, metadata: Record<string, unknown>) {
  return appendAudit(tx, {
    tenantId: db.tenantId,
    action,
    actorId: actor.userId,
    actorRole: actor.role,
    targetType: 'fsc_table',
    targetId: id,
    metadata,
    ip: actor.ip,
    requestId: actor.requestId,
  });
}

/** POST /fuel-tables: 409 fuel_table_limit_reached at the cap, 409 conflict on a taken name. */
export async function createTable(db: TenantDb, actor: Actor, body: FscTableBodyInput): Promise<FscTableDto> {
  try {
    return await db.tx(async (tx) => {
      await lockFscTables(tx, db.tenantId);
      if ((await tx.fscTable.count()) >= FSC_TABLES_MAX) throw errors.fuelTableLimitReached();
      if (await tx.fscTable.findFirst({ where: { name: body.name }, select: { id: true } })) throw errors.conflict();
      const created = await tx.fscTable.create({
        data: {
          tenantId: db.tenantId,
          name: body.name,
          kind: body.kind,
          unit: body.unit,
          priceSeries: body.priceSeries,
          effectiveOffsetDays: body.effectiveOffsetDays,
          params: body.params,
          version: 1,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
        select: TABLE_SELECT,
      });
      await auditTable(tx, db, actor, 'fsc_table.created', created.id, {
        fscTableId: created.id,
        version: created.version,
        kind: body.kind,
        unit: body.unit,
        priceSeries: body.priceSeries,
        effectiveOffsetDays: body.effectiveOffsetDays,
      });
      return toTableDto(created);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw errors.conflict();
    throw e;
  }
}

/** PUT /fuel-tables/:id: optimistic update (version + 1); unchanged bodies write nothing. */
export async function updateTable(db: TenantDb, actor: Actor, id: string, body: UpdateFscTableBodyInput): Promise<FscTableDto> {
  if (!isUuid(id)) throw errors.notFound();
  try {
    return await db.tx(async (tx) => {
      const row = await tx.fscTable.findFirst({ where: { id }, select: TABLE_SELECT });
      if (!row) throw errors.notFound();
      if (row.archivedAt !== null) throw errors.invalidState();
      if (row.version !== body.expectedVersion) throw errors.staleRevision();
      const next = { name: body.name, kind: body.kind, unit: body.unit, priceSeries: body.priceSeries, effectiveOffsetDays: body.effectiveOffsetDays, params: body.params };
      const before: Record<(typeof TABLE_FIELDS)[number], unknown> = {
        name: row.name,
        kind: row.kind,
        unit: row.unit,
        priceSeries: row.priceSeries,
        effectiveOffsetDays: row.effectiveOffsetDays,
        params: row.params,
      };
      const changedFields = TABLE_FIELDS.filter((f) => canonicalJson(before[f]) !== canonicalJson(next[f]));
      if (changedFields.length === 0) return toTableDto(row);
      if (changedFields.includes('name') && (await tx.fscTable.findFirst({ where: { name: body.name, NOT: { id } }, select: { id: true } }))) throw errors.conflict();
      const updated = await tx.fscTable.updateMany({
        where: { id, version: body.expectedVersion },
        data: { ...next, version: { increment: 1 }, updatedById: actor.userId },
      });
      if (updated.count !== 1) throw errors.staleRevision();
      const fresh = await tx.fscTable.findFirst({ where: { id }, select: TABLE_SELECT });
      if (!fresh) throw errors.notFound();
      await auditTable(tx, db, actor, 'fsc_table.updated', id, {
        fscTableId: id,
        version: fresh.version,
        previousVersion: row.version,
        kind: body.kind,
        unit: body.unit,
        priceSeries: body.priceSeries,
        effectiveOffsetDays: body.effectiveOffsetDays,
        changedFields: [...changedFields],
      });
      return toTableDto(fresh);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw errors.conflict();
    throw e;
  }
}

/** DELETE /fuel-tables/:id: archive (idempotent; an archived table writes nothing). */
export async function archiveTable(db: TenantDb, actor: Actor, id: string): Promise<void> {
  if (!isUuid(id)) throw errors.notFound();
  await db.tx(async (tx) => {
    const row = await tx.fscTable.findFirst({ where: { id }, select: { id: true, version: true, archivedAt: true } });
    if (!row) throw errors.notFound();
    if (row.archivedAt !== null) return;
    const updated = await tx.fscTable.updateMany({
      where: { id, version: row.version, archivedAt: null },
      data: { archivedAt: new Date(), version: { increment: 1 }, updatedById: actor.userId },
    });
    if (updated.count !== 1) throw errors.staleRevision();
    await auditTable(tx, db, actor, 'fsc_table.archived', id, { fscTableId: id, version: row.version + 1 });
  });
}

/** The claim checks of the input routes: 404 unknown/other tenant, 409 unless AWAITING_ANALYSIS. */
async function lockAwaitingClaim(tx: TenantTx, claimId: string): Promise<void> {
  if (!(await lockClaimForUpdate(tx, claimId))) throw errors.notFound();
  const claim = await tx.claim.findFirst({ where: { id: claimId }, select: { status: true } });
  if (!claim) throw errors.notFound();
  if (claim.status !== 'AWAITING_ANALYSIS') throw errors.invalidState();
}

function auditInputs(tx: TenantTx, db: TenantDb, actor: Actor, action: 'claim.fuel_inputs_set' | 'claim.fuel_inputs_cleared', claimId: string, metadata: Record<string, unknown>) {
  return appendAudit(tx, {
    tenantId: db.tenantId,
    action,
    actorId: actor.userId,
    actorRole: actor.role,
    targetType: 'claim',
    targetId: claimId,
    metadata,
    ip: actor.ip,
    requestId: actor.requestId,
  });
}

/** PUT /claims/:id/fuel-inputs (F6, F10): created / changed / unchanged. */
export async function setInputs(db: TenantDb, actor: Actor, claimId: string, body: SetFuelInputsInput): Promise<SetFuelInputsResponseDto> {
  if (!isUuid(claimId)) throw errors.notFound();
  return db.tx(async (tx) => {
    await lockAwaitingClaim(tx, claimId);
    const table = await tx.fscTable.findFirst({ where: { id: body.fscTableId }, select: { id: true, unit: true, archivedAt: true } });
    if (!table || table.archivedAt !== null) throw errors.fuelTableUnavailable();
    if (table.unit === 'per_mile' && body.miles === null) throw errors.milesRequired();
    const miles = body.miles === null ? null : milesText(body.miles);
    const existing = await tx.claimFuelInput.findFirst({ where: { claimId }, select: { id: true, ...INPUT_SELECT } });
    const data = { shipDate: dateValue(body.shipDate), miles, fscTableId: body.fscTableId };
    let row: InputRow;
    let outcome: 'created' | 'changed' | 'unchanged';
    if (!existing) {
      row = await tx.claimFuelInput.create({
        data: { ...data, tenantId: db.tenantId, claimId, version: 1, createdById: actor.userId, updatedById: actor.userId },
        select: INPUT_SELECT,
      });
      outcome = 'created';
    } else {
      const same = dateText(existing.shipDate) === body.shipDate && (existing.miles === null ? null : existing.miles.toFixed(1)) === miles && existing.fscTableId === body.fscTableId;
      if (same) return { inputs: toInputsDto(existing), outcome: 'unchanged' };
      row = await tx.claimFuelInput.update({
        where: { id: existing.id },
        data: { ...data, version: { increment: 1 }, updatedById: actor.userId },
        select: INPUT_SELECT,
      });
      outcome = 'changed';
    }
    const inputs = toInputsDto(row);
    await auditInputs(tx, db, actor, 'claim.fuel_inputs_set', claimId, { claimId, fscTableId: inputs.fscTableId, shipDate: inputs.shipDate, miles: inputs.miles, outcome, version: inputs.version });
    return { inputs, outcome };
  });
}

/** DELETE /claims/:id/fuel-inputs: idempotent; audits only when inputs were removed. */
export async function clearInputs(db: TenantDb, actor: Actor, claimId: string): Promise<void> {
  if (!isUuid(claimId)) throw errors.notFound();
  await db.tx(async (tx) => {
    await lockAwaitingClaim(tx, claimId);
    const existing = await tx.claimFuelInput.findFirst({ where: { claimId }, select: { id: true } });
    if (!existing) return;
    await tx.claimFuelInput.delete({ where: { id: existing.id } });
    await auditInputs(tx, db, actor, 'claim.fuel_inputs_cleared', claimId, { claimId });
  });
}

/** GET /claims/:id/fuel-check (F6): a preview in any claim status. */
export async function fuelCheck(db: TenantDb, claimId: string, series: PriceSeriesData | null, classifierFlag: boolean): Promise<FuelCheckViewDto> {
  if (!isUuid(claimId)) throw errors.notFound();
  return db.tx(async (tx) => {
    const claim = await tx.claim.findFirst({ where: { id: claimId }, select: { id: true } });
    if (!claim) throw errors.notFound();
    const loaded = await loadFuelInput(tx, claimId, series);
    const input = await loadAnalysisInput(tx, claimId);
    const classifier = classifierFlag ? (await loadClassifier(tx)).classifier : null;
    try {
      const { result } = checkFuel(input.bundle, loaded?.input ?? null, classifier === null ? null : (d) => classifier.classify(d), DEFAULT_ANALYSIS_SETTINGS);
      return { claimId, inputs: loaded?.inputs ?? null, table: loaded?.table ?? null, result };
    } catch (e) {
      if (e instanceof AnalysisInputError || e instanceof RangeError) throw errors.analysisInputInvalid();
      throw e;
    }
  });
}
