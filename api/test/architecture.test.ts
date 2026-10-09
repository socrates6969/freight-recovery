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
/** The single file allowed to import node:child_process (A1.4). */
const SPAWN_FILE = 'src/imports/sandbox/spawn.ts';
const GUARD_FILE = 'src/imports/sandbox/guard.ts';

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
          // Step 4 carve-outs: the evaluation recorder (the only eval writer) and observability (none expected).
          const allowed = inDir(f.path, ['src/auth/', 'src/platform/', 'src/audit/', 'src/db/', 'src/observability/']) || f.path === 'src/eval/record.ts';
          expect([f.path, allowed]).toEqual([f.path, true]);
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

  it('bans child_process (except the one sandbox launcher) and eval-like APIs in api/src', () => {
    for (const f of files) {
      // The guard names child_process only in its block list; it must not import it (checked below).
      if (f.path !== SPAWN_FILE && f.path !== GUARD_FILE) expect([f.path, /node:child_process|['"]child_process['"]/u.test(f.text)]).toEqual([f.path, false]);
      if (f.path === GUARD_FILE) expect(imports(f.text).filter((s) => /child_process|^(node:)?(net|http|https|vm)$/u.test(s))).toEqual([]);
      expect([f.path, /\beval\s*\(|new\s+Function\s*\(/u.test(f.text)]).toEqual([f.path, false]);
    }
  });

  it('the sandbox launcher spawns exactly one process: process.execPath, no shell, allow-listed env', () => {
    const f = files.find((x) => x.path === SPAWN_FILE);
    expect(f, SPAWN_FILE).toBeDefined();
    const text = f?.text ?? '';
    const calls = [...text.matchAll(/\bspawn\(/gu)];
    expect(calls).toHaveLength(1);
    expect(/\bspawn\(process\.execPath,/u.test(text)).toBe(true);
    expect(/shell:\s*false/u.test(text)).toBe(true);
    expect(/shell:\s*true/u.test(text)).toBe(false);
    expect(/env:\s*workerEnv\(\)/u.test(text)).toBe(true);
    expect(/process\.env\b(?!\))/u.test(text.replace(/source: NodeJS\.ProcessEnv = process\.env/u, ''))).toBe(false);
    for (const banned of ['--allow-fs-write', '--allow-child-process', '--allow-worker', '--allow-addons', '--allow-wasi']) {
      expect([banned, text.includes(banned)]).toEqual([banned, false]);
    }
  });

  it('the parse sandbox code reaches no network, file system, process, vm or service module', () => {
    const banned = /^(node:)?(net|http|https|http2|dns|dns\/promises|tls|dgram|child_process|cluster|worker_threads|fs|fs\/promises|vm)$|^@aws-sdk\/|^fastify$|^@prisma\//u;
    const sandboxed = files.filter((f) => f.path.startsWith('src/imports/parse/') || f.path === 'src/imports/sandbox/worker-main.ts');
    expect(sandboxed.length).toBeGreaterThan(8);
    for (const f of sandboxed) {
      for (const spec of imports(f.text)) {
        const target = resolves(f.path, spec);
        expect([f.path, spec, banned.test(spec)]).toEqual([f.path, spec, false]);
        expect([f.path, spec, /^src\/(db|storage|http|audit|auth|claims|platform|exports)\//u.test(`${target}/`)]).toEqual([f.path, spec, false]);
        // Zod-free shared subpaths only (keeps the sandbox's loaded code minimal).
        expect([f.path, spec, spec === '@fr/shared']).toEqual([f.path, spec, false]);
        if (spec.startsWith('pdfjs-dist')) expect([f.path, spec]).toEqual(['src/imports/parse/pdf.ts', spec]);
        if (spec.startsWith('node:') && f.path === 'src/imports/sandbox/worker-main.ts') {
          expect([spec, ['node:process', 'node:stream', 'node:buffer', 'node:zlib'].includes(spec)]).toEqual([spec, true]);
        }
      }
    }
  });

  it('signed URLs are not used in step 3 (presignGet has no caller outside tests)', () => {
    for (const f of files) {
      if (f.path === 'src/storage/s3.ts') continue;
      expect([f.path, /presignGet\s*\(/u.test(f.text)]).toEqual([f.path, false]);
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

  // -------------------------------------------------------------------------------------------
  // Step 4 guard rails (A1.2, A12.5)
  // -------------------------------------------------------------------------------------------

  it('platform dashboard modules never touch tenant models or tables (only fr_platform_pipeline_stats)', () => {
    const platformFiles = files.filter((f) => ['src/platform/pipeline.ts', 'src/platform/flags.ts', 'src/platform/eval-read.ts', 'src/platform/dashboard-routes.ts'].includes(f.path));
    expect(platformFiles).toHaveLength(4);
    const tenantModels = /\.(claim|evidencePacket|packetFinding|packetSource|packetTimelineEvent|approval|importDocument|importBatch|extractedField|importReviewDecision|claimDocument|membership|invite|apiKey|tenant)\s*\.(find|count|aggregate|group|create|update|delete|upsert)/u;
    const tenantTables = /\b(FROM|JOIN|INTO|UPDATE)\s+"?(claims|evidence_packets|packet_findings|packet_sources|approvals|import_documents|import_batches|extracted_fields|claim_documents|memberships|invites|api_keys)\b/iu;
    for (const f of platformFiles) {
      expect([f.path, tenantModels.test(f.text)]).toEqual([f.path, false]);
      expect([f.path, tenantTables.test(f.text)]).toEqual([f.path, false]);
      expect([f.path, /\bemail\b/u.test(f.text)]).toEqual([f.path, false]);
    }
  });

  it('intelligence code reads only through the tenant transaction (no base client, no system mode)', () => {
    const intel = files.filter((f) => f.path.startsWith('src/intelligence/'));
    expect(intel.length).toBeGreaterThanOrEqual(4);
    for (const f of intel) {
      for (const spec of imports(f.text)) {
        const target = resolves(f.path, spec);
        expect([f.path, spec, /db\/(system|client)(\.js)?$/u.test(target) || /generated\/prisma|@prisma\//u.test(spec)]).toEqual([f.path, spec, false]);
      }
      expect([f.path, /\b(PrismaClient|BaseClient|withSystemTx|withTenantTx\s*\()\b/u.test(f.text)]).toEqual([f.path, false]);
    }
  });

  it('no learning, speed-up or accuracy claims appear in source (honest labeling, Q8)', () => {
    const FORBIDDEN = [
      /neural mesh/iu,
      /hebbian/iu,
      /solved-problems cache/iu,
      /ai-powered/iu,
      /faster than/iu,
      /\b\d+(\.\d+)?\s*[x\u00d7]\s*faster/iu,
      /\d+(\.\d+)?\s*%\s*accura/iu,
      /accura\w*\s*(of|:|=|is)?\s*\d+(\.\d+)?\s*%/iu,
    ];
    const roots = [srcRoot, path.join(repoRoot, 'packages', 'shared', 'src'), path.join(repoRoot, 'web', 'src')];
    let scanned = 0;
    for (const root of roots) {
      for (const p of walk(root)) {
        const text = readFileSync(p, 'utf8');
        scanned += 1;
        for (const re of FORBIDDEN) expect([p, re.source, re.test(text)]).toEqual([p, re.source, false]);
      }
    }
    expect(scanned).toBeGreaterThan(50);
  });

  it('exactly nine routes accept API keys, with the contract scopes (Q13)', () => {
    const found: string[] = [];
    const blockRe = /defineRoute\(\w+, \{\s*method: '([A-Z]+)',\s*url: `\$\{P\}([^`]+)`,\s*access: \{([^}]*)\}/gu;
    for (const f of files) {
      for (const m of f.text.matchAll(blockRe)) {
        const scope = /apiKeyScope: '([a-z.]+)'/u.exec(m[3] ?? '');
        if (scope) found.push(`${m[1]} ${m[2]} ${scope[1]}`);
      }
      // Any apiKeyScope must be inside such a recognized block.
      const total = (f.text.match(/apiKeyScope: '/gu) ?? []).length;
      const inBlocks = [...f.text.matchAll(blockRe)].filter((m) => /apiKeyScope/u.test(m[3] ?? '')).length;
      expect([f.path, total]).toEqual([f.path, inBlocks]);
    }
    expect(found.sort()).toEqual(
      [
        'GET /claims claims.read',
        'GET /claims/:id claims.read',
        'GET /claims/:id/documents claims.read',
        'GET /exports/claims exports.claims',
        'POST /imports imports.write',
        'GET /imports imports.write',
        'GET /imports/:batchId imports.write',
        'POST /imports/:batchId/documents imports.write',
        'GET /imports/:batchId/documents/:docId imports.write',
      ].sort(),
    );
    for (const r of found) expect([r, /\/(platform|auth|users|api-keys|audit|flags)\b|approve|send|reject/u.test(r)]).toEqual([r, false]);
  });
});
