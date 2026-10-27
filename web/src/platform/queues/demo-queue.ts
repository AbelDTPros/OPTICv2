export interface DemoQueueColumn {
  key: string;
  label: string;
  sortable: boolean;
}

export interface DemoQueueFilter {
  key: string;
  label: string;
}

export interface DemoQueueAction {
  actionKey: string;
  label: string;
}

export interface DemoBulkAction {
  bulkActionKey: string;
  label: string;
  stageKey: string;
  maxSelection: number;
  transactionMode: 'ATOMIC' | 'BEST_EFFORT';
  sharedInputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; format?: string; maxLength?: number; title?: string; description?: string }>;
    required?: string[];
  };
}

export interface DemoBulkResult {
  id: number;
  status: string;
  successfulItems: number;
  failedItems: number;
  items: Array<{ trackingId: string; status: string; errorMessage: string | null }>;
}

export interface DemoQueueRow {
  workflowInstanceId: number;
  entityType: string;
  trackingId: string;
  definitionKey: string;
  currentStageKey: string;
  status?: string;
  allowAssign?: boolean;
  allowReassign?: boolean;
  allowRelease?: boolean;
  assignedTo: string | null;
  assignedStatus: 'UNASSIGNED' | 'ASSIGNED';
  enteredStageAt: string;
  rowVersion: number;
  values: Record<string, string | number | null>;
}

export interface DemoQueuePage {
  queueKey: string;
  displayName: string;
  entityType: string;
  definitionKey: string;
  version: string;
  columns: DemoQueueColumn[];
  filters: DemoQueueFilter[];
  actions: DemoQueueAction[];
  bulkActions?: DemoBulkAction[];
  page: number;
  pageSize: number;
  total: number;
  sort: Array<{ field: string; direction: 'ASC' | 'DESC' }>;
  appliedFilters: Record<string, string>;
  rows: DemoQueueRow[];
}

export const demoQueuePage: DemoQueuePage = {
  queueKey: 'READY_FOR_DATA_ENTRY',
  displayName: 'Ready for Data Entry',
  entityType: 'WORKLOAD',
  definitionKey: 'I_90',
  version: '1.0.0',
  columns: [
    { key: 'trackingId', label: 'Tracking ID', sortable: true },
    { key: 'workloadType', label: 'Workload type', sortable: true },
    { key: 'assignedTo', label: 'Assigned to', sortable: true },
    { key: 'ageInQueue', label: 'Age in queue', sortable: true },
    { key: 'receiptNumber', label: 'Receipt number', sortable: true }
  ],
  filters: [
    { key: 'assignedStatus', label: 'Assignment' },
    { key: 'workloadType', label: 'Workload type' }
  ],
  actions: [
    { actionKey: 'ASSIGN_TO_SELF', label: 'Assign to me' },
    { actionKey: 'RELEASE_TO_QUEUE', label: 'Release' }
  ],
  bulkActions: [
    {
      bulkActionKey: 'BULK_SHIP',
      label: 'Ship Selected',
      stageKey: 'READY_FOR_DATA_ENTRY',
      maxSelection: 100,
      transactionMode: 'BEST_EFFORT',
      sharedInputSchema: {
        type: 'object',
        properties: { shipDate: { type: 'string', format: 'date', title: 'Ship date' } },
        required: ['shipDate']
      }
    }
  ],
  page: 1,
  pageSize: 25,
  total: 2,
  sort: [{ field: 'enteredStageAt', direction: 'ASC' }],
  appliedFilters: {},
  rows: [
    {
      workflowInstanceId: 1,
      entityType: 'WORKLOAD',
      trackingId: 'W-2001',
      definitionKey: 'I_90',
      currentStageKey: 'READY_FOR_DATA_ENTRY',
      assignedTo: null,
      assignedStatus: 'UNASSIGNED',
      enteredStageAt: '2026-08-22T15:00:00.000Z',
      rowVersion: 0,
      values: {
        trackingId: 'W-2001',
        workloadType: 'I-90 Linear',
        assignedTo: null,
        ageInQueue: '2h',
        receiptNumber: 'ABC1234567890'
      }
    },
    {
      workflowInstanceId: 2,
      entityType: 'WORKLOAD',
      trackingId: 'W-2002',
      definitionKey: 'I_90',
      currentStageKey: 'READY_FOR_DATA_ENTRY',
      assignedTo: 'officer@example.gov',
      assignedStatus: 'ASSIGNED',
      enteredStageAt: '2026-08-22T14:00:00.000Z',
      rowVersion: 1,
      values: {
        trackingId: 'W-2002',
        workloadType: 'I-90 Linear',
        assignedTo: 'officer@example.gov',
        ageInQueue: '3h',
        receiptNumber: 'XYZ9876543210'
      }
    }
  ]
};
