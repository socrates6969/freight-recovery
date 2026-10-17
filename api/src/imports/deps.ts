/**
 * Dependencies of the import/export modules, built once by buildApp (overridable in tests only).
 */
import type { Readable } from 'node:stream';

import type { FastifyBaseLogger } from 'fastify';

import type { AppConfig } from '../config.js';
import type { PutOptions } from '../storage/s3.js';

import type { ParseExecutor } from './sandbox/executor.js';
import type { KeyedGate } from './sandbox/semaphore.js';

/** The object-store operations the import pipeline uses (implemented by storage/s3.ts ObjectStore). */
export interface ObjectStorePort {
  putObject(tenantId: string, key: string, body: Uint8Array, opts: PutOptions): Promise<void>;
  verifyStored(tenantId: string, key: string, contentLength: number): Promise<void>;
  getObjectStream(tenantId: string, key: string): Promise<{ stream: Readable; contentLength: number | null }>;
  deleteObject(tenantId: string, key: string): Promise<void>;
}

export interface ImportDeps {
  cfg: AppConfig;
  store: ObjectStorePort;
  executor: ParseExecutor;
  /** Per-tenant concurrent uploads (UPLOAD_MAX_CONCURRENT_PER_TENANT, per instance). */
  uploadGate: KeyedGate;
  /** Per-tenant concurrent exports (EXPORT_MAX_CONCURRENT_PER_TENANT, per instance). */
  exportGate: KeyedGate;
  /** Verify encryption/size of every stored object (production). */
  verifyWrites: boolean;
  now: () => Date;
  log: FastifyBaseLogger;
}

export interface Actor {
  userId: string;
  role: string;
  ip: string;
  requestId: string;
}

/** Who ingests a document: a signed-in user (upload) or a system worker (future email ingest). */
export type IngestActor = { kind: 'user'; id: string; role: string; ip: string; requestId: string } | { kind: 'system'; name: string; requestId: string };
