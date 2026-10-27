import {
  fillFromAllowedForComponent,
  isFillFromSource,
  listFillFromDateFields
} from '../../../../src/modules/configuration/domain/fill-from.js';
import { validationForComponent, validationRuleFamily } from '../../../../src/modules/configuration/domain/field-validation.js';
import {
  schemaFromForm,
  sharedEntitySchemaFromForm
} from '../../../../src/modules/configuration/domain/schema-from-form.js';
import {
  isSharedEntityPath,
  sharedRootOfPath
} from '../../../../src/modules/configuration/domain/shared-entity-paths.js';
import { DEFAULT_SPLUNK_MASK_POLICY, type FormFieldDefinition, type FormSectionDefinition, type JsonSchema, type StageFormDefinition } from '../../../../src/modules/configuration/domain/types.js';
import { jsonPathSegments } from '../../../../src/modules/workflow/domain/merge-patch.js';
import { fieldSectionKey, findFormField, REPEATING_CHOICE_COMPONENTS, REPEATING_COUNT_COMPONENTS } from '../dynamic-forms/repeating-section.js';
import {
  absoluteFieldPath,
  collectBehaviorIntegrityIssues,
  collectPacketBindingIntegrityIssues,
  collectSharedEntityPathIssues,
  type DesignerIssue,
  collectDisplayFromIntegrityIssues,
  listPathsForField,
  retargetFieldReferences,
  scrubDeletedFieldReferences
} from './form-integrity.js';
import { DISPLAY_FROM_COMPONENTS } from '../../../../src/modules/configuration/domain/display-from.js';
import { ALLOWED_FORM_COMPONENTS, generatedFieldKeyPrefix, isGeneratedFieldKey, nextStableKey, pathFromFieldKey } from './palette.js';

export { schemaFromForm, sharedEntitySchemaFromForm };
export type { DesignerIssue };

export function addSection(form: StageFormDefinition): StageFormDefinition {
  const sectionKey = nextStableKey('SECTION', form.sections.map((section) => section.sectionKey));
  return {
    ...form,
    sections: [...form.sections, { sectionKey, title: 'New section', layout: 'ONE_COLUMN', fields: [] }]
  };
}

/** Deep-copy a form onto the same draft with a new key. Does not rewire workflow stages. */
export function duplicateFormDefinition(
  source: StageFormDefinition,
  existingKeys: string[]
): StageFormDefinition {
  const formKey = nextStableKey(source.formKey, existingKeys);
  const cloned = structuredClone(source) as StageFormDefinition;
  const title = source.title?.trim() ? `${source.title.trim()} (copy)` : source.title;
  return {
    ...cloned,
    formKey,
    title
  };
}

export const RADIO_CHOICE_MIN = 2;
export const RADIO_CHOICE_MAX = 20;

export function defaultRadioOptions(count = RADIO_CHOICE_MIN): Array<{ value: string; label: string }> {
  return Array.from({ length: Math.max(RADIO_CHOICE_MIN, count) }, (_, index) => ({
    value: `OPTION_${index + 1}`,
    label: `Option ${index + 1}`
  }));
}

export function resizeRadioOptions(
  options: Array<{ value: string; label: string }> | undefined,
  count: number
): Array<{ value: string; label: string }> {
  const nextCount = Math.min(
    RADIO_CHOICE_MAX,
    Math.max(RADIO_CHOICE_MIN, Number.isFinite(count) ? Math.trunc(count) : RADIO_CHOICE_MIN)
  );
  const current = options ?? [];
  if (nextCount <= current.length) {
    return current.slice(0, nextCount);
  }
  return [...current, ...defaultRadioOptions(nextCount).slice(current.length)];
}

export function addField(
  form: StageFormDefinition,
  sectionKey: string,
  component: string
): StageFormDefinition {
  const existing = form.sections.flatMap((section) => section.fields.map((field) => field.fieldKey));
  const field = blankField(component, existing);
  return {
    ...form,
    sections: form.sections.map((section) =>
      section.sectionKey === sectionKey ? { ...section, fields: [...section.fields, field] } : section
    )
  };
}

