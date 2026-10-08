import { describe, expect, it } from 'vitest';

import { safeNextPath, tokenFromHash } from './safe-next';

describe('safeNextPath', () => {
  it('accepts same-origin relative paths', () => {
    expect(safeNextPath('/claims')).toBe('/claims');
    expect(safeNextPath('/claims?q=abc&page=2')).toBe('/claims?q=abc&page=2');
    expect(safeNextPath('/approvals')).toBe('/approvals');
  });
  it('rejects absolute, protocol-relative, backslash and scheme tricks', () => {
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      'javascript:alert(1)',
      '/claims\u0000',
      '/claims\n',
      '',
      'claims',
      '/login',
      '/login/mfa',
      `/${'a'.repeat(600)}`,
    ]) {
      expect([bad, safeNextPath(bad)]).toEqual([bad, '/claims']);
    }
    expect(safeNextPath(null)).toBe('/claims');
  });
});

describe('tokenFromHash', () => {
  it('reads a base64url token from the fragment only', () => {
    expect(tokenFromHash('#token=abc_DEF-123')).toBe('abc_DEF-123');
    expect(tokenFromHash('token=abc')).toBe('abc');
    expect(tokenFromHash('#token=<script>')).toBeNull();
    expect(tokenFromHash('#other=1')).toBeNull();
    expect(tokenFromHash('')).toBeNull();
  });
});
