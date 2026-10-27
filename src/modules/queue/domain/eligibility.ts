import { fieldInputId, validationFailed } from '../../../platform/errors/app-error.js';
import type { RuleOperator } from '../../configuration/domain/types.js';
import { evaluateOperator, normalizeOperator, normalizeOperatorName } from '../../../rules/operators.js';
import { queueFieldBySource, SQL_SAFE_OPERATORS } from './fields.js';
import type { QueueProjectionRecord } from './types.js';

export type QueueEligibilitySource = 'workflow' | 'system' | 'business';

export interface QueueEligibilityPredicate {
  source: QueueEligibilitySource;
  field: string;
  operator: string;
  value?: unknown;
}

export type QueueEligibility =
  | { all: QueueEligibility[] }
  | { any: QueueEligibility[] }
  | { not: QueueEligibility }
  | QueueEligibilityPredicate;

export type SqlParam = string | number | boolean | Date | null;

export interface SqlClause {
  sql: string;
  params: SqlParam[];
}

export function isEmptyEligibility(value: unknown): boolean {
  return value == null || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
}

export function isEligibilityPredicate(value: unknown): value is QueueEligibilityPredicate {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return 'source' in value && 'field' in value && 'operator' in value;
}

export function parseQueueEligibility(value: unknown, queueKey = 'queue'): QueueEligibility {
  if (isEmptyEligibility(value)) {
    throw validationFailed(
      'OPTIC-CONFIG-40026',
      'Queue eligibility must be a declarative predicate over projected fields.',
      [
        {
          field: 'eligibility',
          path: `queues.${queueKey}.eligibility`,
          message: 'Eligibility is required and cannot be empty.',
          inputId: fieldInputId('eligibility')
        }
      ]
    );
  }
  return parseNode(value, `queues.${queueKey}.eligibility`, queueKey);
}

function parseNode(value: unknown, path: string, queueKey: string): QueueEligibility {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidEligibility(path, 'Eligibility must be an object.');
  }
  const record = value as Record<string, unknown>;
  if ('all' in record) {
    if (!Array.isArray(record.all) || record.all.length === 0) {
      throw invalidEligibility(`${path}.all`, 'all must be a non-empty array.');
    }
    return { all: record.all.map((item, index) => parseNode(item, `${path}.all.${index}`, queueKey)) };
  }
  if ('any' in record) {
    if (!Array.isArray(record.any) || record.any.length === 0) {
      throw invalidEligibility(`${path}.any`, 'any must be a non-empty array.');
    }
    return { any: record.any.map((item, index) => parseNode(item, `${path}.any.${index}`, queueKey)) };
  }
  if ('not' in record) {
    return { not: parseNode(record.not, `${path}.not`, queueKey) };
  }
  if (!isEligibilityPredicate(record)) {
    throw invalidEligibility(path, 'Predicate must declare source, field, and operator.');
  }
  if (record.source !== 'workflow' && record.source !== 'system' && record.source !== 'business') {
    throw invalidEligibility(`${path}.source`, `Unknown eligibility source ${String(record.source)}.`);
  }
  const spec = queueFieldBySource(record.source, record.field);
  if (!spec) {
    throw validationFailed(
      'OPTIC-CONFIG-40026',
      `Queue eligibility field ${record.source}.${record.field} is not projected.`,
      [
        {
          field: record.field,
          path: `${path}.field`,
          message: `${record.source}.${record.field} cannot be queried from JSON. Use an approved projection field.`,
          inputId: fieldInputId(record.field)
        }
      ]
    );
  }
  let operator: RuleOperator;
  try {
    operator = normalizeOperator(String(record.operator));
  } catch {
    throw validationFailed('OPTIC-CONFIG-40026', `Queue eligibility operator ${String(record.operator)} is not supported.`, [
      {
        field: 'operator',
        path: `${path}.operator`,
        message: `Unknown operator ${String(record.operator)}.`,
        inputId: fieldInputId('operator')
      }
    ]);
  }
  if (!SQL_SAFE_OPERATORS.has(operator)) {
    throw validationFailed(
      'OPTIC-CONFIG-40026',
      `Queue eligibility operator ${operator} cannot be translated to parameterized SQL.`,
      [
        {
          field: 'operator',
          path: `${path}.operator`,
          message: `${operator} is not allowed on operational queues.`,
          inputId: fieldInputId('operator')
        }
      ]
    );
  }
  return {
    source: record.source,
    field: record.field,
    operator,
    value: record.value
  };
}

