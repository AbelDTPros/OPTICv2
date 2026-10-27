import mysql, { type Pool } from 'mysql2/promise';
import type { AppConfig } from '../../config/env.js';

let pool: Pool | undefined;

export function createPool(config: AppConfig['database']): Pool {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: false,
    timezone: 'Z',
    dateStrings: false
  });
}

export function getPool(config: AppConfig['database']): Pool {
  if (!pool) {
    pool = createPool(config);
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

export async function pingDatabase(config: AppConfig['database']): Promise<void> {
  const activePool = getPool(config);
  const connection = await activePool.getConnection();
  try {
    await connection.ping();
  } finally {
    connection.release();
  }
}
