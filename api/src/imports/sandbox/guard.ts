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
 * Production network isolation is the ECS task network (no NAT; egress only to VPC endpoints).
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
