import { evaluateExpression } from '../../../rules/evaluator.js';
import { joinJsonPath, wrapAtDataPath } from '../../workflow/domain/merge-patch.js';
import { isSharedEntityPath } from './shared-entity-paths.js';
import type { FormFieldDefinition, RuleExpression, StageFormDefinition } from './types.js';

export interface FieldRuntimeState {
  visible: boolean;
  required: boolean;
  readOnly: boolean;
}

const DISPLAY_ONLY = new Set(['READ_ONLY_VALUE', 'TRACKING_ID_DISPLAY', 'USER_DISPLAY', 'ALERT']);

export function resolveFieldStates(
  form: StageFormDefinition,
  formValue: unknown,
  workflow?: Record<string, unknown>,
  options?: { forceReadOnly?: boolean; businessData?: unknown }
): Record<string, FieldRuntimeState> {
  const states: Record<string, FieldRuntimeState> = {};
  const fields = form.sections.flatMap((section) => section.fields);
  for (const field of fields) {
    states[field.fieldKey] = baseState(field);
  }

  for (const field of fields) {
    const targeted = (form.behaviors ?? []).filter((behavior) =>
      behavior.effects.some((effect) => effect.fieldKey === field.fieldKey && effect.visible === true)
    );
    if (targeted.length > 0) {
      states[field.fieldKey] = { ...states[field.fieldKey]!, visible: false };
    }
  }

  const caseData =
    options?.businessData !== undefined
      ? options.businessData
      : wrapAtDataPath(form.dataPath || '$', formValue ?? {});
  const relativeFieldPaths = listRelativeFieldPaths(form);

  for (const behavior of form.behaviors ?? []) {
    let matched = false;
    try {
      const when = absolutizeFormExpression(behavior.when, form.dataPath || '$', relativeFieldPaths);
      matched = evaluateExpression(when, { businessData: caseData, workflow }).matched;
    } catch {
      matched = false;
    }
    if (!matched) {
      continue;
    }
    for (const effect of behavior.effects) {
      const current = states[effect.fieldKey];
      if (!current) {
        continue;
      }
      states[effect.fieldKey] = {
        visible: effect.visible ?? current.visible,
        required: effect.required ?? current.required,
        readOnly: effect.readOnly ?? current.readOnly
      };
    }
  }

  if (options?.forceReadOnly) {
    for (const key of Object.keys(states)) {
      states[key] = { ...states[key]!, readOnly: true, required: false };
    }
  }
  return states;
}

/** Exported for tests: form-relative $.field → $.dataPath.field when the field lives on this form. */
export function absolutizeFormExpression(
  expression: RuleExpression,
  dataPath: string,
  relativeFieldPaths: Set<string>
): RuleExpression {
  if ('all' in expression) {
    return { all: expression.all.map((child) => absolutizeFormExpression(child, dataPath, relativeFieldPaths)) };
  }
  if ('any' in expression) {
    return { any: expression.any.map((child) => absolutizeFormExpression(child, dataPath, relativeFieldPaths)) };
  }
  if ('not' in expression) {
    return { not: absolutizeFormExpression(expression.not, dataPath, relativeFieldPaths) };
  }
  if (!('path' in expression)) {
    return expression;
  }
  const path = absolutizeFormPath(expression.path, dataPath, relativeFieldPaths);
  let value = expression.value;
  if (typeof value === 'string' && value.startsWith('$.')) {
    value = absolutizeFormPath(value, dataPath, relativeFieldPaths);
  }
  return { ...expression, path, value };
}

function absolutizeFormPath(path: string, dataPath: string, relativeFieldPaths: Set<string>): string {
  if (!path.startsWith('$.') || path.startsWith('$workflow') || isSharedEntityPath(path)) {
    return path;
  }
  const root = dataPath?.trim() || '$';
  if (root === '$') {
    return path;
  }
  if (path === root || path.startsWith(`${root}.`) || path.startsWith(`${root}[`)) {
    return path;
  }
  if (isFormRelativePath(path, relativeFieldPaths)) {
    return joinJsonPath(root, path);
  }
  return path;
}

function isFormRelativePath(path: string, relativeFieldPaths: Set<string>): boolean {
  for (const fieldPath of relativeFieldPaths) {
    if (path === fieldPath || path.startsWith(`${fieldPath}.`) || path.startsWith(`${fieldPath}[`)) {
      return true;
    }
  }
  return false;
}

function listRelativeFieldPaths(form: StageFormDefinition): Set<string> {
  const paths = new Set<string>();
  for (const section of form.sections) {
    for (const field of section.fields) {
      if (field.path?.trim()) {
        paths.add(field.path.trim());
      }
    }
  }
  return paths;
}

function baseState(field: FormFieldDefinition): FieldRuntimeState {
  const readOnly = DISPLAY_ONLY.has(field.component);
  return {
    visible: true,
    required: !readOnly && Boolean(field.required),
    readOnly
  };
}
