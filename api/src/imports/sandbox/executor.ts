/**
 * Parse executor (A6). `ParseExecutor` is the seam: this step ships `ChildProcessExecutor` (one
 * sandboxed Node process per document); a queue/ECS-task implementation can replace it later without
 * touching callers.
 *
 * Limits enforced by the parent regardless of what the worker does: a counting semaphore of
 * PARSE_MAX_CONCURRENCY with a bounded wait (ParserBusy); wall clock PARSE_TIMEOUT_MS (kill ->
 * parse_timeout); stdout capped at PARSE_MAX_OUTPUT_BYTES (kill -> parse_failed); on Linux the RSS is
 * polled every 100 ms (> PARSE_MEMORY_MB x 1.5 -> kill -> parse_memory); V8 OOM aborts -> parse_memory;
 * any other failure or invalid output -> parse_failed. The child is always killed and reaped.
 */
import { readFile } from 'node:fs/promises';

import type { DetectedType } from '../parse/types.js';

import { encodeRequest, validateWorkerResponse, type ParseOutcome } from './protocol.js';
import { Semaphore, SlotTimeoutError } from './semaphore.js';
import { planFor, startWorker, type SpawnPlan, type WorkerProcess } from './spawn.js';

export class ParserBusyError extends Error {
  constructor() {
    super('parser busy');
    this.name = 'ParserBusyError';
  }
}

export interface ParseJob {
  bytes: Uint8Array;
  filename: string;
  detectedType: DetectedType;
}

export interface ParseExecutor {
  /** Run one parse job; throws ParserBusyError when no slot frees up in time. */
  run(job: ParseJob): Promise<ParseOutcome>;
}

export interface ExecutorSettings {
  workerEntry: string;
  /** Guard module preloaded into the worker (default: guard.js next to the worker entry). */
  guardPath?: string;
  timeoutMs: number;
  memoryMb: number;
  maxConcurrency: number;
  queueTimeoutMs: number;
  maxOutputBytes: number;
  limits: { pdfPages: number; textChars: number; imagePixels: number };
  threshold: number;
}

/** In-process counters (step 4's pipeline-health panel will expose them). */
export interface ExecutorCounters {
  jobs: number;
  succeeded: number;
  rejected: number;
  timeouts: number;
  memoryKills: number;
  failures: number;
  busyRejections: number;
  queueWaitMs: number;
}

export type OutcomeLogger = (event: { code: string; durationMs: number; sizeBytes: number; queueWaitMs: number }) => void;

const RSS_POLL_MS = 100;
const RSS_FACTOR = 1.5;

type Launcher = (plan: SpawnPlan) => WorkerProcess;

