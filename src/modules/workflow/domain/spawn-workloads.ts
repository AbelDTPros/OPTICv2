import { fieldStoragePath } from '../../configuration/domain/shared-entity-paths.js';
import type { FormFieldDefinition, FormSectionDefinition, StageFormDefinition } from '../../configuration/domain/types.js';
import { getAtPath } from './merge-patch.js';
import {
  applyFieldSeedWrites,
  seedInheritOnceFromBindings,
  type FieldSeedWrite
} from './packet-field-bindings.js';

export { applyFieldSeedWrites } from './packet-field-bindings.js';

export interface SpawnWorkloadRequest {
  definitionKey: string;
  trackingId: string;
}

export interface SpawnWorkloadPlan {
  requests: SpawnWorkloadRequest[];
  missingTrackingIds: number;
}

export function collectSpawnWorkloadRequests(
  form: StageFormDefinition | undefined,
  businessData: unknown
): SpawnWorkloadPlan {
  if (!form) {
    return { requests: [], missingTrackingIds: 0 };
  }
  const formValue = getAtPath(businessData, form.dataPath || '$') ?? {};
  const requests: SpawnWorkloadRequest[] = [];
  let missingTrackingIds = 0;
  for (const section of form.sections) {
    const definitionKey = section.spawnDefinitionKey?.trim();
    if (!section.repeatable || !definitionKey) {
      continue;
    }
    const items = repeatingItems(formValue, section);
    for (const item of items) {
      const trackingId = itemTrackingId(item, section);
      if (!trackingId) {
        missingTrackingIds += 1;
        continue;
      }
      requests.push({ definitionKey, trackingId });
    }
  }
  return { requests, missingTrackingIds };
}

function repeatingItems(formValue: unknown, section: FormSectionDefinition): unknown[] {
  const raw = getAtPath(formValue, section.path?.trim() || '$.workloads');
  return Array.isArray(raw) ? raw : [];
}

function itemTrackingId(item: unknown, section: FormSectionDefinition): string | undefined {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    return undefined;
  }
  const field = section.fields.find((entry) => entry.component === 'TRACKING_ID_DISPLAY');
  const candidates = [
    getAtPath(item, field?.path?.trim() || '$.trackingId'),
    (item as Record<string, unknown>).trackingId,
    (item as Record<string, unknown>).workloadTrackingId
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export function businessDataMentionsTrackingId(data: unknown, trackingId: string): boolean {
  return Boolean(trackingId) && jsonContainsString(data, trackingId);
}

function jsonContainsString(data: unknown, value: string): boolean {
  if (data === value) {
    return true;
  }
  if (Array.isArray(data)) {
    return data.some((item) => jsonContainsString(item, value));
  }
  if (data !== null && typeof data === 'object') {
    return Object.values(data as Record<string, unknown>).some((item) => jsonContainsString(item, value));
  }
  return false;
}

const SKIP_SPAWN_COPY = new Set(['TRACKING_ID_DISPLAY', 'ALERT', 'USER_DISPLAY']);

export function overlaySpawnRowOnChild(
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
  const writes = seedFormValueFromRow(
    row.item,
    row.section,
    childForm,
    parentForms,
    parentBusinessData,
    parentForm
  );
  return applyFieldSeedWrites(childBusinessData, writes, { overwrite: false });
}

export function findSpawnRow(
  forms: Record<string, StageFormDefinition>,
  businessData: unknown,
  trackingId: string
): { item: Record<string, unknown>; section: FormSectionDefinition } | undefined {
  for (const form of Object.values(forms)) {
    const formValue = getAtPath(businessData, form.dataPath || '$') ?? {};
    for (const section of form.sections) {
      if (!section.repeatable || !section.spawnDefinitionKey?.trim()) {
        continue;
      }
      for (const item of repeatingItems(formValue, section)) {
        if (itemTrackingId(item, section) === trackingId && item !== null && typeof item === 'object' && !Array.isArray(item)) {
          return { item: item as Record<string, unknown>, section };
        }
      }
    }
  }
  return undefined;
}

export function seedFormValueFromRow(
  item: Record<string, unknown>,
  section: FormSectionDefinition,
  childForm: StageFormDefinition,
  parentForms?: Record<string, StageFormDefinition>,
  parentBusinessData?: unknown,
  preferredForm?: StageFormDefinition
): FieldSeedWrite[] {
  const writes: FieldSeedWrite[] = [];
  const seenPaths = new Set<string>();
  const childFields = childForm.sections.flatMap((entry) => (entry.repeatable ? [] : entry.fields));
  for (const field of section.fields) {
    if (SKIP_SPAWN_COPY.has(field.component)) {
      continue;
    }
    const raw = getAtPath(item, field.path);
    if (!hasStoredValue(raw)) {
      continue;
    }
    const target = childFields.find((candidate) => normalizeLeaf(candidate.path) === normalizeLeaf(field.path));
    if (!target) {
      continue;
    }
    const mapped = mapSpawnedChoice(raw, target);
    const path = fieldStoragePath(childForm, target);
    if (path && hasStoredValue(mapped) && !seenPaths.has(path)) {
      seenPaths.add(path);
      writes.push({ path, value: mapped });
    }
  }
  if (parentForms && Object.keys(parentForms).length > 0) {
    for (const write of seedInheritOnceFromBindings(
      item,
      section,
      parentForms,
      parentBusinessData ?? {},
      childForm,
      preferredForm
    )) {
      if (!seenPaths.has(write.path) && hasStoredValue(write.value)) {
        seenPaths.add(write.path);
        writes.push(write);
      }
    }
  }
  return writes;
}

export function mapSpawnedChoice(source: unknown, target: FormFieldDefinition): unknown {
  if (typeof source !== 'string') {
    return source;
  }
  const options = target.options ?? [];
  if (options.length === 0) {
    return source;
  }
  const lower = source.toLowerCase();
  const exact = options.find((option) => option.value === source);
  if (exact) {
    return exact.value;
  }
  const byValue = options.find((option) => option.value.toLowerCase() === lower);
  if (byValue) {
    return byValue.value;
  }
  const byLabel = options.find((option) => option.label.toLowerCase() === lower);
  if (byLabel) {
    return byLabel.value;
  }
  const byOverlap = options.find((option) => {
    const value = option.value.toLowerCase();
    const label = option.label.toLowerCase();
    return label.includes(lower) || lower.includes(label) || value.includes(lower) || lower.includes(value);
  });
  return byOverlap?.value ?? source;
}

function normalizeLeaf(path: string): string {
  return path.replace(/^\$\.?/, '').split('.').filter(Boolean).at(-1)?.replaceAll('_', '').toLowerCase() ?? '';
}

function hasStoredValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}
