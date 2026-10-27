import { assignmentPermissions } from '../../../../src/modules/configuration/domain/assignment-policy.js';
import type {
  QueueDefinition,
  StageFormDefinition,
  WorkflowDefinition
} from '../../../../src/modules/configuration/domain/types.js';
import {
  SYSTEM_QUEUE_ALL_ITEMS,
  SYSTEM_QUEUE_ASSIGNED_TO_ME,
  SYSTEM_QUEUE_COMPLETED,
  orderedOfficerQueueKeys,
  systemOfficerQueues
} from '../../../../src/modules/queue/domain/officer-queues.js';
import { getByJsonPath } from '../dynamic-forms/json-path.js';
import type { DemoQueuePage } from '../queues/demo-queue.js';
import { mintTrackingIdValue } from '../tracking/mint-tracking-id.js';
import type { WorkflowQueueItem, WorkflowSummary } from './workflow-api.js';

export {
  SYSTEM_QUEUE_ALL_ITEMS,
  SYSTEM_QUEUE_ASSIGNED_TO_ME,
  SYSTEM_QUEUE_COMPLETED,
  isOfficerWorkQueue,
  isSystemOfficerQueue
} from '../../../../src/modules/queue/domain/officer-queues.js';

const DEFAULT_OFFICER_ID = 'officer@example.gov';

const COLUMN_LABELS: Record<string, string> = {
  trackingId: 'Tracking ID',
  assignedTo: 'Assigned to',
  assignedStatus: 'Assignment',
  currentStageKey: 'Stage',
  ageInQueue: 'Age in queue',
  receiptNumber: 'Receipt number',
  enteredStageAt: 'Entered stage',
  workloadType: 'Workload type',
  definitionKey: 'Definition',
  status: 'Status',
  slaState: 'SLA',
  branchKey: 'Branch',
  locationKey: 'Location',
  priority: 'Priority',
  receivedAt: 'Received date'
};

export function itemFromSummary(summary: WorkflowSummary): WorkflowQueueItem {
  return {
    trackingId: summary.trackingId,
    entityType: summary.entityType,
    workflowInstanceId: summary.workflowInstanceId,
    status: summary.status,
    currentStageKey: summary.workflow.currentStageKey,
    currentStageLabel: summary.workflow.currentStageLabel,
    assignedTo: summary.workflow.assignedTo,
    enteredStageAt: summary.workflow.enteredStageAt,
    rowVersion: summary.workflow.rowVersion,
    businessData: summary.businessData
  };
}

export function stageForKey(workflow: WorkflowDefinition, stageKey: string) {
  return workflow.stages.find((stage) => stage.stageKey === stageKey);
}

export function isTerminalStageKey(workflow: WorkflowDefinition, stageKey: string, status?: string): boolean {
  const stage = stageForKey(workflow, stageKey);
  return status === 'COMPLETED' || Boolean(stage?.terminal) || workflow.terminalStageKeys.includes(stageKey);
}

export function stageForSummary(workflow: WorkflowDefinition, summary: WorkflowSummary) {
  return stageForKey(workflow, summary.workflow.currentStageKey);
}

export function isTerminalStage(workflow: WorkflowDefinition, summary: WorkflowSummary): boolean {
  return isTerminalStageKey(workflow, summary.workflow.currentStageKey, summary.status);
}

export function queueForStageKey(
  workflow: WorkflowDefinition,
  queues: Record<string, QueueDefinition>,
  stageKey: string,
  entityType: string
): QueueDefinition | undefined {
  const stage = stageForKey(workflow, stageKey);
  if (!stage || isTerminalStageKey(workflow, stageKey)) {
    return undefined;
  }
  if (stage.queueKey && queues[stage.queueKey]) {
    return queues[stage.queueKey];
  }
  return {
    queueKey: stage.queueKey || `QUEUE_${stage.stageKey}`,
    displayName: stage.displayName,
    entityType,
    eligibility: {},
    defaultSort: [{ field: 'enteredStageAt', direction: 'ASC' }],
    columns: ['trackingId', 'assignedTo', 'currentStageKey'],
    filters: ['assignedStatus'],
    actions: ['ASSIGN_TO_SELF'],
    pageSize: 25
  };
}

