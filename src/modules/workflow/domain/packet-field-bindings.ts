import { fieldStoragePath } from '../../configuration/domain/shared-entity-paths.js';
import type {
  FormFieldDefinition,
  FormSectionDefinition,
  PacketFieldBinding,
  PacketFieldBindingMode,
  StageFormDefinition
} from '../../configuration/domain/types.js';
import { applyMergePatch, getAtPath, wrapAtDataPath } from './merge-patch.js';
import { findSpawnRow, mapSpawnedChoice } from './spawn-workloads.js';

export type FieldSeedWrite = { path: string; value: unknown };

/** Apply absolute field writes onto case businessData (shared roots + form dataPath). */
export function applyFieldSeedWrites(
  businessData: Record<string, unknown>,
  writes: FieldSeedWrite[],
  options: { overwrite: boolean }
): Record<string, unknown> {
  let next = businessData;
  let changed = false;
  for (const write of writes) {
    if (!write.path?.trim() || !hasStoredValue(write.value)) {
      continue;
    }
    const current = getAtPath(next, write.path);
    if (!options.overwrite && hasStoredValue(current)) {
      continue;
    }
    if (current === write.value) {
      continue;
    }
    next = applyMergePatch(next, wrapAtDataPath(write.path, write.value)) as Record<string, unknown>;
    changed = true;
  }
  return changed ? next : businessData;
}

export function listPacketFieldBindings(section: FormSectionDefinition): PacketFieldBinding[] {
  return (section.packetFieldBindings ?? []).filter(
    (binding) =>
      binding.parentFieldKey?.trim() &&
      binding.childFieldKey?.trim() &&
      isPacketFieldBindingMode(binding.mode)
  );
}

export function isPacketFieldBindingMode(value: string | undefined): value is PacketFieldBindingMode {
  return value === 'INHERIT_ONCE' || value === 'PROJECT_CHILD' || value === 'PROJECT_PARENT';
}

export function findFieldByKey(
  form: StageFormDefinition,
  fieldKey: string,
  options?: { preferRepeatable?: boolean; preferNonRepeatable?: boolean }
): { field: FormFieldDefinition; section: FormSectionDefinition } | undefined {
  const key = fieldKey.trim();
  if (!key) {
    return undefined;
  }
  const matches = form.sections.flatMap((section) =>
    section.fields
      .filter((field) => field.fieldKey === key)
      .map((field) => ({ field, section }))
  );
  if (matches.length === 0) {
    return undefined;
  }
  if (options?.preferRepeatable) {
    return matches.find((item) => item.section.repeatable) ?? matches[0];
  }
  if (options?.preferNonRepeatable) {
    return matches.find((item) => !item.section.repeatable) ?? matches[0];
  }
  return matches[0];
}

export function listChildFormFields(childForm: StageFormDefinition): FormFieldDefinition[] {
  return childForm.sections.flatMap((section) => (section.repeatable ? [] : section.fields));
}

/** Seed empty child fields from parent for INHERIT_ONCE bindings. */
export function seedInheritOnceFromBindings(
  item: Record<string, unknown>,
  section: FormSectionDefinition,
  parentForms: Record<string, StageFormDefinition>,
  parentBusinessData: unknown,
  childForm: StageFormDefinition,
  preferredForm?: StageFormDefinition
): FieldSeedWrite[] {
  const writes: FieldSeedWrite[] = [];
  const childFields = listChildFormFields(childForm);
  for (const binding of listPacketFieldBindings(section)) {
    if (binding.mode !== 'INHERIT_ONCE') {
      continue;
    }
    const childField = childFields.find((field) => field.fieldKey === binding.childFieldKey);
    if (!childField) {
      continue;
    }
    const raw = resolveParentBindingValue(
      binding,
      item,
      section,
      parentForms,
      parentBusinessData,
      preferredForm
    );
    if (!hasStoredValue(raw)) {
      continue;
    }
    const mapped = mapSpawnedChoice(raw, childField);
    const path = fieldStoragePath(childForm, childField);
    if (path && hasStoredValue(mapped)) {
      writes.push({ path, value: mapped });
    }
  }
  return writes;
}

