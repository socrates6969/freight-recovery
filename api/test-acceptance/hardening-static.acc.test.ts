/* eslint-disable */
// REQ-20261012-hardening Tier L (file checks only, no database): T1 HD-S01..S04, HD-S09, HD-S10 and T10 HP-C07
// (Terraform text checks). Part C C0, C2, C11. Pins are computed from BASE bcc23bb (`git show bcc23bb:<path>`), never
// from the branch head. The shared copy/DTO/audit-list checks (HD-S05..S08, HP-A01) are in
// packages/shared/test-acceptance/hardening-copy.acc.test.ts.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const MIG = resolve(ROOT, 'api', 'prisma', 'migrations');
const NEW_DIR = '20261018000000_hardening';
/** Fix round 2 (C-FR2.2 "the database guard enforces the same rule"): 20261018000000_hardening is committed (cd596c3) and
 *  committed migrations are immutable (CLAUDE.md rule 8), so the guard change needs exactly one further folder. Interpretation
 *  reported to the planner (mailbox); its content is whitelisted in FR2-S01 below. */
const FR2_DIR = '20261019000000_hardening_fr2';
/** REQ-20261020-dd-deadline: one further folder, a flag row only (INSERT of intelligence.routing_shadow, OFF); no schema change. */
const DD_DIR = '20261020000000_routing_shadow_flag';
/** Raw sha256 of 20261018000000_hardening/migration.sql as committed in cd596c3 (stays byte-identical from now on). */
const HARDENING_COMMITTED = '41b7a7df0deb80b1bd9eb704420a4418499decce7a461408ac502b7498e6b4eb';
/** Review R-7: LF-normalised sha256 of 20261019000000_hardening_fr2/migration.sql as committed in c3f131b (immutable from
 *  now on, CLAUDE.md rule 8); pinned in addition to the FR2-S01 content whitelist. */
const FR2_COMMITTED_LF = '07df58c0906c4f3b8fdb458d14bfb01d548e2487da6abba657a016ae8e7537d9';
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
/** LF-normalised sha256 (Windows checkouts may convert to CRLF; CI checks out LF). */
const shaLf = (p: string) => sha(Buffer.from(readFileSync(p, 'latin1').replace(/\r\n/g, '\n'), 'latin1'));
const stripComments = (sql: string) => sql.replace(/--.*$/gm, '');
const statements = (sql: string) => sql.split(';').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);

