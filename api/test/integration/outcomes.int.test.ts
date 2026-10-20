/**
 * Integration (real PostgreSQL, migrated + seeded): claim outcomes (REQ-20261020-claim-outcomes).
 * - database: RLS ENABLE + FORCE and the tenant policy on claim_outcomes, grants (SELECT, INSERT only for
 *   freight_app), append-only for every role (UPDATE/DELETE/TRUNCATE refused), the claim-state guard trigger
 *   and the kind-consistency CHECK;
 * - routes: permission matrix row (OWNER, ADMIN, MANAGER, REVIEWER 201; ANALYST, VIEWER, platform 403;
 *   anonymous 401; API key 403), Origin and CSRF checks, strict bodies (400), state rule (409), byte-identical
 *   404 for another tenant's claim, an unknown id and a malformed id, the audit event, the list route;
 * - insights: the Recovery section computed from the recorded outcomes (hand-computed expectations).
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { ClaimOutcomeList, ClaimOutcomeView, InsightsRecovery } from '@fr/shared';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';

import { Client, STEP4_TEST_API_KEY_PEPPER, adminUrl, appUrl, canRunDb, step4Env } from './step4-helpers.js';

type Inject = Awaited<ReturnType<FastifyInstance['inject']>>;
const errorOf = (r: Inject) => (r.json() as { error: { code: string; message: string; details?: { path: string; code: string }[] } }).error;
const quiet = () => new Writable({ write: (_c, _e, cb) => cb() });
const HEX = 'd'.repeat(64);
const marker = `zz oc ${Date.now().toString(36)}`;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

let admin: pg.Client;
let appDb: pg.Client;
let acme = '';
let globex = '';
let ownerId = '';
const ids: Record<string, string> = {};

async function asApp<T>(tenant: string | null, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  await appDb.query('BEGIN');
  try {
    if (tenant) await appDb.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
    return await fn(appDb);
  } finally {
    await appDb.query('ROLLBACK');
  }
}

/** P0001 message (or `other: <message>`) of a statement run as the owner connection in its own transaction, or null. */
async function raise(sql: string, params: unknown[] = []): Promise<string | null> {
  await admin.query('BEGIN');
  try {
    await admin.query(sql, params);
    await admin.query('COMMIT');
    return null;
  } catch (e) {
    await admin.query('ROLLBACK');
    const err = e as { code?: string; message?: string };
    return err.code === 'P0001' ? (err.message ?? null) : `other: ${err.message ?? ''}`;
  }
}

async function claim(key: string, tenant: string, status: string, rec: number): Promise<string> {
  const id = randomUUID();
  ids[key] = id;
  await admin.query(
    `INSERT INTO claims (id, tenant_id, claim_number, carrier_name, shipper_name, perspective, status, amount_claimed_cents, recoverable_cents, pending_review_cents, updated_at)
     VALUES ($1, $2, $3, $4, 'Shipper', 'SHIPPER', $5::"ClaimStatus", $6, $6, 0, now())`,
    [id, tenant, `${marker}-${key}`, `${marker} carrier`, status, rec],
  );
  return id;
}

async function packet(claimKey: string, status: string, created: string, findings: [string, string][]): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `INSERT INTO evidence_packets (id, tenant_id, claim_id, revision, status, perspective, generated_at, disclaimer, demand_letter, recoverable_cents, pending_review_cents, content_hash, created_at)
     SELECT $1, c.tenant_id, c.id, 1, $3::"PacketStatus", c.perspective, $4, 'd', 'l', c.recoverable_cents, 0, $5, $4 FROM claims c WHERE c.id = $2`,
    [id, ids[claimKey], status, created, HEX],
  );
  for (const [i, [rule, title]] of findings.entries()) {
    await admin.query(
      `INSERT INTO packet_findings (id, tenant_id, packet_id, ordinal, rule_id, title, direction, amount_cents, explanation, calculation, confidence, needs_human_review, citations)
       SELECT $1, p.tenant_id, p.id, $3, $4, $5, 'OVERCHARGE', 100, 'e', '{}', 0.9, false, '[]' FROM evidence_packets p WHERE p.id = $2`,
      [randomUUID(), id, i, rule, title],
    );
  }
  return id;
}

