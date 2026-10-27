import type { StageFormDefinition } from '../../../../src/modules/configuration/domain/types.js';

/** Stable compare for designer save dirty-state (key order from JSON.stringify is enough here). */
export function isDesignerDirty(current: unknown, saved: unknown): boolean {
  if (saved === undefined || saved === null) {
    return true;
  }
  return serializeDesignerValue(current) !== serializeDesignerValue(saved);
}

/** Form schema is regenerated on Save; ignore it when deciding if the canvas changed. */
export function comparableForm(form: StageFormDefinition): Omit<StageFormDefinition, 'schema'> {
  const { schema: _schema, ...rest } = form;
  return rest;
}

export function isFormDirty(current: StageFormDefinition, saved?: StageFormDefinition): boolean {
  if (!saved) {
    return true;
  }
  return isDesignerDirty(comparableForm(current), comparableForm(saved));
}

function serializeDesignerValue(value: unknown): string {
  return JSON.stringify(value);
}
