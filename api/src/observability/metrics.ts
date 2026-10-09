/**
 * In-process request and component telemetry (Q5.2). Pure: no I/O, no clock of its own, no per-request
 * storage. Memory is O(routes x buckets): at most MAX_ROUTE_KEYS distinct (method, route-pattern) keys;
 * further keys aggregate into ('ANY', '(other)'). Counts cover THIS instance since start.
 *
 * A duration d goes to the first bucket with d <= bound; counts are per bucket (not cumulative). The
 * p50/p95 values reported are UPPER BOUNDS of the bucket holding the nearest-rank sample, never point
 * estimates.
 */
import type { ComponentId, ComponentStatDto, RouteStatDto, TelemetryDto } from '@fr/shared';

export const DURATION_BOUNDS: readonly number[] = Object.freeze([5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, Number.POSITIVE_INFINITY]);
/** Distinct keys kept; with the '(other)' aggregate the route table has at most 200 entries (Q5.2). */
export const MAX_ROUTE_KEYS = 199;
export const OTHER_ROUTE = '(other)';
export const UNMATCHED_ROUTE = '(unmatched)';
const KNOWN_METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const COMPONENTS: readonly ComponentId[] = ['priority-v1', 'similar-v1'];

type StatusClass = '2xx' | '3xx' | '4xx' | '5xx';

function statusClass(status: number): StatusClass {
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  return '2xx';
}

class Histogram {
  readonly counts: number[] = DURATION_BOUNDS.map(() => 0);
  total = 0;

  add(durationMs: number): void {
    const d = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
    const i = DURATION_BOUNDS.findIndex((b) => d <= b);
    const idx = i === -1 ? DURATION_BOUNDS.length - 1 : i;
    this.counts[idx] = (this.counts[idx] ?? 0) + 1;
    this.total += 1;
  }

  buckets(): { leMs: number | null; count: number }[] {
    return DURATION_BOUNDS.map((b, i) => ({ leMs: Number.isFinite(b) ? b : null, count: this.counts[i] ?? 0 }));
  }

  /** Upper bound of the bucket holding the nearest-rank NN-th percentile; null when empty or +Inf. */
  upperBound(percent: number): number | null {
    if (this.total === 0) return null;
    const rank = Math.ceil((percent / 100) * this.total);
    let cum = 0;
    for (let i = 0; i < DURATION_BOUNDS.length; i += 1) {
      cum += this.counts[i] ?? 0;
      if (cum >= rank) {
        const b = DURATION_BOUNDS[i] ?? Number.POSITIVE_INFINITY;
        return Number.isFinite(b) ? b : null;
      }
    }
    return null;
  }
}

interface RouteEntry {
  method: string;
  route: string;
  count: number;
  byStatusClass: Record<StatusClass, number>;
  hist: Histogram;
}

interface ComponentEntry {
  calls: number;
  errors: number;
  hist: Histogram;
  candidateSum: number;
  candidateCalls: number;
}

