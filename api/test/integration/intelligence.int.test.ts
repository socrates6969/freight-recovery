/**
 * Integration (real PostgreSQL, migrated + seeded): Recovery Intelligence R70-R73 (Q6, A6, A8.5).
 * - a private fixture tenant (owner-inserted) with >= 40 randomized claims: the SQL worklist order equals
 *   compareWorklist over the same data, pages are consistent, values match scoreClaim exactly;
 * - similar-v1 through the service equals rankSimilar over the stored features (latest packet only);
 * - provenance counts and totals identities;
 * - routes: RBAC (platform 403), flag OFF -> 404, byte-identical 404 for other-tenant ids, audit rows,
 *   component telemetry counts only scoring calls.
 */
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { Provenance, SimilarResponse, Worklist, WorklistQuery } from '@fr/shared';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { createDb, type BaseClient } from '../../src/db/client.js';
import { tenantDb } from '../../src/db/tenant.js';
import { compareWorklist, scoreClaim } from '../../src/intelligence/priority.js';
import { buildWorklist, findSimilar, provenanceFor, similarTarget } from '../../src/intelligence/service.js';
import { rankSimilar } from '../../src/intelligence/similarity.js';

import { Client, adminUrl, appUrl, canRunDb, step4Env } from './step4-helpers.js';

const NOW = new Date('2026-10-09T12:00:00.000Z');
const HEX = 'a'.repeat(64);

