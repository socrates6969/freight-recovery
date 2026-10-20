// REQ-20261011-fuel-outlook Tier L (file checks only, no database): CI-D04 migration immutability and the new
// migration's presence, CI-I06 no outbound price fetch outside the importer CLI, F16 `.env.example` entry. The
// database-level checks of T14 are in fuel-db.acc.test.ts (Tier H).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const MIG = resolve(ROOT, 'api', 'prisma', 'migrations');
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
/** sha256 of every file of the six earlier migrations as committed at 5f7eb7e (`git show 5f7eb7e:<path>`). */
const FROZEN_5F7EB7E: Record<string, string> = {
  '20261008000000_init/migration.sql': 'bea2ee6796b489535845722913651534400ebac10e36aa6517b57306a378126c',
  '20261009000000_import_export/migration.sql': '8699637753c358bddef3863c9b281e4114c30dfa6bd77d9f7ef977b8c730b36c',
  '20261010000000_intelligence/migration.sql': '4f9717fc5428503c5e005c08cc7808b54514bdf5a077c9c8b98d2e301378d916',
  '20261011000000_four_eyes/migration.sql': '2ad97a26f2b93813773ee990bfb58748d4cd9e6ede1c4631eb0977feb5790d1d',
  '20261012000000_analysis/migration.sql': '29102ab01c76c1e5f1d215dae0d901b4cffb81ce86d596dfee6dd9b5b55ac934',
  '20261013000000_charge_intelligence/migration.sql': '01815dceef218c0c81cb6b34f359d927900f67abc193f4c189d7d9070c205b8b',
};
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, '/');

describe('CI-D04 migrations (F14)', () => {
  it('the six earlier migration folders are byte-identical to 5f7eb7e and contain nothing else', () => {
    for (const [f, h] of Object.entries(FROZEN_5F7EB7E)) expect(sha(join(MIG, f)), f).toBe(h);
    for (const dir of new Set(Object.keys(FROZEN_5F7EB7E).map((f) => f.split('/')[0] ?? ''))) expect(readdirSync(join(MIG, dir)), dir).toEqual(['migration.sql']);
  });
  it('exactly one new migration folder 20261014000000_fuel_outlook, after the earlier ones', () => {
    const dirs = readdirSync(MIG).filter((d) => statSync(join(MIG, d)).isDirectory()).sort();
    // REQ-20261011-ocean-dd C11 (additive pin update): step 8 adds exactly one later folder ending in _ocean_dd; the
    // step-7 folder itself is pinned byte-for-byte in dd-static.acc.test.ts.
    // Step 8 fix round 4 (additive): plus exactly one index-only folder 20261017000000_audit_target_index (both step-8
    // folders are pinned byte-for-byte in dd-static.acc.test.ts).
    const step8 = dirs.filter((d) => /^\d{14}_ocean_dd$/.test(d) || d === '20261017000000_audit_target_index');
    expect(step8, 'exactly the two step-8 migration folders').toHaveLength(2);
    // REQ-20261012-hardening C0.2 (additive): plus exactly one folder 20261018000000_hardening, sorted after the step-8 ones.
    // fix round 2 (C-FR2.2 DB guard; additive): plus exactly one folder 20261019000000_hardening_fr2 after it.
    // REQ-20261020-claim-outcomes (additive): plus exactly one folder 20261020000000_claim_outcomes after the hardening ones.
    // REQ-20261020-dd-deadline (additive): plus exactly one folder 20261020000000_routing_shadow_flag after it (same date prefix,
    // ordered by the full name).
    const later = ['20261018000000_hardening', '20261019000000_hardening_fr2', '20261020000000_claim_outcomes', '20261020000000_routing_shadow_flag'];
    expect(dirs.filter((d) => !step8.includes(d) && !later.includes(d))).toEqual([...new Set(Object.keys(FROZEN_5F7EB7E).map((f) => f.split('/')[0] ?? ''))].sort().concat(['20261014000000_fuel_outlook']));
    expect(dirs.slice(-6), 'the step-8 folders, then the hardening, outcomes and routing-flag folders, sort last').toEqual([...step8, ...later]);
    const sql = readFileSync(join(MIG, '20261014000000_fuel_outlook', 'migration.sql'), 'utf8');
    for (const t of ['fsc_tables', 'claim_fuel_inputs', 'price_imports', 'price_observations']) {
      expect(sql, `${t} RLS enabled`).toMatch(new RegExp(`ALTER\\s+TABLE\\s+"?${t}"?\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i'));
      expect(sql, `${t} RLS forced`).toMatch(new RegExp(`ALTER\\s+TABLE\\s+"?${t}"?\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i'));
    }
    expect(sql).toContain('intelligence.cost_outlook');
    expect(sql).toContain('intelligence.fuel_check');
    expect(sql, 'no BYPASSRLS anywhere').not.toMatch(/BYPASSRLS/i);
  });
});

describe('CI-I06 no outbound price fetch from request paths (F9)', () => {
  it('only api/src/platform/prices-cli.ts calls fetch(; no other module imports prices-cli', () => {
    const files = walk(resolve(ROOT, 'api', 'src')).filter((p) => /\.(ts|js|mjs|cjs)$/.test(p) && !/\.test\.ts$/.test(p) && !p.includes(`${'generated'}`));
    expect(files.length).toBeGreaterThan(20);
    const callers = files.filter((p) => /(^|[^\w.])fetch\s*\(/.test(readFileSync(p, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))).map(rel);
    expect(callers.filter((p) => p !== 'api/src/platform/prices-cli.ts')).toEqual([]);
    const importers = files.filter((p) => !p.endsWith('prices-cli.ts') && /from\s+['"][^'"]*prices-cli(\.js)?['"]|import\(\s*['"][^'"]*prices-cli/.test(readFileSync(p, 'utf8'))).map(rel);
    expect(importers).toEqual([]);
  });
});

describe('F16 configuration', () => {
  it('.env.example lists PRICE_CACHE_TTL_MS (placeholder only)', () => {
    const p = resolve(ROOT, '.env.example');
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, 'utf8')).toMatch(/^#?\s*PRICE_CACHE_TTL_MS=/m);
  });
});