export function moveFieldToIndex(
  form: StageFormDefinition,
  sectionKey: string,
  fieldKey: string,
  targetIndex: number
): StageFormDefinition {
  return {
    ...form,
    sections: form.sections.map((section) => {
      if (section.sectionKey !== sectionKey) {
        return section;
      }
      const index = section.fields.findIndex((field) => field.fieldKey === fieldKey);
      if (index < 0) {
        return section;
      }
      const fields = [...section.fields];
      const [moved] = fields.splice(index, 1);
      if (!moved) {
        return section;
      }
      const clamped = Math.max(0, Math.min(targetIndex, fields.length));
      fields.splice(clamped, 0, moved);
      return { ...section, fields };
    })
  };
}

export function moveField(
  form: StageFormDefinition,
  sectionKey: string,
  fieldKey: string,
  direction: -1 | 1
): StageFormDefinition {
  return {
    ...form,
    sections: form.sections.map((section) => {
      if (section.sectionKey !== sectionKey) {
        return section;
      }
      const index = section.fields.findIndex((field) => field.fieldKey === fieldKey);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= section.fields.length) {
        return section;
      }
      const fields = [...section.fields];
      const [moved] = fields.splice(index, 1);
      if (!moved) {
        return section;
      }
      fields.splice(next, 0, moved);
      return { ...section, fields };
    })
  };
}

export function moveSectionToIndex(
  form: StageFormDefinition,
  sectionKey: string,
  targetIndex: number
): StageFormDefinition {
  const index = form.sections.findIndex((section) => section.sectionKey === sectionKey);
  if (index < 0) {
    return form;
  }
  const sections = [...form.sections];
  const [moved] = sections.splice(index, 1);
  if (!moved) {
    return form;
  }
  const clamped = Math.max(0, Math.min(targetIndex, sections.length));
  sections.splice(clamped, 0, moved);
  return { ...form, sections };
}

export function moveSection(
  form: StageFormDefinition,
  sectionKey: string,
  direction: -1 | 1
): StageFormDefinition {
  const index = form.sections.findIndex((section) => section.sectionKey === sectionKey);
  if (index < 0) {
    return form;
  }
  return moveSectionToIndex(form, sectionKey, index + direction);
}

export function removeField(form: StageFormDefinition, sectionKey: string, fieldKey: string): StageFormDefinition {
  const removed = form.sections
    .find((section) => section.sectionKey === sectionKey)
    ?.fields.find((field) => field.fieldKey === fieldKey);
  const next: StageFormDefinition = {
    ...form,
    sections: form.sections.map((section) =>
      section.sectionKey === sectionKey
        ? { ...section, fields: section.fields.filter((field) => field.fieldKey !== fieldKey) }
        : section
    )
  };
  return scrubDeletedFieldReferences(next, fieldKey, removed ? listPathsForField(form, removed) : []);
}

/** Deep-clone a field with a unique fieldKey/path suitable for paste or duplicate. */
export function cloneFieldDefinition(
  source: FormFieldDefinition,
  existingKeys: string[]
): FormFieldDefinition {
  const prefix =
    source.fieldKey?.replace(/_\d+$/, '').trim() ||
    generatedFieldKeyPrefix(source.component);
  const fieldKey = nextStableKey(prefix, existingKeys);
  const defaultSourcePath = pathFromFieldKey(source.fieldKey);
  let path = pathFromFieldKey(fieldKey);
  if (source.path === defaultSourcePath) {
    path = pathFromFieldKey(fieldKey);
  } else if (isSharedEntityPath(source.path)) {
    const root = sharedRootOfPath(source.path) ?? '$.workload';
    const leaf = pathFromFieldKey(fieldKey).slice(2);
    path = `${root}.${leaf}`;
  }
  const cloned = structuredClone(source) as FormFieldDefinition;
  return withDefaultMask({
    ...cloned,
    fieldKey,
    path,
    label: source.label?.trim() ? `${source.label.trim()} (copy)` : source.label
  });
}

export function insertClonedField(
  form: StageFormDefinition,
  sectionKey: string,
  source: FormFieldDefinition,
  options?: { afterFieldKey?: string }
): { form: StageFormDefinition; fieldKey: string } {
  const inserted = insertClonedFields(form, sectionKey, [source], options);
  return { form: inserted.form, fieldKey: inserted.fieldKeys[0]! };
}

