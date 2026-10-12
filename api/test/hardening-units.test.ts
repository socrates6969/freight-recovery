/**
 * Hardening (REQ-20261012-hardening) and fix round 1 unit tests (no database): failure-reason classification,
 * the AnalysisFailure error shape, the database-guard mappings, the derived client address and the
 * CLIENT_IP_HEADER / ORIGIN_VERIFY_SECRET configuration.
 */
import { AnalysisInputError, IdParams, LEARNED_LABEL_IDS_MAX } from '@fr/shared';
import type { ChargeClassifier } from '@fr/shared/charge-intel';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { toHttpError } from '../src/app.js';
import { sanitizeMetadata } from '../src/audit/chain.js';
import { INT4_MAX, NotStorableError, classifyAnalysisFailure, learnedLabelIdsTruncated, storableCents } from '../src/claims/analysis.js';
import { ConfigError, loadConfig } from '../src/config.js';
import { deriveClientIp, parseViewerAddress, secretEquals } from '../src/http/client-ip.js';
import { isFourEyesDbError, isPacketDecisionDbError } from '../src/http/db-guard.js';
import { AnalysisFailure, HttpError } from '../src/http/errors.js';
import { canonicalizeParams, defineRoute } from '../src/http/route.js';

const ok = () => undefined;
const refuse = () => {
  throw new AnalysisInputError('refused');
};

