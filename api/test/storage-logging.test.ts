import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger, scrub, serializeReq } from '../src/logging.js';
import { MAX_PRESIGN_SECONDS, ObjectStore, StorageKeyError, isKeyInTenant, tenantKey } from '../src/storage/s3.js';

const T = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('storage keys', () => {
  it('builds tenant-prefixed keys and validates segments', () => {
    expect(tenantKey(T, 'claims', 'c1', 'invoice.txt')).toBe(`t/${T}/claims/c1/invoice.txt`);
    for (const bad of ['..', '.', 'a/b', 'a b', '', 'x'.repeat(129), '..evil', 'é']) {
      expect(() => tenantKey(T, bad)).toThrow(StorageKeyError);
    }
    expect(() => tenantKey('not-a-uuid', 'x')).toThrow(StorageKeyError);
    expect(() => tenantKey(T)).toThrow(StorageKeyError);
  });

  it('checks keys against the caller tenant prefix', () => {
    expect(isKeyInTenant(`t/${T}/a/b.txt`, T)).toBe(true);
    expect(isKeyInTenant(`t/${OTHER}/a/b.txt`, T)).toBe(false);
    expect(isKeyInTenant(`t/${T}/../${OTHER}/x`, T)).toBe(false);
    expect(isKeyInTenant(`t/${T}`, T)).toBe(false);
  });

  it('refuses foreign keys and long presign TTLs before any network call', async () => {
    const store = new ObjectStore('bucket', {} as never);
    await expect(store.getObject(T, `t/${OTHER}/x.txt`)).rejects.toThrow(StorageKeyError);
    await expect(store.presignGet(T, `t/${T}/x.txt`, MAX_PRESIGN_SECONDS + 1)).rejects.toThrow(StorageKeyError);
    await expect(store.presignGet(T, `t/${OTHER}/x.txt`, 60)).rejects.toThrow(StorageKeyError);
  });
});

describe('logging redaction', () => {
  it('scrubs sensitive keys at any depth', () => {
    expect(
      scrub({ a: { password: 'p', nested: { mfaToken: 't', ok: 1 } }, list: [{ recoveryCodes: ['x'] }], Authorization: 'Bearer x' }),
    ).toEqual({ a: { password: '[REDACTED]', nested: { mfaToken: '[REDACTED]', ok: 1 } }, list: [{ recoveryCodes: '[REDACTED]' }], Authorization: '[REDACTED]' });
  });

  it('logs requests without query strings', () => {
    expect(serializeReq({ id: 'r1', method: 'GET', url: '/api/v1/claims?q=secret', ip: '1.2.3.4' })).toEqual({
      id: 'r1',
      method: 'GET',
      path: '/api/v1/claims',
      remoteAddress: '1.2.3.4',
    });
  });

  it('never writes secrets to the log stream', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const log = createLogger('info', stream);
    log.info({ body: { password: 'hunter2-secret', token: 'tok-secret', demandLetter: 'letter-secret' } }, 'x');
    log.info({ req: { headers: { authorization: 'Bearer abc-secret', cookie: 'fr_rt=rt-secret' } } }, 'y');
    const out = lines.join('');
    for (const s of ['hunter2-secret', 'tok-secret', 'letter-secret', 'abc-secret', 'rt-secret']) expect(out).not.toContain(s);
    expect(out).toContain('[REDACTED]');
    expect(out).toContain('"service":"fr-api"');
  });
});
