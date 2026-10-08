// Deterministic state: `npm run db:seed -- --reset` plus invalidation of the cross-file session/TOTP caches.
import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { childEnv } from './env.js';

export function reseed(): void {
  if (process.env.ACC_NO_RESEED === '1') return;
  const root = resolve(__dirname, '..', '..', '..');
  const r = spawnSync('npm', ['run', 'db:seed', '--', '--reset'], {
    cwd: root,
    env: childEnv({ NODE_ENV: 'development' }),
    shell: true,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`db:seed --reset failed (${r.status})\n${r.stdout}\n${r.stderr}`);
  for (const f of ['fr-acc-sessions.json', 'fr-acc-totp-used.json']) {
    const p = join(tmpdir(), f);
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* best effort */
    }
  }
}