async function rssKb(pid: number): Promise<number | null> {
  try {
    const status = await readFile(`/proc/${pid}/status`, 'utf8');
    const m = /^VmRSS:\s+(\d+)\s+kB$/mu.exec(status);
    return m?.[1] ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** Exit code / signal of a V8 out-of-memory abort (SIGABRT on POSIX; 134 when run under a shell). */
export function isOomExit(code: number | null, signal: NodeJS.Signals | null): boolean {
  return signal === 'SIGABRT' || code === 134 || code === 3221226505;
}

export class ChildProcessExecutor implements ParseExecutor {
  readonly counters: ExecutorCounters = { jobs: 0, succeeded: 0, rejected: 0, timeouts: 0, memoryKills: 0, failures: 0, busyRejections: 0, queueWaitMs: 0 };
  private readonly slots: Semaphore;
  private readonly plan: SpawnPlan;

  constructor(
    private readonly settings: ExecutorSettings,
    private readonly log: OutcomeLogger = () => undefined,
    private readonly launch: Launcher = startWorker,
  ) {
    this.slots = new Semaphore(settings.maxConcurrency);
    this.plan = planFor(settings.workerEntry, settings.memoryMb, settings.guardPath);
  }

  async run(job: ParseJob): Promise<ParseOutcome> {
    const waitStart = Date.now();
    let release: () => void;
    try {
      release = await this.slots.acquire(this.settings.queueTimeoutMs);
    } catch (e) {
      if (e instanceof SlotTimeoutError) {
        this.counters.busyRejections += 1;
        this.log({ code: 'parse_busy', durationMs: 0, sizeBytes: job.bytes.byteLength, queueWaitMs: Date.now() - waitStart });
        throw new ParserBusyError();
      }
      throw e;
    }
    const queueWaitMs = Date.now() - waitStart;
    this.counters.queueWaitMs += queueWaitMs;
    this.counters.jobs += 1;
    const started = Date.now();
    try {
      const outcome = await this.runOnce(job);
      if (outcome.ok) this.counters.succeeded += 1;
      else if (outcome.reason === 'parse_timeout') this.counters.timeouts += 1;
      else if (outcome.reason === 'parse_memory') this.counters.memoryKills += 1;
      else if (outcome.reason === 'parse_failed') this.counters.failures += 1;
      else this.counters.rejected += 1;
      this.log({ code: outcome.ok ? 'parse_ok' : outcome.reason, durationMs: Date.now() - started, sizeBytes: job.bytes.byteLength, queueWaitMs });
      return outcome;
    } finally {
      release();
    }
  }

  private runOnce(job: ParseJob): Promise<ParseOutcome> {
    const s = this.settings;
    return new Promise<ParseOutcome>((resolve) => {
      let child: WorkerProcess;
      try {
        child = this.launch(this.plan);
      } catch {
        resolve({ ok: false, reason: 'parse_failed' });
        return;
      }
      const chunks: Buffer[] = [];
      let outBytes = 0;
      let verdict: ParseOutcome | null = null;
      let settled = false;
      let poll: NodeJS.Timeout | null = null;

      const finish = (outcome: ParseOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (poll) clearInterval(poll);
        resolve(outcome);
      };
      const abort = (reason: 'parse_timeout' | 'parse_memory' | 'parse_failed') => {
        verdict ??= { ok: false, reason };
        child.kill();
      };

      const timer = setTimeout(() => abort('parse_timeout'), s.timeoutMs);
      if (process.platform === 'linux' && child.pid !== undefined) {
        const pid = child.pid;
        const limitKb = s.memoryMb * 1024 * RSS_FACTOR;
        poll = setInterval(() => {
          void rssKb(pid).then((kb) => {
            if (kb !== null && kb > limitKb) abort('parse_memory');
          });
        }, RSS_POLL_MS);
      }

      child.onError(() => {
        verdict ??= { ok: false, reason: 'parse_failed' };
        finish(verdict);
      });
      child.stdout.on('data', (c: Buffer) => {
        outBytes += c.length;
        if (outBytes > s.maxOutputBytes) {
          abort('parse_failed');
          return;
        }
        chunks.push(c);
      });
      child.onExit((code, signal) => {
        if (verdict) {
          finish(verdict);
          return;
        }
        if (isOomExit(code, signal)) {
          finish({ ok: false, reason: 'parse_memory' });
          return;
        }
        if (code !== 0) {
          finish({ ok: false, reason: 'parse_failed' });
          return;
        }
        // Let the stdout stream drain fully before validating.
        setImmediate(() => {
          if (verdict) {
            finish(verdict);
            return;
          }
          finish(validateWorkerResponse(Buffer.concat(chunks).toString('utf8'), { detectedType: job.detectedType, limits: s.limits, threshold: s.threshold }));
        });
      });

      // Feed the request; a worker that exits early yields EPIPE, which is ignored here.
      const stdin = child.stdin as NodeJS.WritableStream & { on(event: 'error', cb: (e: Error) => void): void };
      stdin.on('error', () => undefined);
      stdin.write(encodeRequest({ v: 1, filename: job.filename, detectedType: job.detectedType, limits: s.limits, threshold: s.threshold, size: job.bytes.byteLength }));
      stdin.end(Buffer.from(job.bytes.buffer, job.bytes.byteOffset, job.bytes.byteLength));
    });
  }
}
