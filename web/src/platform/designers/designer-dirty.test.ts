import { describe, expect, it } from 'vitest';
import { demoDesignerForm } from './demo-draft.js';
import { comparableForm, isDesignerDirty, isFormDirty } from './designer-dirty.js';

describe('designer dirty helpers', () => {
  it('treats missing saved values as dirty', () => {
    expect(isDesignerDirty({ a: 1 }, undefined)).toBe(true);
    expect(isFormDirty(demoDesignerForm)).toBe(true);
  });

  it('ignores form schema when comparing canvas content', () => {
    const withSchema = { ...demoDesignerForm, schema: { type: 'object' as const, properties: {} } };
    const otherSchema = {
      ...demoDesignerForm,
      schema: { type: 'object' as const, properties: { receiptNumber: { type: 'string' as const } } }
    };
    expect(isFormDirty(withSchema, otherSchema)).toBe(false);
    expect(comparableForm(withSchema)).not.toHaveProperty('schema');
  });

  it('detects field edits as dirty', () => {
    const edited = {
      ...demoDesignerForm,
      title: 'Changed title'
    };
    expect(isFormDirty(edited, demoDesignerForm)).toBe(true);
    expect(isDesignerDirty(edited, demoDesignerForm)).toBe(true);
  });
});