export function queueForStage(
  workflow: WorkflowDefinition,
  queues: Record<string, QueueDefinition>,
  summary: WorkflowSummary
): QueueDefinition | undefined {
  if (isTerminalStage(workflow, summary)) {
    return undefined;
  }
  return queueForStageKey(workflow, queues, summary.workflow.currentStageKey, summary.entityType);
}

export function defaultOfficerQueues(entityType: string): QueueDefinition[] {
  return systemOfficerQueues(entityType);
}

export function listOfficerQueues(
  workflow: WorkflowDefinition,
  queues: Record<string, QueueDefinition>,
  entityType: string
): QueueDefinition[] {
  const byKey = new Map<string, QueueDefinition>();
  for (const queue of Object.values(queues)) {
    byKey.set(queue.queueKey, queue);
  }
  for (const queue of defaultOfficerQueues(entityType)) {
    byKey.set(queue.queueKey, queue);
  }
  return orderedOfficerQueueKeys(workflow, queues, entityType)
    .map((queueKey) => byKey.get(queueKey))
    .filter((queue): queue is QueueDefinition => Boolean(queue));
}

export function itemsInQueue(
  queue: QueueDefinition,
  workflow: WorkflowDefinition,
  items: WorkflowQueueItem[],
  actorId = DEFAULT_OFFICER_ID
): WorkflowQueueItem[] {
  if (queue.queueKey === SYSTEM_QUEUE_ASSIGNED_TO_ME) {
    return items.filter((item) => item.assignedTo === actorId);
  }
  if (queue.queueKey === SYSTEM_QUEUE_ALL_ITEMS) {
    return items;
  }
  if (queue.queueKey === SYSTEM_QUEUE_COMPLETED) {
    return items.filter((item) => isTerminalStageKey(workflow, item.currentStageKey, item.status));
  }
  return items.filter((item) => {
    if (isTerminalStageKey(workflow, item.currentStageKey, item.status)) {
      return false;
    }
    const stage = stageForKey(workflow, item.currentStageKey);
    if (!stage) {
      return false;
    }
    return (stage.queueKey || `QUEUE_${stage.stageKey}`) === queue.queueKey;
  });
}

export function trialQueuePage(
  queue: QueueDefinition,
  items: WorkflowQueueItem[],
  definitionKey: string,
  version: string,
  workflow?: WorkflowDefinition,
  page = 1,
  appliedFilters: Record<string, string> = {},
  actorId?: string
): DemoQueuePage {
  const columns = (queue.columns.length > 0 ? queue.columns : ['trackingId', 'assignedTo', 'currentStageKey']).map(
    (key) => ({
      key,
      label:
        COLUMN_LABELS[key] ??
        queue.projectedFields?.find((field) => field.fieldKey === key)?.label ??
        key,
      sortable: false
    })
  );
  const filters = (queue.filters ?? []).map((key) => ({
    key,
    label:
      COLUMN_LABELS[key] ??
      queue.projectedFields?.find((field) => field.fieldKey === key)?.label ??
      key
  }));
  const activeFilters = Object.fromEntries(
    Object.entries(appliedFilters).filter(([, value]) => value.trim())
  );
  const filtered = items.filter((item) => matchesTrialFilters(item, queue, activeFilters, actorId, definitionKey));
  const pageSize = queue.pageSize || 25;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);
  return {
    queueKey: queue.queueKey,
    displayName: queue.displayName,
    entityType: queue.entityType,
    definitionKey,
    version,
    columns,
    filters,
    actions: (queue.actions.length > 0 ? queue.actions : ['ASSIGN_TO_SELF', 'RELEASE_TO_QUEUE']).map((actionKey) => ({
      actionKey,
      label: actionKey === 'ASSIGN_TO_SELF' ? 'Assign to me' : 'Release'
    })),
    page: safePage,
    pageSize,
    total: filtered.length,
    sort: queue.defaultSort?.length ? queue.defaultSort : [{ field: 'enteredStageAt', direction: 'ASC' }],
    appliedFilters: activeFilters,
    rows: pageItems.map((item) => {
      const assigned = Boolean(item.assignedTo);
      const stage = workflow ? stageForKey(workflow, item.currentStageKey) : undefined;
      const permissions = assignmentPermissions(stage, item.status);
      return {
        workflowInstanceId: item.workflowInstanceId,
        entityType: item.entityType,
        trackingId: item.trackingId,
        definitionKey,
        currentStageKey: item.currentStageKey,
        status: item.status,
        allowAssign: permissions.allowAssign,
        allowReassign: permissions.allowReassign,
        allowRelease: permissions.allowRelease,
        assignedTo: item.assignedTo,
        assignedStatus: assigned ? 'ASSIGNED' : 'UNASSIGNED',
        enteredStageAt: item.enteredStageAt,
        rowVersion: item.rowVersion,
        values: Object.fromEntries(columns.map((column) => [column.key, cellValue(column.key, item, queue)]))
      };
    })
  };
}

