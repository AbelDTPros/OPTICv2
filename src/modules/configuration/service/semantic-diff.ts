import type { DefinitionRelease, StageFormDefinition } from '../domain/types.js';
import { buildCanonicalPackage, stableStringify } from './canonical-package.js';

export type DiffCategory =
  | 'metadata'
  | 'schema'
  | 'validations'
  | 'stages'
  | 'transitions'
  | 'forms'
  | 'fields'
  | 'actions'
  | 'queues'
  | 'bulkActions'
  | 'scheduledActions'
  | 'slas'
  | 'search';

export type DiffChangeType = 'ADDED' | 'REMOVED' | 'CHANGED';

export interface SemanticDiffChange {
  category: DiffCategory;
  change: DiffChangeType;
  key: string;
  path?: string;
  before?: unknown;
  after?: unknown;
}

export interface SemanticDiff {
  fromVersion: string;
  toVersion: string;
  changes: SemanticDiffChange[];
  raw: {
    from: string;
    to: string;
  };
}

export function diffReleases(from: DefinitionRelease, to: DefinitionRelease): SemanticDiff {
  const changes: SemanticDiffChange[] = [];
  compareValue(changes, 'metadata', 'displayName', from.displayName, to.displayName);
  compareValue(changes, 'metadata', 'entityType', from.entityType, to.entityType);
  compareTree(changes, 'schema', 'schema', from.schema, to.schema);
  compareTree(changes, 'validations', 'schema.required', requiredOf(from.schema), requiredOf(to.schema));
  compareKeyed(
    changes,
    'stages',
    Object.fromEntries(from.workflow.stages.map((stage) => [stage.stageKey, stage])),
    Object.fromEntries(to.workflow.stages.map((stage) => [stage.stageKey, stage]))
  );
  compareKeyed(
    changes,
    'transitions',
    Object.fromEntries(from.workflow.transitionSets.map((set) => [set.transitionSetKey, set])),
    Object.fromEntries(to.workflow.transitionSets.map((set) => [set.transitionSetKey, set]))
  );
  compareValue(changes, 'transitions', 'initialStageKey', from.workflow.initialStageKey, to.workflow.initialStageKey);
  compareKeyed(changes, 'forms', from.forms, to.forms);
  compareKeyed(changes, 'fields', flattenFields(from.forms), flattenFields(to.forms));
  compareKeyed(changes, 'actions', from.actions, to.actions);
  compareKeyed(changes, 'queues', from.queues, to.queues);
  compareKeyed(changes, 'bulkActions', from.bulkActions, to.bulkActions);
  compareKeyed(changes, 'scheduledActions', from.scheduledActions, to.scheduledActions);
  compareKeyed(changes, 'slas', from.slas, to.slas);
  compareTree(changes, 'search', 'search', from.search, to.search);
  return {
    fromVersion: from.version,
    toVersion: to.version,
    changes,
    raw: {
      from: stableStringify(buildCanonicalPackage(from)),
      to: stableStringify(buildCanonicalPackage(to))
    }
  };
}

function flattenFields(forms: Record<string, StageFormDefinition>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const form of Object.values(forms)) {
    for (const section of form.sections ?? []) {
      for (const field of section.fields ?? []) {
        fields[`${form.formKey}.${field.fieldKey}`] = field;
      }
    }
  }
  return fields;
}

function requiredOf(schema: Record<string, unknown>): string[] {
  return Array.isArray(schema.required) ? [...(schema.required as string[])].sort() : [];
}

function compareKeyed(
  changes: SemanticDiffChange[],
  category: DiffCategory,
  from: Record<string, unknown>,
  to: Record<string, unknown>
): void {
  for (const key of new Set([...Object.keys(from), ...Object.keys(to)]).values()) {
    if (!(key in from)) {
      changes.push({ category, change: 'ADDED', key, path: key, after: to[key] });
    } else if (!(key in to)) {
      changes.push({ category, change: 'REMOVED', key, path: key, before: from[key] });
    } else if (stableStringify(from[key]) !== stableStringify(to[key])) {
      changes.push({
        category,
        change: 'CHANGED',
        key,
        path: key,
        before: from[key],
        after: to[key]
      });
      compareTree(changes, category, key, from[key], to[key]);
    }
  }
}

function compareValue(
  changes: SemanticDiffChange[],
  category: DiffCategory,
  key: string,
  from: unknown,
  to: unknown
): void {
  if (stableStringify(from) !== stableStringify(to)) {
    changes.push({ category, change: 'CHANGED', key, path: key, before: from, after: to });
  }
}

function compareTree(
  changes: SemanticDiffChange[],
  category: DiffCategory,
  prefix: string,
  from: unknown,
  to: unknown
): void {
  if (stableStringify(from) === stableStringify(to)) {
    return;
  }
  const fromObject = isPlainObject(from);
  const toObject = isPlainObject(to);
  if (!fromObject || !toObject) {
    if (prefix.includes('.')) {
      changes.push({ category, change: 'CHANGED', key: prefix, path: prefix, before: from, after: to });
    }
    return;
  }
  for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
    const path = `${prefix}.${key}`;
    if (!(key in from)) {
      changes.push({ category, change: 'ADDED', key: path, path, after: to[key] });
    } else if (!(key in to)) {
      changes.push({ category, change: 'REMOVED', key: path, path, before: from[key] });
    } else {
      compareTree(changes, category, path, from[key], to[key]);
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
