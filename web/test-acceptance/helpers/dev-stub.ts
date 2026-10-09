/* eslint-disable */
// Step 4 UI test doubles: contract-shaped fixtures and a stub extension serving the platform, intelligence and API-key routes.
import { PERMS, createStub, json, type RoleName } from './stub.js';

export { json };
export const NOW_ISO = '2026-10-09T12:00:00.000Z';
const U = (n: number) => `00000000-0000-4000-8000-${String(700000 + n).padStart(12, '0')}`;
export const FLAG_KEYS = ['intelligence.provenance', 'intelligence.similar_claims', 'intelligence.worklist'] as const;
export const FLAG_DESC: Record<string, string> = {
  'intelligence.provenance': 'Provenance summary on the claim sheet',
  'intelligence.similar_claims': 'Similar past claims on the claim sheet',
  'intelligence.worklist': 'Prioritised worklist page',
};
export const BOUNDS: Array<number | null> = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, null];

export const pipeline = (o: Record<string, any> = {}) => ({
  scope: 'all_tenants_aggregate', window: '24h', generatedAt: NOW_ISO, version: '0.1.0', db: 'ok',
  documents: {
    total: 9,
    byStatus: { RECEIVED: 2, NEEDS_REVIEW: 1, ACCEPTED: 2, REJECTED: 3, FAILED: 0 },
    byDetectedType: { PDF: 3, PNG: 1, JPEG: 0, CSV: 2, TXT: 3 },
    rejectedByReason: [{ reason: 'malformed_pdf', count: 2 }, { reason: 'trailing_data', count: 1 }],
  },
  rates: { rejected: 0.3333, failed: 0, needsReview: 0.1111 },
  uploadToParseMs: { n: 5, p50: 120, p95: 480 },
  reviewQueue: { depth: 7, oldestWaitingSeconds: 7200 },
  staleReceived: 1,
  claims: { awaitingAnalysis: 4 },
  ...o,
});
export const buckets = (counts: number[]) => BOUNDS.map((leMs, i) => ({ leMs, count: counts[i] ?? 0 }));
export const telemetry = (o: Record<string, any> = {}) => ({
  scope: 'this_instance_since_start', generatedAt: NOW_ISO,
  instance: { startedAt: '2026-10-09T10:00:00.000Z', uptimeSeconds: 7200, version: '0.1.0', nodeVersion: 'v22.15.0' },
  requests: { total: 12, byStatusClass: { '2xx': 9, '3xx': 0, '4xx': 3, '5xx': 0 }, unauthenticated401: 1, forbidden403: 1, rateLimited429: 0 },
  routes: [
    { method: 'GET', route: '/api/v1/claims/:id', count: 8, byStatusClass: { '2xx': 6, '3xx': 0, '4xx': 2, '5xx': 0 }, durationBuckets: buckets([2, 3, 2, 0, 0, 0, 0, 0, 0, 0, 1]), p50UpperBoundMs: 10, p95UpperBoundMs: null },
    { method: 'GET', route: '/healthz', count: 4, byStatusClass: { '2xx': 3, '3xx': 0, '4xx': 1, '5xx': 0 }, durationBuckets: buckets([4]), p50UpperBoundMs: 5, p95UpperBoundMs: 5 },
  ],
  parser: { jobs: 3, succeeded: 2, rejected: 1, timeouts: 0, memoryKills: 0, failures: 0, busyRejections: 0, avgQueueWaitMs: null },
  components: [
    { id: 'priority-v1', method: 'fixed_rules', learnedModel: false, enabled: true, calls: 5, errors: 0, durationBuckets: buckets([5]), p50UpperBoundMs: 5, p95UpperBoundMs: 5, avgCandidatesConsidered: null },
    { id: 'similar-v1', method: 'fixed_rules', learnedModel: false, enabled: false, calls: 0, errors: 0, durationBuckets: buckets([]), p50UpperBoundMs: null, p95UpperBoundMs: null, avgCandidatesConsidered: null },
  ],
  ...o,
});
export const logRecord = (i: number, o: Record<string, any> = {}) => ({
  time: `2026-10-09T11:${String(59 - (i % 60)).padStart(2, '0')}:00.000Z`, level: 'info', requestId: U(i), method: 'GET', route: '/api/v1/claims', statusCode: 200, durationMs: 12.5, event: 'request completed', ...o,
});
export const logs = (items: any[], o: Record<string, any> = {}) => ({ scope: 'this_instance_recent_window', bufferCapacity: 500, returned: items.length, oldestTime: items.length ? items[items.length - 1].time : null, items, ...o });
export const flag = (key: string, o: Record<string, any> = {}) => ({ key, description: FLAG_DESC[key], enabled: true, defaultEnabled: true, tenantVisible: true, version: 1, updatedAt: null, updatedBy: null, lastReason: null, ...o });
export const evalRun = (o: Record<string, any> = {}) => ({
  id: 'a1b2c3d4-0000-4000-8000-000000000001', basis: 'synthetic_fixtures', evalSetId: 'mini', evalSetVersion: '1', evalSetSha256: 'ab'.repeat(32), stage: 'extraction', k: 3,
  startedAt: '2026-10-09T09:00:00.000Z', finishedAt: '2026-10-09T09:00:05.000Z', gitSha: null, providerName: 'deterministic', providerVersion: '1', parserVersion: '1',
  cases: 12, runsTotal: 36, runsPassed: 15, perRunPassRate: 0.416667, passHatKCount: 5, passHatK: 0.416667, passAtLeastOneCount: 5, flakyCaseCount: 0, alwaysFailCount: 7,
  deterministicCases: 12, wilson95: { low: 0.19326, high: 0.680489 }, passPowCurve: [0.416667, 0.416667, 0.416667], durationMs: { p50: 4, p95: 9 }, ...o,
});
export const evalDetail = (o: Record<string, any> = {}) => ({
  ...evalRun(o),
  results: ['m01', 'm02', 'm03'].map((caseId, i) => ({ caseId, category: 'acceptance', runsPassed: i === 0 ? 3 : 0, k: 3, passedAll: i === 0, distinctOutputs: 1, firstFailureCode: i === 0 ? null : 'field_mismatch', medianDurationMs: 4 })),
});
export const auditEvent = (seq: number, o: Record<string, any> = {}) => ({
  seq, id: U(900 + seq), actor: { id: U(1), role: 'PLATFORM_DEV' }, action: 'platform.dashboard_viewed', targetType: null, targetId: null, metadata: { section: 'pipeline', window: '24h' }, ip: null, requestId: `req-${seq}`,
  createdAt: '2026-10-09T11:00:00.000Z', prevHash: '0'.repeat(64), hash: 'f'.repeat(64), ...o,
});
export const wlItem = (rank: number, num: string, o: Record<string, any> = {}) => ({
  rank,
  claim: { id: U(100 + rank), claimNumber: num, loadNumber: `LD-${5000 + rank}`, carrierName: `Carrier ${rank}`, perspective: 'SHIPPER', status: 'PENDING_REVIEW', recoverableCents: 123456, pendingReviewCents: 0, currency: 'USD', assignee: null, latestPacket: { revision: 1, status: 'PENDING_REVIEW' } },
  score: { version: 'priority-v1', valueCents: 123456, parts: [{ key: 'confirmed_recoverable', inputCents: 123456, weightPercent: 100, contributionCents: 123456 }, { key: 'pending_review', inputCents: 0, weightPercent: 25, contributionCents: 0 }] },
  why: ['Confirmed recoverable $1,234.56 (counted at 100%)', 'Waiting 2 days (not part of the score)'], nextAction: 'REVIEW_AND_APPROVE', pendingFindingsCount: 0, waitingSince: '2026-10-07T12:00:00.000Z', waitingDays: 2, ...o,
});
export const worklist = (items: any[], o: Record<string, any> = {}) => ({
  generatedAt: NOW_ISO, formula: { version: 'priority-v1', pendingWeightPercent: 25 },
  label: "Ranked by a fixed formula over this tenant's own claim data: confirmed recoverable amount plus 25% of the amount still pending human review. This is a work-order aid, not a forecast of what will be recovered.",
  notRanked: { awaitingAnalysis: 0 }, items, page: 1, pageSize: 25, total: items.length, ...o,
});
export const similar = (claimId: string, items: any[], o: Record<string, any> = {}) => ({
  claimId, version: 'similar-v1', weights: { sameCarrier: 35, sharedRules: 40, similarAmount: 15, samePerspective: 10 }, minPercent: 30,
  label: "Similar claims are matched by fixed rules on this tenant's own data. Final status shows how your team handled the claim, not whether the carrier paid.",
  reason: null, candidatesConsidered: 19, computeMs: 3.2, items, ...o,
});
export const simItem = (num: string, pct: number, o: Record<string, any> = {}) => ({
  claim: { id: U(200 + pct), claimNumber: num, carrierName: 'Blue Ridge Carriers', perspective: 'SHIPPER', status: 'APPROVED', recoverableCents: 25000, pendingReviewCents: 0, updatedAt: '2026-10-08T10:00:00.000Z' },
  similarityPercent: pct,
  matches: [{ key: 'same_carrier', points: 35, detail: 'Same carrier' }, { key: 'shared_rules', points: 40, detail: 'Shared rules: TST-ALPHA, TST-BETA' }],
  handling: { finalStatus: 'APPROVED', ruleIds: ['TST-ALPHA', 'TST-BETA'], sourceDocTypes: ['INVOICE'], findingCount: 2, decidedAt: '2026-10-08T11:00:00.000Z' }, ...o,
});
export const provenance = (claimId: string, o: Record<string, any> = {}) => ({
  claimId, basis: 'rule_based_parse_score', label: 'Confidence is a rule-based parse score, not an accuracy measure.',
  documents: [
    { documentId: U(300), displayName: 'invoice.txt', docType: 'INVOICE', status: 'ACCEPTED', extractedFieldCount: 8, manualFieldCount: 0, byFieldStatus: { PROPOSED: 0, CONFIRMED: 6, CORRECTED: 1, REJECTED: 1 }, unresolvedFlaggedCount: 0, minConfidence: 0.85 },
    { documentId: U(301), displayName: 'scan.png', docType: 'BILL_OF_LADING', status: 'ACCEPTED', extractedFieldCount: 0, manualFieldCount: 1, byFieldStatus: { PROPOSED: 0, CONFIRMED: 1, CORRECTED: 0, REJECTED: 0 }, unresolvedFlaggedCount: 0, minConfidence: null },
  ],
  totals: { documents: 2, fields: 9, manualFields: 1, proposed: 0, confirmed: 7, corrected: 1, rejected: 1, unresolvedFlagged: 0 }, ...o,
});
export const apiKey = (i: number, o: Record<string, any> = {}) => ({
  id: U(400 + i), keyId: `fr_live_${String(i).padStart(16, 'a')}`, name: `Key ${i}`, scopes: ['claims.read'], createdBy: { id: U(1), name: 'Olive Owner' }, createdAt: '2026-10-01T10:00:00.000Z', expiresAt: '2027-01-01T10:00:00.000Z',
  lastUsedAt: null, revokedAt: null, revokedBy: null, revokeReason: null, status: 'ACTIVE', ...o,
});