/** Overlay PROJECT_PARENT bindings onto child business data (child empty only). */
export function projectParentOntoChildBusinessData(
  childBusinessData: Record<string, unknown>,
  childForm: StageFormDefinition | undefined,
  parentForms: Record<string, StageFormDefinition>,
  parentBusinessData: unknown,
  trackingId: string
): Record<string, unknown> {
  if (!childForm || !trackingId) {
    return childBusinessData;
  }
  const row = findSpawnRow(parentForms, parentBusinessData, trackingId);
  if (!row) {
    return childBusinessData;
  }
  const parentForm = Object.values(parentForms).find((form) =>
    form.sections.some((section) => section.sectionKey === row.section.sectionKey)
  );
  if (!parentForm) {
    return childBusinessData;
  }
  const writes: FieldSeedWrite[] = [];
  for (const binding of listPacketFieldBindings(row.section)) {
    if (binding.mode !== 'PROJECT_PARENT') {
      continue;
    }
    const childField = listChildFormFields(childForm).find((field) => field.fieldKey === binding.childFieldKey);
    if (!childField) {
      continue;
    }
    const raw = resolveParentBindingValue(
      binding,
      row.item,
      row.section,
      parentForms,
      parentBusinessData,
      parentForm
    );
    if (!hasStoredValue(raw)) {
      continue;
    }
    const mapped = mapSpawnedChoice(raw, childField);
    const path = fieldStoragePath(childForm, childField);
    if (path && hasStoredValue(mapped)) {
      writes.push({ path, value: mapped });
    }
  }
  return applyFieldSeedWrites(childBusinessData, writes, { overwrite: true });
}

/**
 * Overlay PROJECT_CHILD bindings from child summaries onto mail business data
 * so Doc Prep shows live child-owned values.
 */
export function projectChildrenOntoParentBusinessData(
  parentBusinessData: Record<string, unknown>,
  parentForms: Record<string, StageFormDefinition>,
  children: Array<{ trackingId: string; businessData: Record<string, unknown>; forms?: Record<string, StageFormDefinition> }>
): Record<string, unknown> {
  let next = parentBusinessData;
  for (const form of Object.values(parentForms)) {
    const formValue = getAtPath(next, form.dataPath || '$') ?? {};
    let formObject =
      formValue !== null && typeof formValue === 'object' && !Array.isArray(formValue)
        ? { ...(formValue as Record<string, unknown>) }
        : {};
    let formChanged = false;
    for (const section of form.sections) {
      const bindings = listPacketFieldBindings(section).filter((binding) => binding.mode === 'PROJECT_CHILD');
      if (!section.repeatable || bindings.length === 0) {
        continue;
      }
      const arrayPath = section.path?.trim() || '$.workloads';
      const items = getAtPath(formObject, arrayPath);
      if (!Array.isArray(items)) {
        continue;
      }
      const nextItems = items.map((item) => {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) {
          return item;
        }
        const row = { ...(item as Record<string, unknown>) };
        const trackingId = rowTrackingId(row, section);
        if (!trackingId) {
          return row;
        }
        const child = children.find((entry) => entry.trackingId === trackingId);
        if (!child) {
          return row;
        }
        let rowChanged = false;
        for (const binding of bindings) {
          const parentField =
            binding.parentScope === 'PACKET'
              ? findFieldByKey(form, binding.parentFieldKey, { preferNonRepeatable: true })?.field
              : section.fields.find((field) => field.fieldKey === binding.parentFieldKey) ??
                findFieldByKey(form, binding.parentFieldKey, { preferRepeatable: true })?.field;
          if (!parentField || binding.parentScope === 'PACKET') {
            continue;
          }
          const childForm = pickChildFormWithField(child.forms, binding.childFieldKey);
          if (!childForm) {
            continue;
          }
          const childField = listChildFormFields(childForm).find((field) => field.fieldKey === binding.childFieldKey);
          if (!childField) {
            continue;
          }
          const raw = getAtPath(child.businessData, fieldStoragePath(childForm, childField));
          if (!hasStoredValue(raw)) {
            continue;
          }
          const mapped = mapSpawnedChoice(raw, parentField);
          const leaf = jsonPathLeaf(parentField.path);
          if (!leaf || !hasStoredValue(mapped)) {
            continue;
          }
          if (row[leaf] !== mapped) {
            row[leaf] = mapped;
            rowChanged = true;
          }
        }
        return rowChanged ? row : item;
      });
      if (nextItems.some((item, index) => item !== items[index])) {
        formObject = applyMergePatch(formObject, wrapAtDataPath(arrayPath, nextItems)) as Record<string, unknown>;
        formChanged = true;
      }
    }
    if (formChanged) {
      next = applyMergePatch(next, wrapAtDataPath(form.dataPath || '$', formObject)) as Record<string, unknown>;
    }
  }
  return next;
}

