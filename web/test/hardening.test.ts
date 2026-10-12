/**
 * Hardening (REQ-20261012-hardening): ApiError.details parsing (defensive, never shown) and accessible table
 * names (C7.9: every `<table>` in web/src has an aria-label or aria-labelledby).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ApiClient, ApiError, MAX_ERROR_DETAILS, parseErrorDetails } from '../src/api/client';
import { createSessionStore } from '../src/auth/session-store';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/u.test(name)) out.push(p);
  }
  return out;
}

describe('parseErrorDetails', () => {
  it('keeps only {path, code} string pairs, at most 10', () => {
    expect(parseErrorDetails({ error: { details: [{ path: 'analysis', code: 'fuel_check' }] } })).toEqual([{ path: 'analysis', code: 'fuel_check' }]);
    expect(parseErrorDetails({ error: { details: [{ path: 1, code: 'x' }, { path: 'a' }, null, 'x', { path: 'b', code: 'c', extra: 1 }] } })).toEqual([{ path: 'b', code: 'c' }]);
    const many = Array.from({ length: 25 }, (_, i) => ({ path: `p${i}`, code: 'c' }));
    expect(parseErrorDetails({ error: { details: many } })).toHaveLength(MAX_ERROR_DETAILS);
    for (const v of [null, 'x', {}, { error: null }, { error: { details: 'x' } }]) expect(parseErrorDetails(v)).toEqual([]);
  });

  it('an API error response carries the parsed details; the message stays the fixed client mapping input', async () => {
    const body = { error: { code: 'analysis_input_invalid', message: 'M', requestId: 'r', details: [{ path: 'analysis', code: 'amount_out_of_range' }] } };
    const fetchImpl = (async (url: RequestInfo | URL) =>
      String(url) === '/api/v1/auth/csrf'
        ? new Response(JSON.stringify({ csrfToken: 'n.sig' }), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify(body), { status: 422, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const api = new ApiClient(fetchImpl, createSessionStore(), () => undefined);
    const e = await api.post('/api/v1/claims/x/analyze', {}, undefined, false).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).details).toEqual([{ path: 'analysis', code: 'amount_out_of_range' }]);
    expect(new ApiError(500, 'x', 'y').details).toEqual([]);
  });
});

describe('accessible table names (C7.9)', () => {
  it('every <table> in web/src has an aria-label or aria-labelledby', () => {
    const missing: string[] = [];
    for (const f of walk(srcRoot)) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/<table\b[^>]*>/gu)) if (!/aria-label(ledby)?=/u.test(m[0])) missing.push(`${path.relative(srcRoot, f)}: ${m[0]}`);
    }
    expect(missing).toEqual([]);
  });

  it('the five tables of this run carry their names', () => {
    const expectations: [string, string][] = [
      ['features/claims/ClaimsPage.tsx', 'aria-label="Claims"'],
      ['features/claims/ClaimSheet.tsx', 'aria-label="Packet sources"'],
      ['features/claims/ClaimSheet.tsx', 'aria-label="Linked documents"'],
      ['features/imports/FieldsTable.tsx', 'aria-label="Extracted fields"'],
      ['features/imports/ReviewQueuePage.tsx', 'aria-label="Review queue"'],
    ];
    for (const [file, attr] of expectations) expect([file, readFileSync(path.join(srcRoot, file), 'utf8').includes(attr)]).toEqual([file, true]);
  });
});
