/**
 * Integration (real PostgreSQL, migrated + seeded): REQ-20261020-dd-deadline.
 * - deadline-first-v1 worklist order and the dispute window computed by the SQL and the shared rule on a
 *   private fixture tenant (stated window shorter than, equal to and longer than the floor; past; no date);
 * - the claims list carries the clock-free window facts; insights D1 applies the stated window;
 * - the routing shadow: SQL helpers + assembly on the fixture, and the route (flag off 404, on 200 strict).
 */
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { ClaimsQuery, RoutingShadow, WorklistQuery } from '@fr/shared';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { listClaims } from '../../src/claims/service.js';
import { createDb, type BaseClient } from '../../src/db/client.js';
import { ddDisputeTermsByClaim } from '../../src/db/dd-dispute-terms.js';
import { deadlineRows, insightsRead } from '../../src/db/insights.js';
import { firstDecisionEvents, importDecisionStats, openClaimsForRouting, openLoadByAssignee, reviewerPool } from '../../src/db/routing.js';
import { tenantDb } from '../../src/db/tenant.js';
import { buildRoutingShadow } from '../../src/intelligence/routing.js';
import { buildWorklist } from '../../src/intelligence/service.js';

import { Client, adminUrl, appUrl, canRunDb, step4Env } from './step4-helpers.js';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const HEX = 'c'.repeat(64);
const Q = 'from=2026-06-01&to=2026-06-16';
const quiet = () => new Writable({ write: (_c, _e, cb) => cb() });
const FLAG = 'intelligence.routing_shadow';

let admin: pg.Client;
let base: BaseClient;
let tenantId = '';
let userId = '';
let viewerId = '';
const slug = `dd-deadline-${Date.now().toString(36)}`;
const ids: Record<string, string> = {};
const packets: Record<string, string> = {};

async function claim(key: string, o: { status: string; kind?: string; rec: number; invoice: string | null; assignee?: string | null }) {
  const id = randomUUID();
  ids[key] = id;
  await admin.query(
    `INSERT INTO claims (id, tenant_id, claim_number, kind, carrier_name, shipper_name, perspective, status, amount_claimed_cents, recoverable_cents,
       pending_review_cents, invoice_date, assignee_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4::"ClaimKind", 'Ocean Term', 'Shipper', 'SHIPPER', $5::"ClaimStatus", $6, $6, 0, $7, $8, '2026-06-10T00:00:00Z', '2026-06-10T00:00:00Z')`,
    [id, tenantId, `DD-${key}-${id.slice(0, 6)}`, o.kind ?? 'OCEAN_DD', o.status, o.rec, o.invoice, o.assignee ?? null],
  );
}

async function packet(key: string, claimKey: string, status: string, created: string, rules: string[]) {
  const id = randomUUID();
  packets[key] = id;
  const c = await admin.query<{ recoverable_cents: number }>(`SELECT recoverable_cents FROM claims WHERE id = $1`, [ids[claimKey]]);
  await admin.query(
    `INSERT INTO evidence_packets (id, tenant_id, claim_id, revision, status, perspective, generated_at, disclaimer, demand_letter, recoverable_cents,
       pending_review_cents, content_hash, created_at)
     VALUES ($1, $2, $3, 1, $4::"PacketStatus", 'SHIPPER', $5, 'd', 'l', $6, 0, $7, $5)`,
    [id, tenantId, ids[claimKey], status, created, c.rows[0]?.recoverable_cents ?? 0, HEX],
  );
  for (const [i, rule] of rules.entries()) {
    await admin.query(
      `INSERT INTO packet_findings (id, tenant_id, packet_id, ordinal, rule_id, title, direction, amount_cents, explanation, calculation, confidence, needs_human_review, citations)
       VALUES ($1, $2, $3, $4, $5, 't', 'OVERCHARGE', 1, 'e', '{}', 0.9, false, '[]')`,
      [randomUUID(), tenantId, id, i, rule],
    );
  }
}

async function ddInvoice(claimKey: string, invoiceDate: string | null, data: Record<string, unknown>) {
  const id = randomUUID();
  await admin.query(
    `INSERT INTO dd_invoices (id, tenant_id, status, invoice_number, billing_party_name, invoice_date, total_due_cents, data, created_by_id, updated_by_id, updated_at)
     VALUES ($1, $2, 'DRAFT', $3, 'Ocean Term', $4, 10000, $5, $6, $6, now())`,
    [id, tenantId, `INV-${claimKey}`, invoiceDate, JSON.stringify(data), userId],
  );
  await admin.query(`UPDATE dd_invoices SET status = 'AUDITED', claim_id = $2, audited_at = now(), audit_snapshot = '{}' WHERE id = $1`, [id, ids[claimKey]]);
}

