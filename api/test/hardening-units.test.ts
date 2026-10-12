/**
 * Hardening (REQ-20261012-hardening) and fix round 1 unit tests (no database): failure-reason classification,
 * the AnalysisFailure error shape, the database-guard mappings, the derived client address and the
 * CLIENT_IP_HEADER / ORIGIN_VERIFY_SECRET configuration.
 */
import { AnalysisInputError } from '@fr/shared';
import { describe, expect, it } from 'vitest';

import { toHttpError } from '../src/app.js';
import { INT4_MAX, NotStorableError, classifyAnalysisFailure, storableCents } from '../src/claims/analysis.js';
import { ConfigError, loadConfig } from '../src/config.js';
import { deriveClientIp, parseViewerAddress, secretEquals } from '../src/http/client-ip.js';
import { isFourEyesDbError, isPacketDecisionDbError } from '../src/http/db-guard.js';
import { AnalysisFailure, HttpError } from '../src/http/errors.js';

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