function lcg(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

interface FixtureClaim {
  id: string;
  status: string;
  perspective: 'SHIPPER' | 'CARRIER';
  carrier: string;
  rec: number;
  pend: number;
  updatedAt: Date;
  /** Latest packet's findings: [ruleId, needsHumanReview]. Older revisions get different rules. */
  findings: [string, boolean][];
  sources: string[];
  packets: number;
  approvals: Date[];
}

let admin: pg.Client;
let base: BaseClient;
let tenantId = '';
let userId = '';
const fixture: FixtureClaim[] = [];
const slug = `intel-builder-${Date.now().toString(36)}`;

async function insertClaim(c: FixtureClaim): Promise<void> {
  await admin.query(
    `INSERT INTO claims (id, tenant_id, claim_number, carrier_name, shipper_name, perspective, status, amount_claimed_cents, recoverable_cents,
       pending_review_cents, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'Shipper', $5, $6::"ClaimStatus", $7, $8, $9, $10, $10)`,
    [c.id, tenantId, `IB-${c.id.slice(0, 8)}`, c.carrier, c.perspective, c.status, c.rec + c.pend, c.rec, c.pend, c.updatedAt],
  );
  for (let rev = 1; rev <= c.packets; rev += 1) {
    const pid = randomUUID();
    const latest = rev === c.packets;
    const pstatus = latest ? (c.status === 'AWAITING_ANALYSIS' ? 'PENDING_REVIEW' : c.status) : 'SUPERSEDED';
    await admin.query(
      `INSERT INTO evidence_packets (id, tenant_id, claim_id, revision, status, perspective, generated_at, disclaimer, demand_letter, recoverable_cents,
         pending_review_cents, content_hash)
       VALUES ($1, $2, $3, $4, $5::"PacketStatus", $6, $7, 'd', 'l', $8, $9, $10)`,
      [pid, tenantId, c.id, rev, pstatus, c.perspective, c.updatedAt, c.rec, c.pend, HEX],
    );
    const findings: [string, boolean][] = latest ? c.findings : [['OLD_RULE', true]];
    for (const [i, [rule, review]] of findings.entries()) {
      await admin.query(
        `INSERT INTO packet_findings (id, tenant_id, packet_id, ordinal, rule_id, title, direction, amount_cents, explanation, calculation, confidence,
           needs_human_review, citations)
         VALUES ($1, $2, $3, $4, $5, 't', 'OVERCHARGE', 100, 'e', '{}', 0.9, $6, '[]')`,
        [randomUUID(), tenantId, pid, i, rule, review],
      );
    }
    for (const [i, dt] of (latest ? c.sources : ['OTHER']).entries()) {
      await admin.query(
        `INSERT INTO packet_sources (id, tenant_id, packet_id, filename, doc_type, sha256, size_bytes, ordinal) VALUES ($1, $2, $3, 'f.txt', $4::"DocType", $5, 1, $6)`,
        [randomUUID(), tenantId, pid, dt, HEX, i],
      );
    }
    if (latest) {
      for (const at of c.approvals) {
        await admin.query(
          `INSERT INTO approvals (id, tenant_id, claim_id, packet_id, packet_revision, action, reason, from_status, to_status, content_hash, actor_id, actor_role, created_at)
           VALUES ($1, $2, $3, $4, $5, 'APPROVE', 'fixture approval', 'PENDING_REVIEW', 'APPROVED', $6, $7, 'OWNER', $8)`,
          [randomUUID(), tenantId, c.id, pid, rev, HEX, userId, at],
        );
      }
    }
  }
}

describe.skipIf(!canRunDb)('Recovery Intelligence (PostgreSQL)', () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    base = createDb(appUrl ?? '');
    tenantId = randomUUID();
    userId = randomUUID();
    await admin.query('BEGIN');
    await admin.query(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'Intel Builder Fixture', $2)`, [tenantId, slug]);
    await admin.query(`INSERT INTO users (id, email, name, password_hash, updated_at) VALUES ($1, $2, 'Fixture Owner', 'x', now())`, [userId, `${slug}@fixture.test`]);
    await admin.query(`INSERT INTO memberships (id, tenant_id, user_id, role, updated_at) VALUES ($1, $2, $3, 'OWNER', now())`, [randomUUID(), tenantId, userId]);
    await admin.query('COMMIT');
    const r = lcg(42);
    const statuses = ['PENDING_REVIEW', 'APPROVED', 'APPROVED', 'PENDING_REVIEW', 'REJECTED', 'SEND_READY', 'AWAITING_ANALYSIS'];
    const carriers = ['Acme Freight', 'acme  freight', 'Beta Lines', 'Gamma'];
    const rules = ['R_DETENTION', 'R_LAYOVER', 'R_FUEL', 'R_ACCESSORIAL'];
    for (let i = 0; i < 48; i += 1) {
      const status = statuses[Math.floor(r() * statuses.length)] ?? 'PENDING_REVIEW';
      const noPacket = status === 'AWAITING_ANALYSIS' || (status === 'PENDING_REVIEW' && i % 11 === 0);
      fixture.push({
        id: randomUUID(),
        status,
        perspective: r() < 0.5 ? 'SHIPPER' : 'CARRIER',
        carrier: carriers[Math.floor(r() * carriers.length)] ?? 'Acme',
        // Coarse values so that ties on value, recoverable and updatedAt all occur.
        rec: Math.floor(r() * 4) * 1000,
        pend: Math.floor(r() * 3) * 400,
        updatedAt: new Date(NOW.getTime() - Math.floor(r() * 4) * 86_400_000 - (i % 2) * 1000),
        findings: rules.filter(() => r() < 0.45).map((rule) => [rule, r() < 0.5] as [string, boolean]),
        sources: ['INVOICE', 'BILL_OF_LADING', 'RATE_CONFIRMATION'].filter(() => r() < 0.6),
        packets: noPacket ? 0 : 1 + (r() < 0.25 ? 1 : 0),
        approvals: status === 'APPROVED' || status === 'SEND_READY' || status === 'REJECTED' ? [new Date(NOW.getTime() - 3600_000), new Date(NOW.getTime() - 7200_000)] : [],
      });
    }
    for (const c of fixture) await insertClaim(c);
  }, 120_000);

  afterAll(async () => {
    await base?.$disconnect();
    if (!admin) return;
    await admin.query('BEGIN');
    await admin.query('SET LOCAL session_replication_role = replica');
    for (const t of ['approvals', 'packet_findings', 'packet_sources', 'evidence_packets', 'claims', 'audit_events', 'memberships']) {
      await admin.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenantId]);
    }
    await admin.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await admin.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await admin.query('COMMIT');
    await admin.end();
  });

  const policy = { pendingWeightPercent: 25, similarCandidateLimit: 500 };

  it('worklist: SQL order equals compareWorklist over the fixture; values equal scoreClaim; ranks are global', async () => {
    const eligible = fixture.filter((c) => (c.status === 'PENDING_REVIEW' || c.status === 'APPROVED') && c.packets > 0);
    expect(eligible.length).toBeGreaterThanOrEqual(15);
    const expected = eligible
      .map((c) => ({ ...c, valueCents: scoreClaim({ recoverableCents: c.rec, pendingReviewCents: c.pend }, 25).valueCents, recoverableCents: c.rec }))
      .sort(compareWorklist)
      .map((c) => c.id);
    const db = tenantDb(base, tenantId);
    const full = Worklist.parse(await buildWorklist(db, WorklistQuery.parse({ pageSize: '100' }), policy, NOW));
    expect(full.items.map((i) => i.claim.id)).toEqual(expected);
    expect(full.total).toBe(eligible.length);
    expect(full.notRanked.awaitingAnalysis).toBe(fixture.filter((c) => c.status === 'AWAITING_ANALYSIS').length);
    expect(full.items.map((i) => i.rank)).toEqual(expected.map((_, i) => i + 1));
    for (const it2 of full.items) {
      const c = fixture.find((x) => x.id === it2.claim.id);
      expect(it2.score.valueCents).toBe(scoreClaim({ recoverableCents: c?.rec ?? 0, pendingReviewCents: c?.pend ?? 0 }, 25).valueCents);
      const pending = c?.status === 'PENDING_REVIEW' ? (c.findings.filter(([, rv]) => rv).length) : (c?.findings.filter(([, rv]) => rv).length ?? 0);
      expect(it2.pendingFindingsCount).toBe(pending);
      expect(it2.claim.latestPacket.revision).toBe(c?.packets);
    }
    // Paging is a window on the same order.
    const paged: string[] = [];
    for (let page = 1; page <= Math.ceil(eligible.length / 7); page += 1) {
      const p = await buildWorklist(db, WorklistQuery.parse({ pageSize: '7', page: String(page) }), policy, NOW);
      expect(p.items.map((i) => i.rank)).toEqual(p.items.map((_, i) => (page - 1) * 7 + i + 1));
      paged.push(...p.items.map((i) => i.claim.id));
    }
    expect(paged).toEqual(expected);
    // Filters.
    const approved = await buildWorklist(db, WorklistQuery.parse({ status: 'APPROVED', perspective: 'CARRIER', pageSize: '100' }), policy, NOW);
    expect(approved.items.every((i) => i.claim.status === 'APPROVED' && i.claim.perspective === 'CARRIER' && i.nextAction === 'MARK_SEND_READY')).toBe(true);
    // W changes the order only through the documented formula.
    const w0 = await buildWorklist(db, WorklistQuery.parse({ pageSize: '100' }), { ...policy, pendingWeightPercent: 0 }, NOW);
    expect(w0.label).toContain('plus 0% of the amount');
    expect(w0.items.every((i) => i.score.valueCents === i.claim.recoverableCents)).toBe(true);
  });

  it('similar: equals rankSimilar over stored latest-packet features; never includes the target, other statuses or tenants', async () => {
    const db = tenantDb(base, tenantId);
    const targets = fixture.filter((c) => c.packets > 0).slice(0, 6);
    for (const t of targets) {
      const res = SimilarResponse.parse(await findSimilar(db, await similarTarget(db, t.id), 10, policy));
      const candidates = fixture
        .filter((c) => c.id !== t.id && c.packets > 0 && ['APPROVED', 'SEND_READY', 'REJECTED'].includes(c.status))
        .map((c) => ({ id: c.id, updatedAt: c.updatedAt, carrierName: c.carrier, ruleIds: new Set(c.findings.map(([rule]) => rule)), totalCents: c.rec + c.pend, perspective: c.perspective }));
      const expected = rankSimilar(
        { carrierName: t.carrier, ruleIds: new Set(t.findings.map(([rule]) => rule)), totalCents: t.rec + t.pend, perspective: t.perspective },
        candidates,
        10,
      );
      expect(res.items.map((i) => [i.claim.id, i.similarityPercent])).toEqual(expected.map((e) => [e.candidate.id, e.scored.percent]));
      expect(res.candidatesConsidered).toBe(candidates.length);
      expect(res.computeMs).toBeGreaterThanOrEqual(0);
      for (const item of res.items) {
        expect(item.claim.id).not.toBe(t.id);
        expect(item.handling.ruleIds).not.toContain('OLD_RULE');
        expect(item.handling.decidedAt).toBe(new Date(NOW.getTime() - 3600_000).toISOString());
      }
    }
    const noPacket = fixture.find((c) => c.packets === 0);
    if (noPacket) {
      const r = await findSimilar(db, await similarTarget(db, noPacket.id), 5, policy);
      expect(r).toMatchObject({ reason: 'no_packet', items: [], candidatesConsidered: 0 });
    }
    const acme = (await admin.query<{ id: string }>(`SELECT c.id FROM claims c JOIN tenants t ON t.id = c.tenant_id WHERE t.slug = 'acme' LIMIT 1`)).rows[0]?.id ?? '';
    await expect(similarTarget(db, acme)).rejects.toMatchObject({ statusCode: 404 });
    await expect(similarTarget(db, 'nope')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('provenance: counts per document and totals identities (empty when nothing is linked)', async () => {
    const db = tenantDb(base, tenantId);
    const claim = fixture[0];
    if (!claim) throw new Error('fixture');
    const empty = Provenance.parse(await provenanceFor(db, claim.id));
    expect(empty.documents).toEqual([]);
    expect(empty.totals).toEqual({ documents: 0, fields: 0, manualFields: 0, proposed: 0, confirmed: 0, corrected: 0, rejected: 0, unresolvedFlagged: 0 });
    const batch = randomUUID();
    const doc = randomUUID();
    await admin.query(`INSERT INTO import_batches (id, tenant_id, created_by_id) VALUES ($1, $2, $3)`, [batch, tenantId, userId]);
    await admin.query(
      `INSERT INTO import_documents (id, tenant_id, batch_id, uploaded_by_id, source, display_name, detected_type, size_bytes, sha256, storage_key,
         doc_type, doc_type_basis, status, provider_name, provider_version, parser_version, updated_at)
       VALUES ($1, $2, $3, $4, 'UPLOAD', 'invoice-77.csv', 'CSV', 10, $5, $6, 'INVOICE', 'HEADER', 'ACCEPTED', 'deterministic', '1', '1', now())`,
      [doc, tenantId, batch, userId, HEX, `t/${tenantId}/imports/${batch}/${doc}/original`],
    );
    const fields: [string, string, number, boolean, string][] = [
      ['invoice.load_number', 'EXTRACTED', 0.95, false, 'CONFIRMED'],
      ['invoice.total', 'EXTRACTED', 0.62, true, 'PROPOSED'],
      ['invoice.carrier', 'EXTRACTED', 0.8, true, 'CORRECTED'],
      ['invoice.shipper', 'MANUAL', 1, false, 'REJECTED'],
    ];
    for (const [i, [key, origin, conf, review, status]] of fields.entries()) {
      await admin.query(
        `INSERT INTO extracted_fields (id, tenant_id, document_id, key, ordinal, kind, value, raw_value, confidence, needs_review, status, origin,
           resolved_by_id, resolved_at, corrected_value, line, start_col, end_col, excerpt)
         VALUES ($1, $2, $3, $4, $5, 'STRING', 'v', 'v', $6, $7, $8::"FieldStatus", $9::"FieldOrigin",
           CASE WHEN $8 = 'PROPOSED' THEN NULL ELSE $10::uuid END, CASE WHEN $8 = 'PROPOSED' THEN NULL ELSE now() END,
           CASE WHEN $8 = 'CORRECTED' THEN 'fixed' ELSE NULL END,
           CASE WHEN $9 = 'EXTRACTED' THEN 1 END, CASE WHEN $9 = 'EXTRACTED' THEN 0 END, CASE WHEN $9 = 'EXTRACTED' THEN 1 END,
           CASE WHEN $9 = 'EXTRACTED' THEN 'v' END)`,
        [randomUUID(), tenantId, doc, key, i, conf, review, status, origin, userId],
      );

    }
    await admin.query(`INSERT INTO claim_documents (id, tenant_id, claim_id, document_id, linked_by_id) VALUES ($1, $2, $3, $4, $5)`, [randomUUID(), tenantId, claim.id, doc, userId]);
    const p = Provenance.parse(await provenanceFor(db, claim.id));
    expect(p.documents).toEqual([
      {
        documentId: doc,
        displayName: 'invoice-77.csv',
        docType: 'INVOICE',
        status: 'ACCEPTED',
        extractedFieldCount: 3,
        manualFieldCount: 1,
        byFieldStatus: { PROPOSED: 1, CONFIRMED: 1, CORRECTED: 1, REJECTED: 1 },
        unresolvedFlaggedCount: 1,
        minConfidence: 0.62,
      },
    ]);
    expect(p.totals).toEqual({ documents: 1, fields: 4, manualFields: 1, proposed: 1, confirmed: 1, corrected: 1, rejected: 1, unresolvedFlagged: 1 });
    expect(p.totals.fields).toBe(p.totals.proposed + p.totals.confirmed + p.totals.corrected + p.totals.rejected);
    await admin.query('BEGIN');
    await admin.query('SET LOCAL session_replication_role = replica');
    await admin.query(`DELETE FROM claim_documents WHERE document_id = $1`, [doc]);
    await admin.query(`DELETE FROM extracted_fields WHERE document_id = $1`, [doc]);
    await admin.query(`DELETE FROM import_documents WHERE id = $1`, [doc]);
    await admin.query(`DELETE FROM import_batches WHERE id = $1`, [batch]);
    await admin.query('COMMIT');
  });

  describe('routes R70-R73', () => {
    let app: FastifyInstance;
    let c: Client;
    let viewer = '';
    let dev = '';
    let acmeClaim = '';
    let acmeTenant = '';
    const globexClaim = { id: '' };

    beforeAll(async () => {
      app = await buildApp(step4Env(), { logStream: new Writable({ write: (_c, _e, cb) => cb() }) });
      await app.ready();
      c = await new Client(app).init();
      viewer = await c.login('viewer@acme.test');
      dev = await c.login('dev@platform.test');
      acmeTenant = (await admin.query<{ id: string }>(`SELECT id FROM tenants WHERE slug = 'acme'`)).rows[0]?.id ?? '';
      acmeClaim =
        (await admin.query<{ id: string }>(`SELECT c.id FROM claims c WHERE c.tenant_id = $1 AND EXISTS (SELECT 1 FROM evidence_packets p WHERE p.claim_id = c.id) LIMIT 1`, [acmeTenant])).rows[0]?.id ?? '';
      globexClaim.id = (await admin.query<{ id: string }>(`SELECT c.id FROM claims c JOIN tenants t ON t.id = c.tenant_id WHERE t.slug = 'globex' LIMIT 1`)).rows[0]?.id ?? '';
    }, 120_000);

    afterAll(async () => {
      await admin.query(`SELECT 1`);
      await app?.close();
    });

    it('features, worklist, similar, provenance for a tenant user; platform users 403; unauthenticated 401', async () => {
      expect((await c.get('/api/v1/features', viewer)).json()).toEqual({
        flags: { 'intelligence.provenance': true, 'intelligence.similar_claims': true, 'intelligence.worklist': true },
      });
      const wl = await c.get('/api/v1/intelligence/worklist?pageSize=5', viewer);
      expect(wl.statusCode, wl.body).toBe(200);
      expect(Worklist.parse(wl.json()).formula).toEqual({ version: 'priority-v1', pendingWeightPercent: 25 });
      expect((await c.get(`/api/v1/claims/${acmeClaim}/similar`, viewer)).statusCode).toBe(200);
      expect((await c.get(`/api/v1/claims/${acmeClaim}/provenance`, viewer)).statusCode).toBe(200);
      for (const url of ['/api/v1/features', '/api/v1/intelligence/worklist', `/api/v1/claims/${acmeClaim}/similar`, `/api/v1/claims/${acmeClaim}/provenance`]) {
        expect([url, (await c.get(url, dev)).statusCode]).toEqual([url, 403]);
        expect([url, (await c.get(url)).statusCode]).toEqual([url, 401]);
      }
      expect((await c.get('/api/v1/intelligence/worklist?status=REJECTED', viewer)).statusCode).toBe(400);
      expect((await c.get('/api/v1/intelligence/worklist?x=1', viewer)).statusCode).toBe(400);
      expect((await c.get(`/api/v1/claims/${acmeClaim}/similar?limit=11`, viewer)).statusCode).toBe(400);
    });

    it('other-tenant and unknown ids give byte-identical 404 bodies (except request id)', async () => {
      const strip = (b: string) => b.replace(/"requestId":"[^"]+"/u, '');
      for (const kind of ['similar', 'provenance']) {
        const other = await c.get(`/api/v1/claims/${globexClaim.id}/${kind}`, viewer);
        const unknown = await c.get(`/api/v1/claims/${randomUUID()}/${kind}`, viewer);
        const junk = await c.get(`/api/v1/claims/not-a-uuid/${kind}`, viewer);
        expect([other.statusCode, unknown.statusCode, junk.statusCode]).toEqual([404, 404, 404]);
        expect(strip(other.body)).toBe(strip(unknown.body));
        expect(strip(junk.body)).toBe(strip(unknown.body));
      }
    });

    it('a switched-off flag answers 404 before any data access; component calls count only scoring', async () => {
      const before = app.metrics.snapshot({
        parser: { jobs: 0, succeeded: 0, rejected: 0, timeouts: 0, memoryKills: 0, failures: 0, busyRejections: 0, queueWaitMs: 0 },
        flags: { 'priority-v1': true, 'similar-v1': true },
        now: new Date(),
        startedAt: new Date(),
        version: 'x',
        nodeVersion: 'x',
      }).components;
      await admin.query('BEGIN');
      await admin.query('SET LOCAL session_replication_role = replica');
      await admin.query(`UPDATE feature_flags SET enabled = false WHERE key IN ('intelligence.worklist', 'intelligence.similar_claims', 'intelligence.provenance')`);
      await admin.query('COMMIT');
      try {
        const offWl = await c.get('/api/v1/intelligence/worklist', viewer);
        const unknown = await c.get(`/api/v1/claims/${randomUUID()}/similar`, viewer);
        const offSim = await c.get(`/api/v1/claims/${acmeClaim}/similar`, viewer);
        const offProv = await c.get(`/api/v1/claims/${acmeClaim}/provenance`, viewer);
        expect([offWl.statusCode, offSim.statusCode, offProv.statusCode]).toEqual([404, 404, 404]);
        expect(offSim.json()).toMatchObject({ error: { code: 'not_found' } });
        expect(unknown.statusCode).toBe(404);
        expect((await c.get('/api/v1/features', viewer)).json()).toEqual({
          flags: { 'intelligence.provenance': false, 'intelligence.similar_claims': false, 'intelligence.worklist': false },
        });
      } finally {
        await admin.query('BEGIN');
        await admin.query('SET LOCAL session_replication_role = replica');
        await admin.query(`UPDATE feature_flags SET enabled = true WHERE key IN ('intelligence.worklist', 'intelligence.similar_claims', 'intelligence.provenance')`);
        await admin.query('COMMIT');
      }
      await c.get(`/api/v1/claims/${randomUUID()}/similar`, viewer);
      await c.get(`/api/v1/claims/${acmeClaim}/similar`, viewer);
      await c.get('/api/v1/intelligence/worklist', viewer);
      const after = app.metrics.snapshot({
        parser: { jobs: 0, succeeded: 0, rejected: 0, timeouts: 0, memoryKills: 0, failures: 0, busyRejections: 0, queueWaitMs: 0 },
        flags: { 'priority-v1': true, 'similar-v1': true },
        now: new Date(),
        startedAt: new Date(),
        version: 'x',
        nodeVersion: 'x',
      }).components;
      expect((after[0]?.calls ?? 0) - (before[0]?.calls ?? 0)).toBe(1);
      expect((after[1]?.calls ?? 0) - (before[1]?.calls ?? 0)).toBe(1);
      expect(after[1]?.avgCandidatesConsidered).not.toBeNull();
    });

    it('appends intelligence.viewed to the tenant chain with ids and counts only', async () => {
      const since = Number((await admin.query<{ s: string | null }>(`SELECT max(seq) AS s FROM audit_events WHERE tenant_id = $1`, [acmeTenant])).rows[0]?.s ?? 0);
      await c.get('/api/v1/intelligence/worklist?pageSize=3', viewer);
      await c.get(`/api/v1/claims/${acmeClaim}/similar?limit=2`, viewer);
      await c.get(`/api/v1/claims/${acmeClaim}/provenance`, viewer);
      await c.get('/api/v1/features', viewer);
      const rows = (
        await admin.query<{ metadata: Record<string, unknown>; actor_role: string }>(
          `SELECT metadata, actor_role FROM audit_events WHERE tenant_id = $1 AND seq > $2 AND action = 'intelligence.viewed' ORDER BY seq`,
          [acmeTenant, since],
        )
      ).rows;
      expect(rows.map((r) => Object.keys(r.metadata).sort())).toEqual([
        ['kind', 'returned'],
        ['claimId', 'kind', 'returned'],
        ['claimId', 'kind', 'returned'],
      ]);
      expect(rows.map((r) => r.metadata['kind'])).toEqual(['worklist', 'similar', 'provenance']);
      expect(rows.every((r) => r.actor_role === 'VIEWER')).toBe(true);
    });
  });
});
