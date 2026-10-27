import { describe, expect, it } from 'vitest';
import { linearRelease } from '../fixtures/definitions/linear.js';
import { buildCanonicalPackage, checksumCanonicalPackage } from '../../src/modules/configuration/service/canonical-package.js';
import { buildPackageFiles, toYaml } from '../../src/modules/configuration/service/export-package.js';
import { diffReleases } from '../../src/modules/configuration/service/semantic-diff.js';

describe('canonical package and semantic diff', () => {
  it('produces a stable SHA-256 checksum', () => {
    const first = checksumCanonicalPackage(buildCanonicalPackage(linearRelease, { status: 'PUBLISHED' }));
    const second = checksumCanonicalPackage(buildCanonicalPackage(linearRelease, { status: 'PUBLISHED' }));
    expect(first.checksum).toBe(second.checksum);
    expect(first.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('classifies an added stage', () => {
    const changed = {
      ...linearRelease,
      version: '1.1.0',
      workflow: {
        ...linearRelease.workflow,
        stages: [
          ...linearRelease.workflow.stages,
          {
            stageKey: 'QA',
            displayName: 'QA',
            order: 30,
            actionKeys: [],
            assignmentPolicy: { required: false, clearOnTransition: false }
          }
        ]
      }
    };
    const diff = diffReleases(linearRelease, changed);
    expect(diff.changes.some((change) => change.category === 'stages' && change.key === 'QA')).toBe(true);
    expect(diff.raw.to).toContain('QA');
  });

  it('writes a multi-file YAML package layout', () => {
    const pkg = buildCanonicalPackage(linearRelease, { status: 'PUBLISHED' });
    const files = buildPackageFiles(pkg, linearRelease);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        'manifest.yaml',
        'workflow.yaml',
        'actions.yaml',
        'schemas/workload.schema.json',
        'ui/i90-data-entry.ui.yaml',
        'projections.yaml'
      ])
    );
    expect(files['projections.yaml']).toContain('receiptNumber');
    expect(toYaml({ kind: 'Workflow', stageKey: 'READY_FOR_DATA_ENTRY' })).toContain('stageKey: READY_FOR_DATA_ENTRY');
  });
});
