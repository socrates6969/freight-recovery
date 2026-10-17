/**
 * Integration (PostgreSQL, seeded): export routes R54-R56. RBAC, headers, exact columns, row counts
 * against the database, filters, formula neutralization of hostile seed data, XLSX structure, the
 * EXPORT_MAX_ROWS check before the first byte, tenant scope, and the started/completed audit events
 * whose SHA-256 equals the hash of the downloaded bytes.
 */
import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import type { FastifyInstance } from 'fastify';
import { strFromU8, unzipSync } from 'fflate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Session, adminUrl, appUrl, baseEnv } from './import-helpers.js';

const { buildApp } = await import('../../src/app.js');

/** Minimal RFC 4180 reader for the test (quoted cells, CRLF). */
function parseCsv(text: string): { cells: string[]; quoted: boolean[] }[] {
  const rows: { cells: string[]; quoted: boolean[] }[] = [];
  let i = 0;
  while (i < text.length) {
    const cells: string[] = [];
    const quoted: boolean[] = [];
    for (;;) {
      let v = '';
      let q = false;
      if (text[i] === '"') {
        q = true;
        i += 1;
        for (;;) {
          if (text[i] === '"' && text[i + 1] === '"') {
            v += '"';
            i += 2;
          } else if (text[i] === '"') {
            i += 1;
            break;
          } else {
            v += text[i] ?? '';
            i += 1;
          }
        }
      } else {
        while (i < text.length && text[i] !== ',' && text[i] !== '\r') {
          v += text[i] ?? '';
          i += 1;
        }
      }
      cells.push(v);
      quoted.push(q);
      if (text[i] === ',') {
        i += 1;
        continue;
      }
      i += 2; // CRLF
      break;
    }
    rows.push({ cells, quoted });
  }
  return rows;
}

const FORMULA_START = /^[\s\u{3000}]*[=+\-@\u{ff1d}\u{ff0b}\u{ff0d}\u{ff20}]/u;

