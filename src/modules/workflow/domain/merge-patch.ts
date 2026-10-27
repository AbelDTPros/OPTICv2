import { sharedRootForEntityType } from '../../configuration/domain/shared-entity-paths.js';
import { validationFailed } from '../../../platform/errors/app-error.js';

export function applyMergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return structuredClone(patch);
  }
  const base =
    target !== null && typeof target === 'object' && !Array.isArray(target)
      ? { ...(target as Record<string, unknown>) }
      : {};
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === null) {
      delete result[key];
    } else {
      result[key] = applyMergePatch(result[key], value);
    }
  }
  return result;
}

export function jsonPathSegments(path: string): string[] {
  if (path === '$') {
    return [];
  }
  if (!path.startsWith('$.')) {
    throw validationFailed('OPTIC-WF-40047', 'Stage dataPath must be a root JSONPath starting with $.');
  }
  return path.slice(2).split('.').filter(Boolean);
}

export function wrapAtDataPath(dataPath: string, value: unknown): Record<string, unknown> {
  const segments = jsonPathSegments(dataPath || '$');
  let wrapped: unknown = value;
  for (const segment of [...segments].reverse()) {
    wrapped = { [segment]: wrapped };
  }
  return wrapped !== null && typeof wrapped === 'object' && !Array.isArray(wrapped)
    ? (wrapped as Record<string, unknown>)
    : {};
}

export function joinJsonPath(dataPath: string, fieldPath: string): string {
  if (fieldPath === '$') {
    return dataPath;
  }
  const remainder = fieldPath.startsWith('$.') ? fieldPath.slice(2) : fieldPath;
  if (!remainder) {
    return dataPath;
  }
  return dataPath === '$' ? `$.${remainder}` : `${dataPath}.${remainder}`;
}

export function assertPatchWithinPath(
  patch: unknown,
  dataPath: string,
  options?: { entityType?: string }
): void {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw validationFailed(
      'OPTIC-VAL-40001',
      'dataPatch must be a JSON object.',
      [{ field: 'dataPatch', path: 'dataPatch', message: 'Must be an object' }]
    );
  }
  const allowed = jsonPathSegments(dataPath);
  if (allowed.length === 0) {
    return;
  }
  const allowedTop = new Set<string>([allowed[0]!]);
  const sharedRoot = sharedRootForEntityType(options?.entityType);
  if (sharedRoot) {
    const sharedTop = jsonPathSegments(sharedRoot)[0];
    if (sharedTop) {
      allowedTop.add(sharedTop);
    }
  }
  const extra = Object.keys(patch as Record<string, unknown>).filter((key) => !allowedTop.has(key));
  if (extra.length > 0) {
    const allowedList = [...allowedTop].map((key) => `$.${key}`).join(' and ');
    throw validationFailed(
      'OPTIC-WF-40047',
      `Writes are limited to ${allowedList}.`,
      extra.map((field) => ({
        field,
        path: field,
        message: `Field is outside the allowed stage paths (${allowedList}).`
      }))
    );
  }
}

/** Build a save/complete patch from case businessData for this form (dataPath + shared root). */
export function stageDataPatchFromCase(
  businessData: unknown,
  dataPath: string,
  entityType?: string
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const local = getAtPath(businessData, dataPath || '$');
  Object.assign(patch, wrapAtDataPath(dataPath || '$', local ?? {}));
  const sharedRoot = sharedRootForEntityType(entityType);
  if (sharedRoot) {
    const shared = getAtPath(businessData, sharedRoot);
    if (shared !== undefined) {
      Object.assign(patch, wrapAtDataPath(sharedRoot, shared));
    }
  }
  return patch;
}

export function getAtPath(data: unknown, path: string): unknown {
  if (path === '$') {
    return data;
  }
  let current = data;
  for (const segment of jsonPathSegments(path)) {
    if (current === null || typeof current !== 'object' || Array.isArray(current) || !(segment in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
