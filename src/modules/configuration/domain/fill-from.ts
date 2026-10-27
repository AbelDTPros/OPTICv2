import { applyMergePatch, getAtPath, wrapAtDataPath } from '../../workflow/domain/merge-patch.js';
import { fieldStoragePath, isSharedEntityPath } from './shared-entity-paths.js';
import type { FillFromSource, FormFieldDefinition, StageFormDefinition } from './types.js';

export const FILL_FROM_ASSIGNED_TO = 'ASSIGNED_TO' satisfies FillFromSource;
export const FILL_FROM_TODAY = 'TODAY' satisfies FillFromSource;
export const FILL_FROM_FIELD = 'FIELD' satisfies FillFromSource;

/** Civil dates (Fill from Today) use this zone. Instants in the database stay UTC. */
export const OPERATIONAL_TIME_ZONE = 'America/New_York';

const NAME_FILL_COMPONENTS = new Set([
  'TEXT_INPUT',
  'TEXT_AREA',
  'READ_ONLY_VALUE',
  'USER_DISPLAY',
  'USER_LOOKUP'
]);

const DATE_FILL_COMPONENTS = new Set(['DATE_INPUT']);

export const FILL_FROM_OPTIONS: Array<{ value: FillFromSource; label: string }> = [
  { value: FILL_FROM_ASSIGNED_TO, label: 'Assigned officer' },
  { value: FILL_FROM_TODAY, label: 'Today' },
  { value: FILL_FROM_FIELD, label: 'Another date field' }
];

export interface FillFromContext {
  assignedTo?: unknown;
  today?: string;
  now?: Date;
}

export function isFillFromSource(value: string | undefined): value is FillFromSource {
  return value === FILL_FROM_ASSIGNED_TO || value === FILL_FROM_TODAY || value === FILL_FROM_FIELD;
}

export function fillFromOptionsForComponent(
  component: string
): Array<{ value: FillFromSource; label: string }> {
  if (NAME_FILL_COMPONENTS.has(component)) {
    return FILL_FROM_OPTIONS.filter((option) => option.value === FILL_FROM_ASSIGNED_TO);
  }
  if (DATE_FILL_COMPONENTS.has(component)) {
    return FILL_FROM_OPTIONS.filter(
      (option) => option.value === FILL_FROM_TODAY || option.value === FILL_FROM_FIELD
    );
  }
  return [];
}

export function fillFromAllowedForComponent(component: string, source: FillFromSource): boolean {
  return fillFromOptionsForComponent(component).some((option) => option.value === source);
}

export function operationalToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: OPERATIONAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

export function listFillFromDateFields(
  form: StageFormDefinition,
  exceptFieldKey?: string
): FormFieldDefinition[] {
  return form.sections
    .filter((section) => !section.repeatable)
    .flatMap((section) => section.fields)
    .filter(
      (field) =>
        field.component === 'DATE_INPUT' && field.fieldKey && field.fieldKey !== exceptFieldKey
    );
}

export function resolveFillFromValue(
  fillFrom: string | undefined,
  context: FillFromContext = {}
): string | undefined {
  if (fillFrom === FILL_FROM_ASSIGNED_TO) {
    const assignedTo = typeof context.assignedTo === 'string' ? context.assignedTo.trim() : '';
    return assignedTo || undefined;
  }
  if (fillFrom === FILL_FROM_TODAY) {
    const today = (context.today ?? operationalToday(context.now)).trim();
    return today || undefined;
  }
  return undefined;
}

export function resolveFieldFillValue(
  field: Pick<FormFieldDefinition, 'fieldKey' | 'path' | 'fillFrom' | 'fillFromFieldKey'>,
  form: StageFormDefinition,
  formValue: unknown,
  context: FillFromContext = {}
): string | undefined {
  if (field.fillFrom === FILL_FROM_FIELD) {
    const source = listFillFromDateFields(form, field.fieldKey).find(
      (item) => item.fieldKey === field.fillFromFieldKey
    );
    if (!source) {
      return undefined;
    }
    const value = getAtPath(formValue, source.path);
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
  return resolveFillFromValue(field.fillFrom, context);
}

export function applyFillFromToFormValue(
  form: StageFormDefinition,
  formValue: unknown,
  assignedTo: string | null | undefined,
  options?: { now?: Date; today?: string }
): unknown {
  const context: FillFromContext = {
    assignedTo,
    now: options?.now,
    today: options?.today
  };
  let next: Record<string, unknown> =
    formValue !== null && typeof formValue === 'object' && !Array.isArray(formValue)
      ? { ...(formValue as Record<string, unknown>) }
      : {};
  for (const field of fillFromFields(form)) {
    const source = resolveFieldFillValue(field, form, next, context);
    if (!source || !isEmptyDisplay(getAtPath(next, field.path))) {
      continue;
    }
    const merged = applyMergePatch(next, wrapAtDataPath(field.path, source));
    if (merged !== null && typeof merged === 'object' && !Array.isArray(merged)) {
      next = merged as Record<string, unknown>;
    }
  }
  return next;
}

export function applyFillFromToBusinessData(
  form: StageFormDefinition,
  businessData: Record<string, unknown>,
  assignedTo: string | null | undefined,
  options?: { now?: Date; today?: string }
): Record<string, unknown> {
  const context: FillFromContext = {
    assignedTo,
    now: options?.now,
    today: options?.today
  };
  let next: Record<string, unknown> = { ...businessData };
  const dataPath = form.dataPath || '$';
  const slice = getAtPath(next, dataPath);
  const stampedSlice = applyFillFromToFormValue(
    {
      ...form,
      sections: form.sections.map((section) => ({
        ...section,
        fields: section.fields.filter((field) => !isSharedEntityPath(field.path))
      }))
    },
    slice,
    assignedTo,
    options
  );
  if (stampedSlice !== slice) {
    const merged = applyMergePatch(next, wrapAtDataPath(dataPath, stampedSlice));
    if (merged !== null && typeof merged === 'object' && !Array.isArray(merged)) {
      next = merged as Record<string, unknown>;
    }
  }
  for (const field of fillFromFields(form)) {
    if (!isSharedEntityPath(field.path)) {
      continue;
    }
    const storagePath = fieldStoragePath(form, field);
    const source = resolveFieldFillValue(
      { ...field, path: storagePath },
      form,
      next,
      context
    );
    if (!source || !isEmptyDisplay(getAtPath(next, storagePath))) {
      continue;
    }
    const merged = applyMergePatch(next, wrapAtDataPath(storagePath, source));
    if (merged !== null && typeof merged === 'object' && !Array.isArray(merged)) {
      next = merged as Record<string, unknown>;
    }
  }
  return next;
}

function fillFromFields(form: StageFormDefinition): FormFieldDefinition[] {
  return form.sections.flatMap((section) => (section.repeatable ? [] : section.fields));
}

function isEmptyDisplay(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}