function matchesTrialFilters(
  item: WorkflowQueueItem,
  queue: QueueDefinition,
  filters: Record<string, string>,
  actorId: string | undefined,
  definitionKey: string
): boolean {
  for (const [key, raw] of Object.entries(filters)) {
    const value = raw.trim();
    if (!value) {
      continue;
    }
    if (key === 'assignedStatus') {
      if (value === 'UNASSIGNED' && item.assignedTo) {
        return false;
      }
      if (value === 'ASSIGNED' && !item.assignedTo) {
        return false;
      }
      if (value === 'MINE' && item.assignedTo !== actorId) {
        return false;
      }
      continue;
    }
    const actual = filterValue(key, item, queue, definitionKey);
    if (String(actual ?? '').toLowerCase() !== value.toLowerCase()) {
      return false;
    }
  }
  return true;
}

function filterValue(
  key: string,
  item: WorkflowQueueItem,
  queue: QueueDefinition,
  definitionKey: string
): string | number | null {
  if (key === 'definitionKey') {
    return definitionKey;
  }
  if (key === 'status') {
    return item.status;
  }
  if (key === 'currentStageKey') {
    return item.currentStageKey;
  }
  if (key === 'assignedTo') {
    return item.assignedTo;
  }
  return cellValue(key, item, queue);
}

function cellValue(column: string, item: WorkflowQueueItem, queue: QueueDefinition): string | number | null {
  if (column === 'trackingId') {
    return item.trackingId;
  }
  if (column === 'assignedTo' || column === 'assignedStatus') {
    return item.assignedTo;
  }
  if (column === 'currentStageKey') {
    return item.currentStageLabel || item.currentStageKey;
  }
  if (column === 'enteredStageAt') {
    return item.enteredStageAt;
  }
  if (column === 'ageInQueue') {
    const entered = Date.parse(item.enteredStageAt);
    if (!Number.isFinite(entered)) {
      return null;
    }
    return `${Math.max(0, Math.floor((Date.now() - entered) / 60_000))}m`;
  }
  const authored = queue.projectedFields?.find((field) => field.fieldKey === column);
  if (authored) {
    const resolved = getByJsonPath(item.businessData, authored.path);
    if (typeof resolved === 'string' || typeof resolved === 'number') {
      const text = String(resolved).trim();
      return text || null;
    }
  }
  return firstStringValue(item.businessData, column);
}

export function nextTrackingId(entityType: string = 'WORKLOAD'): string {
  return mintTrackingIdValue(entityType);
}

export interface PriorStageScreen {
  stageKey: string;
  displayName: string;
  form: StageFormDefinition;
  visitNumber: number;
  enteredAt?: string;
}

export type StageVisitRef = {
  stageKey: string;
  visitNumber: number;
  completedAt: string | null;
  enteredAt?: string;
};

export function priorStageScreens(
  workflow: WorkflowDefinition,
  forms: Record<string, StageFormDefinition>,
  visits: StageVisitRef[],
  currentStageKey: string
): PriorStageScreen[] {
  return collectStageScreens(workflow, forms, visits, { requireCompleted: true, excludeStageKey: currentStageKey });
}

