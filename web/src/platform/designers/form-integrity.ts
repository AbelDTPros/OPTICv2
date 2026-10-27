import {
  DISPLAY_FROM_COMPONENTS,
  displayFromStoragePath,
  formHasDisplayFromFields,
  resolveDisplayFromSource
} from '../../../../src/modules/configuration/domain/display-from.js';
import type {
  FormFieldDefinition,
  FormSectionDefinition,
  PacketFieldBinding,
  RuleExpression,
  StageFormDefinition
} from '../../../../src/modules/configuration/domain/types.js';
import {
  fieldStoragePath,
  isSharedEntityPath,
  sharedPathAllowedForEntity
} from '../../../../src/modules/configuration/domain/shared-entity-paths.js';
import { joinJsonPath } from '../../../../src/modules/workflow/domain/merge-patch.js';
import { findFormField } from '../dynamic-forms/repeating-section.js';

export interface DesignerIssue {
  path: string;
  message: string;
}

export { DISPLAY_FROM_COMPONENTS, displayFromStoragePath, formHasDisplayFromFields, resolveDisplayFromSource };

const WORKFLOW_PATH_PREFIX = '$workflow.';
const VISIBILITY_CHAIN_WARN_DEPTH = 4;

export function listFieldKeys(form: StageFormDefinition): Set<string> {
  return new Set(
    form.sections.flatMap((section) => section.fields.map((field) => field.fieldKey).filter(Boolean))
  );
}

/** Absolute and relative paths that resolve to a field on this form. */
export function listResolvableFieldPaths(form: StageFormDefinition): Map<string, string> {
  const paths = new Map<string, string>();
  for (const section of form.sections) {
    for (const field of section.fields) {
      if (!field.fieldKey || !field.path?.trim()) {
        continue;
      }
      for (const path of listPathsForField(form, field)) {
        paths.set(path, field.fieldKey);
      }
    }
  }
  return paths;
}

/** Paths authors may use in When / bindings that resolve to this field. */
export function listPathsForField(
  form: StageFormDefinition,
  field: Pick<FormFieldDefinition, 'path'>
): string[] {
  const authored = field.path?.trim();
  if (!authored) {
    return [];
  }
  const dataPath = form.dataPath || '$';
  const paths = new Set<string>([authored, fieldStoragePath(form, field)]);
  if (!isSharedEntityPath(authored)) {
    paths.add(joinJsonPath(dataPath, authored));
  }
  const leaf = authored.replace(/^\$\.?/, '').split('.').filter(Boolean).at(-1);
  if (leaf) {
    paths.add(`$.${leaf}`);
  }
  return [...paths];
}

/** Case-absolute storage paths for fields across forms (shared roots + dataPath joins). */
export function listReleaseCaseFieldPaths(
  forms: Record<string, StageFormDefinition> | StageFormDefinition[]
): Set<string> {
  const paths = new Set<string>();
  const list = Array.isArray(forms) ? forms : Object.values(forms);
  for (const form of list) {
    for (const section of form.sections ?? []) {
      for (const field of section.fields ?? []) {
        if (!field.path?.trim()) {
          continue;
        }
        paths.add(fieldStoragePath(form, field));
      }
    }
  }
  return paths;
}

export function collectExpressionPaths(expression: RuleExpression): string[] {
  if ('all' in expression) {
    return expression.all.flatMap(collectExpressionPaths);
  }
  if ('any' in expression) {
    return expression.any.flatMap(collectExpressionPaths);
  }
  if ('not' in expression) {
    return collectExpressionPaths(expression.not);
  }
  if ('path' in expression && typeof expression.path === 'string' && expression.path.trim()) {
    return [expression.path.trim()];
  }
  return [];
}

export function rewriteExpressionPaths(
  expression: RuleExpression,
  fromPath: string,
  toPath: string
): RuleExpression {
  if (!fromPath || fromPath === toPath) {
    return expression;
  }
  if ('all' in expression) {
    return { all: expression.all.map((child) => rewriteExpressionPaths(child, fromPath, toPath)) };
  }
  if ('any' in expression) {
    return { any: expression.any.map((child) => rewriteExpressionPaths(child, fromPath, toPath)) };
  }
  if ('not' in expression) {
    return { not: rewriteExpressionPaths(expression.not, fromPath, toPath) };
  }
  if ('path' in expression && expression.path === fromPath) {
    return { ...expression, path: toPath };
  }
  return expression;
}

