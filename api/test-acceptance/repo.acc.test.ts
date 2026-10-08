/* eslint-disable */
// T-REPO-01..06, T-COMPOSE-01/02, T-CI-01 (static and command checks)
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, have, read, rel, sh, walk } from './helpers/sh.js';

const PROTECTED = 'src tests webapp deploy docker-compose.yml Dockerfile pyproject.toml requirements.in requirements.txt requirements-dev.in requirements-dev.txt .github/workflows/ci.yml';
const pkgs = () => ['package.json', 'api/package.json', 'web/package.json', ...walk(resolve(REPO, 'packages'), (p) => p.endsWith('package.json')).map(rel)].filter((p) => existsSync(resolve(REPO, p)));

describe('T-REPO-01 additions only', () => {
  it('no change to existing Python/infra paths (committed range and working tree)', (ctx) => {
    if (sh('git rev-parse --verify --quiet master').status !== 0) return ctx.skip('master ref not available (shallow CI checkout)');
    const committed = sh(`git diff --stat master...HEAD -- ${PROTECTED}`);
    expect(committed.out.trim(), 'git diff master...HEAD').toBe('');
    const wt = sh(`git diff --name-only master -- ${PROTECTED}`);
    expect(wt.out.trim(), 'working tree vs master').toBe('');
    const untracked = sh(`git ls-files --others --exclude-standard -- src tests webapp deploy`);
    expect(untracked.out.trim(), 'new files inside existing dirs').toBe('');
    const gi = sh('git diff master -- .gitignore');
    const removed = gi.out.split('\n').filter((l) => /^-[^-]/.test(l));
    expect(removed, '.gitignore may only be appended to').toEqual([]);
  });
  it('existing Python tests still pass (regression guard)', (ctx) => {
    const py = [resolve(REPO, '.venv/Scripts/python.exe'), resolve(REPO, '.venv/bin/python')].find(existsSync);
    if (!py) return ctx.skip('.venv not usable');
    const r = sh(`"${py}" -m pytest -q`, { timeout: 600000 });
    expect(r.status, r.out.slice(-2000)).toBe(0);
  }, 650000);
});

describe('T-REPO-02 supply-chain posture', () => {
  it('.npmrc, private root, workspaces, engines, exact versions, lockfile in sync', () => {
    expect(read('.npmrc')).toMatch(/^ignore-scripts\s*=\s*true\s*$/m);
    const root = JSON.parse(read('package.json'));
    expect(root.private).toBe(true);
    expect(Array.isArray(root.workspaces) || typeof root.workspaces === 'object').toBe(true);
    expect(String(root.engines?.node)).toMatch(/>=\s*22/);
    const exact = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
    for (const f of pkgs()) {
      const j = JSON.parse(read(f));
      for (const sect of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        for (const [name, ver] of Object.entries<string>(j[sect] ?? {})) {
          const local = name.startsWith('@fr/') && (/^(workspace:|file:)/.test(ver) || ver === '*');
          expect(local || exact.test(ver), `${f}: ${sect}.${name}=${ver} must be an exact version`).toBe(true);
        }
      }
    }
    expect(existsSync(resolve(REPO, 'package-lock.json'))).toBe(true);
    const before = sh('git hash-object package-lock.json').stdout.trim();
    const dry = sh('npm ci --ignore-scripts --dry-run', { timeout: 300000 });
    expect(dry.status, dry.out.slice(-1500)).toBe(0);
    expect(sh('git hash-object package-lock.json').stdout.trim()).toBe(before);
  }, 320000);
});

describe('T-REPO-03 verify:no-install-scripts', () => {
  it('passes on the repo, fails on a lockfile with an install-script package', () => {
    const real = sh('npm run verify:no-install-scripts', { timeout: 120000 });
    expect(real.status, real.out.slice(-1500)).toBe(0);
    const script: string = JSON.parse(read('package.json')).scripts['verify:no-install-scripts'];
    const files = [...script.matchAll(/[\w./-]+\.(?:m?js|cjs|ts)/g)].map((m) => m[0]);
    const tmp = mkdtempSync(join(tmpdir(), 'fr-acc-vnis-'));
    const copy = (p: string) => {
      const dst = join(tmp, p);
      mkdirSync(dirname(dst), { recursive: true });
      if (existsSync(resolve(REPO, p))) copyFileSync(resolve(REPO, p), dst);
    };
    for (const f of ['package.json', 'package-lock.json', '.npmrc', ...files, ...pkgs()]) copy(f);
    const dirs = new Set(files.map((f) => dirname(f)).filter((d) => d !== '.'));
    for (const d of dirs) if (existsSync(resolve(REPO, d))) cpSync(resolve(REPO, d), join(tmp, d), { recursive: true });
    const ctl = sh('npm run verify:no-install-scripts', { cwd: tmp });
    expect(ctl.status, `control in temp copy: ${ctl.out.slice(-800)}`).toBe(0);
    const lock = JSON.parse(readFileSync(join(tmp, 'package-lock.json'), 'utf8'));
    lock.packages['node_modules/acc-fake-install-script'] = { version: '1.0.0', hasInstallScript: true };
    writeFileSync(join(tmp, 'package-lock.json'), JSON.stringify(lock, null, 2));
    const neg = sh('npm run verify:no-install-scripts', { cwd: tmp });
    expect(neg.status, 'injected hasInstallScript:true must fail the check').not.toBe(0);
  }, 300000);
});

