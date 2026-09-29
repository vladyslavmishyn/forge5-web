import { ConfigError, loadConfig } from './config.js';
import { createPool } from './db.js';
import { runMigrations } from './migrate.js';

try {
  const config = loadConfig(process.env);
  const pool = createPool(config);
  try {
    const applied = await runMigrations(pool);
    console.log(applied.length ? `[migrate] ${applied.length} migration(s) applied` : '[migrate] up to date');
  } finally {
    await pool.end();
  }
} catch (err) {
  console.error(err instanceof ConfigError ? `[config] ${err.message}` : `[migrate] ${(err as Error).message}`);
  process.exit(1);
}
