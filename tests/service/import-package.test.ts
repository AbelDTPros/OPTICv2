import { describe, expect, it } from 'vitest';
import {
  buildCanonicalPackage,
  checksumCanonicalPackage
} from '../../src/modules/configuration/service/canonical-package.js';
import {
  childrenFromCanonicalPackage,
  parseCanonicalPackage,
  verifyPackageChecksum
} from '../../src/modules/configuration/service/import-package.js';
import { linearRelease } from '../fixtures/definitions/linear.js';

describe('import package helpers', () => {
  it('verifies a published package checksum', () => {
    const pkg = buildCanonicalPackage(linearRelease, { status: 'PUBLISHED' });
    const signed = checksumCanonicalPackage(pkg);
    expect(verifyPackageChecksum(pkg, signed.checksum).checksum).toBe(signed.checksum);
    expect(() => verifyPackageChecksum(pkg, '0'.repeat(64))).toThrow(/does not match/);
  });

  it('materializes workflow and catalog children from the package spec', () => {
    const pkg = buildCanonicalPackage(linearRelease, { status: 'PUBLISHED' });
    const children = childrenFromCanonicalPackage(pkg);
    expect(children.stage.map((row) => row.stableKey)).toEqual(
      expect.arrayContaining(['READY_FOR_DATA_ENTRY', 'COMPLETED'])
    );
    expect(children.action.some((row) => row.stableKey === 'COMPLETE_DATA_ENTRY')).toBe(true);
    expect(children.form.length).toBeGreaterThan(0);
    expect(parseCanonicalPackage(pkg).metadata.definitionKey).toBe(linearRelease.definitionKey);
  });
});
