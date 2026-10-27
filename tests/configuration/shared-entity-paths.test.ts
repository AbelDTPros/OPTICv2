import { describe, expect, it } from 'vitest';
import {
  fieldStoragePath,
  isSharedEntityPath,
  sharedPathAllowedForEntity,
  sharedRootForEntityType
} from '../../src/modules/configuration/domain/shared-entity-paths.js';

describe('shared entity paths', () => {
  it('recognizes workload and mailItem roots', () => {
    expect(isSharedEntityPath('$.workload.workloadStatus')).toBe(true);
    expect(isSharedEntityPath('$.mailItem.receivedDate')).toBe(true);
    expect(isSharedEntityPath('$.dataEntryDetails.workloadStatus')).toBe(false);
    expect(sharedRootForEntityType('WORKLOAD')).toBe('$.workload');
    expect(sharedRootForEntityType('MAIL')).toBe('$.mailItem');
  });

  it('keeps shared paths absolute and joins relative paths to dataPath', () => {
    const form = { dataPath: '$.dataEntryDetails' };
    expect(fieldStoragePath(form, { path: '$.workload.workloadStatus' })).toBe('$.workload.workloadStatus');
    expect(fieldStoragePath(form, { path: '$.receiptNumber' })).toBe('$.dataEntryDetails.receiptNumber');
  });

  it('rejects the other entity shared root', () => {
    expect(sharedPathAllowedForEntity('$.workload.workloadStatus', 'WORKLOAD')).toBe(true);
    expect(sharedPathAllowedForEntity('$.mailItem.receivedDate', 'WORKLOAD')).toBe(false);
    expect(sharedPathAllowedForEntity('$.mailItem.receivedDate', 'MAIL')).toBe(true);
  });
});
