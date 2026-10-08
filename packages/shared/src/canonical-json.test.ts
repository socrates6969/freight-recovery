import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { canonicalJson } from './canonical-json.js';

describe('canonicalJson', () => {
  it('sorts keys recursively and has no whitespace (fixed vectors)', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: true, y: null }], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":null,"z":true}]},"b":1}',
    );
    expect(canonicalJson([])).toBe('[]');
    expect(canonicalJson({})).toBe('{}');
    expect(canonicalJson('é\n"')).toBe('"é\\n\\""');
  });

  it('is insensitive to key insertion order', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('omits undefined members and maps undefined array items to null', () => {
    expect(canonicalJson({ a: undefined, b: [undefined, 1] })).toBe('{"b":[null,1]}');
  });

  it('produces a stable sha256 for a fixed vector', () => {
    const h = createHash('sha256').update(canonicalJson({ seq: 1, action: 'x', metadata: {} })).digest('hex');
    expect(h).toBe(createHash('sha256').update('{"action":"x","metadata":{},"seq":1}').digest('hex'));
    expect(h).toBe('8d7cbd8fea8ca2608881a324531f4eb8c7f9e2da7b32e2d7233434a5a302748b');
  });

  it('rejects non-finite numbers, bigint, Date, functions and cycles', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(Infinity)).toThrow();
    expect(() => canonicalJson(1n)).toThrow();
    expect(() => canonicalJson(new Date(0))).toThrow();
    expect(() => canonicalJson({ f: () => 1 })).toThrow();
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(() => canonicalJson(cyc)).toThrow();
  });

  it('allows the same object to appear twice when not cyclic', () => {
    const shared = { x: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });
});