export function retargetFieldReferences(
  form: StageFormDefinition,
  fromKey: string,
  toKey: string,
  pathRewrite?: { from: string; to: string }
): StageFormDefinition {
  if (!fromKey || fromKey === toKey) {
    return form;
  }
  const behaviors = (form.behaviors ?? []).map((behavior) => ({
    ...behavior,
    when: pathRewrite
      ? rewriteExpressionPaths(behavior.when, pathRewrite.from, pathRewrite.to)
      : behavior.when,
    effects: behavior.effects.map((effect) =>
      effect.fieldKey === fromKey ? { ...effect, fieldKey: toKey } : effect
    )
  }));
  const sections = form.sections.map((section) => ({
    ...section,
    packetFieldBindings: section.packetFieldBindings?.map((binding) => ({
      ...binding,
      parentFieldKey: binding.parentFieldKey === fromKey ? toKey : binding.parentFieldKey,
      childFieldKey: binding.childFieldKey === fromKey ? toKey : binding.childFieldKey
    })),
    fields: section.fields.map((field) =>
      field.displayFromFormKey === form.formKey && field.displayFromFieldKey === fromKey
        ? { ...field, displayFromFieldKey: toKey }
        : field
    )
  }));
  return {
    ...form,
    sections,
    behaviors: form.behaviors ? behaviors : undefined
  };
}

export function scrubDeletedFieldReferences(
  form: StageFormDefinition,
  fieldKey: string,
  fieldPaths: Iterable<string> = []
): StageFormDefinition {
  const removedPaths = new Set(
    [...fieldPaths].map((path) => path.trim()).filter(Boolean)
  );
  const behaviors = (form.behaviors ?? [])
    .map((behavior) => ({
      ...behavior,
      effects: behavior.effects.filter((effect) => effect.fieldKey !== fieldKey)
    }))
    .filter((behavior) => {
      if (behavior.effects.length === 0) {
        return false;
      }
      if (removedPaths.size === 0) {
        return true;
      }
      return !collectExpressionPaths(behavior.when).some((path) => removedPaths.has(path));
    });
  const sections = form.sections.map((section) => ({
    ...section,
    countFieldKey: section.countFieldKey === fieldKey ? undefined : section.countFieldKey,
    choiceSourceFieldKey:
      section.choiceSourceFieldKey === fieldKey ? undefined : section.choiceSourceFieldKey,
    packetFieldBindings: section.packetFieldBindings?.filter(
      (binding) => binding.parentFieldKey !== fieldKey && binding.childFieldKey !== fieldKey
    ),
    fields: section.fields.map((field) => {
      let next = field;
      if (field.fillFromFieldKey === fieldKey) {
        next = {
          ...next,
          fillFromFieldKey: undefined,
          fillFrom: field.fillFrom === 'FIELD' ? undefined : field.fillFrom
        };
      }
      if (field.displayFromFormKey === form.formKey && field.displayFromFieldKey === fieldKey) {
        next = { ...next, displayFromFormKey: undefined, displayFromFieldKey: undefined };
      }
      return next;
    })
  }));
  return {
    ...form,
    sections,
    behaviors: form.behaviors ? behaviors : undefined
  };
}

export function collectDisplayFromIntegrityIssues(
  form: StageFormDefinition,
  siblingForms?: Record<string, StageFormDefinition>
): DesignerIssue[] {
  const issues: DesignerIssue[] = [];
  const releaseForms = { ...(siblingForms ?? {}), [form.formKey]: form };
  for (const [sectionIndex, section] of form.sections.entries()) {
    for (const [fieldIndex, field] of section.fields.entries()) {
      const path = `sections.${sectionIndex}.fields.${fieldIndex}`;
      const formKey = field.displayFromFormKey?.trim();
      const fieldKey = field.displayFromFieldKey?.trim();
      if (!formKey && !fieldKey) {
        continue;
      }
      const label = field.fieldKey || 'Field';
      if (!DISPLAY_FROM_COMPONENTS.has(field.component)) {
        issues.push({
          path: `${path}.displayFromFormKey`,
          message: `${label}: Display from is only allowed on Read-only value fields.`
        });
        continue;
      }
      if (!formKey || !fieldKey) {
        issues.push({
          path: `${path}.displayFromFieldKey`,
          message: `${label}: Display from needs both a form and a field.`
        });
        continue;
      }
      if (formKey === form.formKey && fieldKey === field.fieldKey) {
        issues.push({
          path: `${path}.displayFromFieldKey`,
          message: `${label}: Display from cannot point at itself.`
        });
        continue;
      }
      const sourceForm = releaseForms[formKey];
      if (!sourceForm) {
        issues.push({
          path: `${path}.displayFromFormKey`,
          message: `${label}: Display from form ${formKey} was not found on this release.`
        });
        continue;
      }
      if (!findFormField(sourceForm, fieldKey)) {
        issues.push({
          path: `${path}.displayFromFieldKey`,
          message: `${label}: Display from field ${fieldKey} was not found on ${formKey}.`
        });
      }
    }
  }
  return issues;
}

