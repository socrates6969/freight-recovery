/* eslint-disable */
// REQ-20261010-step5-analysis acceptance helpers (test-spec T1; Part C P1-P11). Black-box: HTTP through buildTestApp,
// audit API, SQL only for DB guarantees and row counts. Synthetic data only.
import { expect } from 'vitest';
import type { Res, Session } from './client.js';
import { type PgClient, withAdmin } from './db.js';
import * as H from './imp.js';

/** [S] should-have bulk scenarios: set ACC_SKIP_BULK=1 when the leader reports the bulk feature was cut. */
export const SKIP_BULK = process.env.ACC_SKIP_BULK === '1';

export const MSG = {
  analysis_input_invalid: 'The extracted values of this claim cannot be analysed automatically.',
  invalid_state: 'This action is not allowed in the current state.',
  not_found: 'Not found.',
  forbidden: 'You do not have permission to perform this action.',
  validation_error: 'Request validation failed.',
  rate_limited: 'Too many requests. Try again later.',
} as const;

export const PACKET_DISCLAIMER =
  'MVP / pre-product output. Extracted values and calculations are unverified against real customer data and must be reviewed by a person before any dispute is sent. This is not legal or financial advice.';
export const P7_ANALYZED_KEYS = ['claimId', 'claimNumber', 'packetId', 'revision', 'contentHash', 'perspective', 'fromStatus', 'toStatus', 'documentIds', 'findingsCount', 'pendingFindingsCount', 'ignoredFindingsCount', 'recoverableCents', 'pendingReviewCents', 'rulesVersion', 'bulk',
  // REQ-20261011-charge-intelligence C9 (additive)
  'classifierVersion', 'seedVersion', 'tenantLabelCount', 'learnedFindingsCount', 'reviewFlagsCount',
  // fix round 1 (C9 amended)
  'learnedLabelIds',
  // REQ-20261011-fuel-outlook F13 (additive)
  'fuelCheckStatus', 'fscTableId', 'fscTableVersion', 'priceImportId', 'priceDate', 'fuelFindingsCount',
  // fix round 1 (F13 amended)
  'paramsSha256',
  // REQ-20261012-hardening C4.4 (additive): full number of source documents (documentIds stays capped at 50)
  'documentCount'];
/** REQ-20261012-hardening fix round 2 C-FR2.2: `claim.analyzed.metadata.learnedLabelIdsTruncated` is true when more than
 *  50 learned labels influenced the analysis, and ABSENT OR FALSE otherwise. Every caller of this helper analyses a claim
 *  with at most 50 influencing labels, so the flag must not be true; a `false` value is dropped so the existing exact
 *  key/metadata pins stay exact for both allowed shapes. */