describe('T-REPO-04 crypto + generated client', () => {
  it('argon2id round trip works from the api workspace; prisma client generated and git-ignored', () => {
    const api = resolve(REPO, 'api');
    const js = `
      (async () => {
        let mod; for (const n of ['argon2', '@node-rs/argon2']) { try { mod = require(require.resolve(n, { paths: [process.cwd()] })); break; } catch (e) {} }
        if (!mod) throw new Error('no argon2 implementation resolvable from api');
        const hash = await mod.hash('Correct-Horse-Battery-9', mod.Algorithm ? { algorithm: mod.Algorithm.Argon2id } : { type: mod.argon2id });
        if (!/^[$]argon2id[$]/.test(hash)) throw new Error('not argon2id: ' + hash.slice(0, 12));
        if (!(await mod.verify(hash, 'Correct-Horse-Battery-9'))) throw new Error('verify failed');
        if (await mod.verify(hash, 'wrong')) throw new Error('verify accepted wrong password');
        console.log('ok');
      })().catch((e) => { console.error(e.message); process.exit(1); });`;
    writeFileSync(join(tmpdir(), 'fr-acc-argon.cjs'), js);
    const r = sh(`node "${join(tmpdir(), 'fr-acc-argon.cjs')}"`, { cwd: api });
    expect(r.status, r.out).toBe(0);
    const p = resolve(api, 'src/generated/prisma/client.ts');
    expect(existsSync(p)).toBe(true);
    expect(sh(`git check-ignore -q "${p}"`).status, `${p} must be git-ignored`).toBe(0);
  }, 120000);
});

describe('T-REPO-05 audit and tree health', () => {
  it('npm run audit exits 0; npm ls --all is clean', () => {
    const a = sh('npm run audit', { timeout: 300000 });
    expect(a.status, a.out.slice(-2500)).toBe(0);
    const ls = sh('npm ls --all', { timeout: 300000 });
    const bad = ls.out.split('\n').filter((l) => /\b(invalid|missing|extraneous)\b/i.test(l));
    expect(bad, 'npm ls problems').toEqual([]);
    expect(ls.status, ls.out.slice(-1500)).toBe(0);
  }, 620000);
});

