import { fieldInputId, validationFailed } from '../../../platform/errors/app-error.js';
import type { RuleOperator } from '../../configuration/domain/types.js';

export type QueueFieldSource = 'workflow' | 'system' | 'business';

export const ALLOWED_PAGE_SIZES = [10, 25, 50, 100] as const;
export type AllowedPageSize = (typeof ALLOWED_PAGE_SIZES)[number];

export const QUEUE_ACTIONS = ['ASSIGN_TO_SELF', 'RELEASE_TO_QUEUE'] as const;
export type QueueActionKey = (typeof QUEUE_ACTIONS)[number];

export const SQL_SAFE_OPERATORS = new Set<RuleOperator>([
  'EQUALS',
  'NOT_EQUALS',
  'IN',
  'NOT_IN',
  'IS_NULL',
  'NOT_NULL',
  'EXISTS',
  'NOT_EXISTS',
  'TRUE',
  'FALSE'
]);

export interface QueueFieldSpec {
  key: string;
  label: string;
  source: QueueFieldSource;
  field: string;
  sqlColumn: string;
  filterable: boolean;
  sortable: boolean;
  projected: boolean;
}

export const QUEUE_FIELDS: Record<string, QueueFieldSpec> = {
  trackingId: {
    key: 'trackingId',
    label: 'Tracking ID',
    source: 'workflow',
    field: 'entityTrackingId',
    sqlColumn: 'entity_tracking_id',
    filterable: false,
    sortable: true,
    projected: true
  },
  entityType: {
    key: 'entityType',
    label: 'Entity type',
    source: 'workflow',
    field: 'entityType',
    sqlColumn: 'entity_type',
    filterable: false,
    sortable: true,
    projected: true
  },
  definitionKey: {
    key: 'definitionKey',
    label: 'Definition',
    source: 'workflow',
    field: 'definitionKey',
    sqlColumn: 'definition_key',
    filterable: true,
    sortable: true,
    projected: true
  },
  currentStageKey: {
    key: 'currentStageKey',
    label: 'Stage',
    source: 'workflow',
    field: 'currentStageKey',
    sqlColumn: 'current_stage_key',
    filterable: true,
    sortable: true,
    projected: true
  },
  assignedTo: {
    key: 'assignedTo',
    label: 'Assigned to',
    source: 'workflow',
    field: 'assignedTo',
    sqlColumn: 'assigned_to',
    filterable: false,
    sortable: true,
    projected: true
  },
  assignedStatus: {
    key: 'assignedStatus',
    label: 'Assignment',
    source: 'workflow',
    field: 'assignedStatus',
    sqlColumn: 'assigned_to',
    filterable: true,
    sortable: false,
    projected: true
  },
  enteredStageAt: {
    key: 'enteredStageAt',
    label: 'Entered stage',
    source: 'workflow',
    field: 'enteredStageAt',
    sqlColumn: 'entered_stage_at',
    filterable: false,
    sortable: true,
    projected: true
  },
  ageInQueue: {
    key: 'ageInQueue',
    label: 'Age in queue',
    source: 'workflow',
    field: 'enteredStageAt',
    sqlColumn: 'entered_stage_at',
    filterable: false,
    sortable: true,
    projected: true
  },
  workloadType: {
    key: 'workloadType',
    label: 'Workload type',
    source: 'business',
    field: 'workloadType',
    sqlColumn: 'workload_type',
    filterable: true,
    sortable: true,
    projected: true
  },
  receiptNumber: {
    key: 'receiptNumber',
    label: 'Receipt number',
    source: 'business',
    field: 'receiptNumber',
    sqlColumn: 'receipt_number',
    filterable: true,
    sortable: true,
    projected: true
  },
  receivedDate: {
    key: 'receivedDate',
    label: 'Received date',
    source: 'system',
    field: 'receivedAt',
    sqlColumn: 'received_at',
    filterable: true,
    sortable: true,
    projected: true
  },
  slaState: {
    key: 'slaState',
    label: 'SLA',
    source: 'system',
    field: 'slaState',
    sqlColumn: 'sla_state',
    filterable: true,
    sortable: true,
    projected: true
  },
  branch: {
    key: 'branch',
    label: 'Branch',
    source: 'system',
    field: 'branchKey',
    sqlColumn: 'branch_key',
    filterable: true,
    sortable: true,
    projected: true
  },
  location: {
    key: 'location',
    label: 'Location',
    source: 'system',
    field: 'locationKey',
    sqlColumn: 'location_key',
    filterable: true,
    sortable: true,
    projected: true
  },
  priority: {
    key: 'priority',
    label: 'Priority',
    source: 'system',
    field: 'priority',
    sqlColumn: 'priority',
    filterable: true,
    sortable: true,
    projected: true
  },
  status: {
    key: 'status',
    label: 'Status',
    source: 'workflow',
    field: 'status',
    sqlColumn: 'status',
    filterable: true,
    sortable: true,
    projected: true
  }
};

