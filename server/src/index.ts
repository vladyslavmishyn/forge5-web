import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createPool } from './db.js';
import { createMailer } from './mailer.js';
import { runMigrations } from './migrate.js';

async function main() {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[config] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  for (const w of config.warnings) console.warn(`[config] warning: ${w}`);

  const pool = createPool(config);
  await runMigrations(pool);

  // Built server runs from dist/server/src → SPA is dist/web. Under tsx (dev) use dist/web if built.
  const runningTs = import.meta.url.endsWith('.ts');
  const staticDir = fileURLToPath(new URL(runningTs ? '../../dist/web/' : '../../web/', import.meta.url));
  const serveStatic = existsSync(staticDir);

  const app = createApp({ pool, config, mailer: createMailer(config), staticDir: serveStatic ? staticDir : null });
  const server = app.listen(config.port, () => {
    console.log(
      `[server] listening on :${config.port} (${config.isProduction ? 'production' : 'development'})` +
        (serveStatic ? ', serving SPA' : ', API only'),
    );
  });

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`[server] ${signal} received, shutting down`);
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    server.closeIdleConnections?.();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  const e = err as { code?: string; message?: string };
  console.error(`[server] failed to start: ${e?.code ? e.code + ' ' : ''}${e?.message ?? String(err)}`);
  process.exit(1);
});
