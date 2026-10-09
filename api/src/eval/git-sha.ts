/** Current commit for the eval record: GITHUB_SHA, else read from .git (no subprocess); null if unknown. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SHA_RE = /^[0-9a-f]{7,40}$/u;

function gitDir(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 30; i += 1) {
    const g = path.join(dir, '.git');
    if (existsSync(g)) {
      try {
        const text = readFileSync(g, 'utf8');
        const m = /^gitdir:\s*(.+)$/mu.exec(text);
        return m?.[1] ? path.resolve(dir, m[1].trim()) : null;
      } catch {
        return g;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function currentGitSha(env: Record<string, string | undefined>, cwd: string): string | null {
  const fromEnv = env['GITHUB_SHA']?.trim().toLowerCase();
  if (fromEnv && SHA_RE.test(fromEnv)) return fromEnv;
  try {
    const dir = gitDir(cwd);
    if (!dir) return null;
    const head = readFileSync(path.join(dir, 'HEAD'), 'utf8').trim();
    if (SHA_RE.test(head)) return head;
    const ref = /^ref:\s*(\S+)$/u.exec(head)?.[1];
    if (!ref || ref.includes('..')) return null;
    const common = existsSync(path.join(dir, 'commondir')) ? path.resolve(dir, readFileSync(path.join(dir, 'commondir'), 'utf8').trim()) : dir;
    for (const d of [dir, common]) {
      const f = path.join(d, ref);
      if (existsSync(f)) {
        const v = readFileSync(f, 'utf8').trim();
        if (SHA_RE.test(v)) return v;
      }
      const packed = path.join(d, 'packed-refs');
      if (existsSync(packed)) {
        for (const line of readFileSync(packed, 'utf8').split('\n')) {
          const [sha, name] = line.trim().split(' ');
          if (name === ref && sha && SHA_RE.test(sha)) return sha;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}
