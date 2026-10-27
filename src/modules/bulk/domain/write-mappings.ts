import { MISSING, resolveJsonPath } from '../../../rules/json-path-resolver.js';
import { validationFailed } from '../../../platform/errors/app-error.js';
import { jsonPathSegments } from '../../workflow/domain/merge-patch.js';

export function applyWriteMappings(
  businessData: Record<string, unknown>,
  input: Record<string, unknown>,
  mappings: Array<{ source: string; target: string }>
): Record<string, unknown> {
  let next = structuredClone(businessData);
  for (const mapping of mappings) {
    const value = resolveJsonPath(mapping.source, { businessData: input });
    if (value === MISSING) {
      continue;
    }
    next = setAtJsonPath(next, mapping.target, value);
  }
  return next;
}

export function setAtJsonPath(
  data: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  const segments = jsonPathSegments(path);
  if (segments.length === 0) {
    throw validationFailed('OPTIC-WF-40087', 'Bulk write mapping target must be a nested JSONPath.');
  }
  const root: Record<string, unknown> = { ...data };
  let cursor: Record<string, unknown> = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index] ?? '';
    const existing = cursor[segment];
    const child =
      existing !== null && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    cursor[segment] = child;
    cursor = child;
  }
  cursor[segments[segments.length - 1] ?? ''] = value;
  return root;
}
