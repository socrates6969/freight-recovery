/**
 * Architectural guard rails enforced independently of ESLint (A12): import allow-lists for the Prisma
 * client and system-mode database access, raw SQL confinement, banned APIs, no egress from the send
 * path, web/api separation, and route registration only through defineRoute.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(apiRoot, '..');
const srcRoot = path.join(apiRoot, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === 'generated' || name === 'node_modules' || name === 'dist') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/u.test(name) && !/\.test\.tsx?$/u.test(name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => path.relative(apiRoot, p).split(path.sep).join('/');
const files = walk(srcRoot).map((p) => ({ path: rel(p), text: readFileSync(p, 'utf8') }));

function imports(text: string): string[] {
  const re = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gu;
  const out: string[] = [];
  for (const m of text.matchAll(re)) out.push(m[1] ?? m[2] ?? '');
  return out;
}

function resolves(fromFile: string, spec: string): string {
  if (!spec.startsWith('.')) return spec;
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
}

const inDir = (p: string, dirs: string[]) => dirs.some((d) => p.startsWith(d));

describe('architecture', () => {
  it('scans a non-trivial source tree', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('only api/src/db/** imports the Prisma client or the generated client', () => {
    for (const f of files) {
      for (const spec of imports(f.text)) {
        const target = resolves(f.path, spec);
        const isPrisma = spec === '@prisma/client' || spec.startsWith('@prisma/client/') || spec === '@prisma/adapter-pg' || target.includes('generated/prisma');
        if (isPrisma) expect([f.path, spec, inDir(f.path, ['src/db/'])]).toEqual([f.path, spec, true]);
      }
    }
  });

  it('system-mode database access is imported only from auth, platform, audit and db', () => {
    for (const f of files) {
      for (const spec of imports(f.text)) {
        const target = resolves(f.path, spec);
        if (/src\/db\/system(\.js)?$/u.test(target)) {
          expect([f.path, inDir(f.path, ['src/auth/', 'src/platform/', 'src/audit/', 'src/db/'])]).toEqual([f.path, true]);
        }
      }
    }
  });

  it('confines raw SQL to audit and db; unsafe raw APIs are banned everywhere', () => {
    for (const f of files) {
      // Usage = a call/tagged template on the member, e.g. `tx.$queryRawUnsafe(` or tx.$queryRaw`...`.
      expect([f.path, /\.\$(queryRawUnsafe|executeRawUnsafe)\s*[(<`]/u.test(f.text)]).toEqual([f.path, false]);
      if (/\.\$(queryRaw|executeRaw)\s*[(<`]/u.test(f.text)) {
        expect([f.path, inDir(f.path, ['src/audit/', 'src/db/'])]).toEqual([f.path, true]);
      }
    }
  });

  it('bans child_process and eval-like APIs in api/src', () => {
    for (const f of files) {
      expect([f.path, /node:child_process|['"]child_process['"]/u.test(f.text)]).toEqual([f.path, false]);
      expect([f.path, /\beval\s*\(|new\s+Function\s*\(/u.test(f.text)]).toEqual([f.path, false]);
    }
  });

  it('the send path imports no mailer, HTTP client, queue or AWS SDK', () => {
    for (const p of ['src/claims/routes.ts', 'src/claims/service.ts', 'src/claims/state-machine.ts', 'src/claims/content-hash.ts']) {
      const f = files.find((x) => x.path === p);
      expect(f, p).toBeDefined();
      const specs = imports(f?.text ?? '');
      for (const spec of specs) {
        expect([p, spec, /mailer|node:https?|^https?$|undici|axios|node-fetch|@aws-sdk|ioredis|storage/u.test(spec)]).toEqual([p, spec, false]);
      }
      expect([p, /\bfetch\s*\(/u.test(f?.text ?? '')]).toEqual([p, false]);
    }
  });

  it('routes are registered only through defineRoute', () => {
    for (const f of files) {
      if (f.path === 'src/http/route.ts') continue;
      expect([f.path, /\bapp\.(get|post|put|patch|delete|route|head|options|all)\s*\(/u.test(f.text)]).toEqual([f.path, false]);
    }
  });

  it('web and api never import each other', () => {
    const webSrc = path.join(repoRoot, 'web', 'src');
    let webFiles: string[] = [];
    try {
      webFiles = walk(webSrc);
    } catch {
      webFiles = [];
    }
    const apiDir = path.join(repoRoot, 'api') + path.sep;
    const webDir = path.join(repoRoot, 'web') + path.sep;
    for (const p of webFiles) {
      for (const spec of imports(readFileSync(p, 'utf8'))) {
        const target = spec.startsWith('.') ? path.resolve(path.dirname(p), spec) : '';
        const crosses = spec === '@fr/api' || spec.startsWith('@fr/api/') || target.startsWith(apiDir);
        expect([p, spec, crosses]).toEqual([p, spec, false]);
      }
    }
    for (const f of files) {
      for (const spec of imports(f.text)) {
        const target = spec.startsWith('.') ? path.resolve(apiRoot, path.dirname(f.path), spec) : '';
        const crosses = spec === '@fr/web' || spec.startsWith('@fr/web/') || target.startsWith(webDir);
        expect([f.path, spec, crosses]).toEqual([f.path, spec, false]);
      }
    }
    expect(webFiles.length).toBeGreaterThan(5);
  });
});
