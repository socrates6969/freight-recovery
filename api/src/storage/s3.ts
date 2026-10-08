/**
 * S3-compatible object storage wrapper (A13). Same code for MinIO (dev) and S3 (AWS). Keys are always
 * under a per-tenant prefix `t/<tenantId>/...`; reads outside the caller's prefix are refused; presigned
 * GET URLs live at most 5 minutes. No upload route exists in this step.
 */
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { AppConfig } from '../config.js';

export const MAX_PRESIGN_SECONDS = 300;
const SEGMENT_RE = /^[A-Za-z0-9._-]{1,128}$/u;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export class StorageKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageKeyError';
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

export class ObjectStore {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    client: S3Client,
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
    });
    return new ObjectStore(cfg.s3.bucket, client);
  }

  private assertTenantKey(tenantId: string, key: string): void {
    if (!isKeyInTenant(key, tenantId)) throw new StorageKeyError('key outside tenant prefix');
  }

  async getObject(tenantId: string, key: string): Promise<Uint8Array> {
    this.assertTenantKey(tenantId, key);
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!out.Body) return new Uint8Array();
    return out.Body.transformToByteArray();
  }

  async presignGet(tenantId: string, key: string, ttlSeconds: number): Promise<string> {
    this.assertTenantKey(tenantId, key);
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_PRESIGN_SECONDS) {
      throw new StorageKeyError(`ttlSeconds must be 1..${MAX_PRESIGN_SECONDS}`);
    }
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: ttlSeconds });
  }
}
