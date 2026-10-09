/**
 * Integration (PostgreSQL + MinIO/S3 + built parse worker): import routes R40-R45 end to end. Needs
 * TEST_DATABASE_URL, TEST_ADMIN_DATABASE_URL, S3_* (bucket created by `npm run ensure-bucket`) and
 * `npm run build`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { minimalPdf } from '../helpers/pdf-fixtures.js';

import { Session, adminUrl, baseEnv, canRun, cleanupBatches, deleteBatchObjects, objectExists, s3, unique } from './import-helpers.js';

const { buildApp } = await import('../../src/app.js');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const enc = (s: string) => new TextEncoder().encode(s);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe.skipIf(!canRun)('imports R40-R45 (PostgreSQL + S3 + sandbox)', () => {
  let app: FastifyInstance;
  let s: Session;
  let admin: pg.Client;
  let analyst = '';
  let viewer = '';
  let globexManager = '';
  let acmeId = '';
  const batches: string[] = [];
  const client = s3();

  beforeAll(async () => {
    app = await buildApp(baseEnv({ IMPORT_MAX_FILE_BYTES: '200000', IMPORT_MAX_FILES_PER_BATCH: '20' }));
    await app.ready();
    s = new Session(app);
    await s.init();
    analyst = await s.login('analyst@acme.test');
    viewer = await s.login('viewer@acme.test');
    globexManager = await s.login('manager@globex.test');
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    acmeId = (await admin.query<{ id: string }>(`SELECT id FROM tenants WHERE slug = 'acme'`)).rows[0]?.id ?? '';
  }, 120_000);

  afterAll(async () => {
    await cleanupBatches(admin, batches);
    await deleteBatchObjects(client, acmeId, batches);
    await admin?.end();
    await app?.close();
    client.destroy();
  });

  const newBatch = async (label?: string) => {
    const id = await s.batch(analyst, label);
    batches.push(id);
    return id;
  };

  it('VIEWER cannot create batches; unauthenticated uploads get 401 before any body is read', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/imports', headers: s.headers(viewer), payload: {} })).statusCode).toBe(403);
    const b = await newBatch();
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${b}/documents?filename=a.txt`,
      headers: { ...s.headers(), 'content-type': 'application/octet-stream' },
      payload: Buffer.from('x'),
    });
    expect(r.statusCode).toBe(401);
    expect((await s.upload(viewer, b, 'a.txt', enc('Load: 1'))).statusCode).toBe(403);
  });

  it('creates and lists batches with the creator and document count', async () => {
    const b = await newBatch('Week 41 invoices');
    const list = await app.inject({ method: 'GET', url: '/api/v1/imports?pageSize=100', headers: s.headers(analyst) });
    expect(list.statusCode).toBe(200);
    const item = (list.json() as { items: { id: string; label: string; documentCount: number; createdBy: { name: string } }[] }).items.find((i) => i.id === b);
    expect(item).toMatchObject({ label: 'Week 41 invoices', documentCount: 0, createdBy: { name: 'Alex Analyst' } });
    expect((await app.inject({ method: 'POST', url: '/api/v1/imports', headers: s.headers(analyst), payload: { label: 'bad\u0000label' } })).statusCode).toBe(400);
  });

  it('uploads a well-formed txt invoice: ACCEPTED, fields with pointers, encrypted object under the tenant prefix', async () => {
    const b = await newBatch();
    const bytes = new Uint8Array([...readFileSync(path.join(repoRoot, 'tests/fixtures/ld5001/invoice.txt')), ...enc(`\nNote: ${unique()}\n`)]);
    const r = await s.upload(analyst, b, 'invoice.txt', bytes);
    expect(r.statusCode, r.body).toBe(201);
    const d = r.json() as {
      id: string;
      status: string;
      docType: string;
      sha256: string;
      sizeBytes: number;
      reviewThreshold: number;
      fields: { key: string; value: string; confidence: number; source: { line: number; start: number; end: number; excerpt: string } }[];
    };
    expect(d).toMatchObject({ status: 'ACCEPTED', docType: 'INVOICE', sha256: sha(bytes), sizeBytes: bytes.byteLength, reviewThreshold: 0.9 });
    expect(d.fields.find((f) => f.key === 'invoice.total')).toMatchObject({ value: '2118.00', confidence: 0.95 });
    expect(d.fields.find((f) => f.key === 'invoice.invoice_number')?.source).toMatchObject({ line: 2, start: 16, end: 24, excerpt: 'Invoice Number: INV-1001' });
    const row = (await admin.query<{ storage_key: string; text_key: string }>(`SELECT storage_key, text_key FROM import_documents WHERE id = $1`, [d.id])).rows[0];
    expect(row?.storage_key).toBe(`t/${acmeId}/imports/${b}/${d.id}/original`);
    expect(row?.text_key).toBe(`t/${acmeId}/imports/${b}/${d.id}/text`);
    expect(await objectExists(client, row?.storage_key ?? '')).toBe(true);
    // Duplicate in the same batch -> 409 conflict, audited, no new row.
    const dup = await s.upload(analyst, b, 'again.txt', bytes);
    expect(dup.statusCode).toBe(409);
    expect((dup.json() as { error: { code: string } }).error.code).toBe('conflict');
    // Download: synthesized name, exact bytes, no-store.
    const dl = await app.inject({ method: 'GET', url: `/api/v1/imports/${b}/documents/${d.id}/original`, headers: s.headers(analyst) });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('application/octet-stream');
    expect(dl.headers['content-disposition']).toBe(`attachment; filename="document-${d.id.slice(0, 8)}.txt"`);
    expect(dl.headers['cache-control']).toBe('no-store');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(sha(dl.rawPayload)).toBe(d.sha256);
    const audit = await admin.query<{ action: string }>(`SELECT action FROM audit_events WHERE target_id = $1 ORDER BY seq`, [d.id]);
    expect(audit.rows.map((x) => x.action)).toEqual(['import.document_received', 'import.document_parsed', 'import.document_downloaded']);
  });

  it('a text-layer PDF is stored and every field is flagged (NEEDS_REVIEW)', async () => {
    const b = await newBatch();
    const r = await s.upload(analyst, b, 'scan.pdf', minimalPdf(['DOCUMENT: FREIGHT INVOICE', `Invoice Number: INV-${unique()}`, 'Load Number: L9']));
    expect(r.statusCode, r.body).toBe(201);
    const d = r.json() as { status: string; pageCount: number; reviewReasons: string[]; flaggedFieldCount: number; fields: { needsReview: boolean; source: { page: number } }[] };
    expect(d).toMatchObject({ status: 'NEEDS_REVIEW', pageCount: 1, reviewReasons: ['FLAGGED_FIELDS'], flaggedFieldCount: 2 });
    expect(d.fields.every((f) => f.needsReview && f.source.page === 1)).toBe(true);
  });

  it.each([
    ['evil.exe', [0x4d, 0x5a, 0x90, 0x00], 'unsupported_type'],
    ['archive.zip', [0x50, 0x4b, 0x03, 0x04], 'unsupported_type'],
    ['fake.pdf', [...enc('just text')], 'type_mismatch'],
    ['fake.txt', [...enc('%PDF-1.4\n')], 'type_mismatch'],
    ['nul.txt', [...enc('a\u0000b')], 'binary_content'],
    ['page.csv', [...enc('  <!DOCTYPE html><html>')], 'markup_content'],
    ['image.svg', [...enc('<svg/>')], 'unsupported_type'],
    ['empty.txt', [], 'empty_file'],
  ])('%s is rejected before storage: 415 %s, audited, no row', async (name, bytes, code) => {
    const b = await newBatch();
    const r = await s.upload(analyst, b, name, Uint8Array.from(bytes));
    expect(r.statusCode).toBe(415);
    expect((r.json() as { error: { code: string; details: { path: string; code: string }[] } }).error).toMatchObject({
      code: 'unsupported_media_type',
      details: [{ path: 'file', code }],
    });
    const rows = await admin.query(`SELECT 1 FROM import_documents WHERE batch_id = $1`, [b]);
    expect(rows.rowCount).toBe(0);
    const audit = await admin.query<{ metadata: { reasonCode: string; documentId: null } }>(
      `SELECT metadata FROM audit_events WHERE target_id = $1 AND action = 'import.document_rejected'`,
      [b],
    );
    expect(audit.rows[0]?.metadata).toMatchObject({ reasonCode: code, documentId: null });
  });

  it('enforces the media type, the size limit while streaming and the file-name rules', async () => {
    const b = await newBatch();
    expect((await s.upload(analyst, b, 'a.txt', enc('Load: 1'), 'application/json')).statusCode).toBe(415);
    expect((await s.upload(analyst, b, 'a.txt', enc('Load: 1'), 'text/plain')).statusCode).toBe(415);
    const big = await s.upload(analyst, b, 'big.txt', new Uint8Array(200_001).fill(0x61));
    expect(big.statusCode).toBe(413);
    expect(big.headers['connection']).toBe('close');
    // Fix round 1 (D1): bidi/format characters are stripped (see the D1 test); controls stay 400.
    for (const bad of ['', 'a\u0000.txt', 'a\u{1b}.txt', 'a'.repeat(256)]) {
      const r = await app.inject({
        method: 'POST',
        url: `/api/v1/imports/${b}/documents?filename=${encodeURIComponent(bad)}`,
        headers: { ...s.headers(analyst), 'content-type': 'application/octet-stream' },
        payload: Buffer.from('Load: 1'),
      });
      expect([JSON.stringify(bad), r.statusCode]).toEqual([JSON.stringify(bad), 400]);
    }
    expect((await admin.query(`SELECT 1 FROM import_documents WHERE batch_id = $1`, [b])).rowCount).toBe(0);
  });

  it('content-level rejections are 201 REJECTED with the object deleted; downloads are 409', async () => {
    const b = await newBatch();
    const r = await s.upload(analyst, b, 'bad.csv', enc(`a\rb ${unique()}\n`));
    expect(r.statusCode).toBe(201);
    const d = r.json() as { id: string; status: string; rejectReason: string };
    expect(d).toMatchObject({ status: 'REJECTED', rejectReason: 'malformed_csv' });
    expect(await objectExists(client, `t/${acmeId}/imports/${b}/${d.id}/original`)).toBe(false);
    const row = (await admin.query<{ storage_key: string | null }>(`SELECT storage_key FROM import_documents WHERE id = $1`, [d.id])).rows[0];
    expect(row?.storage_key).toBeNull();
    expect((await app.inject({ method: 'GET', url: `/api/v1/imports/${b}/documents/${d.id}/original`, headers: s.headers(analyst) })).statusCode).toBe(409);
  });

  it('display names are sanitized and never used in keys or headers', async () => {
    const b = await newBatch();
    const r = await s.upload(analyst, b, 'in/vo:ice  "q".txt', enc(`Document: Invoice\nLoad Number: L-${unique()}\n`));
    expect(r.statusCode, r.body).toBe(201);
    expect((r.json() as { displayName: string }).displayName).toBe('in_vo_ice _q_.txt');
  });

  it('tenant isolation: another tenant gets 404 for the batch, the document and the original', async () => {
    const b = await newBatch();
    const up = await s.upload(analyst, b, 'iso.txt', enc(`Document: Invoice\nLoad Number: L-${unique()}\n`));
    const id = (up.json() as { id: string }).id;
    for (const url of [`/api/v1/imports/${b}`, `/api/v1/imports/${b}/documents/${id}`, `/api/v1/imports/${b}/documents/${id}/original`]) {
      expect([url, (await app.inject({ method: 'GET', url, headers: s.headers(globexManager) })).statusCode]).toEqual([url, 404]);
    }
    expect((await s.upload(globexManager, b, 'x.txt', enc('Load: 1'))).statusCode).toBe(404);
  });

  it('batch_full and quota_exceeded are enforced', async () => {
    const small = await buildApp(baseEnv({ IMPORT_MAX_FILES_PER_BATCH: '1', TENANT_STORAGE_QUOTA_BYTES: '1073741824' }));
    try {
      const ss = new Session(small);
      await ss.init();
      const t = await ss.login('analyst@acme.test');
      const b = await ss.batch(t);
      batches.push(b);
      expect((await ss.upload(t, b, 'one.txt', enc(`Load: ${unique()}`))).statusCode).toBe(201);
      const full = await ss.upload(t, b, 'two.txt', enc(`Load: ${unique()}`));
      expect([full.statusCode, (full.json() as { error: { code: string } }).error.code]).toEqual([409, 'batch_full']);
    } finally {
      await small.close();
    }
    const tiny = await buildApp(baseEnv({ TENANT_STORAGE_QUOTA_BYTES: '1' }));
    try {
      const ss = new Session(tiny);
      await ss.init();
      const t = await ss.login('analyst@acme.test');
      const b = await ss.batch(t);
      batches.push(b);
      const q = await ss.upload(t, b, 'q.txt', enc(`Load: ${unique()}`));
      expect([q.statusCode, (q.json() as { error: { code: string } }).error.code]).toEqual([422, 'quota_exceeded']);
    } finally {
      await tiny.close();
    }
  });

  it('fix round 1 (D1/D2): format characters in ?filename= are stripped; controls stay 400', async () => {
    const b = await newBatch();
    const bidi = await s.upload(analyst, b, 'invoice\u{202e}fdp.txt', enc(`Load: ${unique()}`));
    expect(bidi.statusCode).toBe(201);
    expect((bidi.json() as { displayName: string }).displayName).toBe('invoicefdp.txt');
    const exe = await s.upload(analyst, b, 'invoice\u{202e}txt.exe', enc('hello'));
    expect([exe.statusCode, (exe.json() as { error: { details: { code: string }[] } }).error.details[0]?.code]).toEqual([415, 'unsupported_type']);
    const dots = await s.upload(analyst, b, '  .lead and trail.txt  ', enc(`Load: ${unique()}`));
    expect((dots.json() as { displayName: string }).displayName).toBe('lead and trail.txt');
    const ctl = await s.upload(analyst, b, 'a\u{1b}.txt', enc('x'));
    expect(ctl.statusCode).toBe(400);
  });

  it('SQ6: RATE_LIMIT_ENABLED=false disables the per-user upload limiter (enabled: 429)', async () => {
    for (const [enabled, expected] of [
      ['false', [201, 201, 201]],
      ['true', [201, 429, 429]],
    ] as const) {
      const limited = await buildApp(baseEnv({ RATE_LIMIT_ENABLED: enabled, RATE_LIMIT_UPLOAD_MAX: '1', RATE_LIMIT_GLOBAL_MAX: '100000' }));
      try {
        const ss = new Session(limited);
        await ss.init();
        const t = await ss.login('analyst@acme.test');
        const b = await ss.batch(t);
        batches.push(b);
        const codes: number[] = [];
        for (let i = 0; i < 3; i += 1) codes.push((await ss.upload(t, b, `r${i}.txt`, enc(`Load: ${unique()}`))).statusCode);
        expect([enabled, codes]).toEqual([enabled, expected]);
      } finally {
        await limited.close();
      }
    }
  });

  it('the reaper marks stale RECEIVED documents FAILED when the batch is read', async () => {
    const b = await newBatch();
    const userId = (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = 'analyst@acme.test'`)).rows[0]?.id;
    const docId = '00000000-0000-4000-8000-' + unique().padEnd(12, '0').slice(0, 12).replace(/[^0-9a-f]/gu, 'a');
    await admin.query(
      `INSERT INTO import_documents (id, tenant_id, batch_id, uploaded_by_id, source, display_name, detected_type, size_bytes, sha256, storage_key,
         doc_type, doc_type_basis, status, provider_name, provider_version, parser_version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'UPLOAD', 'stale.txt', 'TXT', 5, $5, $6, 'OTHER', 'NONE', 'RECEIVED', 'deterministic', '1', '1', now() - interval '1 hour', now())`,
      [docId, acmeId, b, userId, 'c'.repeat(64), `t/${acmeId}/imports/${b}/${docId}/original`],
    );
    const r = await app.inject({ method: 'GET', url: `/api/v1/imports/${b}`, headers: s.headers(analyst) });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { documents: { id: string; status: string }[] }).documents.find((x) => x.id === docId)?.status).toBe('FAILED');
  });
});
