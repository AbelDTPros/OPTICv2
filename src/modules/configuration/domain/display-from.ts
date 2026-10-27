import { fieldStoragePath } from './shared-entity-paths.js';
import type { FormFieldDefinition, StageFormDefinition } from './types.js';

/** Components that may display another form's field without owning storage. */
export const DISPLAY_FROM_COMPONENTS = new Set(['READ_ONLY_VALUE']);

export function formHasDisplayFromFields(form: StageFormDefinition): boolean {
  return form.sections.some((section) =>
    section.fields.some((field) => Boolean(field.displayFromFormKey && field.displayFromFieldKey))
  );
}

function findFormField(form: StageFormDefinition, fieldKey?: string): FormFieldDefinition | undefined {
  if (!fieldKey) {
    return undefined;
  }
  for (const section of form.sections) {
    const match = section.fields.find((field) => field.fieldKey === fieldKey);
    if (match) {
      return match;
    }
  }
  return undefined;
}

export function resolveDisplayFromSource(
  field: Pick<FormFieldDefinition, 'displayFromFormKey' | 'displayFromFieldKey'>,
  forms: Record<string, StageFormDefinition> | undefined
): { form: StageFormDefinition; field: FormFieldDefinition } | undefined {
  const formKey = field.displayFromFormKey?.trim();
  const fieldKey = field.displayFromFieldKey?.trim();
  if (!formKey || !fieldKey || !forms) {
    return undefined;
  }
  const sourceForm = forms[formKey];
  if (!sourceForm) {
    return undefined;
  }
  const sourceField = findFormField(sourceForm, fieldKey);
  if (!sourceField) {
    return undefined;
  }
  return { form: sourceForm, field: sourceField };
}

export function displayFromStoragePath(
  field: Pick<FormFieldDefinition, 'displayFromFormKey' | 'displayFromFieldKey'>,
  forms: Record<string, StageFormDefinition> | undefined
): string | undefined {
  const source = resolveDisplayFromSource(field, forms);
  if (!source) {
    return undefined;
  }
  return fieldStoragePath(source.form, source.field);
}
