/**
 * Integration: the sandboxed parse executor with the BUILT worker and guard (`npm run build` first) and
 * hostile worker fixtures (api/test/fixtures/workers). Asserts: every misbehaving worker is stopped
 * within PARSE_TIMEOUT_MS + 2 s with the right reason, no process remains, the parent event loop stays
 * responsive, the worker environment is empty, secrets are unreadable, and no connection reaches a local
 * listener by any JS path. No database or object store needed.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ChildProcessExecutor, ParserBusyError, type ExecutorSettings } from '../../src/imports/sandbox/executor.js';
import { planFor, startWorker } from '../../src/imports/sandbox/spawn.js';
import { minimalPdf } from '../helpers/pdf-fixtures.js';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const builtEntry = path.join(apiRoot, 'dist', 'src', 'imports', 'sandbox', 'worker-main.js');
const builtGuard = path.join(apiRoot, 'dist', 'src', 'imports', 'sandbox', 'guard.js');
const fixture = (name: string) => path.join(apiRoot, 'test', 'fixtures', 'workers', name);
const built = existsSync(builtEntry) && existsSync(builtGuard);

const TIMEOUT_MS = 1500;

function settings(overrides: Partial<ExecutorSettings> = {}): ExecutorSettings {
  return {
    workerEntry: builtEntry,
    guardPath: builtGuard,
    timeoutMs: TIMEOUT_MS,
    memoryMb: 64,
    maxConcurrency: 2,
    queueTimeoutMs: 2000,
    maxOutputBytes: 1_000_000,
    limits: { pdfPages: 50, textChars: 2_000_000, imagePixels: 50_000_000 },
    threshold: 0.9,
    ...overrides,
  };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Run a fixture through the executor, capturing the child pid via a wrapping launcher. */
async function runFixture(name: string, overrides: Partial<ExecutorSettings> = {}) {
  const pids: number[] = [];
  const ex = new ChildProcessExecutor(settings({ workerEntry: fixture(name), ...overrides }), () => undefined, (plan) => {
    const w = startWorker(plan);
    if (w.pid !== undefined) pids.push(w.pid);
    return w;
  });
  let ticks = 0;
  const ticker = setInterval(() => {
    ticks += 1;
  }, 50);
  const started = Date.now();
  try {
    const outcome = await ex.run({ bytes: new TextEncoder().encode('Load Number: L1'), filename: 'a.txt', detectedType: 'TXT' });
    return { outcome, elapsed: Date.now() - started, pids, ticks, counters: ex.counters };
  } finally {
    clearInterval(ticker);
  }
}