export interface DevOpts { putGate?: Promise<void>; role?: RoleName; features?: Record<string, boolean> | 'fail'; flags?: any[]; claims?: any[]; handlers?: boolean }
/** createStub plus the step 4 routes. Individual tests re-register any route with stub.on(...). */
export function devStub(o: DevOpts = {}) {
  const stub = createStub({ role: o.role ?? 'MANAGER', ...(o.claims ? { claims: o.claims } : {}) });
  let flags = o.flags ?? FLAG_KEYS.map((k) => flag(k));
  const feats = o.features ?? { 'intelligence.provenance': true, 'intelligence.similar_claims': true, 'intelligence.worklist': true };
  stub.on('GET', /\/features$/, () => (feats === 'fail' ? json(500, { error: { code: 'internal_error', message: 'x', requestId: 'r' } }) : json(200, { flags: feats })));
  stub.on('GET', /\/platform\/pipeline$/, (c) => json(200, pipeline({ window: c.query.get('window') ?? '24h' })));
  stub.on('GET', /\/platform\/telemetry$/, () => json(200, telemetry()));
  stub.on('GET', /\/platform\/logs$/, () => json(200, logs([logRecord(1), logRecord(2, { event: '(message withheld)', level: 'warn' })])));
  stub.on('GET', /\/platform\/flags$/, () => json(200, { items: flags }));
  stub.on('PUT', /\/platform\/flags\/[^/]+$/, async (c) => {
    if (o.putGate) await o.putGate;
    const key = decodeURIComponent(c.path.split('/').pop()!);
    const cur = flags.find((f) => f.key === key);
    if (!cur) return json(404, { error: { code: 'not_found', message: 'Not found.', requestId: 'r' } });
    if (c.body.expectedVersion !== cur.version) return json(409, { error: { code: 'stale_revision', message: 'stale', requestId: 'r' } });
    const next = { ...cur, enabled: c.body.enabled, version: cur.version + 1, updatedAt: NOW_ISO, updatedBy: { id: U(2), name: 'Dana Dev' }, lastReason: c.body.reason };
    flags = flags.map((f) => (f.key === key ? next : f));
    return json(200, next);
  });
  stub.on('GET', /\/platform\/eval\/runs$/, () => json(200, { items: [evalRun()] }));
  stub.on('GET', /\/platform\/eval\/runs\/[^/]+$/, () => json(200, evalDetail()));
  stub.on('GET', /\/platform\/audit\/events$/, () => json(200, { items: [auditEvent(2), auditEvent(1)], nextBefore: null }));
  stub.on('GET', /\/platform\/audit\/verify$/, () => json(200, { valid: true, eventsChecked: 12, brokenAtSeq: null }));
  stub.on('GET', /\/intelligence\/worklist$/, () => json(200, worklist([wlItem(1, 'CLM-0001'), wlItem(2, 'CLM-0002')])));
  stub.on('GET', /\/claims\/[^/]+\/similar$/, (c) => json(200, similar(c.path.split('/').slice(-2)[0]!, [simItem('CLM-0042', 92)])));
  stub.on('GET', /\/claims\/[^/]+\/provenance$/, (c) => json(200, provenance(c.path.split('/').slice(-2)[0]!)));
  stub.on('GET', /\/api-keys$/, () => json(200, { items: [apiKey(1), apiKey(2, { status: 'REVOKED', revokedAt: NOW_ISO, revokedBy: { id: U(1), name: 'Olive Owner' }, revokeReason: 'rotated key' })] }));
  return Object.assign(stub, { getFlags: () => flags });
}
export { PERMS };