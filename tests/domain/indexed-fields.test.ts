import { describe, expect, it } from 'vitest';
import {
  fieldNeedsProjection,
  fieldUsedInDashboard,
  fieldUsedInSearch
} from '../../src/modules/configuration/domain/indexed-fields.js';
import type { SearchFieldDefinition } from '../../src/modules/configuration/domain/types.js';

const base: SearchFieldDefinition = {
  fieldKey: 'location',
  source: 'BUSINESS_DATA',
  path: '$.location',
  match: 'EXACT_PREFIX',
  pii: false
};

describe('indexed field flags', () => {
  it('defaults missing flags to Find-on and Dashboard-off', () => {
    expect(fieldUsedInSearch(base)).toBe(true);
    expect(fieldUsedInDashboard(base)).toBe(false);
    expect(fieldNeedsProjection(base)).toBe(true);
  });

  it('supports Dashboard-only indexed fields', () => {
    const field = { ...base, useInSearch: false, useInDashboard: true };
    expect(fieldUsedInSearch(field)).toBe(false);
    expect(fieldUsedInDashboard(field)).toBe(true);
    expect(fieldNeedsProjection(field)).toBe(true);
  });

  it('does not project unused fields', () => {
    const field = { ...base, useInSearch: false, useInDashboard: false };
    expect(fieldNeedsProjection(field)).toBe(false);
  });
});
