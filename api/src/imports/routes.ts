/**
 * Import routes R40-R45 (N4). R43 takes the RAW file bytes (no multipart): it lives in its own
 * encapsulated Fastify context whose only content-type parser is `application/octet-stream`, which hands
 * the handler the unconsumed request stream (every other route keeps BODY_LIMIT_BYTES and still rejects
 * octet-stream). Authentication and permission run before any body byte is read (global onRequest
 * pipeline); a rejected upload's connection is closed after the response.
 */
import { BatchParams, CreateBatchBody, DocParams, ImportsPageQuery, UploadQuery } from '@fr/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';

import { errors } from '../http/errors.js';
import { defineRoute, requireTenant } from '../http/route.js';

import { BodyAbortedError, BodyIdleError, BodyTooLargeError, readLimitedBody } from './body.js';
import type { Actor, ImportDeps } from './deps.js';
import { displayNameFor } from './display-name.js';
import {
  assertBatchAcceptsUploads,
  auditPrestoreRejection,
  createBatch,
  documentDetail,
  getBatchDetail,
  ingestDocument,
  listBatches,
  prepareDownload,
  reapStale,
} from './service.js';
import { sniff } from './sniff.js';

const P = '/api/v1';

export function actorOf(req: FastifyRequest): Actor {
  const ctx = requireTenant(req);
  return { userId: ctx.user.id, role: ctx.role, ip: req.ip, requestId: req.frRequestId };
}

declare module 'fastify' {
  interface FastifyRequest {
    frBodyConsumed?: boolean;
  }
}

function contentLength(req: FastifyRequest): number | undefined {
  const raw = req.headers['content-length'];
  if (raw === undefined || Array.isArray(raw) || !/^\d+$/u.test(raw)) return undefined;
  return Number(raw);
}

export function registerImportRoutes(app: FastifyInstance, deps: ImportDeps): void {
  defineRoute(app, {
    method: 'POST',
    url: `${P}/imports`,
    access: { kind: 'permission', permission: 'import:run' },
    schema: { body: CreateBatchBody },
    handler: async (req, reply, { body }) => {
      const ctx = requireTenant(req);
      const batch = await ctx.db.tx((tx) => createBatch(tx, ctx.tenantId, body.label, actorOf(req)));
      return reply.code(201).send(batch);
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: `${P}/imports`,
    access: { kind: 'permission', permission: 'import:run' },
    schema: { query: ImportsPageQuery },
    handler: async (req, _reply, { query }) => requireTenant(req).db.tx((tx) => listBatches(tx, query.page, query.pageSize)),
  });

  defineRoute(app, {
    method: 'GET',
    url: `${P}/imports/:batchId`,
    access: { kind: 'permission', permission: 'import:run' },
    schema: { params: BatchParams },
    handler: async (req, _reply, { params }) => {
      const ctx = requireTenant(req);
      await reapStale(deps, ctx.db, params.batchId, actorOf(req));
      return ctx.db.tx((tx) => getBatchDetail(tx, params.batchId));
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: `${P}/imports/:batchId/documents/:docId`,
    access: { kind: 'permission', permission: 'import:run' },
    schema: { params: DocParams },
    handler: async (req, _reply, { params }) => {
      const ctx = requireTenant(req);
      await reapStale(deps, ctx.db, params.batchId, actorOf(req));
      return ctx.db.tx((tx) => documentDetail(tx, params.batchId, params.docId, deps.cfg.imports.reviewConfidenceThreshold));
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: `${P}/imports/:batchId/documents/:docId/original`,
    access: { kind: 'permission', permission: 'import:run' },
    schema: { params: DocParams },
    handler: async (req, reply, { params }) => {
      const ctx = requireTenant(req);
      const dl = await prepareDownload(deps, ctx.db, ctx.tenantId, params.batchId, params.docId, actorOf(req));
      void reply
        .header('content-type', 'application/octet-stream')
        .header('content-disposition', `attachment; filename="${dl.filename}"`)
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'no-store');
      return reply.send(dl.stream);
    },
  });

  // R43 in its own context: octet-stream only, raw stream, own body limit.
  void app.register(async (sub) => {
    sub.removeAllContentTypeParsers();
    sub.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));
    sub.addHook('onSend', async (req, reply, payload) => {
      // A rejected or partially read upload must not leave unread bytes on a kept-alive connection.
      if (!req.frBodyConsumed) reply.header('connection', 'close');
      return payload;
    });
    defineRoute(sub, {
      method: 'POST',
      url: `${P}/imports/:batchId/documents`,
      access: { kind: 'permission', permission: 'import:run' },
      rateGroup: 'upload',
      schema: { params: BatchParams, query: UploadQuery },
      handler: async (req, reply, { params, query }) => uploadHandler(deps, req, reply, params.batchId, query.filename),
    });
  });
}

async function uploadHandler(deps: ImportDeps, req: FastifyRequest, reply: FastifyReply, batchId: string, filename: string) {
  const ctx = requireTenant(req);
  const actor = actorOf(req);
  const cfg = deps.cfg.imports;
  const encoding = req.headers['content-encoding'];
  if (encoding !== undefined && encoding !== 'identity') throw errors.uploadMediaType();
  const stream = req.body as Readable | undefined;
  if (!stream || typeof (stream as { on?: unknown }).on !== 'function') throw errors.uploadMediaType();

  await assertBatchAcceptsUploads(ctx.db, batchId, cfg.maxFilesPerBatch);
  const release = deps.uploadGate.tryEnter(ctx.tenantId);
  if (!release) throw errors.rateLimited(5);
  try {
    const declared = contentLength(req);
    if (declared !== undefined && declared > cfg.maxFileBytes) {
      await auditPrestoreRejection(ctx.db, ctx.tenantId, batchId, actor, { reasonCode: 'too_large', sizeBytes: declared });
      throw errors.payloadTooLarge();
    }
    let body;
    try {
      body = await readLimitedBody(stream, { limit: cfg.maxFileBytes, idleMs: cfg.uploadIdleTimeoutSeconds * 1000, expectedLength: declared });
    } catch (e) {
      if (e instanceof BodyTooLargeError) {
        await auditPrestoreRejection(ctx.db, ctx.tenantId, batchId, actor, { reasonCode: 'too_large' });
        throw errors.payloadTooLarge();
      }
      if (e instanceof BodyIdleError) throw errors.requestTimeout();
      if (e instanceof BodyAbortedError) throw errors.validation([{ path: 'file', code: 'aborted' }]);
      throw e;
    }
    req.frBodyConsumed = true;
    const displayName = displayNameFor(filename);
    const sniffed = sniff(body.bytes, displayName);
    if (!sniffed.ok) {
      await auditPrestoreRejection(ctx.db, ctx.tenantId, batchId, actor, { reasonCode: sniffed.reason, sizeBytes: body.bytes.byteLength, sha256: body.sha256 });
      throw errors.unsupportedFile(sniffed.reason);
    }
    const detail = await ingestDocument(deps, ctx.db, {
      tenantId: ctx.tenantId,
      actor: { kind: 'user', id: actor.userId, role: actor.role, ip: actor.ip, requestId: actor.requestId },
      batchId,
      displayName,
      detectedType: sniffed.detectedType,
      bytes: body.bytes,
      sha256: body.sha256,
      source: 'UPLOAD',
    });
    req.log.info(
      { event: 'import_document', documentId: detail.id, sizeBytes: detail.sizeBytes, sha256Prefix: detail.sha256.slice(0, 12), status: detail.status },
      'import document processed',
    );
    return reply.code(201).send(detail);
  } finally {
    release();
  }
}
