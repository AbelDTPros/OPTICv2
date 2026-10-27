import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/platform/errors/app-error.js';
import { isMissing, MISSING, resolveJsonPath } from '../../src/rules/json-path-resolver.js';

const context = {
  businessData: {
    paymentDetails: {
      details: {
        payGovReadyDetails: { rejected: true }
      }
    },
    dataEntryDetails: { receiptNumber: 'ABC123', notes: null }
  },
  workflow: { currentStageKey: 'READY_FOR_DATA_ENTRY' }
};

describe('JSONPath resolver', () => {
  it('resolves nested business paths and $workflow', () => {
    expect(resolveJsonPath('$.paymentDetails.details.payGovReadyDetails.rejected', context)).toBe(true);
    expect(resolveJsonPath('$workflow.currentStageKey', context)).toBe('READY_FOR_DATA_ENTRY');
  });

  it('returns MISSING distinctly from null', () => {
    expect(resolveJsonPath('$.dataEntryDetails.notes', context)).toBeNull();
    expect(isMissing(resolveJsonPath('$.dataEntryDetails.missingField', context))).toBe(true);
    expect(resolveJsonPath('$.dataEntryDetails.missingField', context)).toBe(MISSING);
  });

  it('rejects filters, wildcards, and scripts', () => {
    try {
      resolveJsonPath('$.paymentDetails..rejected', context);
      throw new Error('expected fail-closed path error');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).errorCode).toBe('OPTIC-WF-40030');
    }
  });
});
