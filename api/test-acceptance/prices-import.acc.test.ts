// REQ-20261011-fuel-outlook Tier H (written now; run after the owner's go-ahead and `npm run build`): T12 importer
// CLI and price store (CI-I01..I05; Part C F9, F13, F14) and the built `npm run eval:outlook` gate (F8).
// Cleanup: the price tables are append-only for every role and `db:seed --reset` never touches them, and F9 refuses
// any later import that does not cover the extended range, so the imports this file creates cannot be undone through
// the product. They are removed by the owner connection with user triggers disabled (the same test-environment
// mechanism `I.resetFlags` uses); the bundled import becomes active again. CI-I05 is should-have S3: set
// ACC_SKIP_S3=1 when S3 was cut.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Session, buildTestApp, closeApps, sessionFor } from './helpers/client.js';
import { type PgClient, adminDb, appDb, inRollback, tryQuery, withAdmin, withTriggersOff } from './helpers/db.js';
import { TEST_ADMIN_DATABASE_URL, childEnv } from './helpers/env.js';
import * as I from './helpers/intel.js';
import { O_CFG, oOutlook } from './helpers/outlook-oracle.js';
import { reseed } from './helpers/seed.js';

const S3 = process.env.ACC_SKIP_S3 !== '1';
const ROOT = resolve(__dirname, '..', '..');
const DATA = resolve(ROOT, 'api', 'data', 'public-prices');
const URL_D = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASDESW';
const SHA_D = 'aca8fefdbb54bdf16a2ab2c225d8b1f59c033e04d6fb96d8c232c3cc45417bdf';
const SHA_P = '83894390a4fd80d6033f9d18299e97b27e670427bbb5e6aa090cdca0d4a44bea';
// fix round 1 (F13 amended): revisedValues added
const IMPORTED_KEYS = ['firstDate', 'importId', 'lastDate', 'retrievedAt', 'revisedValues', 'rowCount', 'seriesKey', 'sha256', 'sourceKind', 'sourceUrl'];
const TABLES = ['price_imports', 'price_observations'];
const CI_ARGS = ['--min-coverage', '0.70', '--max-coverage', '0.90', '--require-model', 'diesel_us:1,diesel_us:4,ppi_tl:1'];
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const quote = (a: string) => (process.platform === 'win32' ? `"${a.replace(/"/g, '\\"')}"` : `'${a.replace(/'/g, "'\\''")}'`);
function npm(script: string, args: string[], env: NodeJS.ProcessEnv = childEnv()) {
  const r = spawnSync('npm', ['run', '--silent', script, '--', ...args.map(quote)], { cwd: ROOT, env, shell: true, encoding: 'utf8', timeout: 300000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const counts = () => withAdmin((c) => I.rowCounts(c, TABLES));
const dieselBytes = () => readFileSync(join(DATA, 'GASDESW.csv'));
const extended = () => Buffer.concat([dieselBytes(), Buffer.from('2026-10-12,6.100\n', 'latin1')]);

let tmp = '';
let app: FastifyInstance;
let vw: Session;
const created: string[] = [];
async function dropImports(ids: string[]) {
  if (!ids.length) return;
  await withTriggersOff(TABLES, async (c) => {
    await c.query('delete from price_observations where import_id = any($1::uuid[])', [ids]);
    await c.query('delete from price_imports where id = any($1::uuid[])', [ids]);
  });
}
const newestImport = (series: string) => withAdmin(async (c) => (await c.query('select id, source_kind, retrieved_at::text r, sha256 from price_imports where series_key = $1 order by imported_at desc, id desc limit 1', [series])).rows[0] as { id: string; source_kind: string; r: string; sha256: string });
function noSecrets(r: { stdout: string; stderr: string }) {
  expect(r.stdout + r.stderr, 'the owner DB URL is never printed').not.toMatch(/postgres(ql)?:\/\/|local-dev-only/);
}

beforeAll(async () => {
  reseed();
  tmp = mkdtempSync(join(tmpdir(), 'fr-prices-'));
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50', PRICE_CACHE_TTL_MS: '0' });
  vw = await sessionFor(app, ACCOUNTS.VIEWER);
}, 300000);
afterAll(async () => {
  try { await dropImports(created); } finally { rmSync(tmp, { recursive: true, force: true }); await closeApps(); reseed(); }
});

describe('T12 importer CLI and store (F9)', () => {
  it('CI-I01 --list shows both series with the bundled sha256; a second db:seed leaves the bundled import unchanged', async () => {
    const l = npm('prices:import', ['--list']);
    expect(l.code, l.stderr).toBe(0);
    for (const s of ['diesel_us', SHA_D, 'ppi_tl', SHA_P]) expect(l.stdout).toContain(s);
    noSecrets(l);
    const before = await counts();
    const s = spawnSync('npm', ['run', 'db:seed'], { cwd: ROOT, env: childEnv({ NODE_ENV: 'development' }), shell: true, encoding: 'utf8', timeout: 300000 });
    expect(s.status, `${s.stdout}\n${s.stderr}`).toBe(0);
    expect(await counts()).toEqual(before);
  }, 600000);
  it('CI-I02 --file with one extra row: imported, platform audit event, outlook follows, equals the oracle', async () => {
    const p = join(tmp, 'GASDESW-extended.csv');
    writeFileSync(p, extended());
    const seq = await I.lastSeq(null);
    const r = npm('prices:import', ['--series', 'diesel_us', '--file', p, '--source-url', URL_D, '--retrieved-at', '2026-10-11']);
    const imp = await newestImport('diesel_us');
    if (imp.sha256 === sha(extended())) created.push(imp.id);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('imported');
    expect(r.stdout, 'pure extension: revised values 0 (T18 CI-R04)').toContain('revised values 0');
    noSecrets(r);
    const ev = await I.eventsSince(null, seq, 'price_data.imported');
    expect(ev).toHaveLength(1);
    expect([ev[0]?.actor_id, ev[0]?.target_type, ev[0]?.target_id]).toEqual([null, 'price_series', 'diesel_us']);
    expect(I.keysOf(ev[0]?.metadata)).toEqual(IMPORTED_KEYS);
    expect(ev[0]?.metadata).toEqual({ seriesKey: 'diesel_us', importId: imp.id, sha256: sha(extended()), rowCount: 1700, firstDate: '1994-03-21', lastDate: '2026-10-12', sourceKind: 'file', sourceUrl: URL_D, retrievedAt: '2026-10-11', revisedValues: 0 });
    const o = await vw.get('/outlook');
    expect(o.status, o.text).toBe(200);
    const d = o.body.series.find((s: { key: string }) => s.key === 'diesel_us');
    expect(d.latest).toEqual({ date: '2026-10-12', value: '6.100' });
    expect(d.provenance).toMatchObject({ importId: imp.id, sha256: sha(extended()), rowCount: 1700, lastDate: '2026-10-12' });
    const rows = extended().toString('latin1').trim().split('\n').slice(1).map((l) => l.split(','));
    const exp = oOutlook(rows.map((x) => Number(x[1])), rows.map((x) => x[0] ?? ''), O_CFG.diesel_us);
    expect(d.horizons.map((h: Record<string, unknown>) => [h.h, h.method, h.reason, h.targetDate, h.point, h.low, h.high])).toEqual(exp.horizons.map((h) => [h.h, h.method, h.reason, h.targetDate, h.point.toFixed(3), h.low.toFixed(3), h.high.toFixed(3)]));
    expect(d.horizons.map((h: { backtest: Record<string, unknown> }) => [h.backtest.origins, h.backtest.coverageHits, h.backtest.coverageCases])).toEqual(exp.horizons.map((h) => [h.origins, h.coverageHits, h.coverageCases]));
    // restore (see the header): the bundled import is active again
    await dropImports(created.splice(0));
    expect((await newestImport('diesel_us')).sha256).toBe(SHA_D);
    expect(npm('prices:import', ['--list']).stdout, 'restore: --list shows the bundled sha (T12 amended)').toContain(SHA_D);
    expect((await vw.get('/outlook')).body.series[0].latest).toEqual({ date: '2026-10-05', value: '6.199' });
  }, 600000);
  it('CI-I03 refusals: exit 2, nothing written', async () => {
    const before = await counts();
    const base = ['--series', 'diesel_us', '--source-url', URL_D, '--retrieved-at', '2026-10-11'];
    const lines = dieselBytes().toString('latin1').split('\n');
    const write = (name: string, b: Uint8Array | string) => { const p = join(tmp, name); writeFileSync(p, b); return p; };
    const dir = join(tmp, 'a-directory');
    mkdirSync(dir, { recursive: true });
    const cases: [string, string[], NodeJS.ProcessEnv?][] = [
      ['missing first row (would_remove_history)', ['--file', write('short.csv', [lines[0], ...lines.slice(2)].join('\n')), ...base]],
      ['non-pinned source URL', ['--file', write('ok.csv', dieselBytes()), '--series', 'diesel_us', '--source-url', 'https://example.com/x.csv', '--retrieved-at', '2026-10-11']],
      ['retrieved-at in the future', ['--file', write('ok2.csv', dieselBytes()), '--series', 'diesel_us', '--source-url', URL_D, '--retrieved-at', '2999-01-01']],
      ['CSV error', ['--file', write('bad.csv', 'date,GASDESW\n1994-03-21,1.106\n'), ...base]],
      ['a directory', ['--file', dir, ...base]],
      ['a file > 1 MiB', ['--file', write('big.csv', Buffer.alloc(1_048_577, 0x30)), ...base]],
    ];
    try {
      const link = join(tmp, 'link.csv');
      symlinkSync(join(tmp, 'ok.csv'), link);
      cases.push(['a symlink', ['--file', link, ...base]]);
    } catch { console.info('[CI-I03] symlink case not run: symlinks cannot be created here'); }
    const noOwner = childEnv();
    Reflect.deleteProperty(noOwner, 'MIGRATE_DATABASE_URL');
    cases.push(['MIGRATE_DATABASE_URL unset', ['--file', write('ok3.csv', extended()), ...base], noOwner]);
    for (const [label, args, env] of cases) {
      const r = npm('prices:import', args, env);
      expect(r.code, `${label}: ${r.stdout}${r.stderr}`).toBe(2);
      noSecrets(r);
    }
    expect(await counts()).toEqual(before);
  }, 600000);
  it('CI-I04 freight_app reads only (no tenant needed); the owner cannot UPDATE/DELETE/TRUNCATE (triggers)', async () => {
    const app_: PgClient = await appDb();
    const own: PgClient = await adminDb();
    try {
      const sel = await tryQuery(app_, 'select count(*)::int n from price_observations');
      expect(sel.ok, sel.error).toBe(true);
      expect(Number(sel.rows[0].n)).toBeGreaterThan(2000);
      for (const sql of [
        "insert into price_imports (id, series_key, source_kind, source_url, retrieved_at, sha256, row_count, first_date, last_date) values (gen_random_uuid(), 'diesel_us', 'file', 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASDESW', '2026-10-11', repeat('a', 64), 1, '2026-10-05', '2026-10-05')",
        'update price_imports set row_count = row_count', 'delete from price_imports', 'update price_observations set value = value', 'delete from price_observations',
      ]) {
        const r = await inRollback(app_, () => tryQuery(app_, sql));
        expect(r.ok, `freight_app: ${sql}`).toBe(false);
        expect(r.error, sql).toMatch(/permission denied/i);
      }
      for (const sql of ['update price_imports set row_count = row_count', 'delete from price_imports', 'truncate price_imports cascade', 'update price_observations set value = value', 'delete from price_observations', 'truncate price_observations']) {
        const r = await inRollback(own, () => tryQuery(own, sql));
        expect(r.ok, `owner: ${sql}`).toBe(false);
      }
    } finally {
      await app_.end();
      await own.end();
    }
  });
  it.skipIf(!S3)('CI-I05 (S3) --fetch with a stubbed fetch: redirect -> 3; > 1 MiB -> 3 (or 2), nothing written; valid body -> source kind fetch', async () => {
    const { main } = (await import('../src/platform/prices-cli.js')) as unknown as { main: (a: string[], o: (s: string) => void, e: (s: string) => void, d: Record<string, unknown>) => Promise<number> };
    const urls: string[] = [];
    const run = (body: () => Response) => main(['--series', 'diesel_us', '--fetch'], () => undefined, () => undefined, {
      env: { MIGRATE_DATABASE_URL: TEST_ADMIN_DATABASE_URL }, now: () => new Date('2026-10-12T12:00:00Z'),
      fetch: (async (u: string | URL) => { urls.push(String(u)); return body(); }) as typeof fetch,
    });
    const before = await counts();
    expect(await run(() => new Response(null, { status: 301, headers: { location: 'https://evil.example/x.csv' } }))).toBe(3);
    expect([2, 3]).toContain(await run(() => new Response(Buffer.alloc(1_048_577, 0x30))));
    expect(await counts()).toEqual(before);
    expect(await run(() => new Response(extended()))).toBe(0);
    const imp = await newestImport('diesel_us');
    created.push(imp.id);
    expect([imp.source_kind, imp.r, imp.sha256]).toEqual(['fetch', '2026-10-12', sha(extended())]);
    expect(new Set(urls)).toEqual(new Set([URL_D]));
    await dropImports(created.splice(0));
  }, 300000);
});

describe('T18 revisions (F9 amended, fix round 1)', () => {
  /** 2026-09-28 6.382 -> 6.383 and 2026-10-05 6.199 -> 6.200 (2 revised values); optionally one appended row. */
  const revised = (append: boolean) => {
    const t = dieselBytes().toString('latin1').replace('\n2026-09-28,6.382\n', '\n2026-09-28,6.383\n').replace('\n2026-10-05,6.199\n', '\n2026-10-05,6.200\n');
    expect(t).toContain('2026-09-28,6.383');
    expect(t).toContain('2026-10-05,6.200');
    return Buffer.from(append ? `${t}2026-10-12,6.100\n` : t, 'latin1');
  };
  const fileArgs = (p: string) => ['--series', 'diesel_us', '--file', p, '--source-url', URL_D, '--retrieved-at', '2026-10-11'];
  it('CI-R03 a file revising 2 covered values (+1 row) is refused without --accept-revisions: exit 2, count printed, nothing written, no audit', async () => {
    const p = join(tmp, 'revised.csv');
    writeFileSync(p, revised(true));
    const before = await counts();
    const seq = await I.lastSeq(null);
    const r = npm('prices:import', fileArgs(p));
    expect(r.code, `${r.stdout}${r.stderr}`).toBe(2);
    expect(r.stdout + r.stderr).toContain('refused: 2 revised value(s)');
    expect(r.stdout + r.stderr).toContain('--accept-revisions');
    noSecrets(r);
    expect(await counts()).toEqual(before);
    expect(await I.eventsSince(null, seq, 'price_data.imported')).toEqual([]);
    // the same refusal through --bundled, pointed at a temp copy whose manifest describes the revised file
    const d = join(tmp, 'bundled-revised');
    cpSync(DATA, d, { recursive: true });
    const rb = revised(false);
    writeFileSync(join(d, 'GASDESW.csv'), rb);
    const mp = join(d, 'manifest.json');
    const m = JSON.parse(readFileSync(mp, 'utf8')) as { files: { series: string; sha256: string }[] };
    for (const f of m.files) if (f.series === 'diesel_us') f.sha256 = sha(rb);
    writeFileSync(mp, JSON.stringify(m));
    const { main } = (await import('../src/platform/prices-cli.js')) as unknown as { main: (a: string[], o: (s: string) => void, e: (s: string) => void, d: Record<string, unknown>) => Promise<number> };
    let out = '';
    const code = await main(['--bundled'], (x) => { out += x; }, (x) => { out += x; }, { env: { MIGRATE_DATABASE_URL: TEST_ADMIN_DATABASE_URL }, dataDir: d });
    expect(code, out).toBe(2);
    expect(out).toContain('refused: 2 revised value(s)');
    expect(await counts()).toEqual(before);
  }, 600000);
  it('CI-R04 the same file with --accept-revisions: imported, revised values 2, revisedValues 2 audited, --list shows it active; then restore', async () => {
    const p = join(tmp, 'revised-accepted.csv');
    writeFileSync(p, revised(true));
    const seq = await I.lastSeq(null);
    const r = npm('prices:import', [...fileArgs(p), '--accept-revisions']);
    const imp = await newestImport('diesel_us');
    if (imp.sha256 === sha(revised(true))) created.push(imp.id);
    expect(r.code, `${r.stdout}${r.stderr}`).toBe(0);
    expect(r.stdout).toContain('imported');
    expect(r.stdout).toContain('revised values 2');
    const ev = await I.eventsSince(null, seq, 'price_data.imported');
    expect(ev).toHaveLength(1);
    expect(ev[0]?.metadata).toMatchObject({ revisedValues: 2, sha256: sha(revised(true)), rowCount: 1700, lastDate: '2026-10-12' });
    const l = npm('prices:import', ['--list']);
    expect(l.code, l.stderr).toBe(0);
    expect(l.stdout).toContain(sha(revised(true)));
    // Restore. Re-importing the bundled file (even with --accept-revisions) is refused as would_remove_history because
    // the active import now ends 2026-10-12; the accepted reading is the owner/triggers-off cleanup (see the header).
    await dropImports(created.splice(0));
    expect((await newestImport('diesel_us')).sha256).toBe(SHA_D);
    expect(npm('prices:import', ['--list']).stdout, 'restore: --list shows the bundled sha').toContain(SHA_D);
    const o = await vw.get('/outlook');
    expect(o.body.series[0].latest).toEqual({ date: '2026-10-05', value: '6.199' });
    expect(o.body.series[0].horizons.map((h: { point: string; low: string; high: string }) => [h.point, h.low, h.high])).toEqual([['6.124', '5.903', '6.392'], ['6.136', '5.301', '7.175'], ['6.199', '4.777', '8.189'], ['6.199', '4.384', '9.395']]);
  }, 600000);
  it('CI-R06 db:seed with a revised import active: exit 0, logs the refusal, writes no price rows', async () => {
    const p = join(tmp, 'revised-only.csv');
    writeFileSync(p, revised(false));
    const r = npm('prices:import', [...fileArgs(p), '--accept-revisions']);
    const imp = await newestImport('diesel_us');
    if (imp.sha256 === sha(revised(false))) created.push(imp.id);
    expect(r.code, `${r.stdout}${r.stderr}`).toBe(0);
    try {
      const before = await counts();
      const s = spawnSync('npm', ['run', 'db:seed'], { cwd: ROOT, env: childEnv({ NODE_ENV: 'development' }), shell: true, encoding: 'utf8', timeout: 300000 });
      expect(s.status, `${s.stdout}\n${s.stderr}`).toBe(0);
      expect(`${s.stdout}${s.stderr}`).toContain('refused: 2 revised value(s)');
      expect(await counts()).toEqual(before);
    } finally {
      await dropImports(created.splice(0));
    }
    expect((await newestImport('diesel_us')).sha256).toBe(SHA_D);
  }, 600000);
});

describe('F8 built CLI (after npm run build)', () => {
  it('npm run eval:outlook with the CI bounds exits 0; --json equals the source main() output', async () => {
    const r = npm('eval:outlook', CI_ARGS, { ...process.env });
    expect(r.code, r.stderr).toBe(0);
    const j = npm('eval:outlook', ['--json'], { ...process.env });
    expect(j.code, j.stderr).toBe(0);
    const { main } = (await import('../src/eval/outlook.js')) as unknown as { main: (a: string[], o: (s: string) => void, e: (s: string) => void) => number };
    let src = '';
    expect(main(['--json'], (s) => { src += s; }, () => undefined)).toBe(0);
    expect(JSON.parse(j.stdout.trim())).toEqual(JSON.parse(src.trim()));
  }, 300000);
});
