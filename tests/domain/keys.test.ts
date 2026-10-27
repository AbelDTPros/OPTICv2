import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/platform/errors/app-error.js';
import { assertReleaseVersion, assertStableKey, assertUniqueKeys } from '../../src/modules/configuration/domain/keys.js';

describe('stable semantic keys', () => {
  it('accepts uppercase snake-case keys including digits', () => {
    expect(() => assertStableKey('I_407', 'definitionKey')).not.toThrow();
    expect(() => assertStableKey('READY_FOR_DATA_ENTRY', 'stageKey')).not.toThrow();
    expect(() => assertStableKey('I_131PIP', 'definitionKey')).not.toThrow();
  });

  it('rejects environment-style or lowercase keys', () => {
    expect(() => assertStableKey('ready-for-data-entry', 'stageKey')).toThrow(AppError);
    expect(() => assertStableKey('12STAGE', 'stageKey')).toThrow(AppError);
  });

  it('requires semantic versions', () => {
    expect(() => assertReleaseVersion('2.3.0')).not.toThrow();
    expect(() => assertReleaseVersion('v2')).toThrow(AppError);
  });

  it('rejects duplicate keys in a collection', () => {
    expect(() => assertUniqueKeys(['DOCUMENT_PREP', 'DOCUMENT_PREP'], 'stageKey')).toThrow(AppError);
  });
});
