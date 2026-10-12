/* eslint-disable */
// REQ-20261012-hardening acceptance helpers (test-spec T2-T6, T10; Part C C1-C5, C8, C10-C15). Black-box: HTTP through
// buildTestApp, audit rows and DB guarantees over SQL. Synthetic data only.
import { expect } from 'vitest';
import type { Res, Session } from './client.js';
import * as A from './analysis.js';
import { type PgClient, withAdmin } from './db.js';
import * as F from './fe.js';
import * as H from './imp.js';
import * as I from './intel.js';

/** A keyword-`other` invoice line whose nearest example becomes an exact-text team label (step-6 Tier H pattern, CI-U04). */
export const PJ = 'Pallet jack rental';
export const pjFiles = (load: string, desc = PJ) => [A.invoiceFile(load, [['Linehaul', '1500.00'], [desc, '60.00']]), A.rateFile(load, { linehaul: '1500.00' })];
/** Overflow claim: linehaul 30,000,000.00 against a contracted 1.00 (difference above 2,147,483,647 cents), no fuel inputs. */
export const overflowFiles = (load: string) => [A.invoiceFile(load, [['Linehaul', '30000000.00']]), A.rateFile(load, { linehaul: '1.00' })];
/** Analyzable claim with a fuel line (used with extreme fuel tables). The rate confirmation states no fuel surcharge:
 *  a contracted fuel amount makes the fuel check use that amount instead of the table (status contract_amount), so the
 *  table would never be evaluated (test-design fix, Tier H run 2026-10-12). */
export const fuelFiles = (load: string) => [A.invoiceFile(load, [['Linehaul', '1500.00'], ['Fuel surcharge', '435.00']]), A.rateFile(load, { linehaul: '1500.00' })];
/** Valid but extreme fuel table parameters (step size 0.0001, percent rate 100 per step). */
export const EXTREME_TABLE = (name: string) => ({ name, kind: 'step', unit: 'percent', priceSeries: 'diesel_us', effectiveOffsetDays: 2, params: { basePrice: '1.20', stepSize: '0.0001', ratePerStep: '100', bracket: 'above_base' } });
export const FUEL_INPUTS = (fscTableId: string) => ({ shipDate: '2026-10-07', miles: '500.0', fscTableId });

export const putLabel = (s: Session, description: string, category = 'accessorial') => I.put(s, '/charge-labels', { description, category });
export async function putLabelOk(s: Session, description: string, category = 'accessorial', outcome?: string) {
  const r = await putLabel(s, description, category);
  expect(r.status, `label PUT by ${s.email}: ${r.text}`).toBe(200);
  if (outcome) expect(r.body.outcome, `${s.email} outcome`).toBe(outcome);
  return r.body.label.id as string;
}
export const clearLabels = (tenantId: string) => withAdmin(async (c) => { await c.query('delete from charge_labels where tenant_id = $1', [tenantId]); });

export async function analyzeOk(s: Session, claimId: string) {
  const r = await A.analyze(s, claimId);
  expect(r.status, `analyze ${claimId} by ${s.email}: ${r.text}`).toBe(201);
  return r;
}
/** The single claim.analyzed event of the claim (SQL, tenant chain). */
export async function analyzedEvent(tenantId: string, claimId: string): Promise<I.Ev> {
  const ev = (await I.eventsSince(tenantId, 0, 'claim.analyzed')).filter((e) => e.action === 'claim.analyzed' && e.target_id === claimId);
  expect(ev, `one claim.analyzed for ${claimId}`).toHaveLength(1);
  return ev[0]!;
}
export interface Influenced { made: A.Made; packet: any; event: I.Ev }
/** Influenced claim (fixture vocabulary): analysed by `analyser`; asserts that learnedLabelIds contains every id in `labels`. */
export async function influenced(tenantId: string, up: Session, rev: Session, analyser: Session, labels: string[], tag: string, desc = PJ): Promise<Influenced> {
  const load = H.uniqLoad(tag);
  const made = await A.makeClaim(up, rev, pjFiles(load, desc), 'SHIPPER', load);
  await analyzeOk(analyser, made.claimId);
  const event = await analyzedEvent(tenantId, made.claimId);
  for (const id of labels) expect(event.metadata.learnedLabelIds, `fixture: learnedLabelIds of ${made.claimNumber} contains ${id}`).toContain(id);
  const packet = (await analyser.get(`/claims/${made.claimId}/packet`)).body;
  expect(packet.revision).toBe(1);
  return { made, packet, event };
}