export function insertClonedFields(
  form: StageFormDefinition,
  sectionKey: string,
  sources: FormFieldDefinition[],
  options?: { afterFieldKey?: string }
): { form: StageFormDefinition; fieldKeys: string[] } {
  if (sources.length === 0) {
    return { form, fieldKeys: [] };
  }
  const existingKeys = form.sections.flatMap((section) => section.fields.map((field) => field.fieldKey));
  const clones: FormFieldDefinition[] = [];
  for (const source of sources) {
    const field = cloneFieldDefinition(source, [...existingKeys, ...clones.map((item) => item.fieldKey)]);
    clones.push(field);
  }
  const fieldKeys = clones.map((field) => field.fieldKey);
  const sections = form.sections.map((section) => {
    if (section.sectionKey !== sectionKey) {
      return section;
    }
    const fields = [...section.fields];
    const afterIndex = options?.afterFieldKey
      ? fields.findIndex((item) => item.fieldKey === options.afterFieldKey)
      : -1;
    if (afterIndex >= 0) {
      fields.splice(afterIndex + 1, 0, ...clones);
    } else {
      fields.push(...clones);
    }
    return { ...section, fields };
  });
  return { form: { ...form, sections }, fieldKeys };
}

export function duplicateField(
  form: StageFormDefinition,
  sectionKey: string,
  fieldKey: string
): { form: StageFormDefinition; fieldKey: string } | undefined {
  const source = form.sections
    .find((section) => section.sectionKey === sectionKey)
    ?.fields.find((field) => field.fieldKey === fieldKey);
  if (!source) {
    return undefined;
  }
  return insertClonedField(form, sectionKey, source, { afterFieldKey: fieldKey });
}

export function duplicateFields(
  form: StageFormDefinition,
  sectionKey: string,
  fieldKeys: string[]
): { form: StageFormDefinition; fieldKeys: string[] } | undefined {
  const section = form.sections.find((item) => item.sectionKey === sectionKey);
  if (!section || fieldKeys.length === 0) {
    return undefined;
  }
  const order = new Map(section.fields.map((field, index) => [field.fieldKey, index]));
  const sources = [...fieldKeys]
    .filter((key) => order.has(key))
    .sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0))
    .map((key) => section.fields.find((field) => field.fieldKey === key)!)
    .filter(Boolean);
  if (sources.length === 0) {
    return undefined;
  }
  const afterFieldKey = sources[sources.length - 1]?.fieldKey;
  return insertClonedFields(form, sectionKey, sources, { afterFieldKey });
}

export function removeFields(
  form: StageFormDefinition,
  sectionKey: string,
  fieldKeys: string[]
): StageFormDefinition {
  const toRemove = new Set(fieldKeys);
  const section = form.sections.find((item) => item.sectionKey === sectionKey);
  const removedByKey = new Map(
    (section?.fields ?? [])
      .filter((field) => toRemove.has(field.fieldKey))
      .map((field) => [field.fieldKey, field] as const)
  );
  let next: StageFormDefinition = {
    ...form,
    sections: form.sections.map((item) =>
      item.sectionKey === sectionKey
        ? { ...item, fields: item.fields.filter((field) => !toRemove.has(field.fieldKey)) }
        : item
    )
  };
  for (const fieldKey of fieldKeys) {
    const removed = removedByKey.get(fieldKey);
    next = scrubDeletedFieldReferences(
      next,
      fieldKey,
      removed ? listPathsForField(form, removed) : []
    );
  }
  return next;
}

export function updateField(
  form: StageFormDefinition,
  sectionKey: string,
  fieldKey: string,
  patch: Partial<FormFieldDefinition>
): StageFormDefinition {
  const previous = form.sections
    .find((section) => section.sectionKey === sectionKey)
    ?.fields.find((field) => field.fieldKey === fieldKey);
  const updated: StageFormDefinition = {
    ...form,
    sections: form.sections.map((section) =>
      section.sectionKey === sectionKey
        ? {
            ...section,
            fields: section.fields.map((field) =>
              field.fieldKey === fieldKey ? withDefaultMask({ ...field, ...patch }) : field
            )
          }
        : section
    )
  };
  if (!previous) {
    return updated;
  }
  const nextKey = patch.fieldKey && patch.fieldKey !== fieldKey ? patch.fieldKey : fieldKey;
  let next = updated;
  if (nextKey !== fieldKey) {
    next = retargetFieldReferences(next, fieldKey, nextKey);
  }
  const nextField = next.sections
    .find((section) => section.sectionKey === sectionKey)
    ?.fields.find((field) => field.fieldKey === nextKey);
  if (nextField && previous.path !== nextField.path) {
    const rewrites = [
      { from: previous.path, to: nextField.path },
      { from: absoluteFieldPath(form, previous), to: absoluteFieldPath(form, nextField) },
      {
        from: `$.${previous.path.replace(/^\$\.?/, '').split('.').filter(Boolean).at(-1) ?? ''}`,
        to: `$.${nextField.path.replace(/^\$\.?/, '').split('.').filter(Boolean).at(-1) ?? ''}`
      }
    ];
    for (const rewrite of rewrites) {
      if (rewrite.from && rewrite.to && rewrite.from !== rewrite.to) {
        next = retargetFieldReferences(next, nextKey, nextKey, rewrite);
      }
    }
  }
  return next;
}

