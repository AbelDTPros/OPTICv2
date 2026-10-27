import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { QueryExecutor } from '../../../platform/db/types.js';
import { conflict } from '../../../platform/errors/app-error.js';
import type { TrackingIdRecord } from '../domain/types.js';
import type { TrackingRepository } from './tracking.repository.js';

interface TrackingRow extends RowDataPacket {
  tracking_id: string;
  entity_type: string;
  issued_by: string | null;
  issued_at: Date;
}

export class MysqlTrackingRepository implements TrackingRepository {
  constructor(private readonly pool: Pool) {}

  async issue(
    entityType: string,
    trackingId: string,
    issuedBy: string | null,
    executor?: QueryExecutor
  ): Promise<TrackingIdRecord> {
    try {
      await this.client(executor).execute<ResultSetHeader>(
        `INSERT INTO tracking_id_issuance (tracking_id, entity_type, issued_by, issued_at)
         VALUES (?, ?, ?, UTC_TIMESTAMP(6))`,
        [trackingId, entityType, issuedBy]
      );
    } catch (error) {
      if (isDuplicate(error)) {
        throw conflict('OPTIC-WF-40910', `Tracking id ${trackingId} was already issued.`);
      }
      throw error;
    }
    const created = await this.findByTrackingId(trackingId, executor);
    if (!created) {
      throw new Error('Tracking id insert succeeded but row was not readable.');
    }
    return created;
  }

  async findByTrackingId(trackingId: string, executor?: QueryExecutor): Promise<TrackingIdRecord | null> {
    const [rows] = await this.client(executor).execute<TrackingRow[]>(
      `SELECT tracking_id, entity_type, issued_by, issued_at
         FROM tracking_id_issuance
        WHERE tracking_id = ?`,
      [trackingId]
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      trackingId: row.tracking_id,
      entityType: row.entity_type,
      issuedBy: row.issued_by,
      issuedAt: row.issued_at instanceof Date ? row.issued_at : new Date(row.issued_at)
    };
  }

  private client(executor?: QueryExecutor) {
    return executor ?? this.pool;
  }
}

function isDuplicate(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY');
}
