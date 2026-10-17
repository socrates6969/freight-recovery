/**
 * Unit tests of the sandbox plumbing without real processes: parent-side validation of untrusted worker
 * output, the semaphore/gate, the spawn plan (env allow-list, flags, read allow-list) and the executor's
 * limit handling with a fake launcher.
 */
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { parseDocument } from '../../src/imports/parse/pipeline.js';
import { ChildProcessExecutor, ParserBusyError, isOomExit, type ExecutorSettings } from '../../src/imports/sandbox/executor.js';
import { validateWorkerResponse } from '../../src/imports/sandbox/protocol.js';
import { KeyedGate, Semaphore, SlotTimeoutError } from '../../src/imports/sandbox/semaphore.js';
import { WORKER_ENV_ALLOW_LIST, planFor, workerArgs, workerEnv, type WorkerProcess } from '../../src/imports/sandbox/spawn.js';

const LIMITS = { pdfPages: 50, textChars: 2_000_000, imagePixels: 50_000_000 };
const CTX = { detectedType: 'TXT' as const, limits: LIMITS, threshold: 0.9 };

async function goodResponse(text = 'Document: Invoice\nLoad Number: L1\nTotal: 5\n'): Promise<Record<string, unknown>> {
  const r = await parseDocument({ bytes: new TextEncoder().encode(text), filename: 'a.txt', detectedType: 'TXT', limits: LIMITS, threshold: 0.9 });
  return { ok: true, result: r };
}

describe('worker response validation (untrusted output)', () => {
  it('accepts a genuine response and re-derives excerpts, flags and reasons', async () => {
    const res = await goodResponse();
    const out = validateWorkerResponse(JSON.stringify(res), CTX);
    expect(out.ok && out.result.status).toBe('ACCEPTED');
    const tampered = structuredClone(res) as { result: { fields: { source: { excerpt: string } }[]; reviewReasons: string[]; status: string } };
    const f0 = tampered.result.fields[0];
    if (f0) f0.source.excerpt = '<script>evil</script>';
    tampered.result.status = 'ACCEPTED';
    const v = validateWorkerResponse(JSON.stringify(tampered), CTX);
    expect(v.ok && v.result.fields[0]?.source.excerpt).toBe('Load Number: L1');
  });

  it('a stricter threshold in the parent re-flags fields the worker did not flag', async () => {
    const res = await goodResponse();
    const out = validateWorkerResponse(JSON.stringify(res), { ...CTX, threshold: 0.96 });
    expect(out.ok && out.result.fields.every((f) => f.needsReview && f.reviewReasons.includes('LOW_CONFIDENCE'))).toBe(true);
    expect(out.ok && out.result.status).toBe('NEEDS_REVIEW');
  });

  it.each([
    ['not JSON', () => 'nope'],
    ['extra top-level key', async () => ({ ...(await goodResponse()), extra: 1 })],
    ['unknown field key', async () => mutate(await goodResponse(), (r) => ((r.fields[0] as Record<string, unknown>)['key'] = 'invoice.secret'))],
    ['field of another doc type', async () => mutate(await goodResponse(), (r) => ((r.fields[0] as Record<string, unknown>)['key'] = 'bol.load_number'))],
    ['pointer outside the line', async () => mutate(await goodResponse(), (r) => ((r.fields[0] as { source: Record<string, unknown> }).source['end'] = 999))],
    ['pointer beyond the text', async () => mutate(await goodResponse(), (r) => ((r.fields[0] as { source: Record<string, unknown> }).source['line'] = 99))],
    ['bad decimal value', async () => mutate(await goodResponse(), (r) => ((r.fields[1] as Record<string, unknown>)['value'] = '1e3'))],
    ['control characters in a value', async () => mutate(await goodResponse(), (r) => ((r.fields[0] as Record<string, unknown>)['value'] = 'L\u00011'))],
    ['page on a text document', async () => mutate(await goodResponse(), (r) => ((r.fields[0] as { source: Record<string, unknown> }).source['page'] = 1))],
    ['unknown warning', async () => mutate(await goodResponse(), (r) => (r.warnings = ['PWNED']))],
    ['wrong provider', async () => mutate(await goodResponse(), (r) => (r.providerName = 'llm'))],
    ['unknown reject reason', () => ({ ok: false, reason: 'reviewer_rejected' })],
    ['too much text', async () => mutate(await goodResponse(), (r) => (r.text = 'x'.repeat(LIMITS.textChars + 1)))],
    // Fix round 2 (F-04): control characters / lone surrogates in the document text.
    ['NUL in the text', async () => mutate(await goodResponse(), (r) => (r.text += '\u{0}'))],
    ['ESC in the text', async () => mutate(await goodResponse(), (r) => (r.text += 'a\u{1b}b'))],
    ['BEL in the text', async () => mutate(await goodResponse(), (r) => (r.text += '\u{7}'))],
    ['DEL in the text', async () => mutate(await goodResponse(), (r) => (r.text += '\u{7f}'))],
    ['C1 control in the text', async () => mutate(await goodResponse(), (r) => (r.text += '\u{90}'))],
    ['lone surrogate in the text', async () => mutate(await goodResponse(), (r) => (r.text += '\ud800'))],
  ])('rejects %s as parse_failed', async (_name, make) => {
    const v = await make();
    expect(validateWorkerResponse(typeof v === 'string' ? v : JSON.stringify(v), CTX)).toEqual({ ok: false, reason: 'parse_failed' });
  });

  it('F-04: allows HT and the splitlines separators in the text; the worker strips disallowed controls itself', async () => {
    const ok = validateWorkerResponse(JSON.stringify(mutate(await goodResponse(), (r) => (r.text += 'a\tb\fc\u{85}d\u{b}e\u{1c}f\r'))), CTX);
    expect(ok.ok).toBe(true);
    const r = await parseDocument({
      bytes: new TextEncoder().encode('Document: Invoice\nLoad Number: L1\u{81}\nTotal: 5\n'),
      filename: 'a.txt',
      detectedType: 'TXT',
      limits: LIMITS,
      threshold: 0.9,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text.includes('\u{81}')).toBe(false);
      expect(r.warnings).toContain('DECODE_REPLACEMENTS');
      expect(validateWorkerResponse(JSON.stringify({ ok: true, result: r }), CTX).ok).toBe(true);
    }
  });

  it('passes allow-listed rejections through', () => {
    expect(validateWorkerResponse(JSON.stringify({ ok: false, reason: 'encrypted_pdf' }), CTX)).toEqual({ ok: false, reason: 'encrypted_pdf' });
  });
});

