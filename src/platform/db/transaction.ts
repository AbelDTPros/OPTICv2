import type { Pool } from 'mysql2/promise';
import type { TransactionConnection } from './types.js';

export async function withTransaction<T>(
  pool: Pool,
  work: (connection: TransactionConnection) => Promise<T>
): Promise<T> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
