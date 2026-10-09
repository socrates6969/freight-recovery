import { describe, expect, it } from 'vitest';

import { cpLength, cpSlice, md, plain, pySplitlines, pySplitlinesWithOffsets, pyStrip, sanitizeSingleLine } from './text-sanitize.js';

describe('Python text primitives', () => {
  it('pyStrip uses Python str.isspace (not FEFF, not 200B)', () => {
    expect(pyStrip('\u{a0}\u{3000} x \u{2028}\u{1680}')).toBe('x');
    expect(pyStrip('\u{feff}x\u{200b}')).toBe('\u{feff}x\u{200b}');
    expect(pyStrip('\u001cx\u001f')).toBe('x');
  });

  it('pySplitlines splits on every Python line boundary, CRLF once, no trailing empty element', () => {
    expect(pySplitlines('a\r\nb\rc\nd\u000be\u000cf\u001cg\u001dh\u001ei\u{85}j\u{2028}k\u{2029}l')).toEqual([
      'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l',
    ]);
    expect(pySplitlines('a\n')).toEqual(['a']);
    expect(pySplitlines('')).toEqual([]);
    expect(pySplitlines('\n')).toEqual(['']);
    expect(pySplitlines('a\n\nb\u001f')).toEqual(['a', '', 'b\u001f']);
    expect(pySplitlinesWithOffsets('ab\r\ncd').map((l) => l.start)).toEqual([0, 4]);
  });

  it('counts and slices code points, not UTF-16 units', () => {
    expect(cpLength('\u{1F600}a')).toBe(2);
    expect(cpSlice('\u{1F600}\u{1F600}a', 1)).toBe('\u{1F600}');
  });
});

describe('plain / md (sanitize.py parity, vectors from CPython)', () => {
  it.each([
    ['a\u0000b\u{2028}c', 'a b c'],
    ['x  \u001f\u001f y', 'x y'],
    ['<b>bold</b> `code`', 'bbold/b code'],
    ['  ', ''],
    ['\u{202e}hi\u{2066}', 'hi'],
    ['tab\there', 'tab here'],
    ['line\r\nnext', 'line next'],
  ])('plain(%j) = %j', (input, expected) => {
    expect(plain(input)).toBe(expected);
    expect(md(input)).toBe(expected);
  });

  it('truncates by code points with an ellipsis', () => {
    expect(plain('a'.repeat(205))).toBe(`${'a'.repeat(197)}...`);
    const emoji = '\u{1F600}'.repeat(199) + 'xyz';
    expect(plain(emoji)).toBe(`${'\u{1F600}'.repeat(197)}...`);
    expect(plain('a'.repeat(10), 8)).toBe('aaaaa...');
  });

  it('md escapes markdown metacharacters', () => {
    expect(md('*_[x](y)#&~|\\')).toBe('\\*\\_\\[x\\](y)\\#\\&\\~\\|\\\\');
  });
});

describe('sanitizeSingleLine', () => {
  it('removes unsafe characters, strips and caps, reporting changes', () => {
    expect(sanitizeSingleLine('  Acme  ', 200)).toEqual({ value: 'Acme', changed: false });
    expect(sanitizeSingleLine('Ac\u{202e}me', 200)).toEqual({ value: 'Acme', changed: true });
    expect(sanitizeSingleLine('a'.repeat(250), 200)).toEqual({ value: 'a'.repeat(200), changed: true });
    expect(sanitizeSingleLine('x\ty', 200)).toEqual({ value: 'xy', changed: true });
  });
});
