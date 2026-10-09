/* eslint-disable */
// T-SHARED-IMP: permission matrix rows, strict schemas, sanitizer and money parity with the Python reference, audit constants.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_PERMS, EXPECTED, ROLES } from './helpers/oracle.js';

const load = async () => (await import('@fr/shared')) as any;
const REPO = resolve(__dirname, '..', '..', '..');
function python(): { cmd: string; env: NodeJS.ProcessEnv } | null {
  const env = { ...process.env, PYTHONPATH: process.env.PYTHONPATH ?? resolve(REPO, 'src'), PYTHONIOENCODING: 'utf-8' };
  for (const c of [process.env.PYTHON, resolve(REPO, '.venv/Scripts/python.exe'), resolve(REPO, '.venv/bin/python'), 'python3', 'python'].filter(Boolean) as string[]) {
    if (spawnSync(c, ['-c', 'import freight_recovery.evidence.sanitize, freight_recovery.extraction.stub'], { env }).status === 0) return { cmd: c, env };
  }
  if (process.env.CI === 'true' || process.env.CI === '1') throw new Error('Python oracle required in CI for the shared parity checks');
  console.warn('[ACCEPTANCE SKIP] Python oracle unavailable for shared sanitizer/money parity');
  return null;
}
const py = (p: { cmd: string; env: NodeJS.ProcessEnv }, code: string, input: unknown) => {
  const r = spawnSync(p.cmd, ['-c', code], { env: p.env, input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
};

describe('T-SHARED-IMP permission matrix', () => {
  it('can() equals the N2 table for 8 roles x all permissions, including the new rows', async () => {
    const m = await load();
    for (const p of ['import:review', 'export:claims', 'export:packets', 'export:outcomes', 'import:run']) expect(ALL_PERMS).toContain(p);
    for (const role of ROLES) for (const p of ALL_PERMS) expect(m.can(role, p), `${role} ${p}`).toBe(EXPECTED[role].includes(p));
    for (const r of ['PLATFORM_DEV', 'SUPER_ADMIN']) for (const p of ['import:run', 'import:review', 'export:claims', 'export:packets', 'export:outcomes']) expect(m.can(r, p)).toBe(false);
    expect(m.can('VIEWER', 'export:claims')).toBe(false);
    expect(m.can('ANALYST', 'export:packets')).toBe(false);
  });
});
describe('T-SHARED-IMP audit constants and ClaimStatus', () => {
  it('audit action constants include every N10 action; ClaimStatus gains AWAITING_ANALYSIS', async () => {
    const m = await load();
    const vals = new Set<string>();
    const walk = (o: any, d = 0) => { if (d > 3 || o == null) return; if (typeof o === 'string') vals.add(o); else if (typeof o === 'object') for (const v of Object.values(o)) walk(v, d + 1); };
    walk(m);
    for (const a of ['import.batch_created', 'import.document_received', 'import.document_rejected', 'import.document_parsed', 'import.document_downloaded', 'review.field_resolved', 'review.field_added', 'review.doctype_set', 'review.document_accepted', 'review.document_rejected', 'import.committed', 'claim.created_from_import', 'claim.documents_linked', 'export.started', 'export.completed', 'export.aborted']) expect(vals.has(a), a).toBe(true);
    expect(vals.has('AWAITING_ANALYSIS')).toBe(true);
  });
});
describe('T-SHARED-IMP schemas', () => {
  it('request schemas are strict (unknown key rejected) where exported', async () => {
    const m = await load();
    const names = Object.keys(m).filter((k) => /(Import|Review|Commit|Resolve|Accept|Reject|Export).*(Req|Request|Body|Input)|(Req|Request|Body|Input).*(Import|Review|Commit|Resolve)/i.test(k) && typeof m[k]?.safeParse === 'function');
    console.log('[SHARED] request schemas discovered:', names.join(', ') || '(none)');
    const cases: Record<string, any> = { label: { label: 'x' }, reason: { reason: 'long enough reason' }, perspective: { perspective: 'SHIPPER' } };
    for (const n of names) {
      const ok = Object.values(cases).some((c) => m[n].safeParse(c).success) || m[n].safeParse({}).success;
      if (!ok) continue;
      for (const c of [{}, ...Object.values(cases)]) if (m[n].safeParse(c).success) expect(m[n].safeParse({ ...c, __extra: 1 }).success, `${n} must be strict`).toBe(false);
    }
  });
});
describe('T-SHARED-IMP Python parity (sanitizer and money)', () => {
  it('plain()/md() equal evidence/sanitize.py on >= 200 strings', async (ctx) => {
    const p = python();
    if (!p) return ctx.skip('Python oracle unavailable');
    const m = await load();
    if (typeof m.plain !== 'function' || typeof m.md !== 'function') return ctx.skip('plain/md not exported');
    const atoms = ['a', 'B', ' ', '\t', '\n', '\r', '`', '<', '>', '|', '*', '_', '[', ']', '#', '&', '~', String.fromCharCode(92), '\u0001', '\u007f', '\u0085', '\u2028', '\u2029', '\u202e', '\u2066', '\u2069', '\u00a0', '\ud83d\ude9a', 'x'.repeat(50)];
    let s = 13579;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const inputs = Array.from({ length: 230 }, (_, i) => (i === 0 ? 'x'.repeat(200) : i === 1 ? 'x'.repeat(201) : Array.from({ length: 1 + Math.floor(rnd() * 14) }, () => atoms[Math.floor(rnd() * atoms.length)]).join('')));
    const want = py(p, 'import sys,json\nfrom freight_recovery.evidence.sanitize import plain, md\nxs=json.load(sys.stdin)\nprint(json.dumps([[plain(x), md(x)] for x in xs]))', inputs);
    inputs.forEach((x, i) => { expect(m.plain(x), JSON.stringify(x)).toBe(want[i][0]); expect(m.md(x), JSON.stringify(x)).toBe(want[i][1]); });
  });
  it('parseMoney agrees with Python parse_money on the money corpus', async (ctx) => {
    const p = python();
    if (!p) return ctx.skip('Python oracle unavailable');
    const m = await load();
    const fn = m.parseMoney;
    if (typeof fn !== 'function') return ctx.skip('parseMoney not exported');
    const corpus = ['$2,118.00', '(300.00)', '300 USD', 'usd 300', '-0', '007.50', '-0.00', '1500', 'NaN', 'Infinity', '1e3', '0x10', '1,2,3', '$-5', '(1,234.5.6)', '', '$', '99999999999999999999', '1234567.1234567', '12abc'];
    const want = py(p, 'import sys,json\nfrom freight_recovery.extraction.stub import parse_money\nxs=json.load(sys.stdin)\nprint(json.dumps([None if (d:=parse_money(x)) is None else str(d) for x in xs]))', corpus);
    corpus.forEach((x, i) => {
      let got: any = null;
      try { const r = fn(x); got = r == null ? null : typeof r === 'string' ? r : r.toString?.() ?? r.value ?? null; } catch { got = null; }
      expect(got, JSON.stringify(x)).toBe(want[i]);
    });
  });
});