/** Raw sha256 of the nine BASE migration files (`git show bcc23bb:api/prisma/migrations/<dir>/migration.sql`). */
const BASE_MIGRATIONS: Record<string, string> = {
  '20261008000000_init': 'bea2ee6796b489535845722913651534400ebac10e36aa6517b57306a378126c',
  '20261009000000_import_export': '8699637753c358bddef3863c9b281e4114c30dfa6bd77d9f7ef977b8c730b36c',
  '20261010000000_intelligence': '4f9717fc5428503c5e005c08cc7808b54514bdf5a077c9c8b98d2e301378d916',
  '20261011000000_four_eyes': '2ad97a26f2b93813773ee990bfb58748d4cd9e6ede1c4631eb0977feb5790d1d',
  '20261012000000_analysis': '29102ab01c76c1e5f1d215dae0d901b4cffb81ce86d596dfee6dd9b5b55ac934',
  '20261013000000_charge_intelligence': '01815dceef218c0c81cb6b34f359d927900f67abc193f4c189d7d9070c205b8b',
  '20261014000000_fuel_outlook': 'd6fddbb185e4b32959cfd5367045edc70c9906ecb2ff331170fae322550137c0',
  '20261016000000_ocean_dd': 'e872fed671c0e58c56aa808b26e29cb2833fdbf3af96622e3e4c382ca45016f1',
  '20261017000000_audit_target_index': 'd4782f35f97e137f2daa9a6a882f618b1d47e43a15c336ec80e4614487baefe8',
};
/** HD-S03: LF sha256 of api/prisma/schema.prisma at BASE (equals the test-spec value; BASE includes fix round 4). */
const SCHEMA_BASE = '565b7394ae85d41ffdece84c8194fd6518f6390ded5c96b2121134dfe720b62f';
/** HD-S04 new pin: LF sha256 of every file under packages/shared/src/ocean-dd/ at BASE (file list exact). */
const OCEAN_DD_BASE: Record<string, string> = {
  'audit.ts': '05dd241dec2e64ce15ef00c504a2885169ff573be2fe84dff33baddab0fdf5f1',
  'constants.ts': '5471fca0990f46eea8d3c2666fff4474117b01dfaca53bfd6bf06b9ea6ecb28d',
  'copy.ts': 'ecfb9153b36e4aeb52cf6755fcccc1d334d998ee7a49ffd86df93ec06ed5f22e',
  'csv.ts': '71b9afcb3bf0994359d37521c090e4d5f29c3b27fcc90fc4ffcf30a440b6ba9d',
  'dates.ts': '6a27e7f582ccc944765573628edfeae3bdcfdeb0887113783d69c3ab1983db35',
  'index.ts': '677103a0bcc605de99d1e5b8ca99561fe44f58256fc6b72c12569f3b8db40447',
  'letter.ts': '3249dcb6f5eeef3c757eeacf3f59e868e544ac79f931b046c4ad9efd5340af9b',
  'ocean-dd.test.ts': 'c92b267818eb285cd3956ff9e747274e98b0aff7d4d34b69d47cba06835205e8',
  'presets.ts': '1fb6796fb53c7a6561185f1d4d91727650d11fea48ad7fead742a706dfd59401',
  'regulation.ts': 'c59e290cb7857a4539ebc540a57478ba75d403d676d3eca7554cc3f6120f2164',
  'tariff.ts': '073bd0e7d4b85860ff505fc5535877dfdfd43274e31e4767b9b3388bd7f45d3e',
};
/** HD-S09: LF sha256 at BASE. */
/** Amended for REQ-20261018-exec-dashboard: rbac.ts gained insights:read (OWNER, ADMIN, MANAGER, VIEWER); the pin moves to
 *  that content (LF sha256 of packages/shared/src/rbac.ts after the dashboard change). feature-flags.ts is unchanged there.
 *  Amended for REQ-20261020-dd-deadline: feature-flags.ts gained the registry entry intelligence.routing_shadow (default OFF,
 *  tenant-visible); the pin moves to that content (LF sha256 after the change). rbac.ts is unchanged. */
const RBAC_BASE = 'e7d9108de9362007c33b007bb1293da0b91a5c8aea747223e7d73e1739ade970';
const FLAGS_BASE = 'ef854213500b14faebe7022d1b0ca785da0c8cfeacb05b0f0fbf4f2908acb4bc';
const ENV_EXAMPLE_BASE = '7ae40ea33086e10a58c74fb538e378b01ff9bedfde07ff4be3ca566d988c6c0b';
/** HD-S09 (review R-1): sha256 of each BASE .env.example line in order (LF text split on LF, 74 entries incl. the empty
 *  tail after the final newline), generated once from `git show bcc23bb:.env.example`. Embedded so the check runs in a
 *  shallow CI clone; the test re-joins the matched current lines and requires the full-file sha to equal ENV_EXAMPLE_BASE. */
