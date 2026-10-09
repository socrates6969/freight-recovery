import { describe, expect, it } from 'vitest';

import {
  API_KEY_FORMAT_RE,
  ApiKeyView,
  CreateApiKeyBody,
  RevokeApiKeyBody,
  SCOPE_PERMISSION,
} from './api-key-dto.js';
import { AUDIT_ACTIONS } from './audit-actions.js';
import { FEATURE_FLAGS, FEATURE_FLAG_KEYS, isKnownFlag } from './feature-flags.js';
import * as copy from './honest-copy.js';
import { SimilarQuery, Worklist, WorklistQuery } from './intelligence-dto.js';
import { FlagChangeBody, LogsQuery, PipelineHealth, PipelineQuery, Telemetry } from './platform-dto.js';
import { can } from './rbac.js';

describe('feature flag registry (Q4)', () => {
  it('contains exactly the three intelligence flags, ordered by key, default on, tenant-visible', () => {
    expect(FEATURE_FLAG_KEYS).toEqual(['intelligence.provenance', 'intelligence.similar_claims', 'intelligence.worklist']);
    expect(FEATURE_FLAGS.map((f) => f.description)).toEqual([
      'Provenance summary on the claim sheet',
      'Similar past claims on the claim sheet',
      'Prioritised worklist page',
    ]);
    expect(FEATURE_FLAGS.every((f) => f.defaultEnabled && f.tenantVisible)).toBe(true);
    expect(Object.isFrozen(FEATURE_FLAGS)).toBe(true);
    expect(isKnownFlag('intelligence.worklist')).toBe(true);
    expect(isKnownFlag('auth.csrf')).toBe(false);
    expect(isKnownFlag('__proto__')).toBe(false);
  });
});

describe('honest copy (Q8)', () => {
  it('substitutes W and validates it', () => {
    expect(copy.worklistNote(25)).toBe(
      "Ranked by a fixed formula over this tenant's own claim data: confirmed recoverable amount plus 25% of the amount still pending human review. This is a work-order aid, not a forecast of what will be recovered.",
    );
    expect(() => copy.worklistNote(101)).toThrow(RangeError);
    expect(() => copy.worklistNote(2.5)).toThrow(RangeError);
  });
  it('no fixed text claims learning, speed-up or a percentage accuracy', () => {
    const banned = [/neural mesh/iu, /hebbian/iu, /solved-problems cache/iu, /ai-powered/iu, /faster than/iu, /\d+(\.\d+)?\s*[x×]\s*faster/iu, /\d+(\.\d+)?\s*%\s*accura/iu];
    for (const v of Object.values(copy)) {
      if (typeof v !== 'string') continue;
      for (const re of banned) expect([v, re.test(v)]).toEqual([v, false]);
    }
  });
});

describe('permissions (Q2, Q13)', () => {
  it('maps scopes to tenant permissions held by OWNER and ADMIN', () => {
    expect(SCOPE_PERMISSION).toEqual({ 'claims.read': 'claims:read', 'exports.claims': 'export:claims', 'imports.write': 'import:run' });
    for (const p of Object.values(SCOPE_PERMISSION)) {
      expect(can('OWNER', p)).toBe(true);
      expect(can('ADMIN', p)).toBe(true);
      expect(can('PLATFORM_DEV', p)).toBe(false);
    }
  });
  it('adds the step 4 audit action names', () => {
    for (const a of ['platform.dashboard_viewed', 'platform.logs_viewed', 'platform.flag_changed', 'eval.run_recorded', 'intelligence.viewed', 'apikey.created', 'apikey.revoked', 'apikey.use_denied']) {
      expect(AUDIT_ACTIONS).toContain(a);
    }
  });
});

