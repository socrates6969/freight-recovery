// @vitest-environment node
/* eslint-disable */
// T-HDR-02, T-HDR-03, T-UI-15, build-dependent part of T-UI-13 (focus ring, contrast)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '..', '..');
const DIST = resolve(REPO, 'web', 'dist');
const files = (dir: string, out: string[] = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    statSync(p).isDirectory() ? files(p, out) : out.push(p);
  }
  return out;
};
const text = (p: string) => readFileSync(p, 'utf8');
const hdrs = () => {
  const raw = JSON.parse(text(resolve(REPO, 'web', 'security-headers.json'))).headers as Record<string, string>;
  const m = new Map(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
  return { raw, get: (k: string) => m.get(k.toLowerCase()) };
};

beforeAll(() => {
  if (process.env.ACC_SKIP_BUILD === '1' && existsSync(DIST)) return;
  const r = spawnSync('npm run build -w web', { cwd: REPO, shell: true, encoding: 'utf8', timeout: 900000 });
  if (r.status !== 0) throw new Error(`npm run build -w web failed\n${r.stdout}\n${r.stderr}`);
}, 960000);

describe('T-HDR-02 web security headers source of truth', () => {
  it('CSP, HSTS and companion headers', () => {
    const h = hdrs();
    const csp = h.get('content-security-policy')!;
    expect(csp, 'Content-Security-Policy present').toBeTruthy();
    for (const must of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'", "connect-src 'self'"]) expect(csp, must).toContain(must);
    for (const mustNot of ['unsafe-inline', 'unsafe-eval', '*', 'data:', 'http:', 'blob:']) expect(csp.includes(mustNot), `CSP must not contain ${mustNot}`).toBe(false);
    const hsts = h.get('strict-transport-security')!;
    expect(Number(/max-age=(\d+)/.exec(hsts)?.[1])).toBeGreaterThanOrEqual(31536000);
    expect(h.get('x-content-type-options')).toBe('nosniff');
    expect(h.get('referrer-policy')).toBe('no-referrer');
    expect(h.get('x-frame-options')).toBe('DENY');
  });
});

// Documented allow-list of literal URLs permitted in emitted assets: text only, never fetched.
const ALLOW = [
  /^http:\/\/www\.w3\.org\//,
  /^https:\/\/(react\.dev|reactjs\.org|reactrouter\.com|tanstack\.com|developer\.mozilla\.org|bugs\.webkit\.org|json-schema\.org)\//,
  /^http:\/\/json-schema\.org\//,
  /^https:\/\/github\.com\/(facebook\/react|ungap|tc39)\//,
  /^http:\/\/localhost$/, // dummy base for URL parsing inside bundled libraries
  /^https:\/\/app\.invalid$/, // dummy base used to parse relative redirect targets (never fetched)
  /^http:\/\/\[\$\{/, // template literal inside a bundled library
];

describe('T-HDR-03 built output hygiene', () => {
  it('index.html has no inline script/style/handlers/javascript:/base and only relative same-origin refs', () => {
    const html = text(join(DIST, 'index.html'));
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      expect(/\bsrc\s*=/.test(m[1]!), 'script must have src').toBe(true);
      expect(m[2]!.trim(), 'no inline script body').toBe('');
    }
    expect(/<style\b/i.test(html)).toBe(false);
    expect(/\son[a-z]+\s*=/i.test(html)).toBe(false);
    expect(/javascript:/i.test(html)).toBe(false);
    expect(/<base\b/i.test(html)).toBe(false);
    const refs = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi), ...html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(r), `ref ${r} must be relative/same-origin`).toBe(false);
  });
  it('no absolute http(s) URLs in emitted assets beyond the documented allow-list', () => {
    const bad: string[] = [];
    for (const f of files(DIST)) {
      if (!/\.(html|js|mjs|css|json|svg|txt|webmanifest|map)$/.test(f) || f.endsWith('.map')) continue;
      for (const m of text(f).matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)) if (!ALLOW.some((re) => re.test(m[0]))) bad.push(`${f.slice(DIST.length)}: ${m[0].slice(0, 80)}`);
    }
    expect(bad, `un-allowed URLs (allow-list: ${ALLOW.map(String).join(', ')})`).toEqual([]);
  });
});

