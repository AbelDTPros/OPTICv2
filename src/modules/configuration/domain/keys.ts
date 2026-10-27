import { validationFailed } from '../../../platform/errors/app-error.js';

const STABLE_KEY = /^[A-Z][A-Z0-9_]*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

export function assertStableKey(value: string, fieldName: string): void {
  if (!STABLE_KEY.test(value)) {
    throw validationFailed(
      'OPTIC-CONFIG-40001',
      `${fieldName} must be an uppercase snake-case semantic key.`,
      [{ field: fieldName, value }]
    );
  }
}

export function assertReleaseVersion(version: string): void {
  if (!SEMVER.test(version)) {
    throw validationFailed('OPTIC-CONFIG-40002', 'Release version must be semantic version MAJOR.MINOR.PATCH.', [
      { field: 'version', value: version }
    ]);
  }
}

export function assertUniqueKeys(keys: string[], fieldName: string): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      throw validationFailed('OPTIC-CONFIG-40003', `Duplicate ${fieldName} is not allowed.`, [
        { field: fieldName, value: key }
      ]);
    }
    seen.add(key);
  }
}