function mutate(res: Record<string, unknown>, fn: (r: { fields: unknown[]; warnings: unknown[]; providerName: string; text: string }) => void): Record<string, unknown> {
  const copy = structuredClone(res);
  fn(copy['result'] as { fields: unknown[]; warnings: unknown[]; providerName: string; text: string });
  return copy;
}

describe('semaphore and keyed gate', () => {
  it('limits concurrency and times out waiters', async () => {
    const s = new Semaphore(1);
    const r1 = await s.acquire(10);
    await expect(s.acquire(20)).rejects.toBeInstanceOf(SlotTimeoutError);
    const pending = s.acquire(1000);
    r1();
    r1();
    const r2 = await pending;
    expect(s.inUse).toBe(1);
    r2();
    expect(s.inUse).toBe(0);
  });

  it('gates per key', () => {
    const g = new KeyedGate(2);
    const a = g.tryEnter('t1');
    const b = g.tryEnter('t1');
    expect(g.tryEnter('t1')).toBeNull();
    expect(g.tryEnter('t2')).not.toBeNull();
    a?.();
    a?.();
    expect(g.holders('t1')).toBe(1);
    expect(g.tryEnter('t1')).not.toBeNull();
    b?.();
  });
});

describe('spawn plan', () => {
  it('passes nothing from the environment except SystemRoot on Windows', () => {
    expect(workerEnv({ DATABASE_URL: 'x', S3_SECRET_ACCESS_KEY: 'y', NODE_OPTIONS: '--inspect', SystemRoot: 'C:\\Windows' })).toEqual(
      process.platform === 'win32' ? { SystemRoot: 'C:\\Windows' } : {},
    );
    expect(WORKER_ENV_ALLOW_LIST.length).toBeLessThanOrEqual(1);
  });

  it('uses the permission model with a narrow read allow-list and hardening flags', () => {
    const entry = path.resolve('dist', 'src', 'imports', 'sandbox', 'worker-main.js');
    const args = workerArgs(planFor(entry, 128));
    expect(args[0]).toBe('--permission');
    expect(args).toContain('--max-old-space-size=128');
    expect(args).toContain('--max-semi-space-size=16');
    expect(args).toContain('--disallow-code-generation-from-strings');
    expect(args.at(-1)).toBe(entry);
    expect(args.at(-3)).toBe('--import');
    for (const banned of ['--allow-fs-write', '--allow-child-process', '--allow-worker', '--allow-addons', '--allow-wasi', '--inspect']) {
      expect(args.some((a) => a.startsWith(banned))).toBe(false);
    }
    const reads = args.filter((a) => a.startsWith('--allow-fs-read=')).map((a) => a.slice('--allow-fs-read='.length));
    const repoRoot = path.resolve('..');
    expect(reads.some((r) => r === path.join(repoRoot, '*') || r === repoRoot || r === '*')).toBe(false);
    expect(reads.every((r) => !r.includes('.env'))).toBe(true);
  });
});

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  killed = false;
  pid = 4242;
}

