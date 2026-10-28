import { describe, expect, it } from 'vitest';
import { retainFormErrorsAfterEdit } from './apply-api-error.js';

describe('retainFormErrorsAfterEdit', () => {
  const errors = [
    { fieldKey: 'aNumber', message: 'Required', inputId: 'field-aNumber' },
    { fieldKey: 'receiptNumber', message: 'Required', inputId: 'field-receiptNumber' }
  ];

  it('keeps errors for fields that did not change', () => {
    expect(
      retainFormErrorsAfterEdit(
        errors,
        { aNumber: '', receiptNumber: '' },
        { aNumber: 'A123456789', receiptNumber: '' }
      )
    ).toEqual([errors[1]]);
  });

  it('finds nested field keys under the form data path', () => {
    expect(
      retainFormErrorsAfterEdit(
        errors,
        { dataEntryDetails: { aNumber: '', receiptNumber: '' } },
        { dataEntryDetails: { aNumber: 'A123456789', receiptNumber: '' } }
      )
    ).toEqual([errors[1]]);
  });

  it('returns the same list when nothing changed', () => {
    const value = { aNumber: '', receiptNumber: '' };
    expect(retainFormErrorsAfterEdit(errors, value, value)).toBe(errors);
  });
});