export const approvalsOf = (claimId: string) => withAdmin(async (c) => Number((await c.query('select count(*)::int n from approvals where claim_id = $1', [claimId])).rows[0].n));
export async function claimRow(claimId: string) {
  const r = await A.dbClaim(claimId);
  const p = await A.packetRows(claimId);
  return JSON.stringify({ status: r.status, version: r.version, packets: p });
}

/** C1 refusal: exact 403 body, exactly one new authz.four_eyes_denied with the exact metadata, nothing written. */
export async function expectRefusal(tenantId: string, s: Session, inf: { claimId: string; packetId: string; revision: number }, action: 'APPROVE' | 'REJECT', basis: string, label: string) {
  const seq = await I.lastSeq(tenantId);
  const before = await claimRow(inf.claimId);
  const n0 = await approvalsOf(inf.claimId);
  const r = action === 'APPROVE' ? await F.approve(s, inf.claimId, inf.revision) : await F.reject(s, inf.claimId, inf.revision);
  F.expectFourEyes(r, label);
  const ev = await I.eventsSince(tenantId, seq);
  expect(ev.map((e) => e.action), `${label}: exactly one event`).toEqual(['authz.four_eyes_denied']);
  expect(ev[0]!.actor_id, label).toBe(s.user.id);
  expect(ev[0]!.metadata, label).toEqual({ claimId: inf.claimId, packetId: inf.packetId, packetRevision: inf.revision, action, basis });
  expect(await approvalsOf(inf.claimId), `${label}: no approvals row`).toBe(n0);
  expect(await claimRow(inf.claimId), `${label}: claim/packet status and claim version unchanged`).toBe(before);
  return r;
}

/** Approval queue item of a claim for the requesting user (both statuses). */
export async function queueItem(s: Session, claimId: string) {
  const r = await s.get('/approvals?status=PENDING_REVIEW,APPROVED&pageSize=100');
  expect(r.status, r.text).toBe(200);
  for (const it of r.body.items as any[]) {
    expect(it.selfAuthoredBasis === null, `${s.email} ${it.claimNumber}: basis null iff not self-authored`).toBe(it.selfAuthored === false);
    if (it.selfAuthored) expect(['revision_author', 'dd_invoice_editor', 'label_author']).toContain(it.selfAuthoredBasis);
  }
  return (r.body.items as any[]).find((i) => i.id === claimId);
}

// ---- SQL ----
export interface Outcome { ok: boolean; code: string | null; message: string; constraint: string | null; at: string }
/** BEGIN; optional tenant; steps; COMMIT (or ROLLBACK when `commit` is false). Reports the first failure and where. */
export async function tx(c: PgClient, tenantId: string | null, steps: { sql: string; params?: unknown[] }[], commit: boolean): Promise<Outcome> {
  await c.query('BEGIN');
  let i = 0;
  try {
    if (tenantId) await c.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
    for (; i < steps.length; i++) await c.query(steps[i]!.sql, steps[i]!.params);
    if (commit) {
      i = -1;
      await c.query('COMMIT');
    } else await c.query('ROLLBACK');
    return { ok: true, code: null, message: '', constraint: null, at: 'done' };
  } catch (e: any) {
    try { await c.query('ROLLBACK'); } catch { /* already ended */ }
    return { ok: false, code: e?.code ?? null, message: String(e?.message ?? e), constraint: e?.constraint ?? null, at: i === -1 ? 'commit' : `step ${i}` };
  }
}
export function approvalInsert(o: { tenant: string; claim: string; packet: any; action: string; toStatus: string; actorId: string; role: string; fromStatus?: string }) {
  return {
    sql: `INSERT INTO approvals (id, tenant_id, claim_id, packet_id, packet_revision, action, reason, from_status, to_status, content_hash, actor_id, actor_role)
          VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::"ApprovalAction", $6, $7, $8, $9, $10, $11)`,
    params: [o.tenant, o.claim, o.packet.id, o.packet.revision, o.action, F.R, o.fromStatus ?? 'PENDING_REVIEW', o.toStatus, o.packet.integrity?.contentHash ?? 'd'.repeat(64), o.actorId, o.role],
  };
}
export const packetStatus = async (packetId: string) => withAdmin(async (c) => (await c.query('select status::text s from evidence_packets where id = $1', [packetId])).rows[0].s as string);

/** No 500 in any recorded response (HD-R02 / HD-D11). */
export function no500(rs: Res[], label = '') {
  for (const r of rs) expect(r.status, `${label}: ${r.text}`).not.toBe(500);
}
