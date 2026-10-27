import { describe, expect, it } from 'vitest';
import { calculateFieldDeltas } from '../../src/modules/workflow/domain/field-deltas.js';
import { DEFAULT_SPLUNK_MASK_POLICY } from '../../src/modules/configuration/domain/types.js';
import { linearRelease } from '../fixtures/definitions/linear.js';

describe('calculateFieldDeltas', () => {
  it('emits before/after values and PII classification for changed fields', () => {
    const form = linearRelease.forms.I90_DATA_ENTRY!;
    const deltas = calculateFieldDeltas(
      { dataEntryDetails: { receiptNumber: 'OLD1234567890' } },
      { dataEntryDetails: { receiptNumber: 'ABC1234567890' } },
      form
    );
    expect(deltas).toEqual([
      {
        fieldKey: 'RECEIPT_NUMBER',
        path: '$.dataEntryDetails.receiptNumber',
        before: 'OLD1234567890',
        after: 'ABC1234567890',
        piiClassification: 'SENSITIVE',
        splunkPolicy: DEFAULT_SPLUNK_MASK_POLICY
      }
    ]);
  });

  it('ignores unchanged fields and data outside the stage path', () => {
    const form = linearRelease.forms.I90_DATA_ENTRY!;
    const deltas = calculateFieldDeltas(
      { dataEntryDetails: { receiptNumber: 'SAME' }, other: 1 },
      { dataEntryDetails: { receiptNumber: 'SAME' }, other: 2 },
      form
    );
    expect(deltas).toEqual([]);
  });
});