const SOURCE_FIELD_INDEX = new Map<string, QueueFieldSpec>(
  Object.values(QUEUE_FIELDS)
    .filter((spec) => spec.key !== 'assignedStatus' && spec.key !== 'ageInQueue')
    .map((spec) => [`${spec.source}.${spec.field}`, spec])
);

function indexAlias(sourceField: string, spec: QueueFieldSpec | undefined): void {
  if (spec) {
    SOURCE_FIELD_INDEX.set(sourceField, spec);
  }
}

indexAlias('workflow.currentStageKey', QUEUE_FIELDS.currentStageKey);
indexAlias('workflow.assignedTo', QUEUE_FIELDS.assignedTo);
indexAlias('workflow.entityType', QUEUE_FIELDS.entityType);
indexAlias('workflow.definitionKey', QUEUE_FIELDS.definitionKey);
indexAlias('workflow.status', QUEUE_FIELDS.status);
indexAlias('workflow.entityTrackingId', QUEUE_FIELDS.trackingId);
indexAlias('system.branchKey', QUEUE_FIELDS.branch);
indexAlias('system.locationKey', QUEUE_FIELDS.location);
indexAlias('system.priority', QUEUE_FIELDS.priority);
indexAlias('system.slaState', QUEUE_FIELDS.slaState);
indexAlias('system.receivedAt', QUEUE_FIELDS.receivedDate);
indexAlias('business.receiptNumber', QUEUE_FIELDS.receiptNumber);
indexAlias('business.workloadType', QUEUE_FIELDS.workloadType);

export function queueFieldByKey(key: string): QueueFieldSpec | undefined {
  return QUEUE_FIELDS[key];
}

export function queueFieldBySource(source: string, field: string): QueueFieldSpec | undefined {
  return SOURCE_FIELD_INDEX.get(`${source}.${field}`);
}

export function requireQueueField(key: string, role: 'column' | 'filter' | 'sort'): QueueFieldSpec {
  const spec = queueFieldByKey(key);
  if (!spec) {
    throw validationFailed(
      'OPTIC-CONFIG-40026',
      `Queue ${role} ${key} is not an approved projected field.`,
      [
        {
          field: key,
          path: `queues.${role}s`,
          message: `${key} is not a projected queue field. Publish only fields that have a relational projection.`,
          inputId: fieldInputId(key)
        }
      ]
    );
  }
  if (role === 'filter' && !spec.filterable) {
    throw validationFailed('OPTIC-CONFIG-40026', `Queue filter ${key} is not filterable.`, [
      {
        field: key,
        path: 'queues.filters',
        message: `${key} cannot be used as a queue filter.`,
        inputId: fieldInputId(key)
      }
    ]);
  }
  if (role === 'sort' && !spec.sortable) {
    throw validationFailed('OPTIC-CONFIG-40026', `Queue sort field ${key} is not sortable.`, [
      {
        field: key,
        path: 'queues.defaultSort',
        message: `${key} cannot be used as a queue sort field.`,
        inputId: fieldInputId(key)
      }
    ]);
  }
  return spec;
}

export function isAllowedPageSize(value: number): value is AllowedPageSize {
  return (ALLOWED_PAGE_SIZES as readonly number[]).includes(value);
}

export function actionLabel(actionKey: string): string {
  if (actionKey === 'ASSIGN_TO_SELF') {
    return 'Assign to me';
  }
  if (actionKey === 'RELEASE_TO_QUEUE') {
    return 'Release';
  }
  return actionKey;
}
