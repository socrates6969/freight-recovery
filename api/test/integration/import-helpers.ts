/**
 * Helpers for the step-3 integration tests (real PostgreSQL + S3/MinIO + the built parse worker).
 * Every test cleans up the rows and objects it created (the acceptance suites run on the same DB).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DeleteObjectCommand, HeadObjectCommand, ListObjectVersionsCommand, S3Client } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

export const PW = 'Synthetic-Pass-2026!';
export const appUrl = process.env['TEST_DATABASE_URL'];
export const adminUrl = process.env['TEST_ADMIN_DATABASE_URL'];
export const s3Endpoint = process.env['S3_ENDPOINT'];
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const workerBuilt = existsSync(path.join(apiRoot, 'dist', 'src', 'imports', 'sandbox', 'worker-main.js'));
export const canRun = Boolean(appUrl && adminUrl && s3Endpoint && workerBuilt);

export function baseEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    DATABASE_URL: appUrl ?? '',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    COOKIE_SECURE: 'false',
    RATE_LIMIT_AUTH_MAX: '1000',
    RATE_LIMIT_UPLOAD_MAX: '1000',
    RATE_LIMIT_EXPORT_MAX: '1000',
    ...extra,
  };
}

export class Session {
  csrf = '';

  constructor(readonly app: FastifyInstance) {}

  async init(): Promise<void> {
    const r = await this.app.inject({ method: 'GET', url: '/api/v1/auth/csrf' });
    this.csrf = (r.json() as { csrfToken: string }).csrfToken;
  }

  headers(token?: string): Record<string, string> {
    return { cookie: `fr_csrf=${this.csrf}`, 'x-csrf-token': this.csrf, ...(token ? { authorization: `Bearer ${token}` } : {}) };
  }

  /** Password login for non-MFA seed users (analyst, reviewer, manager, viewer). */
  async login(email: string): Promise<string> {
    const r = await this.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: this.headers(), payload: { email, password: PW } });
    if (r.statusCode !== 200) throw new Error(`login ${email}: ${r.statusCode}`);
    const body = r.json() as { accessToken?: string };
    if (!body.accessToken) throw new Error(`login ${email}: MFA user`);
    return body.accessToken;
  }

  async upload(token: string, batchId: string, filename: string, bytes: Uint8Array, contentType = 'application/octet-stream') {
    return this.app.inject({
      method: 'POST',
      url: `/api/v1/imports/${batchId}/documents?filename=${encodeURIComponent(filename)}`,
      headers: { ...this.headers(token), 'content-type': contentType },
      payload: Buffer.from(bytes),
    });
  }

  async batch(token: string, label?: string): Promise<string> {
    const r = await this.app.inject({ method: 'POST', url: '/api/v1/imports', headers: this.headers(token), payload: label ? { label } : {} });
    if (r.statusCode !== 201) throw new Error(`batch: ${r.statusCode} ${r.body}`);
    return (r.json() as { id: string }).id;
  }
}

export function s3(): S3Client {
  return new S3Client({
    region: process.env['S3_REGION'] ?? 'us-east-1',
    forcePathStyle: true,
    ...(s3Endpoint ? { endpoint: s3Endpoint } : {}),
    credentials: { accessKeyId: process.env['S3_ACCESS_KEY_ID'] ?? '', secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] ?? '' },
  });
}

export const bucket = () => process.env['S3_BUCKET'] ?? 'fr-documents-dev';

export async function objectExists(client: S3Client, key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Remove all versions of the objects under the given batch prefixes (versioned dev bucket). */
export async function deleteBatchObjects(client: S3Client, tenantId: string, batchIds: readonly string[]): Promise<void> {
  for (const b of batchIds) {
    const listed = await client.send(new ListObjectVersionsCommand({ Bucket: bucket(), Prefix: `t/${tenantId}/imports/${b}/` }));
    for (const v of [...(listed.Versions ?? []), ...(listed.DeleteMarkers ?? [])]) {
      if (v.Key) await client.send(new DeleteObjectCommand({ Bucket: bucket(), Key: v.Key, ...(v.VersionId ? { VersionId: v.VersionId } : {}) }));
    }
  }
}

/** Owner-role cleanup of import rows (and claims created from them) for the given batches. */
export async function cleanupBatches(admin: pg.Client, batchIds: readonly string[], claimIds: readonly string[] = []): Promise<void> {
  if (batchIds.length === 0 && claimIds.length === 0) return;
  await admin.query('BEGIN');
  await admin.query('SET LOCAL session_replication_role = replica');
  await admin.query(`DELETE FROM claim_documents WHERE document_id IN (SELECT id FROM import_documents WHERE batch_id = ANY($1::uuid[])) OR claim_id = ANY($2::uuid[])`, [
    batchIds,
    claimIds,
  ]);
  await admin.query(`DELETE FROM import_review_decisions WHERE document_id IN (SELECT id FROM import_documents WHERE batch_id = ANY($1::uuid[]))`, [batchIds]);
  await admin.query(`DELETE FROM extracted_fields WHERE document_id IN (SELECT id FROM import_documents WHERE batch_id = ANY($1::uuid[]))`, [batchIds]);
  await admin.query(`DELETE FROM import_documents WHERE batch_id = ANY($1::uuid[])`, [batchIds]);
  await admin.query(`DELETE FROM import_batches WHERE id = ANY($1::uuid[])`, [batchIds]);
  await admin.query(`DELETE FROM claims WHERE id = ANY($1::uuid[])`, [claimIds]);
  await admin.query('COMMIT');
}

export const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