/** Retarget display-from field keys across a release after a source field rename. */
export function retargetDisplayFromAcrossForms(
  forms: Record<string, StageFormDefinition>,
  sourceFormKey: string,
  fromFieldKey: string,
  toFieldKey: string
): Record<string, StageFormDefinition> {
  if (!fromFieldKey || fromFieldKey === toFieldKey) {
    return forms;
  }
  return Object.fromEntries(
    Object.entries(forms).map(([key, form]) => [
      key,
      {
        ...form,
        sections: form.sections.map((section) => ({
          ...section,
          fields: section.fields.map((field) =>
            field.displayFromFormKey === sourceFormKey && field.displayFromFieldKey === fromFieldKey
              ? { ...field, displayFromFieldKey: toFieldKey }
              : field
          )
        }))
      }
    ])
  );
}

/** Clear display-from links that pointed at a deleted source field. */
export function scrubDisplayFromAcrossForms(
  forms: Record<string, StageFormDefinition>,
  sourceFormKey: string,
  fieldKey: string
): Record<string, StageFormDefinition> {
  return Object.fromEntries(
    Object.entries(forms).map(([key, form]) => [
      key,
      {
        ...form,
        sections: form.sections.map((section) => ({
          ...section,
          fields: section.fields.map((field) =>
            field.displayFromFormKey === sourceFormKey && field.displayFromFieldKey === fieldKey
              ? { ...field, displayFromFormKey: undefined, displayFromFieldKey: undefined }
              : field
          )
        }))
      }
    ])
  );
}

/** Retarget display-from form keys after a formKey rename. */
export function retargetDisplayFromFormKeys(
  forms: Record<string, StageFormDefinition>,
  fromFormKey: string,
  toFormKey: string
): Record<string, StageFormDefinition> {
  if (!fromFormKey || fromFormKey === toFormKey) {
    return forms;
  }
  return Object.fromEntries(
    Object.entries(forms).map(([key, form]) => [
      key,
      {
        ...form,
        sections: form.sections.map((section) => ({
          ...section,
          fields: section.fields.map((field) =>
            field.displayFromFormKey === fromFormKey
              ? { ...field, displayFromFormKey: toFormKey }
              : field
          )
        }))
      }
    ])
  );
}

/** Clear display-from links that pointed at a deleted form. */
export function scrubDisplayFromFormKey(
  forms: Record<string, StageFormDefinition>,
  formKey: string
): Record<string, StageFormDefinition> {
  return Object.fromEntries(
    Object.entries(forms).map(([key, form]) => [
      key,
      {
        ...form,
        sections: form.sections.map((section) => ({
          ...section,
          fields: section.fields.map((field) =>
            field.displayFromFormKey === formKey
              ? { ...field, displayFromFormKey: undefined, displayFromFieldKey: undefined }
              : field
          )
        }))
      }
    ])
  );
}

/**
 * After editing a form on the release, retarget or scrub sibling display-from links
 * when exactly one field was renamed, or scrub when fields were removed.
 */
export function syncDisplayFromAfterFormEdit(
  forms: Record<string, StageFormDefinition>,
  previous: StageFormDefinition,
  next: StageFormDefinition
): Record<string, StageFormDefinition> {
  const previousKeys = [...listFieldKeys(previous)];
  const nextKeys = listFieldKeys(next);
  const removed = previousKeys.filter((key) => !nextKeys.has(key));
  const added = [...nextKeys].filter((key) => !previousKeys.includes(key));
  if (removed.length === 1 && added.length === 1) {
    return retargetDisplayFromAcrossForms(forms, next.formKey, removed[0]!, added[0]!);
  }
  let result = forms;
  for (const fieldKey of removed) {
    result = scrubDisplayFromAcrossForms(result, next.formKey, fieldKey);
  }
  return result;
}

