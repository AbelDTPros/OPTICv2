import { fieldStoragePath, isSharedEntityPath } from '../../configuration/domain/shared-entity-paths.js';
import type { FormFieldDefinition, StageFormDefinition } from '../../configuration/domain/types.js';
import { joinJsonPath } from './merge-patch.js';

export interface FieldDelta {
  fieldKey: string;
  path: string;
  before: unknown;
  after: unknown;
  piiClassification?: string;
  splunkPolicy?: FormFieldDefinition['splunkPolicy'];
}

export interface AuditFieldChange {
  fieldKey: string;
  path: string;
  classification: string | null;
  before: unknown;
  after: unknown;
}

export function toAuditChanges(deltas: FieldDelta[]): AuditFieldChange[] {
  return deltas.map((delta) => ({
    fieldKey: delta.fieldKey,
    path: delta.path,
    classification: delta.piiClassification ?? null,
    before: delta.before,
    after: delta.after
  }));
}

export function calculateFieldDeltas(
  beforeDoc: unknown,
  afterDoc: unknown,
  form: StageFormDefinition
): FieldDelta[] {
  const beforeLeaves = flattenLeaves(beforeDoc, '$');
  const afterLeaves = flattenLeaves(afterDoc, '$');
  const paths = new Set([...beforeLeaves.keys(), ...afterLeaves.keys()]);
  const fields = indexFields(form);
  const deltas: FieldDelta[] = [];

  for (const path of [...paths].sort()) {
    if (!isTrackedFormPath(path, form, fields)) {
      continue;
    }
    const before = beforeLeaves.has(path) ? beforeLeaves.get(path) : undefined;
    const after = afterLeaves.has(path) ? afterLeaves.get(path) : undefined;
    if (Object.is(before, after)) {
      continue;
    }
    const field = fields.get(path);
    deltas.push({
      fieldKey: field?.fieldKey ?? path.replace(/^\$\./, '').replace(/\./g, '_').toUpperCase(),
      path,
      before: before === undefined ? null : before,
      after: after === undefined ? null : after,
      ...(field?.piiClassification ? { piiClassification: field.piiClassification } : {}),
      ...(field?.splunkPolicy ? { splunkPolicy: field.splunkPolicy } : {})
    });
  }
  return deltas;
}

function indexFields(form: StageFormDefinition): Map<string, FormFieldDefinition> {
  const index = new Map<string, FormFieldDefinition>();
  for (const section of form.sections) {
    for (const field of section.fields) {
      const storage = fieldStoragePath(form, field);
      index.set(storage, field);
      index.set(field.path, field);
      if (!isSharedEntityPath(field.path)) {
        index.set(joinJsonPath(form.dataPath, field.path), field);
      }
    }
  }
  return index;
}

function isTrackedFormPath(
  leafPath: string,
  form: StageFormDefinition,
  fields: Map<string, FormFieldDefinition>
): boolean {
  if (fields.has(leafPath)) {
    return true;
  }
  if (isUnderPath(leafPath, form.dataPath)) {
    return true;
  }
  return [...fields.keys()].some(
    (fieldPath) => isSharedEntityPath(fieldPath) && (leafPath === fieldPath || leafPath.startsWith(`${fieldPath}.`))
  );
}

function isUnderPath(leafPath: string, dataPath: string): boolean {
  if (dataPath === '$') {
    return true;
  }
  return leafPath === dataPath || leafPath.startsWith(`${dataPath}.`);
}

function flattenLeaves(value: unknown, path: string): Map<string, unknown> {
  const leaves = new Map<string, unknown>();
  walk(value, path, leaves);
  return leaves;
}

function walk(value: unknown, path: string, leaves: Map<string, unknown>): void {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      leaves.set(path, value);
      return;
    }
    for (const [key, child] of entries) {
      walk(child, path === '$' ? `$.${key}` : `${path}.${key}`, leaves);
    }
    return;
  }
  leaves.set(path, value);
}
