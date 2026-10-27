import type { QueryExecutor } from '../../../platform/db/types.js';
import type {
  BulkOperationItemRecord,
  BulkOperationRecord,
  CompleteBulkItemInput,
  CompleteBulkOperationInput,
  CreateBulkOperationInput,
  CreateBulkOperationItemInput
} from '../domain/types.js';
import type { BulkOperationRepository } from './bulk-operation.repository.js';

export class InMemoryBulkOperationRepository implements BulkOperationRepository {
  readonly operations: BulkOperationRecord[] = [];
  readonly items: BulkOperationItemRecord[] = [];
  private operationId = 1;
  private itemId = 1;

  async createOperation(input: CreateBulkOperationInput, _executor?: QueryExecutor): Promise<BulkOperationRecord> {
    const record: BulkOperationRecord = {
      id: this.operationId++,
      bulkActionKey: input.bulkActionKey,
      definitionReleaseId: input.definitionReleaseId,
      initiatedBy: input.initiatedBy,
      sessionId: input.sessionId,
      correlationId: input.correlationId,
      transactionMode: input.transactionMode,
      input: structuredClone(input.input),
      status: 'PENDING',
      totalItems: input.totalItems,
      successfulItems: 0,
      failedItems: 0,
      createdAt: new Date(),
      completedAt: null
    };
    this.operations.push(record);
    return clone(record);
  }

  async createItem(
    input: CreateBulkOperationItemInput,
    _executor?: QueryExecutor
  ): Promise<BulkOperationItemRecord> {
    const record: BulkOperationItemRecord = {
      id: this.itemId++,
      bulkOperationId: input.bulkOperationId,
      workflowInstanceId: input.workflowInstanceId,
      entityTrackingId: input.entityTrackingId,
      status: 'PENDING',
      errorCode: null,
      errorMessage: null,
      completedAt: null
    };
    this.items.push(record);
    return clone(record);
  }

  async completeItem(input: CompleteBulkItemInput, _executor?: QueryExecutor): Promise<BulkOperationItemRecord> {
    const record = this.items.find((item) => item.id === input.itemId);
    if (!record) {
      throw new Error(`Bulk item ${input.itemId} was not found.`);
    }
    record.status = input.status;
    record.errorCode = input.errorCode ?? null;
    record.errorMessage = input.errorMessage ?? null;
    record.completedAt = new Date();
    return clone(record);
  }

  async completeOperation(
    input: CompleteBulkOperationInput,
    _executor?: QueryExecutor
  ): Promise<BulkOperationRecord> {
    const record = this.operations.find((item) => item.id === input.operationId);
    if (!record) {
      throw new Error(`Bulk operation ${input.operationId} was not found.`);
    }
    record.status = input.status;
    record.successfulItems = input.successfulItems;
    record.failedItems = input.failedItems;
    record.completedAt = new Date();
    return clone(record);
  }

  async findById(id: number, _executor?: QueryExecutor): Promise<BulkOperationRecord | null> {
    const record = this.operations.find((item) => item.id === id);
    return record ? clone(record) : null;
  }

  async listItems(operationId: number, _executor?: QueryExecutor): Promise<BulkOperationItemRecord[]> {
    return this.items.filter((item) => item.bulkOperationId === operationId).map(clone);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