export function collectBehaviorIntegrityIssues(
  form: StageFormDefinition,
  siblingForms?: Record<string, StageFormDefinition>
): DesignerIssue[] {
  const issues: DesignerIssue[] = [];
  const fieldKeys = listFieldKeys(form);
  const pathToField = listResolvableFieldPaths(form);
  const releaseCasePaths = listReleaseCaseFieldPaths({ ...(siblingForms ?? {}), [form.formKey]: form });
  const behaviors = form.behaviors ?? [];
  const visibilityEdges = new Map<string, Set<string>>();

  for (const [index, behavior] of behaviors.entries()) {
    const base = `behaviors.${index}`;
    if (!behavior.effects.length) {
      issues.push({ path: `${base}.effects`, message: `${behavior.behaviorKey || 'Behavior'} needs a target field.` });
      continue;
    }
    for (const [effectIndex, effect] of behavior.effects.entries()) {
      if (!effect.fieldKey?.trim()) {
        issues.push({
          path: `${base}.effects.${effectIndex}.fieldKey`,
          message: `${behavior.behaviorKey || 'Behavior'} needs a target field.`
        });
      } else if (!fieldKeys.has(effect.fieldKey)) {
        issues.push({
          path: `${base}.effects.${effectIndex}.fieldKey`,
          message: `Behavior target ${effect.fieldKey} was not found on this form.`
        });
      }
    }

    const whenPaths = collectExpressionPaths(behavior.when);
    for (const whenPath of whenPaths) {
      if (whenPath.startsWith(WORKFLOW_PATH_PREFIX)) {
        continue;
      }
      if (pathToField.has(whenPath) || releaseCasePaths.has(whenPath)) {
        continue;
      }
      issues.push({
        path: `${base}.when`,
        message: `${behavior.behaviorKey || 'Behavior'} When path ${whenPath} does not match a field on this form or another form in this release.`
      });
    }

    for (const effect of behavior.effects) {
      if (effect.visible !== true || !effect.fieldKey || !fieldKeys.has(effect.fieldKey)) {
        continue;
      }
      for (const whenPath of whenPaths) {
        const sourceKey = pathToField.get(whenPath);
        if (!sourceKey || sourceKey === effect.fieldKey) {
          continue;
        }
        const targets = visibilityEdges.get(sourceKey) ?? new Set<string>();
        targets.add(effect.fieldKey);
        visibilityEdges.set(sourceKey, targets);
      }
    }
  }

  issues.push(...visibilityCycleIssues(visibilityEdges));
  issues.push(...visibilityDepthWarnings(visibilityEdges));
  return issues;
}

export function collectPacketBindingIntegrityIssues(
  form: StageFormDefinition,
  section: FormSectionDefinition,
  sectionIndex: number,
  siblingForms?: Record<string, StageFormDefinition>
): DesignerIssue[] {
  const issues: DesignerIssue[] = [];
  const fieldIndex = new Map<
    string,
    { field: FormFieldDefinition; section: FormSectionDefinition; formKey: string }
  >();
  for (const entry of form.sections) {
    for (const field of entry.fields) {
      if (field.fieldKey) {
        fieldIndex.set(field.fieldKey, { field, section: entry, formKey: form.formKey });
      }
    }
  }
  for (const sibling of Object.values(siblingForms ?? {})) {
    if (sibling.formKey === form.formKey) {
      continue;
    }
    for (const entry of sibling.sections) {
      if (entry.repeatable) {
        continue;
      }
      for (const field of entry.fields) {
        if (field.fieldKey && !fieldIndex.has(field.fieldKey)) {
          fieldIndex.set(field.fieldKey, { field, section: entry, formKey: sibling.formKey });
        }
      }
    }
  }

  for (const [bindingIndex, binding] of (section.packetFieldBindings ?? []).entries()) {
    const bindingPath = `sections.${sectionIndex}.packetFieldBindings.${bindingIndex}`;
    const label = binding.bindingKey || `Binding ${bindingIndex + 1}`;

    if (!binding.parentFieldKey?.trim()) {
      issues.push({ path: `${bindingPath}.parentFieldKey`, message: `${label} needs a parent field.` });
    } else {
      const parent = fieldIndex.get(binding.parentFieldKey);
      if (!parent) {
        issues.push({
          path: `${bindingPath}.parentFieldKey`,
          message: siblingForms
            ? `Parent field ${binding.parentFieldKey} was not found on this mail release.`
            : `Parent field ${binding.parentFieldKey} was not found on this form.`
        });
      } else {
        const scope =
          binding.parentScope ??
          (parent.formKey === form.formKey &&
          parent.section.sectionKey === section.sectionKey &&
          parent.section.repeatable
            ? 'ROW'
            : 'PACKET');
        if (scope === 'ROW' && (parent.formKey !== form.formKey || parent.section.sectionKey !== section.sectionKey)) {
          issues.push({
            path: `${bindingPath}.parentScope`,
            message: `${label}: row-scoped parent ${binding.parentFieldKey} must live on this repeating section.`
          });
        }
        if (scope === 'PACKET' && parent.section.repeatable) {
          issues.push({
            path: `${bindingPath}.parentScope`,
            message: `${label}: packet-scoped parent ${binding.parentFieldKey} must be outside the repeating section.`
          });
        }
        if (binding.mode === 'PROJECT_CHILD' && scope === 'PACKET') {
          issues.push({
            path: `${bindingPath}.mode`,
            message: `${label}: Show child on parent needs a row field in this repeating section (not a packet-only field).`
          });
        }
      }
    }

    if (!binding.childFieldKey?.trim()) {
      issues.push({ path: `${bindingPath}.childFieldKey`, message: `${label} needs a child field key.` });
    }
    if (
      binding.mode !== 'INHERIT_ONCE' &&
      binding.mode !== 'PROJECT_CHILD' &&
      binding.mode !== 'PROJECT_PARENT'
    ) {
      issues.push({
        path: `${bindingPath}.mode`,
        message: `${label}: mode must be INHERIT_ONCE, PROJECT_CHILD, or PROJECT_PARENT.`
      });
    }
  }
  return issues;
}