export const TRUNC_KEY = 'learnedLabelIdsTruncated';
export function baseMeta(m: any): any {
  expect(m?.[TRUNC_KEY] === undefined || m?.[TRUNC_KEY] === false, `${TRUNC_KEY} must be absent or false here (got ${JSON.stringify(m?.[TRUNC_KEY])})`).toBe(true);
  if (m === null || typeof m !== 'object' || !(TRUNC_KEY in m)) return m;
  const { [TRUNC_KEY]: _drop, ...rest } = m;
  return rest;
}
// REQ-20261012-hardening C5.3 (additive): the bulk summary event gains stoppedBy.
export const P7_BULK_KEYS = ['limit', 'examined', 'analyzed', 'skipped', 'failed', 'remaining', 'stoppedBy'];
/** REQ-20261012-hardening C4.1: the three failure reasons of a 422 analysis_input_invalid. */
export const REASON_CODES = ['input_values', 'amount_out_of_range', 'fuel_check'] as const;
/** REQ-20261012-hardening C5.2: stop reasons of a 200 bulk response (`error` only ever appears in the audit event). */
export const STOPPED_BY = ['limit', 'budget', 'candidates'] as const;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** P3: exact error body. Validation errors may add `details`; every other code has exactly code/message/requestId. */
export function expectExact(res: Res, status: number, code: keyof typeof MSG, label = '') {
  expect(res.status, `${label} ${res.text}`).toBe(status);
  expect(Object.keys(res.body ?? {}), `${label} top-level keys`).toEqual(['error']);
  const keys = Object.keys(res.body.error).sort();
  if (code === 'validation_error') expect(keys.filter((k) => k !== 'details'), label).toEqual(['code', 'message', 'requestId']);
  else if (code === 'analysis_input_invalid') {
    // REQ-20261012-hardening C4.1 (additive): the 422 now carries exactly one details entry {path:'analysis', code:<reason>}.
    expect(keys, `${label} error keys`).toEqual(['code', 'details', 'message', 'requestId']);
    expect(res.body.error.details, `${label} details`).toHaveLength(1);
    expect(Object.keys(res.body.error.details[0]).sort(), label).toEqual(['code', 'path']);
    expect(res.body.error.details[0].path, label).toBe('analysis');
    expect(REASON_CODES as readonly string[], `${label} reason`).toContain(res.body.error.details[0].code);
  } else expect(keys, `${label} error keys`).toEqual(['code', 'message', 'requestId']);
  expect(res.body.error.code, label).toBe(code);
  expect(res.body.error.message, label).toBe(MSG[code]);
  expect(typeof res.body.error.requestId).toBe('string');
  expect(res.body.error.requestId.length).toBeGreaterThan(0);
  expect(res.text, `${label}: no internals`).not.toMatch(/P0001|SQLSTATE|prisma|stack|at [\w$.<>]+ \(|\.ts:\d+|trigger|claim_transition_invalid|analysis_packet_invalid/i);
}

// ---- requests ----
/** `body === 'none'` sends the POST without any payload (P2: an absent body is treated as {}). */
export const analyze = (s: Session, id: string, body: unknown | 'none' = {}) =>
  body === 'none' ? s.as('POST', `/claims/${id}/analyze`) : s.post(`/claims/${id}/analyze`, body);
export const bulk = (s: Session, body: unknown = {}) => s.post('/claims/analyze-awaiting', body);

// ---- synthetic documents ----
const S = (t: string) => Buffer.from(t, 'utf8');
export interface FileSpec { name: string; bytes: Buffer }
/** Repository fixture with its load number replaced (seeded CLM-0001/CLM-0002 already own LD-5001/LD-5002). */
export function fixture(rel: string, load: string): FileSpec {
  const t = H.FIX(rel).toString('utf8').replace(/LD-500[12]/g, load);
  return { name: H.base(rel), bytes: S(t) };
}
export const LD5001 = (load: string) => ['ld5001/invoice.txt', 'ld5001/rate_confirmation.txt', 'ld5001/bol.txt'].map((r) => fixture(r, load));
export const LD5002 = (load: string) => ['ld5002/invoice.csv', 'ld5002/ratecon.csv', 'ld5002/bol.csv'].map((r) => fixture(r, load));

export function invoiceFile(load: string, lines: [string, string][], o: { total?: string; invoice?: string; name?: string } = {}): FileSpec {
  const rows = ['DOCUMENT: FREIGHT INVOICE', `Invoice Number: ${o.invoice ?? 'INV-9001'}`, 'Carrier: Synthetic Carrier LLC', 'Shipper: Synthetic Shipper Co', `Load Number: ${load}`, 'Invoice Date: 2025-03-10'];
  for (const [d, a] of lines) rows.push(`Charge: ${d} | ${a}`);
  if (o.total !== undefined) rows.push(`Total: ${o.total}`);
  return { name: o.name ?? 'invoice.txt', bytes: S(rows.join('\n') + '\n') };
}
export function rateFile(load: string, o: { linehaul?: string; fuel?: string; free?: string; rate?: string; max?: string; acc?: string } = {}): FileSpec {
  const rows = ['DOCUMENT: RATE CONFIRMATION', `Load Number: ${load}`, 'Carrier: Synthetic Carrier LLC'];
  if (o.linehaul !== undefined) rows.push(`Linehaul Rate: ${o.linehaul}`);
  if (o.fuel !== undefined) rows.push(`Fuel Surcharge: ${o.fuel}`);
  if (o.free !== undefined) rows.push(`Detention Free Hours: ${o.free}`);
  if (o.rate !== undefined) rows.push(`Detention Rate Per Hour: ${o.rate}`);
  if (o.max !== undefined) rows.push(`Detention Max Hours: ${o.max}`);
  if (o.acc !== undefined) rows.push(`Authorized Accessorials: ${o.acc}`);
  return { name: 'rate_confirmation.txt', bytes: S(rows.join('\n') + '\n') };
}
/** AN-A13 shape: a negative duplicate (the engine yields a negative finding amount -> 422). */
export const badFiles = (load: string) => [invoiceFile(load, [['Credit', '(100.00)'], ['Credit', '(100.00)']])];
/** AN-A14 shape: finding above the INT4 cents range -> 422. */
export const hugeFiles = (load: string) => [invoiceFile(load, [['Linehaul', '999999999999999.00']]), rateFile(load, { linehaul: '1.00' })];
/** Small analyzable claim (one invoice; shipper finding INV-TOTAL-MISMATCH 100.00). */
export const smallFiles = (load: string) => [invoiceFile(load, [['Linehaul', '1000.00']], { total: '1100.00' })];

export interface Made { claimId: string; claimNumber: string; batchId: string; load: string; docs: any[]; files: FileSpec[]; perspective: 'SHIPPER' | 'CARRIER' }
/** Upload -> ACCEPTED (auto, or accepted by `rev`, who is not the uploader) -> commit. Returns the created AWAITING claim. */
export async function makeClaim(up: Session, rev: Session, files: FileSpec[], perspective: 'SHIPPER' | 'CARRIER' = 'SHIPPER', load = ''): Promise<Made> {
  const batchId = await H.newBatch(up);
  const docs: any[] = [];
  for (const f of files) {
    let d = await H.putOk(up, batchId, f.name, f.bytes);
    if (d.status !== 'ACCEPTED') {
      const a = await H.acceptDoc(rev, batchId, d.id, true);
      expect(a.status, `accept ${f.name}: ${a.text}`).toBe(200);
      d = a.body;
    }
    expect(d.status, `${f.name} ACCEPTED`).toBe('ACCEPTED');
    docs.push(d);
  }
  const c = await H.commit(up, batchId, perspective);
  expect(c.status, c.text).toBe(200);
  expect(c.body.created, `commit created exactly one claim: ${c.text}`).toHaveLength(1);
  const cr = c.body.created[0];
  const g = await up.get(`/claims/${cr.claimId}`);
  expect(g.body.status).toBe('AWAITING_ANALYSIS');
  expect(g.body.latestPacket).toBeNull();
  return { claimId: cr.claimId, claimNumber: cr.claimNumber, batchId, load: load || cr.loadNumber, docs, files, perspective };
}
export async function ld5001Claim(up: Session, rev: Session, perspective: 'SHIPPER' | 'CARRIER' = 'SHIPPER', tag = 'A') {
  const load = H.uniqLoad(tag);
  return makeClaim(up, rev, LD5001(load), perspective, load);
}
export async function ld5002Claim(up: Session, rev: Session, perspective: 'SHIPPER' | 'CARRIER' = 'CARRIER', tag = 'B') {
  const load = H.uniqLoad(tag);
  return makeClaim(up, rev, LD5002(load), perspective, load);
}
export async function smallClaim(up: Session, rev: Session, tag = 'S') {
  const load = H.uniqLoad(tag);
  return makeClaim(up, rev, smallFiles(load), 'SHIPPER', load);
}
export async function badClaim(up: Session, rev: Session, tag = 'X') {
  const load = H.uniqLoad(tag);
  return makeClaim(up, rev, badFiles(load), 'SHIPPER', load);
}

// ---- observation ----
export async function dbClaim(id: string) {
  return withAdmin(async (c) => (await c.query(`select status::text as status, version, recoverable_cents, pending_review_cents, amount_claimed_cents, updated_at from claims where id = $1`, [id])).rows[0]);
}
export async function packetRows(id: string): Promise<{ revision: number; created_by_id: string | null; status: string }[]> {
  return withAdmin(async (c) => (await c.query(`select revision, created_by_id, status::text as status from evidence_packets where claim_id = $1 order by revision`, [id])).rows);
}
/** T1 "no side effects" snapshot: claim DTO, packet endpoint status/revision, DB row (version) and packet rows. */
export async function snapshot(viewer: Session, id: string): Promise<string> {
  const c = await viewer.get(`/claims/${id}`);
  const p = await viewer.get(`/claims/${id}/packet`);
  const row = await dbClaim(id);
  const rows = await packetRows(id);
  // REQ-20261012-hardening C4.3: ClaimDetail.analysisFailure changes by design after a 422 (asserted exactly in
  // hardening-failed.acc.test.ts); every other claim field, the DB row and the packet rows must stay identical.
  const { analysisFailure: _af, ...claimRest } = (c.body ?? {}) as Record<string, unknown>;
  void _af;
  return JSON.stringify({ c: claimRest, ps: p.status, pr: p.body?.revision ?? null, pst: p.body?.status ?? null, pa: p.body?.approvals ?? null, row: { ...row, updated_at: String(row?.updated_at) }, rows });
}
export async function eventsSince(admin: Session, seq: number, action?: string) {
  return H.auditSince(admin, seq, action);
}

/** Expected field citation (P5): document display name + field source. */
export async function fieldCitation(viewer: Session, made: { batchId: string }, doc: any, pick: (f: any) => boolean, sourceId: string) {
  const { plain } = (await import('@fr/shared')) as any;
  const res = await H.getDoc(viewer, made.batchId, doc.id);
  expect(res.status, `document detail as ${viewer.email}: ${res.text}`).toBe(200);
  const d = res.body;
  const f = (d.fields as any[]).find((x) => pick(x) && x.effectiveValue !== null);
  expect(f, `field in ${d.displayName}`).toBeTruthy();
  const src = f.source;
  const locator = !src || src.line == null ? `${d.displayName}:manual` : src.page != null ? `${d.displayName}:p${src.page}:L${src.line}` : `${d.displayName}:L${src.line}`;
  return { sourceId, locator, excerpt: plain(src?.excerpt ?? '', 200) };
}
/** The amount field of the charge line whose description is `desc` (n-th occurrence). */
export async function lineCitation(viewer: Session, made: { batchId: string }, invDoc: any, desc: string, sourceId: string, nth = 0) {
  const res = await H.getDoc(viewer, made.batchId, invDoc.id);
  expect(res.status, `document detail as ${viewer.email}: ${res.text}`).toBe(200);
  const d = res.body;
  const gis = (d.fields as any[]).filter((x) => x.key === 'invoice.charge.description' && x.effectiveValue === desc).map((x) => x.groupIndex).sort((a: number, b: number) => a - b);
  expect(gis.length, `line ${desc}`).toBeGreaterThan(nth);
  return fieldCitation(viewer, made, invDoc, (x) => x.key === 'invoice.charge.amount' && x.groupIndex === gis[nth], sourceId);
}

/** UTC calendar date of an ISO instant. */
export const utcDate = (iso: string) => new Date(iso).toISOString().slice(0, 10);
export const replaceDate = (letter: string, day: string) => letter.replace(/^Date: \d{4}-\d{2}-\d{2}$/m, `Date: ${day}`);

/** Run statements in one transaction as freight_app with the tenant set; always rolled back. */
export interface Outcome { ok: boolean; code: string | null; message: string; rowCount: number }
export async function txSteps(c: PgClient, tenantId: string | null, steps: { sql: string; params?: unknown[] }[]): Promise<Outcome[]> {
  const out: Outcome[] = [];
  await c.query('BEGIN');
  try {
    if (tenantId) await c.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
    for (const s of steps) {
      try {
        const r = await c.query(s.sql, s.params);
        out.push({ ok: true, code: null, message: '', rowCount: r.rowCount ?? 0 });
      } catch (e: any) {
        out.push({ ok: false, code: e?.code ?? null, message: String(e?.message ?? e), rowCount: 0 });
        break; // the transaction is aborted
      }
    }
  } finally {
    await c.query('ROLLBACK');
  }
  return out;
}
export function packetInsert(o: { tenant: string; claim: string; revision: number; status?: string; createdBy: string | null; perspective?: string }) {
  return {
    sql: `INSERT INTO evidence_packets (id, tenant_id, claim_id, revision, status, perspective, generated_at, disclaimer, demand_letter, recoverable_cents, pending_review_cents, content_hash, created_by_id)
          VALUES (gen_random_uuid(), $1, $2, $3, $4::"PacketStatus", $5::"Perspective", now(), 'Synthetic acceptance disclaimer', 'Synthetic acceptance letter', 0, 0, $6, $7)`,
    params: [o.tenant, o.claim, o.revision, o.status ?? 'PENDING_REVIEW', o.perspective ?? 'SHIPPER', 'd'.repeat(64), o.createdBy],
  };
}

/** Integer cents of a 2-place DecimalString (exact; no floats). */
export function cents(d: string): number {
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(d);
  if (!m) throw new Error(`not a 2-place decimal: ${d}`);
  const v = Number(m[2]) * 100 + Number(m[3]);
  return m[1] ? -v : v;
}
