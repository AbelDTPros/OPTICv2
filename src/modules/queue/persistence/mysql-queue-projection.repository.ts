import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { QueryExecutor } from '../../../platform/db/types.js';
import { queueOrderSql, queueWhereSql } from '../domain/query.js';
import type { SqlParam } from '../domain/eligibility.js';
import type { QueueProjectionRecord, QueueQuery, QueueQueryResult } from '../domain/types.js';
import type { ProjectionSearchQuery } from '../../search/domain/types.js';
import type { QueueProjectionRepository } from './queue-projection.repository.js';

interface ProjectionRow extends RowDataPacket {
  workflow_instance_id: number;
  entity_type: string;
  entity_tracking_id: string;
  definition_key: string;
  definition_release_id: number;
  workload_type: string | null;
  current_stage_key: string;
  assigned_to: string | null;
  branch_key: string | null;
  location_key: string | null;
  priority: string | null;
  received_at: Date | null;
  entered_stage_at: Date;
  sla_state: string | null;
  receipt_number: string | null;
  status: string;
  row_version: number;
  projected_json: unknown;
  updated_at: Date;
}

interface CountRow extends RowDataPacket {
  total: number;
}

export class MysqlQueueProjectionRepository implements QueueProjectionRepository {
  constructor(private readonly pool: Pool) {}

  async upsert(record: QueueProjectionRecord, executor?: QueryExecutor): Promise<void> {
    await this.executor(executor).execute<ResultSetHeader>(
      `INSERT INTO workflow_queue_projection
        (workflow_instance_id, entity_type, entity_tracking_id, definition_key, definition_release_id,
         workload_type, current_stage_key, assigned_to, branch_key, location_key, priority, received_at,
         entered_stage_at, sla_state, receipt_number, status, row_version, projected_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), UTC_TIMESTAMP(6))
       ON DUPLICATE KEY UPDATE
         entity_type = VALUES(entity_type),
         entity_tracking_id = VALUES(entity_tracking_id),
         definition_key = VALUES(definition_key),
         definition_release_id = VALUES(definition_release_id),
         workload_type = VALUES(workload_type),
         current_stage_key = VALUES(current_stage_key),
         assigned_to = VALUES(assigned_to),
         branch_key = VALUES(branch_key),
         location_key = VALUES(location_key),
         priority = VALUES(priority),
         received_at = VALUES(received_at),
         entered_stage_at = VALUES(entered_stage_at),
         sla_state = VALUES(sla_state),
         receipt_number = VALUES(receipt_number),
         status = VALUES(status),
         row_version = VALUES(row_version),
         projected_json = VALUES(projected_json),
         updated_at = UTC_TIMESTAMP(6)`,
      [
        record.workflowInstanceId,
        record.entityType,
        record.entityTrackingId,
        record.definitionKey,
        record.definitionReleaseId,
        record.workloadType,
        record.currentStageKey,
        record.assignedTo,
        record.branchKey,
        record.locationKey,
        record.priority,
        record.receivedAt,
        record.enteredStageAt,
        record.slaState,
        record.receiptNumber,
        record.status,
        record.rowVersion,
        JSON.stringify(record.projectedJson ?? {})
      ]
    );
  }

  async listByDefinitionKeys(
    definitionKeys: string[],
    executor?: QueryExecutor
  ): Promise<QueueProjectionRecord[]> {
    const keys = [...new Set(definitionKeys.map((key) => key.trim()).filter(Boolean))];
    if (keys.length === 0) {
      return [];
    }
    const placeholders = keys.map(() => '?').join(', ');
    const [rows] = await this.executor(executor).execute<ProjectionRow[]>(
      `${selectSql()} WHERE definition_key IN (${placeholders})`,
      keys
    );
    return rows.map(mapRow);
  }

