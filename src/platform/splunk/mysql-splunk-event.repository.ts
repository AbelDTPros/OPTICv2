import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { QueryExecutor } from '../db/types.js';
import type { AppendSplunkEventInput, SplunkEventRecord, SplunkEventRepository } from './splunk-event.repository.js';

interface SplunkRow extends RowDataPacket {
  id: number;
  event_id: string;
  event_type: string;
  occurred_at: Date;
  correlation_id: string;
  payload_json: unknown;
  created_at: Date;
}

const SPLUNK_SELECT = `SELECT id, event_id, event_type, occurred_at, correlation_id, payload_json, created_at
         FROM splunk_event`;

export class MysqlSplunkEventRepository implements SplunkEventRepository {
  constructor(private readonly pool: Pool) {}

  async append(input: AppendSplunkEventInput, executor?: QueryExecutor): Promise<SplunkEventRecord> {
    const existing = await this.findByEventId(input.eventId, executor);
    if (existing) {
      return existing;
    }
    try {
      await this.executor(executor).execute<ResultSetHeader>(
        `INSERT INTO splunk_event
          (event_id, event_type, occurred_at, correlation_id, payload_json, created_at)
         VALUES (?, ?, ?, ?, CAST(? AS JSON), UTC_TIMESTAMP(6))`,
        [
          input.eventId,
          input.eventType,
          toMysqlDate(input.occurredAt),
          input.correlationId,
          JSON.stringify(input.payload)
        ]
      );
    } catch (error: unknown) {
      if (isDuplicate(error)) {
        const duplicate = await this.findByEventId(input.eventId, executor);
        if (duplicate) {
          return duplicate;
        }
      }
      throw error;
    }
    const inserted = await this.findByEventId(input.eventId, executor);
    if (!inserted) {
      throw new Error('Splunk insert succeeded but row was not readable.');
    }
    return inserted;
  }

  async findByEventId(eventId: string, executor?: QueryExecutor): Promise<SplunkEventRecord | null> {
    const [rows] = await this.executor(executor).execute<SplunkRow[]>(
      `${SPLUNK_SELECT}
        WHERE event_id = ?`,
      [eventId]
    );
    return rows[0] ? mapSplunk(rows[0]) : null;
  }

  async listByCorrelationId(correlationId: string, executor?: QueryExecutor): Promise<SplunkEventRecord[]> {
    const [rows] = await this.executor(executor).execute<SplunkRow[]>(
      `${SPLUNK_SELECT}
        WHERE correlation_id = ?
        ORDER BY id`,
      [correlationId]
    );
    return rows.map(mapSplunk);
  }

  private executor(executor?: QueryExecutor): QueryExecutor {
    return executor ?? this.pool;
  }
}

function mapSplunk(row: SplunkRow): SplunkEventRecord {
  return {
    id: Number(row.id),
    eventId: row.event_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at : new Date(row.occurred_at),
    correlationId: row.correlation_id,
    payload: parseJsonObject(row.payload_json),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at)
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

function toMysqlDate(value: Date): string {
  return value.toISOString().slice(0, 23).replace('T', ' ');
}

function isDuplicate(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ER_DUP_ENTRY'
  );
}
