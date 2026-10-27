import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { withTransaction } from '../db/transaction.js';
import type { QueryExecutor } from '../db/types.js';
import { truncateError } from './backoff.js';
import type {
  ClaimDueDeliveriesInput,
  FailDeliveryInput,
  OutboxConsumerKey,
  OutboxDeliveryRecord,
  OutboxDeliveryRepository,
  OutboxDeliveryStatus,
  RetryDeliveryInput
} from './outbox-delivery.repository.js';

interface DeliveryRow extends RowDataPacket {
  id: number;
  event_id: string;
  consumer_key: OutboxConsumerKey;
  status: OutboxDeliveryStatus;
  attempt_count: number;
  next_attempt_at: Date;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  last_error: string | null;
  published_at: Date | null;
  created_at: Date;
}

const DELIVERY_SELECT = `SELECT id, event_id, consumer_key, status, attempt_count, next_attempt_at,
              lease_owner, lease_expires_at, last_error, published_at, created_at
         FROM outbox_delivery`;

export class MysqlOutboxDeliveryRepository implements OutboxDeliveryRepository {
  constructor(private readonly pool: Pool) {}

  async ensurePending(
    eventId: string,
    consumerKey: OutboxConsumerKey,
    executor?: QueryExecutor
  ): Promise<void> {
    await this.executor(executor).execute(
      `INSERT INTO outbox_delivery
        (event_id, consumer_key, status, attempt_count, next_attempt_at, created_at)
       VALUES (?, ?, 'PENDING', 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
       ON DUPLICATE KEY UPDATE event_id = event_id`,
      [eventId, consumerKey]
    );
  }

  async claimDue(input: ClaimDueDeliveriesInput): Promise<OutboxDeliveryRecord[]> {
    const limit = Math.max(1, Math.min(input.limit, 100));
    return withTransaction(this.pool, async (connection) => {
      const [due] = await connection.execute<Array<RowDataPacket & { id: number }>>(
        `SELECT id
           FROM outbox_delivery
          WHERE consumer_key = ?
            AND status = 'PENDING'
            AND next_attempt_at <= UTC_TIMESTAMP(6)
            AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at < UTC_TIMESTAMP(6))
          ORDER BY next_attempt_at ASC, id ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED`,
        [input.consumerKey]
      );
      const ids = due.map((row) => row.id);
      if (ids.length === 0) {
        return [];
      }
      const placeholders = ids.map(() => '?').join(', ');
      await connection.execute(
        `UPDATE outbox_delivery
            SET lease_owner = ?,
                lease_expires_at = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ? MICROSECOND)
          WHERE id IN (${placeholders})`,
        [input.owner, input.leaseMs * 1000, ...ids]
      );
      const [rows] = await connection.execute<DeliveryRow[]>(
        `${DELIVERY_SELECT}
          WHERE id IN (${placeholders})
          ORDER BY next_attempt_at ASC, id ASC`,
        ids
      );
      return rows.map(mapDelivery);
    });
  }

  async markPublished(id: number, leaseOwner: string, executor?: QueryExecutor): Promise<boolean> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE outbox_delivery
          SET status = 'PUBLISHED',
              published_at = UTC_TIMESTAMP(6),
              lease_owner = NULL,
              lease_expires_at = NULL,
              last_error = NULL
        WHERE id = ?
          AND status = 'PENDING'
          AND lease_owner = ?`,
      [id, leaseOwner]
    );
    return result.affectedRows === 1;
  }

  async retry(input: RetryDeliveryInput, executor?: QueryExecutor): Promise<boolean> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE outbox_delivery
          SET next_attempt_at = ?,
              attempt_count = attempt_count + 1,
              last_error = ?,
              lease_owner = NULL,
              lease_expires_at = NULL
        WHERE id = ?
          AND status = 'PENDING'
          AND lease_owner = ?`,
      [input.nextAttemptAt, truncateError(input.errorMessage), input.id, input.leaseOwner]
    );
    return result.affectedRows === 1;
  }

  async fail(input: FailDeliveryInput, executor?: QueryExecutor): Promise<boolean> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE outbox_delivery
          SET status = 'DEAD_LETTER',
              attempt_count = attempt_count + 1,
              last_error = ?,
              lease_owner = NULL,
              lease_expires_at = NULL
        WHERE id = ?
          AND status = 'PENDING'
          AND lease_owner = ?`,
      [truncateError(input.errorMessage), input.id, input.leaseOwner]
    );
    return result.affectedRows === 1;
  }

  async abandonLeases(owner: string, executor?: QueryExecutor): Promise<number> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE outbox_delivery
          SET lease_owner = NULL,
              lease_expires_at = NULL
        WHERE lease_owner = ?
          AND status = 'PENDING'`,
      [owner]
    );
    return result.affectedRows;
  }

  async listByEventId(eventId: string, executor?: QueryExecutor): Promise<OutboxDeliveryRecord[]> {
    const [rows] = await this.executor(executor).execute<DeliveryRow[]>(
      `${DELIVERY_SELECT}
        WHERE event_id = ?
        ORDER BY id`,
      [eventId]
    );
    return rows.map(mapDelivery);
  }

  async redriveDeadLetters(consumerKey?: OutboxConsumerKey, executor?: QueryExecutor): Promise<number> {
    const sql = consumerKey
      ? `UPDATE outbox_delivery
            SET status = 'PENDING',
                attempt_count = 0,
                next_attempt_at = UTC_TIMESTAMP(6),
                last_error = NULL,
                lease_owner = NULL,
                lease_expires_at = NULL,
                published_at = NULL
          WHERE status = 'DEAD_LETTER'
            AND consumer_key = ?`
      : `UPDATE outbox_delivery
            SET status = 'PENDING',
                attempt_count = 0,
                next_attempt_at = UTC_TIMESTAMP(6),
                last_error = NULL,
                lease_owner = NULL,
                lease_expires_at = NULL,
                published_at = NULL
          WHERE status = 'DEAD_LETTER'`;
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      sql,
      consumerKey ? [consumerKey] : []
    );
    return result.affectedRows;
  }

  private executor(executor?: QueryExecutor): QueryExecutor {
    return executor ?? this.pool;
  }
}

function mapDelivery(row: DeliveryRow): OutboxDeliveryRecord {
  return {
    id: Number(row.id),
    eventId: row.event_id,
    consumerKey: row.consumer_key,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    nextAttemptAt: row.next_attempt_at instanceof Date ? row.next_attempt_at : new Date(row.next_attempt_at),
    leaseOwner: row.lease_owner,
    leaseExpiresAt:
      row.lease_expires_at instanceof Date
        ? row.lease_expires_at
        : row.lease_expires_at
          ? new Date(row.lease_expires_at)
          : null,
    lastError: row.last_error,
    publishedAt:
      row.published_at instanceof Date ? row.published_at : row.published_at ? new Date(row.published_at) : null,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at)
  };
}