function visibilityCycleIssues(edges: Map<string, Set<string>>): DesignerIssue[] {
  const issues: DesignerIssue[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function visit(node: string): boolean {
    if (visiting.has(node)) {
      const cycleStart = stack.indexOf(node);
      const cycle = cycleStart >= 0 ? [...stack.slice(cycleStart), node] : [node, node];
      issues.push({
        path: 'behaviors',
        message: `Conditional visibility cycle: ${cycle.join(' → ')}. Change or remove one Visible-when-matched behavior.`
      });
      return true;
    }
    if (visited.has(node)) {
      return false;
    }
    visiting.add(node);
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      if (visit(next)) {
        visiting.delete(node);
        stack.pop();
        return true;
      }
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return false;
  }

  for (const node of edges.keys()) {
    if (visit(node)) {
      break;
    }
  }
  return issues;
}

function visibilityDepthWarnings(edges: Map<string, Set<string>>): DesignerIssue[] {
  const issues: DesignerIssue[] = [];
  const memo = new Map<string, number>();

  function depth(node: string, trail: Set<string>): number {
    if (trail.has(node)) {
      return 0;
    }
    if (memo.has(node)) {
      return memo.get(node)!;
    }
    trail.add(node);
    let max = 0;
    for (const next of edges.get(node) ?? []) {
      max = Math.max(max, 1 + depth(next, trail));
    }
    trail.delete(node);
    memo.set(node, max);
    return max;
  }

  let worst = 0;
  let worstNode = '';
  for (const node of edges.keys()) {
    const value = depth(node, new Set());
    if (value > worst) {
      worst = value;
      worstNode = node;
    }
  }
  if (worst >= VISIBILITY_CHAIN_WARN_DEPTH) {
    issues.push({
      path: 'behaviors',
      message: `Long visibility chain (depth ${worst}) starting at ${worstNode}. Prefer fewer nested Visible-when-matched rules.`
    });
  }
  return issues;
}

export function absoluteFieldPath(form: StageFormDefinition, field: FormFieldDefinition): string {
  return fieldStoragePath(form, field);
}

export function collectSharedEntityPathIssues(
  form: StageFormDefinition,
  entityType?: string
): DesignerIssue[] {
  const issues: DesignerIssue[] = [];
  for (const [sectionIndex, section] of form.sections.entries()) {
    for (const [fieldIndex, field] of section.fields.entries()) {
      if (!isSharedEntityPath(field.path)) {
        continue;
      }
      if (!sharedPathAllowedForEntity(field.path, entityType)) {
        const expected = entityType === 'MAIL' ? '$.mailItem' : '$.workload';
        issues.push({
          path: `sections.${sectionIndex}.fields.${fieldIndex}.path`,
          message: `${field.fieldKey || 'Field'}: shared path must be under ${expected} for this ${entityType || 'definition'}.`
        });
      }
    }
  }
  return issues;
}

export type { PacketFieldBinding };
