import { fieldNeedsProjection } from '../../configuration/domain/indexed-fields.js';
import type { DefinitionRelease } from '../../configuration/domain/types.js';
import { isEmptyEligibility, isEligibilityPredicate, type QueueEligibility } from './eligibility.js';
import { queueFieldByKey, queueFieldBySource, type QueueFieldSpec } from './fields.js';

export interface ProjectionRequirement {
  key: string;
  source: string;
  field: string;
  sqlColumn: string;
  usedBy: string[];
}

export function collectProjectionRequirements(release: DefinitionRelease): ProjectionRequirement[] {
  const used = new Map<string, ProjectionRequirement>();

  const add = (spec: QueueFieldSpec | undefined, usedBy: string): void => {
    if (!spec) {
      return;
    }
    const existing = used.get(spec.key);
    if (existing) {
      if (!existing.usedBy.includes(usedBy)) {
        existing.usedBy.push(usedBy);
      }
      return;
    }
    used.set(spec.key, {
      key: spec.key,
      source: spec.source,
      field: spec.field,
      sqlColumn: spec.sqlColumn,
      usedBy: [usedBy]
    });
  };

  for (const queue of Object.values(release.queues)) {
    for (const field of queue.projectedFields ?? []) {
      add(
        {
          key: field.fieldKey,
          label: field.label,
          source: 'business',
          field: field.fieldKey,
          sqlColumn: 'projected_json',
          filterable: false,
          sortable: false,
          projected: true
        },
        `queues.${queue.queueKey}.projectedFields`
      );
    }
    for (const column of queue.columns) {
      add(queueFieldByKey(column), `queues.${queue.queueKey}.columns`);
    }
    for (const filter of queue.filters) {
      add(queueFieldByKey(filter), `queues.${queue.queueKey}.filters`);
    }
    for (const sort of queue.defaultSort) {
      add(queueFieldByKey(sort.field), `queues.${queue.queueKey}.defaultSort`);
    }
    if (!isEmptyEligibility(queue.eligibility)) {
      walkEligibility(queue.eligibility as QueueEligibility, (spec) =>
        add(spec, `queues.${queue.queueKey}.eligibility`)
      );
    }
  }

  for (const searchField of release.search.fields) {
    if (searchField.source === 'BUSINESS_DATA' && fieldNeedsProjection(searchField)) {
      const fromPath = pathToFieldKey(searchField.path);
      add(queueFieldByKey(fromPath) ?? queueFieldByKey(searchField.fieldKey), `search.${searchField.fieldKey}`);
    }
  }

  return [...used.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function walkEligibility(node: QueueEligibility, visit: (spec: QueueFieldSpec) => void): void {
  if ('all' in node) {
    node.all.forEach((item) => walkEligibility(item, visit));
    return;
  }
  if ('any' in node) {
    node.any.forEach((item) => walkEligibility(item, visit));
    return;
  }
  if ('not' in node) {
    walkEligibility(node.not, visit);
    return;
  }
  if (isEligibilityPredicate(node)) {
    const spec = queueFieldBySource(node.source, node.field);
    if (spec) {
      visit(spec);
    }
  }
}

function pathToFieldKey(path: string): string {
  const trimmed = path.replace(/^\$\.?/, '');
  const last = trimmed.split('.').filter(Boolean).at(-1);
  return last ?? trimmed;
}
