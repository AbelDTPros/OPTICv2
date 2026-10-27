import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { withTransaction } from '../db/transaction.js';
import type { QueryExecutor } from '../db/types.js';
import { truncateError } from './backoff.js';
import type {
  AppendOutboxEventInput,
  OutboxEventRecord,
  OutboxPublishStatus,
  OutboxRepository
} from './outbox.repository.js';

interface OutboxRow extends RowDataPacket {
  event_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  event_version: number;
  occurred_at: Date;
  correlation_id: string;
  session_id: string | null;
  actor_id: string | null;
  payload_json: unknown;
  publish_status: OutboxPublishStatus;
  publish_attempts: number;
  published_at: Date | null;
  last_error: string | null;
}

const OUTBOX_SELECT = `SELECT event_id, aggregate_type, aggregate_id, event_type, event_version, occurred_at,
              correlation_id, session_id, actor_id, payload_json, publish_status, publish_attempts,
              published_at, last_error
         FROM outbox_event`;

export class MysqlOutboxRepository implements OutboxRepository {
  constructor(private readonly pool: Pool) {}

  async append(input: AppendOutboxEventInput, executor?: QueryExecutor): Promise<OutboxEventRecord> {
    await this.executor(executor).execute<ResultSetHeader>(
      `INSERT INTO outbox_event
        (event_id, aggregate_type, aggregate_id, event_type, event_version, occurred_at,
         correlation_id, session_id, actor_id, payload_json, publish_status, publish_attempts)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?, ?, ?, CAST(? AS JSON), 'PENDING', 0)`,
      [
        input.eventId,
        input.aggregateType,
        input.aggregateId,
        input.eventType,
        input.eventVersion ?? 1,
        input.correlationId,
        input.sessionId ?? null,
        input.actorId ?? null,
        JSON.stringify(input.payload)
      ]
    );
    const event = await this.findByEventId(input.eventId, executor);
    if (!event) {
      throw new Error('Outbox insert succeeded but row was not readable.');
    }
    return event;
  }

  async listByAggregate(
    aggregateType: string,
    aggregateId: string,
    executor?: QueryExecutor
  ): Promise<OutboxEventRecord[]> {
    const [rows] = await this.executor(executor).execute<OutboxRow[]>(
      `${OUTBOX_SELECT}
        WHERE aggregate_type = ? AND aggregate_id = ?
        ORDER BY id`,
      [aggregateType, aggregateId]
    );
    return rows.map(mapOutbox);
  }

  async findByEventId(eventId: string, executor?: QueryExecutor): Promise<OutboxEventRecord | null> {
    const [rows] = await this.executor(executor).execute<OutboxRow[]>(
      `${OUTBOX_SELECT}
        WHERE event_id = ?`,
      [eventId]
    );
    return rows[0] ? mapOutbox(rows[0]) : null;
  }

  async withWriteLock<T>(work: (executor?: QueryExecutor) => Promise<T>): Promise<T> {
    return withTransaction(this.pool, (connection) => work(connection));
  }

  async claimPending(limit: number, executor?: QueryExecutor): Promise<OutboxEventRecord[]> {
    const bounded = Math.max(1, Math.min(limit, 100));
    const [due] = await this.executor(executor).execute<Array<RowDataPacket & { event_id: string }>>(
      `SELECT event_id
         FROM outbox_event
        WHERE publish_status = 'PENDING'
        ORDER BY id ASC
        LIMIT ${bounded}
        FOR UPDATE SKIP LOCKED`
    );
    const ids = due.map((row) => row.event_id);
    if (ids.length === 0) {
      return [];
    }
    const placeholders = ids.map(() => '?').join(', ');
    const [rows] = await this.executor(executor).execute<OutboxRow[]>(
      `${OUTBOX_SELECT}
        WHERE event_id IN (${placeholders})
        ORDER BY id ASC`,
      ids
    );
    return rows.map(mapOutbox);
  }

  async markPublished(eventId: string, executor?: QueryExecutor): Promise<void> {
    await this.executor(executor).execute(
      `UPDATE outbox_event
          SET publish_status = 'PUBLISHED',
              published_at = UTC_TIMESTAMP(6),
              last_error = NULL
        WHERE event_id = ?`,
      [eventId]
    );
  }

  async markPublishFailed(
    eventId: string,
    errorMessage: string,
    maxAttempts: number,
    executor?: QueryExecutor
  ): Promise<'RETRIED' | 'DEAD_LETTER'> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE outbox_event
          SET last_error = ?,
              publish_status = IF(publish_attempts + 1 >= ?, 'DEAD_LETTER', 'PENDING'),
              publish_attempts = publish_attempts + 1
        WHERE event_id = ?`,
      [truncateError(errorMessage), maxAttempts, eventId]
    );
    if (result.affectedRows !== 1) {
      return 'RETRIED';
    }
    const event = await this.findByEventId(eventId, executor);
    return event?.publishStatus === 'DEAD_LETTER' ? 'DEAD_LETTER' : 'RETRIED';
  }

  async redriveDeadLetters(executor?: QueryExecutor): Promise<number> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE outbox_event
          SET publish_status = 'PENDING',
              publish_attempts = 0,
              last_error = NULL,
              published_at = NULL
        WHERE publish_status = 'DEAD_LETTER'`
    );
    return result.affectedRows;
  }

  private executor(executor?: QueryExecutor): QueryExecutor {
    return executor ?? this.pool;
  }
}

function mapOutbox(row: OutboxRow): OutboxEventRecord {
  return {
    eventId: row.event_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    eventVersion: Number(row.event_version),
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at : new Date(row.occurred_at),
    correlationId: row.correlation_id,
    sessionId: row.session_id,
    actorId: row.actor_id,
    payload: parseJsonObject(row.payload_json),
    publishStatus: row.publish_status,
    publishAttempts: Number(row.publish_attempts ?? 0),
    publishedAt: row.published_at instanceof Date ? row.published_at : row.published_at ? new Date(row.published_at) : null,
    lastError: row.last_error
  };
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