  async deleteByReleaseId(definitionReleaseId: number, executor?: QueryExecutor): Promise<number> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `DELETE FROM workflow_queue_projection WHERE definition_release_id = ?`,
      [definitionReleaseId]
    );
    return result.affectedRows;
  }

  async findByInstanceId(
    workflowInstanceId: number,
    executor?: QueryExecutor
  ): Promise<QueueProjectionRecord | null> {
    const [rows] = await this.executor(executor).execute<ProjectionRow[]>(
      `${selectSql()} WHERE workflow_instance_id = ?`,
      [workflowInstanceId]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async findByEntity(
    entityType: string,
    entityTrackingId: string,
    executor?: QueryExecutor
  ): Promise<QueueProjectionRecord | null> {
    const [rows] = await this.executor(executor).execute<ProjectionRow[]>(
      `${selectSql()} WHERE entity_type = ? AND entity_tracking_id = ?`,
      [entityType, entityTrackingId]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async query(query: QueueQuery, executor?: QueryExecutor): Promise<QueueQueryResult> {
    const where = queueWhereSql(query);
    const order = queueOrderSql(query.sort);
    const pageSize = Math.max(0, Math.trunc(query.pageSize));
    const offset = Math.max(0, Math.trunc((query.page - 1) * query.pageSize));
    const [countRows] = await this.executor(executor).execute<CountRow[]>(
      `SELECT COUNT(*) AS total FROM workflow_queue_projection p WHERE ${where.sql}`,
      where.params
    );
    const [rows] = await this.executor(executor).execute<ProjectionRow[]>(
      `${selectSql('p')} WHERE ${where.sql} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`,
      where.params
    );
    return {
      total: Number(countRows[0]?.total ?? 0),
      rows: rows.map(mapRow)
    };
  }

  async search(query: ProjectionSearchQuery, executor?: QueryExecutor): Promise<QueueQueryResult> {
    const clauses: string[] = ['1=1'];
    const params: SqlParam[] = [];
    if (query.entityType) {
      clauses.push('entity_type = ?');
      params.push(query.entityType);
    }
    if (query.definitionKey) {
      clauses.push('definition_key = ?');
      params.push(query.definitionKey);
    }
    if (query.currentStageKey) {
      clauses.push('current_stage_key = ?');
      params.push(query.currentStageKey);
    }
    if (query.assignedTo) {
      clauses.push('assigned_to = ?');
      params.push(query.assignedTo);
    }
    const trackingNeedle = query.q?.trim();
    if (trackingNeedle) {
      clauses.push(`entity_tracking_id LIKE ? ESCAPE '!'`);
      params.push(sqlLikeContains(trackingNeedle));
    }
    const receiptNeedle = query.receiptNumber?.trim();
    if (receiptNeedle) {
      clauses.push(`receipt_number LIKE ? ESCAPE '!'`);
      params.push(sqlLikePrefix(receiptNeedle));
    }
    const where = clauses.join(' AND ');
    const pageSize = Math.max(0, Math.trunc(query.pageSize));
    const offset = Math.max(0, Math.trunc((query.page - 1) * query.pageSize));
    const [countRows] = await this.executor(executor).execute<CountRow[]>(
      `SELECT COUNT(*) AS total FROM workflow_queue_projection WHERE ${where}`,
      params
    );
    const [rows] = await this.executor(executor).execute<ProjectionRow[]>(
      `${selectSql()} WHERE ${where} ORDER BY updated_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    return {
      total: Number(countRows[0]?.total ?? 0),
      rows: rows.map(mapRow)
    };
  }

  private executor(executor?: QueryExecutor): QueryExecutor {
    return executor ?? this.pool;
  }
}

function selectSql(alias?: string): string {
  const prefix = alias ? `${alias}.` : '';
  const from = alias ? ` FROM workflow_queue_projection ${alias}` : ' FROM workflow_queue_projection';
  return `SELECT ${prefix}workflow_instance_id, ${prefix}entity_type, ${prefix}entity_tracking_id,
              ${prefix}definition_key, ${prefix}definition_release_id, ${prefix}workload_type,
              ${prefix}current_stage_key, ${prefix}assigned_to, ${prefix}branch_key, ${prefix}location_key,
              ${prefix}priority, ${prefix}received_at, ${prefix}entered_stage_at, ${prefix}sla_state,
              ${prefix}receipt_number, ${prefix}status, ${prefix}row_version, ${prefix}projected_json,
              ${prefix}updated_at${from}`;
}

function mapRow(row: ProjectionRow): QueueProjectionRecord {
  return {
    workflowInstanceId: Number(row.workflow_instance_id),
    entityType: row.entity_type,
    entityTrackingId: row.entity_tracking_id,
    definitionKey: row.definition_key,
    definitionReleaseId: Number(row.definition_release_id),
    workloadType: row.workload_type,
    currentStageKey: row.current_stage_key,
    assignedTo: row.assigned_to,
    branchKey: row.branch_key,
    locationKey: row.location_key,
    priority: row.priority,
    receivedAt: row.received_at ? toDate(row.received_at) : null,
    enteredStageAt: toDate(row.entered_stage_at),
    slaState: row.sla_state,
    receiptNumber: row.receipt_number,
    status: row.status,
    rowVersion: Number(row.row_version),
    projectedJson: asObject(row.projected_json),
    updatedAt: toDate(row.updated_at)
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value == null) {
    return null;
  }
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return null;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function sqlLikeContains(needle: string): string {
  return `%${escapeLike(needle)}%`;
}

function sqlLikePrefix(needle: string): string {
  return `${escapeLike(needle)}%`;
}

function escapeLike(needle: string): string {
  return needle.replace(/[!%_]/g, (char) => `!${char}`);
}
