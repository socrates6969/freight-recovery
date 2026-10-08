/** Process entry point: build, listen, graceful shutdown on SIGTERM/SIGINT. */
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';

async function main(): Promise<void> {
  let cfg;
  try {
    cfg = loadConfig(process.env);
  } catch (e) {
    // ConfigError messages name keys only, never values.
    process.stderr.write(`${e instanceof ConfigError ? e.message : 'Invalid configuration'}\n`);
    process.exit(1);
  }
  const app = await buildApp();
  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  await app.listen({ port: cfg.port, host: cfg.host });
}

main().catch(() => {
  process.stderr.write('fatal: failed to start\n');
  process.exit(1);
});
