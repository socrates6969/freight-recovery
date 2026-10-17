/**
 * Preloaded into the parse worker with `--import` (A6), BEFORE the worker entry or pdf.js load. Defense
 * in depth under the Node permission model (which in Node 22 does not restrict the network):
 *
 *  - console output is silenced (pdf.js prints warnings with console.log, which would corrupt the
 *    stdout protocol; the worker writes its single response with process.stdout.write);
 *  - fetch/WebSocket/EventSource/XMLHttpRequest globals are removed;
 *  - process.binding and process.dlopen throw (no raw tcp/udp/pipe wraps, no native addons);
 *  - importing or requiring net, dns, http(s), http2, tls, dgram, cluster, child_process,
 *    worker_threads, inspector, repl, vm, readline or perf_hooks throws (module resolution hook plus a
 *    wrapped process.getBuiltinModule).
 *
 *  - connect/listen/bind/open are locked on the socket and native handle prototypes reachable from the
 *    stdio streams (no `new process.stdin.constructor().connect(...)`).
 *
 * This is a BEST-EFFORT in-process guard, not a security boundary: code running in the worker shares
 * the process with it. The real network control is the task network (no NAT; egress only to VPC
 * endpoints); a dedicated no-egress parser task is a launch gate.
 */
import { registerHooks } from 'node:module';

const BLOCKED: ReadonlySet<string> = new Set([
  'net',
  'dns',
  'dns/promises',
  'http',
  'https',
  'http2',
  'tls',
  'dgram',
  'cluster',
  'child_process',
  'worker_threads',
  'inspector',
  'inspector/promises',
  'repl',
  'vm',
  'readline',
  'readline/promises',
  'perf_hooks',
]);

function isBlocked(specifier: string): boolean {
  const id = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
  return BLOCKED.has(id);
}

function blocked(): never {
  throw new Error('blocked in the parse sandbox');
}

const noop = (): undefined => undefined;
for (const m of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table'] as const) {
  (console as unknown as Record<string, unknown>)[m] = noop;
}

const g = globalThis as Record<string, unknown>;
for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) {
  try {
    Reflect.deleteProperty(g, name);
  } catch {
    g[name] = undefined;
  }
}

for (const name of ['binding', '_linkedBinding', 'dlopen']) {
  Object.defineProperty(process, name, { value: blocked, writable: false, configurable: false, enumerable: false });
}

// Fix round 2 (F-01): socket classes stay reachable without any import through the stdio streams
// (`process.stdin` is a net.Socket when stdin is a pipe, so `new process.stdin.constructor().connect()`
// would open TCP), and their native handle classes through `stream._handle.constructor` (Pipe/TTY
// wraps). The stdio streams are materialized first (the worker's own protocol uses them; they are
// already open on inherited fds and never call connect/open again), then every prototype in their
// chains that defines a connecting/binding method is locked to the blocking stub.
const SOCKET_METHODS = ['connect'];
const HANDLE_METHODS = ['connect', 'connect6', 'bind', 'bind6', 'listen', 'open'];
function lockChain(start: unknown, methods: readonly string[]): void {
  for (let proto: unknown = start; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const m of methods) {
      if (Object.prototype.hasOwnProperty.call(proto, m) && typeof (proto as Record<string, unknown>)[m] === 'function') {
        Object.defineProperty(proto, m, { value: blocked, writable: false, configurable: false, enumerable: false });
      }
    }
  }
}
for (const stream of [process.stdin, process.stdout, process.stderr] as unknown[]) {
  lockChain(Object.getPrototypeOf(stream), SOCKET_METHODS);
  const handle = (stream as { _handle?: unknown } | null)?._handle;
  if (handle) lockChain(Object.getPrototypeOf(handle), HANDLE_METHODS);
}

const originalGetBuiltin = process.getBuiltinModule.bind(process);
Object.defineProperty(process, 'getBuiltinModule', {
  value: (id: string) => (isBlocked(id) ? blocked() : originalGetBuiltin(id)),
  writable: false,
  configurable: false,
});

// Synchronous, in-thread hooks (module.registerHooks): cover import() and require() alike.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (isBlocked(specifier)) blocked();
    return nextResolve(specifier, context);
  },
});
