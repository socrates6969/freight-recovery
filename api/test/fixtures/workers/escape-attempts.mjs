// Hostile parse-worker fixture: tries every escape route a compromised parser would try, and reports
// what happened as one JSON line on stdout. Input (stdin): {"port": <local test listener>,
// "dotenv": <absolute path of a secret file>}. Every attempt is expected to be denied.
import { createRequire } from 'node:module';

const results = {};
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));

async function attempt(name, fn) {
  try {
    const r = await fn();
    results[name] = r === undefined ? 'allowed' : `allowed:${String(r).slice(0, 40)}`;
  } catch (e) {
    results[name] = `denied:${e && e.code ? e.code : 'error'}`;
  }
}

const withTimeout = (p, ms = 1500) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), ms))]);

results.env = Object.keys(process.env).sort();
await attempt('readEtcPasswd', async () => (await import('node:fs')).readFileSync('/etc/passwd', 'utf8').length);
await attempt('readDotenv', async () => (await import('node:fs')).readFileSync(input.dotenv, 'utf8').length);
await attempt('writeTmp', async () => (await import('node:fs')).writeFileSync('owned.txt', 'x'));
await attempt('importChildProcess', async () => (await import('node:child_process')).spawnSync(process.execPath, ['-e', '1']).status);
await attempt('getBuiltinChildProcess', async () => process.getBuiltinModule('child_process').spawnSync(process.execPath, ['-e', '1']).status);
await attempt('requireChildProcess', async () => createRequire(import.meta.url)('child_process').spawnSync(process.execPath, ['-e', '1']).status);
await attempt('importNet', async () => {
  const net = await import('node:net');
  await withTimeout(new Promise((res, rej) => net.connect(input.port, '127.0.0.1', res).on('error', rej)));
});
await attempt('getBuiltinNet', async () => {
  const net = process.getBuiltinModule('net');
  await withTimeout(new Promise((res, rej) => net.connect(input.port, '127.0.0.1', res).on('error', rej)));
});
await attempt('requireHttp', async () => {
  const http = createRequire(import.meta.url)('http');
  await withTimeout(new Promise((res, rej) => http.get(`http://127.0.0.1:${input.port}/`, res).on('error', rej)));
});
await attempt('fetch', async () => withTimeout(globalThis.fetch(`http://127.0.0.1:${input.port}/`)));
await attempt('dns', async () => (await import('node:dns')).promises.lookup('localhost'));
await attempt('dgram', async () => (await import('node:dgram')).createSocket('udp4').send('x', input.port, '127.0.0.1'));
await attempt('tcpWrap', async () => process.binding('tcp_wrap'));
await attempt('dlopen', async () => process.dlopen({ exports: {} }, 'evil.node'));
await attempt('workerThreads', async () => new (await import('node:worker_threads')).Worker('1', { eval: true }));
await attempt('vm', async () => (await import('node:vm')).runInNewContext('1+1'));
await attempt('evalString', async () => eval('1+1'));
await attempt('newFunction', async () => new Function('return 1')());
await attempt('webSocket', async () => new globalThis.WebSocket(`ws://127.0.0.1:${input.port}/`));

process.stdout.write(JSON.stringify(results));
