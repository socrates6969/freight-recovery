/**
 * Integration (PostgreSQL + MinIO/S3 + built parse worker): review R46-R51, commit R52, claim documents
 * R53 and the AWAITING_ANALYSIS behaviour of the step-2 routes.
 */
import { crc32 } from 'node:zlib';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { minimalPdf } from '../helpers/pdf-fixtures.js';

import { Session, adminUrl, baseEnv, canRun, cleanupBatches, deleteBatchObjects, objectExists, s3, unique } from './import-helpers.js';

const { buildApp } = await import('../../src/app.js');
const enc = (s: string) => new TextEncoder().encode(s);
const REASON = 'Checked against the original document.';

function png(): Uint8Array {
  const chunk = (type: string, data: number[]) => {
    const body = Uint8Array.from([...enc(type), ...data]);
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    out.set(body, 4);
    new DataView(out.buffer).setUint32(8 + data.length, crc32(body));
    return out;
  };
  const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', [0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0]), chunk('IDAT', [Math.floor(Math.random() * 255)]), chunk('IEND', [])];
  return Uint8Array.from(parts.flatMap((p) => [...p]));
}

interface Field {
  id: string;
  key: string;
  status: string;
  needsReview: boolean;
  effectiveValue: string | null;
  reviewReasons: string[];
}
interface Detail {
  id: string;
  status: string;
  docType: string;
  reviewReasons: string[];
  fields: Field[];
  decisions: { action: string }[];
}

