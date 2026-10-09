/**
 * R60 pipeline health (Q5.1): assembles the cross-tenant aggregates returned by the SECURITY DEFINER
 * function fr_platform_pipeline_stats into the PipelineHealth DTO. Missing buckets are zero-filled here;
 * nothing tenant-identifying exists in the input rows.
 */
import { PIPELINE_WINDOW_SECONDS, type PipelineHealthDto, type PipelineWindow } from '@fr/shared';

import type { PipelineStatRow } from '../db/system.js';

const STATUSES = ['RECEIVED', 'NEEDS_REVIEW', 'ACCEPTED', 'REJECTED', 'FAILED'] as const;
const DETECTED = ['PDF', 'PNG', 'JPEG', 'CSV', 'TXT'] as const;

/** count/total rounded half-up to 4 decimals; null when total = 0. */
export function rate(count: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((count / total) * 10000) / 10000;
}

export function windowSeconds(w: PipelineWindow): number {
  return PIPELINE_WINDOW_SECONDS[w];
}

export function assemblePipelineHealth(rows: readonly PipelineStatRow[], window: PipelineWindow, now: Date, version: string): PipelineHealthDto {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<(typeof STATUSES)[number], number>;
  const byDetectedType = Object.fromEntries(DETECTED.map((s) => [s, 0])) as Record<(typeof DETECTED)[number], number>;
  const rejected: { reason: string; count: number }[] = [];
  let uploadToParse = { n: 0, p50: null as number | null, p95: null as number | null };
  let reviewDepth = 0;
  let oldestMs: number | null = null;
  let staleReceived = 0;
  let awaitingAnalysis = 0;

  for (const r of rows) {
    switch (r.metric) {
      case 'status':
        if ((STATUSES as readonly string[]).includes(r.label)) byStatus[r.label as (typeof STATUSES)[number]] += r.n;
        break;
      case 'detected_type':
        if ((DETECTED as readonly string[]).includes(r.label)) byDetectedType[r.label as (typeof DETECTED)[number]] += r.n;
        break;
      case 'reject_reason':
        if (/^[a-z0-9_]{1,64}$/u.test(r.label)) rejected.push({ reason: r.label, count: r.n });
        else rejected.push({ reason: 'unknown', count: r.n });
        break;
      case 'upload_to_parse':
        uploadToParse = { n: r.n, p50: r.n > 0 ? r.p50Ms : null, p95: r.n > 0 ? r.p95Ms : null };
        break;
      case 'review_queue':
        reviewDepth = r.n;
        oldestMs = r.n > 0 ? r.p50Ms : null;
        break;
      case 'stale_received':
        staleReceived = r.n;
        break;
      case 'awaiting_analysis':
        awaitingAnalysis = r.n;
        break;
      default:
        break;
    }
  }
  // Merge duplicate reasons (e.g. several unexpected labels mapped to "unknown"), then order.
  const merged = new Map<string, number>();
  for (const r of rejected) merged.set(r.reason, (merged.get(r.reason) ?? 0) + r.count);
  const rejectedByReason = [...merged.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
  const total = STATUSES.reduce((a, s) => a + byStatus[s], 0);
  return {
    scope: 'all_tenants_aggregate',
    window,
    generatedAt: now.toISOString(),
    version,
    db: 'ok',
    documents: { total, byStatus, byDetectedType, rejectedByReason },
    rates: { rejected: rate(byStatus.REJECTED, total), failed: rate(byStatus.FAILED, total), needsReview: rate(byStatus.NEEDS_REVIEW, total) },
    uploadToParseMs: uploadToParse,
    reviewQueue: { depth: reviewDepth, oldestWaitingSeconds: oldestMs === null ? null : Math.max(0, Math.floor(oldestMs / 1000)) },
    staleReceived,
    claims: { awaitingAnalysis },
  };
}