async function sendReady(claimKey: string, packetId: string, at: string): Promise<void> {
  await admin.query(
    `INSERT INTO approvals (id, tenant_id, claim_id, packet_id, packet_revision, action, reason, from_status, to_status, content_hash, actor_id, actor_role, created_at)
     SELECT $1, c.tenant_id, c.id, $3, 1, 'SEND_READY', 'fixture decision', 'APPROVED', 'SEND_READY', $4, $5, 'OWNER', $6 FROM claims c WHERE c.id = $2`,
    [randomUUID(), ids[claimKey], packetId, HEX, ownerId, at],
  );
}

describe.skipIf(!canRunDb)('claim outcomes (PostgreSQL)', () => {
  let app: FastifyInstance;
  let c: Client;
  const tok: Record<string, string> = {};
  const outcomeBody = (over: Record<string, unknown> = {}) => ({ kind: 'OUTCOME', channel: 'EMAIL', carrierResponse: 'ACCEPTED', ...over });
  const post = (key: string, role: string, body: unknown) => c.send('POST', `/api/v1/claims/${ids[key] ?? key}/outcomes`, tok[role], body);
  const get = (key: string, role: string) => c.get(`/api/v1/claims/${ids[key] ?? key}/outcomes`, tok[role]);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    appDb = new pg.Client({ connectionString: appUrl });
    await admin.connect();
    await appDb.connect();
    const t = await admin.query<{ id: string; slug: string }>(`SELECT id, slug FROM tenants WHERE slug IN ('acme', 'globex')`);
    acme = t.rows.find((r) => r.slug === 'acme')?.id ?? '';
    globex = t.rows.find((r) => r.slug === 'globex')?.id ?? '';
    ownerId = (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = 'owner@acme.test'`)).rows[0]?.id ?? '';
    // S1: the permission-matrix claim; S2: the recovery claim; P1 analysed; A1 awaiting; G1 another tenant's.
    await claim('S1', acme, 'SEND_READY', 1000);
    await claim('S2', acme, 'SEND_READY', 50000);
    await claim('P1', acme, 'PENDING_REVIEW', 700);
    await claim('A1', acme, 'AWAITING_ANALYSIS', 0);
    await claim('G1', globex, 'SEND_READY', 900);
    const p1 = await packet('S1', 'SEND_READY', '2026-06-02T00:00:00Z', [['R_A', 'Layover']]);
    await sendReady('S1', p1, '2026-06-02T10:00:00Z');
    const p2 = await packet('S2', 'SEND_READY', '2026-06-03T00:00:00Z', [['R_X', 'Detention'], ['R_X', 'Detention day 2']]);
    await sendReady('S2', p2, '2026-06-03T03:00:00Z');
    await packet('P1', 'PENDING_REVIEW', '2026-06-04T00:00:00Z', [['R_A', 'Layover']]);
    app = await buildApp(step4Env(), { logStream: quiet() });
    await app.ready();
    c = await new Client(app).init();
    for (const k of ['owner', 'admin', 'manager', 'reviewer', 'analyst', 'viewer'] as const) tok[k] = await c.login(`${k}@acme.test`);
    tok['dev'] = await c.login('dev@platform.test');
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    const all = Object.values(ids);
    await admin.query('BEGIN');
    await admin.query('SET LOCAL session_replication_role = replica');
    await admin.query(`DELETE FROM claim_outcomes WHERE claim_id = ANY($1::uuid[])`, [all]);
    await admin.query(`DELETE FROM approvals WHERE claim_id = ANY($1::uuid[])`, [all]);
    await admin.query(`DELETE FROM packet_findings WHERE packet_id IN (SELECT id FROM evidence_packets WHERE claim_id = ANY($1::uuid[]))`, [all]);
    await admin.query(`DELETE FROM evidence_packets WHERE claim_id = ANY($1::uuid[])`, [all]);
    await admin.query(`DELETE FROM claims WHERE id = ANY($1::uuid[])`, [all]);
    await admin.query(`DELETE FROM api_keys WHERE name = $1`, [`${marker} key`]);
    await admin.query('COMMIT');
    await appDb.end();
    await admin.end();
  });

  describe('database', () => {
    it('RLS is enabled and forced with the tenant policy; freight_app holds SELECT and INSERT only', async () => {
      const rel = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'claim_outcomes'`);
      expect(rel.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const pol = await admin.query<{ policyname: string; cmd: string }>(`SELECT policyname, cmd FROM pg_policies WHERE tablename = 'claim_outcomes'`);
      expect(pol.rows).toEqual([{ policyname: 'claim_outcomes_tenant_isolation', cmd: 'ALL' }]);
      const grants = await admin.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee = 'freight_app' AND table_name = 'claim_outcomes' ORDER BY 1`,
      );
      expect(grants.rows.map((g) => g.privilege_type)).toEqual(['INSERT', 'SELECT']);
    });

    it('guard trigger and CHECKs: wrong claim state, another tenant or an inconsistent AUDITED_NO_FINDING row are refused', async () => {
      const ins = (kind: string, claimKey: string, tenant: string, extra = '') =>
        raise(
          `INSERT INTO claim_outcomes (id, tenant_id, claim_id, kind, recorded_by_id, channel, carrier_response${extra ? ', credited_cents' : ''})
           VALUES ($1, $2, $3, $4, $5, 'OTHER', 'NONE_YET'${extra})`,
          [randomUUID(), tenant, ids[claimKey], kind, ownerId],
        );
      expect(await ins('OUTCOME', 'P1', acme)).toBe('claim_outcome_state_invalid');
      expect(await ins('OUTCOME', 'A1', acme)).toBe('claim_outcome_state_invalid');
      expect(await ins('AUDITED_NO_FINDING', 'A1', acme)).toBe('claim_outcome_state_invalid');
      expect(await ins('OUTCOME', 'G1', acme)).toBe('claim_outcome_claim_invalid');
      expect(await ins('AUDITED_NO_FINDING', 'P1', acme, ', 1')).toMatch(/^other: .*claim_outcomes_kind_consistent/u);
      expect(await raise(`INSERT INTO claim_outcomes (id, tenant_id, claim_id, recorded_by_id, channel, carrier_response) VALUES ($1, $2, $3, $4, 'FAX', 'NONE_YET')`, [randomUUID(), acme, ids['S1'], ownerId])).toMatch(/claim_outcomes_channel_valid/u);
    });

    it('append-only for every role; cross-tenant reads and writes refused as freight_app', async () => {
      const id = randomUUID();
      await admin.query(
        `INSERT INTO claim_outcomes (id, tenant_id, claim_id, recorded_by_id, channel, carrier_response, credited_cents) VALUES ($1, $2, $3, $4, 'MAIL', 'PARTIAL', 10)`,
        [id, globex, ids['G1'], ownerId],
      );
      expect(await raise(`UPDATE claim_outcomes SET note = 'x' WHERE id = $1`, [id])).toBe('append_only');
      expect(await raise(`DELETE FROM claim_outcomes WHERE id = $1`, [id])).toBe('append_only');
      expect(await raise(`TRUNCATE claim_outcomes`)).toBe('append_only');
      expect((await asApp(null, (q) => q.query(`SELECT id FROM claim_outcomes WHERE id = $1`, [id]))).rowCount).toBe(0);
      expect((await asApp(acme, (q) => q.query(`SELECT id FROM claim_outcomes WHERE id = $1`, [id]))).rowCount).toBe(0);
      expect((await asApp(globex, (q) => q.query(`SELECT id FROM claim_outcomes WHERE id = $1`, [id]))).rowCount).toBe(1);
      await expect(asApp(globex, (q) => q.query(`UPDATE claim_outcomes SET note = 'x' WHERE id = $1`, [id]))).rejects.toThrow(/permission denied/u);
      await expect(asApp(globex, (q) => q.query(`DELETE FROM claim_outcomes WHERE id = $1`, [id]))).rejects.toThrow(/permission denied/u);
      await expect(
        asApp(acme, (q) =>
          q.query(`INSERT INTO claim_outcomes (id, tenant_id, claim_id, recorded_by_id, channel, carrier_response) VALUES ($1, $2, $3, $4, 'OTHER', 'NONE_YET')`, [randomUUID(), globex, ids['G1'], ownerId]),
        ),
      ).rejects.toThrow(/row-level security/u);
    });
  });

  describe('routes', () => {
    it('permission matrix: OWNER, ADMIN, MANAGER, REVIEWER record (201); ANALYST, VIEWER, platform 403; anonymous 401', async () => {
      const bodies: Record<string, Record<string, unknown>> = {
        owner: outcomeBody({ creditedCents: 1000, note: 'Credit note CN-1', sentAt: '2026-06-02T12:00:00Z' }),
        admin: outcomeBody({ carrierResponse: 'PARTIAL', creditedCents: 500, paidCents: 500 }),
        manager: outcomeBody({ carrierResponse: 'NONE_YET', channel: 'PORTAL' }),
        reviewer: outcomeBody({ carrierResponse: 'REJECTED', channel: 'PHONE' }),
      };
      for (const role of ['owner', 'admin', 'manager', 'reviewer']) {
        const r = await post('S1', role, bodies[role]);
        expect([role, r.statusCode], r.body).toEqual([role, 201]);
        const v = ClaimOutcomeView.parse(r.json());
        expect([v.claimId, v.kind, v.version]).toEqual([ids['S1'], 'OUTCOME', 1]);
      }
      for (const role of ['analyst', 'viewer', 'dev']) expect([role, (await post('S1', role, outcomeBody())).statusCode]).toEqual([role, 403]);
      expect((await c.send('POST', `/api/v1/claims/${ids['S1']}/outcomes`, undefined, outcomeBody())).statusCode).toBe(401);
      expect((await get('S1', 'dev')).statusCode).toBe(403);
      expect((await c.get(`/api/v1/claims/${ids['S1']}/outcomes`)).statusCode).toBe(401);
    });

    it('Origin and CSRF checks apply; API keys are refused on both routes', async () => {
      const url = `/api/v1/claims/${ids['S1']}/outcomes`;
      const noCsrf = await app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${tok['owner']}` }, payload: outcomeBody() });
      expect([noCsrf.statusCode, errorOf(noCsrf).code]).toEqual([403, 'csrf_failed']);
      const badOrigin = await app.inject({ method: 'POST', url, headers: { ...c.headers(tok['owner']), origin: 'https://evil.example' }, payload: outcomeBody() });
      expect([badOrigin.statusCode, errorOf(badOrigin).code]).toEqual([403, 'origin_not_allowed']);
      const keyId = randomBytes(8).toString('hex');
      const secret = randomBytes(32).toString('base64url');
      await admin.query(
        `INSERT INTO api_keys (id, tenant_id, key_id, name, secret_hash, scopes, created_by_id, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '1 day')`,
        [randomUUID(), acme, keyId, `${marker} key`, createHmac('sha256', STEP4_TEST_API_KEY_PEPPER).update(secret).digest('hex'), ['claims.read'], ownerId],
      );
      const auth = { authorization: `Bearer fr_live_${keyId}_${secret}` };
      expect((await app.inject({ method: 'GET', url, headers: auth })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url, headers: auth, payload: outcomeBody() })).statusCode).toBe(403);
    });

    it('strict bodies (400), state rule (409 invalid_state), AUDITED_NO_FINDING on an analysed claim (201)', async () => {
      for (const bad of [{}, outcomeBody({ tenantId: acme }), outcomeBody({ creditedCents: -1 }), outcomeBody({ channel: 'FAX' }), outcomeBody({ note: 'a'.repeat(501) }), { kind: 'AUDITED_NO_FINDING', creditedCents: 1 }]) {
        const r = await post('S1', 'owner', bad);
        expect([r.statusCode, errorOf(r).code], JSON.stringify(bad)).toEqual([400, 'validation_error']);
      }
      for (const key of ['P1', 'A1']) {
        const r = await post(key, 'owner', outcomeBody());
        expect([key, r.statusCode, errorOf(r).code]).toEqual([key, 409, 'invalid_state']);
      }
      const awaiting = await post('A1', 'owner', { kind: 'AUDITED_NO_FINDING' });
      expect([awaiting.statusCode, errorOf(awaiting).code]).toEqual([409, 'invalid_state']);
      const r = await post('P1', 'reviewer', { kind: 'AUDITED_NO_FINDING', note: 'Checked, nothing found' });
      expect(r.statusCode, r.body).toBe(201);
      const v = ClaimOutcomeView.parse(r.json());
      expect([v.kind, v.channel, v.carrierResponse, v.creditedCents, v.paidCents, v.sentAt, v.note]).toEqual(['AUDITED_NO_FINDING', 'OTHER', 'NONE_YET', null, null, null, 'Checked, nothing found']);
    });

    it("another tenant's claim, an unknown id and a malformed id answer byte-identical 404s on GET and POST", async () => {
      const strip = (r: Inject) => {
        const b = r.json() as { error: Record<string, unknown> };
        delete b.error['requestId'];
        return [r.statusCode, JSON.stringify(b)];
      };
      const targets = [ids['G1'] ?? '', randomUUID(), 'not-a-uuid'];
      const gets = await Promise.all(targets.map((t) => get(t, 'owner')));
      const posts = await Promise.all(targets.map((t) => post(t, 'owner', outcomeBody())));
      for (const r of [...gets, ...posts]) expect(strip(r)).toEqual([404, JSON.stringify({ error: { code: 'not_found', message: 'Not found.' } })]);
      expect((await admin.query(`SELECT count(*)::int AS n FROM claim_outcomes WHERE claim_id = $1 AND tenant_id = $2`, [ids['G1'], acme])).rows[0]).toEqual({ n: 0 });
    });

    it('list: newest first, recorded-by name, VIEWER may read; audit event carries cents and response but never the note', async () => {
      const r = await get('S1', 'viewer');
      expect(r.statusCode).toBe(200);
      const list = ClaimOutcomeList.parse(r.json());
      expect(list.claimId).toBe(ids['S1']);
      expect(list.items.map((o) => o.carrierResponse)).toEqual(['REJECTED', 'NONE_YET', 'PARTIAL', 'ACCEPTED']);
      expect(list.items[3]).toMatchObject({ creditedCents: 1000, paidCents: null, note: 'Credit note CN-1', sentAt: '2026-06-02T12:00:00.000Z', recordedBy: { name: 'Avery Owner' } });
      const stamps = list.items.map((o) => o.recordedAt);
      expect([...stamps].sort().reverse()).toEqual(stamps);
      const events = await admin.query<{ metadata: Record<string, unknown>; actor_role: string }>(
        `SELECT metadata, actor_role FROM audit_events WHERE action = 'claim.outcome_recorded' AND target_id = $1 ORDER BY seq`,
        [ids['S1']],
      );
      expect(events.rows).toHaveLength(4);
      const first = events.rows[0];
      expect(first?.actor_role).toBe('OWNER');
      expect(first?.metadata).toMatchObject({ claimId: ids['S1'], kind: 'OUTCOME', channel: 'EMAIL', carrierResponse: 'ACCEPTED', creditedCents: 1000, paidCents: null, sentAt: '2026-06-02T12:00:00.000Z' });
      expect(first?.metadata['outcomeId']).toBe(list.items[3]?.id);
      expect(JSON.stringify(events.rows)).not.toContain('CN-1');
    });
  });

  describe('insights recovery', () => {
    it('hand-computed values from the recorded outcomes; kind filter zeroes everything; other tenants excluded', async () => {
      // S2: a first NONE_YET row, then the one that counts (ACCEPTED, 400.00 credited and paid).
      expect((await post('S2', 'manager', outcomeBody({ carrierResponse: 'NONE_YET', sentAt: '2026-06-03T12:00:00Z' }))).statusCode).toBe(201);
      expect((await post('S2', 'manager', outcomeBody({ creditedCents: 40000, paidCents: 40000, closedAt: '2026-06-20T00:00:00Z' }))).statusCode).toBe(201);
      const q = `from=${day(Date.now() - DAY_MS)}&to=${day(Date.now() + 2 * DAY_MS)}`;
      const r = await c.get(`/api/v1/insights/recovery?${q}`, tok['viewer']);
      expect(r.statusCode, r.body).toBe(200);
      const d = InsightsRecovery.parse(r.json());
      expect(d.basis).toBe('human_entered');
      expect(d.sent).toEqual({ claimCount: 2, identifiedCents: 51000 });
      expect(d.responses).toEqual({
        noneYet: { claimCount: 0, identifiedCents: 0 },
        accepted: { claimCount: 1, identifiedCents: 50000 },
        partial: { claimCount: 0, identifiedCents: 0 },
        rejected: { claimCount: 1, identifiedCents: 1000 },
        disputed: { claimCount: 0, identifiedCents: 0 },
        withdrawn: { claimCount: 0, identifiedCents: 0 },
      });
      expect(d.credited).toEqual({ claimCount: 1, cents: 40000 });
      expect(d.paid).toEqual({ claimCount: 1, cents: 40000 });
      expect(d.recoveryRate).toEqual({ claimCount: 2, creditedCents: 40000, identifiedCents: 51000, rateBasisPoints: 7843 });
      // S1 spans 10 h (capped at 8), S2 3 h: 11 h; 400.00 / 11 h = 36.36 per hour.
      expect(d.reviewerHours).toMatchObject({ claimCount: 2, hours: 11, capHoursPerClaim: 8, creditedPerHourCents: 3636 });
      expect(d.reviewerHours.approximation).toContain('approximated from approval timestamps');
      expect(d.byRule).toEqual([
        { ruleId: 'R_X', title: 'Detention', mixed: false, claimCount: 1, findingsSent: 2, findingsAccepted: 2, findingsPartial: 0, findingsRejected: 0, identifiedCents: 50000, creditedCents: 40000, rateBasisPoints: 8000 },
        { ruleId: 'R_A', title: 'Layover', mixed: false, claimCount: 1, findingsSent: 1, findingsAccepted: 0, findingsPartial: 0, findingsRejected: 1, identifiedCents: 1000, creditedCents: 0, rateBasisPoints: 0 },
      ]);
      expect(d.auditedNoFinding).toEqual({ claimCount: 1 });
      expect(/\b(recovered|saved|won)\b/iu.test(JSON.stringify(d))).toBe(false);
      const dd = InsightsRecovery.parse((await c.get(`/api/v1/insights/recovery?${q}&kind=OCEAN_DD`, tok['viewer'])).json());
      expect([dd.sent.claimCount, dd.credited.cents, dd.byRule, dd.auditedNoFinding.claimCount, dd.reviewerHours.claimCount]).toEqual([0, 0, [], 0, 0]);
      expect((await c.get(`/api/v1/insights/recovery?${q}`, tok['reviewer'])).statusCode).toBe(403);
      expect((await c.get(`/api/v1/insights/recovery?${q}&tenantId=${globex}`, tok['viewer'])).statusCode).toBe(400);
    });
  });
});