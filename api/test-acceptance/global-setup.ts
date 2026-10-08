// Optional Vitest globalSetup for the acceptance project: fails (not skips) when Postgres is down and
// resets the seed to the known state. Wire as globalSetup: ['test-acceptance/global-setup.ts'].
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { adminDb } from './helpers/db.js';
import { childEnv } from './helpers/env.js';

export default async function setup() {
  const c = await adminDb(); // throws an actionable message when unreachable
  await c.end();
  if (process.env.ACC_SKIP_SEED_RESET === '1') return;
  const root = resolve(__dirname, '..', '..');
  const r = spawnSync('npm', ['run', 'db:seed', '--', '--reset'], {
    cwd: root,
    env: childEnv({ NODE_ENV: 'development' }),
    shell: true,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`db:seed --reset failed (${r.status})\n${r.stdout}\n${r.stderr}`);
}