/**
 * THE ONLY module in api/src allowed to start a process (A1.4 carve-out; enforced by ESLint and
 * api/test/architecture.test.ts). It launches the parse worker as a separate Node process:
 *
 *  - executable: process.execPath (this very Node binary), never a shell (shell: false);
 *  - environment: EMPTY except SystemRoot on Windows (no DATABASE_URL, no AWS/S3 settings, no
 *    NODE_OPTIONS, no secrets);
 *  - cwd: an empty private directory created once at boot under the OS temp dir (mode 0700);
 *  - Node permission model: `--permission` with read access ONLY to the worker code, its package.json
 *    files and the pdf.js package (no write, no child processes, no workers, no addons, no WASI);
 *  - V8 limits: --max-old-space-size (PARSE_MEMORY_MB), --max-semi-space-size=16;
 *  - --disallow-code-generation-from-strings; WebSocket disabled by flag and `fetch` deleted by a preloaded guard
 *    (`--import`) that also blocks network/process/vm modules and raw bindings (defense in depth: network
 *    isolation in production comes from the ECS task network, see infra/README.md).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface SpawnPlan {
  /** Absolute path of the worker entry (dist/src/imports/sandbox/worker-main.js). */
  entry: string;
  /** Absolute path of the guard module (dist/src/imports/sandbox/guard.js). */
  guard: string;
  /** Read-only paths granted to the worker (files or directories ending with a separator + `*`). */
  readPaths: string[];
  memoryMb: number;
}

/** Fixed environment allow-list for the worker: nothing from the parent environment except SystemRoot on Windows. */
export const WORKER_ENV_ALLOW_LIST: readonly string[] = Object.freeze(process.platform === 'win32' ? ['SystemRoot'] : []);

export function workerEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of WORKER_ENV_ALLOW_LIST) {
    const v = source[k];
    if (v !== undefined) env[k] = v;
  }
  return env;
}

/** First `<ancestor>/<rel>` that exists: its path as found AND its real path (they differ for links). */
function findUp(start: string, rel: string): { linked: string; real: string } | null {
  let dir = start;
  for (;;) {
    const candidate = path.join(dir, rel);
    try {
      return { linked: candidate, real: realpathSync(candidate) };
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}

/**
 * The minimal read allow-list for a built worker entry: the compiled imports/ tree, the api and shared
 * package.json files (ESM `type` lookup), the compiled shared package, and pdf.js. Paths are resolved
 * through symlinks (npm workspaces link @fr/shared) because the permission model checks real paths.
 */
export function planFor(entry: string, memoryMb: number, guardPath?: string): SpawnPlan {
  const sandboxDir = path.dirname(entry);
  const importsDir = path.dirname(sandboxDir);
  const apiPkg = findUp(importsDir, 'package.json');
  const sharedPkg = findUp(importsDir, path.join('node_modules', '@fr', 'shared', 'package.json'));
  const pdfjs = findUp(importsDir, path.join('node_modules', 'pdfjs-dist', 'package.json'));
  const readPaths = [path.join(importsDir, '*')];
  if (apiPkg) readPaths.push(apiPkg.real);
  if (sharedPkg) {
    // The resolver reads package.json through the workspace link; modules load from the real path.
    readPaths.push(path.dirname(sharedPkg.linked), sharedPkg.linked, sharedPkg.real, path.join(path.dirname(sharedPkg.real), 'dist', '*'));
  }
  if (pdfjs) readPaths.push(path.join(path.dirname(pdfjs.linked), '*'), path.join(path.dirname(pdfjs.real), '*'));
  const guard = guardPath ?? path.join(sandboxDir, 'guard.js');
  readPaths.push(guard);
  return { entry, guard, readPaths: [...new Set(readPaths)], memoryMb };
}

/** Node flags for the worker, feature-detected for the running Node version (22 and 24 differ). */
export function workerArgs(plan: SpawnPlan): string[] {
  const allowed = process.allowedNodeEnvironmentFlags;
  const args = ['--permission', ...plan.readPaths.map((p) => `--allow-fs-read=${p}`)];
  args.push(`--max-old-space-size=${plan.memoryMb}`, '--max-semi-space-size=16', '--disallow-code-generation-from-strings');
  // NOT --no-experimental-fetch: on Node 22 it also removes the inert Response/Request/Headers classes,
  // which pdf.js 6 references at load time. The guard deletes the `fetch` function itself instead.
  if (allowed.has('--no-experimental-websocket')) args.push('--no-experimental-websocket');
  args.push('--import', pathToImportSpecifier(plan.guard), plan.entry);
  return args;
}

function pathToImportSpecifier(p: string): string {
  // --import takes a module specifier; an absolute Windows path must be given as a file: URL.
  return process.platform === 'win32' ? `file:///${p.replace(/\\/gu, '/')}` : p;
}

let emptyCwd: string | null = null;

/** The worker's cwd: an empty private directory created once per process. */
export function workerCwd(): string {
  emptyCwd ??= mkdtempSync(path.join(tmpdir(), 'fr-parse-'));
  return emptyCwd;
}

export interface WorkerProcess {
  pid: number | undefined;
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  onExit(cb: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  onError(cb: (err: Error) => void): void;
  /** Kill the worker (its whole process group on POSIX). */
  kill(): void;
}

export function startWorker(plan: SpawnPlan): WorkerProcess {
  const detached = process.platform !== 'win32';
  const child = spawn(process.execPath, workerArgs(plan), {
    cwd: workerCwd(),
    env: workerEnv(),
    stdio: ['pipe', 'pipe', 'ignore'],
    shell: false,
    windowsHide: true,
    detached,
  });
  return {
    pid: child.pid,
    stdin: child.stdin,
    stdout: child.stdout,
    onExit: (cb) => child.once('close', cb),
    onError: (cb) => child.once('error', cb),
    kill: () => {
      try {
        if (detached && child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // already gone
        }
      }
    },
  };
}
