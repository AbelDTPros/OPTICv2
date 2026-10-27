import { validationFailed } from '../../../platform/errors/app-error.js';
import type { ActorContext } from '../../../platform/security/actor.js';
import type { RuleOperator } from '../../configuration/domain/types.js';
import { evaluateOperator, normalizeOperator, normalizeOperatorName } from '../../../rules/operators.js';
import type { WorkflowInstanceRecord } from '../../workflow/domain/types.js';

const INSTANCE_FIELDS = new Set(['currentStageKey', 'assignedTo', 'entityType', 'status']);

export type BulkEligibility =
  | { all: BulkEligibility[] }
  | { any: BulkEligibility[] }
  | { not: BulkEligibility }
  | { source: 'workflow'; field: string; operator: string; value?: unknown };

export function assertBulkEligibility(
  eligibility: Record<string, unknown> | undefined,
  instance: WorkflowInstanceRecord,
  actor: ActorContext
): void {
  if (!eligibility || Object.keys(eligibility).length === 0) {
    return;
  }
  if (eligibility.requireUnassignedOrAssignedToCurrentUser === true) {
    if (instance.assignedTo && instance.assignedTo !== actor.actorId) {
      throw eligibilityFailed(
        instance.entityTrackingId,
        `${instance.entityTrackingId} is assigned to another user.`,
        'Select unassigned items or items assigned to you.'
      );
    }
  }
  const expression = parseOptionalExpression(eligibility);
  if (expression && !matchesBulkEligibility(expression, instance, actor)) {
    throw eligibilityFailed(
      instance.entityTrackingId,
      `${instance.entityTrackingId} is not eligible for this bulk action.`,
      'The item does not match the configured bulk eligibility.'
    );
  }
}

export function matchesBulkEligibility(
  eligibility: BulkEligibility,
  instance: WorkflowInstanceRecord,
  actor: ActorContext
): boolean {
  if ('all' in eligibility) {
    return eligibility.all.every((node) => matchesBulkEligibility(node, instance, actor));
  }
  if ('any' in eligibility) {
    return eligibility.any.some((node) => matchesBulkEligibility(node, instance, actor));
  }
  if ('not' in eligibility) {
    return !matchesBulkEligibility(eligibility.not, instance, actor);
  }
  const resolved = readInstanceField(instance, eligibility.field);
  const expected = resolveEligibilityValue(eligibility.value, actor);
  const operator = normalizeOperatorName(eligibility.operator) as RuleOperator;
  return evaluateOperator(operator, resolved, expected);
}

function parseOptionalExpression(eligibility: Record<string, unknown>): BulkEligibility | null {
  const rest = { ...eligibility };
  delete rest.requireUnassignedOrAssignedToCurrentUser;
  if (Object.keys(rest).length === 0) {
    return null;
  }
  return parseNode(rest, 'eligibility');
}

function parseNode(value: unknown, path: string): BulkEligibility {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationFailed('OPTIC-WF-40085', 'Bulk eligibility must be an object.', [
      { field: 'eligibility', path, message: 'Eligibility must be an object.' }
    ]);
  }
  const record = value as Record<string, unknown>;
  if ('all' in record) {
    if (!Array.isArray(record.all) || record.all.length === 0) {
      throw validationFailed('OPTIC-WF-40085', 'Bulk eligibility all must be a non-empty array.', [
        { field: 'eligibility', path: `${path}.all`, message: 'all must be a non-empty array.' }
      ]);
    }
    return { all: record.all.map((item, index) => parseNode(item, `${path}.all.${index}`)) };
  }
  if ('any' in record) {
    if (!Array.isArray(record.any) || record.any.length === 0) {
      throw validationFailed('OPTIC-WF-40085', 'Bulk eligibility any must be a non-empty array.', [
        { field: 'eligibility', path: `${path}.any`, message: 'any must be a non-empty array.' }
      ]);
    }
    return { any: record.any.map((item, index) => parseNode(item, `${path}.any.${index}`)) };
  }
  if ('not' in record) {
    return { not: parseNode(record.not, `${path}.not`) };
  }
  if (record.source !== 'workflow' || typeof record.field !== 'string' || typeof record.operator !== 'string') {
    throw validationFailed(
      'OPTIC-WF-40085',
      'Bulk eligibility predicates must declare source workflow, field, and operator.',
      [{ field: 'eligibility', path, message: 'Use source, field, and operator.' }]
    );
  }
  if (!INSTANCE_FIELDS.has(record.field)) {
    throw validationFailed(
      'OPTIC-WF-40085',
      `Bulk eligibility field ${record.field} is not supported.`,
      [{ field: record.field, path: `${path}.field`, message: 'Use currentStageKey, assignedTo, entityType, or status.' }]
    );
  }
  normalizeOperator(record.operator);
  return {
    source: 'workflow',
    field: record.field,
    operator: record.operator,
    value: record.value
  };
}

function readInstanceField(instance: WorkflowInstanceRecord, field: string): unknown {
  switch (field) {
    case 'currentStageKey':
      return instance.currentStageKey;
    case 'assignedTo':
      return instance.assignedTo;
    case 'entityType':
      return instance.entityType;
    case 'status':
      return instance.status;
    default:
      return undefined;
  }
}

function resolveEligibilityValue(value: unknown, actor: ActorContext): unknown {
  if (value === '$currentUser') {
    return actor.actorId;
  }
  return value;
}

function eligibilityFailed(trackingId: string, message: string, detail: string) {
  return validationFailed('OPTIC-WF-40085', message, [
    {
      field: 'trackingId',
      path: 'items.trackingId',
      message: `${trackingId}: ${detail}`
    }
  ]);
}
