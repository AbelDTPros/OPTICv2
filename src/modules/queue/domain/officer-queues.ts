import type { QueueDefinition, WorkflowDefinition } from '../../configuration/domain/types.js';

export const SYSTEM_QUEUE_ASSIGNED_TO_ME = 'ASSIGNED_TO_ME';
export const SYSTEM_QUEUE_ALL_ITEMS = 'ALL_ITEMS';
export const SYSTEM_QUEUE_COMPLETED = 'COMPLETED';

const ALL_ITEMS_ELIGIBILITY = {
  source: 'workflow',
  field: 'entityTrackingId',
  operator: 'EXISTS'
};

const COMPLETED_ELIGIBILITY = {
  source: 'workflow',
  field: 'status',
  operator: 'EQUALS',
  value: 'COMPLETED'
};

export function isSystemOfficerQueue(queueKey: string): boolean {
  return (
    queueKey === SYSTEM_QUEUE_ASSIGNED_TO_ME ||
    queueKey === SYSTEM_QUEUE_ALL_ITEMS ||
    queueKey === SYSTEM_QUEUE_COMPLETED
  );
}

/** Stage queues and Assigned to Me — not browse views (Completed / All Items). */
export function isOfficerWorkQueue(queueKey: string): boolean {
  return queueKey !== SYSTEM_QUEUE_COMPLETED && queueKey !== SYSTEM_QUEUE_ALL_ITEMS;
}

/**
 * Officer sidebar order: authored stage queues by workflow stage order, then
 * Completed → Assigned to Me → All Items. Matches Try desk listing.
 */
export function orderedOfficerQueueKeys(
  workflow: WorkflowDefinition,
  queues: Record<string, QueueDefinition>,
  entityType: string
): string[] {
  const reserved = new Set(systemOfficerQueues(entityType).map((queue) => queue.queueKey));
  const seen = new Set<string>();
  const authored: string[] = [];
  for (const stage of [...workflow.stages].sort((left, right) => left.order - right.order)) {
    const queueKey = stage.queueKey;
    const queue = queueKey ? queues[queueKey] : undefined;
    if (!queue || reserved.has(queue.queueKey) || seen.has(queue.queueKey)) {
      continue;
    }
    seen.add(queue.queueKey);
    authored.push(queue.queueKey);
  }
  for (const queue of Object.values(queues)) {
    if (reserved.has(queue.queueKey) || seen.has(queue.queueKey)) {
      continue;
    }
    seen.add(queue.queueKey);
    authored.push(queue.queueKey);
  }
  return [...authored, ...systemOfficerQueues(entityType).map((queue) => queue.queueKey)];
}

export function compareOfficerQueuesInOrder(left: string, right: string, orderedKeys: string[]): number {
  const leftIndex = orderedKeys.indexOf(left);
  const rightIndex = orderedKeys.indexOf(right);
  if (leftIndex !== -1 && rightIndex !== -1) {
    return leftIndex - rightIndex;
  }
  if (leftIndex !== -1) {
    return -1;
  }
  if (rightIndex !== -1) {
    return 1;
  }
  return compareOfficerQueueKeys(left, right);
}

/** Fallback when workflow stage order is unavailable (system queues only + alpha). */
export function compareOfficerQueueKeys(left: string, right: string): number {
  const rank = systemOfficerQueueRank(left) - systemOfficerQueueRank(right);
  return rank !== 0 ? rank : left.localeCompare(right);
}

export function systemOfficerQueueRank(queueKey: string): number {
  if (queueKey === SYSTEM_QUEUE_COMPLETED) {
    return 1;
  }
  if (queueKey === SYSTEM_QUEUE_ASSIGNED_TO_ME) {
    return 2;
  }
  if (queueKey === SYSTEM_QUEUE_ALL_ITEMS) {
    return 3;
  }
  return 0;
}

export function systemOfficerQueues(entityType: string): QueueDefinition[] {
  return [
    systemOfficerQueue(SYSTEM_QUEUE_COMPLETED, 'Completed', entityType, COMPLETED_ELIGIBILITY),
    systemOfficerQueue(SYSTEM_QUEUE_ASSIGNED_TO_ME, 'Assigned to Me', entityType, ALL_ITEMS_ELIGIBILITY),
    systemOfficerQueue(SYSTEM_QUEUE_ALL_ITEMS, 'All Items', entityType, ALL_ITEMS_ELIGIBILITY)
  ];
}

function systemOfficerQueue(
  queueKey: string,
  displayName: string,
  entityType: string,
  eligibility: QueueDefinition['eligibility']
): QueueDefinition {
  return {
    queueKey,
    displayName,
    entityType: entityType === 'MAIL' ? 'MAIL' : 'WORKLOAD',
    eligibility,
    defaultSort: [{ field: 'enteredStageAt', direction: 'ASC' }],
    columns: ['trackingId', 'assignedTo', 'currentStageKey'],
    filters: ['assignedStatus'],
    actions: ['ASSIGN_TO_SELF', 'RELEASE_TO_QUEUE'],
    pageSize: 25
  };
}
