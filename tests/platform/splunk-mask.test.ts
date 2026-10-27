import { describe, expect, it } from 'vitest';
import { maskForSplunk, projectPayloadForSplunk } from '../../src/platform/splunk/mask.js';

describe('Splunk field masking', () => {
  it('keeps prefix and suffix characters for MASK policy', () => {
    expect(maskForSplunk('ABC1234567890', 'MASK', 'SENSITIVE')).toBe('A*********890');
    expect(
      maskForSplunk('A123456789', {
        mode: 'MASK',
        maskStrategy: 'KEEP_PREFIX_SUFFIX',
        prefixChars: 1,
        suffixChars: 3
      })
    ).toBe('A******789');
  });

  it('redacts values that are too short to keep prefix and suffix', () => {
    expect(maskForSplunk('AB', 'MASK')).toBe('[REDACTED]');
    expect(maskForSplunk(42, 'MASK', 'PII')).toBe('[REDACTED]');
  });

  it('masks field delta values before Splunk serialization and leaves audit-side keys intact', () => {
    const projected = projectPayloadForSplunk({
      eventType: 'FIELD_CHANGED',
      correlationId: 'c-1',
      fieldDeltas: [
        {
          fieldKey: 'RECEIPT_NUMBER',
          path: '$.dataEntryDetails.receiptNumber',
          before: 'OLD1234567890',
          after: 'ABC1234567890',
          piiClassification: 'SENSITIVE',
          splunkPolicy: 'MASK'
        }
      ]
    });
    const deltas = projected.fieldDeltas as Array<Record<string, unknown>>;
    expect(deltas[0]?.before).toBe('O*********890');
    expect(deltas[0]?.after).toBe('A*********890');
    expect(deltas[0]?.fieldKey).toBe('RECEIPT_NUMBER');
  });

  it('does not mask unclassified values without a Splunk policy', () => {
    expect(maskForSplunk('READY_FOR_DATA_ENTRY')).toBe('READY_FOR_DATA_ENTRY');
  });
});
