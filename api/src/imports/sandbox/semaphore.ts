/**
 * Counting semaphore with a bounded wait (parse slots, A6) and a per-key counter gate (per-tenant
 * upload/export concurrency, A3). Both are per process (per API instance); distributed enforcement is
 * future work (D-9).
 */

export class SlotTimeoutError extends Error {
  constructor() {
    super('no free slot');
    this.name = 'SlotTimeoutError';
  }
}

interface Waiter {
  resolve: () => void;
  timer: NodeJS.Timeout | null;
}

export class Semaphore {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be a positive integer');
  }

  get inUse(): number {
    return this.active;
  }

  get waiting(): number {
    return this.waiters.length;
  }

  /** Wait at most `timeoutMs` for a slot; resolves to a release function (call it exactly once). */
  acquire(timeoutMs: number): Promise<() => void> {
    const release = this.releaser();
    if (this.active < this.capacity) {
      this.active += 1;
      return Promise.resolve(release);
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve: () => {
          if (waiter.timer) clearTimeout(waiter.timer);
          resolve(release);
        },
        timer: null,
      };
      waiter.timer = setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i !== -1) this.waiters.splice(i, 1);
        reject(new SlotTimeoutError());
      }, Math.max(0, timeoutMs));
      this.waiters.push(waiter);
    });
  }

  private releaser(): () => void {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = this.waiters.shift();
      if (next) next.resolve();
      else this.active -= 1;
    };
  }
}

/** Per-key concurrency gate: `tryEnter` fails immediately when the key is at its limit. */
export class KeyedGate {
  private readonly counts = new Map<string, number>();

  constructor(private readonly limit: number) {}

  /** A release function, or null when the key already has `limit` holders. */
  tryEnter(key: string): (() => void) | null {
    const n = this.counts.get(key) ?? 0;
    if (n >= this.limit) return null;
    this.counts.set(key, n + 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const c = (this.counts.get(key) ?? 1) - 1;
      if (c <= 0) this.counts.delete(key);
      else this.counts.set(key, c);
    };
  }

  holders(key: string): number {
    return this.counts.get(key) ?? 0;
  }
}
