/**
 * Bounded in-memory buffer of DERIVED log records for R62 (Q5.3). It never stores a raw log line: each
 * already-redacted Pino line is parsed and reduced to eight whitelisted fields, each validated; anything
 * else in the line is discarded. The message is kept only when it matches a strict safe-text rule,
 * otherwise it becomes "(message withheld)". Memory is bounded by the capacity (THIS instance only).
 */
import type { LogLevelName, LogRecordDto } from '@fr/shared';

export const WITHHELD = '(message withheld)';

const LEVEL_NAMES: ReadonlyMap<number, LogLevelName> = new Map([
  [10, 'trace'],
  [20, 'debug'],
  [30, 'info'],
  [40, 'warn'],
  [50, 'error'],
  [60, 'fatal'],
]);
const LEVEL_RANK: Readonly<Record<LogLevelName, number>> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
const METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SAFE_EVENT_RE = /^[A-Za-z0-9 _.:/()-]{1,80}$/u;
const LONG_TOKEN_RE = /[A-Za-z0-9_-]{20,}/u;
const MAX_LINE_CHARS = 64 * 1024;
/** Route patterns only (letters, digits and the separators Fastify patterns use). */
const SAFE_ROUTE_RE = /^[A-Za-z0-9_/:.*()-]+$/u;

/** The Q5.3 message rule (also withholds anything that looks like an API key prefix). */
export function safeEvent(msg: unknown): string {
  if (typeof msg !== 'string') return WITHHELD;
  if (!SAFE_EVENT_RE.test(msg) || msg.includes('@') || LONG_TOKEN_RE.test(msg) || msg.includes('fr_live_')) return WITHHELD;
  return msg;
}

function own(obj: unknown, key: string): unknown {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return undefined;
  return Object.prototype.hasOwnProperty.call(obj, key) ? (obj as Record<string, unknown>)[key] : undefined;
}

function pick(rec: unknown, key: string): unknown {
  const fromReq = own(own(rec, 'req'), key);
  return fromReq !== undefined ? fromReq : own(own(rec, 'res'), key);
}

/** Reduce one parsed log object to a LogRecord, or null when it must be dropped. */
export function deriveRecord(rec: unknown): LogRecordDto | null {
  const lv = own(rec, 'level');
  const level = typeof lv === 'number' ? LEVEL_NAMES.get(lv) : undefined;
  if (!level) return null;
  const t = own(rec, 'time');
  if (typeof t !== 'string' || t.length > 64) return null;
  const ms = Date.parse(t);
  if (!Number.isFinite(ms)) return null;
  const requestId = pick(rec, 'requestId');
  const method = pick(rec, 'method');
  const route = pick(rec, 'route');
  const statusCode = pick(rec, 'statusCode');
  const durationMs = pick(rec, 'durationMs');
  return {
    time: new Date(ms).toISOString(),
    level,
    requestId: typeof requestId === 'string' && UUID_RE.test(requestId) ? requestId.toLowerCase() : null,
    method: typeof method === 'string' && METHODS.has(method) ? method : null,
    route: typeof route === 'string' && route.startsWith('/') && route.length <= 200 && !route.includes('?') && SAFE_ROUTE_RE.test(route) ? route : null,
    statusCode: typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599 ? statusCode : null,
    durationMs: typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null,
    event: safeEvent(own(rec, 'msg')),
  };
}

export interface LogQuery {
  level: LogLevelName;
  limit: number;
  requestId?: string | undefined;
}

export class LogRingBuffer {
  private readonly items: (LogRecordDto | undefined)[];
  private next = 0;
  private size = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be a positive integer');
    this.items = new Array<LogRecordDto | undefined>(capacity);
  }

  /** Feed one or more newline-separated JSON log lines. Never throws. */
  ingest(chunk: string): void {
    try {
      if (typeof chunk !== 'string') return;
      for (const line of chunk.split('\n')) {
        if (line.length === 0 || line.length > MAX_LINE_CHARS) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        const rec = deriveRecord(parsed);
        if (rec) this.push(rec);
      }
    } catch {
      // The buffer must never break the logger.
    }
  }

  private push(rec: LogRecordDto): void {
    this.items[this.next] = rec;
    this.next = (this.next + 1) % this.capacity;
    if (this.size < this.capacity) this.size += 1;
  }

  /** Records newest first. */
  private newestFirst(): LogRecordDto[] {
    const out: LogRecordDto[] = [];
    for (let i = 1; i <= this.size; i += 1) {
      const r = this.items[(this.next - i + this.capacity * 2) % this.capacity];
      if (r) out.push(r);
    }
    return out;
  }

  query(q: LogQuery): { items: LogRecordDto[]; oldestTime: string | null } {
    const min = LEVEL_RANK[q.level];
    const want = q.requestId?.toLowerCase();
    const all = this.newestFirst();
    const items = all.filter((r) => LEVEL_RANK[r.level] >= min && (want === undefined || r.requestId === want)).slice(0, q.limit);
    const oldest = all[all.length - 1];
    return { items, oldestTime: oldest ? oldest.time : null };
  }
}