describe('strict request schemas', () => {
  it('platform queries reject unknown keys and out-of-range values', () => {
    expect(PipelineQuery.parse({})).toEqual({ window: '24h' });
    expect(PipelineQuery.safeParse({ window: '2h' }).success).toBe(false);
    expect(PipelineQuery.safeParse({ window: '1h', x: '1' }).success).toBe(false);
    expect(LogsQuery.parse({})).toEqual({ level: 'info', limit: 100 });
    expect(LogsQuery.safeParse({ limit: '201' }).success).toBe(false);
    expect(LogsQuery.safeParse({ requestId: 'not-a-uuid' }).success).toBe(false);
  });
  it('flag change body requires a single-line reason of 10..500 characters', () => {
    expect(FlagChangeBody.safeParse({ enabled: false, expectedVersion: 1, reason: 'short' }).success).toBe(false);
    expect(FlagChangeBody.safeParse({ enabled: false, expectedVersion: 1, reason: 'line one\nline two!' }).success).toBe(false);
    expect(FlagChangeBody.safeParse({ enabled: false, expectedVersion: -1, reason: 'a valid reason' }).success).toBe(false);
    expect(FlagChangeBody.parse({ enabled: false, expectedVersion: 1, reason: '  a valid reason  ' }).reason).toBe('a valid reason');
  });
  it('worklist query defaults and status list validation', () => {
    expect(WorklistQuery.parse({})).toEqual({ status: ['PENDING_REVIEW', 'APPROVED'], page: 1, pageSize: 25 });
    expect(WorklistQuery.parse({ status: 'APPROVED' }).status).toEqual(['APPROVED']);
    expect(WorklistQuery.safeParse({ status: 'REJECTED' }).success).toBe(false);
    expect(WorklistQuery.safeParse({ status: "PENDING_REVIEW' OR 1=1" }).success).toBe(false);
    expect(WorklistQuery.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(SimilarQuery.parse({})).toEqual({ limit: 5 });
    expect(SimilarQuery.safeParse({ limit: '11' }).success).toBe(false);
  });
  it('API key bodies', () => {
    expect(CreateApiKeyBody.safeParse({ name: 'ci', scopes: [] }).success).toBe(false);
    expect(CreateApiKeyBody.safeParse({ name: 'ci', scopes: ['claims.read', 'claims.read'] }).success).toBe(false);
    expect(CreateApiKeyBody.safeParse({ name: 'ci', scopes: ['admin'] }).success).toBe(false);
    expect(CreateApiKeyBody.safeParse({ name: 'ci', scopes: ['claims.read'], expiresInDays: 366 }).success).toBe(false);
    expect(CreateApiKeyBody.safeParse({ name: 'ci‮', scopes: ['claims.read'] }).success).toBe(false);
    expect(CreateApiKeyBody.parse({ name: 'ci', scopes: ['claims.read'], expiresInDays: null }).expiresInDays).toBeNull();
    expect(RevokeApiKeyBody.safeParse({ reason: 'too short' }).success).toBe(false);
  });
  it('key format', () => {
    expect(API_KEY_FORMAT_RE.test(`fr_live_${'a'.repeat(16)}_${'A'.repeat(43)}`)).toBe(true);
    expect(API_KEY_FORMAT_RE.test(`fr_live_${'A'.repeat(16)}_${'A'.repeat(43)}`)).toBe(false);
    expect(API_KEY_FORMAT_RE.test(`fr_live_${'a'.repeat(16)}_${'A'.repeat(42)}`)).toBe(false);
    expect(API_KEY_FORMAT_RE.test(`fr_live_${'a'.repeat(16)}_${'A'.repeat(42)}=`)).toBe(false);
  });
});

describe('strict response schemas reject extra keys (fail closed)', () => {
  it('PipelineHealth', () => {
    const ok = {
      scope: 'all_tenants_aggregate',
      window: '24h',
      generatedAt: '2026-10-09T00:00:00.000Z',
      version: '0.1.0',
      db: 'ok',
      documents: {
        total: 0,
        byStatus: { RECEIVED: 0, NEEDS_REVIEW: 0, ACCEPTED: 0, REJECTED: 0, FAILED: 0 },
        byDetectedType: { PDF: 0, PNG: 0, JPEG: 0, CSV: 0, TXT: 0 },
        rejectedByReason: [],
      },
      rates: { rejected: null, failed: null, needsReview: null },
      uploadToParseMs: { n: 0, p50: null, p95: null },
      reviewQueue: { depth: 0, oldestWaitingSeconds: null },
      staleReceived: 0,
      claims: { awaitingAnalysis: 0 },
    };
    expect(PipelineHealth.safeParse(ok).success).toBe(true);
    expect(PipelineHealth.safeParse({ ...ok, tenantId: 'x' }).success).toBe(false);
    expect(PipelineHealth.safeParse({ ...ok, documents: { ...ok.documents, tenantNames: ['x'] } }).success).toBe(false);
  });
  it('Telemetry components must be fixed rules without a learned model', () => {
    const r = Telemetry.safeParse({ scope: 'this_instance_since_start' });
    expect(r.success).toBe(false);
  });
  it('Worklist and ApiKeyView reject unknown keys', () => {
    expect(Worklist.safeParse({ extra: 1 }).success).toBe(false);
    expect(ApiKeyView.safeParse({ secretHash: 'x' }).success).toBe(false);
  });
});
