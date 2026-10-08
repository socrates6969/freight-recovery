import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'tokens.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/gu)) out[m[1] ?? ''] = m[2] ?? '';
  return out;
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

const PAIRS: [string, string, number][] = [
  ['color-text', 'color-bg', 4.5],
  ['color-text', 'color-surface', 4.5],
  ['color-text-muted', 'color-bg', 4.5],
  ['color-text-muted', 'color-surface', 4.5],
  ['color-text-subtle', 'color-bg', 4.5],
  ['color-accent', 'color-bg', 4.5],
  ['color-accent', 'color-accent-tint', 4.5],
  ['color-on-accent', 'color-accent', 4.5],
  ['color-on-accent', 'color-accent-hover', 4.5],
  ['color-danger', 'color-bg', 4.5],
  ['color-danger', 'color-danger-tint', 4.5],
  ['color-warn', 'color-warn-tint', 4.5],
  ['color-success', 'color-success-tint', 4.5],
  ['color-border-strong', 'color-bg', 1.3],
];

describe('design token contrast (WCAG AA)', () => {
  it('computes known reference ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  for (const theme of [':root', "[data-theme='dark']"]) {
    it(`meets AA for text pairs in ${theme}`, () => {
      const t = { ...block(':root'), ...block(theme) };
      for (const [fg, bg, min] of PAIRS) {
        const a = t[fg];
        const b = t[bg];
        expect(a && b, `${fg}/${bg}`).toBeTruthy();
        expect([theme, fg, bg, contrast(a ?? '#000000', b ?? '#000000') >= min]).toEqual([theme, fg, bg, true]);
      }
    });
  }

  it('uses the deep teal accent family', () => {
    const t = block(':root');
    expect([t['color-accent'], t['color-accent-hover'], t['color-accent-tint']]).toEqual(['#0f766e', '#115e59', '#f0fdfa']);
  });
});
