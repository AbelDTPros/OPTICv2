import {
  resolveFieldFillValue,
  resolveFillFromValue
} from '../../../../src/modules/configuration/domain/fill-from.js';
import type { FormFieldDefinition, StageFormDefinition } from '../../../../src/modules/configuration/domain/types.js';
import { isMissing, resolveJsonPath } from '../../../../src/rules/json-path-resolver.js';

export function valueAtDataPath(data: unknown, dataPath: string): unknown {
  if (!dataPath || dataPath === '$') {
    return data ?? {};
  }
  let cursor = data;
  for (const segment of dataPath.replace(/^\$\.?/, '').split('.').filter(Boolean)) {
    if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor)) {
      return {};
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor ?? {};
}

export function wrapAtDataPath(dataPath: string, value: unknown): Record<string, unknown> {
  if (!dataPath || dataPath === '$') {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
  }
  let wrapped: unknown = value;
  for (const segment of dataPath.replace(/^\$\.?/, '').split('.').filter(Boolean).reverse()) {
    wrapped = { [segment]: wrapped };
  }
  return wrapped !== null && typeof wrapped === 'object' && !Array.isArray(wrapped)
    ? (wrapped as Record<string, unknown>)
    : {};
}

/** Overlay the live form slice onto case businessData for behavior evaluation while typing. */
export function mergeFormValueIntoBusinessData(
  businessData: unknown,
  dataPath: string,
  formValue: unknown
): Record<string, unknown> {
  const base =
    businessData !== null && typeof businessData === 'object' && !Array.isArray(businessData)
      ? { ...(businessData as Record<string, unknown>) }
      : {};
  const overlay = wrapAtDataPath(dataPath || '$', formValue ?? {});
  return deepMergeObjects(base, overlay);
}

function deepMergeObjects(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = next[key];
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing !== null &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    ) {
      next[key] = deepMergeObjects(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      next[key] = value;
    }
  }
  return next;
}

export function getByJsonPath(
  data: unknown,
  path: string,
  workflow?: Record<string, unknown>
): unknown {
  try {
    const resolved = resolveJsonPath(path, { businessData: data, workflow });
    return isMissing(resolved) ? undefined : resolved;
  } catch {
    return undefined;
  }
}

/** Tracking ID display shows this case's mail/workload # when the form path is empty. */
export function displayValueForField(
  field: Pick<FormFieldDefinition, 'component' | 'path'> &
    Partial<
      Pick<
        FormFieldDefinition,
        'fieldKey' | 'fillFrom' | 'fillFromFieldKey' | 'displayFromFormKey' | 'displayFromFieldKey'
      >
    >,
  data: unknown,
  workflow?: Record<string, unknown>,
  options?: {
    instanceTrackingIdFallback?: boolean;
    form?: StageFormDefinition;
    releaseForms?: Record<string, StageFormDefinition>;
    displayFromPath?: string;
  }
): unknown {
  const displayFromPath = options?.displayFromPath?.trim();
  if (displayFromPath) {
    return getByJsonPath(data, displayFromPath, workflow);
  }
  const resolved = getByJsonPath(data, field.path, workflow);
  if (hasDisplayText(resolved)) {
    return resolved;
  }
  const filled = options?.form
    ? resolveFieldFillValue(
        {
          fieldKey: field.fieldKey ?? '',
          path: field.path,
          fillFrom: field.fillFrom,
          fillFromFieldKey: field.fillFromFieldKey
        },
        options.form,
        data,
        { assignedTo: workflow?.assignedTo }
      )
    : resolveFillFromValue(field.fillFrom, { assignedTo: workflow?.assignedTo });
  if (filled) {
    return filled;
  }
  if (
    options?.instanceTrackingIdFallback !== false &&
    usesInstanceTrackingId(field) &&
    typeof workflow?.trackingId === 'string' &&
    workflow.trackingId.length > 0
  ) {
    return workflow.trackingId;
  }
  return resolved;
}

function usesInstanceTrackingId(field: { component: string; path: string }): boolean {
  if (field.component === 'TRACKING_ID_DISPLAY') {
    return true;
  }
  if (field.component !== 'READ_ONLY_VALUE') {
    return false;
  }
  const leaf = field.path.trim().split('.').pop()?.replace(/[^A-Za-z0-9_]/g, '') ?? '';
  return leaf === 'trackingId' || leaf === 'workloadTrackingId';
}

function hasDisplayText(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

export function setByJsonPath(data: unknown, path: string, nextValue: unknown): unknown {
  if (!path.startsWith('$.') && path !== '$') {
    return data;
  }
  if (path === '$') {
    return nextValue;
  }
  const source: Record<string, unknown> =
    data !== null && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const root = cloneJson(source);
  const segments = path.slice(2).split('.').filter(Boolean);
  let cursor: Record<string, unknown> = root;
  for (const [index, segment] of segments.entries()) {
    if (index === segments.length - 1) {
      cursor[segment] = nextValue;
      break;
    }
    const child = cursor[segment];
    if (child === null || typeof child !== 'object' || Array.isArray(child)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  return root;
}

function cloneJson<T>(value: T): T {
  return structuredClone(value);
}
