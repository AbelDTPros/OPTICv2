import type {
  FormFieldDefinition,
  FormSectionDefinition,
  StageFormDefinition
} from '../../../../src/modules/configuration/domain/types.js';
import { mintTrackingIdValue } from '../tracking/mint-tracking-id.js';
import { getByJsonPath, setByJsonPath } from './json-path.js';

export const MAX_REPEATING_ITEMS = 50;
export const REPEATING_COUNT_COMPONENTS = new Set(['NUMBER_INPUT']);
export const REPEATING_CHOICE_COMPONENTS = new Set(['RADIO', 'YES_NO_RADIO', 'SELECT']);

export function repeatingItemsPath(section: FormSectionDefinition): string {
  return section.path?.trim() || '$.workloads';
}

export function addButtonLabel(section: FormSectionDefinition): string {
  return section.addButtonLabel?.trim() || 'Add Workload';
}

export function itemLabel(section: FormSectionDefinition): string {
  return section.itemLabel?.trim() || 'Workload';
}

export function readRepeatingItems(value: unknown, section: FormSectionDefinition): Array<Record<string, unknown>> {
  const raw = getByJsonPath(value, repeatingItemsPath(section));
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((item) =>
    item !== null && typeof item === 'object' && !Array.isArray(item) ? { ...(item as Record<string, unknown>) } : {}
  );
}

export function writeRepeatingItems(
  value: unknown,
  section: FormSectionDefinition,
  items: Array<Record<string, unknown>>
): unknown {
  return setByJsonPath(value, repeatingItemsPath(section), items);
}

export function findFormField(form: StageFormDefinition, fieldKey?: string): FormFieldDefinition | undefined {
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

export function fieldSectionKey(form: StageFormDefinition, fieldKey: string): string | undefined {
  return form.sections.find((section) => section.fields.some((field) => field.fieldKey === fieldKey))?.sectionKey;
}

export function readCountFieldValue(
  value: unknown,
  form: StageFormDefinition,
  section: FormSectionDefinition
): number | undefined {
  const countField = findFormField(form, section.countFieldKey);
  if (!countField) {
    return undefined;
  }
  const raw = getByJsonPath(value, countField.path);
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.trunc(parsed);
}

export function repeatingAddCount(value: unknown, form: StageFormDefinition, section: FormSectionDefinition): number {
  const current = readRepeatingItems(value, section).length;
  const remaining = Math.max(0, MAX_REPEATING_ITEMS - current);
  if (remaining === 0) {
    return 0;
  }
  const countField = findFormField(form, section.countFieldKey);
  if (!countField) {
    return 1;
  }
  const parsed = readCountFieldValue(value, form, section);
  if (parsed === undefined) {
    return section.matchCountField ? 0 : 1;
  }
  if (section.matchCountField) {
    return Math.min(remaining, Math.max(0, parsed - current));
  }
  return Math.min(remaining, Math.max(1, parsed));
}

export function appendRepeatingItems(
  value: unknown,
  form: StageFormDefinition,
  section: FormSectionDefinition
): unknown {
  const items = readRepeatingItems(value, section);
  const count = repeatingAddCount(value, form, section);
  const added = Array.from({ length: count }, () => stampedRepeatingItem(value, form, section));
  return writeRepeatingItems(value, section, [...items, ...added]);
}

function stampedRepeatingItem(
  value: unknown,
  form: StageFormDefinition,
  section: FormSectionDefinition
): Record<string, unknown> {
  const trackingId = mintTrackingIdValue('WORKLOAD');
  const trackingFields = section.fields.filter((field) => field.component === 'TRACKING_ID_DISPLAY');
  let item: Record<string, unknown> = {};
  if (trackingFields.length === 0) {
    item = setByJsonPath(item, '$.trackingId', trackingId) as Record<string, unknown>;
  } else {
    for (const field of trackingFields) {
      item = setByJsonPath(item, field.path, trackingId) as Record<string, unknown>;
    }
  }
  const source = findFormField(form, section.choiceSourceFieldKey);
  const target = section.fields.find((field) => REPEATING_CHOICE_COMPONENTS.has(field.component));
  if (!source || !target) {
    return item;
  }
  const choice = getByJsonPath(value, source.path);
  if (choice === undefined || choice === '') {
    return item;
  }
  return setByJsonPath(item, target.path, choice) as Record<string, unknown>;
}
