import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { QueryExecutor } from '../db/types.js';
import { conflict } from '../errors/app-error.js';
import type { IdempotencyRecord, IdempotencyRepository } from './idempotency.repository.js';

interface IdempotencyRow extends RowDataPacket {
  actor_id: string;
  operation: string;
  idempotency_key: string;
  request_hash: string;
  response_json: unknown;
}

export class MysqlIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly pool: Pool) {}

  async find(
    actorId: string,
    operation: string,
    idempotencyKey: string,
    executor?: QueryExecutor
  ): Promise<IdempotencyRecord | null> {
    const [rows] = await this.executor(executor).execute<IdempotencyRow[]>(
      `SELECT actor_id, operation, idempotency_key, request_hash, response_json
         FROM idempotency_record
        WHERE actor_id = ? AND operation = ? AND idempotency_key = ?`,
      [actorId, operation, idempotencyKey]
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      actorId: row.actor_id,
      operation: row.operation,
      idempotencyKey: row.idempotency_key,
      requestHash: row.request_hash,
      response: asJson(row.response_json)
    };
  }

  async save(record: IdempotencyRecord, executor?: QueryExecutor): Promise<void> {
    try {
      await this.executor(executor).execute<ResultSetHeader>(
        `INSERT INTO idempotency_record
          (actor_id, operation, idempotency_key, request_hash, response_json, created_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`,
        [
          record.actorId,
          record.operation,
          record.idempotencyKey,
          record.requestHash,
          JSON.stringify(record.response)
        ]
      );
    } catch (error) {
      if (!isDuplicate(error)) {
        throw error;
      }
      const existing = await this.find(record.actorId, record.operation, record.idempotencyKey, executor);
      if (existing && existing.requestHash === record.requestHash) {
        return;
      }
      throw conflict(
        'OPTIC-WF-40906',
        'This request was already processed with a different body. Use a new idempotency key.'
      );
    }
  }

  private executor(executor?: QueryExecutor): QueryExecutor {
    return executor ?? this.pool;
  }
}

function asJson(value: unknown): unknown {
  if (typeof value === 'string') {
    return JSON.parse(value) as unknown;
  }
  return value;
}

function isDuplicate(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY');
}