/** Build a parent-row patch for PROJECT_CHILD write-back after a child save. */
export function buildProjectChildWriteBack(
  parentForms: Record<string, StageFormDefinition>,
  parentBusinessData: unknown,
  trackingId: string,
  childForm: StageFormDefinition,
  childBusinessData: Record<string, unknown>
): Record<string, unknown> | undefined {
  const row = findSpawnRow(parentForms, parentBusinessData, trackingId);
  if (!row) {
    return undefined;
  }
  const parentForm = Object.values(parentForms).find((form) =>
    form.sections.some((section) => section.sectionKey === row.section.sectionKey)
  );
  if (!parentForm) {
    return undefined;
  }
  const bindings = listPacketFieldBindings(row.section).filter((binding) => binding.mode === 'PROJECT_CHILD');
  if (bindings.length === 0) {
    return undefined;
  }
  const nextRow = { ...row.item };
  let changed = false;
  for (const binding of bindings) {
    if (binding.parentScope === 'PACKET') {
      continue;
    }
    const parentField =
      row.section.fields.find((field) => field.fieldKey === binding.parentFieldKey) ??
      findFieldByKey(parentForm, binding.parentFieldKey, { preferRepeatable: true })?.field;
    const childField = listChildFormFields(childForm).find((field) => field.fieldKey === binding.childFieldKey);
    if (!parentField || !childField) {
      continue;
    }
    const raw = getAtPath(childBusinessData, fieldStoragePath(childForm, childField));
    if (!hasStoredValue(raw)) {
      continue;
    }
    const mapped = mapSpawnedChoice(raw, parentField);
    const leaf = jsonPathLeaf(parentField.path);
    if (!leaf || !hasStoredValue(mapped) || nextRow[leaf] === mapped) {
      continue;
    }
    nextRow[leaf] = mapped;
    changed = true;
  }
  if (!changed) {
    return undefined;
  }
  return replaceSpawnRow(parentBusinessData as Record<string, unknown>, parentForm, row.section, trackingId, nextRow);
}

function resolveParentBindingValue(
  binding: PacketFieldBinding,
  item: Record<string, unknown>,
  section: FormSectionDefinition,
  parentForms: Record<string, StageFormDefinition>,
  parentBusinessData: unknown,
  preferredForm?: StageFormDefinition
): unknown {
  const scope =
    binding.parentScope ??
    (section.fields.some((field) => field.fieldKey === binding.parentFieldKey) ? 'ROW' : 'PACKET');
  if (scope === 'ROW') {
    const field = section.fields.find((entry) => entry.fieldKey === binding.parentFieldKey);
    return field ? getAtPath(item, field.path) : undefined;
  }
  const ordered = preferredForm
    ? [preferredForm, ...Object.values(parentForms).filter((form) => form.formKey !== preferredForm.formKey)]
    : Object.values(parentForms);
  for (const form of ordered) {
    const located = findFieldByKey(form, binding.parentFieldKey, { preferNonRepeatable: true });
    if (!located || located.section.repeatable) {
      continue;
    }
    const formValue = getAtPath(parentBusinessData, form.dataPath || '$') ?? {};
    return getAtPath(formValue, located.field.path);
  }
  return undefined;
}

function replaceSpawnRow(
  parentBusinessData: Record<string, unknown>,
  parentForm: StageFormDefinition,
  section: FormSectionDefinition,
  trackingId: string,
  nextRow: Record<string, unknown>
): Record<string, unknown> {
  const formValue = getAtPath(parentBusinessData, parentForm.dataPath || '$') ?? {};
  const formObject =
    formValue !== null && typeof formValue === 'object' && !Array.isArray(formValue)
      ? { ...(formValue as Record<string, unknown>) }
      : {};
  const arrayPath = section.path?.trim() || '$.workloads';
  const items = getAtPath(formObject, arrayPath);
  if (!Array.isArray(items)) {
    return parentBusinessData;
  }
  const nextItems = items.map((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return item;
    }
    return rowTrackingId(item as Record<string, unknown>, section) === trackingId ? nextRow : item;
  });
  const nextForm = applyMergePatch(formObject, wrapAtDataPath(arrayPath, nextItems));
  return applyMergePatch(parentBusinessData, wrapAtDataPath(parentForm.dataPath || '$', nextForm)) as Record<
    string,
    unknown
  >;
}

function rowTrackingId(item: Record<string, unknown>, section: FormSectionDefinition): string | undefined {
  const field = section.fields.find((entry) => entry.component === 'TRACKING_ID_DISPLAY');
  const candidates = [
    field ? getAtPath(item, field.path?.trim() || '$.trackingId') : undefined,
    item.trackingId,
    item.workloadTrackingId
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function pickChildFormWithField(
  forms: Record<string, StageFormDefinition> | undefined,
  childFieldKey: string
): StageFormDefinition | undefined {
  if (!forms) {
    return undefined;
  }
  return (
    Object.values(forms).find((form) =>
      listChildFormFields(form).some((field) => field.fieldKey === childFieldKey)
    ) ?? Object.values(forms)[0]
  );
}

function jsonPathLeaf(path: string): string {
  return path.replace(/^\$\.?/, '').split('.').filter(Boolean).at(-1) ?? '';
}

function hasStoredValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}
