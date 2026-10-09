/**
 * Integration (real PostgreSQL + built parse worker): `npm run eval -- --record` path. Runs the committed
 * synthetic set through the real sandbox (k=2), records it in one system transaction with the platform
 * audit event, and checks the stored row against the report. Without --record nothing is written.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EvalReport } from '@fr/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { main } from '../../src/eval/cli.js';

import { adminUrl, appUrl, canRunDb } from './step4-helpers.js';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const setDir = path.join(apiRoot, 'eval', 'sets', 'extraction-v1');
const built = existsSync(path.join(apiRoot, 'dist', 'src', 'imports', 'sandbox', 'worker-main.js'));

let admin: pg.Client;

describe.skipIf(!canRunDb || !built)('evaluation tool --record (PostgreSQL + sandbox)', () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  it('without --record writes nothing; with --record stores the run, its cases and eval.run_recorded', async () => {
    const before = Number((await admin.query<{ n: string }>(`SELECT count(*) AS n FROM eval_runs`)).rows[0]?.n ?? 0);
    const out: string[] = [];
    const err: string[] = [];
    const env = { DATABASE_URL: appUrl ?? '' };
    expect(await main(['--set', setDir, '--k', '2', '--json', '--min-pass-hat-k', '1'], env, (s) => out.push(s), (s) => err.push(s))).toBe(0);
    expect(Number((await admin.query<{ n: string }>(`SELECT count(*) AS n FROM eval_runs`)).rows[0]?.n ?? 0)).toBe(before);
    const report = EvalReport.parse(JSON.parse(out.join('')));
    expect(report.passHatK).toBe(1);
    expect(report.deterministicCases).toBe(report.cases);

    out.length = 0;
    expect(await main(['--set', setDir, '--k', '2', '--record', '--json'], env, (s) => out.push(s), (s) => err.push(s))).toBe(0);
    expect(out.join('') + err.join('')).not.toContain('local-dev-only');
    const rec = EvalReport.parse(JSON.parse(out.join('')));
    const run = (
      await admin.query<{ id: string; case_count: number; pass_hat_k_count: number; eval_set_sha256: string; k: number }>(
        `SELECT id, case_count, pass_hat_k_count, eval_set_sha256, k FROM eval_runs ORDER BY created_at DESC LIMIT 1`,
      )
    ).rows[0];
    expect(run).toMatchObject({ case_count: rec.cases, pass_hat_k_count: rec.passHatKCount, eval_set_sha256: rec.evalSetSha256, k: 2 });
    const results = await admin.query(`SELECT count(*)::int AS n FROM eval_case_results WHERE run_id = $1`, [run?.id]);
    expect(results.rows[0]).toEqual({ n: rec.cases });
    const audit = await admin.query<{ metadata: Record<string, unknown>; actor_id: string | null }>(
      `SELECT metadata, actor_id FROM audit_events WHERE chain_key = 'platform' AND action = 'eval.run_recorded' AND target_id = $1`,
      [run?.id],
    );
    expect(audit.rows[0]).toEqual({ actor_id: null, metadata: { runId: run?.id, evalSetId: 'extraction-v1', k: 2, cases: rec.cases, passHatKCount: rec.passHatKCount } });
  }, 300_000);

  it('a failed recording commits nothing and exits 3', async () => {
    const before = Number((await admin.query<{ n: string }>(`SELECT count(*) AS n FROM eval_runs`)).rows[0]?.n ?? 0);
    const err: string[] = [];
    const code = await main(['--set', setDir, '--k', '1', '--record'], { DATABASE_URL: 'postgresql://freight_app:wrong-password@127.0.0.1:1/none' }, () => undefined, (s) => err.push(s));
    expect(code).toBe(3);
    expect(err.join('')).not.toContain('wrong-password');
    expect(Number((await admin.query<{ n: string }>(`SELECT count(*) AS n FROM eval_runs`)).rows[0]?.n ?? 0)).toBe(before);
  }, 300_000);
});
