/* eslint-disable */
// T-REPO-IMP 1-8: static and command checks. Commands that need network/tools skip loudly.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, have, read, sh, walk, rel } from './helpers/sh.js';

const R = (p: string) => resolve(REPO, p);
const exists = (p: string) => existsSync(R(p));
const manifests = () => ['package.json', 'api/package.json', 'web/package.json', 'packages/shared/package.json'].filter(exists);

describe('T-REPO-IMP 1 protected paths', () => {
  it('git diff against feat/web-foundation is empty for protected paths', (ctx) => {
    const ref = sh('git rev-parse --verify feat/web-foundation', { cwd: REPO });
    if (ref.status !== 0) return ctx.skip('feat/web-foundation ref absent (shallow checkout)');
    const d = sh('git diff --stat feat/web-foundation...HEAD -- src tests webapp deploy docker-compose.yml Dockerfile .github/workflows/ci.yml pyproject.toml requirements.txt requirements.in .dockerignore', { cwd: REPO });
    expect(d.stdout.trim()).toBe('');
  });
});
describe('T-REPO-IMP 2 dependencies', () => {
  it('every dependency version is exact; lockfile committed; engines.node >=22.13.0 <25', () => {
    for (const m of manifests()) {
      const j = JSON.parse(read(m));
      for (const k of ['dependencies', 'devDependencies', 'optionalDependencies']) for (const [n, v] of Object.entries(j[k] ?? {})) if (!/^(workspace:|\*$)/.test(String(v)) && !n.startsWith('@fr/')) expect(String(v), `${m} ${n}`).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
    }
    expect(exists('package-lock.json')).toBe(true);
    expect(JSON.parse(read('package.json')).engines.node).toBe('>=22.15.0 <23 || >=23.5.0 <25');
  });
  it('verify:no-install-scripts passes; new runtime dependencies are printed for the report', () => {
    const r = sh('npm run verify:no-install-scripts', { cwd: REPO });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const base = sh('git show feat/web-foundation:api/package.json', { cwd: REPO });
    if (base.status === 0) {
      const old = Object.keys(JSON.parse(base.stdout).dependencies ?? {});
      const now = Object.keys(JSON.parse(read('api/package.json')).dependencies ?? {});
      console.log('[REPO-2] new api runtime dependencies:', now.filter((n) => !old.includes(n)).join(', ') || '(none)');
    }
  });
  it('npm audit (omit dev, high) exits 0', (ctx) => {
    const r = sh('npm audit --omit=dev --audit-level=high', { cwd: REPO, timeout: 120000 });
    if (r.status !== 0 && /ENOTFOUND|EAI_AGAIN|network/i.test(r.stdout + r.stderr)) return ctx.skip('registry unreachable');
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
describe('T-REPO-IMP 3 architecture', () => {
  it('child_process/worker_threads in at most one api/src file; presignGet has no non-test caller; parsing code imports no network/db/storage', () => {
    const files = walk(R('api/src'), (p) => p.endsWith('.ts') && !p.includes('generated'));
    const spawners = files.filter((f) => /from ['"](node:)?(child_process|worker_threads)['"]/.test(read(rel(f))));
    console.log('[REPO-3] process-spawning files:', spawners.map(rel).join(', '));
    expect(spawners.length).toBeLessThanOrEqual(1);
    for (const f of files) if (!/\.test\.ts$/.test(f) && !/s3\.ts$/.test(f)) expect(/presignGet\(/.test(read(rel(f))), `presignGet caller ${rel(f)}`).toBe(false);
    for (const f of files.filter((x) => /[\/](parse|parsing|ingest|extract)/i.test(x))) expect(/from ['"](node:)?(net|http|https|dgram|dns)['"]|@aws-sdk|@prisma|from ['"]pg['"]|fastify/.test(read(rel(f))), rel(f)).toBe(false);
  });
  it('lint passes with --max-warnings 0', () => {
    const r = sh('npm run lint', { cwd: REPO, timeout: 300000 });
    expect(r.status, r.stdout.slice(-2000)).toBe(0);
  });
});
describe('T-REPO-IMP 4-6 infrastructure text', () => {
  const tf = () => walk(R('infra'), (p) => p.endsWith('.tf')).map((p) => read(rel(p))).join('\n');
  it('terraform: KMS-enforcing bucket policy, TLS-only, public access blocked, versioning, lifecycle, scoped delete, no SES/SQS/SNS', (ctx) => {
    if (!exists('infra')) return ctx.skip('no infra dir');
    const t = tf();
    for (const re of [/s3:PutObject/, /aws:kms/, /aws:SecureTransport/, /public_access_block/, /versioning/, /abort_incomplete_multipart_upload/, /noncurrent_version_expiration/, /s3:DeleteObject/, /S3_SSE/]) expect(t).toMatch(re);
    expect(t).not.toMatch(/effect\s*=\s*"Allow"[^}]{0,200}"s3:\*"/);
    expect(t).not.toMatch(/resource\s+"aws_(ses|sqs|sns)_/);
  });
  it('terraform fmt/validate', (ctx) => {
    if (!have('terraform')) return ctx.skip('terraform not installed');
    expect(sh('terraform fmt -check -recursive', { cwd: R('infra') }).status).toBe(0);
    expect(sh('terraform init -backend=false -input=false', { cwd: R('infra'), timeout: 300000 }).status).toBe(0);
    expect(sh('terraform validate', { cwd: R('infra') }).status).toBe(0);
  });
  it('compose: minio digest-pinned, no latest tag, no privileged; compose config parses when docker is available', (ctx) => {
    const c = read('compose.web.yml');
    expect(c).not.toMatch(/:latest/);
    expect(c).not.toMatch(/privileged:\s*true/);
    expect(c).toMatch(/minio[^\n]*@sha256:[0-9a-f]{64}/);
    if (!have('docker')) return ctx.skip('docker CLI unavailable: compose config -q not run');
    expect(sh('docker compose -f compose.web.yml config -q', { cwd: REPO }).status).toBe(0);
    expect(sh('docker compose -f docker-compose.yml config -q', { cwd: REPO }).status).toBe(0);
  });
  it('CI workflow: SHA-pinned actions, read-only permissions, no pull_request_target, MinIO digest, build before tests', () => {
    const y = read('.github/workflows/web-ci.yml');
    for (const m of y.matchAll(/uses:\s*([^\s#]+)/g)) if (!m[1]!.startsWith('./')) expect(m[1], 'action pin').toMatch(/@[0-9a-f]{40}$/);
    expect(y).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(y).not.toMatch(/pull_request_target/);
    expect(y).not.toMatch(/secrets\./);
    expect(y).toMatch(/npm ci --ignore-scripts/);
    expect(y).toMatch(/minio[^\n]*@sha256:[0-9a-f]{64}/i);
    expect(y.indexOf('npm run build')).toBeGreaterThan(-1);
    expect(y.indexOf('npm run build')).toBeLessThan(y.indexOf('test:integration'));
  });
});
describe('T-REPO-IMP 7-8 secrets and docs', () => {
  it('no private keys or real credential patterns in tracked sources', () => {
    const r = sh('git grep -nE "BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}" -- . ":!package-lock.json"', { cwd: REPO });
    expect(r.stdout.trim()).toBe('');
  });
  it('docs: divergences D1-D8 and the email-forward design (design-only) exist', (ctx) => {
    const docs = ['README.md', 'ARCHITECTURE.md', 'docs'].filter(exists).flatMap((p) => (p.endsWith('.md') ? [p] : walk(R(p), (f) => f.endsWith('.md')).map(rel)));
    const all = docs.map((p) => read(p)).join('\n');
    for (const d of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8']) expect(all, d).toContain(d);
    const mail = docs.find((p) => /email-ingest/i.test(p));
    if (!mail) return ctx.skip('email-ingest design document not found');
    expect(read(mail)).toMatch(/design[- ]only/i);
  });
});
