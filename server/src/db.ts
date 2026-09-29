import pg from 'pg';
import type { Config } from './config.js';

// bigint (int8) -> number. Ids and counts in this app stay far below 2^53.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export function createPool(config: Pick<Config, 'databaseUrl' | 'databaseSsl'>): pg.Pool {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    statement_timeout: 5000,
    idle_in_transaction_session_timeout: 10000,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', (err) => {
    // Idle client errors (e.g. DB restarted). Log without connection details.
    console.error('[db] idle client error:', (err as { code?: string }).code ?? err.message);
  });
  return pool;
}

/** Run fn inside a transaction; commits on success, rolls back on any error. */
export async function withTx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection may be broken; release below discards it */
    }
    throw err;
  } finally {
    client.release();
  }
}