export function renameFieldKey(
  form: StageFormDefinition,
  sectionKey: string,
  fromKey: string,
  toKey: string
): StageFormDefinition {
  const field = form.sections.find((section) => section.sectionKey === sectionKey)?.fields.find((item) => item.fieldKey === fromKey);
  const patch: Partial<FormFieldDefinition> = { fieldKey: toKey };
  if (field && toKey.trim() && shouldRetargetPath(field.path, field.component, fromKey)) {
    patch.path = pathFromFieldKey(toKey);
  }
  const renamed = updateField(form, sectionKey, fromKey, patch);
  return retargetFillFromFieldKeys(renamed, fromKey, toKey);
}

export function retargetFieldComponent(
  form: StageFormDefinition,
  sectionKey: string,
  fieldKey: string,
  component: string
): StageFormDefinition {
  const field = form.sections
    .find((section) => section.sectionKey === sectionKey)
    ?.fields.find((item) => item.fieldKey === fieldKey);
  if (!field || field.component === component) {
    return form;
  }
  const patch: Partial<FormFieldDefinition> = {
    component,
    validation: validationForComponent(component, field.validation),
    ...(component === 'RADIO' && (field.options?.length ?? 0) < RADIO_CHOICE_MIN
      ? { options: defaultRadioOptions() }
      : {}),
    ...(field.fillFrom && !fillFromAllowedForComponent(component, field.fillFrom)
      ? { fillFrom: undefined, fillFromFieldKey: undefined }
      : {}),
    ...(!DISPLAY_FROM_COMPONENTS.has(component) &&
    (field.displayFromFormKey || field.displayFromFieldKey)
      ? { displayFromFormKey: undefined, displayFromFieldKey: undefined }
      : {})
  };
  const stillDefaultPath = field.path === pathFromFieldKey(field.fieldKey);
  if (isGeneratedFieldKey(field.fieldKey, field.component) && stillDefaultPath) {
    const existingKeys = form.sections
      .flatMap((section) => section.fields.map((item) => item.fieldKey))
      .filter((key) => key !== field.fieldKey);
    const nextKey = nextStableKey(component === 'TRACKING_ID_DISPLAY' ? 'TRACKING_ID' : component, existingKeys);
    patch.fieldKey = nextKey;
    patch.path = pathFromFieldKey(nextKey);
    if (field.label === defaultLabelForComponent(field.component)) {
      patch.label = defaultLabelForComponent(component);
    }
  }
  const updated = updateField(form, sectionKey, fieldKey, patch);
  if (!patch.fieldKey || patch.fieldKey === fieldKey) {
    return updated;
  }
  return updated;
}

export function updateSection(
  form: StageFormDefinition,
  sectionKey: string,
  patch: Partial<Omit<FormSectionDefinition, 'fields'>>
): StageFormDefinition {
  return {
    ...form,
    sections: form.sections.map((section) => (section.sectionKey === sectionKey ? { ...section, ...patch } : section))
  };
}

export function setSectionRepeatable(
  form: StageFormDefinition,
  sectionKey: string,
  repeatable: boolean
): StageFormDefinition {
  const section = form.sections.find((item) => item.sectionKey === sectionKey);
  if (!section) {
    return form;
  }
  if (!repeatable) {
    return {
      ...form,
      sections: form.sections.map((item) =>
        item.sectionKey === sectionKey
          ? {
              ...item,
              repeatable: false,
              path: undefined,
              addButtonLabel: undefined,
              itemLabel: undefined,
              countFieldKey: undefined,
              matchCountField: undefined,
              choiceSourceFieldKey: undefined,
              minItems: undefined,
              maxItems: undefined,
              spawnDefinitionKey: undefined,
              packetFieldBindings: undefined
            }
          : item
      )
    };
  }
  const existingKeys = form.sections.flatMap((item) => item.fields.map((field) => field.fieldKey));
  const fields = section.fields.some((field) => field.component === 'TRACKING_ID_DISPLAY')
    ? section.fields
    : [blankField('TRACKING_ID_DISPLAY', existingKeys), ...section.fields];
  const pathPrefix = section.sectionKey.startsWith('SECTION') ? 'WORKLOADS' : section.sectionKey;
  return {
    ...form,
    sections: form.sections.map((item) =>
      item.sectionKey === sectionKey
        ? {
            ...item,
            repeatable: true,
            path: item.path?.trim() || pathFromFieldKey(pathPrefix),
            addButtonLabel: item.addButtonLabel?.trim() || 'Add Workload',
            itemLabel: item.itemLabel?.trim() || 'Workload',
            fields
          }
        : item
    )
  };
}

