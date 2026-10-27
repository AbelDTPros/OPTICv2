import { fieldInputId, validationFailed, type ErrorDetails } from '../../../platform/errors/app-error.js';
import type { QueueDefinition } from '../../configuration/domain/types.js';
import { isEmptyEligibility, parseQueueEligibility } from './eligibility.js';
import { ALLOWED_PAGE_SIZES, QUEUE_ACTIONS, isAllowedPageSize, queueFieldByKey, requireQueueField } from './fields.js';

export function validateQueueDefinition(
  queue: QueueDefinition,
  options: { requireEligibility: boolean }
): void {
  const details: ErrorDetails = [];
  if (!queue.queueKey) {
    details.push({
      field: 'queueKey',
      path: 'queueKey',
      message: 'queueKey is required.',
      inputId: fieldInputId('queueKey')
    });
  }
  if (!queue.displayName) {
    details.push({
      field: 'displayName',
      path: `queues.${queue.queueKey}.displayName`,
      message: 'displayName is required.',
      inputId: fieldInputId('displayName')
    });
  }
  if (queue.pageSize && !isAllowedPageSize(queue.pageSize)) {
    details.push({
      field: 'pageSize',
      path: `queues.${queue.queueKey}.pageSize`,
      message: `pageSize must be one of ${ALLOWED_PAGE_SIZES.join(', ')}.`,
      inputId: fieldInputId('pageSize')
    });
  }

  const authored = new Map<string, true>();
  for (const [index, field] of (queue.projectedFields ?? []).entries()) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(field.fieldKey)) {
      details.push({
        field: 'projectedFields',
        path: `queues.${queue.queueKey}.projectedFields.${index}.fieldKey`,
        message: 'Projected Field key must start with a letter, for example firstName.',
        inputId: fieldInputId(`${queue.queueKey}-projected-${index}-key`)
      });
    }
    if (authored.has(field.fieldKey)) {
      details.push({
        field: 'projectedFields',
        path: `queues.${queue.queueKey}.projectedFields.${index}.fieldKey`,
        message: `Projected Field key ${field.fieldKey} is already used on this queue.`,
        inputId: fieldInputId(`${queue.queueKey}-projected-${index}-key`)
      });
    } else if (field.fieldKey) {
      authored.set(field.fieldKey, true);
    }
    if (queueFieldByKey(field.fieldKey)) {
      details.push({
        field: 'projectedFields',
        path: `queues.${queue.queueKey}.projectedFields.${index}.fieldKey`,
        message: `${field.fieldKey} is already a platform projection. Use it in Columns without adding it here.`,
        inputId: fieldInputId(`${queue.queueKey}-projected-${index}-key`)
      });
    }
    if (!field.label.trim()) {
      details.push({
        field: 'projectedFields',
        path: `queues.${queue.queueKey}.projectedFields.${index}.label`,
        message: `Projected field ${field.fieldKey || index + 1} needs a column label.`,
        inputId: fieldInputId(`${queue.queueKey}-projected-${index}-label`)
      });
    }
    if (!field.path.startsWith('$')) {
      details.push({
        field: 'projectedFields',
        path: `queues.${queue.queueKey}.projectedFields.${index}.path`,
        message: `Projected field ${field.fieldKey || index + 1} needs a JSONPath starting with $.`,
        inputId: fieldInputId(`${queue.queueKey}-projected-${index}-path`)
      });
    }
  }
  for (const column of queue.columns) {
    if (authored.has(column)) {
      continue;
    }
    try {
      requireQueueField(column, 'column');
    } catch (error) {
      pushError(details, error);
    }
  }
  for (const filter of queue.filters) {
    try {
      requireQueueField(filter, 'filter');
    } catch (error) {
      pushError(details, error);
    }
  }
  for (const sort of queue.defaultSort) {
    try {
      requireQueueField(sort.field, 'sort');
    } catch (error) {
      pushError(details, error);
    }
  }
  for (const action of queue.actions) {
    if (!(QUEUE_ACTIONS as readonly string[]).includes(action)) {
      details.push({
        field: 'actions',
        path: `queues.${queue.queueKey}.actions`,
        message: `Queue action ${action} is not supported. Use ASSIGN_TO_SELF or RELEASE_TO_QUEUE.`,
        inputId: fieldInputId(action)
      });
    }
  }

  if (options.requireEligibility || !isEmptyEligibility(queue.eligibility)) {
    try {
      parseQueueEligibility(queue.eligibility, queue.queueKey);
    } catch (error) {
      pushError(details, error);
    }
  }

  if (options.requireEligibility && queue.columns.length === 0) {
    details.push({
      field: 'columns',
      path: `queues.${queue.queueKey}.columns`,
      message: 'A publishable queue must declare at least one column.',
      inputId: fieldInputId('columns')
    });
  }

  if (details.length > 0) {
    throw validationFailed(
      'OPTIC-CONFIG-40026',
      `Queue ${queue.queueKey || 'definition'} failed validation.`,
      details
    );
  }
}

function pushError(details: ErrorDetails, error: unknown): void {
  if (error && typeof error === 'object' && 'details' in error) {
    details.push(...((error as { details: ErrorDetails }).details));
    return;
  }
  if (error instanceof Error) {
    details.push({ message: error.message });
  }
}
