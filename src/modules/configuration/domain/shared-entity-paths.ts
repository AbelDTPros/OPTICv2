/** Case-level folder for WORKLOAD definitions — writable from any stage form. */
export const WORKLOAD_SHARED_ROOT = '$.workload';

/** Case-level folder for MAIL definitions — writable from any stage form. */
export const MAIL_SHARED_ROOT = '$.mailItem';

export function sharedRootForEntityType(entityType?: string): string | undefined {
  if (entityType === 'MAIL') {
    return MAIL_SHARED_ROOT;
  }
  if (entityType === 'WORKLOAD') {
    return WORKLOAD_SHARED_ROOT;
  }
  return undefined;
}

export function allSharedEntityRoots(): string[] {
  return [WORKLOAD_SHARED_ROOT, MAIL_SHARED_ROOT];
}

/** True when path is under $.workload or $.mailItem (case-absolute shared roots). */
export function isSharedEntityPath(path: string | undefined): boolean {
  const trimmed = path?.trim() ?? '';
  if (!trimmed.startsWith('$.')) {
    return false;
  }
  return allSharedEntityRoots().some(
    (root) => trimmed === root || trimmed.startsWith(`${root}.`) || trimmed.startsWith(`${root}[`)
  );
}

/** Shared root allowed for this entity, or undefined if the path is not a shared-root path. */
export function sharedRootOfPath(path: string | undefined): string | undefined {
  const trimmed = path?.trim() ?? '';
  return allSharedEntityRoots().find(
    (root) => trimmed === root || trimmed.startsWith(`${root}.`) || trimmed.startsWith(`${root}[`)
  );
}

export function sharedPathAllowedForEntity(path: string | undefined, entityType?: string): boolean {
  const root = sharedRootOfPath(path);
  if (!root) {
    return true;
  }
  const expected = sharedRootForEntityType(entityType);
  if (!expected) {
    return true;
  }
  return root === expected;
}

/**
 * Where a field is stored on businessData.
 * Shared-root paths stay absolute; other paths are relative to the form dataPath.
 */
export function fieldStoragePath(
  form: { dataPath?: string },
  field: { path: string }
): string {
  const path = field.path?.trim() || '';
  if (isSharedEntityPath(path)) {
    return path;
  }
  return joinRelativeToDataPath(form.dataPath || '$', path);
}

function joinRelativeToDataPath(dataPath: string, fieldPath: string): string {
  if (fieldPath === '$') {
    return dataPath;
  }
  const remainder = fieldPath.startsWith('$.') ? fieldPath.slice(2) : fieldPath;
  if (!remainder) {
    return dataPath;
  }
  return dataPath === '$' ? `$.${remainder}` : `${dataPath}.${remainder}`;
}

export function formHasSharedEntityFields(form: {
  sections: Array<{ fields: Array<{ path: string }> }>;
}): boolean {
  return form.sections.some((section) => section.fields.some((field) => isSharedEntityPath(field.path)));
}