const ENV_EXAMPLE_BASE_LINES: readonly string[] = [
  '370df1b44af7b083e88ff8ee79c1c0e2284df76889959b2327cb37cea4c7d301', '489d4a04f8edec786c55d46bf07519dfe674ae65d9a1e0412b539ecd062f65a2',
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'c039b8183026eef8c59e9ce8e8fd23cf8f46ce5979fa736ebe8479d892c4de3e',
  'aec53381f055ef249fd966124f3b98b067c498e27651ae721070977194b53097', '7016a33a5140a36c4baf5eca356cd40c63f6d98c2c304670505952b5a8fdefc6',
  '8601502ac60b24c4f802ee3c24a2c7c13280e72383842d15307adb287aa64c11', '335e89927b2b73656b13a765075920f4f3419bd182e0b05e5c0dbf0e1540fea2',
  '4bb3b1c68a15bf7035d3caa0dbed31c65a94ed8a1b04eba3e7adcb647b88c30b', '8c69b67070fcd4ce5420f752c61d5146401c3826b00df33c7bce71637269f7c2',
  '55a5ddcc7ae882423535280600654cf16d51ae6b572d5fd8de7013ebac6851ea', '079a0fb2cb16bd5f22ef371bcc5ce2c7cfbe542cb29614976fa7b24bdc683ebd',
  '1cbba277440a815eb895b5e3303ef62c7813f326a46225b9c743d1c4b5571871', 'f13c7ec1e99a0d5824d1ac3cbf3f57cac2a1247419d0ec632301d6841dfee269',
  '2a369e405c5169af620accf6585ce1e553a3f32ae98715cf5627d80d219c9ea7', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  '34455083460a2c64a4833f5c6c9916ac19909e5c836bd9ad898151f069fc1319', 'ad549f98b37b889172f770e3e415ee326b8f98668d4ce4c44f1759c1a608a438',
  '7fc5a57c50bacf82cd203d4087a15a5bef2bc9f75d59a80b43a773f20f351497', 'f598af1c64c4eac8bfa38d03a059ba33fea7d9eb879fa34711df90725235764f',
  'b7db881039e1826213e0a4e89829829024ae91920c34b0cc251363fdb43130c2', 'fa662637280576fe0d068edddbd1e5b3078c62d0ba363c57705ff65226ff6478',
  '917dd0134a2ffc199ed48f7e8ff8d99357010b92c57df36f25ad06941080443b', '246e5acb46a9e47393abdcb4db5414bdf760b6f4bdecddeaaff8fc1fe76c988e',
  'fd8d3d9d8c35d15837cdae24fb4e207be9e95bdb4e2c6de91333abf4bb52664b', '90ea03daa40c43dbb686517342a9e0e943c68fd81b41b832e0a3fc51ee2cc14f',
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '6b23c0921b92d447cc3c0e70fb14d92b8dbe6a68d61472a80797bc86f902007c',
  '971a523ee2b152419f0b374ad45261efcb616451bb23abf5158bbd3395a18aa4', 'e502b950e58d7aba952168fc699f162b49cdead21d2894333053e7d90746c6ad',
  '9283d575215cf43b00410b95690dabf035673b51a6264924c365dcf138a219d7', '42e031c530ae0835a89826af003875d99148bce137bdff4d074715e0b85eeb7e',
  '4a51ed0ec339536b236c4f5e4be6384cd5c9ba54675cf033a5f1541b29b69c35', '372daf562f24caabb652f3e4d4daaad37b234c04ce2eb44a6528a98b7683bdc0',
  '3c908cb48e570f29438341f699613e6385a988a24fd9cb8e89fd3d34d27ca6b8', '797ad37fcb38595f46d22f7abd1360eb50a70d24aa8ebe96f13e136915e9e4a9',
  'f12df4bbaea267083eb051d638fc7b8661e59c9fd62bfa8bacfb2dbcba1e8f53', 'e85d69b73233fd05a9a8c06b7a30b35566d66cb1bcbcd5d9d210c87bef302d76',
  'f0b9f3f59754c412631c819181b1888a15854d4d3c6fe108a835bf2aeba0a812', 'b33413287af7b055ee0385925deca918d3d5dd355db40f3adaab4c43e278fc4d',
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'f82cd109260e6065f03f8d8924bf8dee0c776ec20dba3614fcb66088f3540d7d',
  '4bfa268939273e5488694fdfed8ee96bb6d691120592b3ad3e483f821b073326', '8288be42d17496a842212141d979b9387252cd4968bb1c113247e9068d6d001b',
  'e7c593ce2b9276eab7d827ecf9ba156a68f6bb850f61b26a58603c8237070ce6', '25568f1905ce870343384ba10ab50fb70d8e96152e1aeeeef37ebaad85129cf6',
  '39c124b441c0d432620a3f7ecc49eb10e4147e9ac2a18438e17d4940697d9190', '611e98e4c17dba3b5430366ee9ebbc3bfb1892c16cee0c876d797c22f62abc2f',
  'e4a68028cb90c2f19251aca15193a91862fbe920cb7cae698c8d09405e8293da', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  'b311aa5a898241218ce0ce34e95291c82ace02bdfdbdde797aad26a016aba692', 'f96ec11ca4c388b57b1ee5d6ac3d1a325f4bfc2d7b73783de94323b6aaa4e7f8',
  '5dc357dc49066abd0af9c9af0cd0f17e14a47e510cd85ee8fd1139c478f12ea1', '7c6c18f33308eff818d47e17a9ac4b0aa1784bd5843a8dce8227787252f9369e',
  'ff747bc5ea4abf497df8e615003915e5b162c0380e6d7bee609b31435a5d2140', '759e69fd226f38869b83fd2260e9483f96fa215d58863538127195ffa32ca488',
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '18fe567fa57952a3c30deff1628e4e1a900e18e509db60a6a8f669eb96cef9f1',
  'bffb4c98f8db2a913a5454c69cb5d0161fd4d6e004c63cabc54c22c754612922', '86e7ac8d80e5c158c1d96fe2b96cfd9d2f08c0a472b1fea91bf52c27b56e9782',
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2aeffa7b9502b442f4dd9f9480080a4bd2ccb3811cdb307ae1f2f85bddeca213',
  'b3e394d027f0780cc830684cabd9c92075e0a3d9d3c29fe2762518d5884daf62', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  'ee55694c74ae961a3d91396bc4b9bb4bbc4f7b6852c86ce2734c76cf2c434be3', '55f9f39a196f8acc53ef8ec66b388ec9ef108fc70bb4a620ccd1ec01fbffa1f7',
  '5512a4046cc9fb9979f6e76e19ebb4fa211353c431cae4d9a8f826b9641502f6', '63d2f21751de9961fdbb15c93aaf76256ee112c55e3ffac0828bf711bfa3f01a',
  'c0fd308f6b179bb0439f569da4ad3828e939fe95d9da6d11d0fe5e1f00b06169', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  '1a176dfdc3909f679e1bba51d01ed110dc0c2b84818a1dbb9b49fd8a952fce77', '4c52f6101db6144363312acda1c8a324ba52cbd7c53eb3ee1066407d8102c44c',
  '67957f8909b0845845aea20b599a15d525264dc6dd9eaf39c1c214fafef30206', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe('HD-S01 migrations (C0.2)', () => {
  it('the nine BASE folders plus exactly 20261018000000_hardening, (fix round 2) 20261019000000_hardening_fr2 and (dd-deadline) 20261020000000_routing_shadow_flag, sorted last; each folder holds only migration.sql; BASE files and the committed hardening file byte-identical', () => {
    const dirs = readdirSync(MIG).filter((d) => statSync(join(MIG, d)).isDirectory()).sort();
    expect(dirs).toEqual([...Object.keys(BASE_MIGRATIONS).sort(), NEW_DIR, FR2_DIR, DD_DIR]);
    // The flag-row migration holds exactly one INSERT of the OFF routing-shadow flag and nothing else.
    expect(statements(stripComments(readFileSync(join(MIG, DD_DIR, 'migration.sql'), 'utf8')))).toEqual([
      `INSERT INTO "feature_flags" ("key", "enabled", "version") VALUES ('intelligence.routing_shadow', false, 1)`,
    ]);
    expect(sha(readFileSync(join(MIG, NEW_DIR, 'migration.sql'))), `${NEW_DIR} is committed: immutable`).toBe(HARDENING_COMMITTED);
    expect(shaLf(join(MIG, FR2_DIR, 'migration.sql')), `${FR2_DIR} is committed: immutable (review R-7)`).toBe(FR2_COMMITTED_LF);
    for (const d of dirs) expect(readdirSync(join(MIG, d)), d).toEqual(['migration.sql']);
    for (const [d, h] of Object.entries(BASE_MIGRATIONS)) expect(sha(readFileSync(join(MIG, d, 'migration.sql'))), d).toBe(h);
  });
});

describe('FR2-S01 statement whitelist of the fix-round-2 migration (C-FR2.2 DB guard; no new table)', () => {
  const sql = () => stripComments(readFileSync(join(MIG, FR2_DIR, 'migration.sql'), 'utf8'));
  it('only CREATE OR REPLACE of the hardening guard functions (SECURITY DEFINER, search_path) and their REVOKE ... FROM PUBLIC', () => {
    const s = sql();
    const fns = [...s.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+"?(\w+)"?\s*\(([\s\S]*?)\$(\w*)\$[\s\S]*?\$\3\$([\s\S]*?);/gi)];
    expect(fns.length, 'at least the approvals guard is replaced').toBeGreaterThanOrEqual(1);
    const names = fns.map((m) => m[1]!.toLowerCase());
    expect(names, 'the approvals four-eyes guard enforces the truncated-label rule').toContain('fr_approval_four_eyes_ext_guard');
    for (const n of names) expect(['fr_approval_four_eyes_ext_guard', 'fr_packet_decision_guard'], `${n}: only functions created in ${NEW_DIR}`).toContain(n);
    for (const m of fns) {
      const head = `${m[2]} ${m[4]}`.replace(/\s+/g, ' ');
      expect(head, `${m[1]} SECURITY DEFINER`).toMatch(/SECURITY DEFINER/i);
      expect(head, `${m[1]} search_path`).toMatch(/SET search_path\s*(=|TO)\s*public,\s*pg_temp/i);
    }
    // every statement outside the dollar-quoted bodies is one of the replaced functions or a REVOKE ALL ... FROM PUBLIC of one
    const outside = s.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '$$BODY$$');
    for (const st of statements(outside)) {
      const f = /^CREATE OR REPLACE FUNCTION "?(\w+)"?\s*\(/i.exec(st);
      const r = /^REVOKE ALL ON FUNCTION "?(\w+)"?\s*\(\s*\) FROM PUBLIC$/i.exec(st);
      expect(!!(f && names.includes(f[1]!.toLowerCase())) || !!(r && names.includes(r[1]!.toLowerCase())), `unexpected statement: ${st.slice(0, 120)}`).toBe(true);
    }
    expect(s).toContain('four_eyes_required');
  });
  it('contains no CREATE TABLE, ADD COLUMN, CREATE INDEX, GRANT, CREATE POLICY, ALTER TYPE, ALTER TABLE, CREATE TRIGGER or DROP', () => {
    const s = sql().replace(/\s+/g, ' ');
    for (const bad of [/CREATE TABLE/i, /ADD COLUMN/i, /CREATE (UNIQUE )?INDEX/i, /\bGRANT\b/i, /CREATE POLICY/i, /ALTER TYPE/i, /ALTER TABLE/i, /CREATE (CONSTRAINT )?TRIGGER/i, /\bDROP\b/i]) expect(s, String(bad)).not.toMatch(bad);
  });
});

describe('HD-S02 statement whitelist of the hardening migration (C2)', () => {
  const sql = () => stripComments(readFileSync(join(MIG, NEW_DIR, 'migration.sql'), 'utf8'));
  it('contains the two functions, the trigger, the deferred constraint trigger and the CHECK', () => {
    const s = sql().replace(/\s+/g, ' ');
    expect(s).toMatch(/CREATE (OR REPLACE )?FUNCTION "?fr_approval_four_eyes_ext_guard"?\s*\(/i);
    expect(s).toMatch(/CREATE TRIGGER "approvals_four_eyes_ext_guard" BEFORE INSERT ON "approvals"/i);
    expect(s).toMatch(/CREATE (OR REPLACE )?FUNCTION "?fr_packet_decision_guard"?\s*\(/i);
    expect(s).toMatch(/CREATE CONSTRAINT TRIGGER "evidence_packets_decision_guard" AFTER UPDATE OF "status" ON "evidence_packets" DEFERRABLE INITIALLY DEFERRED/i);
    expect(s.match(/ALTER TABLE "claims" ADD CONSTRAINT "claims_awaiting_amounts_zero" CHECK/gi) ?? [], 'exactly one CHECK').toHaveLength(1);
    expect(s, 'CHECK predicate (C2.3)').toMatch(/status"?\s*<>\s*'AWAITING_ANALYSIS'[^;]*amount_claimed_cents"?\s*=\s*0[^;]*recoverable_cents"?\s*=\s*0[^;]*pending_review_cents"?\s*=\s*0/i);
    for (const code of ['four_eyes_required', 'packet_decision_unrecorded']) expect(s, code).toContain(code);
  });
  it('both functions are SECURITY DEFINER with SET search_path = public, pg_temp; exactly two REVOKE ALL ON FUNCTION <created here>() FROM PUBLIC', () => {
    const s = sql();
    const fns = [...s.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"?(\w+)"?\s*\(([\s\S]*?)\$(\w*)\$[\s\S]*?\$\3\$([\s\S]*?);/gi)];
    const byName = new Map(fns.map((m) => [m[1]!.toLowerCase(), `${m[2]} ${m[4]}`.replace(/\s+/g, ' ')]));
    expect([...byName.keys()].sort()).toEqual(['fr_approval_four_eyes_ext_guard', 'fr_packet_decision_guard']);
    for (const [n, head] of byName) {
      expect(head, `${n} SECURITY DEFINER`).toMatch(/SECURITY DEFINER/i);
      expect(head, `${n} search_path`).toMatch(/SET search_path\s*(=|TO)\s*public,\s*pg_temp/i);
    }
    const revokes = statements(s).filter((x) => /^REVOKE\b/i.test(x));
    expect(revokes).toHaveLength(2);
    for (const r of revokes) {
      const m = /^REVOKE ALL ON FUNCTION "?(\w+)"?\s*\(\s*\) FROM PUBLIC$/i.exec(r);
      expect(!!m && byName.has(m[1]!.toLowerCase()), `unexpected REVOKE: ${r}`).toBe(true);
    }
  });
  it('contains no CREATE TABLE, ADD COLUMN, CREATE INDEX, GRANT, CREATE POLICY, ALTER TYPE or DROP; its only ALTER TABLE adds the CHECK', () => {
    const s = sql();
    // function bodies may legitimately contain none of these either; the whole file is scanned
    for (const re of [/CREATE\s+TABLE/i, /ADD\s+COLUMN/i, /CREATE\s+(UNIQUE\s+)?INDEX/i, /\bGRANT\b/i, /CREATE\s+POLICY/i, /ALTER\s+TYPE/i, /\bDROP\b/i, /BYPASSRLS/i, /DISABLE\s+ROW\s+LEVEL/i])
      expect(re.test(s), `must not contain ${re}`).toBe(false);
    const alters = statements(s).filter((x) => /^ALTER TABLE/i.test(x));
    expect(alters).toHaveLength(1);
    expect(alters[0]).toMatch(/^ALTER TABLE "claims" ADD CONSTRAINT "claims_awaiting_amounts_zero" CHECK/i);
  });
});

describe('HD-S03 / HD-S04 / HD-S09 byte pins against BASE (C0.3, C0.4, C11)', () => {
  it('HD-S03 api/prisma/schema.prisma is unchanged (LF sha256 = BASE)', () => {
    expect(shaLf(resolve(ROOT, 'api', 'prisma', 'schema.prisma'))).toBe(SCHEMA_BASE);
  });
  it('HD-S04 new pin: packages/shared/src/ocean-dd/ equals BASE (file list exact, LF sha256)', () => {
    const dir = resolve(ROOT, 'packages', 'shared', 'src', 'ocean-dd');
    const files = walk(dir).map((p) => p.slice(dir.length + 1).replace(/\\/g, '/')).sort();
    expect(files, 'no ocean-dd file added or removed').toEqual(Object.keys(OCEAN_DD_BASE).sort());
    for (const [f, h] of Object.entries(OCEAN_DD_BASE)) expect(shaLf(join(dir, f)), f).toBe(h);
  });
  it('HD-S09 rbac.ts and feature-flags.ts are byte-identical to BASE (amended: insights:read added by the exec dashboard; routing_shadow flag added by dd-deadline)', () => {
    expect(shaLf(resolve(ROOT, 'packages', 'shared', 'src', 'rbac.ts'))).toBe(RBAC_BASE);
    expect(shaLf(resolve(ROOT, 'packages', 'shared', 'src', 'feature-flags.ts'))).toBe(FLAGS_BASE);
  });
  it('HD-S09 (amended) .env.example differs from BASE only by added value-less lines mentioning CLIENT_IP_HEADER / ORIGIN_VERIFY_SECRET', () => {
    const now = readFileSync(resolve(ROOT, '.env.example'), 'utf8').replace(/\r\n/g, '\n');
    const b = ENV_EXAMPLE_BASE_LINES;
    const n = now.split('\n');
    // every BASE line is still present, in order (only additions); no git history needed
    let j = 0;
    const added: string[] = [];
    const kept: string[] = [];
    for (const line of n) {
      if (j < b.length && sha(line) === b[j]) {
        j++;
        kept.push(line);
      } else added.push(line);
    }
    expect(j, 'every BASE line kept in order').toBe(b.length);
    expect(sha(kept.join('\n')), 'the kept lines re-join to the exact BASE file (recorded BASE sha)').toBe(ENV_EXAMPLE_BASE);
    // Interpretation (recorded in test-plan.md): added comment lines may describe the two variables; every added
    // non-comment line must be one of the two variables, and no added line may assign any value or name another variable.
    for (const line of added.filter((l) => l.trim() !== '')) {
      if (/^\s*#/.test(line)) {
        const assigned = /^\s*#\s*([A-Z][A-Z0-9_]{2,})\s*=/.exec(line)?.[1];
        if (assigned) expect(['CLIENT_IP_HEADER', 'ORIGIN_VERIFY_SECRET'], `commented assignment in ${JSON.stringify(line)}`).toContain(assigned);
      } else expect(line, `added line ${JSON.stringify(line)}`).toMatch(/^\s*(CLIENT_IP_HEADER|ORIGIN_VERIFY_SECRET)\s*=/);
      const kv = /^\s*#?\s*(CLIENT_IP_HEADER|ORIGIN_VERIFY_SECRET)\s*=(.*)$/.exec(line);
      if (kv) expect(kv[2]!.trim(), `${kv[1]} carries no value`).toBe('');
    }
    expect(now).toMatch(/CLIENT_IP_HEADER/);
    expect(now).toMatch(/ORIGIN_VERIFY_SECRET/);
  });
});

describe('HD-S10 web/src rendering guards (C7.9, C7.10)', () => {
  const files = () => walk(resolve(ROOT, 'web', 'src')).filter((p) => /\.(tsx?|jsx?)$/.test(p));
  it('no dangerouslySetInnerHTML anywhere in web/src', () => {
    const f = files();
    expect(f.length).toBeGreaterThan(20);
    for (const p of f) expect(readFileSync(p, 'utf8').includes('dangerouslySetInnerHTML'), p).toBe(false);
  });
  it('every <table element in a .tsx file has aria-label or aria-labelledby', () => {
    let tables = 0;
    for (const p of files().filter((x) => x.endsWith('.tsx'))) {
      const t = readFileSync(p, 'utf8');
      for (const m of t.matchAll(/<table\b([^>]*)>/g)) {
        tables++;
        expect(/\baria-label(ledby)?\s*=/.test(m[1] ?? ''), `${p}: ${m[0].slice(0, 120)}`).toBe(true);
      }
    }
    expect(tables, 'tables found').toBeGreaterThanOrEqual(5);
  });
});

describe('HP-C07 Terraform static checks (C11 infrastructure)', () => {
  const INFRA = resolve(ROOT, 'infra');
  const tf = () => readdirSync(INFRA).filter((f) => f.endsWith('.tf')).map((f) => ({ f, t: readFileSync(join(INFRA, f), 'utf8') }));
  const all = () => tf().map((x) => x.t).join('\n');
  /** Top-level resource blocks: `resource "<type>" "<name>" { ... }` (brace matched). */
  function blocks(type: string): { name: string; body: string }[] {
    const out: { name: string; body: string }[] = [];
    const t = all();
    const re = new RegExp(`resource\\s+"${type}"\\s+"([\\w-]+)"\\s*\\{`, 'g');
    for (const m of t.matchAll(re)) {
      let depth = 1;
      let i = (m.index ?? 0) + m[0].length;
      for (; i < t.length && depth > 0; i++) depth += t[i] === '{' ? 1 : t[i] === '}' ? -1 : 0;
      out.push({ name: m[1]!, body: t.slice(m.index, i) });
    }
    return out;
  }
  it('a CLOUDFRONT-scoped web ACL holds ip-rate-limit (aggregate_key_type IP) and AWSManagedRulesAmazonIpReputationList; the REGIONAL ACL holds neither', () => {
    const acls = blocks('aws_wafv2_web_acl');
    const cf = acls.filter((a) => /scope\s*=\s*"CLOUDFRONT"/.test(a.body));
    const reg = acls.filter((a) => /scope\s*=\s*"REGIONAL"/.test(a.body));
    expect(cf, 'one CLOUDFRONT web ACL').toHaveLength(1);
    expect(reg.length, 'the REGIONAL ACL stays').toBeGreaterThanOrEqual(1);
    expect(cf[0]!.body).toContain('ip-rate-limit');
    expect(cf[0]!.body).toMatch(/aggregate_key_type\s*=\s*"IP"/);
    expect(cf[0]!.body).toContain('AWSManagedRulesAmazonIpReputationList');
    expect(cf[0]!.body, 'created through a us-east-1 provider alias').toMatch(/provider\s*=\s*aws\.\w+/);
    for (const r of reg) {
      expect(r.body).not.toMatch(/aggregate_key_type\s*=\s*"IP"/);
      expect(r.body).not.toContain('AWSManagedRulesAmazonIpReputationList');
    }
    expect(all(), 'a us-east-1 aws provider alias exists').toMatch(/provider\s+"aws"\s*\{[^}]*alias\s*=\s*"\w+"[^}]*region\s*=\s*"us-east-1"|provider\s+"aws"\s*\{[^}]*region\s*=\s*"us-east-1"[^}]*alias\s*=\s*"\w+"/);
  });
  it('the distribution sets web_acl_id; the api origin sends x-origin-verify', () => {
    const dist = blocks('aws_cloudfront_distribution');
    expect(dist.length).toBeGreaterThanOrEqual(1);
    expect(dist.some((d) => /web_acl_id\s*=/.test(d.body))).toBe(true);
    expect(dist.some((d) => /custom_header\s*\{[^}]*name\s*=\s*"x-origin-verify"/.test(d.body)), 'custom_header x-origin-verify').toBe(true);
    // Fix round 2 contract change (C-FR2.3 b/c): the origin request policy may be the AWS managed AllViewerExceptHostHeader
    // policy (no custom resource) and the whole-origin ignore_changes may be removed. Both are asserted with their amended
    // contract in hardening-infra-fr2.acc.test.ts (FR2-I05, FR2-I06).
  });
  it('HTTPS listener default action is a fixed 403; a listener rule forwards on http_header x-origin-verify', () => {
    // HTTPS listeners carry a certificate (the HTTP listener's redirect block also names protocol HTTPS)
    const listeners = blocks('aws_lb_listener').filter((l) => /certificate_arn\s*=/.test(l.body) || /ssl_policy\s*=/.test(l.body));
    expect(listeners.length).toBeGreaterThanOrEqual(1);
    for (const l of listeners) {
      const da = /default_action\s*\{([\s\S]*?)\n\s{2}\}/.exec(l.body)?.[1] ?? l.body;
      expect(da, l.name).toMatch(/type\s*=\s*"fixed-response"/);
      expect(da, l.name).toMatch(/status_code\s*=\s*"?403"?/);
    }
    const rules = blocks('aws_lb_listener_rule');
    // Fix round 2 contract change (C-FR2.3 a): the x-origin-verify rule forwards on a generated value OR answers 403 until
    // rotation; which one, and that no committed value is accepted, is asserted in FR2-I02 (hardening-infra-fr2).
    expect(rules.some((r) => /http_header\s*\{[\s\S]*?http_header_name\s*=\s*"x-origin-verify"/.test(r.body)), 'a rule matches on x-origin-verify').toBe(true);
  });
  it('ECS task: CLIENT_IP_HEADER = cloudfront-viewer-address (plain), ORIGIN_VERIFY_SECRET via valueFrom', () => {
    const t = all().replace(/\s+/g, ' ');
    expect(t).toMatch(/name\s*=\s*"CLIENT_IP_HEADER"\s*,?\s*value\s*=\s*"cloudfront-viewer-address"/);
    expect(t).toMatch(/name\s*=\s*"ORIGIN_VERIFY_SECRET"\s*,?\s*valueFrom\s*=/);
  });
  it('no 40+ character literal that could be a secret in any .tf file', () => {
    for (const { f, t } of tf()) {
      for (const m of t.matchAll(/"([^"\n]{40,})"/g)) {
        const v = m[1]!;
        // hex or base64(url)-like tokens; hyphen-separated lowercase words (non-secret placeholders, names) are not secrets
        const words = /^[a-z0-9]+(-[a-z0-9]+)+$/.test(v);
        const looksSecret = /^[A-Za-z0-9+/=_-]{40,}$/.test(v) && !words && !/^(arn|aws|AWSManaged)/.test(v);
        expect(looksSecret, `${f}: ${v.slice(0, 12)}...`).toBe(false);
      }
    }
  });
  it('infra/README.md documents the deploy gate and the rotation steps', () => {
    const r = readFileSync(join(INFRA, 'README.md'), 'utf8');
    expect(r).toMatch(/x-origin-verify|origin[- ]verify/i);
    expect(r).toMatch(/rotat/i);
    expect(r).toMatch(/login_attempts/);
    expect(r).toMatch(/403/);
  });
  it('terraform fmt -check -recursive and validate (declared skip when the binary is absent)', (ctx) => {
    const v = spawnSync('terraform', ['version'], { encoding: 'utf8' });
    if (v.status !== 0) return ctx.skip('terraform binary not available on this machine (HP-C07 binary part: declared skip)');
    const fmt = spawnSync('terraform', ['fmt', '-check', '-recursive'], { cwd: INFRA, encoding: 'utf8' });
    expect(fmt.status, fmt.stdout + fmt.stderr).toBe(0);
    if (!existsSync(join(INFRA, '.terraform'))) return ctx.skip('terraform not initialised (validate needs init -backend=false); fmt checked');
    const val = spawnSync('terraform', ['validate'], { cwd: INFRA, encoding: 'utf8' });
    expect(val.status, val.stdout + val.stderr).toBe(0);
  });
});