const emptyClasses = (): Record<StatusClass, number> => ({ '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 });

export interface ParserCounters {
  jobs: number;
  succeeded: number;
  rejected: number;
  timeouts: number;
  memoryKills: number;
  failures: number;
  busyRejections: number;
  queueWaitMs: number;
}

export const ZERO_PARSER_COUNTERS: ParserCounters = Object.freeze({
  jobs: 0,
  succeeded: 0,
  rejected: 0,
  timeouts: 0,
  memoryKills: 0,
  failures: 0,
  busyRejections: 0,
  queueWaitMs: 0,
});

export interface SnapshotInput {
  parser: ParserCounters;
  /** Current flag state of each component (worklist -> priority-v1, similar_claims -> similar-v1). */
  flags: Readonly<Record<ComponentId, boolean>>;
  now: Date;
  startedAt: Date;
  version: string;
  nodeVersion: string;
}

export class MetricsRegistry {
  private readonly routes = new Map<string, RouteEntry>();
  private readonly components = new Map<ComponentId, ComponentEntry>(
    COMPONENTS.map((c) => [c, { calls: 0, errors: 0, hist: new Histogram(), candidateSum: 0, candidateCalls: 0 }]),
  );
  private total = 0;
  private readonly classes = emptyClasses();
  private s401 = 0;
  private s403 = 0;
  private s429 = 0;

  observeRequest(o: { method: string; route: string; status: number; durationMs: number }): void {
    const method = KNOWN_METHODS.has(o.method) ? o.method : 'OTHER';
    let key = `${method} ${o.route}`;
    let entry = this.routes.get(key);
    if (!entry) {
      if (this.routes.size >= MAX_ROUTE_KEYS && !this.routes.has(`ANY ${OTHER_ROUTE}`)) {
        // Room for exactly one more key: the overflow aggregate.
        key = `ANY ${OTHER_ROUTE}`;
        entry = { method: 'ANY', route: OTHER_ROUTE, count: 0, byStatusClass: emptyClasses(), hist: new Histogram() };
        this.routes.set(key, entry);
      } else if (this.routes.size >= MAX_ROUTE_KEYS) {
        key = `ANY ${OTHER_ROUTE}`;
        entry = this.routes.get(key);
      } else {
        entry = { method, route: o.route, count: 0, byStatusClass: emptyClasses(), hist: new Histogram() };
        this.routes.set(key, entry);
      }
    }
    if (!entry) return;
    const cls = statusClass(o.status);
    entry.count += 1;
    entry.byStatusClass[cls] += 1;
    entry.hist.add(o.durationMs);
    this.total += 1;
    this.classes[cls] += 1;
    if (o.status === 401) this.s401 += 1;
    if (o.status === 403) this.s403 += 1;
    if (o.status === 429) this.s429 += 1;
  }

  observeComponent(id: ComponentId, o: { durationMs: number; error: boolean; candidates?: number }): void {
    const c = this.components.get(id);
    if (!c) return;
    c.calls += 1;
    if (o.error) c.errors += 1;
    c.hist.add(o.durationMs);
    if (id === 'similar-v1' && typeof o.candidates === 'number' && Number.isFinite(o.candidates)) {
      c.candidateSum += o.candidates;
      c.candidateCalls += 1;
    }
  }

  snapshot(input: SnapshotInput): TelemetryDto {
    const routes: RouteStatDto[] = [...this.routes.values()]
      .map((r) => ({
        method: r.method,
        route: r.route,
        count: r.count,
        byStatusClass: { ...r.byStatusClass },
        durationBuckets: r.hist.buckets(),
        p50UpperBoundMs: r.hist.upperBound(50),
        p95UpperBoundMs: r.hist.upperBound(95),
      }))
      .sort((a, b) => b.count - a.count || (a.route < b.route ? -1 : a.route > b.route ? 1 : 0) || (a.method < b.method ? -1 : a.method > b.method ? 1 : 0));
    const components: ComponentStatDto[] = COMPONENTS.map((id) => {
      const c = this.components.get(id) ?? { calls: 0, errors: 0, hist: new Histogram(), candidateSum: 0, candidateCalls: 0 };
      return {
        id,
        method: 'fixed_rules' as const,
        learnedModel: false as const,
        enabled: input.flags[id],
        calls: c.calls,
        errors: c.errors,
        durationBuckets: c.hist.buckets(),
        p50UpperBoundMs: c.hist.upperBound(50),
        p95UpperBoundMs: c.hist.upperBound(95),
        avgCandidatesConsidered: id === 'similar-v1' && c.candidateCalls > 0 ? c.candidateSum / c.candidateCalls : null,
      };
    });
    const p = input.parser;
    return {
      scope: 'this_instance_since_start',
      generatedAt: input.now.toISOString(),
      instance: {
        startedAt: input.startedAt.toISOString(),
        uptimeSeconds: Math.max(0, Math.floor((input.now.getTime() - input.startedAt.getTime()) / 1000)),
        version: input.version,
        nodeVersion: input.nodeVersion,
      },
      requests: {
        total: this.total,
        byStatusClass: { ...this.classes },
        unauthenticated401: this.s401,
        forbidden403: this.s403,
        rateLimited429: this.s429,
      },
      routes,
      parser: {
        jobs: p.jobs,
        succeeded: p.succeeded,
        rejected: p.rejected,
        timeouts: p.timeouts,
        memoryKills: p.memoryKills,
        failures: p.failures,
        busyRejections: p.busyRejections,
        avgQueueWaitMs: p.jobs > 0 ? p.queueWaitMs / p.jobs : null,
      },
      components,
    };
  }
}
