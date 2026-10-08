/**
 * S3-compatible object storage wrapper (A13 / step 3 A8). Same code for MinIO (dev/CI) and S3 (AWS).
 * Keys are always under a per-tenant prefix `t/<tenantId>/...`; every method refuses a key outside the
 * caller's prefix before any network call. Objects are written with server-side encryption
 * (`aws:kms` unless S3_SSE=none, which production refuses), content type application/octet-stream, an
 * SHA-256 checksum, and no user metadata or tags. Downloads are proxied by the API (no presigned URLs
 * are handed out in step 3; `presignGet` is kept but has no caller outside tests).
 */
import type { Readable } from 'node:stream';

import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, type PutObjectCommandInput } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { AppConfig } from '../config.js';

export const MAX_PRESIGN_SECONDS = 300;
const SEGMENT_RE = /^[A-Za-z0-9._-]{1,128}$/u;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA256_HEX = /^[0-9a-f]{64}$/u;

export class StorageKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageKeyError';
  }
}

/** Raised when the store answers but the object does not meet the write contract (e.g. not encrypted). */
export class StorageIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageIntegrityError';
  }
}

/** Build a tenant-scoped object key. Segments are restricted to [A-Za-z0-9._-] and may not be `.`/`..`. */
export function tenantKey(tenantId: string, ...segments: string[]): string {
  if (!UUID_RE.test(tenantId)) throw new StorageKeyError('tenantId must be a UUID');
  if (segments.length === 0) throw new StorageKeyError('at least one key segment is required');
  for (const s of segments) {
    if (!SEGMENT_RE.test(s) || s === '.' || s === '..' || s.includes('..')) throw new StorageKeyError('invalid key segment');
  }
  return `t/${tenantId.toLowerCase()}/${segments.join('/')}`;
}

export function isKeyInTenant(key: string, tenantId: string): boolean {
  if (!UUID_RE.test(tenantId)) return false;
  const prefix = `t/${tenantId.toLowerCase()}/`;
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length).split('/');
  return rest.length > 0 && rest.every((s) => SEGMENT_RE.test(s) && s !== '.' && s !== '..' && !s.includes('..'));
}

export interface SseSettings {
  mode: 'aws:kms' | 'none';
  kmsKeyId: string | null;
}

export interface PutOptions {
  sha256Hex: string;
  contentLength: number;
}

export interface HeadResult {
  contentLength: number | null;
  serverSideEncryption: string | null;
  kmsKeyId: string | null;
}

export class ObjectStore {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    client: S3Client,
    private readonly sse: SseSettings = { mode: 'none', kmsKeyId: null },
  ) {
    this.client = client;
  }

  static fromConfig(cfg: AppConfig): ObjectStore {
    const client = new S3Client({
      region: cfg.s3.region,
      forcePathStyle: cfg.s3.forcePathStyle,
      ...(cfg.s3.endpoint ? { endpoint: cfg.s3.endpoint } : {}),
      ...(cfg.s3.accessKeyId && cfg.s3.secretAccessKey
        ? { credentials: { accessKeyId: cfg.s3.accessKeyId, secretAccessKey: cfg.s3.secretAccessKey } }
        : {}),
      maxAttempts: 2,
    });
    return new ObjectStore(cfg.s3.bucket, client, { mode: cfg.s3.sse, kmsKeyId: cfg.s3.kmsKeyId });
  }

  private assertTenantKey(tenantId: string, key: string): void {
    if (!isKeyInTenant(key, tenantId)) throw new StorageKeyError('key outside tenant prefix');
  }

  /** Server-side-encryption request parameters for writes. */
  sseParams(): Pick<PutObjectCommandInput, 'ServerSideEncryption' | 'SSEKMSKeyId' | 'BucketKeyEnabled'> {
    if (this.sse.mode !== 'aws:kms') return {};
    return {
      ServerSideEncryption: 'aws:kms',
      ...(this.sse.kmsKeyId ? { SSEKMSKeyId: this.sse.kmsKeyId } : {}),
      BucketKeyEnabled: true,
    };
  }

  /** Write one object (whole body in memory; bounded by IMPORT_MAX_FILE_BYTES / the derived text cap). */
  async putObject(tenantId: string, key: string, body: Uint8Array, opts: PutOptions): Promise<void> {
    this.assertTenantKey(tenantId, key);
    if (!SHA256_HEX.test(opts.sha256Hex)) throw new StorageKeyError('sha256Hex must be 64 lowercase hex');
    if (opts.contentLength !== body.byteLength) throw new StorageKeyError('contentLength mismatch');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentLength: opts.contentLength,
        ContentType: 'application/octet-stream',
        ChecksumSHA256: Buffer.from(opts.sha256Hex, 'hex').toString('base64'),
        ...this.sseParams(),
      }),
    );
  }

  async headObject(tenantId: string, key: string): Promise<HeadResult> {
    this.assertTenantKey(tenantId, key);
    const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return {
      contentLength: out.ContentLength ?? null,
      serverSideEncryption: out.ServerSideEncryption ?? null,
      kmsKeyId: out.SSEKMSKeyId ?? null,
    };
  }

  /**
   * Production write verification: the stored object has the expected size and is encrypted with
   * aws:kms (and with the configured key when the configured id is a full ARN). Throws otherwise.
   */
  async verifyStored(tenantId: string, key: string, contentLength: number): Promise<void> {
    const h = await this.headObject(tenantId, key);
    if (h.contentLength !== contentLength) throw new StorageIntegrityError('stored size differs');
    if (this.sse.mode === 'aws:kms') {
      if (h.serverSideEncryption !== 'aws:kms') throw new StorageIntegrityError('object is not SSE-KMS encrypted');
      const want = this.sse.kmsKeyId;
      if (want?.startsWith('arn:') && h.kmsKeyId !== null && h.kmsKeyId !== want) throw new StorageIntegrityError('object encrypted with another key');
    }
  }

  async getObject(tenantId: string, key: string): Promise<Uint8Array> {
    this.assertTenantKey(tenantId, key);
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!out.Body) return new Uint8Array();
    return out.Body.transformToByteArray();
  }

  /** Stream an object (no buffering of the whole object). */
  async getObjectStream(tenantId: string, key: string): Promise<{ stream: Readable; contentLength: number | null }> {
    this.assertTenantKey(tenantId, key);
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!out.Body) throw new StorageIntegrityError('empty body');
    return { stream: out.Body as Readable, contentLength: out.ContentLength ?? null };
  }

  async deleteObject(tenantId: string, key: string): Promise<void> {
    this.assertTenantKey(tenantId, key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Kept from step 1-2 but unused: step 3 never hands out signed URLs (downloads are proxied). */
  async presignGet(tenantId: string, key: string, ttlSeconds: number): Promise<string> {
    this.assertTenantKey(tenantId, key);
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_PRESIGN_SECONDS) {
      throw new StorageKeyError(`ttlSeconds must be 1..${MAX_PRESIGN_SECONDS}`);
    }
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: ttlSeconds });
  }

  destroy(): void {
    this.client.destroy();
  }
}
