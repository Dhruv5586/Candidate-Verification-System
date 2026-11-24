import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import { env } from './env';

// Pool configuration
const poolConfig: PoolConfig = {
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

export const pool = new Pool(poolConfig);

// Handle idle connection errors
pool.on('error', (err) => {
  console.error('[DATABASE ERROR] Unexpected error on idle PostgreSQL client:', err);
});

/**
 * Executes a parameterized SQL query using the connection pool.
 */
export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const res = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    if (env.NODE_ENV === 'development' && duration > 100) {
      console.warn(`[SLOW QUERY] ${duration}ms: ${text.slice(0, 80)}...`);
    }
    return res;
  } catch (err) {
    console.error(`[QUERY ERROR] Failed executing SQL: ${text.slice(0, 80)}`, err);
    throw err;
  }
}

/**
 * Checks PostgreSQL connectivity.
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT 1 AS connected;');
    return result.rows.length > 0 && result.rows[0].connected === 1;
  } catch (error) {
    return false;
  }
}

/**
 * Gracefully drains and closes the PostgreSQL pool.
 */
export async function closeDatabasePool(): Promise<void> {
  try {
    await pool.end();
  } catch (error) {
    console.error('[DATABASE CLOSE ERROR] Error draining PostgreSQL pool:', error);
  }
}
