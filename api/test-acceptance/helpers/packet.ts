/* eslint-disable */
// Strict C4 Packet DTO validator (test-owned oracle).
import { expect } from 'vitest';

const sorted = (a: string[]) => [...a].sort();
export function keysEqual(o: any, keys: string[], label: string) {
  expect(o && typeof o === 'object' && !Array.isArray(o), `${label} must be an object`).toBe(true);
  expect(sorted(Object.keys(o)), `${label} keys`).toEqual(sorted(keys));
}
const STATUS = ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SEND_READY', 'SUPERSEDED'];
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]00:00)$/;

export function validatePacket(p: any) {
  keysEqual(p, ['id', 'claimId', 'revision', 'status', 'perspective', 'loadNumber', 'generatedAt', 'disclaimer', 'demandLetter', 'currency', 'recoverableCents', 'pendingReviewCents', 'timeline', 'sources', 'findings', 'verifier', 'integrity', 'approvals', 'createdAt', 'createdBy'], 'Packet');
  expect(STATUS).toContain(p.status);
  expect(['SHIPPER', 'CARRIER']).toContain(p.perspective);
  expect(p.currency).toBe('USD');
  expect(Number.isInteger(p.revision) && p.revision >= 1).toBe(true);
  for (const k of ['recoverableCents', 'pendingReviewCents']) expect(Number.isInteger(p[k]) && p[k] >= 0, k).toBe(true);
  expect(p.generatedAt).toMatch(iso);
  expect(p.createdAt).toMatch(iso);
  for (const t of p.timeline) {
    keysEqual(t, ['id', 'occurredAt', 'kind', 'label', 'sourceId'], 'timeline item');
    expect(['APPOINTMENT', 'ARRIVAL', 'DEPARTURE', 'INVOICE', 'RATE_CONFIRMATION', 'NOTE']).toContain(t.kind);
    expect(t.occurredAt).toMatch(iso);
  }
  const times = p.timeline.map((t: any) => Date.parse(t.occurredAt));
  expect(times).toEqual([...times].sort((a: number, b: number) => a - b));
  const srcIds = new Set<string>();
  for (const s of p.sources) {
    keysEqual(s, ['id', 'filename', 'docType', 'sha256', 'sizeBytes'], 'source');
    expect(['INVOICE', 'RATE_CONFIRMATION', 'BILL_OF_LADING', 'OTHER']).toContain(s.docType);
    expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isInteger(s.sizeBytes) && s.sizeBytes >= 0).toBe(true);
    srcIds.add(s.id);
  }
  for (const t of p.timeline) if (t.sourceId !== null) expect(srcIds.has(t.sourceId), 'timeline sourceId resolves').toBe(true);
  for (const f of p.findings) {
    keysEqual(f, ['id', 'ruleId', 'title', 'direction', 'amountCents', 'explanation', 'calculation', 'confidence', 'needsHumanReview', 'citations', 'governingClause'], 'finding');
    expect(['OVERCHARGE', 'UNDERBILLED']).toContain(f.direction);
    expect(Number.isInteger(f.amountCents)).toBe(true);
    expect(f.confidence).toBeGreaterThanOrEqual(0);
    expect(f.confidence).toBeLessThanOrEqual(1);
    expect(typeof f.needsHumanReview).toBe('boolean');
    expect(Array.isArray(f.calculation) && f.calculation.every((x: any) => typeof x === 'string')).toBe(true);
    if (f.amountCents > 0) expect(f.calculation.length, `calculation for ${f.ruleId}`).toBeGreaterThan(0);
    for (const c of f.citations) {
      keysEqual(c, ['sourceId', 'locator', 'excerpt'], 'citation');
      expect(srcIds.has(c.sourceId), 'citation sourceId resolves').toBe(true);
    }
    if (f.governingClause !== null) {
      keysEqual(f.governingClause, ['sourceId', 'label', 'excerpt', 'locator'], 'governingClause');
      expect(srcIds.has(f.governingClause.sourceId), 'clause sourceId resolves').toBe(true);
    }
  }
  keysEqual(p.verifier, ['status', 'checkedAt', 'note'], 'verifier');
  expect(['NOT_RUN', 'PASSED', 'FAILED', 'NEEDS_REVIEW']).toContain(p.verifier.status);
  keysEqual(p.integrity, ['contentHash', 'recomputedHash', 'valid'], 'integrity');
  expect(typeof p.integrity.valid).toBe('boolean');
  for (const a of p.approvals) {
    keysEqual(a, ['id', 'action', 'reason', 'packetRevision', 'fromStatus', 'toStatus', 'actor', 'createdAt'], 'approval');
    expect(['EDIT', 'APPROVE', 'REJECT', 'SEND_READY']).toContain(a.action);
    keysEqual(a.actor, ['id', 'name', 'role'], 'approval.actor');
  }
  const at = p.approvals.map((a: any) => Date.parse(a.createdAt));
  expect(at, 'approvals newest first').toEqual([...at].sort((x: number, y: number) => y - x));
  if (p.createdBy !== null) keysEqual(p.createdBy, ['id', 'name'], 'createdBy');
}

/** Recompute the expected money split from findings (oracle for P4). */
export function moneyFromFindings(p: any) {
  const dir = p.perspective === 'SHIPPER' ? 'OVERCHARGE' : 'UNDERBILLED';
  let rec = 0;
  let pend = 0;
  for (const f of p.findings) {
    if (f.direction !== dir) continue;
    if (f.needsHumanReview) pend += f.amountCents;
    else rec += f.amountCents;
  }
  return { rec, pend };
}

export function allStrings(o: any, out: string[] = []): string[] {
  if (typeof o === 'string') out.push(o);
  else if (Array.isArray(o)) o.forEach((x) => allStrings(x, out));
  else if (o && typeof o === 'object') Object.values(o).forEach((x) => allStrings(x, out));
  return out;
}