/**
 * Integration (real PostgreSQL, migrated + seeded): Dev dashboard routes R60-R68 (Q3, Q5, A5, A8.1-A8.3).
 * - permission matrix per role (tenant users 403, PLATFORM_DEV vs SUPER_ADMIN split);
 * - pipeline aggregates: invariants and delta of owner-inserted fixture documents;
 * - hostile tenant strings never appear in any platform body;
 * - every read appends its platform audit event; flags change flow (stale, conflict, unknown, audit);
 * - eval run read path (owner-inserted run), logs withheld messages.
 */
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { EvalRunDetail, PipelineHealth, Telemetry, type PipelineHealthDto } from '@fr/shared';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';

import { Client, adminUrl, canRunDb, step4Env } from './step4-helpers.js';

const HOSTILE_NAME = 'leak.alice@evil.example eyJhbGciOiJIUzI1NiJ9.payload.sig';
const HOSTILE_CARRIER = 'Carrier bob@evil.example tok_9f8e7d6c5b4a39281706f5e4d3c2b1a0';
const SHA = 'f'.repeat(64);

let app: FastifyInstance;
let admin: pg.Client;
let c: Client;
let dev = '';
let sup = '';
let viewer = '';
let tenantId = '';
let userId = '';
const batchId = randomUUID();
const docIds: string[] = [];
const claimId = randomUUID();
const runId = randomUUID();

async function platformEvents(action: string, sinceSeq: number): Promise<{ seq: number; metadata: Record<string, unknown>; actor_role: string }[]> {
  const r = await admin.query<{ seq: string; metadata: Record<string, unknown>; actor_role: string }>(
    `SELECT seq, metadata, actor_role FROM audit_events WHERE chain_key = 'platform' AND action = $1 AND seq > $2 ORDER BY seq`,
    [action, sinceSeq],
  );
  return r.rows.map((x) => ({ seq: Number(x.seq), metadata: x.metadata, actor_role: x.actor_role }));
}

async function lastPlatformSeq(): Promise<number> {
  const r = await admin.query<{ s: string | null }>(`SELECT max(seq) AS s FROM audit_events WHERE chain_key = 'platform'`);
  return Number(r.rows[0]?.s ?? 0);
}

async function insertDocs(rows: { status: string; type: string; reason?: string; parsedMs?: number }[]): Promise<void> {
  for (const r of rows) {
    const id = randomUUID();
    docIds.push(id);
    await admin.query(
      `INSERT INTO import_documents (id, tenant_id, batch_id, uploaded_by_id, source, display_name, detected_type, size_bytes, sha256,
         doc_type, doc_type_basis, status, reject_reason, provider_name, provider_version, parser_version, updated_at, parsed_at, created_at, storage_key)
       VALUES ($1, $2, $3, $4, 'UPLOAD', $5, $6::"DetectedType", 10, $7, 'INVOICE', 'HEADER', $8::"ImportDocStatus", $9, 'deterministic', '1', '1', now(),
         CASE WHEN $10::int IS NULL THEN NULL ELSE now() - interval '1 minute' + make_interval(secs => $10::int / 1000.0) END, now() - interval '1 minute',
         CASE WHEN $8 IN ('REJECTED', 'FAILED') THEN NULL ELSE $11 END)`,
      [
        id,
        tenantId,
        batchId,
        userId,
        HOSTILE_NAME,
        r.type,
        `${docIds.length.toString(16).padStart(4, '0')}${SHA.slice(4)}`,
        r.status,
        r.reason ?? null,
        r.parsedMs ?? null,
        `t/${tenantId}/imports/${batchId}/${id}/original`,
      ],
    );
  }
}

