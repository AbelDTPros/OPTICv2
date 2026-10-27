import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/platform/errors/app-error.js';
import {
  applyMergePatch,
  assertPatchWithinPath,
  stageDataPatchFromCase,
  wrapAtDataPath
} from '../../src/modules/workflow/domain/merge-patch.js';

describe('applyMergePatch', () => {
  it('merges nested objects and replaces arrays', () => {
    const next = applyMergePatch(
      { dataEntryDetails: { receiptNumber: 'OLD', extra: true } },
      { dataEntryDetails: { receiptNumber: 'NEW' } }
    );
    expect(next).toEqual({ dataEntryDetails: { receiptNumber: 'NEW', extra: true } });
  });

  it('deletes a key when the patch value is null', () => {
    const next = applyMergePatch({ notes: 'keep', gone: 1 }, { gone: null });
    expect(next).toEqual({ notes: 'keep' });
  });
});

describe('wrapAtDataPath', () => {
  it('nests a value under a stage dataPath', () => {
    expect(wrapAtDataPath('$.dataEntryDetails', { workloadStatus: 'Accepted' })).toEqual({
      dataEntryDetails: { workloadStatus: 'Accepted' }
    });
  });

  it('returns the object itself when the path is the root', () => {
    expect(wrapAtDataPath('$', { workloads: [] })).toEqual({ workloads: [] });
  });
});

describe('assertPatchWithinPath', () => {
  it('rejects keys outside the stage dataPath', () => {
    try {
      assertPatchWithinPath({ other: { a: 1 } }, '$.dataEntryDetails');
      throw new Error('expected path restriction to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).errorCode).toBe('OPTIC-WF-40047');
    }
  });

  it('allows a patch that only touches the stage path', () => {
    expect(() =>
      assertPatchWithinPath({ dataEntryDetails: { receiptNumber: 'ABC1234567890' } }, '$.dataEntryDetails')
    ).not.toThrow();
  });

  it('allows the workload shared root with the stage path', () => {
    expect(() =>
      assertPatchWithinPath(
        {
          dataEntryDetails: { receiptNumber: 'ABC1234567890' },
          workload: { workloadStatus: 'Accepted' }
        },
        '$.dataEntryDetails',
        { entityType: 'WORKLOAD' }
      )
    ).not.toThrow();
  });

  it('builds a stage patch that includes shared workload data', () => {
    expect(
      stageDataPatchFromCase(
        {
          dataEntryDetails: { receiptNumber: 'ABC' },
          workload: { workloadStatus: 'Accepted' },
          shippingDetails: { notes: 'ignore' }
        },
        '$.dataEntryDetails',
        'WORKLOAD'
      )
    ).toEqual({
      dataEntryDetails: { receiptNumber: 'ABC' },
      workload: { workloadStatus: 'Accepted' }
    });
  });
});