describe.skipIf(!built)('parse sandbox (built worker)', () => {
  it('parses real documents with the built worker and guard', async () => {
    const ex = new ChildProcessExecutor(settings({ timeoutMs: 20_000, memoryMb: 256 }));
    const txt = await ex.run({ bytes: new TextEncoder().encode('Document: Invoice\nLoad Number: L1\nTotal: $5.00\n'), filename: 'a.txt', detectedType: 'TXT' });
    expect(txt).toMatchObject({ ok: true, result: { docType: 'INVOICE', status: 'ACCEPTED', loadNumber: 'L1' } });
    const pdf = await ex.run({ bytes: minimalPdf(['DOCUMENT: FREIGHT INVOICE', 'Invoice Number: INV-9', 'Load Number: L9']), filename: 'scan.pdf', detectedType: 'PDF' });
    expect(pdf.ok && pdf.result.fields.map((f) => [f.key, f.value, f.source.page])).toEqual([
      ['invoice.invoice_number', 'INV-9', 1],
      ['invoice.load_number', 'L9', 1],
    ]);
    const bad = await ex.run({ bytes: new TextEncoder().encode('a\rb\n'), filename: 'a.csv', detectedType: 'CSV' });
    expect(bad).toEqual({ ok: false, reason: 'malformed_csv' });
  });

  it.each([
    ['infinite-loop.mjs', 'parse_timeout'],
    ['slow-drip.mjs', 'parse_timeout'],
    ['output-flood.mjs', 'parse_failed'],
    ['crash.mjs', 'parse_failed'],
  ])('%s is stopped (%s) in time, reaped, and the parent stays responsive', async (name, reason) => {
    const r = await runFixture(name);
    expect(r.outcome).toEqual({ ok: false, reason });
    expect(r.elapsed).toBeLessThan(TIMEOUT_MS + 2000);
    for (const pid of r.pids) expect(alive(pid)).toBe(false);
    if (reason === 'parse_timeout') expect(r.ticks).toBeGreaterThan(TIMEOUT_MS / 50 / 2);
  }, 15_000);

  it('a memory hog is stopped by the V8 heap cap (parse_memory) or, at worst, the wall clock', async () => {
    const r = await runFixture('memory-hog.mjs', { timeoutMs: 10_000 });
    expect(r.outcome.ok).toBe(false);
    // Linux: SIGABRT -> parse_memory (asserted in CI). Windows reports the abort as an exit code.
    if (process.platform === 'linux') expect(r.outcome).toEqual({ ok: false, reason: 'parse_memory' });
    else expect(['parse_memory', 'parse_failed']).toContain((r.outcome as { reason: string }).reason);
    for (const pid of r.pids) expect(alive(pid)).toBe(false);
  }, 20_000);

  it('rejects with ParserBusy when no slot frees up in time', async () => {
    const ex = new ChildProcessExecutor(settings({ workerEntry: fixture('infinite-loop.mjs'), maxConcurrency: 1, queueTimeoutMs: 100 }));
    const job = { bytes: new Uint8Array([1]), filename: 'a.txt', detectedType: 'TXT' as const };
    const first = ex.run(job);
    await expect(ex.run(job)).rejects.toBeInstanceOf(ParserBusyError);
    expect(await first).toEqual({ ok: false, reason: 'parse_timeout' });
    expect(ex.counters.busyRejections).toBe(1);
  }, 15_000);

  describe('escape attempts', () => {
    let server: net.Server;
    let port = 0;
    let connections = 0;
    let secretDir = '';

    beforeAll(async () => {
      server = net.createServer((s) => {
        connections += 1;
        s.destroy();
      });
      await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
      port = (server.address() as net.AddressInfo).port;
      secretDir = mkdtempSync(path.join(tmpdir(), 'fr-secret-'));
      writeFileSync(path.join(secretDir, '.env'), 'DATABASE_URL=postgresql://secret');
    });

    afterAll(async () => {
      await new Promise<void>((res) => server.close(() => res()));
      rmSync(secretDir, { recursive: true, force: true });
    });

    it('denies files, processes, network, raw bindings, addons, workers and code generation; env is empty', async () => {
      const plan = planFor(fixture('escape-attempts.mjs'), 64, builtGuard);
      const w = startWorker(plan);
      const out: Buffer[] = [];
      w.stdout.on('data', (c: Buffer) => out.push(c));
      const closed = new Promise<void>((res) => w.onExit(() => res()));
      w.stdin.end(JSON.stringify({ port, dotenv: path.join(secretDir, '.env') }));
      const timer = setTimeout(() => w.kill(), 20_000);
      await closed;
      clearTimeout(timer);
      const r = JSON.parse(Buffer.concat(out).toString('utf8')) as Record<string, unknown>;
      if (process.platform === 'win32') {
        // libuv (uv_spawn on Windows) always re-adds its fixed "required" variables from the parent;
        // none carries a secret. On Linux (CI, production) the environment is empty.
        const libuvRequired = ['HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'PATH', 'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'USERDOMAIN', 'USERNAME', 'USERPROFILE', 'WINDIR'];
        for (const k of r['env'] as string[]) expect([k, libuvRequired.includes(k.toUpperCase())]).toEqual([k, true]);
      } else {
        expect(r['env']).toEqual([]);
      }
      for (const key of [
        'readEtcPasswd',
        'readDotenv',
        'writeTmp',
        'importChildProcess',
        'getBuiltinChildProcess',
        'requireChildProcess',
        'importNet',
        'getBuiltinNet',
        'requireHttp',
        'fetch',
        'dns',
        'dgram',
        'tcpWrap',
        'dlopen',
        'workerThreads',
        'vm',
        'evalString',
        'newFunction',
        'webSocket',
      ]) {
        expect([key, String(r[key]).startsWith('denied')]).toEqual([key, true]);
      }
      expect(connections).toBe(0);
      if (w.pid !== undefined) expect(alive(w.pid)).toBe(false);
    }, 30_000);
  });
});

describe.runIf(!built)('parse sandbox (skipped)', () => {
  it('needs the built worker: run `npm run build` before `npm run test:integration`', () => {
    expect(built).toBe(false);
  });
});