export function removeSection(form: StageFormDefinition, sectionKey: string): StageFormDefinition {
  return { ...form, sections: form.sections.filter((section) => section.sectionKey !== sectionKey) };
}

export function collectFormIssues(
  form: StageFormDefinition,
  entityType?: string,
  siblingForms?: Record<string, StageFormDefinition>
): DesignerIssue[] {
  const issues: DesignerIssue[] = [];
  if (!form.title.trim()) {
    issues.push({ path: 'title', message: 'Form title is required.' });
  }
  if (!form.formKey.trim()) {
    issues.push({ path: 'formKey', message: 'formKey is required.' });
  }
  if (form.schema && (typeof form.schema !== 'object' || Array.isArray(form.schema))) {
    issues.push({ path: 'schema', message: 'JSON Schema must be an object.' });
  }
  const keys = new Set<string>();
  const repeatingPaths = new Set<string>();
  for (const [sectionIndex, section] of form.sections.entries()) {
    if (!section.title.trim()) {
      issues.push({ path: `sections.${sectionIndex}.title`, message: 'Each section needs a visible title.' });
    }
    if (section.repeatable) {
      if (entityType && entityType !== 'MAIL') {
        issues.push({
          path: `sections.${sectionIndex}.repeatable`,
          message: 'Repeatable sections are only allowed on Mail item forms.'
        });
      }
      if (!section.path?.trim() || !section.path.startsWith('$.')) {
        issues.push({
          path: `sections.${sectionIndex}.path`,
          message: `${section.sectionKey || 'Section'} needs a JSONPath for the workload array.`
        });
      } else if (repeatingPaths.has(section.path)) {
        issues.push({
          path: `sections.${sectionIndex}.path`,
          message: `Duplicate repeating path ${section.path}.`
        });
      } else {
        repeatingPaths.add(section.path);
      }
      if (section.fields.length === 0) {
        issues.push({
          path: `sections.${sectionIndex}.fields`,
          message: `${section.sectionKey || 'Section'} must contain at least one field.`
        });
      }
      issues.push(...repeatingItemCountIssues(section, sectionIndex));
      if (section.matchCountField && !section.countFieldKey?.trim()) {
        issues.push({
          path: `sections.${sectionIndex}.matchCountField`,
          message: `${section.sectionKey || 'Section'} needs a Count field to require an exact number of copies.`
        });
      }
      issues.push(...repeatingBindingIssues(form, section, sectionIndex));
      if (section.spawnDefinitionKey?.trim() && !/^[A-Z][A-Z0-9_]*$/.test(section.spawnDefinitionKey.trim())) {
        issues.push({
          path: `sections.${sectionIndex}.spawnDefinitionKey`,
          message: 'Create cases of definition must be an uppercase snake-case key, for example I_407_WORKLOAD.'
        });
      } else if (entityType === 'MAIL' && !section.spawnDefinitionKey?.trim()) {
        issues.push({
          path: `sections.${sectionIndex}.spawnDefinitionKey`,
          message: 'Set Create cases of definition (for example I_407_WORKLOAD) or Complete will only store rows on the mail form.'
        });
      }
      issues.push(...collectPacketBindingIntegrityIssues(form, section, sectionIndex, siblingForms));
    }
    for (const [fieldIndex, field] of section.fields.entries()) {
      const path = `sections.${sectionIndex}.fields.${fieldIndex}`;
      if (!field.label.trim()) {
        issues.push({ path: `${path}.label`, message: `${field.fieldKey || 'Field'} needs a programmatic label.` });
      }
      if (field.fieldKey && keys.has(field.fieldKey)) {
        issues.push({ path: `${path}.fieldKey`, message: `Duplicate fieldKey ${field.fieldKey}.` });
      }
      if (field.fieldKey) {
        keys.add(field.fieldKey);
      }
      if (field.component && !ALLOWED_FORM_COMPONENTS.has(field.component)) {
        issues.push({ path: `${path}.component`, message: `${field.component} is not an approved component.` });
      }
      issues.push(...fillFromIssues(form, field, path));
      if (field.component === 'RADIO') {
        issues.push(...radioChoiceIssues(field, path));
      }
      if (
        (field.piiClassification === 'PII' || field.piiClassification === 'SENSITIVE') &&
        !field.splunkPolicy
      ) {
        issues.push({ path: `${path}.splunkPolicy`, message: `${field.fieldKey} must declare a Splunk masking policy.` });
      }
      issues.push(...validationRangeIssues(field, path));
    }
  }
  issues.push(...collectBehaviorIntegrityIssues(form, siblingForms));
  issues.push(...collectDisplayFromIntegrityIssues(form, siblingForms));
  issues.push(...collectSharedEntityPathIssues(form, entityType));
  return issues;
}