describe('T-REPO-06 secrets hygiene', () => {
  it('no high-risk patterns in new files; .gitignore covers env/tfstate/.terraform; dev defaults only in labelled files', () => {
    const files = sh('git ls-files -co --exclude-standard -- api web packages infra .github compose.web.yml .env.example scripts package.json')
      .stdout.split('\n').map((s) => s.trim()).filter((f) => f && !f.includes('test-acceptance/') && !/package-lock\.json$/.test(f) && existsSync(resolve(REPO, f)));
    expect(files.length).toBeGreaterThan(10);
    const pats: Array<[string, RegExp]> = [['aws key', /AKIA[0-9A-Z]{16}/], ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/], ['slack', /xox[baprs]-/], ['github', /ghp_[A-Za-z0-9]{20,}/], ['sk-', /sk-[A-Za-z0-9]{20,}/]];
    for (const f of files) {
      if (/\.(png|jpg|ico|woff2?|ttf)$/.test(f)) continue;
      const t = readFileSync(resolve(REPO, f), 'utf8');
      for (const [n, re] of pats) expect(re.test(t), `${f} matches ${n}`).toBe(false);
    }
    for (const probe of ['.env', 'x/.env', 'terraform.tfstate', 'infra/.terraform/x']) expect(sh(`git check-ignore -q "${probe}"`).status, `${probe} must be ignored`).toBe(0);
    const ex = read('.env.example');
    const defaults = [...ex.matchAll(/^(JWT_SECRET|CSRF_SECRET|REFRESH_PEPPER|MFA_ENC_KEY)=(.+)$/gm)].map((m) => m[2]!.trim().replace(/^["']|["']$/g, '')).filter((v) => v.length >= 12);
    for (const d of defaults) {
      expect(/dev|local|example|placeholder|change|insecure|test/i.test(ex), '.env.example labels its dev defaults').toBe(true);
      for (const f of files) {
        if (['.env.example', 'compose.web.yml'].includes(f) || f.startsWith('.github/workflows/')) continue;
        expect(readFileSync(resolve(REPO, f), 'utf8').includes(d), `dev default leaked into ${f}`).toBe(false);
      }
    }
  });
});

describe('T-CI-01 web-ci workflow', () => {
  const f = '.github/workflows/web-ci.yml';
  it('exists, least privilege, pinned actions, runs every gate; ci.yml untouched', async () => {
    expect(existsSync(resolve(REPO, f))).toBe(true);
    const y = read(f);
    expect(y).not.toMatch(/\t/);
    for (const mod of ['yaml', 'js-yaml']) {
      try {
        const lib: any = await import(mod);
        const parse = lib.parse ?? lib.load ?? lib.default?.parse ?? lib.default?.load;
        expect(parse(y)).toBeTruthy();
        break;
      } catch (e) {
        if (!/Cannot find|Failed to resolve|ERR_MODULE/.test(String(e))) throw e;
      }
    }
    expect(y).toMatch(/^permissions:\s*\n\s+contents:\s*read\s*$/m);
    const topPerms = /^permissions:\s*\n((?:[ \t]+.+\n)+)/m.exec(y)?.[1] ?? '';
    expect(topPerms).not.toMatch(/write/);
    expect(y).not.toContain('pull_request_target');
    expect(y).not.toMatch(/secrets\./);
    const uses = [...y.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) if (!u.startsWith('./')) expect(u, 'action must be pinned to a 40-hex SHA').toMatch(/@[0-9a-f]{40}(\s|$|#)/);
    expect(y).toContain('npm ci --ignore-scripts');
    for (const needle of ['lint', 'typecheck', 'test:acceptance', 'npm run build', 'audit', 'terraform', 'fmt', 'validate', 'compose']) expect(y, `workflow must run ${needle}`).toContain(needle);
    expect(/npm (run )?test\b/.test(y), 'unit tests').toBe(true);
    if (sh('git rev-parse --verify --quiet master').status === 0) expect(sh('git diff master -- .github/workflows/ci.yml').out.trim()).toBe('');
  });
});

describe('T-COMPOSE-01 compose.web.yml hardening', () => {
  const clean = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', HOME: process.env.HOME ?? process.env.USERPROFILE ?? '', USERPROFILE: process.env.USERPROFILE ?? '', DOCKER_HOST: process.env.DOCKER_HOST ?? '' } as NodeJS.ProcessEnv;
  it('validates with no env; existing compose still validates and is unchanged', (ctx) => {
    if (!have('docker')) return ctx.skip('docker CLI unavailable');
    const a = sh('docker compose -f compose.web.yml config -q', { env: clean });
    expect(a.status, a.out).toBe(0);
    const b = sh('docker compose -f docker-compose.yml config -q', { env: clean });
    expect(b.status, b.out).toBe(0);
    if (sh('git rev-parse --verify --quiet master').status === 0) expect(sh('git diff master -- docker-compose.yml').out.trim()).toBe('');
  }, 120000);
  it('rendered config: loopback ports, no privilege, pinned images, hardened api, distinct project', (ctx) => {
    if (!have('docker')) return ctx.skip('docker CLI unavailable');
    const r = sh('docker compose -f compose.web.yml config --format json', { env: clean });
    expect(r.status, r.out).toBe(0);
    const cfg = JSON.parse(r.stdout);
    expect(cfg.name).not.toBe('freight-recovery');
    expect(Object.keys(cfg.services)).toContain('api');
    for (const [name, s] of Object.entries<any>(cfg.services)) {
      for (const p of s.ports ?? []) expect(p.host_ip, `${name} published port ${p.published} must bind 127.0.0.1`).toBe('127.0.0.1');
      expect(s.privileged, `${name} privileged`).not.toBe(true);
      expect(s.network_mode, `${name} network_mode`).not.toBe('host');
      if (s.image) {
        expect(s.image, `${name} image must be pinned`).toMatch(/:[^:/]+$|@sha256:[0-9a-f]{64}/);
        expect(/:latest$/.test(s.image), `${name} uses :latest`).toBe(false);
      } else expect(s.build, `${name} needs image or build`).toBeTruthy();
    }
    const api = cfg.services.api;
    expect(api.read_only).toBe(true);
    expect(api.cap_drop).toContain('ALL');
    expect(JSON.stringify(api.security_opt ?? [])).toMatch(/no-new-privileges/);
  }, 120000);
});

describe('T-COMPOSE-02 stack smoke (needs a running Docker daemon)', () => {
  it('up --wait, headers via proxy, down -v', async (ctx) => {
    if (process.env.ACC_COMPOSE_UP !== '1') return ctx.skip('opt-in: set ACC_COMPOSE_UP=1 (would collide with the CI Postgres service on 5433)');
    if (!have('docker') || sh('docker info').status !== 0) return ctx.skip('docker daemon unavailable');
    const hdr = JSON.parse(read('web/security-headers.json')).headers as Record<string, string>;
    try {
      const up = sh('docker compose -f compose.web.yml up -d --build --wait', { timeout: 900000 });
      expect(up.status, up.out.slice(-3000)).toBe(0);
      const h = await fetch('http://127.0.0.1:8080/healthz');
      expect(h.status).toBe(200);
      const root = await fetch('http://127.0.0.1:8080/');
      for (const [k, v] of Object.entries(hdr)) expect(root.headers.get(k), `web header ${k}`).toBe(v);
      expect((await fetch('http://127.0.0.1:3001/healthz')).status).toBe(200);
    } finally {
      sh('docker compose -f compose.web.yml down -v', { timeout: 300000 });
    }
  }, 1200000);
});
