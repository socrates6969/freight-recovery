/**
 * Export routes R54-R56 (N9). Flow: validate -> per-tenant concurrency gate (429) -> count with the same
 * filters -> 422 export_too_large above EXPORT_MAX_ROWS -> `export.started` committed in its own
 * transaction (if it cannot be written, nothing is sent) -> headers -> streamed file (no Content-Length).
 * When the response has been fully written, `export.completed` records the row count and the SHA-256 and
 * byte length of the exact bytes sent; a client disconnect or internal error records `export.aborted`
 * and the connection is destroyed so a truncated file cannot pass as complete.
 */
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { ExportClaimsQuery, ExportOutcomesQuery, ExportPacketsQuery, type ExportEntity, type ExportFormat } from '@fr/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { appendAudit } from '../audit/audit.js';
import { errors } from '../http/errors.js';
import { defineRoute, requireTenant } from '../http/route.js';
import type { ImportDeps } from '../imports/deps.js';

import { CLAIM_COLUMNS, OUTCOME_COLUMNS, PACKET_COLUMNS, claimRows, countClaims, countOutcomes, countPacketRows, outcomeRows, packetRows } from './rows.js';
import { csvStream, xlsxStream, type Cell, type Column } from './writers.js';

const P = '/api/v1';
const CONTENT_TYPE: Readonly<Record<ExportFormat, string>> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** `freight-recovery-<entity>-<YYYYMMDDTHHMMSSZ>.<ext>` */
export function exportFilename(entity: ExportEntity, format: ExportFormat, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
  return `freight-recovery-${entity}-${stamp}.${format}`;
}

interface ExportPlan {
  entity: ExportEntity;
  format: ExportFormat;
  columns: Column[];
  count: () => Promise<number>;
  rows: () => AsyncIterable<Cell[][]>;
  filters: Record<string, unknown>;
}

async function runExport(deps: ImportDeps, req: FastifyRequest, reply: FastifyReply, plan: ExportPlan): Promise<FastifyReply> {
  const ctx = requireTenant(req);
  const release = deps.exportGate.tryEnter(ctx.tenantId);
  if (!release) throw errors.rateLimited(5);
  let released = false;
  const done = () => {
    if (!released) {
      released = true;
      release();
    }
  };
  try {
    const rowCount = await plan.count();
    if (rowCount > deps.cfg.imports.exportMaxRows) throw errors.exportTooLarge();
    const actor = { actorId: ctx.user.id, actorRole: ctx.role, ip: req.ip, requestId: req.frRequestId };
    const target = { targetType: 'export', targetId: null };
    const base = { entity: plan.entity, format: plan.format, filters: plan.filters };
    await ctx.db.tx((tx) => appendAudit(tx, { tenantId: ctx.tenantId, action: 'export.started', ...actor, ...target, metadata: { ...base, rowCount } }));

    const hash = createHash('sha256');
    let bytes = 0;
    let rows = 0;
    /** Rows contained in the chunks already handed to the response (rows serialized when the last chunk was produced). */
    let rowsWritten = 0;
    const source = plan.format === 'csv' ? csvStream(plan.columns, counting(plan.rows())) : xlsxStream(plan.entity, plan.columns, counting(plan.rows()));
    async function* counting(it: AsyncIterable<Cell[][]>): AsyncGenerator<Cell[][]> {
      for await (const batch of it) {
        rows += batch.length;
        yield batch;
      }
    }
    async function* hashed(): AsyncGenerator<Uint8Array> {
      for await (const chunk of source) {
        hash.update(chunk);
        bytes += chunk.byteLength;
        rowsWritten = rows;
        yield chunk;
      }
    }
    const body = Readable.from(hashed(), { objectMode: false, highWaterMark: 64 * 1024 });
    let finished = false;
    const appendLater = (action: 'export.completed' | 'export.aborted', metadata: Record<string, unknown>) =>
      ctx.db
        .tx((tx) => appendAudit(tx, { tenantId: ctx.tenantId, action, ...actor, ...target, metadata: { ...base, ...metadata } }))
        .catch(() => req.log.error({ event: 'export_audit_failed', action }, 'export audit append failed'));
    reply.raw.once('finish', () => {
      finished = true;
      done();
      void appendLater('export.completed', { rowCount: rows, byteLength: bytes, sha256: hash.digest('hex') });
    });
    reply.raw.once('close', () => {
      done();
      if (!finished) {
        body.destroy();
        // rowCount / rowsWritten: rows actually handed to the client before the abort; plannedRowCount: the total.
        void appendLater('export.aborted', { rowCount: rowsWritten, rowsWritten, plannedRowCount: rowCount, byteLength: bytes });
      }
    });
    body.once('error', () => {
      req.log.error({ event: 'export_stream_failed' }, 'export stream failed');
      reply.raw.destroy();
    });
    void reply
      .header('content-type', CONTENT_TYPE[plan.format])
      .header('content-disposition', `attachment; filename="${exportFilename(plan.entity, plan.format, new Date())}"`)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'no-store');
    return reply.send(body);
  } catch (e) {
    done();
    throw e;
  }
}

export function registerExportRoutes(app: FastifyInstance, deps: ImportDeps): void {
  defineRoute(app, {
    method: 'GET',
    url: `${P}/exports/claims`,
    access: { kind: 'permission', permission: 'export:claims', apiKeyScope: 'exports.claims' },
    rateGroup: 'export',
    schema: { query: ExportClaimsQuery },
    handler: async (req, reply, { query }) => {
      const db = requireTenant(req).db;
      const q = { filter: { q: query.q, status: query.status, perspective: query.perspective, assigneeId: query.assigneeId }, sort: query.sort };
      return runExport(deps, req, reply, {
        entity: 'claims',
        format: query.format,
        columns: CLAIM_COLUMNS,
        count: () => countClaims(db, q),
        rows: () => claimRows(db, q),
        filters: { status: query.status ?? null, perspective: query.perspective ?? null, sort: `${query.sort.field}:${query.sort.dir}`, hasQuery: Boolean(query.q) },
      });
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: `${P}/exports/packets`,
    access: { kind: 'permission', permission: 'export:packets' },
    rateGroup: 'export',
    schema: { query: ExportPacketsQuery },
    handler: async (req, reply, { query }) => {
      const db = requireTenant(req).db;
      const q = { claimId: query.claimId, filter: { q: query.q, status: query.status, perspective: query.perspective, assigneeId: query.assigneeId } };
      return runExport(deps, req, reply, {
        entity: 'packets',
        format: query.format,
        columns: PACKET_COLUMNS,
        count: () => countPacketRows(db, q),
        rows: () => packetRows(db, q),
        filters: { claimId: query.claimId ?? null, status: query.status ?? null, perspective: query.perspective ?? null, hasQuery: Boolean(query.q) },
      });
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: `${P}/exports/outcomes`,
    access: { kind: 'permission', permission: 'export:outcomes' },
    rateGroup: 'export',
    schema: { query: ExportOutcomesQuery },
    handler: async (req, reply, { query }) => {
      const db = requireTenant(req).db;
      const q = { claimId: query.claimId, actions: query.action, from: query.from, to: query.to };
      return runExport(deps, req, reply, {
        entity: 'outcomes',
        format: query.format,
        columns: OUTCOME_COLUMNS,
        count: () => countOutcomes(db, q),
        rows: () => outcomeRows(db, q),
        filters: { claimId: query.claimId ?? null, action: query.action ?? null, from: query.from ?? null, to: query.to ?? null },
      });
    },
  });
}