describe.skipIf(!appUrl || !adminUrl)('exports R54-R56 (PostgreSQL)', () => {
  let app: FastifyInstance;
  let s: Session;
  let admin: pg.Client;
  const tokens: Record<string, string> = {};
  let acmeId = '';

  beforeAll(async () => {
    app = await buildApp(baseEnv());
    await app.ready();
    s = new Session(app);
    await s.init();
    for (const u of ['analyst', 'reviewer', 'viewer', 'manager']) tokens[u] = await s.login(`${u}@acme.test`);
    tokens['globex'] = await s.login('manager@globex.test');
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    acmeId = (await admin.query<{ id: string }>(`SELECT id FROM tenants WHERE slug = 'acme'`)).rows[0]?.id ?? '';
  }, 120_000);

  afterAll(async () => {
    await admin?.end();
    await app?.close();
  });

  const get = (url: string, who: string) => app.inject({ method: 'GET', url, headers: s.headers(tokens[who]) });

  it('enforces the permission matrix and strict queries', async () => {
    for (const [who, entity, status] of [
      ['viewer', 'claims', 403],
      ['viewer', 'packets', 403],
      ['viewer', 'outcomes', 403],
      ['analyst', 'claims', 200],
      ['analyst', 'packets', 403],
      ['analyst', 'outcomes', 403],
      ['reviewer', 'packets', 200],
      ['reviewer', 'outcomes', 200],
    ] as const) {
      const r = await get(`/api/v1/exports/${entity}?format=csv`, who);
      expect([who, entity, r.statusCode]).toEqual([who, entity, status]);
    }
    expect((await get('/api/v1/exports/claims', 'analyst')).statusCode).toBe(400);
    expect((await get('/api/v1/exports/claims?format=csv&page=2', 'analyst')).statusCode).toBe(400);
    expect((await get('/api/v1/exports/claims?format=pdf', 'analyst')).statusCode).toBe(400);
  });

  it('claims CSV: headers, exact columns, every tenant row, neutralized text, audited with the exact hash', async () => {
    const r = await get('/api/v1/exports/claims?format=csv', 'analyst');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(r.headers['content-disposition']).toMatch(/^attachment; filename="freight-recovery-claims-\d{8}T\d{6}Z\.csv"$/u);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['content-length']).toBeUndefined();
    const bytes = r.rawPayload;
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const rows = parseCsv(new TextDecoder().decode(bytes.subarray(3)));
    expect(rows[0]?.cells).toEqual([
      'Claim Number',
      'Load Number',
      'Invoice Number',
      'Invoice Date',
      'Carrier',
      'Shipper',
      'Perspective',
      'Status',
      'Amount Claimed (USD)',
      'Recoverable (USD)',
      'Pending Review (USD)',
      'Currency',
      'Latest Packet Revision',
      'Packet Status',
      'Created At',
      'Updated At',
    ]);
    const dbCount = Number((await admin.query<{ n: string }>(`SELECT count(*) AS n FROM claims WHERE tenant_id = $1`, [acmeId])).rows[0]?.n);
    const data = rows.slice(1);
    expect(data).toHaveLength(dbCount);
    for (const row of data) {
      // Text columns are quoted; money columns are plain numbers; nothing can start a formula.
      for (const i of [0, 1, 2, 4, 5, 6, 7, 11]) expect(row.quoted[i]).toBe(true);
      for (const i of [8, 9, 10]) expect([row.cells[i], row.quoted[i], /^-?\d+\.\d{2}$/u.test(row.cells[i] ?? '')]).toEqual([row.cells[i], false, true]);
      for (const c of row.cells) expect([c, FORMULA_START.test(c)]).toEqual([c, false]);
      expect(row.cells[0]?.startsWith('GLX-')).toBe(false);
      // SQ5: invoice dates are plain calendar days.
      expect([row.cells[3], /^(\d{4}-\d{2}-\d{2})?$/u.test(row.cells[3] ?? '')]).toEqual([row.cells[3], true]);
    }
    const ordered = data.map((x) => x.cells[14] ?? '');
    expect([...ordered].sort().reverse()).toEqual(ordered);
    // Audit: started + completed with the hash of the exact bytes.
    await new Promise((res) => setTimeout(res, 200));
    const audit = await admin.query<{ action: string; metadata: Record<string, unknown> }>(
      `SELECT action, metadata FROM audit_events WHERE tenant_id = $1 AND action LIKE 'export.%' ORDER BY seq DESC LIMIT 2`,
      [acmeId],
    );
    const completed = audit.rows.find((a) => a.action === 'export.completed');
    expect(completed?.metadata).toMatchObject({
      entity: 'claims',
      format: 'csv',
      rowCount: dbCount,
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(audit.rows.some((a) => a.action === 'export.started')).toBe(true);
  });

  it('neutralizes formula payloads and strips bidi controls end to end (CSV and XLSX)', async () => {
    const id = '00000000-0000-4000-8000-0000000f0f01';
    await admin.query(
      `INSERT INTO claims (id, tenant_id, claim_number, load_number, carrier_name, shipper_name, perspective, status, amount_claimed_cents,
         recoverable_cents, pending_review_cents, updated_at)
       VALUES ($1, $2, 'CLM-EXPORT-FORMULA', '+1-555-0100', '=HYPERLINK("http://evil","x")', '\u{ff20}SUM(1)', 'SHIPPER', 'AWAITING_ANALYSIS', 0, 0, 0, now())`,
      [id, acmeId],
    );
    try {
      const csv = parseCsv(new TextDecoder().decode((await get('/api/v1/exports/claims?format=csv&q=CLM-EXPORT-FORMULA', 'analyst')).rawPayload.subarray(3)));
      expect(csv.slice(1).map((r) => [r.cells[1], r.cells[4], r.cells[5]])).toEqual([["'+1-555-0100", '\'=HYPERLINK("http://evil","x")', "'\u{ff20}SUM(1)"]]);
      const hostile = parseCsv(new TextDecoder().decode((await get('/api/v1/exports/claims?format=csv&q=CLM-HOSTILE-2', 'analyst')).rawPayload.subarray(3)));
      expect(hostile[1]?.cells[4]).toBe('Invoice gnp.exe total isolated');
      const xlsx = strFromU8(unzipSync((await get('/api/v1/exports/claims?format=xlsx&q=CLM-EXPORT-FORMULA', 'analyst')).rawPayload)['xl/worksheets/sheet1.xml'] ?? new Uint8Array());
      expect(xlsx).toContain('&apos;=HYPERLINK(&quot;http://evil&quot;,&quot;x&quot;)');
      expect(xlsx.includes('<f>')).toBe(false);
    } finally {
      await admin.query(`DELETE FROM claims WHERE id = $1`, [id]);
    }
  });

  it('filters like the claims list; another tenant only sees its own rows', async () => {
    const approved = parseCsv(new TextDecoder().decode((await get('/api/v1/exports/claims?format=csv&status=APPROVED&sort=claimNumber:asc', 'analyst')).rawPayload.subarray(3)));
    expect(approved.slice(1).every((r) => r.cells[7] === 'APPROVED')).toBe(true);
    const nums = approved.slice(1).map((r) => r.cells[0] ?? '');
    expect([...nums].sort()).toEqual(nums);
    const globex = parseCsv(new TextDecoder().decode((await get('/api/v1/exports/claims?format=csv', 'globex')).rawPayload.subarray(3)));
    expect(globex.slice(1).length).toBeGreaterThan(0);
    expect(globex.slice(1).every((r) => r.cells[0]?.startsWith('GLX-'))).toBe(true);
  });

  it('claims XLSX: a valid workbook with one row per claim and no formulas', async () => {
    const r = await get('/api/v1/exports/claims?format=xlsx&sort=loadNumber:desc', 'analyst');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const files = unzipSync(r.rawPayload);
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml'] ?? new Uint8Array());
    const dbCount = Number((await admin.query<{ n: string }>(`SELECT count(*) AS n FROM claims WHERE tenant_id = $1`, [acmeId])).rows[0]?.n);
    expect(sheet.match(/<row /gu)?.length).toBe(dbCount + 1);
    expect(sheet.includes('<f>')).toBe(false);
  });

  it('packets: one row per finding of the latest packet, citations as file:locator', async () => {
    const r = await get('/api/v1/exports/packets?format=csv', 'reviewer');
    const rows = parseCsv(new TextDecoder().decode(r.rawPayload.subarray(3)));
    expect(rows[0]?.cells.slice(-3)).toEqual(['Explanation', 'Clause', 'Citations']);
    const findings = Number(
      (
        await admin.query<{ n: string }>(
          `SELECT count(*) AS n FROM packet_findings f JOIN evidence_packets p ON p.id = f.packet_id WHERE p.tenant_id = $1 AND p.status <> 'SUPERSEDED'`,
          [acmeId],
        )
      ).rows[0]?.n,
    );
    expect(rows.slice(1)).toHaveLength(findings);
    const withCitations = rows.slice(1).filter((x) => (x.cells[14] ?? '') !== '');
    expect(withCitations.length).toBeGreaterThan(0);
    for (const x of withCitations) expect(x.cells[14]).toMatch(/^[^;]+:[^;]+(; [^;]+:[^;]+)*$/u);
    const unknown = await get('/api/v1/exports/packets?format=csv&claimId=00000000-0000-4000-8000-000000000000', 'reviewer');
    expect(unknown.statusCode).toBe(404);
  });

  it('outcomes: approval ledger rows without actor identity; action/date filters', async () => {
    const r = await get('/api/v1/exports/outcomes?format=csv&action=APPROVE,SEND_READY&from=2000-01-01&to=2100-12-31', 'reviewer');
    const rows = parseCsv(new TextDecoder().decode(r.rawPayload.subarray(3)));
    expect(rows[0]?.cells).toEqual(['Claim Number', 'Packet Revision', 'Action', 'From Status', 'To Status', 'Reason', 'Actor Role', 'Content Hash', 'Decided At']);
    expect(rows.slice(1).length).toBeGreaterThan(0);
    expect(rows.slice(1).every((x) => x.cells[2] === 'APPROVE' || x.cells[2] === 'SEND_READY')).toBe(true);
    const none = await get('/api/v1/exports/outcomes?format=csv&from=2000-01-01&to=2000-01-02', 'reviewer');
    expect(parseCsv(new TextDecoder().decode(none.rawPayload.subarray(3)))).toHaveLength(1);
  });

  it('fix round 1 (D11): a client disconnect audits export.aborted with rowsWritten < planned rows', async () => {
    const total = 20000;
    await admin.query(
      `INSERT INTO claims (id, tenant_id, claim_number, load_number, carrier_name, shipper_name, perspective, status, amount_claimed_cents,
         recoverable_cents, pending_review_cents, updated_at)
       SELECT ('00000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, $1, 'CLM-ABORT-' || g, 'LD-ABORT-' || g,
              'Carrier ' || g, 'Shipper ' || g, 'SHIPPER', 'AWAITING_ANALYSIS', 100, 0, 0, now()
       FROM generate_series(1, $2::int) AS g`,
      [acmeId, total],
    );
    const live = await buildApp(baseEnv());
    try {
      await live.listen({ host: '127.0.0.1', port: 0 });
      const ss = new Session(live);
      await ss.init();
      const t = await ss.login('analyst@acme.test');
      const port = (live.server.address() as AddressInfo).port;
      const firstChunk = await new Promise<number>((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path: '/api/v1/exports/claims?format=csv', headers: ss.headers(t) }, (res) => {
          if (res.statusCode !== 200) reject(new Error(`status ${String(res.statusCode)}`));
          res.once('data', (c: Buffer) => {
            req.destroy();
            resolve(c.length);
          });
        });
        req.on('error', () => undefined);
      });
      expect(firstChunk).toBeGreaterThan(0);
      let aborted: Record<string, unknown> | undefined;
      for (let i = 0; i < 50 && !aborted; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
        aborted = (
          await admin.query<{ metadata: Record<string, unknown> }>(
            `SELECT metadata FROM audit_events WHERE tenant_id = $1 AND action = 'export.aborted' AND metadata->>'entity' = 'claims' ORDER BY seq DESC LIMIT 1`,
            [acmeId],
          )
        ).rows[0]?.metadata;
      }
      expect(aborted).toBeDefined();
      const m = aborted ?? {};
      expect(typeof m['rowsWritten']).toBe('number');
      expect(m['rowCount']).toBe(m['rowsWritten']);
      expect(Number(m['plannedRowCount'])).toBeGreaterThanOrEqual(total);
      expect(Number(m['rowsWritten'])).toBeLessThan(Number(m['plannedRowCount']));
      expect(Number(m['byteLength'])).toBeGreaterThan(0);
    } finally {
      await live.close();
      await admin.query(`DELETE FROM claims WHERE tenant_id = $1 AND claim_number LIKE 'CLM-ABORT-%'`, [acmeId]);
    }
  });

  it('EXPORT_MAX_ROWS is checked before the first byte (422 export_too_large)', async () => {
    const small = await buildApp(baseEnv({ EXPORT_MAX_ROWS: '3' }));
    try {
      const ss = new Session(small);
      await ss.init();
      const t = await ss.login('analyst@acme.test');
      const r = await small.inject({ method: 'GET', url: '/api/v1/exports/claims?format=xlsx', headers: ss.headers(t) });
      expect([r.statusCode, (r.json() as { error: { code: string } }).error.code]).toEqual([422, 'export_too_large']);
    } finally {
      await small.close();
    }
  });
});
