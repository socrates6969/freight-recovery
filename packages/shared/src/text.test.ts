import { describe, expect, it } from 'vitest';

import { multiLine, reasonSchema } from './dto.js';
import { displayText, hasUnsafeChars, stripUnsafeMultiline } from './text.js';

const HOSTILE = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  'javascript:alert(1)',
  '[x](javascript:alert(1))',
  'abc\u202Eevil\u202C',
  '\u2066isolate\u2069',
  'A'.repeat(5000),
];

describe('text safety', () => {
  it('detects control and bidi characters', () => {
    expect(hasUnsafeChars('plain text, ok.')).toBe(false);
    expect(hasUnsafeChars('tab\there')).toBe(true);
    expect(hasUnsafeChars('line\nbreak')).toBe(true);
    expect(hasUnsafeChars('nul\u0000')).toBe(true);
    expect(hasUnsafeChars('c1\u0085')).toBe(true);
    expect(hasUnsafeChars('rlo\u202E')).toBe(true);
    expect(hasUnsafeChars('lri\u2066')).toBe(true);
    expect(hasUnsafeChars('rlm\u200F')).toBe(true);
  });

  it('strips unsafe characters from multi-line text but keeps newlines', () => {
    expect(stripUnsafeMultiline('a\r\nb\rc\u0007d\u202Ee\tf')).toBe('a\nb\ncdef');
  });

  it('displayText removes bidi overrides and isolates and leaves markup as inert text', () => {
    for (const h of HOSTILE) {
      expect(displayText(h)).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/u);
    }
    expect(displayText('abc\u202Eevil\u202C')).toBe('abcevil');
    expect(displayText('<b>x</b>')).toBe('<b>x</b>');
    expect(displayText(null)).toBe('');
    expect(displayText(undefined)).toBe('');
  });

  it('reasonSchema trims, bounds length, and rejects control/bidi', () => {
    expect(reasonSchema.safeParse('  short  ').success).toBe(false);
    expect(reasonSchema.parse('   ten chars!!   ')).toBe('ten chars!!');
    expect(reasonSchema.safeParse('valid reason\u202E here').success).toBe(false);
    expect(reasonSchema.safeParse('valid reason\nhere').success).toBe(false);
    expect(reasonSchema.safeParse('x'.repeat(2001)).success).toBe(false);
    expect(reasonSchema.safeParse('x'.repeat(2000)).success).toBe(true);
  });

  it('multiLine strips then enforces min length', () => {
    const s = multiLine(1, 20);
    expect(s.parse('a\u0000b\nc')).toBe('ab\nc');
    expect(s.safeParse('\u0000\u0001').success).toBe(false);
    expect(s.safeParse('x'.repeat(21)).success).toBe(false);
  });
});