export function eligibilityToSql(eligibility: QueueEligibility, alias = 'p'): SqlClause {
  if ('all' in eligibility) {
    const parts = eligibility.all.map((node) => eligibilityToSql(node, alias));
    return combine(parts, 'AND');
  }
  if ('any' in eligibility) {
    const parts = eligibility.any.map((node) => eligibilityToSql(node, alias));
    return combine(parts, 'OR');
  }
  if ('not' in eligibility) {
    const inner = eligibilityToSql(eligibility.not, alias);
    return { sql: `NOT (${inner.sql})`, params: inner.params };
  }
  return predicateToSql(eligibility, alias);
}

export function matchesEligibility(row: QueueProjectionRecord, eligibility: QueueEligibility): boolean {
  if ('all' in eligibility) {
    return eligibility.all.every((node) => matchesEligibility(row, node));
  }
  if ('any' in eligibility) {
    return eligibility.any.some((node) => matchesEligibility(row, node));
  }
  if ('not' in eligibility) {
    return !matchesEligibility(row, eligibility.not);
  }
  const resolved = readProjectedValue(row, eligibility.source, eligibility.field);
  const operator = normalizeOperatorName(eligibility.operator) as RuleOperator;
  if (operator === 'TRUE') {
    return resolved === true;
  }
  if (operator === 'FALSE') {
    return resolved === false;
  }
  return evaluateOperator(operator, resolved, eligibility.value);
}

export function readProjectedValue(
  row: QueueProjectionRecord,
  source: string,
  field: string
): unknown {
  const spec = queueFieldBySource(source, field);
  if (!spec) {
    return undefined;
  }
  switch (spec.sqlColumn) {
    case 'entity_tracking_id':
      return row.entityTrackingId;
    case 'entity_type':
      return row.entityType;
    case 'definition_key':
      return row.definitionKey;
    case 'current_stage_key':
      return row.currentStageKey;
    case 'assigned_to':
      return row.assignedTo;
    case 'entered_stage_at':
      return row.enteredStageAt.toISOString();
    case 'workload_type':
      return row.workloadType;
    case 'receipt_number':
      return row.receiptNumber;
    case 'received_at':
      return row.receivedAt ? row.receivedAt.toISOString() : null;
    case 'sla_state':
      return row.slaState;
    case 'branch_key':
      return row.branchKey;
    case 'location_key':
      return row.locationKey;
    case 'priority':
      return row.priority;
    case 'status':
      return row.status;
    default:
      return undefined;
  }
}

function predicateToSql(predicate: QueueEligibilityPredicate, alias: string): SqlClause {
  const spec = queueFieldBySource(predicate.source, predicate.field);
  if (!spec) {
    throw validationFailed('OPTIC-CONFIG-40026', `Queue eligibility field ${predicate.field} is not projected.`);
  }
  const column = `${alias}.${spec.sqlColumn}`;
  const operator = normalizeOperator(predicate.operator);
  switch (operator) {
    case 'EQUALS':
      return { sql: `${column} = ?`, params: [asSqlParam(predicate.value)] };
    case 'NOT_EQUALS':
      return { sql: `${column} <> ?`, params: [asSqlParam(predicate.value)] };
    case 'IN': {
      const values = Array.isArray(predicate.value) ? predicate.value.map(asSqlParam) : [];
      if (values.length === 0) {
        return { sql: '0 = 1', params: [] };
      }
      return { sql: `${column} IN (${values.map(() => '?').join(', ')})`, params: values };
    }
    case 'NOT_IN': {
      const values = Array.isArray(predicate.value) ? predicate.value.map(asSqlParam) : [];
      if (values.length === 0) {
        return { sql: '1 = 1', params: [] };
      }
      return { sql: `${column} NOT IN (${values.map(() => '?').join(', ')})`, params: values };
    }
    case 'IS_NULL':
    case 'NOT_EXISTS':
      return { sql: `${column} IS NULL`, params: [] };
    case 'NOT_NULL':
    case 'EXISTS':
      return { sql: `${column} IS NOT NULL`, params: [] };
    case 'TRUE':
      return { sql: `${column} = ?`, params: [true] };
    case 'FALSE':
      return { sql: `${column} = ?`, params: [false] };
    default:
      throw validationFailed('OPTIC-CONFIG-40026', `Queue eligibility operator ${operator} is not SQL-safe.`);
  }
}

function combine(parts: SqlClause[], joiner: 'AND' | 'OR'): SqlClause {
  if (parts.length === 1 && parts[0]) {
    return parts[0];
  }
  return {
    sql: parts.map((part) => `(${part.sql})`).join(` ${joiner} `),
    params: parts.flatMap((part) => part.params)
  };
}

function asSqlParam(value: unknown): SqlParam {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
}

function invalidEligibility(path: string, message: string) {
  return validationFailed('OPTIC-CONFIG-40026', message, [
    {
      field: 'eligibility',
      path,
      message,
      inputId: fieldInputId('eligibility')
    }
  ]);
}