describe.skipIf(!canRunDb)('Dev dashboard routes R60-R68 (PostgreSQL)', () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    tenantId = (await admin.query<{ id: string }>(`SELECT id FROM tenants WHERE slug = 'acme'`)).rows[0]?.id ?? '';
    userId = (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = 'analyst@acme.test'`)).rows[0]?.id ?? '';
    await admin.query(`INSERT INTO import_batches (id, tenant_id, created_by_id) VALUES ($1, $2, $3)`, [batchId, tenantId, userId]);
    await admin.query(
      `INSERT INTO claims (id, tenant_id, claim_number, carrier_name, shipper_name, perspective, status, amount_claimed_cents, recoverable_cents, pending_review_cents, updated_at)
       VALUES ($1, $2, $3, $4, 'Shipper x', 'SHIPPER', 'AWAITING_ANALYSIS', 0, 0, 0, now())`,
      [claimId, tenantId, `HOSTILE-${claimId.slice(0, 8)}`, HOSTILE_CARRIER],
    );
    app = await buildApp(step4Env(), { logStream: new Writable({ write: (_c, _e, cb) => cb() }) });
    await app.ready();
    c = await new Client(app).init();
    dev = await c.login('dev@platform.test');
    sup = await c.login('super@platform.test');
    viewer = await c.login('viewer@acme.test');
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    if (admin) {
      await admin.query('BEGIN');
      await admin.query('SET LOCAL session_replication_role = replica');
      await admin.query(`DELETE FROM import_documents WHERE batch_id = $1`, [batchId]);
      await admin.query(`DELETE FROM import_batches WHERE id = $1`, [batchId]);
      await admin.query(`DELETE FROM claims WHERE id = $1`, [claimId]);
      await admin.query(`DELETE FROM eval_case_results WHERE run_id = $1`, [runId]);
      await admin.query(`DELETE FROM eval_runs WHERE id = $1`, [runId]);
      await admin.query('COMMIT');
      await admin.end();
    }
  });

  it('enforces the permission matrix (tenant users 403; PLATFORM_DEV vs SUPER_ADMIN)', async () => {
    const routes = ['/api/v1/platform/pipeline', '/api/v1/platform/telemetry', '/api/v1/platform/logs', '/api/v1/platform/flags', '/api/v1/platform/eval/runs', '/api/v1/platform/audit/events', '/api/v1/platform/audit/verify'];
    const expectDev = [200, 200, 200, 200, 200, 403, 403];
    const expectSup = [200, 200, 403, 403, 403, 200, 200];
    for (const [i, url] of routes.entries()) {
      expect([url, (await c.get(url, viewer)).statusCode]).toEqual([url, 403]);
      expect([url, (await c.get(url)).statusCode]).toEqual([url, 401]);
      expect([url, (await c.get(url, dev)).statusCode]).toEqual([url, expectDev[i]]);
      expect([url, (await c.get(url, sup)).statusCode]).toEqual([url, expectSup[i]]);
    }
    // Permission before validation: a wrong role gets 403 even for an invalid query.
    expect((await c.get('/api/v1/platform/pipeline?window=99y', viewer)).statusCode).toBe(403);
    expect((await c.get('/api/v1/platform/pipeline?window=99y', dev)).statusCode).toBe(400);
    expect((await c.get('/api/v1/platform/pipeline?tenantId=x', dev)).statusCode).toBe(400);
  }, 120_000);

  it('pipeline: invariants hold and fixture documents show up as an exact delta', async () => {
    const before = PipelineHealth.parse((await c.get('/api/v1/platform/pipeline?window=1h', dev)).json());
    await insertDocs([
      { status: 'ACCEPTED', type: 'CSV', parsedMs: 1000 },
      { status: 'NEEDS_REVIEW', type: 'PDF', parsedMs: 3000 },
      { status: 'REJECTED', type: 'TXT', reason: 'parse_timeout', parsedMs: 2000 },
      { status: 'REJECTED', type: 'TXT', reason: 'malformed_csv' },
      { status: 'FAILED', type: 'PNG', reason: 'parse_failed' },
    ]);
    const after = PipelineHealth.parse((await c.get('/api/v1/platform/pipeline?window=1h', dev)).json());
    const inv = (p: PipelineHealthDto) => {
      const s = Object.values(p.documents.byStatus).reduce((a, b) => a + b, 0);
      const t = Object.values(p.documents.byDetectedType).reduce((a, b) => a + b, 0);
      expect(s).toBe(p.documents.total);
      expect(t).toBe(p.documents.total);
      expect(p.documents.rejectedByReason.reduce((a, b) => a + b.count, 0)).toBe(p.documents.byStatus.REJECTED);
      expect(p.scope).toBe('all_tenants_aggregate');
      expect(p.db).toBe('ok');
    };
    inv(before);
    inv(after);
    expect(after.documents.total - before.documents.total).toBe(5);
    expect(after.documents.byStatus.REJECTED - before.documents.byStatus.REJECTED).toBe(2);
    expect(after.documents.byDetectedType.TXT - before.documents.byDetectedType.TXT).toBe(2);
    expect(after.reviewQueue.depth - before.reviewQueue.depth).toBe(1);
    expect(after.uploadToParseMs.n - before.uploadToParseMs.n).toBe(3);
    expect(after.claims.awaitingAnalysis).toBeGreaterThanOrEqual(1);
    const reasons = after.documents.rejectedByReason.map((r) => r.reason);
    expect(reasons).toEqual(expect.arrayContaining(['parse_timeout', 'malformed_csv']));
    for (let i = 1; i < after.documents.rejectedByReason.length; i += 1) {
      const a = after.documents.rejectedByReason[i - 1];
      const b = after.documents.rejectedByReason[i];
      expect(a && b && (a.count > b.count || (a.count === b.count && a.reason < b.reason))).toBe(true);
    }
    if (after.documents.total > 0) expect(after.rates.rejected).toBe(Math.round((after.documents.byStatus.REJECTED / after.documents.total) * 10000) / 10000);
  });

  it('never returns tenant strings from any platform route', async () => {
    app.log.info({ carrier: HOSTILE_CARRIER }, `user ${HOSTILE_NAME}`);
    const bodies: string[] = [];
    for (const url of ['/api/v1/platform/pipeline?window=7d', '/api/v1/platform/telemetry', '/api/v1/platform/logs?level=trace&limit=200', '/api/v1/platform/flags', '/api/v1/platform/eval/runs']) {
      bodies.push((await c.get(url, dev)).body);
    }
    for (const url of ['/api/v1/platform/audit/events?limit=100', '/api/v1/platform/audit/verify']) bodies.push((await c.get(url, sup)).body);
    for (const b of bodies) {
      for (const needle of ['alice@evil', 'bob@evil', 'eyJhbGciOiJIUzI1NiJ9', 'tok_9f8e7d6c', 'HOSTILE-', tenantId, 'Acme', 'acme.test', 'analyst@']) {
        expect([needle, b.includes(needle)]).toEqual([needle, false]);
      }
    }
    const logs = JSON.parse(bodies[2] ?? '{}') as { items: { event: string }[] };
    expect(logs.items.some((i) => i.event === '(message withheld)')).toBe(true);
  });

  it('telemetry: per-instance counters, fixed rules, consistent sums', async () => {
    const t = Telemetry.parse((await c.get('/api/v1/platform/telemetry', dev)).json());
    expect(t.scope).toBe('this_instance_since_start');
    expect(t.requests.total).toBe(t.routes.reduce((a, r) => a + r.count, 0));
    expect(t.components.map((x) => [x.id, x.method, x.learnedModel])).toEqual([
      ['priority-v1', 'fixed_rules', false],
      ['similar-v1', 'fixed_rules', false],
    ]);
    expect(t.routes.some((r) => r.route === '/api/v1/platform/pipeline')).toBe(true);
    expect(t.routes.every((r) => !r.route.includes('?'))).toBe(true);
  });

  it('every dashboard read appends its platform audit event (actor role, section metadata only)', async () => {
    const since = await lastPlatformSeq();
    await c.get('/api/v1/platform/pipeline?window=7d', dev);
    await c.get('/api/v1/platform/logs?level=warn&limit=7', dev);
    await c.get('/api/v1/platform/flags', dev);
    await c.get('/api/v1/platform/eval/runs', dev);
    await c.get('/api/v1/platform/telemetry', sup);
    const viewed = await platformEvents('platform.dashboard_viewed', since);
    expect(viewed.map((e) => e.metadata)).toEqual([{ section: 'pipeline', window: '7d' }, { section: 'flags' }, { section: 'eval' }, { section: 'telemetry' }]);
    expect(viewed.map((e) => e.actor_role)).toEqual(['PLATFORM_DEV', 'PLATFORM_DEV', 'PLATFORM_DEV', 'SUPER_ADMIN']);
    const logs = await platformEvents('platform.logs_viewed', since);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.metadata).toMatchObject({ level: 'warn', limit: 7 });
    expect(typeof logs[0]?.metadata['returned']).toBe('number');
    const v = await c.get('/api/v1/platform/audit/verify', sup);
    expect(v.json()).toMatchObject({ valid: true });
    expect(await platformEvents('audit.verify', since)).toHaveLength(1);
  });

  it('flags: stale version, same value, unknown key, invalid reason, CSRF, then a real change audited in the same transaction', async () => {
    const list = (await c.get('/api/v1/platform/flags', dev)).json() as { items: { key: string; enabled: boolean; version: number }[] };
    expect(list.items.map((f) => f.key)).toEqual(['intelligence.provenance', 'intelligence.similar_claims', 'intelligence.worklist']);
    const f = list.items.find((x) => x.key === 'intelligence.provenance');
    if (!f) throw new Error('missing flag');
    const url = '/api/v1/platform/flags/intelligence.provenance';
    const reason = 'Integration test toggles provenance';
    expect((await c.send('PUT', url, dev, { enabled: !f.enabled, expectedVersion: f.version + 5, reason })).json()).toMatchObject({ error: { code: 'stale_revision' } });
    expect((await c.send('PUT', url, dev, { enabled: f.enabled, expectedVersion: f.version, reason })).json()).toMatchObject({ error: { code: 'conflict' } });
    expect((await c.send('PUT', '/api/v1/platform/flags/intelligence.unknown', dev, { enabled: true, expectedVersion: 1, reason })).statusCode).toBe(404);
    expect((await c.send('PUT', url, dev, { enabled: !f.enabled, expectedVersion: f.version, reason: 'has <b>markup</b> in it' })).statusCode).toBe(400);
    expect((await c.send('PUT', url, dev, { enabled: !f.enabled, expectedVersion: f.version, reason: 'short' })).statusCode).toBe(400);
    expect((await c.send('PUT', url, sup, { enabled: !f.enabled, expectedVersion: f.version, reason })).statusCode).toBe(403);
    const noCsrf = await app.inject({ method: 'PUT', url, headers: { authorization: `Bearer ${dev}` }, payload: { enabled: !f.enabled, expectedVersion: f.version, reason } });
    expect(noCsrf.statusCode).toBe(403);
    const since = await lastPlatformSeq();
    const ok = await c.send('PUT', url, dev, { enabled: !f.enabled, expectedVersion: f.version, reason });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ key: 'intelligence.provenance', enabled: !f.enabled, version: f.version + 1, lastReason: reason, updatedBy: { name: 'Dana Developer' } });
    const ev = await platformEvents('platform.flag_changed', since);
    expect(ev.map((e) => e.metadata)).toEqual([{ key: 'intelligence.provenance', from: f.enabled, to: !f.enabled, version: f.version + 1, reason }]);
    // Restore.
    const back = await c.send('PUT', url, dev, { enabled: f.enabled, expectedVersion: f.version + 1, reason: 'Integration test restores provenance' });
    expect(back.statusCode).toBe(200);
  });

  it('eval runs: newest first, detail with ordered case results, 404 for unknown and non-UUID ids', async () => {
    await admin.query(`SELECT 1`);
    await admin.query(
      `INSERT INTO eval_runs (id, eval_set_id, eval_set_version, eval_set_sha256, stage, k, started_at, finished_at, provider_name, provider_version,
         parser_version, case_count, runs_total, runs_passed, pass_hat_k_count, pass_at_least_one_count, flaky_case_count, always_fail_count,
         deterministic_cases, wilson_low, wilson_high, pass_pow_curve, run_ms_p50, run_ms_p95, created_at)
       VALUES ($1, 'int-set', '1', $2, 'extraction', 3, now(), now(), 'deterministic', '1', 'p1', 2, 6, 4, 1, 2, 1, 0, 1, 0.094531, 0.905469,
         ARRAY[0.6666666666666666, 0.5, 0.5], 1.5, 2.5, now() + interval '1 hour')`,
      [runId, 'a'.repeat(64)],
    );
    await admin.query(
      `INSERT INTO eval_case_results (run_id, case_id, category, runs_passed, k, passed_all, distinct_outputs, first_failure_code, median_duration_ms)
       VALUES ($1, 'z-case', 'cat', 3, 3, true, 1, NULL, 1), ($1, 'a-case', 'cat', 1, 3, false, 2, 'field_mismatch', 2)`,
      [runId],
    );
    const list = (await c.get('/api/v1/platform/eval/runs?limit=1', dev)).json() as { items: { id: string; perRunPassRate: number; passHatK: number; basis: string }[] };
    expect(list.items[0]).toMatchObject({ id: runId, perRunPassRate: 0.666667, passHatK: 0.5, basis: 'synthetic_fixtures' });
    const d = EvalRunDetail.parse((await c.get(`/api/v1/platform/eval/runs/${runId}`, dev)).json());
    expect(d.results.map((r) => r.caseId)).toEqual(['a-case', 'z-case']);
    expect(d.passPowCurve).toEqual([0.666667, 0.5, 0.5]);
    expect((await c.get(`/api/v1/platform/eval/runs/${randomUUID()}`, dev)).statusCode).toBe(404);
    expect((await c.get('/api/v1/platform/eval/runs/not-a-uuid', dev)).statusCode).toBe(404);
  });
});