function validationRangeIssues(field: FormFieldDefinition, path: string): DesignerIssue[] {
  const rules = validationForComponent(field.component, field.validation);
  if (!rules) {
    return [];
  }
  const family = validationRuleFamily(field.component);
  const label = field.fieldKey || 'Field';
  if (family === 'length' && isOrderedNumber(rules.minLength, rules.maxLength) === false) {
    return [{ path: `${path}.validation`, message: `${label} minimum length cannot be greater than maximum length.` }];
  }
  if (family === 'number' && isOrderedNumber(rules.minimum, rules.maximum) === false) {
    return [{ path: `${path}.validation`, message: `${label} minimum cannot be greater than maximum.` }];
  }
  if (family === 'items' && isOrderedNumber(rules.minItems, rules.maxItems) === false) {
    return [{ path: `${path}.validation`, message: `${label} minimum selections cannot be greater than maximum selections.` }];
  }
  if (family === 'date' && rules.minDate && rules.maxDate && rules.minDate > rules.maxDate) {
    return [{ path: `${path}.validation`, message: `${label} earliest date cannot be after latest date.` }];
  }
  return [];
}

function fillFromIssues(form: StageFormDefinition, field: FormFieldDefinition, path: string): DesignerIssue[] {
  if (!field.fillFrom) {
    return [];
  }
  const label = field.fieldKey || 'Field';
  if (!isFillFromSource(field.fillFrom)) {
    return [{ path: `${path}.fillFrom`, message: `${label} Fill from is not a known source.` }];
  }
  if (!fillFromAllowedForComponent(field.component, field.fillFrom)) {
    return [
      {
        path: `${path}.fillFrom`,
        message: `${label} Fill from is not valid for this palette type.`
      }
    ];
  }
  if (field.fillFrom === 'FIELD') {
    const source = listFillFromDateFields(form, field.fieldKey).find(
      (item) => item.fieldKey === field.fillFromFieldKey
    );
    if (!source) {
      return [
        {
          path: `${path}.fillFromFieldKey`,
          message: `${label} Fill from needs another date field on this form.`
        }
      ];
    }
  }
  return [];
}

function retargetFillFromFieldKeys(
  form: StageFormDefinition,
  fromKey: string,
  toKey: string
): StageFormDefinition {
  if (!fromKey || fromKey === toKey) {
    return form;
  }
  return {
    ...form,
    sections: form.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) =>
        field.fillFromFieldKey === fromKey ? { ...field, fillFromFieldKey: toKey } : field
      )
    }))
  };
}

function isOrderedNumber(min?: number, max?: number): boolean | undefined {
  if (typeof min !== 'number' || typeof max !== 'number') {
    return undefined;
  }
  return min <= max;
}

function repeatingItemCountIssues(section: FormSectionDefinition, sectionIndex: number): DesignerIssue[] {
  const issues: DesignerIssue[] = [];
  const label = section.sectionKey || 'Section';
  if (typeof section.minItems === 'number' && (!Number.isFinite(section.minItems) || section.minItems < 0)) {
    issues.push({
      path: `sections.${sectionIndex}.minItems`,
      message: `${label} minimum copies must be zero or greater.`
    });
  }
  if (typeof section.maxItems === 'number' && (!Number.isFinite(section.maxItems) || section.maxItems < 0)) {
    issues.push({
      path: `sections.${sectionIndex}.maxItems`,
      message: `${label} maximum copies must be zero or greater.`
    });
  }
  if (isOrderedNumber(section.minItems, section.maxItems) === false) {
    issues.push({
      path: `sections.${sectionIndex}.minItems`,
      message: `${label} minimum copies cannot be greater than maximum copies.`
    });
  }
  return issues;
}

