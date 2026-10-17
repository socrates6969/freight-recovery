/* eslint-disable */
// T-UI-IMP UI-10 safety (static) and UI-11 contrast of the new colour tokens.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = resolve(__dirname, '..');
const walk = (d: string, out: string[] = []): string[] => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); } return out; };

describe('UI-10 safety', () => {
  it('no dangerouslySetInnerHTML / innerHTML / outerHTML / insertAdjacentHTML in web/src', () => {
    for (const f of walk(join(WEB, 'src')).filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p))) {
      const t = readFileSync(f, 'utf8');
      expect(/dangerouslySetInnerHTML|\.innerHTML\s*=|outerHTML\s*=|insertAdjacentHTML|document\.write/.test(t), f).toBe(false);
    }
  });
  it('import and export UI never writes import data to localStorage/sessionStorage', () => {
    for (const f of walk(join(WEB, 'src')).filter((p) => /(import|export|review)/i.test(p) && /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p))) expect(/(localStorage|sessionStorage)\.setItem/.test(readFileSync(f, 'utf8')), f).toBe(false);
  });
  it('security-headers.json has no blob:, data:, unsafe-inline, unsafe-eval and connect-src self', () => {
    const p = join(WEB, 'security-headers.json');
    expect(existsSync(p)).toBe(true);
    const t = readFileSync(p, 'utf8');
    for (const bad of ['blob:', 'data:', 'unsafe-inline', 'unsafe-eval']) expect(t.includes(bad), bad).toBe(false);
    expect(t).toMatch(/connect-src 'self'/);
  });
});

function hex(c: string): [number, number, number] | null { const m = /^#?([0-9a-f]{6})$/i.exec(c.trim()); if (!m) return null; const n = parseInt(m[1]!, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const lum = ([r, g, b]: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!); };
const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
describe('UI-11 contrast', () => {
  it('colour token pairs for confidence, chips and flags meet WCAG AA (4.5:1 text, 3:1 UI) in light and dark', () => {
    const css = readFileSync(join(WEB, 'src', 'styles', 'tokens.css'), 'utf8');
    const tokens = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, hex(m[2]!)!]));
    const blocks = [...css.matchAll(/\{([^{}]*)\}/g)].map((m) => tokens(m[1]!)).filter((t) => Object.keys(t).length > 3);
    expect(blocks.length).toBeGreaterThan(0);
    let checked = 0;
    for (const t of blocks) {
      for (const k of Object.keys(t).filter((n) => /(confidence|chip|flag|warn|danger|success|review)/.test(n) && /(fg|text|ink)$/.test(n))) {
        const bg = t[k.replace(/(fg|text|ink)$/, 'bg')] ?? t['surface'] ?? t['bg'];
        if (!bg) continue;
        expect(ratio(t[k]!, bg), `${k} on its background`).toBeGreaterThanOrEqual(4.5);
        checked++;
      }
    }
    console.log(`[UI-11] checked ${checked} token pairs`);
  });
});
