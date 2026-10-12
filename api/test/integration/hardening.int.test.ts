/**
 * Integration (real PostgreSQL, migrated + seeded; the analysis part also needs MinIO/S3 and the built parse
 * worker): REQ-20261012-hardening.
 * - database guards of migration 20261018000000_hardening as the runtime role freight_app: the extended
 *   four-eyes trigger (D&D invoice editors, label authors), the deferred packet decision guard (COMMIT) and its
 *   409 mapping, the awaiting-amounts CHECK;
 * - label-author four-eyes through the API (403 + audit basis, queue basis, later relabelling does not exclude);
 * - failed analysis: 422 details, `claim.analysis_failed` in its own transaction with no other write, the claim
 *   detail `analysisFailure`, bulk ordering (failed claims last), `stoppedBy`, the error-path summary;
 * - charge-lines `influence`.
 * Fixture data is synthetic.
 */
import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp, toHttpError } from '../../src/app.js';
import { appendAudit } from '../../src/audit/audit.js';
import { createDb } from '../../src/db/client.js';
import { tenantDb } from '../../src/db/tenant.js';

import { Session, baseEnv, canRun, cleanupBatches, deleteBatchObjects, s3 } from './import-helpers.js';
import { Client, adminUrl, appUrl, canRunDb, step4Env } from './step4-helpers.js';

const REASON = 'Checked against the original document.';
/** Reason of direct approvals inserts: satisfies the BASE CHECK approvals_reason_length (at least 10 characters). */
const DIRECT_REASON = 'Direct insert by the hardening integration test (synthetic).';
const HEX = 'a'.repeat(64);
const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

type Inject = Awaited<ReturnType<FastifyInstance['inject']>>;
const errorOf = (r: Inject) => (r.json() as { error: { code: string; message: string; details?: unknown } }).error;