function repeatingBindingIssues(
  form: StageFormDefinition,
  section: FormSectionDefinition,
  sectionIndex: number
): DesignerIssue[] {
  const issues: DesignerIssue[] = [];
  if (section.countFieldKey) {
    issues.push(
      ...bindingIssue(
        form,
        section,
        sectionIndex,
        'countFieldKey',
        section.countFieldKey,
        REPEATING_COUNT_COMPONENTS,
        'Number'
      )
    );
  }
  if (section.choiceSourceFieldKey) {
    issues.push(
      ...bindingIssue(
        form,
        section,
        sectionIndex,
        'choiceSourceFieldKey',
        section.choiceSourceFieldKey,
        REPEATING_CHOICE_COMPONENTS,
        'Radio or dropdown'
      )
    );
    if (!section.fields.some((field) => REPEATING_CHOICE_COMPONENTS.has(field.component))) {
      issues.push({
        path: `sections.${sectionIndex}.choiceSourceFieldKey`,
        message: `${section.sectionKey || 'Section'} needs a radio or dropdown inside each workload to receive the chosen value.`
      });
    }
  }
  return issues;
}

function bindingIssue(
  form: StageFormDefinition,
  section: FormSectionDefinition,
  sectionIndex: number,
  property: 'countFieldKey' | 'choiceSourceFieldKey',
  fieldKey: string,
  allowed: Set<string>,
  kind: string
): DesignerIssue[] {
  const field = findFormField(form, fieldKey);
  if (!field) {
    return [{ path: `sections.${sectionIndex}.${property}`, message: `${fieldKey} is not on this form.` }];
  }
  if (fieldSectionKey(form, fieldKey) === section.sectionKey) {
    return [
      {
        path: `sections.${sectionIndex}.${property}`,
        message: `${kind} must sit outside the repeating section.`
      }
    ];
  }
  if (!allowed.has(field.component)) {
    return [
      {
        path: `sections.${sectionIndex}.${property}`,
        message: `${fieldKey} must be a ${kind.toLowerCase()} field.`
      }
    ];
  }
  return [];
}

function radioChoiceIssues(field: FormFieldDefinition, path: string): DesignerIssue[] {
  const issues: DesignerIssue[] = [];
  const options = field.options ?? [];
  if (options.length < RADIO_CHOICE_MIN) {
    issues.push({
      path: `${path}.options`,
      message: `${field.fieldKey || 'Radio field'} needs at least two radio buttons.`
    });
  }
  const values = new Set<string>();
  for (const [optionIndex, option] of options.entries()) {
    if (!option.label.trim() || !option.value.trim()) {
      issues.push({
        path: `${path}.options.${optionIndex}`,
        message: `Radio choice ${optionIndex + 1} needs a label and a stored value.`
      });
    }
    if (option.value.trim()) {
      if (values.has(option.value)) {
        issues.push({
          path: `${path}.options.${optionIndex}`,
          message: `Duplicate stored value ${option.value}.`
        });
      }
      values.add(option.value);
    }
  }
  return issues;
}

export function blankField(component: string, existingKeys: string[]): FormFieldDefinition {
  const fieldKey = nextStableKey(component === 'TRACKING_ID_DISPLAY' ? 'TRACKING_ID' : component, existingKeys);
  return {
    fieldKey,
    path: pathFromFieldKey(fieldKey),
    component,
    label: defaultLabelForComponent(component),
    width: 12,
    ...(component === 'RADIO' ? { options: defaultRadioOptions() } : {})
  };
}

export function withDefaultMask(field: FormFieldDefinition): FormFieldDefinition {
  if (
    (field.piiClassification === 'PII' || field.piiClassification === 'SENSITIVE') &&
    !field.splunkPolicy
  ) {
    return { ...field, splunkPolicy: DEFAULT_SPLUNK_MASK_POLICY };
  }
  return field;
}

function shouldRetargetPath(path: string, component: string, fromKey: string): boolean {
  if (fromKey && path === pathFromFieldKey(fromKey)) {
    return true;
  }
  return fromKey === '' && path === pathFromFieldKey(generatedFieldKeyPrefix(component));
}

