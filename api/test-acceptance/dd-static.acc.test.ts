// REQ-20261011-ocean-dd Tier L (file checks only, no database): DD-DB05 migration immutability and the new migration's
// shape (Part C C11, C16), TENANT_MODELS registration (CLAUDE.md rule 2), step-7 engine files unchanged (C20). The
// database-level checks of T10 are in dd-db.acc.test.ts (Tier H).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const MIG = resolve(ROOT, 'api', 'prisma', 'migrations');
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
/** sha256 of every file of the seven earlier migrations as committed at ce107d0 (`git show ce107d0:<path>`). */
const FROZEN_CE107D0: Record<string, string> = {
  '20261008000000_init/migration.sql': 'bea2ee6796b489535845722913651534400ebac10e36aa6517b57306a378126c',
  '20261009000000_import_export/migration.sql': '8699637753c358bddef3863c9b281e4114c30dfa6bd77d9f7ef977b8c730b36c',
  '20261010000000_intelligence/migration.sql': '4f9717fc5428503c5e005c08cc7808b54514bdf5a077c9c8b98d2e301378d916',
  '20261011000000_four_eyes/migration.sql': '2ad97a26f2b93813773ee990bfb58748d4cd9e6ede1c4631eb0977feb5790d1d',
  '20261012000000_analysis/migration.sql': '29102ab01c76c1e5f1d215dae0d901b4cffb81ce86d596dfee6dd9b5b55ac934',
  '20261013000000_charge_intelligence/migration.sql': '01815dceef218c0c81cb6b34f359d927900f67abc193f4c189d7d9070c205b8b',
  '20261014000000_fuel_outlook/migration.sql': 'd6fddbb185e4b32959cfd5367045edc70c9906ecb2ff331170fae322550137c0',
};
/** LF-normalized sha256 of the step-7 engine files at ce107d0 (packages/shared/src). */
const FROZEN_STEP7: Record<string, string> = {
  'fuel/check.ts': '2f28c010903b0330d57e115118d6144f2288e2a143a66c7b1d04218e42141a6b',
  'fuel/constants.ts': '976576153205644855c8f5b1ba1b8e6bc27ec0a679f0d044055c450139ef44dd',
  'fuel/copy.ts': '5d44f6f1a762f1803504b30c8cbba67d2452ebf666989d29a049e07117d47cc5',
  'fuel/evidence.ts': 'b33232ceeb28b04332641d291c3cbd415cb49c316b07e49aaa948e788c110987',
  'fuel/index.ts': '8e2bf891fd34aed49439707bfbbe5120f4000d80e4275c24a962586c2dc85213',
  'fuel/table.ts': 'd047817facd46628aa56bcd0826e755e3dea9c56ff3cbcec8494abbb32a94661',
  'fuel/week.ts': '42b6540aa0287fcd26cfcd1cbefe0ca3a5d5af1e91ca3fed9dd15214168efc64',
  'outlook/ar.ts': '32e966e4f0d10b1b0da916440026cae36f449ba79dd84de529c9c51e26087d34',
  'outlook/backtest.ts': 'a4051d89d020796facbe4c98dec121a7f178bfe54d0801310a55eb190021aa0a',
  'outlook/constants.ts': '97b705ac668f515527767dd55596020350fdaeab227f776b1d12e3f58754b2bc',
  'outlook/copy.ts': '67d53f7e6f0df6dee3727e96988e56609b1788b97dda5b6142785a318f5ffcbd',
  'outlook/csv.ts': '0c1b728567513ca2d6c848408a382e448196de536adc988409b8059755edfa4c',
  'outlook/index.ts': '0e47a7c6f75640e49637b32b9388633e4455cf841ed35c4dd17735c0d2b9d05c',
  'outlook/outlook.ts': '17f3c927e49032f3a34a3e0b8c4c7810164bd6dfe7c110113e8e35e0036bef0e',
  'outlook/sha256.ts': '646d6455550b0626fd2e857e0ab05b5ccd4cf20f62ef08cd33db783375aa1e57',
};
const TABLES = ['dd_tariffs', 'dd_calendars', 'dd_invoices'] as const;
const stripComments = (sql: string) => sql.replace(/--.*$/gm, '');
/** C11 grants to freight_app: table privileges and UPDATE columns (sorted). */
const C11_GRANTS: Record<string, { table: string[]; update: string[] }> = {
  dd_calendars: { table: ['INSERT', 'SELECT'], update: ['data', 'name', 'updated_at', 'updated_by_id', 'version'] },
  dd_invoices: { table: ['DELETE', 'INSERT', 'SELECT'], update: ['audit_snapshot', 'audited_at', 'billing_party_name', 'calendar_id', 'claim_id', 'data', 'invoice_date', 'invoice_number', 'status', 'tariff_id', 'total_due_cents', 'updated_at', 'updated_by_id', 'version'] },
  dd_tariffs: { table: ['INSERT', 'SELECT'], update: ['carrier', 'charge_type', 'data', 'direction', 'name', 'updated_at', 'updated_by_id', 'version'] },
};
const statements = (sql: string) => sql.split(';').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
const tableList = (x: string) => x.split(',').map((t) => t.trim().replace(/^TABLE /i, '').replace(/"/g, ''));
/** Tables named in `REVOKE ALL ON <tables> FROM PUBLIC` statements (functions excluded). */
function revoked(sql: string): string[] {
  return statements(sql).flatMap((st) => {
    const m = /^REVOKE ALL ON (?!FUNCTION)(.+) FROM PUBLIC$/i.exec(st);
    return m ? tableList(m[1] ?? '') : [];
  });
}
/** Table privileges and UPDATE column lists granted on the D&D tables, parsed from the GRANT statements. */
function grants(sql: string): Record<string, { table: string[]; update: string[] }> {
  const out: Record<string, { table: Set<string>; update: Set<string> }> = {};
  for (const st of statements(sql)) {
    const m = /^GRANT (.+?) ON (?!FUNCTION|SEQUENCE|SCHEMA)(.+) TO (\w+)$/i.exec(st);
    if (!m) continue;
    const tables = tableList(m[2] ?? '').filter((t) => t.startsWith('dd_'));
    if (!tables.length) continue;
    expect(m[3], st).toBe('freight_app');
    const parts = (m[1] ?? '').match(/\w+(\s*\([^)]*\))?/g) ?? [];
    for (const t of tables) {
      const e = (out[t] ??= { table: new Set(), update: new Set() });
      for (const part of parts) {
        const cm = /^(\w+)\s*\(([^)]*)\)$/.exec(part);
        if (cm) {
          expect((cm[1] ?? '').toUpperCase(), st).toBe('UPDATE');
          for (const col of (cm[2] ?? '').split(',')) e.update.add(col.trim().replace(/"/g, ''));
        } else e.table.add(part.toUpperCase());
      }
    }
  }
  return Object.fromEntries(Object.keys(out).sort().map((t) => [t, { table: [...(out[t]?.table ?? [])].sort(), update: [...(out[t]?.update ?? [])].sort() }]));
}
/** Fix round 4: index-only migration after the step-8 table migration. */
const INDEX_DIR = '20261017000000_audit_target_index';
/** REQ-20261012-hardening C0.2 (additive): exactly one trigger/CHECK-only folder after the index migration
 *  (its content is pinned in hardening-static.acc.test.ts). */
const HARDENING_DIR = '20261018000000_hardening';
/** REQ-20261012-hardening fix round 2 (C-FR2.2 DB guard; additive): exactly one further function-only folder (content pinned
 *  in hardening-static.acc.test.ts FR2-S01). */
const HARDENING_FR2_DIR = '20261019000000_hardening_fr2';
/** sha256 of the step-8 migration files: ocean_dd as reviewed at 10f8941 (unchanged in 47a80bb), the index migration at 47a80bb. */
const STEP8_PINS: Record<string, string> = {
  '20261016000000_ocean_dd/migration.sql': 'e872fed671c0e58c56aa808b26e29cb2833fdbf3af96622e3e4c382ca45016f1',
  '20261017000000_audit_target_index/migration.sql': 'd4782f35f97e137f2daa9a6a882f618b1d47e43a15c336ec80e4614487baefe8',
};
const dd8Sha = () => Object.fromEntries(Object.keys(STEP8_PINS).map((f) => [f, sha(readFileSync(join(MIG, f)))]));
function ddDir(): string {
  const dirs = readdirSync(MIG).filter((d) => statSync(join(MIG, d)).isDirectory()).sort();
  const dd = dirs.filter((d) => /^\d{14}_ocean_dd$/.test(d));
  expect(dd, 'exactly one *_ocean_dd migration folder').toHaveLength(1);
  return dd[0] ?? '';
}

describe('DD-DB05 migrations (C11)', () => {
  it('the seven earlier migration folders are byte-identical to ce107d0 and contain only migration.sql', () => {
    for (const [f, h] of Object.entries(FROZEN_CE107D0)) expect(sha(readFileSync(join(MIG, f))), f).toBe(h);
    for (const dir of new Set(Object.keys(FROZEN_CE107D0).map((f) => f.split('/')[0] ?? ''))) expect(readdirSync(join(MIG, dir)), dir).toEqual(['migration.sql']);
  });
  it('exactly one new folder *_ocean_dd after every earlier one, then (fix round 4) exactly one index-only folder 20261017000000_audit_target_index, then (hardening) 20261018000000_hardening', () => {
    const dirs = readdirSync(MIG).filter((d) => statSync(join(MIG, d)).isDirectory()).sort();
    const dd = ddDir();
    expect(dirs).toEqual([...new Set(Object.keys(FROZEN_CE107D0).map((f) => f.split('/')[0] ?? ''))].sort().concat([dd, INDEX_DIR, HARDENING_DIR, HARDENING_FR2_DIR]));
    expect(readdirSync(join(MIG, HARDENING_DIR))).toEqual(['migration.sql']);
    expect(readdirSync(join(MIG, HARDENING_FR2_DIR))).toEqual(['migration.sql']);
    expect(dd > '20261014000000_fuel_outlook').toBe(true);
    expect(readdirSync(join(MIG, dd))).toEqual(['migration.sql']);
    expect(readdirSync(join(MIG, INDEX_DIR))).toEqual(['migration.sql']);
  });
  it('step-8 migrations are pinned byte-for-byte (20261016000000_ocean_dd unchanged since 10f8941; index migration at 47a80bb)', () => {
    expect(dd8Sha()).toEqual(STEP8_PINS);
  });
  it('the fix-round-4 migration is index-only: exactly one CREATE INDEX on audit_events (tenant_id, target_type, target_id), nothing else', () => {
    const stmts = statements(stripComments(readFileSync(join(MIG, INDEX_DIR, 'migration.sql'), 'utf8')));
    expect(stmts).toEqual(['CREATE INDEX "audit_events_tenant_id_target_type_target_id_idx" ON "audit_events"("tenant_id", "target_type", "target_id")']);
  });
  it('the migration enables and forces RLS with one tenant policy per table, revokes PUBLIC, never grants TRUNCATE or BYPASSRLS', () => {
    const sql = stripComments(readFileSync(join(MIG, ddDir(), 'migration.sql'), 'utf8'));
    for (const t of TABLES) {
      expect(sql, `${t} created`).toMatch(new RegExp(`CREATE\\s+TABLE\\s+"?${t}"?`, 'i'));
      expect(sql, `${t} RLS enabled`).toMatch(new RegExp(`ALTER\\s+TABLE\\s+"?${t}"?\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i'));
      expect(sql, `${t} RLS forced`).toMatch(new RegExp(`ALTER\\s+TABLE\\s+"?${t}"?\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i'));
      const pol = new RegExp(`CREATE\\s+POLICY\\s+"?${t}_tenant_isolation"?\\s+ON\\s+"?${t}"?\\s+FOR\\s+ALL\\s+USING\\s*\\(\\s*tenant_id\\s*=\\s*fr_current_tenant\\(\\)\\s*\\)\\s+WITH\\s+CHECK\\s*\\(\\s*tenant_id\\s*=\\s*fr_current_tenant\\(\\)\\s*\\)`, 'i');
      expect(sql, `${t} tenant policy`).toMatch(pol);
      expect((sql.match(new RegExp(`CREATE\\s+POLICY\\s+"?\\w+"?\\s+ON\\s+"?${t}"?\\s`, 'gi')) ?? []).length, `${t} has exactly one policy`).toBe(1);
      expect(revoked(sql), `${t} REVOKE ALL ... FROM PUBLIC`).toContain(t);
    }
    expect(grants(sql), 'exact grants to freight_app (C11)').toEqual(C11_GRANTS);
    expect(sql).not.toMatch(/BYPASSRLS/i);
    expect(sql).not.toMatch(/GRANT\s+[^;]*TRUNCATE/i);
    expect(sql).not.toMatch(/GRANT\s+ALL/i);
    expect(sql).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(sql).not.toMatch(/NO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
  });
  it('claim kind enum, immutability triggers, CHECKs and the flag row are in the migration', () => {
    const sql = stripComments(readFileSync(join(MIG, ddDir(), 'migration.sql'), 'utf8'));
    expect(sql).toMatch(/'FREIGHT'\s*,\s*'OCEAN_DD'/);
    for (const code of ['claim_kind_immutable', 'dd_invoice_immutable', 'dd_invoice_insert_invalid']) expect(sql, code).toContain(code);
    expect(sql).toContain('intelligence.ocean_dd');
    expect(sql).toMatch(/'DRAFT'\s*,\s*'AUDITED'/);
  });
});

describe('TENANT_MODELS and step-7 engine (CLAUDE.md rule 2, C20)', () => {
  it('the three new Prisma models are registered as tenant-scoped', () => {
    const schema = readFileSync(resolve(ROOT, 'api', 'prisma', 'schema.prisma'), 'utf8');
    const tenant = readFileSync(resolve(ROOT, 'api', 'src', 'db', 'tenant.ts'), 'utf8');
    const set = /TENANT_MODELS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(tenant)?.[1] ?? '';
    for (const t of TABLES) {
      const model = new RegExp(`^model (\\w+) \\{[^}]*@@map\\("${t}"\\)`, 'm').exec(schema)?.[1];
      expect(model, `schema maps ${t}`).toBeTruthy();
      expect(set, `TENANT_MODELS includes ${model ?? t}`).toContain(`'${model ?? ''}'`);
    }
  });
  it('packages/shared/src/fuel and outlook engine files are unchanged from ce107d0 (LF-normalized sha256)', () => {
    const SRC = resolve(ROOT, 'packages', 'shared', 'src');
    const present = ['fuel', 'outlook'].flatMap((d) => readdirSync(resolve(SRC, d)).filter((f) => !f.endsWith('.test.ts')).map((f) => `${d}/${f}`)).sort();
    expect(present, 'no step-7 engine file added or removed').toEqual(Object.keys(FROZEN_STEP7).sort());
    for (const [f, h] of Object.entries(FROZEN_STEP7)) expect(sha(Buffer.from(readFileSync(resolve(SRC, f), 'latin1').replace(/\r\n/g, '\n'), 'latin1')), f).toBe(h);
  });
});
