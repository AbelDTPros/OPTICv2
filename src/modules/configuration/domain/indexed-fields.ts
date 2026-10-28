import type { SearchFieldDefinition } from './types.js';

/** Find a case uses the field unless explicitly turned off. */
export function fieldUsedInSearch(field: SearchFieldDefinition): boolean {
  return field.useInSearch !== false;
}

/** Dashboard dimensions only when explicitly enabled. */
export function fieldUsedInDashboard(field: SearchFieldDefinition): boolean {
  return field.useInDashboard === true;
}

/** Project BUSINESS_DATA paths needed by Find and/or Dashboard. */
export function fieldNeedsProjection(field: SearchFieldDefinition): boolean {
  if (field.source !== 'BUSINESS_DATA' || !field.path.trim() || field.path.startsWith('$workflow')) {
    return false;
  }
  return fieldUsedInSearch(field) || fieldUsedInDashboard(field);
}
