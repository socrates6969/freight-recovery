/**
 * Step 8 ocean D&D services (REQ-20261011-ocean-dd, spec A3.1, Part C C11-C15).
 *
 * - Tariffs and calendars: tenant catalogs (cap DD_TARIFFS_MAX / DD_CALENDARS_MAX, creation serialized per
 *   tenant), updated with optimistic versioning; never deleted in this step (decision D11).
 * - Invoices: DRAFT rows created/updated/deleted by users with `dd_invoices:manage`; references to a tariff
 *   or calendar must name a row of the same tenant (400 not_found otherwise); AUDITED rows are read-only
 *   (409 invalid_state here; the database trigger is the backstop).
 * - Detail views carry a preview: the audit of the stored DRAFT with the CURRENT tariff/calendar, or of the
 *   stored audit snapshot for an AUDITED invoice.
 * Every operation runs in ONE tenant transaction; changes append their audit event in the same transaction.
 * Stored JSON is parsed with the shared schemas on read: a row that fails is a 500 bug, never skipped.
 * Audit metadata carries ids, versions, enumerations, counts and sha256 only (no names or invoice text).
 */
import {
  DD_CALENDARS_MAX,
  DD_DIRECTIONS,
  DD_INVOICES_MAX,
  DD_RULES_VERSION,
  DD_TARIFFS_MAX,
  DdCalendarData,
  DdInvoiceData,
  DdTariffData,
  auditDdInvoice,
  canonicalJson,
  ddMoneyCents,
  type AuditAction,
  type DdAuditResultDto,
  type DdCalendarDataDto,
  type DdCalendarListDto,
  type DdCalendarPutBodyInput,
  type DdCalendarViewDto,
  type DdInvoiceBodyDto,
  type DdInvoiceDataDto,
  type DdInvoiceDetailDto,
  type DdInvoiceListDto,
  type DdInvoiceListQueryInput,
  type DdInvoicePutBodyInput,
  type DdListQueryInput,
  type DdTariffDataDto,
  type DdTariffListDto,
  type DdTariffPutBodyInput,
  type DdTariffViewDto,
} from '@fr/shared';
import { z } from 'zod';

import { createHash } from 'node:crypto';

import { appendAudit } from '../audit/audit.js';
import type { Actor } from '../claims/service.js';
import { listDdInvoiceRows } from '../db/dd-invoice-list.js';
import { lockDdCatalog, lockDdInvoiceForUpdate } from '../db/dd-locks.js';
import { isUuid } from '../db/errors.js';
import type { TenantDb, TenantTx } from '../db/tenant.js';
import { errors } from '../http/errors.js';

/** The stored audit snapshot of an AUDITED invoice (C15 `snapshotSha256` is over this object). */
export const DdAuditSnapshot = z.strictObject({
  invoice: DdInvoiceData,
  tariff: DdTariffData.nullable(),
  calendar: DdCalendarData.nullable(),
  rulesVersion: z.literal(DD_RULES_VERSION),
});
export type DdAuditSnapshotDto = z.output<typeof DdAuditSnapshot>;

/** Lower-case hex SHA-256 of the UTF-8 canonical JSON of a value. */
export function ddSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/** Parse stored JSON with its shared schema; a stored row that fails is a defect (500), never skipped. */
export function parseStored<S extends z.ZodType>(schema: S, value: unknown, what: string): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new Error(`stored ${what} failed validation`);
  return r.data;
}

const isUniqueViolation = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';

/** A `YYYY-MM-DD` date as the UTC-midnight value of a DATE column. */
export const dateValue = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

function audit(tx: TenantTx, db: TenantDb, actor: Actor, action: AuditAction, targetType: string, targetId: string, metadata: Record<string, unknown>) {
  return appendAudit(tx, {
    tenantId: db.tenantId,
    action,
    actorId: actor.userId,
    actorRole: actor.role,
    targetType,
    targetId,
    metadata,
    ip: actor.ip,
    requestId: actor.requestId,
  });
}

const pageArgs = (q: DdListQueryInput) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });

// ---------------------------------------------------------------------------------------------
// Tariffs
// ---------------------------------------------------------------------------------------------

const CATALOG_SELECT = { id: true, data: true, version: true, createdAt: true, updatedAt: true } as const;

