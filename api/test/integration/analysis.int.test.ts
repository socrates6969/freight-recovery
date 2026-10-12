/**
 * Integration (PostgreSQL + MinIO/S3 + built parse worker): step-5 claim analysis
 * (REQ-20261010-step5-analysis). Import -> commit (AWAITING_ANALYSIS) -> analyze -> packet revision 1
 * (sources, findings, citations, clauses, timeline, integrity) -> four-eyes. Refusals change nothing;
 * concurrent analyses yield exactly one revision; the DB guards refuse direct status/packet writes and map
 * to 409; bulk analyzes each claim in its own transaction; the per-user `analysis` bucket answers 429.
 */
import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp, isAnalysisDbError, toHttpError } from '../../src/app.js';
import { createDb } from '../../src/db/client.js';
import { tenantDb } from '../../src/db/tenant.js';

import { Session, adminUrl, appUrl, baseEnv, canRun, cleanupBatches, deleteBatchObjects, s3, unique } from './import-helpers.js';

const REASON = 'Checked against the original document.';
const enc = (s: string) => new TextEncoder().encode(s);

type Inject = Awaited<ReturnType<FastifyInstance['inject']>>;
const errorOf = (r: Inject) => (r.json() as { error: { code: string; message: string } }).error;

const CLAIM_ANALYZED_KEYS = [
  'bulk',
  'claimId',
  'claimNumber',
  // Step 6 (REQ-20261011-charge-intelligence): classifier/seed versions, label count and learned counts.
  'classifierVersion',
  'contentHash',
  // Hardening (REQ-20261012-hardening, C4.4): the full number of source documents.
  'documentCount',
  'documentIds',
  'findingsCount',
  'fromStatus',
  // Step 7 (REQ-20261011-fuel-outlook, F13): fuel-check status and provenance (flag on, no inputs here).
  'fscTableId',
  'fscTableVersion',
  'fuelCheckStatus',
  'fuelFindingsCount',
  'ignoredFindingsCount',
  'learnedFindingsCount',
  'learnedLabelIds',
  'packetId',
  // Step 7 fix round 1 (L2): sha256 of the fuel table's canonical params (null without inputs).
  'paramsSha256',
  'pendingFindingsCount',
  'pendingReviewCents',
  'perspective',
  'priceDate',
  'priceImportId',
  'recoverableCents',
  'reviewFlagsCount',
  'revision',
  'rulesVersion',
  'seedVersion',
  'tenantLabelCount',
  'toStatus',
];

function ld5001Files(load: string, opts: { duplicateCredit?: boolean } = {}): [string, string][] {
  const credit = opts.duplicateCredit ? 'Charge: Credit | (5.00)\nCharge: Credit | (5.00)\n' : '';
  return [
    ['bol.txt', `DOCUMENT: BILL OF LADING\nLoad Number: ${load}\nFacility: Widget Co DC 4\nAppointment Time: 2025-03-03 08:00\nArrival Time: 2025-03-03 07:45\nDeparture Time: 2025-03-03 11:30\n`],
    [
      'invoice.txt',
      `DOCUMENT: FREIGHT INVOICE\nInvoice Number: INV-1001\nCarrier: Acme Freight LLC\nShipper: Widget Co\nLoad Number: ${load}\nInvoice Date: 2025-03-10\nCharge: Linehaul | 1500.00\nCharge: Fuel Surcharge | 168.00\nCharge: Detention | 300.00\nCharge: Lumper | 150.00\n${credit}Total: $2,118.00\n`,
    ],
    [
      'rate_confirmation.txt',
      `DOCUMENT: RATE CONFIRMATION\nLoad Number: ${load}\nCarrier: Acme Freight LLC\nLinehaul Rate: 1400.00\nFuel Surcharge: 168.00\nDetention Free Hours: 2\nDetention Rate Per Hour: 50.00\nDetention Max Hours: 8\nAuthorized Accessorials: Detention\n`,
    ],
  ];
}

