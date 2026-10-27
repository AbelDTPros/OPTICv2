import { validationFailed } from '../../../platform/errors/app-error.js';
import { eligibilityToSql, matchesEligibility, type SqlClause, type SqlParam } from './eligibility.js';
import { queueFieldByKey } from './fields.js';
import type { QueueProjectionRecord, QueueQuery, QueueQueryResult, QueueQuerySort } from './types.js';

export function applyQueueQuery(rows: QueueProjectionRecord[], query: QueueQuery): QueueQueryResult {
  const matched = rows.filter(
    (row) =>
      row.entityType === query.entityType &&
      (!query.definitionKey || row.definitionKey === query.definitionKey) &&
      matchesEligibility(row, query.eligibility)
  );
  const filtered = matched.filter((row) => matchesFilters(row, query.filters, query.actorId));
  const sorted = [...filtered].sort((left, right) => compareRows(left, right, query.sort));
  const start = (query.page - 1) * query.pageSize;
  return {
    total: sorted.length,
    rows: sorted.slice(start, start + query.pageSize)
  };
}

export function filtersToSql(filters: Record<string, string>, actorId: string | undefined, alias = 'p'): SqlClause {
  const parts: SqlClause[] = [];
  for (const [key, raw] of Object.entries(filters)) {
    const value = raw.trim();
    if (!value) {
      continue;
    }
    if (key === 'assignedStatus') {
      parts.push(assignedStatusSql(value, actorId, alias));
      continue;
    }
    const spec = queueFieldByKey(key);
    if (!spec?.filterable) {
      throw validationFailed('OPTIC-WF-40060', `Filter ${key} is not allowed on this queue.`);
    }
    parts.push({ sql: `${alias}.${spec.sqlColumn} = ?`, params: [value] });
  }
  if (parts.length === 0) {
    return { sql: '1 = 1', params: [] };
  }
  return {
    sql: parts.map((part) => part.sql).join(' AND '),
    params: parts.flatMap((part) => part.params)
  };
}

export function queueWhereSql(query: QueueQuery, alias = 'p'): SqlClause {
  const entity = { sql: `${alias}.entity_type = ?`, params: [query.entityType] as SqlParam[] };
  const definition = query.definitionKey
    ? { sql: `${alias}.definition_key = ?`, params: [query.definitionKey] as SqlParam[] }
    : { sql: '1 = 1', params: [] as SqlParam[] };
  const eligibility = eligibilityToSql(query.eligibility, alias);
  const filters = filtersToSql(query.filters, query.actorId, alias);
  return {
    sql: `${entity.sql} AND ${definition.sql} AND (${eligibility.sql}) AND (${filters.sql})`,
    params: [...entity.params, ...definition.params, ...eligibility.params, ...filters.params]
  };
}

export function queueOrderSql(sort: QueueQuerySort[], alias = 'p'): string {
  if (sort.length === 0) {
    return `${alias}.entered_stage_at ASC`;
  }
  return sort
    .map((item) => {
      const spec = queueFieldByKey(item.field);
      if (!spec?.sortable) {
        throw validationFailed('OPTIC-WF-40060', `Sort field ${item.field} is not allowed on this queue.`);
      }
      return `${alias}.${spec.sqlColumn} ${item.direction}`;
    })
    .join(', ');
}

function assignedStatusSql(value: string, actorId: string | undefined, alias: string): SqlClause {
  if (value === 'UNASSIGNED') {
    return { sql: `${alias}.assigned_to IS NULL`, params: [] };
  }
  if (value === 'ASSIGNED') {
    return { sql: `${alias}.assigned_to IS NOT NULL`, params: [] };
  }
  if (value === 'MINE') {
    return { sql: `${alias}.assigned_to = ?`, params: [actorId ?? ''] };
  }
  throw validationFailed('OPTIC-WF-40060', 'assignedStatus must be UNASSIGNED, ASSIGNED, or MINE.');
}

function matchesFilters(
  row: QueueProjectionRecord,
  filters: Record<string, string>,
  actorId: string | undefined
): boolean {
  for (const [key, raw] of Object.entries(filters)) {
    const value = raw.trim();
    if (!value) {
      continue;
    }
    if (key === 'assignedStatus') {
      if (value === 'UNASSIGNED' && row.assignedTo !== null) {
        return false;
      }
      if (value === 'ASSIGNED' && row.assignedTo === null) {
        return false;
      }
      if (value === 'MINE' && row.assignedTo !== actorId) {
        return false;
      }
      if (value !== 'UNASSIGNED' && value !== 'ASSIGNED' && value !== 'MINE') {
        throw validationFailed('OPTIC-WF-40060', 'assignedStatus must be UNASSIGNED, ASSIGNED, or MINE.');
      }
      continue;
    }
    const spec = queueFieldByKey(key);
    if (!spec?.filterable) {
      throw validationFailed('OPTIC-WF-40060', `Filter ${key} is not allowed on this queue.`);
    }
    const actual = readSqlColumn(row, spec.sqlColumn);
    if (String(actual ?? '') !== value) {
      return false;
    }
  }
  return true;
}

function compareRows(left: QueueProjectionRecord, right: QueueProjectionRecord, sort: QueueQuerySort[]): number {
  for (const item of sort) {
    const spec = queueFieldByKey(item.field);
    if (!spec?.sortable) {
      throw validationFailed('OPTIC-WF-40060', `Sort field ${item.field} is not allowed on this queue.`);
    }
    const comparison = compareValues(readSqlColumn(left, spec.sqlColumn), readSqlColumn(right, spec.sqlColumn));
    if (comparison !== 0) {
      return item.direction === 'ASC' ? comparison : -comparison;
    }
  }
  return left.workflowInstanceId - right.workflowInstanceId;
}

function compareValues(left: unknown, right: unknown): number {
  if (left == null && right == null) {
    return 0;
  }
  if (left == null) {
    return 1;
  }
  if (right == null) {
    return -1;
  }
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }
  return String(left).localeCompare(String(right));
}

function readSqlColumn(row: QueueProjectionRecord, sqlColumn: string): unknown {
  switch (sqlColumn) {
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
      return row.enteredStageAt;
    case 'workload_type':
      return row.workloadType;
    case 'receipt_number':
      return row.receiptNumber;
    case 'received_at':
      return row.receivedAt;
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
      return null;
  }
}