interface CatalogRow {
  id: string;
  data: unknown;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export function toTariffView(r: CatalogRow): DdTariffViewDto {
  return { id: r.id, version: r.version, data: parseStored(DdTariffData, r.data, 'D&D tariff'), createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() };
}

export function toCalendarView(r: CatalogRow): DdCalendarViewDto {
  return { id: r.id, version: r.version, data: parseStored(DdCalendarData, r.data, 'D&D calendar'), createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() };
}

const tariffMeta = (id: string, version: number, data: DdTariffDataDto) => ({
  tariffId: id,
  version,
  chargeType: data.chargeType,
  direction: data.direction,
  tierCount: data.tiers.length,
  dataSha256: ddSha256(data),
});

const calendarMeta = (id: string, version: number, data: DdCalendarDataDto) => ({
  calendarId: id,
  version,
  closedCount: data.closedDates.length,
  shutoutCount: data.shutoutDates.length,
  dataSha256: ddSha256(data),
});

/** GET /dd/tariffs: name asc, then id. */
export async function listTariffs(db: TenantDb, q: DdListQueryInput): Promise<DdTariffListDto> {
  return db.tx(async (tx) => {
    const total = await tx.ddTariff.count();
    const rows = await tx.ddTariff.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], ...pageArgs(q), select: CATALOG_SELECT });
    return { items: rows.map(toTariffView), page: q.page, pageSize: q.pageSize, total };
  });
}