function fakeLauncher(behaviour: (c: FakeChild) => void): { launch: () => WorkerProcess; children: FakeChild[] } {
  const children: FakeChild[] = [];
  const launch = (): WorkerProcess => {
    const c = new FakeChild();
    children.push(c);
    setImmediate(() => behaviour(c));
    return {
      pid: c.pid,
      stdin: c.stdin,
      stdout: c.stdout,
      onExit: (cb) => c.once('close', cb),
      onError: (cb) => c.once('error', cb),
      kill: () => {
        if (c.killed) return;
        c.killed = true;
        setImmediate(() => c.emit('close', null, 'SIGKILL'));
      },
    };
  };
  return { launch, children };
}

const SETTINGS: ExecutorSettings = {
  workerEntry: path.resolve('dist', 'src', 'imports', 'sandbox', 'worker-main.js'),
  timeoutMs: 200,
  memoryMb: 64,
  maxConcurrency: 1,
  queueTimeoutMs: 50,
  maxOutputBytes: 1000,
  limits: LIMITS,
  threshold: 0.9,
};

describe('executor limits (fake launcher)', () => {
  const job = { bytes: new TextEncoder().encode('x'), filename: 'a.txt', detectedType: 'TXT' as const };

  it('kills on the wall clock -> parse_timeout', async () => {
    const f = fakeLauncher(() => undefined);
    const ex = new ChildProcessExecutor(SETTINGS, () => undefined, f.launch);
    expect(await ex.run(job)).toEqual({ ok: false, reason: 'parse_timeout' });
    expect(f.children[0]?.killed).toBe(true);
    expect(ex.counters.timeouts).toBe(1);
  });

  it('kills on output flood -> parse_failed', async () => {
    const f = fakeLauncher((c) => c.stdout.write('x'.repeat(2000)));
    const ex = new ChildProcessExecutor(SETTINGS, () => undefined, f.launch);
    expect(await ex.run(job)).toEqual({ ok: false, reason: 'parse_failed' });
    expect(f.children[0]?.killed).toBe(true);
  });

  it('maps non-zero exits and OOM aborts', async () => {
    const crash = fakeLauncher((c) => c.emit('close', 1, null));
    expect(await new ChildProcessExecutor(SETTINGS, () => undefined, crash.launch).run(job)).toEqual({ ok: false, reason: 'parse_failed' });
    const oom = fakeLauncher((c) => c.emit('close', null, 'SIGABRT'));
    expect(await new ChildProcessExecutor(SETTINGS, () => undefined, oom.launch).run(job)).toEqual({ ok: false, reason: 'parse_memory' });
    expect(isOomExit(134, null)).toBe(true);
    expect(isOomExit(1, null)).toBe(false);
  });

  it('validates a successful response and reports busy when the slot is taken', async () => {
    const response = JSON.stringify(await goodResponse());
    const f = fakeLauncher((c) => {
      c.stdout.end(response);
      setImmediate(() => c.emit('close', 0, null));
    });
    const ex = new ChildProcessExecutor({ ...SETTINGS, maxOutputBytes: 1_000_000 }, () => undefined, f.launch);
    const out = await ex.run(job);
    expect(out.ok).toBe(true);
    const slow = fakeLauncher(() => undefined);
    const busyEx = new ChildProcessExecutor(SETTINGS, () => undefined, slow.launch);
    const first = busyEx.run(job);
    await expect(busyEx.run(job)).rejects.toBeInstanceOf(ParserBusyError);
    await first;
  });
});
