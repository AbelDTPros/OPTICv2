export type BulkTransactionMode = 'ATOMIC' | 'BEST_EFFORT';
export type BulkOperationStatus = 'PENDING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
export type BulkItemStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

export interface BulkOperationRecord {
  id: number;
  bulkActionKey: string;
  definitionReleaseId: number;
  initiatedBy: string;
  sessionId: string;
  correlationId: string;
  transactionMode: BulkTransactionMode;
  input: Record<string, unknown>;
  status: BulkOperationStatus;
  totalItems: number;
  successfulItems: number;
  failedItems: number;
  createdAt: Date;
  completedAt: Date | null;
}

export interface BulkOperationItemRecord {
  id: number;
  bulkOperationId: number;
  workflowInstanceId: number;
  entityTrackingId: string;
  status: BulkItemStatus;
  errorCode: string | null;
  errorMessage: string | null;
  completedAt: Date | null;
}

export interface CreateBulkOperationInput {
  bulkActionKey: string;
  definitionReleaseId: number;
  initiatedBy: string;
  sessionId: string;
  correlationId: string;
  transactionMode: BulkTransactionMode;
  input: Record<string, unknown>;
  totalItems: number;
}

export interface CreateBulkOperationItemInput {
  bulkOperationId: number;
  workflowInstanceId: number;
  entityTrackingId: string;
}

export interface CompleteBulkItemInput {
  itemId: number;
  status: 'SUCCEEDED' | 'FAILED';
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface CompleteBulkOperationInput {
  operationId: number;
  status: Exclude<BulkOperationStatus, 'PENDING'>;
  successfulItems: number;
  failedItems: number;
}