async function setFlag(enabled: boolean) {
  await admin.query(`UPDATE feature_flags SET enabled = $1, version = version + 1 WHERE key = $2 AND enabled <> $1`, [enabled, FLAG]);
}

describe.skipIf(!canRunDb)('D&D dispute deadlines and the routing shadow (PostgreSQL)', () => {
  let app: FastifyInstance;
  let c: Client;
  let viewerToken = '';

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    base = createDb(appUrl ?? '');
    tenantId = randomUUID();
    userId = randomUUID();
    viewerId = randomUUID();
    const seedHash = (await admin.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE email = 'viewer@acme.test'`)).rows[0]?.password_hash ?? '';
    await admin.query('BEGIN');
    await admin.query(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'DD Deadline Fixture', $2)`, [tenantId, slug]);
    await admin.query(`INSERT INTO users (id, email, name, password_hash, updated_at) VALUES ($1, $2, 'Fixture Owner', 'x', now())`, [userId, `${slug}-owner@fixture.test`]);
    await admin.query(`INSERT INTO users (id, email, name, password_hash, updated_at) VALUES ($1, $2, 'Fixture Viewer', $3, now())`, [viewerId, `${slug}-viewer@fixture.test`, seedHash]);
    await admin.query(`INSERT INTO memberships (id, tenant_id, user_id, role, updated_at) VALUES ($1, $2, $3, 'OWNER', now())`, [randomUUID(), tenantId, userId]);
    await admin.query(`INSERT INTO memberships (id, tenant_id, user_id, role, updated_at) VALUES ($1, $2, $3, 'VIEWER', now())`, [randomUUID(), tenantId, viewerId]);
    await admin.query('COMMIT');

    // today = 2026-06-15 (UTC date of NOW).
    await claim('D1', { status: 'PENDING_REVIEW', rec: 100, invoice: '2026-05-21T00:00:00Z' }); // stated 10 < 30 -> floor -> closes 06-20, 5 left
    await claim('D2', { status: 'PENDING_REVIEW', rec: 100000, invoice: '2026-04-26T00:00:00Z', assignee: userId }); // stated 60 -> closes 06-25, 10 left
    await claim('D3', { status: 'PENDING_REVIEW', rec: 500000, invoice: '2026-05-06T00:00:00Z' }); // nothing stated -> closes 06-05, past (-10)
    await claim('D4', { status: 'PENDING_REVIEW', rec: 300000, invoice: '2026-06-10T00:00:00Z' }); // stated 90 -> closes 09-08, 85 left
    await claim('D5', { status: 'PENDING_REVIEW', rec: 200, invoice: null }); // no date -> no window
    await claim('D6', { status: 'APPROVED', rec: 50, invoice: null }); // decided (approved) by the owner: routing history
    await claim('F1', { status: 'PENDING_REVIEW', kind: 'FREIGHT', rec: 400000, invoice: '2026-06-01T00:00:00Z' });
    for (const [k, rules] of [['D1', ['DD-TARIFF-OVERCHARGE']], ['D2', ['R_X']], ['D3', ['DD-TARIFF-OVERCHARGE']], ['D4', ['R_Y']], ['D5', []], ['F1', ['R_A']]] as const) {
      await packet(`P-${k}`, k, 'PENDING_REVIEW', '2026-06-10T00:00:00Z', [...rules]);
    }
    await packet('P-D6', 'D6', 'APPROVED', '2026-06-13T12:00:00Z', ['DD-TARIFF-OVERCHARGE']);
    await admin.query(
      `INSERT INTO approvals (id, tenant_id, claim_id, packet_id, packet_revision, action, reason, from_status, to_status, content_hash, actor_id, actor_role, created_at)
       VALUES ($1, $2, $3, $4, 1, 'APPROVE', 'fixture decision', 'PENDING_REVIEW', 'APPROVED', $5, $6, 'OWNER', '2026-06-14T12:00:00Z')`,
      [randomUUID(), tenantId, ids['D6'], packets['P-D6'], HEX, userId],
    );
    await ddInvoice('D1', '2026-05-21', { disputeRequestDays: 10 });
    await ddInvoice('D2', '2026-04-26', { disputeRequestDays: 60 });
    await ddInvoice('D3', '2026-05-06', { disputeRequestDays: null });
    await ddInvoice('D4', '2026-06-10', { disputeRequestDays: 90 });
    await ddInvoice('D5', null, {});

    app = await buildApp(step4Env(), { logStream: quiet(), overrides: { now: () => NOW } });
    await app.ready();
    c = await new Client(app).init();
    viewerToken = await c.login(`${slug}-viewer@fixture.test`);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await base?.$disconnect();
    if (!admin) return;
    await setFlag(false);
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

  const num = (id: string): string => Object.entries(ids).find(([, v]) => v === id)?.[0] ?? '';

  it('worklist: urgent D&D claims first (soonest first), then priority-v1; windows from the stated terms with the 30-day floor', async () => {
    const wl = await buildWorklist(tenantDb(base, tenantId), WorklistQuery.parse({ pageSize: '100' }), { pendingWeightPercent: 25, similarCandidateLimit: 200 }, NOW);
    expect(wl.items.map((i) => num(i.claim.id))).toEqual(['D1', 'D2', 'D3', 'F1', 'D4', 'D5', 'D6']);
    expect(wl.formula).toEqual({ version: 'priority-v1', pendingWeightPercent: 25, deadlineFirst: { version: 'deadline-first-v1', kind: 'OCEAN_DD', urgentWithinDays: 14 } });
    const by = Object.fromEntries(wl.items.map((i) => [num(i.claim.id), i]));
    expect(by['D1']?.disputeWindow).toEqual({ regulation: '46 CFR 541.8(a)', invoiceDate: '2026-05-21', statedDays: 10, windowDays: 30, floorApplied: true, closesOn: '2026-06-20', daysLeft: 5, urgent: true });
    expect(by['D2']?.disputeWindow).toMatchObject({ statedDays: 60, windowDays: 60, floorApplied: false, closesOn: '2026-06-25', daysLeft: 10, urgent: true });
    expect(by['D3']?.disputeWindow).toMatchObject({ statedDays: null, windowDays: 30, floorApplied: true, closesOn: '2026-06-05', daysLeft: -10, urgent: false });
    expect(by['D4']?.disputeWindow).toMatchObject({ statedDays: 90, windowDays: 90, closesOn: '2026-09-08', daysLeft: 85, urgent: false });
    expect(by['D5']?.disputeWindow).toBeNull();
    expect(by['F1']?.disputeWindow).toBeNull();
    expect(by['F1']?.claim.kind).toBe('FREIGHT');
    expect(by['D1']?.why[0]).toBe('Dispute window: 5 days left (closes 2026-06-20)');
    expect(by['D3']?.why[0]).toBe('Dispute window closed 2026-06-05 (10 days ago)');
    expect(by['F1']?.why.some((w) => w.startsWith('Dispute window'))).toBe(false);
    // Paging keeps the same order.
    const p2 = await buildWorklist(tenantDb(base, tenantId), WorklistQuery.parse({ pageSize: '2', page: '2' }), { pendingWeightPercent: 25, similarCandidateLimit: 200 }, NOW);
    expect(p2.items.map((i) => [i.rank, num(i.claim.id)])).toEqual([
      [3, 'D3'],
      [4, 'F1'],
    ]);
  });

  it('claims list and dispute terms: clock-free window facts on OCEAN_DD claims only', async () => {
    const db = tenantDb(base, tenantId);
    const terms = await db.tx((tx) => ddDisputeTermsByClaim(tx, Object.values(ids)));
    expect(terms.get(ids['D1'] ?? '')).toEqual({ invoiceDate: '2026-05-21', statedDays: 10 });
    expect(terms.get(ids['D3'] ?? '')).toEqual({ invoiceDate: '2026-05-06', statedDays: null });
    expect(terms.get(ids['D5'] ?? '')).toEqual({ invoiceDate: null, statedDays: null });
    expect(terms.has(ids['F1'] ?? '')).toBe(false);
    expect(terms.has(ids['D6'] ?? '')).toBe(false);
    const list = await db.tx((tx) => listClaims(tx, ClaimsQuery.parse({ pageSize: '50' })));
    const by = Object.fromEntries(list.items.map((i) => [num(i.id), i]));
    expect(by['D2']?.disputeWindow).toEqual({ regulation: '46 CFR 541.8(a)', invoiceDate: '2026-04-26', statedDays: 60, windowDays: 60, floorApplied: false, closesOn: '2026-06-25' });
    expect(by['D1']?.disputeWindow).toMatchObject({ closesOn: '2026-06-20', floorApplied: true });
    expect(by['D5']?.disputeWindow).toBeNull();
    expect(by['D6']?.disputeWindow).toBeNull();
    expect(by['F1']?.disputeWindow).toBeNull();
  });

  it('insights D1 buckets apply the stated window with the floor', async () => {
    const rows = await insightsRead(tenantDb(base, tenantId), (tx) => deadlineRows(tx, { kind: 'OCEAN_DD', perspective: null }, NOW, 30));
    const bucket = Object.fromEntries(rows.map((r) => [r.bucket, [r.claimCount, r.cents]]));
    expect(bucket).toEqual({ d0to7: [1, 100], d8to14: [1, 100000], past: [1, 500000], over14: [1, 300000], dateMissing: [2, 250] });
  });

  it('routing shadow: SQL helpers and assembly on the fixture tenant', async () => {
    const period = { from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-06-16T00:00:00Z') };
    const body = await insightsRead(tenantDb(base, tenantId), async (tx) => {
      const decisions = await firstDecisionEvents(tx, period, 5000);
      const open = await openClaimsForRouting(tx, 500);
      return buildRoutingShadow({
        now: NOW,
        period,
        decisions: decisions.rows,
        decisionsTruncated: decisions.truncated,
        imports: await importDecisionStats(tx, period),
        open: open.rows,
        openTruncated: open.truncated,
        load: await openLoadByAssignee(tx),
        pool: await reviewerPool(tx),
      });
    });
    expect(RoutingShadow.parse(body)).toEqual(body);
    expect(body.coverage).toEqual({ decisionsConsidered: 1, decisionsTruncated: false, openClaimsConsidered: 7, openClaimsTruncated: false, eligibleReviewers: 1 });
    expect(body.rules).toEqual([{ ruleId: 'DD-TARIFF-OVERCHARGE', decisions: 1, reviewers: [{ reviewerId: userId, decisions: 1, medianHours: 24 }] }]);
    const owner = body.reviewers.find((r) => r.id === userId);
    expect(owner).toMatchObject({ name: 'Fixture Owner', role: 'OWNER', eligible: true, packetDecisions: 1, approveCount: 1, medianHoursToFirstDecision: 24, openAssigned: 1 });
    expect(body.reviewers.find((r) => r.id === viewerId)).toMatchObject({ role: 'VIEWER', eligible: false, packetDecisions: 0 });
    const d1 = body.openClaims.find((o) => o.claim.id === ids['D1']);
    expect(d1).toMatchObject({
      actual: null,
      ruleIds: ['DD-TARIFF-OVERCHARGE'],
      fastestForRule: { reviewerId: userId, name: 'Fixture Owner', basis: 'median 24 h over 1 decision on DD-TARIFF-OVERCHARGE' },
      leastLoaded: { reviewerId: userId, basis: '1 open claim assigned now' },
      agreement: { fastestForRule: null, leastLoaded: null },
    });
    const d2 = body.openClaims.find((o) => o.claim.id === ids['D2']);
    expect(d2).toMatchObject({ actual: { id: userId }, fastestForRule: null, leastLoaded: { reviewerId: userId }, agreement: { fastestForRule: null, leastLoaded: true } });
    expect(body.agreement).toEqual({ fastestForRule: { agreed: 0, compared: 0, rateBasisPoints: null }, leastLoaded: { agreed: 1, compared: 1, rateBasisPoints: 10000 } });
    expect(body.prequential).toMatchObject({ evaluated: 1, noHistory: 1, agreed: 0 });
  });

  it('route: 404 while the flag is off; 200 with the strict body when on; strict query; nothing written', async () => {
    await setFlag(false);
    const off = await c.get(`/api/v1/insights/routing?${Q}`, viewerToken);
    expect(off.statusCode, off.body).toBe(404);
    const auditBefore = Number((await admin.query<{ n: string }>(`SELECT count(*) AS n FROM audit_events WHERE tenant_id = $1`, [tenantId])).rows[0]?.n ?? '0');
    await setFlag(true);
    try {
      const on = await c.get(`/api/v1/insights/routing?${Q}`, viewerToken);
      expect(on.statusCode, on.body).toBe(200);
      const body = RoutingShadow.parse(on.json());
      expect(body.shadow).toBe(true);
      expect(body.meta.asOf).toBe(NOW.toISOString());
      expect(body.openClaims.map((o) => o.claim.id).sort()).toEqual([ids['D1'], ids['D2'], ids['D3'], ids['D4'], ids['D5'], ids['D6'], ids['F1']].sort());
      expect((await c.get(`/api/v1/insights/routing?${Q}&kind=FREIGHT`, viewerToken)).statusCode).toBe(400);
      expect((await c.get(`/api/v1/insights/routing?from=2026-06-16&to=2026-06-01`, viewerToken)).statusCode).toBe(400);
      expect((await c.get(`/api/v1/insights/routing?${Q}`)).statusCode).toBe(401);
      const auditAfter = Number((await admin.query<{ n: string }>(`SELECT count(*) AS n FROM audit_events WHERE tenant_id = $1`, [tenantId])).rows[0]?.n ?? '0');
      expect(auditAfter).toBe(auditBefore);
    } finally {
      await setFlag(false);
    }
    expect((await c.get(`/api/v1/insights/routing?${Q}`, viewerToken)).statusCode).toBe(404);
  });
});