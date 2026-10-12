/**
 * Integration (PostgreSQL + MinIO/S3 + built parse worker): four-eyes separation of duties
 * (REQ-20261009-four-eyes). Claims: revision authors (any revision) cannot approve/reject; send-ready is
 * open. Documents: uploader and CORRECT/ADD editors cannot accept; API-key uploads are attributed to the
 * key creator. Refusals are 403 four_eyes_required, change nothing, and are audited as
 * authz.four_eyes_denied (fail closed). DB BEFORE INSERT triggers back both rules and map to 403.
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AuditModule from '../../src/audit/audit.js';
import type { AuditInput } from '../../src/audit/audit.js';
import { minimalPdf } from '../helpers/pdf-fixtures.js';

import { Session, adminUrl, appUrl, baseEnv, canRun, cleanupBatches, deleteBatchObjects, s3, unique } from './import-helpers.js';
import { Client, STEP4_TEST_API_KEY_PEPPER } from './step4-helpers.js';

const failOn = new Set<string>();

vi.mock('../../src/audit/audit.js', async (importOriginal) => {
  const real = await importOriginal<typeof AuditModule>();
  return {
    ...real,
    appendAudit: vi.fn(async (tx: Parameters<typeof real.appendAudit>[0], input: AuditInput) => {
      if (failOn.has(input.action)) throw new Error('simulated audit store failure');
      return real.appendAudit(tx, input);
    }),
  };
});

const { buildApp, isFourEyesDbError, toHttpError } = await import('../../src/app.js');
const { createDb } = await import('../../src/db/client.js');
const { tenantDb } = await import('../../src/db/tenant.js');

const REASON = 'Checked against the original document.';
const FOUR_EYES = { code: 'four_eyes_required', message: 'A different person must make this decision.' };
const HEX = 'a'.repeat(64);

type Inject = Awaited<ReturnType<FastifyInstance['inject']>>;
const errorOf = (r: Inject) => (r.json() as { error: { code: string; message: string; requestId: string; details?: unknown } }).error;

describe.skipIf(!canRun)('four-eyes (PostgreSQL + S3 + sandbox)', () => {
  let app: FastifyInstance;
  let s: Session;
  let admin: pg.Client;
  let acmeId = '';
  const tok: Record<'manager' | 'reviewer' | 'owner' | 'analyst', string> = { manager: '', reviewer: '', owner: '', analyst: '' };
  const uid: Record<'manager' | 'reviewer' | 'owner', string> = { manager: '', reviewer: '', owner: '' };
  const claims: string[] = [];
  const batches: string[] = [];
  const keyIds: string[] = [];
  const client = s3();

  beforeAll(async () => {
    app = await buildApp(baseEnv({ API_KEY_PEPPER: STEP4_TEST_API_KEY_PEPPER }));
    await app.ready();
    s = new Session(app);
    await s.init();
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    acmeId = (await admin.query<{ id: string }>(`SELECT id FROM tenants WHERE slug = 'acme'`)).rows[0]?.id ?? '';
    for (const k of ['manager', 'reviewer', 'analyst'] as const) tok[k] = await s.login(`${k}@acme.test`);
    // The owner signs in with the seed TOTP (MFA user).
    tok.owner = await (await new Client(app).init()).login('owner@acme.test');
    for (const k of ['manager', 'reviewer', 'owner'] as const) {
      uid[k] = (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [`${k}@acme.test`])).rows[0]?.id ?? '';
    }
  }, 180_000);

  beforeEach(() => failOn.clear());

  afterAll(async () => {
    if (admin) {
      await admin.query('BEGIN');
      await admin.query('SET LOCAL session_replication_role = replica');
      await admin.query(`DELETE FROM approvals WHERE claim_id = ANY($1::uuid[])`, [claims]);
      for (const t of ['packet_findings', 'packet_sources', 'packet_timeline_events']) {
        await admin.query(`DELETE FROM ${t} WHERE packet_id IN (SELECT id FROM evidence_packets WHERE claim_id = ANY($1::uuid[]))`, [claims]);
      }
      await admin.query(`DELETE FROM evidence_packets WHERE claim_id = ANY($1::uuid[])`, [claims]);
      await admin.query(`DELETE FROM claims WHERE id = ANY($1::uuid[])`, [claims]);
      await admin.query(`DELETE FROM api_keys WHERE id = ANY($1::uuid[])`, [keyIds]);
      await admin.query('COMMIT');
      await cleanupBatches(admin, batches);
      await deleteBatchObjects(client, acmeId, batches);
      await admin.end();
    }
    await app?.close();
    client.destroy();
  });

  /** A PENDING_REVIEW claim with a seeded-style revision 1 (no recorded creator). */
  async function fixtureClaim(opts: { pendingFinding?: boolean } = {}): Promise<string> {
    const id = randomUUID();
    const pid = randomUUID();
    claims.push(id);
    await admin.query(
      `INSERT INTO claims (id, tenant_id, claim_number, carrier_name, shipper_name, perspective, status, amount_claimed_cents, recoverable_cents,
         pending_review_cents, updated_at)
       VALUES ($1, $2, $3, 'Four Eyes Carrier', 'Shipper', 'SHIPPER', 'PENDING_REVIEW', 1000, 1000, 0, now())`,
      [id, acmeId, `FE-${unique()}`],
    );
    await admin.query(
      `INSERT INTO evidence_packets (id, tenant_id, claim_id, revision, status, perspective, generated_at, disclaimer, demand_letter, recoverable_cents,
         pending_review_cents, content_hash)
       VALUES ($1, $2, $3, 1, 'PENDING_REVIEW', 'SHIPPER', now(), 'd', 'l', 1000, 0, $4)`,
      [pid, acmeId, id, HEX],
    );
    if (opts.pendingFinding) {
      await admin.query(
        `INSERT INTO packet_findings (id, tenant_id, packet_id, ordinal, rule_id, title, direction, amount_cents, explanation, calculation, confidence,
           needs_human_review, citations)
         VALUES ($1, $2, $3, 0, 'R', 't', 'OVERCHARGE', 100, 'e', '{}', 0.9, true, '[]')`,
        [randomUUID(), acmeId, pid],
      );
    }
    return id;
  }

  const post = (token: string, url: string, payload: unknown) =>
    app.inject({ method: 'POST', url, headers: s.headers(token), payload: payload as Record<string, unknown> });
  const edit = async (token: string, claimId: string, baseRevision: number) => {
    const r = await post(token, `/api/v1/claims/${claimId}/packet/revisions`, { baseRevision, demandLetter: `Edited demand letter ${unique()}`, reason: REASON });
    expect(r.statusCode, r.body).toBe(201);
  };
  const act = (token: string, claimId: string, kind: 'approve' | 'reject' | 'send', packetRevision: number, extra: Record<string, unknown> = {}) =>
    post(token, `/api/v1/claims/${claimId}/packet/${kind}`, { packetRevision, reason: REASON, ...extra });
  const claimState = async (claimId: string) =>
    (
      await admin.query<{ status: string; version: number; approvals: string; events: number }>(
        `SELECT c.status::text AS status, c.version,
                (SELECT string_agg(a.action::text, ',' ORDER BY a.created_at, a.id) FROM approvals a WHERE a.claim_id = c.id) AS approvals,
                (SELECT count(*)::int FROM audit_events e WHERE e.target_id = c.id::text AND e.action LIKE 'approval.%') AS events
           FROM claims c WHERE c.id = $1`,
        [claimId],
      )
    ).rows[0];
  const fourEyesEvents = (targetId: string) =>
    admin
      .query<{ actor_id: string; actor_role: string; target_type: string; metadata: Record<string, unknown> }>(
        `SELECT actor_id, actor_role, target_type, metadata FROM audit_events WHERE action = 'authz.four_eyes_denied' AND target_id = $1 ORDER BY seq`,
        [targetId],
      )
      .then((r) => r.rows);
  const queueFlag = async (token: string, claimId: string) => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/approvals?pageSize=100&sort=updatedAt:desc', headers: s.headers(token) });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { items: { id: string; selfAuthored: boolean }[] }).items.find((i) => i.id === claimId)?.selfAuthored;
  };

  // ---------------------------------------------------------------------------------------------
  // Claims
  // ---------------------------------------------------------------------------------------------

  it('the revision author cannot approve or reject; nothing changes; refusals are audited; another approver can; the author may send', async () => {
    const id = await fixtureClaim();
    await edit(tok.manager, id, 1);
    const before = await claimState(id);
    const deniedBefore = (await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'authz.denied'`)).rows[0]?.n;

    for (const kind of ['approve', 'reject'] as const) {
      const r = await act(tok.manager, id, kind, 2);
      expect(r.statusCode, r.body).toBe(403);
      expect(errorOf(r)).toMatchObject(FOUR_EYES);
      expect(errorOf(r).details).toBeUndefined();
    }
    expect(await claimState(id)).toEqual(before);
    expect(before?.approvals).toBe('EDIT');
    const events = await fourEyesEvents(id);
    expect(events.map((e) => [e.actor_id, e.actor_role, e.target_type, e.metadata['action'], e.metadata['basis'], e.metadata['packetRevision']])).toEqual([
      [uid.manager, 'MANAGER', 'claim', 'APPROVE', 'revision_author', 2],
      [uid.manager, 'MANAGER', 'claim', 'REJECT', 'revision_author', 2],
    ]);
    expect(Object.keys(events[0]?.metadata ?? {}).sort()).toEqual(['action', 'basis', 'claimId', 'packetId', 'packetRevision']);
    const deniedAfter = (await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'authz.denied'`)).rows[0]?.n;
    expect(deniedAfter).toBe(deniedBefore);

    expect(await queueFlag(tok.manager, id)).toBe(true);
    expect(await queueFlag(tok.reviewer, id)).toBe(false);

    const ok = await act(tok.reviewer, id, 'approve', 2);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await queueFlag(tok.manager, id)).toBe(true);
    // D2: an author may mark send-ready a revision someone else approved.
    const sent = await act(tok.manager, id, 'send', 2);
    expect(sent.statusCode, sent.body).toBe(200);
    expect((await claimState(id))?.approvals).toBe('EDIT,APPROVE,SEND_READY');
    const verify = await app.inject({ method: 'GET', url: '/api/v1/audit/verify', headers: s.headers(tok.owner) });
    expect(verify.statusCode, verify.body).toBe(200);
    expect(verify.json()).toMatchObject({ valid: true });
  });

  it('authors of superseded revisions are excluded too; a third person approves; the approver may send', async () => {
    const id = await fixtureClaim();
    await edit(tok.reviewer, id, 1);
    await edit(tok.manager, id, 2);
    for (const t of [tok.reviewer, tok.manager]) {
      const r = await act(t, id, 'approve', 3);
      expect([r.statusCode, errorOf(r).code]).toEqual([403, 'four_eyes_required']);
    }
    expect(await queueFlag(tok.reviewer, id)).toBe(true);
    expect(await queueFlag(tok.owner, id)).toBe(false);
    const ok = await act(tok.owner, id, 'approve', 3);
    expect(ok.statusCode, ok.body).toBe(200);
    const sent = await act(tok.owner, id, 'send', 3);
    expect(sent.statusCode, sent.body).toBe(200);
  });

  it('precedence: stale_revision and invalid_state before four_eyes_required; four_eyes_required before the 422 acknowledgement', async () => {
    const id = await fixtureClaim({ pendingFinding: true });
    await edit(tok.manager, id, 1);
    const stale = await act(tok.manager, id, 'approve', 1, { acknowledgePendingFindings: true });
    expect([stale.statusCode, errorOf(stale).code]).toEqual([409, 'stale_revision']);
    const noAck = await act(tok.manager, id, 'approve', 2);
    expect([noAck.statusCode, errorOf(noAck).code]).toEqual([403, 'four_eyes_required']);
    const otherNoAck = await act(tok.reviewer, id, 'approve', 2);
    expect([otherNoAck.statusCode, errorOf(otherNoAck).code]).toEqual([422, 'unprocessable']);
    const ok = await act(tok.reviewer, id, 'approve', 2, { acknowledgePendingFindings: true });
    expect(ok.statusCode, ok.body).toBe(200);
    const state = await act(tok.manager, id, 'approve', 2, { acknowledgePendingFindings: true });
    expect([state.statusCode, errorOf(state).code]).toEqual([409, 'invalid_state']);
  });

  it('fails closed (500) when the refusal audit cannot be written; still nothing changes', async () => {
    const id = await fixtureClaim();
    await edit(tok.manager, id, 1);
    const before = await claimState(id);
    failOn.add('authz.four_eyes_denied');
    const r = await act(tok.manager, id, 'approve', 2);
    expect([r.statusCode, errorOf(r).code]).toEqual([500, 'internal_error']);
    expect(await claimState(id)).toEqual(before);
    expect(await fourEyesEvents(id)).toEqual([]);
  });

  // ---------------------------------------------------------------------------------------------
  // Database guarantees
  // ---------------------------------------------------------------------------------------------

  async function expectSqlRefusal(c: pg.Client, sql: string, params: unknown[]): Promise<void> {
    await c.query('SAVEPOINT fe');
    const err = await c.query(sql, params).then(
      () => null,
      (e: unknown) => e as { code?: string; message?: string },
    );
    await c.query('ROLLBACK TO SAVEPOINT fe');
    expect([err?.code, err?.message]).toEqual(['P0001', 'four_eyes_required']);
  }
  const approvalSql = `INSERT INTO approvals (id, tenant_id, claim_id, packet_id, packet_revision, action, reason, from_status, to_status, content_hash, actor_id, actor_role)
     VALUES ($1, $2, $3, $4, $5, $6::"ApprovalAction", 'direct sql insert', 'PENDING_REVIEW', 'APPROVED', $7, $8, 'MANAGER')`;

  it('the approvals trigger refuses APPROVE/REJECT by any revision author, for the owner and for the runtime role without tenant context', async () => {
    const id = await fixtureClaim();
    await edit(tok.reviewer, id, 1);
    await edit(tok.manager, id, 2);
    const p = (await admin.query<{ id: string }>(`SELECT id FROM evidence_packets WHERE claim_id = $1 AND revision = 3`, [id])).rows[0]?.id;
    const args = (action: string, actor: string) => [randomUUID(), acmeId, id, p, 3, action, HEX, actor];
    await admin.query('BEGIN');
    try {
      for (const actor of [uid.manager, uid.reviewer]) {
        for (const action of ['APPROVE', 'REJECT']) await expectSqlRefusal(admin, approvalSql, args(action, actor));
      }
      // EDIT / SEND_READY rows are not checked; a non-author's APPROVE passes the trigger.
      await admin.query(approvalSql, args('EDIT', uid.manager));
      await admin.query(approvalSql, args('SEND_READY', uid.manager));
      await admin.query(approvalSql, args('APPROVE', uid.owner));
    } finally {
      await admin.query('ROLLBACK');
    }

    const runtime = new pg.Client({ connectionString: appUrl });
    await runtime.connect();
    try {
      await runtime.query('BEGIN');
      // No app.tenant_id: the SECURITY DEFINER trigger still sees the author rows and refuses first.
      await expectSqlRefusal(runtime, approvalSql, args('APPROVE', uid.manager));
      await runtime.query('ROLLBACK');
    } finally {
      await runtime.end();
    }
  });

  it('a trigger refusal reaching the app maps to 403 four_eyes_required (Prisma 7 driver adapter error shape)', async () => {
    const id = await fixtureClaim();
    await edit(tok.manager, id, 1);
    const p = (await admin.query<{ id: string }>(`SELECT id FROM evidence_packets WHERE claim_id = $1 AND revision = 2`, [id])).rows[0]?.id ?? '';
    const base = createDb(appUrl ?? '');
    try {
      const err = await tenantDb(base, acmeId)
        .tx((tx) =>
          tx.approval.create({
            data: {
              tenantId: acmeId,
              claimId: id,
              packetId: p,
              packetRevision: 2,
              action: 'APPROVE',
              reason: 'bypassing the service check',
              fromStatus: 'PENDING_REVIEW',
              toStatus: 'APPROVED',
              contentHash: HEX,
              actorId: uid.manager,
              actorRole: 'MANAGER',
            },
          }),
        )
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(err).not.toBeNull();
      expect(isFourEyesDbError(err)).toBe(true);
      const mapped = toHttpError(err);
      expect([mapped.statusCode, mapped.code, mapped.message]).toEqual([403, 'four_eyes_required', FOUR_EYES.message]);
    } finally {
      await base.$disconnect();
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Documents
  // ---------------------------------------------------------------------------------------------

  const flaggedPdf = () => minimalPdf(['DOCUMENT: FREIGHT INVOICE', `Load Number: LD-FE${unique()}`, 'Carrier: Acme Freight LLC', 'Total: $2,118.00']);
  interface Detail {
    id: string;
    status: string;
    selfAuthored: boolean;
    fields: { id: string; key: string }[];
    decisions: { action: string }[];
  }
  const docGet = async (token: string, b: string, d: string) => {
    const r = await app.inject({ method: 'GET', url: `/api/v1/imports/${b}/documents/${d}`, headers: s.headers(token) });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as Detail;
  };
  const decisionsOf = async (docId: string) =>
    (await admin.query<{ action: string }>(`SELECT action::text AS action FROM import_review_decisions WHERE document_id = $1 ORDER BY created_at, id`, [docId])).rows.map(
      (r) => r.action,
    );

  it('the uploader cannot accept (basis uploader); CONFIRM/REJECT do not make an editor; another reviewer accepts; editors may reject', async () => {
    const b = await s.batch(tok.manager);
    batches.push(b);
    const up = await s.upload(tok.manager, b, 'fe.pdf', flaggedPdf());
    expect(up.statusCode, up.body).toBe(201);
    const doc = up.json() as Detail;
    expect([doc.status, doc.selfAuthored]).toEqual(['NEEDS_REVIEW', true]);
    const base = `/api/v1/imports/${b}/documents/${doc.id}`;

    // Uploader refused even with unresolved fields (four-eyes precedes unresolved_fields).
    const self = await post(tok.manager, `${base}/accept`, { reason: REASON });
    expect(self.statusCode, self.body).toBe(403);
    expect(errorOf(self)).toMatchObject(FOUR_EYES);
    expect(await decisionsOf(doc.id)).toEqual([]);
    const ev = await fourEyesEvents(doc.id);
    expect(ev.map((e) => [e.actor_id, e.target_type, e.metadata['action'], e.metadata['basis'], e.metadata['batchId']])).toEqual([
      [uid.manager, 'import_document', 'ACCEPT', 'uploader', b],
    ]);

    expect((await docGet(tok.reviewer, b, doc.id)).selfAuthored).toBe(false);
    const carrier = doc.fields.find((f) => f.key === 'invoice.carrier');
    const load = doc.fields.find((f) => f.key === 'invoice.load_number');
    expect((await post(tok.reviewer, `${base}/fields/${carrier?.id}/resolve`, { action: 'REJECT', reason: REASON })).statusCode).toBe(200);
    expect((await post(tok.reviewer, `${base}/fields/${load?.id}/resolve`, { action: 'CONFIRM', reason: REASON })).statusCode).toBe(200);
    expect((await docGet(tok.reviewer, b, doc.id)).selfAuthored).toBe(false);
    const ok = await post(tok.reviewer, `${base}/accept`, { reason: REASON, confirmRemaining: true });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((ok.json() as Detail).selfAuthored).toBe(false);
    // State check precedes four-eyes.
    const late = await post(tok.manager, `${base}/accept`, { reason: REASON });
    expect([late.statusCode, errorOf(late).code]).toEqual([409, 'invalid_state']);

    // D4: the uploader may reject their own upload.
    const other = (await s.upload(tok.manager, b, 'fe2.pdf', flaggedPdf())).json() as Detail;
    const rej = await post(tok.manager, `/api/v1/imports/${b}/documents/${other.id}/reject`, { reason: REASON });
    expect(rej.statusCode, rej.body).toBe(200);
    expect((rej.json() as Detail).selfAuthored).toBe(true);
  });

  it('a CORRECT editor cannot accept (basis field_editor); the flag follows the edit; a third person accepts', async () => {
    const b = await s.batch(tok.analyst);
    batches.push(b);
    const doc = (await s.upload(tok.analyst, b, 'fe.pdf', flaggedPdf())).json() as Detail;
    const base = `/api/v1/imports/${b}/documents/${doc.id}`;
    expect((await docGet(tok.reviewer, b, doc.id)).selfAuthored).toBe(false);
    const total = doc.fields.find((f) => f.key === 'invoice.total');
    const c = await post(tok.reviewer, `${base}/fields/${total?.id}/resolve`, { action: 'CORRECT', correctedValue: '2000.50', reason: REASON });
    expect(c.statusCode, c.body).toBe(200);
    expect((await docGet(tok.reviewer, b, doc.id)).selfAuthored).toBe(true);
    expect((await docGet(tok.manager, b, doc.id)).selfAuthored).toBe(false);
    const self = await post(tok.reviewer, `${base}/accept`, { reason: REASON, confirmRemaining: true });
    expect([self.statusCode, errorOf(self).code]).toEqual([403, 'four_eyes_required']);
    expect((await fourEyesEvents(doc.id)).map((e) => e.metadata['basis'])).toEqual(['field_editor']);
    expect(await decisionsOf(doc.id)).toEqual(['CORRECT']);
    const ok = await post(tok.manager, `${base}/accept`, { reason: REASON, confirmRemaining: true });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('API-key uploads are attributed to the key creator, who cannot accept the document', async () => {
    const keyId = randomBytes(8).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    const id = randomUUID();
    keyIds.push(id);
    await admin.query(
      `INSERT INTO api_keys (id, tenant_id, key_id, name, secret_hash, scopes, created_by_id, expires_at)
       VALUES ($1, $2, $3, 'four-eyes', $4, $5, $6, now() + interval '1 day')`,
      [id, acmeId, keyId, createHmac('sha256', STEP4_TEST_API_KEY_PEPPER).update(secret).digest('hex'), ['imports.write'], uid.owner],
    );
    const b = await s.batch(tok.owner);
    batches.push(b);
    const up = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${b}/documents?filename=key.pdf`,
      headers: { authorization: `Bearer fr_live_${keyId}_${secret}`, 'content-type': 'application/octet-stream' },
      payload: Buffer.from(flaggedPdf()),
    });
    expect(up.statusCode, up.body).toBe(201);
    const doc = up.json() as Detail;
    expect(doc.selfAuthored).toBe(true);
    const row = (await admin.query<{ uploaded_by_id: string | null }>(`SELECT uploaded_by_id FROM import_documents WHERE id = $1`, [doc.id])).rows[0];
    expect(row?.uploaded_by_id).toBe(uid.owner);
    const queue = (await app.inject({ method: 'GET', url: '/api/v1/reviews?pageSize=100', headers: s.headers(tok.reviewer) })).json() as {
      items: { documentId: string; uploadedBy: { id: string } | null }[];
    };
    expect(queue.items.find((i) => i.documentId === doc.id)?.uploadedBy?.id).toBe(uid.owner);
    const self = await post(tok.owner, `/api/v1/imports/${b}/documents/${doc.id}/accept`, { reason: REASON, confirmRemaining: true });
    expect([self.statusCode, errorOf(self).code]).toEqual([403, 'four_eyes_required']);
    expect((await fourEyesEvents(doc.id)).map((e) => e.metadata['basis'])).toEqual(['uploader']);
  });

  it('the review-decisions trigger refuses ACCEPT by the uploader or a CORRECT/ADD actor, but not by a CONFIRM-only actor', async () => {
    const b = await s.batch(tok.analyst);
    batches.push(b);
    const doc = (await s.upload(tok.analyst, b, 'fe.pdf', flaggedPdf())).json() as Detail;
    const base = `/api/v1/imports/${b}/documents/${doc.id}`;
    const total = doc.fields.find((f) => f.key === 'invoice.total');
    const load = doc.fields.find((f) => f.key === 'invoice.load_number');
    expect((await post(tok.reviewer, `${base}/fields/${total?.id}/resolve`, { action: 'CORRECT', correctedValue: '1.00', reason: REASON })).statusCode).toBe(200);
    expect((await post(tok.manager, `${base}/fields/${load?.id}/resolve`, { action: 'CONFIRM', reason: REASON })).statusCode).toBe(200);
    const analystId = (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = 'analyst@acme.test'`)).rows[0]?.id ?? '';
    const sql = `INSERT INTO import_review_decisions (id, tenant_id, document_id, action, reason, actor_id, actor_role)
       VALUES ($1, $2, $3, 'ACCEPT', 'direct sql insert', $4, 'MANAGER')`;
    await admin.query('BEGIN');
    try {
      await expectSqlRefusal(admin, sql, [randomUUID(), acmeId, doc.id, analystId]);
      await expectSqlRefusal(admin, sql, [randomUUID(), acmeId, doc.id, uid.reviewer]);
      await admin.query(sql, [randomUUID(), acmeId, doc.id, uid.manager]);
    } finally {
      await admin.query('ROLLBACK');
    }
  });
});
