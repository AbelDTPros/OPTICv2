import type { QueueDefinition } from '../../configuration/domain/types.js';
import type { QueueEligibility } from './eligibility.js';

export interface QueueProjectionRecord {
  workflowInstanceId: number;
  entityType: string;
  entityTrackingId: string;
  definitionKey: string;
  definitionReleaseId: number;
  workloadType: string | null;
  currentStageKey: string;
  assignedTo: string | null;
  branchKey: string | null;
  locationKey: string | null;
  priority: string | null;
  receivedAt: Date | null;
  enteredStageAt: Date;
  slaState: string | null;
  receiptNumber: string | null;
  status: string;
  rowVersion: number;
  projectedJson: Record<string, unknown> | null;
  updatedAt: Date;
}

export interface QueueQuerySort {
  field: string;
  direction: 'ASC' | 'DESC';
}

export interface QueueQuery {
  eligibility: QueueEligibility;
  entityType: string;
  definitionKey?: string;
  filters: Record<string, string>;
  sort: QueueQuerySort[];
  page: number;
  pageSize: number;
  actorId?: string;
}

export interface QueueQueryResult {
  rows: QueueProjectionRecord[];
  total: number;
}

export interface CatalogedQueue {
  queueKey: string;
  displayName: string;
  entityType: string;
  definitionKey: string;
  version: string;
  releaseId: string;
  queue: QueueDefinition;
  /** Sidebar order within the definition (stage order, then system queues). */
  officerSortIndex: number;
  /** Matching Live rows for the current actor. Officer views use the same rules as the page. */
  total?: number;
}

export interface QueueColumnView {
  key: string;
  label: string;
  sortable: boolean;
}

export interface QueueFilterView {
  key: string;
  label: string;
}

export interface QueueActionView {
  actionKey: string;
  label: string;
}

export interface QueueBulkActionView {
  bulkActionKey: string;
  label: string;
  stageKey: string;
  maxSelection: number;
  transactionMode: 'ATOMIC' | 'BEST_EFFORT';
  sharedInputSchema?: Record<string, unknown>;
}

export interface QueueRowView {
  workflowInstanceId: number;
  entityType: string;
  trackingId: string;
  definitionKey: string;
  definitionVersion: string;
  releaseId: string;
  currentStageKey: string;
  status: string;
  allowAssign: boolean;
  allowReassign: boolean;
  allowRelease: boolean;
  assignedTo: string | null;
  assignedStatus: 'UNASSIGNED' | 'ASSIGNED';
  enteredStageAt: string;
  rowVersion: number;
  pinnedColumns: string[];
  values: Record<string, string | number | null>;
}

export interface QueuePageView {
  queueKey: string;
  displayName: string;
  entityType: string;
  definitionKey: string;
  version: string;
  columns: QueueColumnView[];
  filters: QueueFilterView[];
  actions: QueueActionView[];
  bulkActions: QueueBulkActionView[];
  page: number;
  pageSize: number;
  total: number;
  sort: QueueQuerySort[];
  appliedFilters: Record<string, string>;
  rows: QueueRowView[];
}
