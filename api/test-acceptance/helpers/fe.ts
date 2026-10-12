/* eslint-disable */
// REQ-20261009-four-eyes acceptance helpers (black-box: HTTP, audit API, SQL for DB guarantees).
import { expect } from 'vitest';
import type { Res, Session } from './client.js';
import type { PgClient } from './db.js';
import * as H from './imp.js';

export const FE_CODE = 'four_eyes_required';
export const FE_MESSAGE = 'A different person must make this decision.';
export const FE_CLAIM_TEXT = 'You edited this revision. Another approver must approve it.';
export const FE_DOC_TEXT = 'You uploaded or edited this document. Another reviewer must accept it.';
export const R = 'Four-eyes acceptance reason text';

/** P2: 403 with the fixed body, nothing else (no details, no DB text, no stack). */
export function expectFourEyes(res: Res, label = '') {
  expect(res.status, `${label} ${res.text}`).toBe(403);
  expect(Object.keys(res.body ?? {}), `${label} top-level keys`).toEqual(['error']);
  expect(Object.keys(res.body.error).sort(), `${label} error keys (no details)`).toEqual(['code', 'message', 'requestId']);
  expect(res.body.error.code, label).toBe(FE_CODE);
  expect(res.body.error.message, label).toBe(FE_MESSAGE);
  expect(typeof res.body.error.requestId).toBe('string');
  expect(res.body.error.requestId.length).toBeGreaterThan(0);
  expect(res.text).not.toMatch(/P0001|SQLSTATE|prisma|stack|at [\w$.<>]+ \(|\.ts:\d+|trigger/i);
}

// ---- claims ----
/** `ack = null` omits acknowledgePendingFindings (a default parameter would turn an explicit `undefined` into `true`). */
export const approve = (s: Session, id: string, rev: number, ack: boolean | null = true) =>
  s.post(`/claims/${id}/packet/approve`, ack === null ? { packetRevision: rev, reason: R } : { packetRevision: rev, reason: R, acknowledgePendingFindings: ack });
export const reject = (s: Session, id: string, rev: number) => s.post(`/claims/${id}/packet/reject`, { packetRevision: rev, reason: R });
export const send = (s: Session, id: string, rev: number) => s.post(`/claims/${id}/packet/send`, { packetRevision: rev, reason: R });
let letterN = 0;
export const edit = (s: Session, id: string, base: number) =>
  s.post(`/claims/${id}/packet/revisions`, { baseRevision: base, demandLetter: `Four-eyes edited demand letter ${++letterN}`, reason: R });
export async function editOk(s: Session, id: string, base: number): Promise<number> {
  const r = await edit(s, id, base);
  expect(r.status, `edit by ${s.email}: ${r.text}`).toBe(201);
  expect(r.body.packet.revision).toBe(base + 1);
  return r.body.packet.revision;
}

/** Observable claim state used for the "no side effects" rule (T1). */
export async function claimState(viewer: Session, id: string) {
  const c = (await viewer.get(`/claims/${id}`)).body;
  const p = (await viewer.get(`/claims/${id}/packet`)).body;
  return JSON.stringify({ cs: c.status, cu: c.updatedAt, lp: c.latestPacket, pr: p.revision, ps: p.status, ap: p.approvals });
}

// ---- documents ----
export const rcLines = (load: string) => ['DOCUMENT: RATE CONFIRMATION', `Load Number: ${load}`, 'Carrier: Acme Freight LLC', 'Linehaul Rate: 1400.00', 'Fuel Surcharge: 168.00', 'Detention Free Hours: 2', 'Detention Rate Per Hour: 50.00', 'Detention Max Hours: 8', 'Authorized Accessorials: Detention'];
export async function flaggedPdf(s: Session, tag: string) {
  const batchId = await H.newBatch(s);
  const res = await H.upload(s, batchId, 'rc.pdf', H.buildPdf(rcLines(H.uniqLoad(tag))));
  expect(res.status, res.text).toBe(201);
  expect(res.body.status).toBe('NEEDS_REVIEW');
  expect(res.body.unresolvedFlaggedCount).toBeGreaterThan(0);
  return { batchId, doc: res.body, res };
}
export const docPath = (b: string, d: string) => `/imports/${b}/documents/${d}`;
export const resolveF = (s: Session, b: string, d: string, f: string, body: Record<string, unknown>) => s.post(`${docPath(b, d)}/fields/${f}/resolve`, { reason: R, ...body });
/** `confirmRemaining` null or omitted -> the field is not sent. */
export const accept = (s: Session, b: string, d: string, confirmRemaining?: boolean | null) => s.post(`${docPath(b, d)}/accept`, confirmRemaining === undefined || confirmRemaining === null ? { reason: R } : { reason: R, confirmRemaining });
export const rejectDoc = (s: Session, b: string, d: string) => s.post(`${docPath(b, d)}/reject`, { reason: R });
export const fid = (doc: any, key: string) => (doc.fields as any[]).find((f) => f.key === key).id as string;
export async function docState(viewer: Session, b: string, d: string) {
  const r = await viewer.get(docPath(b, d));
  expect(r.status, r.text).toBe(200);
  const x = r.body;
  return JSON.stringify({ st: x.status, u: x.unresolvedFlaggedCount, f: x.fields.map((f: any) => [f.id, f.status, f.effectiveValue]), dec: x.decisions });
}

// ---- audit ----
/** Events of the requesting tenant newer than `seq`, oldest first. */
export const eventsSince = (admin: Session, seq: number) => H.auditSince(admin, seq);
export const isWorkflowEvent = (a: string) => /^approval\./.test(a) || /^review\./.test(a);

// ---- SQL ----
export interface PgOutcome { ok: boolean; code: string | null; message: string }
export async function pgTry(c: PgClient, sql: string, params?: unknown[]): Promise<PgOutcome> {
  try {
    await c.query(sql, params);
    return { ok: true, code: null, message: '' };
  } catch (e: any) {
    return { ok: false, code: e?.code ?? null, message: String(e?.message ?? e) };
  }
}
/** Run one statement in its own transaction that is always rolled back (savepoint-free). */
export async function inTx(c: PgClient, tenantId: string | null, sql: string, params?: unknown[]): Promise<PgOutcome> {
  await c.query('BEGIN');
  try {
    if (tenantId) await c.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
    return await pgTry(c, sql, params);
  } finally {
    await c.query('ROLLBACK');
  }
}