/** POST /dd/tariffs: 409 dd_limit_reached at the cap, 409 conflict on a taken name. */
export async function createTariff(db: TenantDb, actor: Actor, data: DdTariffDataDto): Promise<DdTariffViewDto> {
  try {
    return await db.tx(async (tx) => {
      await lockDdCatalog(tx, db.tenantId, 'tariffs');
      if ((await tx.ddTariff.count()) >= DD_TARIFFS_MAX) throw errors.ddLimitReached();
      if (await tx.ddTariff.findFirst({ where: { name: data.name }, select: { id: true } })) throw errors.conflict();
      const row = await tx.ddTariff.create({
        data: {
          tenantId: db.tenantId,
          name: data.name,
          carrier: data.carrier,
          chargeType: data.chargeType,
          direction: data.direction,
          data,
          version: 1,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
        select: CATALOG_SELECT,
      });
      await audit(tx, db, actor, 'dd_tariff.created', 'dd_tariff', row.id, tariffMeta(row.id, row.version, data));
      return toTariffView(row);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw errors.conflict();
    throw e;
  }
}

/** PUT /dd/tariffs/:id: optimistic update; success increments the version. */
export async function updateTariff(db: TenantDb, actor: Actor, id: string, body: DdTariffPutBodyInput): Promise<DdTariffViewDto> {
  if (!isUuid(id)) throw errors.notFound();
  const { data } = body;
  try {
    return await db.tx(async (tx) => {
      const row = await tx.ddTariff.findFirst({ where: { id }, select: CATALOG_SELECT });
      if (!row) throw errors.notFound();
      if (row.version !== body.version) throw errors.staleRevision();
      if (await tx.ddTariff.findFirst({ where: { name: data.name, NOT: { id } }, select: { id: true } })) throw errors.conflict();
      const updated = await tx.ddTariff.updateMany({
        where: { id, version: body.version },
        data: { name: data.name, carrier: data.carrier, chargeType: data.chargeType, direction: data.direction, data, version: { increment: 1 }, updatedById: actor.userId },
      });
      if (updated.count !== 1) throw errors.staleRevision();
      const fresh = await tx.ddTariff.findFirst({ where: { id }, select: CATALOG_SELECT });
      if (!fresh) throw errors.notFound();
      await audit(tx, db, actor, 'dd_tariff.updated', 'dd_tariff', fresh.id, tariffMeta(fresh.id, fresh.version, data));
      return toTariffView(fresh);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw errors.conflict();
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Calendars
// ---------------------------------------------------------------------------------------------

/** GET /dd/calendars: name asc, then id. */
export async function listCalendars(db: TenantDb, q: DdListQueryInput): Promise<DdCalendarListDto> {
  return db.tx(async (tx) => {
    const total = await tx.ddCalendar.count();
    const rows = await tx.ddCalendar.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], ...pageArgs(q), select: CATALOG_SELECT });
    return { items: rows.map(toCalendarView), page: q.page, pageSize: q.pageSize, total };
  });
}

/** POST /dd/calendars: 409 dd_limit_reached at the cap, 409 conflict on a taken name. */
export async function createCalendar(db: TenantDb, actor: Actor, data: DdCalendarDataDto): Promise<DdCalendarViewDto> {
  try {
    return await db.tx(async (tx) => {
      await lockDdCatalog(tx, db.tenantId, 'calendars');
      if ((await tx.ddCalendar.count()) >= DD_CALENDARS_MAX) throw errors.ddLimitReached();
      if (await tx.ddCalendar.findFirst({ where: { name: data.name }, select: { id: true } })) throw errors.conflict();
      const row = await tx.ddCalendar.create({
        data: { tenantId: db.tenantId, name: data.name, data, version: 1, createdById: actor.userId, updatedById: actor.userId },
        select: CATALOG_SELECT,
      });
      await audit(tx, db, actor, 'dd_calendar.created', 'dd_calendar', row.id, calendarMeta(row.id, row.version, data));
      return toCalendarView(row);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw errors.conflict();
    throw e;
  }
}

/** PUT /dd/calendars/:id: optimistic update; success increments the version. */
export async function updateCalendar(db: TenantDb, actor: Actor, id: string, body: DdCalendarPutBodyInput): Promise<DdCalendarViewDto> {
  if (!isUuid(id)) throw errors.notFound();
  const { data } = body;
  try {
    return await db.tx(async (tx) => {
      const row = await tx.ddCalendar.findFirst({ where: { id }, select: CATALOG_SELECT });
      if (!row) throw errors.notFound();
      if (row.version !== body.version) throw errors.staleRevision();
      if (await tx.ddCalendar.findFirst({ where: { name: data.name, NOT: { id } }, select: { id: true } })) throw errors.conflict();
      const updated = await tx.ddCalendar.updateMany({ where: { id, version: body.version }, data: { name: data.name, data, version: { increment: 1 }, updatedById: actor.userId } });
      if (updated.count !== 1) throw errors.staleRevision();
      const fresh = await tx.ddCalendar.findFirst({ where: { id }, select: CATALOG_SELECT });
      if (!fresh) throw errors.notFound();
      await audit(tx, db, actor, 'dd_calendar.updated', 'dd_calendar', fresh.id, calendarMeta(fresh.id, fresh.version, data));
      return toCalendarView(fresh);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw errors.conflict();
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------------------------

const INVOICE_SELECT = {
  id: true,
  status: true,
  version: true,
  invoiceNumber: true,
  billingPartyName: true,
  invoiceDate: true,
  totalDueCents: true,
  data: true,
  tariffId: true,
  calendarId: true,
  claimId: true,
  auditedAt: true,
  auditSnapshot: true,
  createdAt: true,
  updatedAt: true,
  claim: { select: { claimNumber: true } },
} as const;

interface InvoiceRow {
  id: string;
  status: string;
  version: number;
  invoiceNumber: string;
  billingPartyName: string;
  invoiceDate: Date | null;
  totalDueCents: number | null;
  data: unknown;
  tariffId: string | null;
  calendarId: string | null;
  claimId: string | null;
  auditedAt: Date | null;
  auditSnapshot: unknown;
  createdAt: Date;
  updatedAt: Date;
  claim: { claimNumber: string } | null;
}

function invoiceStatus(v: string): 'DRAFT' | 'AUDITED' {
  if (v !== 'DRAFT' && v !== 'AUDITED') throw new Error('dd_invoices.status outside the registry');
  return v;
}

/** The current tariff and calendar of a DRAFT (null when not attached). */
export async function loadAttachments(tx: TenantTx, tariffId: string | null, calendarId: string | null): Promise<{ tariff: DdTariffDataDto | null; calendar: DdCalendarDataDto | null }> {
  const t = tariffId === null ? null : await tx.ddTariff.findFirst({ where: { id: tariffId }, select: { data: true } });
  const c = calendarId === null ? null : await tx.ddCalendar.findFirst({ where: { id: calendarId }, select: { data: true } });
  if ((tariffId !== null && !t) || (calendarId !== null && !c)) throw new Error('D&D invoice references a missing tariff or calendar');
  return { tariff: t ? parseStored(DdTariffData, t.data, 'D&D tariff') : null, calendar: c ? parseStored(DdCalendarData, c.data, 'D&D calendar') : null };
}

async function toDetail(tx: TenantTx, r: InvoiceRow): Promise<DdInvoiceDetailDto> {
  const status = invoiceStatus(r.status);
  const invoice = parseStored(DdInvoiceData, r.data, 'D&D invoice');
  let preview: DdAuditResultDto;
  if (status === 'AUDITED') {
    const snap = parseStored(DdAuditSnapshot, r.auditSnapshot, 'D&D audit snapshot');
    preview = auditDdInvoice({ invoice: snap.invoice, tariff: snap.tariff, calendar: snap.calendar });
  } else {
    const { tariff, calendar } = await loadAttachments(tx, r.tariffId, r.calendarId);
    preview = auditDdInvoice({ invoice, tariff, calendar });
  }
  return {
    id: r.id,
    status,
    version: r.version,
    invoice: { ...invoice, tariffId: r.tariffId, calendarId: r.calendarId },
    claimId: r.claimId,
    claimNumber: r.claim?.claimNumber ?? null,
    auditedAt: r.auditedAt === null ? null : r.auditedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    preview,
  };
}

function listDirection(v: string | null): 'IMPORT' | 'EXPORT' {
  if (v === null || !(DD_DIRECTIONS as readonly string[]).includes(v)) throw new Error('stored D&D invoice direction failed validation');
  return v as 'IMPORT' | 'EXPORT';
}

/**
 * GET /dd/invoices: updatedAt desc, then id; optional status filter. Fix round 1 (S1): the page never loads
 * `data` or `audit_snapshot`; direction and container count come from JSON-path reads (pageSize <= 50).
 */
export async function listInvoices(db: TenantDb, q: DdInvoiceListQueryInput): Promise<DdInvoiceListDto> {
  return db.tx(async (tx) => {
    const where = q.status === undefined ? {} : { status: q.status };
    const total = await tx.ddInvoice.count({ where });
    const { skip, take } = pageArgs(q);
    const rows = await listDdInvoiceRows(tx, db.tenantId, { status: q.status, limit: take, offset: skip });
    const items = rows.map((r) => {
      if (r.containerCount === null || r.containerCount < 1) throw new Error('stored D&D invoice containers failed validation');
      return {
        id: r.id,
        status: invoiceStatus(r.status),
        version: r.version,
        invoiceNumber: r.invoiceNumber,
        billingPartyName: r.billingPartyName,
        direction: listDirection(r.direction),
        invoiceDate: r.invoiceDate,
        totalDueCents: r.totalDueCents,
        containerCount: r.containerCount,
        claimId: r.claimId,
        auditedAt: r.auditedAt,
        updatedAt: r.updatedAt,
      };
    });
    return { items, page: q.page, pageSize: q.pageSize, total };
  });
}

/** GET /dd/invoices/:id: 404 for unknown, non-UUID or other-tenant ids. */
export async function getInvoice(db: TenantDb, id: string): Promise<DdInvoiceDetailDto> {
  if (!isUuid(id)) throw errors.notFound();
  return db.tx(async (tx) => {
    const r = await tx.ddInvoice.findFirst({ where: { id }, select: INVOICE_SELECT });
    if (!r) throw errors.notFound();
    return toDetail(tx, r);
  });
}

/** Split a body into the stored data and its references. */
function splitBody(body: DdInvoiceBodyDto): { data: DdInvoiceDataDto; tariffId: string | null; calendarId: string | null } {
  const { tariffId, calendarId, ...data } = body;
  return { data, tariffId, calendarId };
}

/** 400 validation_error `{ path, code: 'not_found' }` when a reference does not name a row of the tenant. */
async function checkReferences(tx: TenantTx, tariffId: string | null, calendarId: string | null): Promise<void> {
  const details: { path: string; code: string }[] = [];
  if (tariffId !== null && !(await tx.ddTariff.findFirst({ where: { id: tariffId }, select: { id: true } }))) details.push({ path: 'tariffId', code: 'not_found' });
  if (calendarId !== null && !(await tx.ddCalendar.findFirst({ where: { id: calendarId }, select: { id: true } }))) details.push({ path: 'calendarId', code: 'not_found' });
  if (details.length > 0) throw errors.validation(details);
}

/** Columns derived from the invoice data. */
const derived = (data: DdInvoiceDataDto) => ({
  invoiceNumber: data.invoiceNumber,
  billingPartyName: data.billingPartyName,
  invoiceDate: data.invoiceDate === null ? null : dateValue(data.invoiceDate),
  totalDueCents: data.totalDue === null ? null : ddMoneyCents(data.totalDue),
});

const invoiceMeta = (id: string, version: number, data: DdInvoiceDataDto) => ({ invoiceId: id, version, containerCount: data.containers.length, dataSha256: ddSha256(data) });

/**
 * POST /dd/invoices: 400 reference not_found, 409 dd_limit_reached at DD_INVOICES_MAX (fix round 1 S2,
 * serialized per tenant), 409 conflict on a duplicate (billing party, invoice number).
 */
export async function createInvoice(db: TenantDb, actor: Actor, body: DdInvoiceBodyDto): Promise<DdInvoiceDetailDto> {
  const { data, tariffId, calendarId } = splitBody(body);
  try {
    return await db.tx(async (tx) => {
      await lockDdCatalog(tx, db.tenantId, 'invoices');
      await checkReferences(tx, tariffId, calendarId);
      if ((await tx.ddInvoice.count()) >= DD_INVOICES_MAX) throw errors.ddLimitReached();
      if (await tx.ddInvoice.findFirst({ where: { billingPartyName: data.billingPartyName, invoiceNumber: data.invoiceNumber }, select: { id: true } })) throw errors.conflict();
      const row = await tx.ddInvoice.create({
        data: { tenantId: db.tenantId, status: 'DRAFT', ...derived(data), data, tariffId, calendarId, version: 1, createdById: actor.userId, updatedById: actor.userId },
        select: INVOICE_SELECT,
      });
      await audit(tx, db, actor, 'dd_invoice.created', 'dd_invoice', row.id, invoiceMeta(row.id, row.version, data));
      return toDetail(tx, row);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw errors.conflict();
    throw e;
  }
}

/** PUT /dd/invoices/:id: DRAFT only (409 invalid_state), optimistic version (409 stale_revision). */
export async function updateInvoice(db: TenantDb, actor: Actor, id: string, body: DdInvoicePutBodyInput): Promise<DdInvoiceDetailDto> {
  if (!isUuid(id)) throw errors.notFound();
  const { data, tariffId, calendarId } = splitBody(body.invoice);
  try {
    return await db.tx(async (tx) => {
      if (!(await lockDdInvoiceForUpdate(tx, id))) throw errors.notFound();
      const row = await tx.ddInvoice.findFirst({ where: { id }, select: { id: true, status: true, version: true } });
      if (!row) throw errors.notFound();
      await checkReferences(tx, tariffId, calendarId);
      if (row.status !== 'DRAFT') throw errors.invalidState();
      if (row.version !== body.version) throw errors.staleRevision();
      if (await tx.ddInvoice.findFirst({ where: { billingPartyName: data.billingPartyName, invoiceNumber: data.invoiceNumber, NOT: { id } }, select: { id: true } })) throw errors.conflict();
      const updated = await tx.ddInvoice.updateMany({
        where: { id, version: body.version, status: 'DRAFT' },
        data: { ...derived(data), data, tariffId, calendarId, version: { increment: 1 }, updatedById: actor.userId },
      });
      if (updated.count !== 1) throw errors.staleRevision();
      const fresh = await tx.ddInvoice.findFirst({ where: { id }, select: INVOICE_SELECT });
      if (!fresh) throw errors.notFound();
      await audit(tx, db, actor, 'dd_invoice.updated', 'dd_invoice', fresh.id, invoiceMeta(fresh.id, fresh.version, data));
      return toDetail(tx, fresh);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw errors.conflict();
    throw e;
  }
}

/** DELETE /dd/invoices/:id: DRAFT only (409 invalid_state). */
export async function deleteInvoice(db: TenantDb, actor: Actor, id: string): Promise<void> {
  if (!isUuid(id)) throw errors.notFound();
  await db.tx(async (tx) => {
    if (!(await lockDdInvoiceForUpdate(tx, id))) throw errors.notFound();
    const row = await tx.ddInvoice.findFirst({ where: { id }, select: { id: true, status: true, version: true } });
    if (!row) throw errors.notFound();
    if (row.status !== 'DRAFT') throw errors.invalidState();
    await tx.ddInvoice.delete({ where: { id } });
    await audit(tx, db, actor, 'dd_invoice.deleted', 'dd_invoice', row.id, { invoiceId: row.id, version: row.version });
  });
}