describe.skipIf(!canRun)('claim analysis (PostgreSQL + S3 + sandbox)', () => {
  let app: FastifyInstance;
  let s: Session;
  let admin: pg.Client;
  let acmeId = '';
  const tok: Record<'analyst' | 'reviewer' | 'manager' | 'viewer', string> = { analyst: '', reviewer: '', manager: '', viewer: '' };
  const uid: Record<'analyst' | 'reviewer', string> = { analyst: '', reviewer: '' };
  const batches: string[] = [];
  const claims: string[] = [];
  const client = s3();

  beforeAll(async () => {
    app = await buildApp(baseEnv({ RATE_LIMIT_ANALYSIS_MAX: '1000' }));
    await app.ready();
    s = new Session(app);
    await s.init();
    for (const k of ['analyst', 'reviewer', 'manager', 'viewer'] as const) tok[k] = await s.login(`${k}@acme.test`);
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    acmeId = (await admin.query<{ id: string }>(`SELECT id FROM tenants WHERE slug = 'acme'`)).rows[0]?.id ?? '';
    for (const k of ['analyst', 'reviewer'] as const) uid[k] = (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [`${k}@acme.test`])).rows[0]?.id ?? '';
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      await admin.query('BEGIN');
      await admin.query('SET LOCAL session_replication_role = replica');
      await admin.query(`DELETE FROM approvals WHERE claim_id = ANY($1::uuid[])`, [claims]);
      for (const t of ['packet_findings', 'packet_sources', 'packet_timeline_events']) {
        await admin.query(`DELETE FROM ${t} WHERE packet_id IN (SELECT id FROM evidence_packets WHERE claim_id = ANY($1::uuid[]))`, [claims]);
      }
      await admin.query(`DELETE FROM evidence_packets WHERE claim_id = ANY($1::uuid[])`, [claims]);
      await admin.query('COMMIT');
      await cleanupBatches(admin, batches, claims);
      await deleteBatchObjects(client, acmeId, batches);
      await admin.end();
    }
    await app?.close();
    client.destroy();
  });

  const post = (token: string, url: string, payload?: unknown) =>
    app.inject({ method: 'POST', url, headers: s.headers(token), ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
  const get = (token: string, url: string) => app.inject({ method: 'GET', url, headers: s.headers(token) });

  /** Upload the files as the analyst, commit them, and return the created AWAITING_ANALYSIS claim. */
  async function importClaim(files: [string, string][], perspective: 'SHIPPER' | 'CARRIER' = 'SHIPPER'): Promise<{ id: string; claimNumber: string }> {
    const b = await s.batch(tok.analyst);
    batches.push(b);
    for (const [name, text] of files) {
      const up = await s.upload(tok.analyst, b, name, enc(text));
      expect(up.statusCode, up.body).toBe(201);
      expect((up.json() as { status: string }).status).toBe('ACCEPTED');
    }
    const commit = await post(tok.analyst, `/api/v1/imports/${b}/commit`, { perspective });
    expect(commit.statusCode, commit.body).toBe(200);
    const created = (commit.json() as { created: { claimId: string; claimNumber: string }[] }).created;
    expect(created).toHaveLength(1);
    const c = created[0] as { claimId: string; claimNumber: string };
    claims.push(c.claimId);
    return { id: c.claimId, claimNumber: c.claimNumber };
  }

  const claimRow = async (id: string) =>
    (
      await admin.query<{ status: string; version: number; recoverable_cents: number; pending_review_cents: number; amount_claimed_cents: number; packets: number; events: number }>(
        `SELECT c.status::text AS status, c.version, c.recoverable_cents, c.pending_review_cents, c.amount_claimed_cents,
                (SELECT count(*)::int FROM evidence_packets p WHERE p.claim_id = c.id) AS packets,
                (SELECT count(*)::int FROM audit_events e WHERE e.target_id = c.id::text AND e.action = 'claim.analyzed') AS events
           FROM claims c WHERE c.id = $1`,
        [id],
      )
    ).rows[0];

  it('analyzes an imported claim into packet revision 1 authored by the requester (shipper, LD-5001 values)', async () => {
    const load = `LD-A${unique()}`;
    const claim = await importClaim(ld5001Files(load));
    const before = await claimRow(claim.id);
    expect(before).toMatchObject({ status: 'AWAITING_ANALYSIS', packets: 0, events: 0 });

    const r = await post(tok.analyst, `/api/v1/claims/${claim.id}/analyze`);
    expect(r.statusCode, r.body).toBe(201);
    const body = r.json() as { claim: Record<string, unknown>; packet: { id: string; contentHash: string }; analysis: Record<string, unknown> };
    expect(body).toEqual({
      claim: { id: claim.id, status: 'PENDING_REVIEW', recoverableCents: 32500, pendingReviewCents: 15000, amountClaimedCents: 47500 },
      packet: { id: expect.any(String) as string, revision: 1, status: 'PENDING_REVIEW', contentHash: expect.stringMatching(/^[0-9a-f]{64}$/u) as string },
      analysis: { rulesVersion: 'rules-v1', findingsCount: 3, pendingFindingsCount: 1, ignoredFindingsCount: 0, classifierVersion: 'charge-knn-v1', learnedFindingsCount: 0, reviewFlagsCount: 0, fuelCheckStatus: 'no_inputs', fuelFindingsCount: 0 },
    });
    expect(await claimRow(claim.id)).toMatchObject({
      status: 'PENDING_REVIEW',
      version: (before?.version ?? 0) + 1,
      recoverable_cents: 32500,
      pending_review_cents: 15000,
      amount_claimed_cents: 47500,
      packets: 1,
      events: 1,
    });

    const packet = (await get(tok.analyst, `/api/v1/claims/${claim.id}/packet`)).json() as {
      revision: number;
      status: string;
      perspective: string;
      loadNumber: string;
      demandLetter: string;
      disclaimer: string;
      createdBy: { id: string } | null;
      verifier: unknown;
      integrity: { valid: boolean; contentHash: string };
      approvals: unknown[];
      sources: { id: string; filename: string; docType: string; sizeBytes: number; sha256: string }[];
      timeline: { kind: string; label: string; occurredAt: string; sourceId: string }[];
      findings: { ruleId: string; amountCents: number; needsHumanReview: boolean; citations: { sourceId: string; locator: string; excerpt: string }[]; governingClause: unknown }[];
    };
    expect(packet).toMatchObject({ revision: 1, status: 'PENDING_REVIEW', perspective: 'SHIPPER', loadNumber: load, createdBy: { id: uid.analyst }, approvals: [] });
    expect(packet.verifier).toEqual({ status: 'NOT_RUN', checkedAt: null, note: null });
    expect(packet.integrity).toMatchObject({ valid: true, contentHash: body.packet.contentHash });
    expect(packet.disclaimer).toMatch(/^MVP \/ pre-product output\./u);
    expect(packet.demandLetter).toContain('We request a credit or refund of $325.00 against invoice INV-1001');
    expect(packet.demandLetter).toContain(`Date: ${new Date().toISOString().slice(0, 10)}`);
    // Sources follow link order (one commit links all three: ties on linkedAt are broken by link id).
    const links = await admin.query<{ display_name: string }>(
      `SELECT d.display_name FROM claim_documents l JOIN import_documents d ON d.id = l.document_id WHERE l.claim_id = $1 ORDER BY l.linked_at, l.id`,
      [claim.id],
    );
    expect(packet.sources.map((x) => x.filename)).toEqual(links.rows.map((r) => r.display_name));
    const DOC_TYPES: Record<string, string> = { 'bol.txt': 'BILL_OF_LADING', 'invoice.txt': 'INVOICE', 'rate_confirmation.txt': 'RATE_CONFIRMATION' };
    const files = new Map(ld5001Files(load));
    for (const src of packet.sources) {
      expect(src.docType).toBe(DOC_TYPES[src.filename]);
      expect(src.sizeBytes).toBe(enc(files.get(src.filename) ?? '').length);
    }
    const srcId = (name: string) => packet.sources.find((x) => x.filename === name)?.id;
    const [bolSrc, invSrc, rcSrc] = [srcId('bol.txt'), srcId('invoice.txt'), srcId('rate_confirmation.txt')];
    expect(packet.findings.map((f) => [f.ruleId, f.amountCents, f.needsHumanReview])).toEqual([
      ['INV-LINEHAUL-RATE', 10000, false],
      ['INV-ACCESSORIAL-UNAUTH', 15000, true],
      ['DET-OVERBILLED', 22500, false],
    ]);
    expect(packet.findings[0]?.citations).toEqual([{ sourceId: invSrc, locator: 'invoice.txt:L7', excerpt: 'Charge: Linehaul | 1500.00' }]);
    expect(packet.findings[0]?.governingClause).toEqual({ sourceId: rcSrc, label: 'Contracted linehaul rate', locator: 'rate_confirmation.txt:L4', excerpt: 'Linehaul Rate: 1400.00' });
    expect(packet.findings[1]?.citations).toEqual([{ sourceId: invSrc, locator: 'invoice.txt:L10', excerpt: 'Charge: Lumper | 150.00' }]);
    expect(packet.findings[1]?.governingClause).toMatchObject({ label: 'Authorized accessorials', locator: 'rate_confirmation.txt:L9' });
    expect(packet.findings[2]?.citations).toEqual([
      { sourceId: invSrc, locator: 'invoice.txt:L9', excerpt: 'Charge: Detention | 300.00' },
      { sourceId: bolSrc, locator: 'bol.txt:L4', excerpt: 'Appointment Time: 2025-03-03 08:00' },
      { sourceId: bolSrc, locator: 'bol.txt:L6', excerpt: 'Departure Time: 2025-03-03 11:30' },
      { sourceId: rcSrc, locator: 'rate_confirmation.txt:L7', excerpt: 'Detention Rate Per Hour: 50.00' },
    ]);
    expect(packet.findings[2]?.governingClause).toMatchObject({ label: 'Detention free time', locator: 'rate_confirmation.txt:L6' });
    expect(packet.timeline.map((t) => [t.kind, t.label, t.occurredAt, t.sourceId])).toEqual([
      ['ARRIVAL', 'Arrived at Widget Co DC 4', '2025-03-03T07:45:00.000Z', bolSrc],
      ['APPOINTMENT', 'Appointment time', '2025-03-03T08:00:00.000Z', bolSrc],
      ['DEPARTURE', 'Departed from Widget Co DC 4', '2025-03-03T11:30:00.000Z', bolSrc],
      ['INVOICE', 'Invoice INV-1001 issued', '2025-03-10T00:00:00.000Z', invSrc],
    ]);

    // Audit: exact metadata key set, no names, file names or extracted values.
    const ev = (await admin.query<{ metadata: Record<string, unknown>; actor_id: string; actor_role: string }>(`SELECT metadata, actor_id, actor_role FROM audit_events WHERE action = 'claim.analyzed' AND target_id = $1`, [claim.id]))
      .rows[0];
    expect(Object.keys(ev?.metadata ?? {}).sort()).toEqual(CLAIM_ANALYZED_KEYS);
    expect(ev).toMatchObject({ actor_id: uid.analyst, actor_role: 'ANALYST' });
    expect(ev?.metadata).toMatchObject({ revision: 1, fromStatus: 'AWAITING_ANALYSIS', toStatus: 'PENDING_REVIEW', rulesVersion: 'rules-v1', bulk: false, perspective: 'SHIPPER', recoverableCents: 32500 });
    expect((ev?.metadata['documentIds'] as unknown[]).length).toBe(3);

    // Repeat: 409, nothing changes.
    const again = await post(tok.analyst, `/api/v1/claims/${claim.id}/analyze`, {});
    expect([again.statusCode, errorOf(again).code]).toEqual([409, 'invalid_state']);
    expect(await claimRow(claim.id)).toMatchObject({ packets: 1, events: 1, version: (before?.version ?? 0) + 1 });
  });

  it('the analyzer is a revision author: four-eyes refuses their approval; another approver may approve', async () => {
    const claim = await importClaim(ld5001Files(`LD-F${unique()}`));
    expect((await post(tok.reviewer, `/api/v1/claims/${claim.id}/analyze`)).statusCode).toBe(201);
    const self = await post(tok.reviewer, `/api/v1/claims/${claim.id}/packet/approve`, { packetRevision: 1, reason: REASON, acknowledgePendingFindings: true });
    expect([self.statusCode, errorOf(self).code]).toEqual([403, 'four_eyes_required']);
    const queue = (await get(tok.reviewer, '/api/v1/approvals?pageSize=100&sort=updatedAt:desc')).json() as { items: { id: string; selfAuthored: boolean }[] };
    expect(queue.items.find((i) => i.id === claim.id)?.selfAuthored).toBe(true);
    const ok = await post(tok.manager, `/api/v1/claims/${claim.id}/packet/approve`, { packetRevision: 1, reason: REASON, acknowledgePendingFindings: true });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('carrier perspective stores only own-direction findings (ignored ones are counted)', async () => {
    const claim = await importClaim(ld5001Files(`LD-C${unique()}`), 'CARRIER');
    const r = await post(tok.analyst, `/api/v1/claims/${claim.id}/analyze`);
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ claim: { recoverableCents: 0, pendingReviewCents: 0, amountClaimedCents: 0 }, analysis: { findingsCount: 0, ignoredFindingsCount: 3 } });
    const packet = (await get(tok.analyst, `/api/v1/claims/${claim.id}/packet`)).json() as { findings: unknown[]; demandLetter: string; integrity: { valid: boolean } };
    expect(packet.findings).toEqual([]);
    expect(packet.integrity.valid).toBe(true);
    expect(packet.demandLetter).toContain('No amount is requested: there are no confirmed findings.');
  });

  it('refusals: 403 without permission, 400 body, 404 ids, 409 without accepted documents, 422 unstorable result; nothing changes', async () => {
    const claim = await importClaim(ld5001Files(`LD-N${unique()}`, { duplicateCredit: true }));
    const viewer = await post(tok.viewer, `/api/v1/claims/${claim.id}/analyze`);
    expect([viewer.statusCode, errorOf(viewer).code]).toEqual([403, 'forbidden']);
    const bad = await post(tok.analyst, `/api/v1/claims/${claim.id}/analyze`, { force: true });
    expect([bad.statusCode, errorOf(bad).code]).toEqual([400, 'validation_error']);
    for (const id of ['not-a-uuid', randomUUID()]) {
      const nf = await post(tok.analyst, `/api/v1/claims/${id}/analyze`);
      expect([nf.statusCode, errorOf(nf).code]).toEqual([404, 'not_found']);
    }
    // Duplicate negative credit lines -> INV-DUPLICATE of -5.00 (own direction, negative): not storable.
    const neg = await post(tok.analyst, `/api/v1/claims/${claim.id}/analyze`);
    // Hardening (C4.1): the body also carries the reason code (a negative own-direction amount).
    expect([neg.statusCode, errorOf(neg)]).toEqual([
      422,
      {
        code: 'analysis_input_invalid',
        message: 'The extracted values of this claim cannot be analysed automatically.',
        requestId: expect.any(String) as string,
        details: [{ path: 'analysis', code: 'amount_out_of_range' }],
      },
    ]);
    expect(await claimRow(claim.id)).toMatchObject({ status: 'AWAITING_ANALYSIS', packets: 0, events: 0 });

    // A claim with no linked ACCEPTED document.
    const bare = randomUUID();
    claims.push(bare);
    await admin.query(
      `INSERT INTO claims (id, tenant_id, claim_number, carrier_name, shipper_name, perspective, status, amount_claimed_cents, recoverable_cents, pending_review_cents, updated_at)
       VALUES ($1, $2, $3, '', '', 'SHIPPER', 'AWAITING_ANALYSIS', 0, 0, 0, now())`,
      [bare, acmeId, `AN-${unique()}`],
    );
    const empty = await post(tok.analyst, `/api/v1/claims/${bare}/analyze`);
    expect([empty.statusCode, errorOf(empty).code]).toEqual([409, 'invalid_state']);
    expect(await claimRow(bare)).toMatchObject({ status: 'AWAITING_ANALYSIS', packets: 0, events: 0 });
  });

  it('concurrent analyses of one claim: exactly one 201, the rest 409, one packet and one event', async () => {
    const claim = await importClaim(ld5001Files(`LD-P${unique()}`));
    const before = await claimRow(claim.id);
    const rs = await Promise.all(Array.from({ length: 6 }, () => post(tok.analyst, `/api/v1/claims/${claim.id}/analyze`)));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409, 409, 409]);
    expect(rs.filter((r) => r.statusCode === 409).every((r) => errorOf(r).code === 'invalid_state')).toBe(true);
    expect(await claimRow(claim.id)).toMatchObject({ status: 'PENDING_REVIEW', packets: 1, events: 1, version: (before?.version ?? 0) + 1 });
  });

  it('database guards refuse direct status changes and packet inserts, and map to 409 invalid_state', async () => {
    const id = randomUUID();
    claims.push(id);
    await admin.query(
      `INSERT INTO claims (id, tenant_id, claim_number, carrier_name, shipper_name, perspective, status, amount_claimed_cents, recoverable_cents, pending_review_cents, updated_at)
       VALUES ($1, $2, $3, '', '', 'SHIPPER', 'AWAITING_ANALYSIS', 0, 0, 0, now())`,
      [id, acmeId, `AN-${unique()}`],
    );
    const capture = async (sql: string, params: unknown[]) => {
      try {
        await admin.query(sql, params);
        return null;
      } catch (e) {
        return e as Error & { code?: string };
      }
    };
    const toPending = await capture(`UPDATE claims SET status = 'PENDING_REVIEW' WHERE id = $1`, [id]);
    expect([toPending?.code, toPending?.message]).toEqual(['P0001', 'claim_transition_invalid']);
    expect(toHttpError(toPending)).toMatchObject({ statusCode: 409, code: 'invalid_state', message: 'This action is not allowed in the current state.' });
    const packetInsert = `INSERT INTO evidence_packets (id, tenant_id, claim_id, revision, status, perspective, generated_at, disclaimer, demand_letter, recoverable_cents, pending_review_cents, content_hash, created_by_id)
       VALUES ($1, $2, $3, $4, $5, 'SHIPPER', now(), 'd', 'l', 0, 0, $6, $7)`;
    const noAuthor = await capture(packetInsert, [randomUUID(), acmeId, id, 1, 'PENDING_REVIEW', 'a'.repeat(64), null]);
    expect([noAuthor?.code, noAuthor?.message]).toEqual(['P0001', 'analysis_packet_invalid']);
    const rev2 = await capture(packetInsert, [randomUUID(), acmeId, id, 2, 'PENDING_REVIEW', 'a'.repeat(64), uid.analyst]);
    expect(rev2?.message).toBe('analysis_packet_invalid');
    const approved = await capture(packetInsert, [randomUUID(), acmeId, id, 1, 'APPROVED', 'a'.repeat(64), uid.analyst]);
    expect(approved?.message).toBe('analysis_packet_invalid');
    // A valid revision 1 with an author allows the transition; nothing returns to AWAITING_ANALYSIS.
    expect(await capture(packetInsert, [randomUUID(), acmeId, id, 1, 'PENDING_REVIEW', 'a'.repeat(64), uid.analyst])).toBeNull();
    expect(await capture(`UPDATE claims SET status = 'APPROVED' WHERE id = $1`, [id])).toMatchObject({ message: 'claim_transition_invalid' });
    expect(await capture(`UPDATE claims SET status = 'PENDING_REVIEW' WHERE id = $1`, [id])).toBeNull();
    expect(await capture(`UPDATE claims SET status = 'AWAITING_ANALYSIS' WHERE id = $1`, [id])).toMatchObject({ code: 'P0001', message: 'claim_transition_invalid' });
    // Updates that do not change status are unaffected.
    expect(await capture(`UPDATE claims SET version = version + 1 WHERE id = $1`, [id])).toBeNull();
  });

  it('a guard refusal through Prisma as the runtime role maps to 409 invalid_state (driver adapter error shape)', async () => {
    const id = randomUUID();
    claims.push(id);
    await admin.query(
      `INSERT INTO claims (id, tenant_id, claim_number, carrier_name, shipper_name, perspective, status, amount_claimed_cents, recoverable_cents, pending_review_cents, updated_at)
       VALUES ($1, $2, $3, '', '', 'SHIPPER', 'AWAITING_ANALYSIS', 0, 0, 0, now())`,
      [id, acmeId, `AN-${unique()}`],
    );
    const base = createDb(appUrl ?? '');
    try {
      const db = tenantDb(base, acmeId);
      const fail = <T,>(p: Promise<T>) =>
        p.then(
          () => null,
          (e: unknown) => e,
        );
      const statusErr = await fail(db.tx((tx) => tx.claim.update({ where: { id }, data: { status: 'PENDING_REVIEW' } })));
      const packetErr = await fail(
        db.tx((tx) =>
          tx.evidencePacket.create({
            data: { tenantId: acmeId, claimId: id, revision: 1, status: 'PENDING_REVIEW', perspective: 'SHIPPER', generatedAt: new Date(), disclaimer: 'd', demandLetter: 'l', recoverableCents: 0, pendingReviewCents: 0, contentHash: 'a'.repeat(64) },
          }),
        ),
      );
      for (const err of [statusErr, packetErr]) {
        expect(err).not.toBeNull();
        expect(isAnalysisDbError(err)).toBe(true);
        const mapped = toHttpError(err);
        expect([mapped.statusCode, mapped.code, mapped.message]).toEqual([409, 'invalid_state', 'This action is not allowed in the current state.']);
      }
      expect(await claimRow(id)).toMatchObject({ status: 'AWAITING_ANALYSIS', packets: 0 });
    } finally {
      await base.$disconnect();
    }
  });

  it('bulk analyzes oldest candidates in separate transactions, reports skipped/failed, and audits once', async () => {
    const good = await importClaim(ld5001Files(`LD-B${unique()}`));
    const bad = await importClaim(ld5001Files(`LD-X${unique()}`, { duplicateCredit: true }));
    const viewer = await post(tok.viewer, '/api/v1/claims/analyze-awaiting', { limit: 5 });
    expect([viewer.statusCode, errorOf(viewer).code]).toEqual([403, 'forbidden']);
    for (const limit of [0, 26, 'x']) {
      const r = await post(tok.analyst, '/api/v1/claims/analyze-awaiting', { limit });
      expect([r.statusCode, errorOf(r).code]).toEqual([400, 'validation_error']);
    }
    const r = await post(tok.analyst, '/api/v1/claims/analyze-awaiting', { limit: 25 });
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json() as {
      limit: number;
      examined: number;
      analyzed: { claimId: string; claimNumber: string; findingsCount: number; recoverableCents: number }[];
      skipped: unknown[];
      failed: { claimId: string; claimNumber: string; code: string }[];
      remaining: number;
    };
    // Other suites' leftovers may also be candidates; assert on our claims and the invariants.
    claims.push(...body.analyzed.map((a) => a.claimId).filter((id) => !claims.includes(id)));
    expect(body.limit).toBe(25);
    expect(body.examined).toBe(body.analyzed.length + body.skipped.length + body.failed.length);
    expect(body.analyzed.find((a) => a.claimId === good.id)).toMatchObject({ claimNumber: good.claimNumber, findingsCount: 3, recoverableCents: 32500 });
    expect(body.failed).toContainEqual({ claimId: bad.id, claimNumber: bad.claimNumber, code: 'analysis_input_invalid', reasonCode: 'amount_out_of_range' });
    const remaining = (await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM claims WHERE tenant_id = $1 AND status = 'AWAITING_ANALYSIS'`, [acmeId])).rows[0]?.n;
    expect(body.remaining).toBe(remaining);
    const ev = (await admin.query<{ metadata: Record<string, unknown>; target_type: string; target_id: string }>(
      `SELECT metadata, target_type, target_id FROM audit_events WHERE action = 'claim.bulk_analyzed' AND tenant_id = $1 ORDER BY seq DESC LIMIT 1`,
      [acmeId],
    )).rows[0];
    expect(ev).toMatchObject({ target_type: 'tenant', target_id: acmeId });
    // Hardening (C5.3): the summary also says why the run stopped.
    expect(ev?.metadata).toEqual({
      limit: 25,
      examined: body.examined,
      analyzed: body.analyzed.length,
      skipped: body.skipped.length,
      failed: body.failed.length,
      remaining: body.remaining,
      stoppedBy: (body as unknown as { stoppedBy: string }).stoppedBy,
    });
    const meta = (await admin.query<{ metadata: Record<string, unknown> }>(`SELECT metadata FROM audit_events WHERE action = 'claim.analyzed' AND target_id = $1`, [good.id])).rows[0];
    expect(meta?.metadata['bulk']).toBe(true);
    // A second run never re-analyzes a claim.
    const again = (await post(tok.analyst, '/api/v1/claims/analyze-awaiting', {})).json() as typeof body;
    expect(again.limit).toBe(10);
    expect(again.analyzed.map((a) => a.claimId)).not.toContain(good.id);
  });

  it('the per-user analysis bucket answers 429 with Retry-After before validation and permission', async () => {
    const limited = await buildApp(baseEnv({ RATE_LIMIT_ANALYSIS_MAX: '2', RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_GLOBAL_MAX: '100000' }));
    await limited.ready();
    try {
      const ls = new Session(limited);
      await ls.init();
      const t = await ls.login('viewer@acme.test');
      const hit = () => limited.inject({ method: 'POST', url: `/api/v1/claims/${randomUUID()}/analyze`, headers: ls.headers(t), payload: { bogus: 1 } });
      expect((await hit()).statusCode).toBe(403);
      expect((await hit()).statusCode).toBe(403);
      const third = await hit();
      expect([third.statusCode, errorOf(third).code]).toEqual([429, 'rate_limited']);
      expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
      const bulk = await limited.inject({ method: 'POST', url: '/api/v1/claims/analyze-awaiting', headers: ls.headers(t), payload: {} });
      expect(bulk.statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });
});