const css = () => files(DIST).filter((f) => f.endsWith('.css')).map(text).join('\n');
const props = (src: string) => {
  const m = new Map<string, string>();
  for (const x of src.matchAll(/--([\w-]+)\s*:\s*([^;}]+)[;}]/g)) if (!m.has(x[1]!)) m.set(x[1]!, x[2]!.trim());
  return m;
};
function lum(hex: string) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

describe('T-UI-15 design contract smoke', () => {
  it('tokens for color/spacing/radius/font; Inter first in the font stack; no external CSS/font URLs', () => {
    const c = css();
    expect(c.length).toBeGreaterThan(100);
    const p = props(c);
    const names = [...p.keys()];
    for (const [label, re] of [['color', /color|bg|background|foreground|text|accent|primary/], ['spacing', /space|spacing|gap/], ['radius', /radius/], ['font', /font/]] as const) expect(names.some((n) => re.test(n)), `a ${label} token exists (have: ${names.slice(0, 20).join(', ')})`).toBe(true);
    const stacks = [...c.matchAll(/(?:font-family|--font[\w-]*)\s*:\s*([^;}]+)/g)].map((m) => m[1]!.trim());
    expect(stacks.some((s) => /^["']?Inter\b/i.test(s)), `font stack must begin with Inter (found: ${stacks.slice(0, 3).join(' | ')})`).toBe(true);
    expect(/@import\s+(?:url\()?["']?https?:/i.test(c)).toBe(false);
    expect(/url\(\s*["']?https?:/i.test(c)).toBe(false);
  });
});

describe('T-UI-13 build-dependent accessibility checks', () => {
  it('no outline removal without a visible replacement', () => {
    const c = css().replace(/\/\*[\s\S]*?\*\//g, '');
    const bad: string[] = [];
    for (const m of c.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/outline\s*:\s*(none|0)\b|outline-style\s*:\s*none/.test(m[2]!)) continue;
      if (/box-shadow\s*:\s*(?!none)|border(-color)?\s*:\s*(?!none|0)|outline-color/.test(m[2]!)) continue;
      bad.push(m[1]!.trim().slice(0, 80));
    }
    expect(bad, 'selectors that remove the focus outline without replacement').toEqual([]);
  });
  it('contrast >= 4.5:1 for text/background, muted text/background, and on-accent text', (ctx) => {
    const c = css();
    const root = /:root\s*\{([^}]*)\}/.exec(c)?.[1] ?? c;
    const p = props(root);
    const norm = new Map([...p].map(([k, v]) => [k.replace(/^(color|colors|clr)-/, ''), v]));
    const hex = (v?: string) => (v && /^#[0-9a-f]{3,6}$/i.test(v) ? v : undefined);
    const pick = (cands: string[]) => cands.map((n) => hex(norm.get(n))).find(Boolean);
    const bg = pick(['background', 'bg', 'surface', 'page', 'canvas']);
    const fg = pick(['foreground', 'fg', 'text', 'text-primary', 'on-background', 'ink']);
    const muted = pick(['muted-foreground', 'text-muted', 'muted-fg', 'muted', 'text-secondary', 'fg-muted']);
    const acc = pick(['accent', 'primary', 'brand', 'accent-bg', 'primary-bg']);
    const onAcc = pick(['accent-foreground', 'on-accent', 'primary-foreground', 'on-primary', 'accent-fg', 'primary-fg']) ?? '#ffffff';
    if (!bg || !fg) return ctx.skip(`design tokens not discoverable as hex in :root; names seen: ${[...norm.keys()].join(', ')}`);
    expect(ratio(fg, bg), 'primary text on background').toBeGreaterThanOrEqual(4.5);
    if (muted) expect(ratio(muted, bg), 'muted text on background').toBeGreaterThanOrEqual(4.5);
    if (acc) expect(ratio(onAcc, acc), 'text on accent').toBeGreaterThanOrEqual(4.5);
  });
});