/** Run `fn` as freight_app inside one transaction with app.tenant_id set; COMMIT when `commit`, else ROLLBACK. */
async function asApp<T>(c: pg.Client, tenant: string, fn: (c: pg.Client) => Promise<T>, commit = false): Promise<T> {
  await c.query('BEGIN');
  try {
    await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
    const out = await fn(c);
    await c.query(commit ? 'COMMIT' : 'ROLLBACK');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
}

/** Run `fn` in one admin transaction; ROLLBACK on any failure so the shared client never stays in an aborted tx. */
async function adminTx(c: pg.Client, fn: (c: pg.Client) => Promise<void>): Promise<void> {
  await c.query('BEGIN');
  try {
    await fn(c);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
}

async function pgError(p: Promise<unknown>): Promise<{ code?: string; message?: string } | null> {
  return p.then(
    () => null,
    (e: unknown) => e as { code?: string; message?: string },
  );
}

describe.skipIf(!canRunDb)('hardening: database guards and label-author four-eyes (PostgreSQL)', () => {
  let admin: pg.Client;
  let runtime: pg.Client;
  let fastify: FastifyInstance;
  let c: Client;
  let acme = '';
  const uid: Record<'manager' | 'reviewer' | 'owner' | 'analyst', string> = { manager: '', reviewer: '', owner: '', analyst: '' };
  const tok: Record<'manager' | 'reviewer', string> = { manager: '', reviewer: '' };
  const claims: string[] = [];
  const labels: string[] = [];
  const ddInvoices: string[] = [];
  const base = createDb(appUrl ?? '');

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    runtime = new pg.Client({ connectionString: appUrl });
    await admin.connect();
    await runtime.connect();
    acme = (await admin.query<{ id: string }>(`SELECT id FROM tenants WHERE slug = 'acme'`)).rows[0]?.id ?? '';
    for (const k of ['manager', 'reviewer', 'owner', 'analyst'] as const) {
      uid[k] = (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [`${k}@acme.test`])).rows[0]?.id ?? '';
    }
    fastify = await buildApp(step4Env());
    await fastify.ready();
    c = await new Client(fastify).init();
    for (const k of ['manager', 'reviewer'] as const) tok[k] = await c.login(`${k}@acme.test`);
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      await admin.query('BEGIN');
      await admin.query('SET LOCAL session_replication_role = replica');
      await admin.query(`DELETE FROM dd_invoices WHERE id = ANY($1::uuid[])`, [ddInvoices]);
      await admin.query(`DELETE FROM approvals WHERE claim_id = ANY($1::uuid[])`, [claims]);
      await admin.query(`DELETE FROM packet_findings WHERE packet_id IN (SELECT id FROM evidence_packets WHERE claim_id = ANY($1::uuid[]))`, [claims]);
      await admin.query(`DELETE FROM evidence_packets WHERE claim_id = ANY($1::uuid[])`, [claims]);
      await admin.query(`DELETE FROM claims WHERE id = ANY($1::uuid[])`, [claims]);
      await admin.query(`DELETE FROM charge_labels WHERE id = ANY($1::uuid[])`, [labels]);
      await admin.query('COMMIT');
      await admin.end();
    }
    await runtime?.end();
    await base.$disconnect();
    await fastify?.close();
  });

  /** A PENDING_REVIEW claim with a seeded-style revision 1 (no recorded creator). Returns claim and packet ids. */
  async function fixtureClaim(status: 'PENDING_REVIEW' | 'AWAITING_ANALYSIS' = 'PENDING_REVIEW'): Promise<{ id: string; packetId: string }> {
    const id = randomUUID();
    const packetId = randomUUID();
    claims.push(id);
    const cents = status === 'AWAITING_ANALYSIS' ? 0 : 1000;
    await admin.query(
      `INSERT INTO claims (id, tenant_id, claim_number, carrier_name, shipper_name, perspective, status, amount_claimed_cents, recoverable_cents,
         pending_review_cents, updated_at)
       VALUES ($1, $2, $3, 'Hardening Carrier (synthetic)', 'Shipper', 'SHIPPER', $4::"ClaimStatus", $5, $5, 0, now())`,
      [id, acme, `HD-${unique()}`, status, cents],
    );
    if (status === 'PENDING_REVIEW') {
      await admin.query(
        `INSERT INTO evidence_packets (id, tenant_id, claim_id, revision, status, perspective, generated_at, disclaimer, demand_letter, recoverable_cents,
           pending_review_cents, content_hash)
         VALUES ($1, $2, $3, 1, 'PENDING_REVIEW', 'SHIPPER', now(), 'd', 'l', 1000, 0, $4)`,
        [packetId, acme, id, HEX],
      );
    }
    return { id, packetId };
  }

  /** A tenant label created by `creator` (with its charge_label.set event), then a claim.analyzed event naming it. */
  async function labelInfluence(claimId: string, creator: string): Promise<string> {
    const db = tenantDb(base, acme);
    const labelId = await db.tx(async (tx) => {
      const label = await tx.chargeLabel.create({
        data: { tenantId: acme, normalizedText: `zz hardening ${unique()}`, description: 'ZZ hardening label (synthetic)', category: 'accessorial', createdById: creator, updatedById: creator, version: 1 },
        select: { id: true },
      });
      await appendAudit(tx, {
        tenantId: acme,
        action: 'charge_label.set',
        actorId: creator,
        actorRole: 'REVIEWER',
        targetType: 'charge_label',
        targetId: label.id,
        metadata: { labelId: label.id, category: 'accessorial', outcome: 'created' },
        ip: '127.0.0.1',
        requestId: 'hardening-int',
      });
      return label.id;
    });
    labels.push(labelId);
    await db.tx((tx) =>
      appendAudit(tx, {
        tenantId: acme,
        action: 'claim.analyzed',
        actorId: uid.analyst,
        actorRole: 'ANALYST',
        targetType: 'claim',
        targetId: claimId,
        metadata: { claimId, learnedLabelIds: [labelId], bulk: false, rulesVersion: 'rules-v1' },
        ip: '127.0.0.1',
        requestId: 'hardening-int',
      }),
    );
    return labelId;
  }

  const insertApproval = (claimId: string, packetId: string, actorId: string, action: 'APPROVE' | 'REJECT' | 'EDIT', toStatus: string) =>
    runtime.query(
      `INSERT INTO approvals (id, tenant_id, claim_id, packet_id, packet_revision, action, reason, from_status, to_status, content_hash, actor_id, actor_role)
       VALUES ($1, $2, $3, $4, 1, $5::"ApprovalAction", $9, 'PENDING_REVIEW', $6, $7, $8, 'MANAGER')`,
      [randomUUID(), acme, claimId, packetId, action, toStatus, HEX, actorId, DIRECT_REASON],
    );

  it('the extended trigger refuses label authors (APPROVE/REJECT) as freight_app; EDIT and other actors pass', async () => {
    const { id, packetId } = await fixtureClaim();
    await labelInfluence(id, uid.reviewer);
    for (const action of ['APPROVE', 'REJECT'] as const) {
      const e = await pgError(asApp(runtime, acme, () => insertApproval(id, packetId, uid.reviewer, action, action === 'APPROVE' ? 'APPROVED' : 'REJECTED')));
      expect([e?.code, e?.message]).toEqual(['P0001', 'four_eyes_required']);
    }
    expect(await pgError(asApp(runtime, acme, () => insertApproval(id, packetId, uid.reviewer, 'EDIT', 'SUPERSEDED')))).toBeNull();
    expect(await pgError(asApp(runtime, acme, () => insertApproval(id, packetId, uid.manager, 'APPROVE', 'APPROVED')))).toBeNull();
    // A missing app.tenant_id cannot hide the rows (SECURITY DEFINER, explicit tenant match): RLS refuses the insert
    // itself, so the refusal is never weaker than with the tenant set.
    const noTenant = await pgError(
      (async () => {
        await runtime.query('BEGIN');
        try {
          await insertApproval(id, packetId, uid.reviewer, 'APPROVE', 'APPROVED');
        } finally {
          await runtime.query('ROLLBACK');
        }
      })(),
    );
    expect(noTenant).not.toBeNull();
  });

  it('the extended trigger refuses D&D invoice editors (row creator/updater) as freight_app', async () => {
    const { id, packetId } = await fixtureClaim();
    const inv = randomUUID();
    ddInvoices.push(inv);
    // An AUDITED invoice satisfies the BASE CHECK dd_invoices_audit_consistent (claim_id, audited_at and
    // audit_snapshot all set); replica mode only skips the triggers, never a CHECK.
    await adminTx(admin, async (a) => {
      await a.query('SET LOCAL session_replication_role = replica');
      await a.query(
        `INSERT INTO dd_invoices (id, tenant_id, status, invoice_number, billing_party_name, data, claim_id, audited_at, audit_snapshot, version, created_by_id,
           updated_by_id, updated_at)
         VALUES ($1, $2, 'AUDITED', $3, 'Synthetic Line', '{}'::jsonb, $4, now(), '{}'::jsonb, 1, $5, $6, now())`,
        [inv, acme, `HD-INV-${unique()}`, id, uid.owner, uid.reviewer],
      );
    });
    for (const actor of [uid.owner, uid.reviewer]) {
      const e = await pgError(asApp(runtime, acme, () => insertApproval(id, packetId, actor, 'APPROVE', 'APPROVED')));
      expect([e?.code, e?.message]).toEqual(['P0001', 'four_eyes_required']);
    }
    expect(await pgError(asApp(runtime, acme, () => insertApproval(id, packetId, uid.manager, 'APPROVE', 'APPROVED')))).toBeNull();
  });

  it('the deferred decision guard fails the COMMIT of a status change without a decision row; with the row it commits', async () => {
    const { id, packetId } = await fixtureClaim();
    const e = await pgError(
      asApp(runtime, acme, (cl) => cl.query(`UPDATE evidence_packets SET status = 'APPROVED' WHERE id = $1`, [packetId]), true),
    );
    expect([e?.code, e?.message]).toEqual(['P0001', 'packet_decision_unrecorded']);
    expect((await admin.query<{ status: string }>(`SELECT status::text AS status FROM evidence_packets WHERE id = $1`, [packetId])).rows[0]?.status).toBe(
      'PENDING_REVIEW',
    );
    // Wrong action for the status is refused too.
    const wrong = await pgError(
      asApp(
        runtime,
        acme,
        async (cl) => {
          await cl.query(`UPDATE evidence_packets SET status = 'REJECTED' WHERE id = $1`, [packetId]);
          await insertApproval(id, packetId, uid.manager, 'APPROVE', 'REJECTED');
        },
        true,
      ),
    );
    expect(wrong?.message).toBe('packet_decision_unrecorded');
    const ok = await pgError(
      asApp(
        runtime,
        acme,
        async (cl) => {
          await cl.query(`UPDATE evidence_packets SET status = 'APPROVED' WHERE id = $1`, [packetId]);
          await insertApproval(id, packetId, uid.manager, 'APPROVE', 'APPROVED');
        },
        true,
      ),
    );
    expect(ok).toBeNull();
  });

  it('a decision-guard refusal through Prisma maps to 409 invalid_state (never 500, never database text)', async () => {
    // PENDING_REVIEW -> APPROVED is a legal packet transition (the BASE invalid_packet_transition trigger lets it
    // through), so the refusal comes from the deferred decision guard at COMMIT.
    const { packetId } = await fixtureClaim();
    const err = await tenantDb(base, acme)
      .tx((tx) => tx.evidencePacket.update({ where: { id: packetId }, data: { status: 'APPROVED' } }))
      .then(
        () => null,
        (x: unknown) => x,
      );
    expect(err).not.toBeNull();
    const mapped = toHttpError(err);
    expect([mapped.statusCode, mapped.code, mapped.message]).toEqual([409, 'invalid_state', 'This action is not allowed in the current state.']);
  });

  it('the CHECK refuses amounts on an AWAITING_ANALYSIS claim', async () => {
    const { id } = await fixtureClaim('AWAITING_ANALYSIS');
    for (const col of ['amount_claimed_cents', 'recoverable_cents', 'pending_review_cents']) {
      const e = await pgError(asApp(runtime, acme, (cl) => cl.query(`UPDATE claims SET ${col} = 1 WHERE id = $1`, [id])));
      expect([col, e?.code]).toEqual([col, '23514']);
    }
    const ins = await pgError(
      admin.query(
        `INSERT INTO claims (id, tenant_id, claim_number, carrier_name, shipper_name, perspective, status, amount_claimed_cents, recoverable_cents, pending_review_cents, updated_at)
         VALUES ($1, $2, $3, '', '', 'SHIPPER', 'AWAITING_ANALYSIS', 5, 5, 0, now())`,
        [randomUUID(), acme, `HD-${unique()}`],
      ),
    );
    expect(ins?.code).toBe('23514');
  });

  it('label authors are refused approve/reject (403, basis label_author, audited); the queue says label_author; others approve', async () => {
    const { id } = await fixtureClaim();
    await labelInfluence(id, uid.reviewer);
    const before = (await admin.query<{ version: number }>(`SELECT version FROM claims WHERE id = $1`, [id])).rows[0]?.version;
    for (const kind of ['approve', 'reject'] as const) {
      const r = await c.send('POST', `/api/v1/claims/${id}/packet/${kind}`, tok.reviewer, { packetRevision: 1, reason: REASON });
      expect(r.statusCode, r.body).toBe(403);
      expect(errorOf(r)).toMatchObject({ code: 'four_eyes_required', message: 'A different person must make this decision.' });
    }
    const events = (
      await admin.query<{ metadata: Record<string, unknown> }>(`SELECT metadata FROM audit_events WHERE action = 'authz.four_eyes_denied' AND target_id = $1 ORDER BY seq`, [id])
    ).rows.map((e) => e.metadata);
    expect(events.map((m) => [m['action'], m['basis']])).toEqual([
      ['APPROVE', 'label_author'],
      ['REJECT', 'label_author'],
    ]);
    expect(Object.keys(events[0] ?? {}).sort()).toEqual(['action', 'basis', 'claimId', 'packetId', 'packetRevision']);
    expect((await admin.query<{ version: number; n: number }>(`SELECT version, (SELECT count(*)::int FROM approvals WHERE claim_id = $1) AS n FROM claims WHERE id = $1`, [id])).rows[0]).toEqual({
      version: before,
      n: 0,
    });

    const queue = async (t: string) =>
      ((await c.get('/api/v1/approvals?pageSize=100&sort=updatedAt:desc', t)).json() as { items: { id: string; selfAuthored: boolean; selfAuthoredBasis: string | null }[] }).items.find(
        (i) => i.id === id,
      );
    expect(await queue(tok.reviewer)).toMatchObject({ selfAuthored: true, selfAuthoredBasis: 'label_author' });
    expect(await queue(tok.manager)).toMatchObject({ selfAuthored: false, selfAuthoredBasis: null });

    // A change of the label by the manager AFTER the analysis does not make the manager a label author.
    await tenantDb(base, acme).tx((tx) =>
      appendAudit(tx, {
        tenantId: acme,
        action: 'charge_label.set',
        actorId: uid.manager,
        actorRole: 'MANAGER',
        targetType: 'charge_label',
        targetId: labels[labels.length - 1] ?? '',
        metadata: { labelId: labels[labels.length - 1] ?? '', category: 'detention', previousCategory: 'accessorial', outcome: 'changed' },
        ip: '127.0.0.1',
        requestId: 'hardening-int',
      }),
    );
    const ok = await c.send('POST', `/api/v1/claims/${id}/packet/approve`, tok.manager, { packetRevision: 1, reason: REASON });
    expect(ok.statusCode, ok.body).toBe(200);
    const verify = await c.get('/api/v1/audit/verify', await c.login('owner@acme.test'));
    expect(verify.json()).toMatchObject({ valid: true });
  });

  it('charge-lines influence: null without claim.analyzed; recorded ids in order with current values or null when deleted', async () => {
    await admin.query(`UPDATE feature_flags SET enabled = true, version = version + 1 WHERE key = 'intelligence.charge_suggestions' AND enabled = false`);
    const { id } = await fixtureClaim('AWAITING_ANALYSIS');
    const none = await c.get(`/api/v1/claims/${id}/charge-lines`, tok.reviewer);
    // The flag is on (seeded on; switched on above only if it was off, so shared-DB state stays as seeded): a 404 here is a failure.
    expect(none.statusCode, none.body).toBe(200);
    expect((none.json() as { influence: unknown }).influence).toBeNull();
    const labelId = await labelInfluence(id, uid.reviewer);
    const r = (await c.get(`/api/v1/claims/${id}/charge-lines`, tok.reviewer)).json() as { influence: { labels: unknown[] } };
    expect(r.influence.labels).toEqual([{ labelId, description: 'ZZ hardening label (synthetic)', category: 'accessorial' }]);
    await admin.query(`DELETE FROM charge_labels WHERE id = $1`, [labelId]);
    const after = (await c.get(`/api/v1/claims/${id}/charge-lines`, tok.reviewer)).json() as { influence: { labels: unknown[] } };
    expect(after.influence.labels).toEqual([{ labelId, description: null, category: null }]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Failed analysis and bulk transparency (needs S3 + the parse worker for imports)
// ---------------------------------------------------------------------------------------------------------------

const enc = (s: string) => new TextEncoder().encode(s);

function files(load: string, opts: { duplicateCredit?: boolean; extraLine?: string } = {}): [string, string][] {
  const credit = opts.duplicateCredit ? 'Charge: Credit | (5.00)\nCharge: Credit | (5.00)\n' : '';
  const extra = opts.extraLine === undefined ? '' : `Charge: ${opts.extraLine} | 75.00\n`;
  const total = opts.extraLine === undefined ? '2,118.00' : '2,193.00';
  return [
    ['bol.txt', `DOCUMENT: BILL OF LADING\nLoad Number: ${load}\nFacility: Widget Co DC 4\nAppointment Time: 2025-03-03 08:00\nArrival Time: 2025-03-03 07:45\nDeparture Time: 2025-03-03 11:30\n`],
    [
      'invoice.txt',
      `DOCUMENT: FREIGHT INVOICE\nInvoice Number: INV-1001\nCarrier: Acme Freight LLC\nShipper: Widget Co\nLoad Number: ${load}\nInvoice Date: 2025-03-10\nCharge: Linehaul | 1500.00\nCharge: Fuel Surcharge | 168.00\nCharge: Detention | 300.00\nCharge: Lumper | 150.00\n${extra}${credit}Total: $${total}\n`,
    ],
    [
      'rate_confirmation.txt',
      `DOCUMENT: RATE CONFIRMATION\nLoad Number: ${load}\nCarrier: Acme Freight LLC\nLinehaul Rate: 1400.00\nFuel Surcharge: 168.00\nDetention Free Hours: 2\nDetention Rate Per Hour: 50.00\nDetention Max Hours: 8\nAuthorized Accessorials: Detention\n`,
    ],
  ];
}

describe.skipIf(!canRun)('hardening: failed analysis and bulk transparency (PostgreSQL + S3 + sandbox)', () => {
  let app: FastifyInstance;
  let s: Session;
  let admin: pg.Client;
  let acme = '';
  const tok: Record<'analyst' | 'viewer' | 'reviewer', string> = { analyst: '', viewer: '', reviewer: '' };
  const labelIds: string[] = [];
  const batches: string[] = [];
  const claims: string[] = [];
  const client = s3();

  beforeAll(async () => {
    app = await buildApp(baseEnv({ RATE_LIMIT_ANALYSIS_MAX: '1000' }));
    await app.ready();
    s = new Session(app);
    await s.init();
    for (const k of ['analyst', 'viewer', 'reviewer'] as const) tok[k] = await s.login(`${k}@acme.test`);
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    acme = (await admin.query<{ id: string }>(`SELECT id FROM tenants WHERE slug = 'acme'`)).rows[0]?.id ?? '';
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
      await admin.query(`DELETE FROM charge_labels WHERE id = ANY($1::uuid[])`, [labelIds]);
      await admin.query('COMMIT');
      await cleanupBatches(admin, batches, claims);
      await deleteBatchObjects(client, acme, batches);
      await admin.end();
    }
    await app?.close();
    client.destroy();
  });

  const post = (token: string, url: string, payload?: unknown) =>
    app.inject({ method: 'POST', url, headers: s.headers(token), ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
  const get = (token: string, url: string) => app.inject({ method: 'GET', url, headers: s.headers(token) });

  async function importClaim(f: [string, string][]): Promise<{ id: string; claimNumber: string }> {
    const b = await s.batch(tok.analyst);
    batches.push(b);
    for (const [name, text] of f) {
      const up = await s.upload(tok.analyst, b, name, enc(text));
      expect(up.statusCode, up.body).toBe(201);
    }
    const commit = await post(tok.analyst, `/api/v1/imports/${b}/commit`, { perspective: 'SHIPPER' });
    expect(commit.statusCode, commit.body).toBe(200);
    const created = (commit.json() as { created: { claimId: string; claimNumber: string }[] }).created[0] as { claimId: string; claimNumber: string };
    claims.push(created.claimId);
    return { id: created.claimId, claimNumber: created.claimNumber };
  }

  const failures = (claimId: string) =>
    admin
      .query<{ actor_id: string; target_type: string; metadata: Record<string, unknown> }>(
        `SELECT actor_id, target_type, metadata FROM audit_events WHERE action = 'claim.analysis_failed' AND target_id = $1 ORDER BY seq`,
        [claimId],
      )
      .then((r) => r.rows);

  it('a 422 carries the reason, appends exactly one claim.analysis_failed and writes nothing else; the claim detail shows it', async () => {
    const bad = await importClaim(files(`LD-HF${unique()}`, { duplicateCredit: true }));
    const before = (await admin.query<{ version: number }>(`SELECT version FROM claims WHERE id = $1`, [bad.id])).rows[0]?.version;
    const detail0 = (await get(tok.viewer, `/api/v1/claims/${bad.id}`)).json() as { analysisFailure: unknown };
    expect(detail0.analysisFailure).toBeNull();

    const r = await post(tok.analyst, `/api/v1/claims/${bad.id}/analyze`);
    expect(r.statusCode, r.body).toBe(422);
    expect(errorOf(r)).toMatchObject({ code: 'analysis_input_invalid', details: [{ path: 'analysis', code: 'amount_out_of_range' }] });
    const ev = await failures(bad.id);
    expect(ev).toHaveLength(1);
    expect(ev[0]?.target_type).toBe('claim');
    expect(ev[0]?.metadata).toEqual({ claimId: bad.id, claimNumber: bad.claimNumber, reasonCode: 'amount_out_of_range', bulk: false, rulesVersion: 'rules-v1', documentCount: 3 });
    const row = (
      await admin.query<{ status: string; version: number; packets: number }>(
        `SELECT status::text AS status, version, (SELECT count(*)::int FROM evidence_packets WHERE claim_id = $1) AS packets FROM claims WHERE id = $1`,
        [bad.id],
      )
    ).rows[0];
    expect(row).toEqual({ status: 'AWAITING_ANALYSIS', version: before, packets: 0 });

    await post(tok.analyst, `/api/v1/claims/${bad.id}/analyze`);
    const detail = (await get(tok.viewer, `/api/v1/claims/${bad.id}`)).json() as { analysisFailure: { reasonCode: string; failedAttempts: number; lastFailedAt: string } };
    expect(detail.analysisFailure).toMatchObject({ reasonCode: 'amount_out_of_range', failedAttempts: 2 });
    expect(new Date(detail.analysisFailure.lastFailedAt).toISOString()).toBe(detail.analysisFailure.lastFailedAt);
    // The list item is unchanged (no analysisFailure field).
    const list = (await get(tok.viewer, `/api/v1/claims?q=${encodeURIComponent(bad.claimNumber)}`)).json() as { items: Record<string, unknown>[] };
    expect(list.items[0]).not.toHaveProperty('analysisFailure');
  });

  it('fix round 2 (C-FR2.1, H-1): an analysis through an UPPER-CASE claim id still excludes the label author (403 label_author)', async () => {
    await admin.query(`UPDATE feature_flags SET enabled = true, version = version + 1 WHERE key = 'intelligence.charge_suggestions' AND enabled = false`);
    // Letters a-f and q only: never contains a fixed-rule accessorial word, so the line stays 'other'.
    const tag = unique().replace(/[^a-f]/gu, 'q');
    const line = `Zz Wrapfix ${tag} Restow`;
    const set = await app.inject({ method: 'PUT', url: '/api/v1/charge-labels', headers: s.headers(tok.reviewer), payload: { description: line, category: 'accessorial' } });
    expect(set.statusCode, set.body).toBe(200);
    const labelId = (set.json() as { label: { id: string } }).label.id;
    labelIds.push(labelId);
    const claim = await importClaim(files(`LD-HU${unique()}`, { extraLine: line }));
    const r = await post(tok.analyst, `/api/v1/claims/${claim.id.toUpperCase()}/analyze`);
    expect(r.statusCode, r.body).toBe(201);
    expect((r.json() as { claim: { id: string } }).claim.id).toBe(claim.id);
    const analyzed = (
      await admin.query<{ target_id: string; metadata: Record<string, unknown> }>(`SELECT target_id, metadata FROM audit_events WHERE action = 'claim.analyzed' AND lower(target_id) = $1`, [
        claim.id,
      ])
    ).rows;
    expect(analyzed.map((a) => a.target_id)).toEqual([claim.id]);
    expect(analyzed[0]?.metadata['claimId']).toBe(claim.id);
    expect(analyzed[0]?.metadata['learnedLabelIds']).toContain(labelId);
    expect(analyzed[0]?.metadata).not.toHaveProperty('learnedLabelIdsTruncated');
    for (const claimPath of [claim.id, claim.id.toUpperCase()]) {
      const a = await post(tok.reviewer, `/api/v1/claims/${claimPath}/packet/approve`, { packetRevision: 1, reason: REASON, acknowledgePendingFindings: true });
      expect([a.statusCode, errorOf(a).code]).toEqual([403, 'four_eyes_required']);
    }
    const denied = (
      await admin.query<{ target_id: string; metadata: Record<string, unknown> }>(
        `SELECT target_id, metadata FROM audit_events WHERE action = 'authz.four_eyes_denied' AND lower(target_id) = $1 ORDER BY seq`,
        [claim.id],
      )
    ).rows;
    expect(denied.map((d) => [d.target_id, d.metadata['basis']])).toEqual([
      [claim.id, 'label_author'],
      [claim.id, 'label_author'],
    ]);
  });

  it('bulk: never-failed claims first, failed items carry reasonCode, stoppedBy and the summary metadata', async () => {
    const bad = await importClaim(files(`LD-HB${unique()}`, { duplicateCredit: true }));
    expect((await post(tok.analyst, `/api/v1/claims/${bad.id}/analyze`)).statusCode).toBe(422);
    const good = await importClaim(files(`LD-HG${unique()}`));
    const r = await post(tok.analyst, '/api/v1/claims/analyze-awaiting', { limit: 1 });
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json() as { analyzed: { claimId: string }[]; failed: { claimId: string; reasonCode: string }[]; stoppedBy: string; examined: number };
    claims.push(...body.analyzed.map((a) => a.claimId).filter((id) => !claims.includes(id)));
    // The failed claim is ordered after every claim without a failure, so a limit-1 run never reaches it first.
    expect(body.failed.map((f) => f.claimId)).not.toContain(bad.id);
    expect(body.analyzed.map((a) => a.claimId)).not.toContain(bad.id);
    if (body.analyzed.length === 1) expect(body.stoppedBy).toBe('limit');
    const ev = (
      await admin.query<{ metadata: Record<string, unknown> }>(`SELECT metadata FROM audit_events WHERE action = 'claim.bulk_analyzed' AND tenant_id = $1 ORDER BY seq DESC LIMIT 1`, [acme])
    ).rows[0];
    expect(Object.keys(ev?.metadata ?? {}).sort()).toEqual(['analyzed', 'examined', 'failed', 'limit', 'remaining', 'skipped', 'stoppedBy']);
    expect(ev?.metadata['stoppedBy']).toBe(body.stoppedBy);

    // A full run reaches the failed claim: failed item with reasonCode, a bulk claim.analysis_failed event.
    const all = (await post(tok.analyst, '/api/v1/claims/analyze-awaiting', { limit: 25 })).json() as typeof body;
    claims.push(...all.analyzed.map((a) => a.claimId).filter((id) => !claims.includes(id)));
    const f = all.failed.find((x) => x.claimId === bad.id);
    if (f) {
      expect(f.reasonCode).toBe('amount_out_of_range');
      expect((await failures(bad.id)).at(-1)?.metadata['bulk']).toBe(true);
    }
    expect(['limit', 'budget', 'candidates']).toContain(all.stoppedBy);
    expect(good.id).toBeTruthy();
  });

  it('an unexpected error during bulk still appends a stoppedBy=error summary and answers 500', async () => {
    await importClaim(files(`LD-HE1${unique()}`));
    await importClaim(files(`LD-HE2${unique()}`));
    const errApp = await buildApp(baseEnv({ RATE_LIMIT_ANALYSIS_MAX: '1000' }));
    try {
      await errApp.ready();
      // Inject a failing limiter for the per-candidate charge (the request's own bucket is unaffected).
      (errApp as unknown as { analysisLimiter: () => Promise<never> }).analysisLimiter = () => Promise.reject(new Error('limiter store down'));
      const es = new Session(errApp);
      await es.init();
      const t = await es.login('analyst@acme.test');
      const r = await errApp.inject({ method: 'POST', url: '/api/v1/claims/analyze-awaiting', headers: es.headers(t), payload: { limit: 25 } });
      expect(r.statusCode, r.body).toBe(500);
      expect(errorOf(r)).toMatchObject({ code: 'internal_error', message: 'Internal server error.' });
      const ev = (
        await admin.query<{ metadata: Record<string, unknown> }>(`SELECT metadata FROM audit_events WHERE action = 'claim.bulk_analyzed' AND tenant_id = $1 ORDER BY seq DESC LIMIT 1`, [acme])
      ).rows[0];
      expect(ev?.metadata).toMatchObject({ stoppedBy: 'error', limit: 25 });
    } finally {
      await errApp.close();
    }
  });
});
