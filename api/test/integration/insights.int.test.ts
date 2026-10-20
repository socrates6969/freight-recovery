/**
 * Integration (real PostgreSQL, migrated + seeded): executive insights (REQ-20261018-exec-dashboard).
 * - a private owner-inserted fixture tenant with hand-computed expected values for every metric family
 *   (M1-M7, S1-S4, D1-D2, L1-L3, T1-T5), filters, current-packet-only findings and the read-only snapshot;
 * - routes on the seed tenant: permission matrix (VIEWER 200, REVIEWER/ANALYST/platform 403, anonymous 401),
 *   strict queries (unknown keys 400), API keys refused, no audit row written by a 200 read.
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { InsightsDeadlines, InsightsLeakage, InsightsStages, InsightsSummary, InsightsThroughput } from '@fr/shared';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { analysisFailureCounts } from '../../src/audit/analysis-failures.js';
import { appendAudit } from '../../src/audit/audit.js';
import { createDb, type BaseClient } from '../../src/db/client.js';
import { insightsRead } from '../../src/db/insights.js';
import { tenantDb } from '../../src/db/tenant.js';

import { Client, STEP4_TEST_API_KEY_PEPPER, adminUrl, appUrl, canRunDb, step4Env } from './step4-helpers.js';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const HEX = 'b'.repeat(64);
const Q = 'from=2026-06-01&to=2026-06-16';
const quiet = () => new Writable({ write: (_c, _e, cb) => cb() });

let admin: pg.Client;
let base: BaseClient;
let tenantId = '';
let userId = '';
const slug = `insights-builder-${Date.now().toString(36)}`;
const ids: Record<string, string> = {};
const packets: Record<string, string> = {};

interface Finding {
  rule: string;
  title: string;
  dir: 'OVERCHARGE' | 'UNDERBILLED';
  cents: number;
  review: boolean;
}

async function claim(key: string, o: { status: string; kind?: string; perspective?: string; carrier: string; rec: number; pend?: number; created: string; invoice?: string | null }) {
  const id = randomUUID();
  ids[key] = id;
  await admin.query(
    `INSERT INTO claims (id, tenant_id, claim_number, kind, carrier_name, shipper_name, perspective, status, amount_claimed_cents, recoverable_cents,
       pending_review_cents, invoice_date, created_at, updated_at)
     VALUES ($1, $2, $3, $4::"ClaimKind", $5, 'Shipper', $6::"Perspective", $7::"ClaimStatus", $8, $9, $10, $11, $12, $12)`,
    [id, tenantId, `IN-${key}-${id.slice(0, 6)}`, o.kind ?? 'FREIGHT', o.carrier, o.perspective ?? 'SHIPPER', o.status, o.rec + (o.pend ?? 0), o.rec, o.pend ?? 0, o.invoice ?? null, o.created],
  );
}

async function packet(key: string, claimKey: string, revision: number, status: string, created: string, findings: Finding[]) {
  const id = randomUUID();
  packets[key] = id;
  const c = await admin.query<{ perspective: string; recoverable_cents: number; pending_review_cents: number }>(
    `SELECT perspective::text, recoverable_cents, pending_review_cents FROM claims WHERE id = $1`,
    [ids[claimKey]],
  );
  const row = c.rows[0];
  await admin.query(
    `INSERT INTO evidence_packets (id, tenant_id, claim_id, revision, status, perspective, generated_at, disclaimer, demand_letter, recoverable_cents,
       pending_review_cents, content_hash, created_at)
     VALUES ($1, $2, $3, $4, $5::"PacketStatus", $6::"Perspective", $7, 'd', 'l', $8, $9, $10, $7)`,
    [id, tenantId, ids[claimKey], revision, status, row?.perspective, created, row?.recoverable_cents ?? 0, row?.pending_review_cents ?? 0, HEX],
  );
  for (const [i, f] of findings.entries()) {
    await admin.query(
      `INSERT INTO packet_findings (id, tenant_id, packet_id, ordinal, rule_id, title, direction, amount_cents, explanation, calculation, confidence,
         needs_human_review, citations)
       VALUES ($1, $2, $3, $4, $5, $6, $7::"Direction", $8, 'e', '{}', 0.9, $9, '[]')`,
      [randomUUID(), tenantId, id, i, f.rule, f.title, f.dir, f.cents, f.review],
    );
  }
}

async function approval(claimKey: string, packetKey: string, revision: number, action: string, toStatus: string, at: string) {
  await admin.query(
    `INSERT INTO approvals (id, tenant_id, claim_id, packet_id, packet_revision, action, reason, from_status, to_status, content_hash, actor_id, actor_role, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::"ApprovalAction", 'fixture decision', 'PENDING_REVIEW', $7, $8, $9, 'OWNER', $10)`,
    [randomUUID(), tenantId, ids[claimKey], packets[packetKey], revision, action, toStatus, HEX, userId, at],
  );
}

const F = (rule: string, title: string, dir: Finding['dir'], cents: number, review = false): Finding => ({ rule, title, dir, cents, review });

describe.skipIf(!canRunDb)('executive insights (PostgreSQL)', () => {
  let app: FastifyInstance;
  let c: Client;
  let viewerToken = '';
  let viewerId = '';

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    base = createDb(appUrl ?? '');
    tenantId = randomUUID();
    userId = randomUUID();
    viewerId = randomUUID();
    const seedHash = (await admin.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE email = 'viewer@acme.test'`)).rows[0]?.password_hash ?? '';
    await admin.query('BEGIN');
    await admin.query(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'Insights Builder Fixture', $2)`, [tenantId, slug]);
    await admin.query(`INSERT INTO users (id, email, name, password_hash, updated_at) VALUES ($1, $2, 'Fixture Owner', 'x', now())`, [userId, `${slug}-owner@fixture.test`]);
    await admin.query(`INSERT INTO users (id, email, name, password_hash, updated_at) VALUES ($1, $2, 'Fixture Viewer', $3, now())`, [viewerId, `${slug}-viewer@fixture.test`, seedHash]);
    await admin.query(`INSERT INTO memberships (id, tenant_id, user_id, role, updated_at) VALUES ($1, $2, $3, 'OWNER', now())`, [randomUUID(), tenantId, userId]);
    await admin.query(`INSERT INTO memberships (id, tenant_id, user_id, role, updated_at) VALUES ($1, $2, $3, 'VIEWER', now())`, [randomUUID(), tenantId, viewerId]);
    await admin.query('COMMIT');

    await claim('C1', { status: 'PENDING_REVIEW', carrier: 'Acme Freight', rec: 1000, pend: 200, created: '2026-06-02T00:00:00Z', invoice: '2026-04-01T00:00:00Z' });
    await packet('P1', 'C1', 1, 'PENDING_REVIEW', '2026-06-02T00:00:00Z', [F('R_A', 'Detention v1', 'OVERCHARGE', 1000), F('R_B', 'Layover', 'OVERCHARGE', 200, true)]);

    await claim('C2', { status: 'APPROVED', carrier: ' acme freight ', rec: 500, created: '2026-06-03T00:00:00Z', invoice: null });
    await packet('P2a', 'C2', 1, 'SUPERSEDED', '2026-06-03T00:00:00Z', [F('OLD_RULE', 'Old', 'OVERCHARGE', 999)]);
    await packet('P2b', 'C2', 2, 'APPROVED', '2026-06-04T00:00:00Z', [F('R_A', 'Detention v2', 'OVERCHARGE', 500)]);
    await approval('C2', 'P2a', 1, 'EDIT', 'SUPERSEDED', '2026-06-04T00:00:00Z');
    await approval('C2', 'P2b', 2, 'APPROVE', 'APPROVED', '2026-06-05T00:00:00Z');

    await claim('C3', { status: 'SEND_READY', carrier: 'Beta Lines', rec: 800, created: '2026-06-04T00:00:00Z', invoice: '2026-06-01T00:00:00Z' });
    await packet('P3', 'C3', 1, 'SEND_READY', '2026-06-04T00:00:00Z', [F('R_C', 'Fuel', 'UNDERBILLED', 800)]);
    await approval('C3', 'P3', 1, 'APPROVE', 'APPROVED', '2026-06-04T06:00:00Z');
    await approval('C3', 'P3', 1, 'SEND_READY', 'SEND_READY', '2026-06-06T06:00:00Z');

    await claim('C4', { status: 'REJECTED', carrier: 'Beta Lines', rec: 300, created: '2026-06-05T00:00:00Z' });
    await packet('P4', 'C4', 1, 'REJECTED', '2026-06-05T00:00:00Z', [F('R_C', 'Fuel', 'UNDERBILLED', 300)]);
    await approval('C4', 'P4', 1, 'REJECT', 'REJECTED', '2026-06-05T12:00:00Z');

    await claim('C5', { status: 'AWAITING_ANALYSIS', carrier: 'Gamma', rec: 0, created: '2026-06-14T00:00:00Z', invoice: '2026-06-10T00:00:00Z' });

    await claim('C6', { status: 'PENDING_REVIEW', kind: 'OCEAN_DD', carrier: 'Ocean Term', rec: 2000, created: '2026-06-10T00:00:00Z', invoice: '2026-05-20T00:00:00Z' });
    await packet('P6', 'C6', 1, 'PENDING_REVIEW', '2026-06-10T00:00:00Z', [F('R_DD', 'Free time', 'OVERCHARGE', 2000)]);
    const dd = randomUUID();
    await admin.query(
      `INSERT INTO dd_invoices (id, tenant_id, status, invoice_number, billing_party_name, invoice_date, total_due_cents, data, created_by_id, updated_by_id, updated_at)
       VALUES ($1, $2, 'DRAFT', 'INV-1', 'Ocean Term', '2026-05-20', 10000, '{}', $3, $3, now())`,
      [dd, tenantId, userId],
    );
    await admin.query(`UPDATE dd_invoices SET status = 'AUDITED', claim_id = $2, audited_at = now(), audit_snapshot = '{}' WHERE id = $1`, [dd, ids['C6']]);

    await claim('C7', { status: 'PENDING_REVIEW', perspective: 'CARRIER', carrier: 'Acme Freight', rec: 100, created: '2026-05-01T00:00:00Z', invoice: '2026-01-01T00:00:00Z' });
    await packet('P7', 'C7', 1, 'PENDING_REVIEW', '2026-05-01T00:00:00Z', [F('R_A', 'Detention old', 'OVERCHARGE', 100)]);

    // S4 events through the real chain append (created_at = the real clock).
    await tenantDb(base, tenantId).tx(async (tx) => {
      for (const [k, reasonCode] of [['C5', 'input_values'], ['C5', 'not-a-reason'], ['C7', 'fuel_check']] as const) {
        await appendAudit(tx, { tenantId, action: 'claim.analysis_failed', actorId: userId, actorRole: 'OWNER', targetType: 'claim', targetId: ids[k] ?? null, metadata: { reasonCode } });
      }
    });

    app = await buildApp(step4Env(), { logStream: quiet(), overrides: { now: () => NOW } });
    await app.ready();
    c = await new Client(app).init();
    viewerToken = await c.login(`${slug}-viewer@fixture.test`);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await base?.$disconnect();
    if (!admin) return;
    await admin.query('BEGIN');
    await admin.query('SET LOCAL session_replication_role = replica');
    for (const t of ['dd_invoices', 'approvals', 'packet_findings', 'evidence_packets', 'claims', 'audit_events', 'memberships']) {
      await admin.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenantId]);
    }
    await admin.query(`DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])`, [[userId, viewerId]]);
    await admin.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[userId, viewerId]]);
    await admin.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await admin.query('COMMIT');
    await admin.end();
  });

  const get = async (path: string) => {
    const r = await c.get(`/api/v1/insights/${path}`, viewerToken);
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as unknown;
  };

  it('summary: M1-M7, S1 and T4 equal the hand-computed fixture values (tenant data only)', async () => {
    const s = InsightsSummary.parse(await get(`summary?${Q}`));
    expect(s.meta).toEqual({ asOf: NOW.toISOString(), period: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-16T00:00:00.000Z' }, filters: { kind: null, perspective: null } });
    expect(s.money).toEqual({
      identifiedOpenCents: 3600,
      pendingReviewOpenCents: 200,
      approvedNotSendReadyCents: 500,
      readyToDemand: { claimCount: 1, cents: 800 },
      identifiedInPeriod: { claimCount: 5, cents: 4600 },
      rejectedInPeriod: { claimCount: 1, cents: 300 },
      ddShare: { auditedInvoiceCount: 1, excludedInvoiceCount: 0, identifiedCents: 2000, totalDueCents: 10000, shareBasisPoints: 2000, omittedReason: null },
    });
    expect(s.stages).toEqual([
      { status: 'AWAITING_ANALYSIS', claimCount: 1, cents: 0 },
      { status: 'PENDING_REVIEW', claimCount: 3, cents: 3100 },
      { status: 'APPROVED', claimCount: 1, cents: 500 },
      { status: 'SEND_READY', claimCount: 1, cents: 800 },
      { status: 'REJECTED', claimCount: 1, cents: 300 },
    ]);
    expect(s.reviewQueue).toEqual({ claimCount: 3, identifiedCents: 3100, waitingOverThresholdCount: 2, thresholdDays: 7 });
    expect(/recovered|saved|\bwon\b/iu.test(JSON.stringify(s))).toBe(false);

    const carrier = InsightsSummary.parse(await get(`summary?${Q}&perspective=CARRIER`));
    expect(carrier.money).toMatchObject({ identifiedOpenCents: 100, pendingReviewOpenCents: 0, approvedNotSendReadyCents: 0, identifiedInPeriod: { claimCount: 0, cents: 0 } });
    expect(carrier.money.ddShare).toMatchObject({ auditedInvoiceCount: 0, omittedReason: 'zero_total', shareBasisPoints: null });
    expect(carrier.meta.filters).toEqual({ kind: null, perspective: 'CARRIER' });
  });

  it('stages: S2 entry times per status, S3 whole-tenant intake, S4 null without a period', async () => {
    const st = InsightsStages.parse(await get(`stages?${Q}`));
    expect(st.ageing).toEqual([
      { status: 'AWAITING_ANALYSIS', buckets: { d0to7: 1, d8to30: 0, d31to60: 0, over60: 0 } },
      { status: 'PENDING_REVIEW', buckets: { d0to7: 1, d8to30: 1, d31to60: 1, over60: 0 } },
      { status: 'APPROVED', buckets: { d0to7: 0, d8to30: 1, d31to60: 0, over60: 0 } },
    ]);
    expect(st.intake).toEqual({
      scope: 'all_documents',
      inPeriod: ['RECEIVED', 'NEEDS_REVIEW', 'ACCEPTED', 'REJECTED', 'FAILED'].map((status) => ({ status, count: 0 })),
      needsReviewNow: 0,
    });
    expect(st.analysisFailures).toEqual({ total: 0, byReason: [{ reasonCode: 'input_values', count: 0 }, { reasonCode: 'amount_out_of_range', count: 0 }, { reasonCode: 'fuel_check', count: 0 }] });
    const none = InsightsStages.parse(await get('stages'));
    expect(none.meta.period).toBeNull();
    expect(none.intake.inPeriod).toBeNull();
    expect(none.analysisFailures).toBeNull();
    expect((await c.get('/api/v1/insights/stages?from=2026-06-01', viewerToken)).statusCode).toBe(400);
  });

  it('S4: analysis failures from the tenant chain; unknown reasons count as input_values; filters apply through the claim', async () => {
    const real = Date.now();
    const period = { from: new Date(real - 86_400_000), to: new Date(real + 86_400_000) };
    const db = tenantDb(base, tenantId);
    const all = await insightsRead(db, (tx) => analysisFailureCounts(tx, period, { kind: null, perspective: null }));
    expect(all).toEqual({ total: 3, byReason: [{ reasonCode: 'input_values', count: 2 }, { reasonCode: 'amount_out_of_range', count: 0 }, { reasonCode: 'fuel_check', count: 1 }] });
    const shipper = await insightsRead(db, (tx) => analysisFailureCounts(tx, period, { kind: null, perspective: 'SHIPPER' }));
    expect(shipper.total).toBe(2);
    const dd = await insightsRead(db, (tx) => analysisFailureCounts(tx, period, { kind: 'OCEAN_DD', perspective: null }));
    expect(dd.total).toBe(0);
  });

  it('deadlines: D1 calendar days to the 30-day minimum window, D2 invoice age, kind filter zeroes the other block', async () => {
    const d = InsightsDeadlines.parse(await get('deadlines'));
    expect(d.meta.period).toBeNull();
    const z = { claimCount: 0, cents: 0 };
    expect(d.ddMitigationWindow).toMatchObject({ regulation: '46 CFR 541.8(a)', minimumDays: 30, past: z, d0to7: { claimCount: 1, cents: 2000 }, d8to14: z, over14: z, dateMissing: z });
    expect(d.freightInvoiceAge).toMatchObject({ d0to30: { claimCount: 1, cents: 0 }, d31to60: z, d61to90: { claimCount: 1, cents: 1000 }, over90: { claimCount: 1, cents: 100 }, dateMissing: { claimCount: 1, cents: 500 } });
    const dd = InsightsDeadlines.parse(await get('deadlines?kind=OCEAN_DD'));
    expect([dd.freightInvoiceAge.d0to30, dd.freightInvoiceAge.d61to90, dd.freightInvoiceAge.over90, dd.freightInvoiceAge.dateMissing]).toEqual([z, z, z, z]);
    expect(dd.ddMitigationWindow.d0to7).toEqual({ claimCount: 1, cents: 2000 });
  });

  it('leakage by billing party: case/space-insensitive keys, ranking, display names, remainder identity', async () => {
    const l = InsightsLeakage.parse(await get(`leakage?${Q}&by=carrier&limit=2`));
    if (l.by !== 'carrier') throw new Error('by');
    expect(l.total).toEqual({ claimCount: 6, identifiedCents: 4600, pendingReviewCents: 200 });
    expect(l.rows).toEqual([
      { carrierKey: 'ocean term', displayName: 'Ocean Term', claimCount: 1, identifiedCents: 2000, pendingReviewCents: 0, shareBasisPoints: 4166 },
      { carrierKey: 'acme freight', displayName: 'Acme Freight', claimCount: 2, identifiedCents: 1500, pendingReviewCents: 200, shareBasisPoints: 3541 },
    ]);
    expect(l.other).toEqual({ carrierCount: 2, claimCount: 3, identifiedCents: 1100, pendingReviewCents: 0, shareBasisPoints: 2291 });
    const all = InsightsLeakage.parse(await get(`leakage?${Q}&by=carrier`));
    if (all.by !== 'carrier') throw new Error('by');
    expect(all.limit).toBe(10);
    expect(all.rows.map((r) => r.carrierKey)).toEqual(['ocean term', 'acme freight', 'beta lines', 'gamma']);
    expect(all.other).toEqual({ carrierCount: 0, claimCount: 0, identifiedCents: 0, pendingReviewCents: 0, shareBasisPoints: 0 });
    expect((await c.get(`/api/v1/insights/leakage?${Q}&by=carrier&carrier=Acme`, viewerToken)).statusCode).toBe(400);
  });

  it('leakage by finding type: current packet only, L3 by key, unknown or foreign carrier gives no rows', async () => {
    const l2 = InsightsLeakage.parse(await get(`leakage?${Q}&by=rule`));
    if (l2.by !== 'rule') throw new Error('by');
    expect(l2.carrier).toBeNull();
    expect(l2.rows).toEqual([
      { ruleId: 'R_DD', title: 'Free time', findingCount: 1, overcharge: { identifiedCents: 2000, pendingReviewCents: 0 }, underbilled: { identifiedCents: 0, pendingReviewCents: 0 } },
      { ruleId: 'R_A', title: 'Detention v2', findingCount: 2, overcharge: { identifiedCents: 1500, pendingReviewCents: 0 }, underbilled: { identifiedCents: 0, pendingReviewCents: 0 } },
      { ruleId: 'R_C', title: 'Fuel', findingCount: 2, overcharge: { identifiedCents: 0, pendingReviewCents: 0 }, underbilled: { identifiedCents: 1100, pendingReviewCents: 0 } },
      { ruleId: 'R_B', title: 'Layover', findingCount: 1, overcharge: { identifiedCents: 0, pendingReviewCents: 200 }, underbilled: { identifiedCents: 0, pendingReviewCents: 0 } },
    ]);
    const l3 = InsightsLeakage.parse(await get(`leakage?${Q}&by=rule&carrier=${encodeURIComponent('ACME FREIGHT ')}`));
    if (l3.by !== 'rule') throw new Error('by');
    expect(l3.carrier).toEqual({ carrierKey: 'acme freight', displayName: 'Acme Freight' });
    expect(l3.rows.map((r) => [r.ruleId, r.findingCount])).toEqual([
      ['R_A', 2],
      ['R_B', 1],
    ]);
    const acmeCarrier = (await admin.query<{ carrier_name: string }>(`SELECT c.carrier_name FROM claims c JOIN tenants t ON t.id = c.tenant_id WHERE t.slug = 'acme' LIMIT 1`)).rows[0]?.carrier_name ?? 'Nobody';
    for (const name of [acmeCarrier, 'Nobody Shipping']) {
      const none = InsightsLeakage.parse(await get(`leakage?${Q}&by=rule&carrier=${encodeURIComponent(name)}`));
      if (none.by !== 'rule') throw new Error('by');
      expect(none.rows).toEqual([]);
      expect(none.carrier?.displayName).toBeNull();
    }
  });

  it('throughput: ISO weeks, first-decision and approval-to-send-ready percentiles, reject rate threshold', async () => {
    const t = InsightsThroughput.parse(await get(`throughput?${Q}`));
    expect(t.weeks).toEqual([
      { isoWeek: '2026-W23', weekStart: '2026-06-01', approve: 2, reject: 1, sendReady: 1, edit: 1 },
      { isoWeek: '2026-W24', weekStart: '2026-06-08', approve: 0, reject: 0, sendReady: 0, edit: 0 },
      { isoWeek: '2026-W25', weekStart: '2026-06-15', approve: 0, reject: 0, sendReady: 0, edit: 0 },
    ]);
    expect(t.timeToFirstDecision).toEqual({ decisionCount: 3, medianHours: 12, p90Hours: 24 });
    expect(t.approvalToSendReady).toEqual({ decisionCount: 1, medianHours: 48, p90Hours: 48 });
    expect(t.rejectRate).toEqual({ approveCount: 2, rejectCount: 1, rateBasisPoints: null, minimumDecisions: 5 });
    expect(/actor|user/iu.test(JSON.stringify(t))).toBe(false);
  });

  it('reads run in a database-enforced READ ONLY transaction', async () => {
    const db = tenantDb(base, tenantId);
    await expect(insightsRead(db, (tx) => tx.claim.updateMany({ where: {}, data: { version: { increment: 1 } } }))).rejects.toThrow(/read-only|read only/iu);
  });

  describe('routes on the seed tenant', () => {
    const urls = [`summary?${Q}`, `stages?${Q}`, 'deadlines', `leakage?${Q}&by=carrier`, `leakage?${Q}&by=rule`, `throughput?${Q}`];
    const tok: Record<string, string> = {};
    let acmeTenant = '';

    beforeAll(async () => {
      for (const k of ['viewer', 'reviewer', 'analyst'] as const) tok[k] = await c.login(`${k}@acme.test`);
      tok['dev'] = await c.login('dev@platform.test');
      acmeTenant = (await admin.query<{ id: string }>(`SELECT id FROM tenants WHERE slug = 'acme'`)).rows[0]?.id ?? '';
    }, 180_000);

    it('VIEWER gets 200 on every route and the read appends no audit event', async () => {
      const count = async () => (await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1`, [acmeTenant])).rows[0]?.n ?? -1;
      const before = await count();
      for (const u of urls) {
        const r = await c.get(`/api/v1/insights/${u}`, tok['viewer']);
        expect([u, r.statusCode], r.body).toEqual([u, 200]);
      }
      expect(await count()).toBe(before);
    });

    it('REVIEWER, ANALYST and platform users get 403; anonymous gets 401; unknown query keys get 400', async () => {
      for (const u of urls) {
        for (const k of ['reviewer', 'analyst', 'dev']) expect([u, k, (await c.get(`/api/v1/insights/${u}`, tok[k])).statusCode]).toEqual([u, k, 403]);
        expect([u, (await c.get(`/api/v1/insights/${u}`)).statusCode]).toEqual([u, 401]);
      }
      for (const extra of ['tenantId=x', 'role=OWNER']) {
        expect((await c.get(`/api/v1/insights/deadlines?${extra}`, tok['viewer'])).statusCode).toBe(400);
      }
      expect((await c.get('/api/v1/insights/summary?from=2026-01-01&to=2027-01-03', tok['viewer'])).statusCode).toBe(400);
    });

    it('API keys are refused (no insights scope exists)', async () => {
      const owner = (await admin.query<{ user_id: string }>(`SELECT m.user_id FROM memberships m WHERE m.tenant_id = $1 AND m.role = 'OWNER' LIMIT 1`, [acmeTenant])).rows[0]?.user_id ?? '';
      const keyId = randomBytes(8).toString('hex');
      const secret = randomBytes(32).toString('base64url');
      const id = randomUUID();
      await admin.query(
        `INSERT INTO api_keys (id, tenant_id, key_id, name, secret_hash, scopes, created_by_id, expires_at) VALUES ($1, $2, $3, 'insights-raw', $4, $5, $6, now() + interval '1 day')`,
        [id, acmeTenant, keyId, createHmac('sha256', STEP4_TEST_API_KEY_PEPPER).update(secret).digest('hex'), ['claims.read'], owner],
      );
      try {
        const r = await app.inject({ method: 'GET', url: '/api/v1/insights/deadlines', headers: { authorization: `Bearer fr_live_${keyId}_${secret}` } });
        expect(r.statusCode).toBe(403);
      } finally {
        await admin.query(`DELETE FROM api_keys WHERE id = $1`, [id]).catch(() => undefined);
      }
    });
  });
});
