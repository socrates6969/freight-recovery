/* eslint-disable */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const REPO = resolve(__dirname, '..', '..', '..');

export function sh(cmd: string, opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number; input?: string } = {}) {
  const r = spawnSync(cmd, {
    cwd: opts.cwd ?? REPO,
    env: opts.env ?? process.env,
    shell: true,
    encoding: 'utf8',
    timeout: opts.timeout ?? 120000,
    input: opts.input,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
export const have = (bin: string) => sh(process.platform === 'win32' ? `where ${bin}` : `command -v ${bin}`).status === 0;

export function walk(dir: string, filter: (p: string) => boolean = () => true, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (['node_modules', '.git', '.terraform', 'dist', '.venv'].includes(e)) continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, filter, out);
    else if (filter(p)) out.push(p);
  }
  return out;
}
export const rel = (p: string) => relative(REPO, p).replace(/\\/g, '/');
export const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');

/** Top-level HCL blocks: [{ kind, labels, body }] via brace matching (comments/strings handled coarsely). */
export function hclBlocks(src: string) {
  const out: Array<{ kind: string; labels: string[]; body: string }> = [];
  const re = /^(resource|data|provider|terraform|module|variable|output|locals)\s*((?:"[^"]*"\s*)*)\{/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < src.length && depth > 0) {
      const ch = src[i]!;
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    out.push({ kind: m[1]!, labels: [...m[2]!.matchAll(/"([^"]*)"/g)].map((x) => x[1]!), body: src.slice(re.lastIndex, i - 1) });
    re.lastIndex = i;
  }
  return out;
}