describe.skipIf(!canRun)('review, commit and AWAITING_ANALYSIS (PostgreSQL + S3 + sandbox)', () => {
  let app: FastifyInstance;
  let s: Session;
  let admin: pg.Client;
  let analyst = '';
  let reviewer = '';
  let acmeId = '';
  const batches: string[] = [];
  const createdClaims: string[] = [];
  const client = s3();

  beforeAll(async () => {
    app = await buildApp(baseEnv());
    await app.ready();
    s = new Session(app);
    await s.init();
    analyst = await s.login('analyst@acme.test');
    reviewer = await s.login('reviewer@acme.test');
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    acmeId = (await admin.query<{ id: string }>(`SELECT id FROM tenants WHERE slug = 'acme'`)).rows[0]?.id ?? '';
  }, 120_000);

  afterAll(async () => {
    await cleanupBatches(admin, batches, createdClaims);
    await deleteBatchObjects(client, acmeId, batches);
    await admin?.end();
    await app?.close();
    client.destroy();
  });

  const get = async (url: string, token = reviewer) => app.inject({ method: 'GET', url, headers: s.headers(token) });
  const post = async (url: string, payload: unknown, token = reviewer) => app.inject({ method: 'POST', url, headers: s.headers(token), payload: payload as Record<string, unknown> });

  it('reviews a flagged PDF: unresolved fields block accept; correct/confirm/reject; accept; immutable after', async () => {
    const b = await s.batch(analyst);
    batches.push(b);
    const load = `LD-R${unique()}`;
    const up = await s.upload(analyst, b, 'scan.pdf', minimalPdf(['DOCUMENT: FREIGHT INVOICE', `Load Number: ${load}`, 'Carrier: Acme Freight LLC', 'Total: $2,118.00']));
    const doc = up.json() as Detail;
    expect(doc.status).toBe('NEEDS_REVIEW');
    const base = `/api/v1/imports/${b}/documents/${doc.id}`;

    // Analyst has import:run but not import:review.
    expect((await post(`${base}/accept`, { reason: REASON }, analyst)).statusCode).toBe(403);
    expect((await get('/api/v1/reviews', analyst)).statusCode).toBe(403);
    const queue = (await get('/api/v1/reviews?pageSize=100')).json() as { items: { documentId: string; unresolvedFlaggedCount: number }[] };
    expect(queue.items.find((i) => i.documentId === doc.id)?.unresolvedFlaggedCount).toBe(3);

    const unresolved = await post(`${base}/accept`, { reason: REASON });
    expect([unresolved.statusCode, (unresolved.json() as { error: { code: string } }).error.code]).toEqual([409, 'unresolved_fields']);

    const total = doc.fields.find((f) => f.key === 'invoice.total');
    const carrier = doc.fields.find((f) => f.key === 'invoice.carrier');
    const loadField = doc.fields.find((f) => f.key === 'invoice.load_number');
    expect((await post(`${base}/fields/${total?.id}/resolve`, { action: 'CORRECT', correctedValue: 'twelve', reason: REASON })).statusCode).toBe(400);
    expect((await post(`${base}/fields/${total?.id}/resolve`, { action: 'CORRECT', reason: REASON })).statusCode).toBe(400);
    const corrected = await post(`${base}/fields/${total?.id}/resolve`, { action: 'CORRECT', correctedValue: '$2,000.50', reason: REASON });
    expect(corrected.statusCode, corrected.body).toBe(200);
    expect(corrected.json()).toMatchObject({ status: 'CORRECTED', correctedValue: '2000.50', effectiveValue: '2000.50', resolvedBy: { role: 'REVIEWER' } });
    expect((await post(`${base}/fields/${total?.id}/resolve`, { action: 'CONFIRM', reason: REASON })).statusCode).toBe(409);
    expect((await post(`${base}/fields/${carrier?.id}/resolve`, { action: 'REJECT', reason: REASON })).json()).toMatchObject({ status: 'REJECTED', effectiveValue: null });
    expect((await post(`${base}/fields/${loadField?.id}/resolve`, { action: 'CONFIRM', reason: 'short' })).statusCode).toBe(400);

    const accepted = await post(`${base}/accept`, { reason: REASON, confirmRemaining: true });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const acc = accepted.json() as Detail & { loadNumber: string };
    expect(acc).toMatchObject({ status: 'ACCEPTED', loadNumber: load });
    expect(acc.fields.every((f) => f.status !== 'PROPOSED')).toBe(true);
    expect(acc.decisions.map((d) => d.action)).toContain('ACCEPT');
    expect((await post(`${base}/fields/${loadField?.id}/resolve`, { action: 'REJECT', reason: REASON })).statusCode).toBe(409);
    const decisions = await admin.query(`SELECT action FROM import_review_decisions WHERE document_id = $1`, [doc.id]);
    expect(decisions.rowCount).toBe(4);
  });

  it('an image is keyed in manually: type, fields, then accept; reject deletes the object', async () => {
    const b = await s.batch(analyst);
    batches.push(b);
    const img = (await s.upload(analyst, b, 'scan.png', png())).json() as Detail;
    expect(img).toMatchObject({ status: 'NEEDS_REVIEW', docType: 'OTHER', reviewReasons: ['IMAGE_NO_TEXT_LAYER'], fields: [] });
    const base = `/api/v1/imports/${b}/documents/${img.id}`;
    expect((await post(`${base}/accept`, { reason: REASON, confirmRemaining: true })).statusCode).toBe(409);
    expect((await post(`${base}/fields`, { key: 'invoice.total', value: '5', reason: REASON })).statusCode).toBe(422);
    const typed = await app.inject({ method: 'PATCH', url: base, headers: s.headers(reviewer), payload: { docType: 'INVOICE' } });
    expect(typed.statusCode, typed.body).toBe(200);
    expect(typed.json()).toMatchObject({ docType: 'INVOICE', docTypeBasis: 'MANUAL', reviewReasons: ['NO_FIELDS', 'MISSING_LOAD_NUMBER', 'IMAGE_NO_TEXT_LAYER'] });
    expect((await post(`${base}/fields`, { key: 'bol.load_number', value: 'L', reason: REASON })).statusCode).toBe(422);
    expect((await post(`${base}/fields`, { key: 'invoice.total', value: 'abc', reason: REASON })).statusCode).toBe(400);
    const load = `LD-I${unique()}`;
    const added = await post(`${base}/fields`, { key: 'invoice.load_number', value: load, reason: REASON });
    expect(added.statusCode, added.body).toBe(201);
    expect(added.json()).toMatchObject({ origin: 'MANUAL', status: 'CONFIRMED', confidence: 1, source: null, value: load });
    expect((await post(`${base}/fields`, { key: 'invoice.load_number', value: 'again', reason: REASON })).statusCode).toBe(409);
    const c1 = (await post(`${base}/fields`, { key: 'invoice.charge.description', value: 'Detention', reason: REASON })).json() as { groupIndex: number };
    const c2 = (await post(`${base}/fields`, { key: 'invoice.charge.amount', value: '(150.00)', reason: REASON })).json() as { groupIndex: number; value: string };
    expect([c1.groupIndex, c2.groupIndex, c2.value]).toEqual([0, 0, '-150.00']);
    const accepted = await post(`${base}/accept`, { reason: REASON });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect((accepted.json() as Detail).status).toBe('ACCEPTED');

    const other = (await s.upload(analyst, b, 'other.png', png())).json() as Detail;
    const rej = await post(`/api/v1/imports/${b}/documents/${other.id}/reject`, { reason: REASON });
    expect(rej.statusCode).toBe(200);
    expect(rej.json()).toMatchObject({ status: 'REJECTED', rejectReason: 'reviewer_rejected' });
    expect(await objectExists(client, `t/${acmeId}/imports/${b}/${other.id}/original`)).toBe(false);
  });

  it('commit creates AWAITING_ANALYSIS claims, is idempotent, and links to existing claims without touching packets', async () => {
    const b = await s.batch(analyst);
    batches.push(b);
    const load = `ld-c${unique()}`;
    const inv = await s.upload(analyst, b, 'inv.txt', enc(`Document: Invoice\nInvoice Number: INV-${unique()}\nLoad Number: ${load}\nCarrier: Acme Freight LLC\nShipper: Widget Co\nInvoice Date: 03/10/2025\nTotal: 10.00\n`));
    const bol = await s.upload(analyst, b, 'bol.txt', enc(`Document: Bill of Lading\nLoad Number:  ${load.toUpperCase()} \nArrival Time: 2025-03-03 07:45\n`));
    const existing = await s.upload(analyst, b, 'rc.txt', enc(`Document: Rate Confirmation\nLoad Number: LD-5001\nLinehaul Rate: 1400.00\nNote: ${unique()}\n`));
    const flagged = await s.upload(analyst, b, 'flag.pdf', minimalPdf(['DOCUMENT: FREIGHT INVOICE', `Load Number: X-${unique()}`]));
    for (const r of [inv, bol, existing]) expect((r.json() as Detail).status).toBe('ACCEPTED');
    const packetBefore = await admin.query(`SELECT p.content_hash, p.status FROM evidence_packets p JOIN claims c ON c.id = p.claim_id WHERE c.claim_number = 'CLM-0001' AND c.tenant_id = $1`, [acmeId]);

    expect((await post(`/api/v1/imports/${b}/commit`, { perspective: 'BOTH' }, analyst)).statusCode).toBe(400);
    const commit = await post(`/api/v1/imports/${b}/commit`, { perspective: 'SHIPPER' }, analyst);
    expect(commit.statusCode, commit.body).toBe(200);
    const res = commit.json() as {
      created: { claimId: string; claimNumber: string; loadNumber: string }[];
      updated: { claimNumber: string; note: string }[];
      skipped: { documentId: string; reason: string }[];
    };
    createdClaims.push(...res.created.map((c) => c.claimId));
    expect(res.created).toHaveLength(1);
    expect(res.created[0]?.claimNumber).toMatch(/^CLM-\d{4,}$/u);
    expect(Number(res.created[0]?.claimNumber.slice(4))).toBeGreaterThan(24);
    expect(res.updated).toEqual([{ claimId: expect.any(String) as string, claimNumber: 'CLM-0001', loadNumber: 'LD-5001', note: 'new_evidence_not_in_packet' }]);
    expect(res.skipped).toEqual([{ documentId: (flagged.json() as Detail).id, reason: 'not_accepted' }]);
    const packetAfter = await admin.query(`SELECT p.content_hash, p.status FROM evidence_packets p JOIN claims c ON c.id = p.claim_id WHERE c.claim_number = 'CLM-0001' AND c.tenant_id = $1`, [acmeId]);
    expect(packetAfter.rows).toEqual(packetBefore.rows);

    const again = (await post(`/api/v1/imports/${b}/commit`, { perspective: 'SHIPPER' }, analyst)).json() as typeof res;
    expect([again.created.length, again.updated.length]).toEqual([0, 0]);
    expect(again.skipped.filter((x) => x.reason === 'already_linked')).toHaveLength(3);

    const claimId = res.created[0]?.claimId ?? '';
    const claim = (await get(`/api/v1/claims/${claimId}`, analyst)).json() as Record<string, unknown>;
    expect(claim).toMatchObject({ status: 'AWAITING_ANALYSIS', latestPacket: null, amountClaimedCents: 0, carrierName: 'Acme Freight LLC', shipperName: 'Widget Co', loadNumber: load, invoiceDate: '2025-03-10T00:00:00.000Z' });
    const docs = (await get(`/api/v1/claims/${claimId}/documents`, analyst)).json() as { items: { displayName: string; sha256: string }[] };
    expect(docs.items.map((d) => d.displayName).sort()).toEqual(['bol.txt', 'inv.txt']);
    const viewer = await s.login('viewer@acme.test');
    expect((await get(`/api/v1/claims/${claimId}/documents`, viewer)).statusCode).toBe(200);

    // Step-2 routes are total over AWAITING_ANALYSIS.
    expect((await get(`/api/v1/claims/${claimId}/packet`)).statusCode).toBe(404);
    for (const [path, body] of [
      ['approve', { packetRevision: 1, reason: REASON }],
      ['reject', { packetRevision: 1, reason: REASON }],
      ['send', { packetRevision: 1, reason: REASON }],
      ['revisions', { baseRevision: 1, demandLetter: 'x', reason: REASON }],
    ] as const) {
      const manager = await s.login('manager@acme.test');
      const r = await post(`/api/v1/claims/${claimId}/packet/${path}`, body, manager);
      expect([path, r.statusCode]).toEqual([path, 409]);
    }
    const approvals = (await get('/api/v1/approvals?pageSize=100')).json() as { items: { id: string }[] };
    expect(approvals.items.some((i) => i.id === claimId)).toBe(false);
    const filtered = (await get('/api/v1/claims?status=AWAITING_ANALYSIS&pageSize=100', analyst)).json() as { items: { id: string; status: string }[] };
    expect(filtered.items.some((i) => i.id === claimId)).toBe(true);
    expect(filtered.items.every((i) => i.status === 'AWAITING_ANALYSIS')).toBe(true);
  });

  it('fix round 1 (D12): load numbers differing only in case and inner whitespace map to one claim', async () => {
    const tag = unique();
    const doc = (load: string) => enc(`Document: Rate Confirmation\nLoad Number: ${load}\nLinehaul Rate: 900.00\nNote: ${unique()}\n`);
    const commitOne = async (load: string) => {
      const b = await s.batch(analyst);
      batches.push(b);
      const up = await s.upload(analyst, b, 'rc.txt', doc(load));
      expect((up.json() as Detail).status).toBe('ACCEPTED');
      const r = await post(`/api/v1/imports/${b}/commit`, { perspective: 'CARRIER' }, analyst);
      expect(r.statusCode, r.body).toBe(200);
      const res = r.json() as { created: { claimId: string; loadNumber: string }[]; updated: { claimId: string }[] };
      createdClaims.push(...res.created.map((c) => c.claimId));
      return res;
    };
    const first = await commitOne(`LD  TPV  ${tag}`);
    expect(first.created).toHaveLength(1);
    expect(first.created[0]?.loadNumber).toBe(`LD TPV ${tag}`);
    const second = await commitOne(`ld tpv ${tag.toUpperCase()}`);
    expect([second.created.length, second.updated.map((u) => u.claimId)]).toEqual([0, [first.created[0]?.claimId]]);

    // A claim stored before this fix with inner whitespace runs is still found (SQL-side normalization).
    const legacyTag = unique();
    const legacyId = `00000000-0000-4000-8000-${legacyTag.padEnd(12, '0').slice(0, 12).replace(/[^0-9a-f]/gu, 'b')}`;
    await admin.query(
      `INSERT INTO claims (id, tenant_id, claim_number, load_number, carrier_name, shipper_name, perspective, status, amount_claimed_cents,
         recoverable_cents, pending_review_cents, updated_at)
       VALUES ($1, $2, $3, $4, '', '', 'CARRIER', 'AWAITING_ANALYSIS', 0, 0, 0, now())`,
      [legacyId, acmeId, `CLM-LEGACY-${legacyTag}`, `LD   TPV\t${legacyTag}`],
    );
    createdClaims.push(legacyId);
    const third = await commitOne(`ld tpv ${legacyTag}`);
    expect([third.created.length, third.updated.map((u) => u.claimId)]).toEqual([0, [legacyId]]);
  });
});
