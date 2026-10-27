import type { Pool, PoolConnection } from 'mysql2/promise';

export type QueryExecutor = Pool | PoolConnection;
export type TransactionConnection = PoolConnection;