function defaultLabelForComponent(component: string): string {
  if (component === 'RADIO') {
    return 'Radio buttons';
  }
  if (component === 'TRACKING_ID_DISPLAY') {
    return 'Tracking ID';
  }
  return labelForComponent(component);
}

function labelForComponent(component: string): string {
  return component
    .replace(/_INPUT$/, '')
    .replace(/_DISPLAY$/, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

export function releaseSchemaFromForm(form: StageFormDefinition): JsonSchema | undefined {
  if (!form.schema || typeof form.schema !== 'object' || Array.isArray(form.schema)) {
    return form.schema;
  }
  try {
    const segments = jsonPathSegments(form.dataPath || '$');
    if (segments.length === 0) {
      return form.schema;
    }
    const properties = schemaProperties(form.schema);
    if (properties && segments[0] && segments[0] in properties) {
      return form.schema;
    }
    let wrapped: JsonSchema = form.schema;
    for (const segment of [...segments].reverse()) {
      wrapped = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        additionalProperties: false,
        properties: { [segment]: wrapped }
      };
    }
    return wrapped;
  } catch {
    return form.schema;
  }
}

export function schemaAtDataPath(schema: JsonSchema | undefined, dataPath: string): JsonSchema | undefined {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return undefined;
  }
  try {
    const segments = jsonPathSegments(dataPath || '$');
    if (segments.length === 0) {
      return schema;
    }
    let cursor: unknown = schema;
    for (const segment of segments) {
      const properties = isJsonSchema(cursor) ? schemaProperties(cursor) : undefined;
      if (!properties || !(segment in properties)) {
        return undefined;
      }
      cursor = properties[segment];
    }
    return isJsonSchema(cursor) ? cursor : undefined;
  } catch {
    return undefined;
  }
}

export function mergeJsonSchemas(base: JsonSchema | undefined, incoming: JsonSchema | undefined): JsonSchema | undefined {
  if (!incoming) {
    return base;
  }
  if (!base) {
    return incoming;
  }
  if (!isJsonSchema(base) || !isJsonSchema(incoming)) {
    return incoming;
  }
  const baseProperties = schemaProperties(base) ?? {};
  const incomingProperties = schemaProperties(incoming) ?? {};
  const propertyKeys = new Set([...Object.keys(baseProperties), ...Object.keys(incomingProperties)]);
  const properties: Record<string, unknown> = {};
  for (const key of propertyKeys) {
    const left = baseProperties[key];
    const right = incomingProperties[key];
    properties[key] =
      isJsonSchema(left) && isJsonSchema(right) ? mergeJsonSchemas(left, right) : (right ?? left);
  }
  const required = uniqueStrings([
    ...(Array.isArray(base.required) ? base.required : []),
    ...(Array.isArray(incoming.required) ? incoming.required : [])
  ]);
  const additionalProperties =
    base.additionalProperties === false || incoming.additionalProperties === false
      ? false
      : (incoming.additionalProperties ?? base.additionalProperties);
  const merged: JsonSchema = {
    ...base,
    ...incoming
  };
  if (additionalProperties !== undefined) {
    merged.additionalProperties = additionalProperties;
  } else {
    delete merged.additionalProperties;
  }
  if (propertyKeys.size > 0) {
    merged.properties = properties;
  }
  if (required.length > 0) {
    merged.required = required;
  } else {
    delete merged.required;
  }
  return merged;
}

export function releaseSchemaFromForms(
  forms: Record<string, StageFormDefinition>,
  existingReleaseSchema?: JsonSchema
): JsonSchema | undefined {
  let merged: JsonSchema | undefined;
  for (const form of Object.values(forms)) {
    const schema = form.schema ?? schemaAtDataPath(existingReleaseSchema, form.dataPath);
    const piece = releaseSchemaFromForm(schema ? { ...form, schema } : form);
    if (piece) {
      merged = mergeJsonSchemas(merged, piece);
    }
    const shared = sharedEntitySchemaFromForm(form);
    if (shared) {
      merged = mergeJsonSchemas(merged, shared);
    }
  }
  return merged;
}

function isJsonSchema(value: unknown): value is JsonSchema {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || seen.has(value)) {
      continue;
    }
    seen.add(value);
    next.push(value);
  }
  return next;
}

function schemaProperties(schema: JsonSchema): Record<string, unknown> | undefined {
  const current = schema.properties;
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    return current as Record<string, unknown>;
  }
  return undefined;
}
