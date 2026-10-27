import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { QueryExecutor } from '../../../platform/db/types.js';
import type {
  BulkItemStatus,
  BulkOperationItemRecord,
  BulkOperationRecord,
  BulkOperationStatus,
  BulkTransactionMode,
  CompleteBulkItemInput,
  CompleteBulkOperationInput,
  CreateBulkOperationInput,
  CreateBulkOperationItemInput
} from '../domain/types.js';
import type { BulkOperationRepository } from './bulk-operation.repository.js';

export class MysqlBulkOperationRepository implements BulkOperationRepository {
  constructor(private readonly pool: Pool) {}

  async createOperation(input: CreateBulkOperationInput, executor?: QueryExecutor): Promise<BulkOperationRecord> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `INSERT INTO bulk_operation (
         bulk_action_key, definition_release_id, initiated_by, session_id, correlation_id,
         transaction_mode, input_json, status, total_items, successful_items, failed_items, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, 0, 0, UTC_TIMESTAMP(6))`,
      [
        input.bulkActionKey,
        input.definitionReleaseId,
        input.initiatedBy,
        input.sessionId,
        input.correlationId,
        input.transactionMode,
        JSON.stringify(input.input),
        input.totalItems
      ]
    );
    const created = await this.findById(result.insertId, executor);
    if (!created) {
      throw new Error('Failed to persist bulk_operation.');
    }
    return created;
  }

  async createItem(
    input: CreateBulkOperationItemInput,
    executor?: QueryExecutor
  ): Promise<BulkOperationItemRecord> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `INSERT INTO bulk_operation_item (
         bulk_operation_id, workflow_instance_id, entity_tracking_id, status
       ) VALUES (?, ?, ?, 'PENDING')`,
      [input.bulkOperationId, input.workflowInstanceId, input.entityTrackingId]
    );
    const items = await this.listItems(input.bulkOperationId, executor);
    const created = items.find((item) => item.id === result.insertId);
    if (!created) {
      throw new Error('Failed to persist bulk_operation_item.');
    }
    return created;
  }

  async completeItem(input: CompleteBulkItemInput, executor?: QueryExecutor): Promise<BulkOperationItemRecord> {
    await this.executor(executor).execute(
      `UPDATE bulk_operation_item
       SET status = ?, error_code = ?, error_message = ?, completed_at = UTC_TIMESTAMP(6)
       WHERE id = ?`,
      [input.status, input.errorCode ?? null, input.errorMessage ?? null, input.itemId]
    );
    const [rows] = await this.executor(executor).query<RowDataPacket[]>(
      'SELECT * FROM bulk_operation_item WHERE id = ?',
      [input.itemId]
    );
    const row = rows[0];
    if (!row) {
      throw new Error(`Bulk item ${input.itemId} was not found.`);
    }
    return mapItem(row);
  }

  async completeOperation(
    input: CompleteBulkOperationInput,
    executor?: QueryExecutor
  ): Promise<BulkOperationRecord> {
    await this.executor(executor).execute(
      `UPDATE bulk_operation
       SET status = ?, successful_items = ?, failed_items = ?, completed_at = UTC_TIMESTAMP(6)
       WHERE id = ?`,
      [input.status, input.successfulItems, input.failedItems, input.operationId]
    );
    const completed = await this.findById(input.operationId, executor);
    if (!completed) {
      throw new Error(`Bulk operation ${input.operationId} was not found.`);
    }
    return completed;
  }

  async findById(id: number, executor?: QueryExecutor): Promise<BulkOperationRecord | null> {
    const [rows] = await this.executor(executor).query<RowDataPacket[]>(
      'SELECT * FROM bulk_operation WHERE id = ?',
      [id]
    );
    return rows[0] ? mapOperation(rows[0]) : null;
  }

  async listItems(operationId: number, executor?: QueryExecutor): Promise<BulkOperationItemRecord[]> {
    const [rows] = await this.executor(executor).query<RowDataPacket[]>(
      'SELECT * FROM bulk_operation_item WHERE bulk_operation_id = ? ORDER BY id ASC',
      [operationId]
    );
    return rows.map(mapItem);
  }

  private executor(executor?: QueryExecutor): QueryExecutor {
    return executor ?? this.pool;
  }
}

function mapOperation(row: RowDataPacket): BulkOperationRecord {
  return {
    id: Number(row.id),
    bulkActionKey: String(row.bulk_action_key),
    definitionReleaseId: Number(row.definition_release_id),
    initiatedBy: String(row.initiated_by),
    sessionId: String(row.session_id),
    correlationId: String(row.correlation_id),
    transactionMode: row.transaction_mode as BulkTransactionMode,
    input: parseJson(row.input_json),
    status: row.status as BulkOperationStatus,
    totalItems: Number(row.total_items),
    successfulItems: Number(row.successful_items),
    failedItems: Number(row.failed_items),
    createdAt: new Date(row.created_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null
  };
}

function mapItem(row: RowDataPacket): BulkOperationItemRecord {
  return {
    id: Number(row.id),
    bulkOperationId: Number(row.bulk_operation_id),
    workflowInstanceId: Number(row.workflow_instance_id),
    entityTrackingId: String(row.entity_tracking_id),
    status: row.status as BulkItemStatus,
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null
  };
}

function parseJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    return JSON.parse(value) as Record<string, unknown>;
  }
  return {};
}