export function visitedFormScreens(
  workflow: WorkflowDefinition,
  forms: Record<string, StageFormDefinition>,
  visits: StageVisitRef[]
): PriorStageScreen[] {
  return collectStageScreens(workflow, forms, visits, {});
}

function collectStageScreens(
  workflow: WorkflowDefinition,
  forms: Record<string, StageFormDefinition>,
  visits: StageVisitRef[],
  options: { requireCompleted?: boolean; excludeStageKey?: string }
): PriorStageScreen[] {
  const latest = new Map<string, PriorStageScreen>();
  const firstSeen: string[] = [];
  for (const visit of [...visits].sort(compareStageVisits)) {
    if (options.requireCompleted && !visit.completedAt) {
      continue;
    }
    if (options.excludeStageKey && visit.stageKey === options.excludeStageKey) {
      continue;
    }
    const stage = stageForKey(workflow, visit.stageKey);
    const form = stage?.formKey ? forms[stage.formKey] : undefined;
    if (!form) {
      continue;
    }
    if (!latest.has(visit.stageKey)) {
      firstSeen.push(visit.stageKey);
    }
    const current = latest.get(visit.stageKey);
    if (current && visit.visitNumber < current.visitNumber) {
      continue;
    }
    latest.set(visit.stageKey, {
      stageKey: visit.stageKey,
      displayName: stage?.displayName ?? visit.stageKey,
      form,
      visitNumber: visit.visitNumber,
      enteredAt: visit.enteredAt
    });
  }
  return firstSeen.map((stageKey) => latest.get(stageKey)).filter((screen): screen is PriorStageScreen => Boolean(screen));
}

export type JourneyStageTab = {
  stageKey: string;
  displayName: string;
  form?: StageFormDefinition;
  visitNumber: number;
  enteredAt?: string;
  isCurrent: boolean;
};

export function journeyStageTabs(
  workflow: WorkflowDefinition,
  forms: Record<string, StageFormDefinition>,
  visits: StageVisitRef[],
  currentStageKey: string,
  currentStageLabel?: string
): JourneyStageTab[] {
  const latest = new Map<string, StageVisitRef>();
  const firstSeen: string[] = [];
  for (const visit of [...visits].sort(compareStageVisits)) {
    if (!latest.has(visit.stageKey)) {
      firstSeen.push(visit.stageKey);
    }
    const seen = latest.get(visit.stageKey);
    if (seen && visit.visitNumber < seen.visitNumber) {
      continue;
    }
    latest.set(visit.stageKey, visit);
  }
  if (!firstSeen.includes(currentStageKey)) {
    firstSeen.push(currentStageKey);
  }
  return firstSeen.map((stageKey) => {
    const visit = latest.get(stageKey);
    const stage = stageForKey(workflow, stageKey);
    const form = stage?.formKey ? forms[stage.formKey] : undefined;
    return {
      stageKey,
      displayName: stage?.displayName ?? (stageKey === currentStageKey ? currentStageLabel : undefined) ?? stageKey,
      form,
      visitNumber: visit?.visitNumber ?? 0,
      enteredAt: visit?.enteredAt,
      isCurrent: stageKey === currentStageKey
    };
  });
}

export function compareStageVisits(left: StageVisitRef, right: StageVisitRef): number {
  const leftTime = visitEnteredAt(left);
  const rightTime = visitEnteredAt(right);
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.visitNumber - right.visitNumber;
}

function visitEnteredAt(visit: StageVisitRef): number {
  if (!visit.enteredAt) {
    return visit.visitNumber;
  }
  const parsed = Date.parse(visit.enteredAt);
  return Number.isFinite(parsed) ? parsed : visit.visitNumber;
}

function firstStringValue(data: unknown, key: string): string | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  const record = data as Record<string, unknown>;
  const direct = record[key];
  if (typeof direct === 'string' || typeof direct === 'number') {
    return String(direct);
  }
  for (const value of Object.values(record)) {
    const nested = firstStringValue(value, key);
    if (nested != null) {
      return nested;
    }
  }
  return null;
}