describe('classifyAnalysisFailure (C4.1)', () => {
  it('fuel_check when the same build without fuel inputs succeeds', () => {
    expect(classifyAnalysisFailure(new NotStorableError(), ok)).toBe('fuel_check');
    expect(classifyAnalysisFailure(new AnalysisInputError('x'), ok)).toBe('fuel_check');
  });

  it('amount_out_of_range for a NotStorableError without fuel or when the retry also fails', () => {
    expect(classifyAnalysisFailure(new NotStorableError(), null)).toBe('amount_out_of_range');
    expect(classifyAnalysisFailure(new NotStorableError('total not storable'), refuse)).toBe('amount_out_of_range');
  });

  it('input_values for any other refusal', () => {
    expect(classifyAnalysisFailure(new AnalysisInputError('bad'), null)).toBe('input_values');
    expect(classifyAnalysisFailure(new RangeError('bad'), refuse)).toBe('input_values');
  });

  it('an unexpected error of the retry propagates (never classified)', () => {
    const boom = new Error('db');
    expect(() =>
      classifyAnalysisFailure(new NotStorableError(), () => {
        throw boom;
      }),
    ).toThrow(boom);
  });

  it('storableCents: range failures are NotStorableError, malformed amounts are plain AnalysisInputError', () => {
    expect(storableCents('12.34')).toBe(1234);
    expect(storableCents('21474836.47')).toBe(INT4_MAX);
    expect(() => storableCents('-0.01')).toThrow(NotStorableError);
    expect(() => storableCents('21474836.48')).toThrow(NotStorableError);
    const malformed = (() => {
      try {
        storableCents('12.3');
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(malformed).toBeInstanceOf(AnalysisInputError);
    expect(malformed).not.toBeInstanceOf(NotStorableError);
  });
});

describe('AnalysisFailure (C4.1/C4.2)', () => {
  it('is a 422 analysis_input_invalid with the fixed message and exactly one analysis detail', () => {
    const e = new AnalysisFailure({ tenantId: 't', claimId: 'c', claimNumber: 'CLM-1', reasonCode: 'fuel_check', bulk: false, documentCount: 3 });
    expect(e).toBeInstanceOf(HttpError);
    expect([e.statusCode, e.code, e.message, e.details]).toEqual([
      422,
      'analysis_input_invalid',
      'The extracted values of this claim cannot be analysed automatically.',
      [{ path: 'analysis', code: 'fuel_check' }],
    ]);
    expect(toHttpError(e)).toBe(e);
  });
});

describe('database guard mapping (C2)', () => {
  const adapterError = (message: string) => ({
    name: 'PrismaClientKnownRequestError',
    code: 'P2010',
    meta: { driverAdapterError: { cause: { kind: 'postgres', originalCode: 'P0001', originalMessage: message } } },
  });

  it('packet_decision_unrecorded (deferred, thrown at COMMIT) maps to 409 invalid_state with the fixed message', () => {
    const raw = new Error('Transaction API error: commit failed', { cause: adapterError('packet_decision_unrecorded') });
    expect(isPacketDecisionDbError(raw)).toBe(true);
    const mapped = toHttpError(raw);
    expect([mapped.statusCode, mapped.code, mapped.message]).toEqual([409, 'invalid_state', 'This action is not allowed in the current state.']);
  });

  it('exact message match only; a plain pg error shape is recognised too', () => {
    expect(isPacketDecisionDbError(adapterError('packet_decision_unrecorded_x'))).toBe(false);
    expect(isPacketDecisionDbError({ code: 'P0001', message: 'packet_decision_unrecorded' })).toBe(true);
    expect(isPacketDecisionDbError({ code: '23514', message: 'packet_decision_unrecorded' })).toBe(false);
  });

  it('the extended four-eyes trigger uses the existing four_eyes_required mapping (403)', () => {
    expect(isFourEyesDbError(adapterError('four_eyes_required'))).toBe(true);
    expect(toHttpError(adapterError('four_eyes_required'))).toMatchObject({ statusCode: 403, code: 'four_eyes_required' });
  });

  it('the awaiting-amounts CHECK violation stays an unmapped 500 without database text', () => {
    const mapped = toHttpError({ code: '23514', message: 'new row for relation "claims" violates check constraint "claims_awaiting_amounts_zero"' });
    expect([mapped.statusCode, mapped.code, mapped.message]).toEqual([500, 'internal_error', 'Internal server error.']);
  });
});

describe('client address (fix round 1, C11)', () => {
  const SECRET = 'Vt3qZ9-origin-verify-test-value-8c1e5b2d8f4a6c0e9b7d';
  const on = { clientIpHeader: 'cloudfront-viewer-address' as const, originVerifySecret: SECRET };
  const off = { clientIpHeader: null, originVerifySecret: null };
  const req = (headers: Record<string, string>) => ({ ip: '10.0.1.5', headers });

  it('parses <ip>:<port> at the LAST colon, brackets optional, valid IP and port 1..65535', () => {
    const table: [string, string | null][] = [
      ['203.0.113.7:443', '203.0.113.7'],
      ['2001:db8::1:51000', '2001:db8::1'],
      ['[2001:db8::1]:51000', '2001:db8::1'],
      ['203.0.113.7:65535', '203.0.113.7'],
      ['203.0.113.7:1', '203.0.113.7'],
      ['203.0.113.7:0', null],
      ['203.0.113.7:65536', null],
      ['203.0.113.7', null],
      ['203.0.113.7:', null],
      [':443', null],
      ['example.com:443', null],
      ['203.0.113.999:443', null],
      ['203.0.113.7:44a', null],
      ['', null],
      [`${'1'.repeat(70)}:443`, null],
    ];
    for (const [value, expected] of table) expect([value, parseViewerAddress(value)]).toEqual([value, expected]);
  });

  it('uses the viewer address only with the mode on, the matching secret and a well-formed header', () => {
    const viewer = { 'cloudfront-viewer-address': '198.51.100.20:3456' };
    expect(deriveClientIp(req({ ...viewer, 'x-origin-verify': SECRET }), on)).toBe('198.51.100.20');
    expect(deriveClientIp(req({ ...viewer, 'x-origin-verify': SECRET }), off)).toBe('10.0.1.5');
    expect(deriveClientIp(req({ ...viewer, 'x-origin-verify': `${SECRET}x` }), on)).toBe('10.0.1.5');
    expect(deriveClientIp(req({ ...viewer, 'x-origin-verify': SECRET.slice(0, -1) + 'X' }), on)).toBe('10.0.1.5');
    expect(deriveClientIp(req({ ...viewer }), on)).toBe('10.0.1.5');
    expect(deriveClientIp(req({ 'x-origin-verify': SECRET }), on)).toBe('10.0.1.5');
    expect(deriveClientIp(req({ 'x-origin-verify': SECRET, 'cloudfront-viewer-address': 'garbage' }), on)).toBe('10.0.1.5');
  });

  it('secretEquals is exact (length and content)', () => {
    expect(secretEquals('abc', 'abc')).toBe(true);
    expect(secretEquals('abc', 'abd')).toBe(false);
    expect(secretEquals('abc', 'abcd')).toBe(false);
    expect(secretEquals('', 'abc')).toBe(false);
  });
});

describe('CLIENT_IP_HEADER / ORIGIN_VERIFY_SECRET configuration (C11)', () => {
  const base = {
    DATABASE_URL: 'postgresql://freight_app:x@127.0.0.1:5433/freight_web_test',
    JWT_SECRET: 'j'.repeat(48),
    CSRF_SECRET: 'c'.repeat(48),
    REFRESH_PEPPER: 'r'.repeat(48),
    MFA_ENC_KEY: Buffer.alloc(32, 9).toString('base64'),
    APP_ORIGIN: 'http://127.0.0.1:8080',
    NODE_ENV: 'development',
  };
  const SECRET = 'Vt3qZ9-origin-verify-test-value-8c1e5b2d8f4a6c0e9b7d';
  const problems = (env: Record<string, string>): string[] => {
    try {
      loadConfig(env);
      return [];
    } catch (e) {
      if (e instanceof ConfigError) return [...e.problems];
      throw e;
    }
  };

  it('defaults: both unset or the header empty', () => {
    expect(loadConfig(base)).toMatchObject({ clientIpHeader: null, originVerifySecret: null });
    expect(loadConfig({ ...base, CLIENT_IP_HEADER: '' })).toMatchObject({ clientIpHeader: null });
  });

  it('accepts exactly cloudfront-viewer-address with a secret', () => {
    expect(loadConfig({ ...base, CLIENT_IP_HEADER: 'cloudfront-viewer-address', ORIGIN_VERIFY_SECRET: SECRET })).toMatchObject({
      clientIpHeader: 'cloudfront-viewer-address',
      originVerifySecret: SECRET,
    });
  });

  it('refuses any other header value, a missing secret, a set-but-empty secret, a short or reused secret', () => {
    expect(problems({ ...base, CLIENT_IP_HEADER: 'x-forwarded-for', ORIGIN_VERIFY_SECRET: SECRET }).join('\n')).toContain('CLIENT_IP_HEADER must be empty or exactly');
    expect(problems({ ...base, CLIENT_IP_HEADER: 'CloudFront-Viewer-Address', ORIGIN_VERIFY_SECRET: SECRET }).join('\n')).toContain('CLIENT_IP_HEADER');
    expect(problems({ ...base, CLIENT_IP_HEADER: 'cloudfront-viewer-address' }).join('\n')).toContain('ORIGIN_VERIFY_SECRET is required');
    expect(problems({ ...base, ORIGIN_VERIFY_SECRET: '' }).join('\n')).toContain('ORIGIN_VERIFY_SECRET is set but empty');
    expect(problems({ ...base, ORIGIN_VERIFY_SECRET: '   ' }).join('\n')).toContain('ORIGIN_VERIFY_SECRET is set but empty');
    expect(problems({ ...base, ORIGIN_VERIFY_SECRET: 'short' }).join('\n')).toContain('ORIGIN_VERIFY_SECRET must be at least');
    expect(problems({ ...base, ORIGIN_VERIFY_SECRET: base.JWT_SECRET }).join('\n')).toContain('ORIGIN_VERIFY_SECRET must differ');
  });
});

describe('fix round 2 (C-FR2.1): path parameters are canonicalised at the boundary', () => {
  const UPPER = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D';

  it('canonicalizeParams lower-cases UUID values of any case and leaves everything else unchanged', () => {
    expect(canonicalizeParams({ id: UPPER })).toEqual({ id: UPPER.toLowerCase() });
    expect(canonicalizeParams({ batchId: UPPER, docId: 'a1b2c3d4-E5F6-4a7b-8c9d-0e1f2a3b4c5d', key: 'Intelligence.Flag' })).toEqual({
      batchId: UPPER.toLowerCase(),
      docId: UPPER.toLowerCase(),
      key: 'Intelligence.Flag',
    });
    expect(canonicalizeParams({ id: 'NOT-A-UUID' })).toEqual({ id: 'NOT-A-UUID' });
    expect(canonicalizeParams({ id: `${UPPER}X` })).toEqual({ id: `${UPPER}X` });
    expect(canonicalizeParams(undefined)).toBeUndefined();
  });

  it('defineRoute hands the handler the lower-case id (every route, any params schema)', async () => {
    const app = Fastify();
    let seen: unknown = null;
    defineRoute(app, {
      method: 'GET',
      url: '/x/:id',
      access: { kind: 'public' },
      schema: { params: IdParams },
      handler: async (_req, _reply, { params }) => {
        seen = params;
        return { ok: true };
      },
    });
    await app.ready();
    const r = await app.inject({ method: 'GET', url: `/x/${UPPER}` });
    expect(r.statusCode).toBe(200);
    expect(seen).toEqual({ id: UPPER.toLowerCase() });
    await app.close();
  });
});

describe('fix round 2 (C-FR2.2): learnedLabelIdsTruncated', () => {
  const ids = (n: number, prefix = 'l') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  /** A classifier stub: each description names its nearest label after a colon ("x:<labelId>:<category>"). */
  const stub: ChargeClassifier = {
    classify: (d: string) => {
      const [, labelId, code] = d.split(':');
      // Category codes keep the description free of fixed-rule words ("detention" would classify the line).
      const category = code === 'A' ? 'accessorial' : code === 'D' ? 'detention' : code === 'L' ? 'linehaul' : null;
      return {
        category: category as never,
        similarity: 1,
        abstained: false,
        reason: null,
        nearest: labelId ? ({ labelId } as never) : null,
      };
    },
  };
  const lines = (n: number, code = 'A') => ids(n).map((id) => ({ description: `zz charge:${id}:${code}` }));

  it('below the cap, or without a classifier, never truncated', () => {
    expect(learnedLabelIdsTruncated(ids(LEARNED_LABEL_IDS_MAX - 1), lines(200), stub)).toBe(false);
    expect(learnedLabelIdsTruncated(ids(LEARNED_LABEL_IDS_MAX), lines(200), null)).toBe(false);
  });

  it('at the cap: truncated only when more distinct candidate labels exist than the cap', () => {
    expect(learnedLabelIdsTruncated(ids(LEARNED_LABEL_IDS_MAX), lines(LEARNED_LABEL_IDS_MAX), stub)).toBe(false);
    expect(learnedLabelIdsTruncated(ids(LEARNED_LABEL_IDS_MAX), lines(LEARNED_LABEL_IDS_MAX + 1), stub)).toBe(true);
    expect(learnedLabelIdsTruncated(ids(LEARNED_LABEL_IDS_MAX), lines(LEARNED_LABEL_IDS_MAX + 1, 'D'), stub)).toBe(true);
  });

  it('candidates exclude lines the fixed rules classify, other categories and labels without an id', () => {
    const fixed = ids(LEARNED_LABEL_IDS_MAX + 5).map((id) => ({ description: `lumper:${id}:A` }));
    expect(learnedLabelIdsTruncated(ids(LEARNED_LABEL_IDS_MAX), fixed, stub)).toBe(false);
    expect(learnedLabelIdsTruncated(ids(LEARNED_LABEL_IDS_MAX), lines(LEARNED_LABEL_IDS_MAX + 5, 'L'), stub)).toBe(false);
    const seedOnly = ids(LEARNED_LABEL_IDS_MAX + 5).map(() => ({ description: 'zz charge::A' }));
    expect(learnedLabelIdsTruncated(ids(LEARNED_LABEL_IDS_MAX), seedOnly, stub)).toBe(false);
  });

  it('the audit chain keeps the flag (whitelisted boolean)', () => {
    expect(sanitizeMetadata({ learnedLabelIdsTruncated: true })).toEqual({ learnedLabelIdsTruncated: true });
  });
});
