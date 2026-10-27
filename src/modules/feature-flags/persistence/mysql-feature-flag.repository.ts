import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { QueryExecutor } from '../../../platform/db/types.js';
import { conflict } from '../../../platform/errors/app-error.js';
import { FEATURE_FLAG_CATALOG, catalogEntry, type FeatureFlagKey } from '../domain/catalog.js';
import type { FeatureFlagRecord, FeatureFlagUpdateInput } from '../domain/types.js';
import type { FeatureFlagRepository } from './feature-flag.repository.js';

interface FeatureFlagRow extends RowDataPacket {
  flag_key: string;
  enabled: number;
  description: string;
  row_version: number;
  updated_at: Date;
  updated_by: string;
}

export class MysqlFeatureFlagRepository implements FeatureFlagRepository {
  constructor(private readonly pool: Pool) {}

  async listAll(executor?: QueryExecutor): Promise<FeatureFlagRecord[]> {
    const [rows] = await this.client(executor).execute<FeatureFlagRow[]>(
      `SELECT flag_key, enabled, description, row_version, updated_at, updated_by
         FROM feature_flag
        ORDER BY flag_key`
    );
    const byKey = new Map(rows.map((row) => [row.flag_key, row]));
    return FEATURE_FLAG_CATALOG.map((entry) => {
      const row = byKey.get(entry.key);
      if (!row) {
        return {
          key: entry.key,
          label: entry.label,
          enabled: entry.defaultEnabled,
          description: entry.description,
          rowVersion: 1,
          updatedAt: new Date(0),
          updatedBy: 'system',
          group: entry.group
        };
      }
      return mapRow(row);
    });
  }

  async findByKey(key: FeatureFlagKey, executor?: QueryExecutor): Promise<FeatureFlagRecord | null> {
    const [rows] = await this.client(executor).execute<FeatureFlagRow[]>(
      `SELECT flag_key, enabled, description, row_version, updated_at, updated_by
         FROM feature_flag
        WHERE flag_key = ?`,
      [key]
    );
    const row = rows[0];
    if (!row) {
      const entry = catalogEntry(key);
      return {
        key: entry.key,
        label: entry.label,
        enabled: entry.defaultEnabled,
        description: entry.description,
        rowVersion: 1,
        updatedAt: new Date(0),
        updatedBy: 'system',
        group: entry.group
      };
    }
    return mapRow(row);
  }

  async upsert(input: FeatureFlagUpdateInput, executor?: QueryExecutor): Promise<FeatureFlagRecord> {
    const entry = catalogEntry(input.key);
    const client = this.client(executor);
    const [existingRows] = await client.execute<FeatureFlagRow[]>(
      `SELECT flag_key, enabled, description, row_version, updated_at, updated_by
         FROM feature_flag
        WHERE flag_key = ?`,
      [input.key]
    );
    const existing = existingRows[0];
    if (!existing) {
      if (input.expectedRowVersion !== 1) {
        throw conflict(
          'OPTIC-FEATURE-40901',
          `Feature flag ${input.key} was updated by another request.`,
          [{ field: 'expectedRowVersion', path: 'expectedRowVersion', message: 'Row version mismatch.' }]
        );
      }
      await client.execute<ResultSetHeader>(
        `INSERT INTO feature_flag (flag_key, enabled, description, row_version, updated_at, updated_by)
         VALUES (?, ?, ?, 2, UTC_TIMESTAMP(6), ?)`,
        [input.key, input.enabled ? 1 : 0, entry.description, input.actorId]
      );
    } else {
      if (existing.row_version !== input.expectedRowVersion) {
        throw conflict(
          'OPTIC-FEATURE-40901',
          `Feature flag ${input.key} was updated by another request.`,
          [{ field: 'expectedRowVersion', path: 'expectedRowVersion', message: 'Row version mismatch.' }]
        );
      }
      const [result] = await client.execute<ResultSetHeader>(
        `UPDATE feature_flag
            SET enabled = ?,
                description = ?,
                row_version = row_version + 1,
                updated_at = UTC_TIMESTAMP(6),
                updated_by = ?
          WHERE flag_key = ?
            AND row_version = ?`,
        [input.enabled ? 1 : 0, entry.description, input.actorId, input.key, input.expectedRowVersion]
      );
      if (result.affectedRows !== 1) {
        throw conflict(
          'OPTIC-FEATURE-40901',
          `Feature flag ${input.key} was updated by another request.`,
          [{ field: 'expectedRowVersion', path: 'expectedRowVersion', message: 'Row version mismatch.' }]
        );
      }
    }
    const updated = await this.findByKey(input.key, executor);
    if (!updated) {
      throw new Error(`Feature flag ${input.key} upsert succeeded but row was not readable.`);
    }
    return updated;
  }

  private client(executor?: QueryExecutor): QueryExecutor | Pool {
    return executor ?? this.pool;
  }
}

function mapRow(row: FeatureFlagRow): FeatureFlagRecord {
  const entry = catalogEntry(row.flag_key as FeatureFlagKey);
  return {
    key: entry.key,
    label: entry.label,
    enabled: row.enabled === 1,
    description: entry.description,
    rowVersion: row.row_version,
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
    updatedBy: row.updated_by,
    group: entry.group
  };
}
