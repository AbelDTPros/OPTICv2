import type { QueryExecutor } from '../../../platform/db/types.js';
import type {
  BulkOperationItemRecord,
  BulkOperationRecord,
  CompleteBulkItemInput,
  CompleteBulkOperationInput,
  CreateBulkOperationInput,
  CreateBulkOperationItemInput
} from '../domain/types.js';

export interface BulkOperationRepository {
  createOperation(input: CreateBulkOperationInput, executor?: QueryExecutor): Promise<BulkOperationRecord>;
  createItem(input: CreateBulkOperationItemInput, executor?: QueryExecutor): Promise<BulkOperationItemRecord>;
  completeItem(input: CompleteBulkItemInput, executor?: QueryExecutor): Promise<BulkOperationItemRecord>;
  completeOperation(input: CompleteBulkOperationInput, executor?: QueryExecutor): Promise<BulkOperationRecord>;
  findById(id: number, executor?: QueryExecutor): Promise<BulkOperationRecord | null>;
  listItems(operationId: number, executor?: QueryExecutor): Promise<BulkOperationItemRecord[]>;
}
