import { describe, expect, it } from 'vitest';
import { ApiError, apiErrorFromPayload, formatApiError } from './api-error.js';

describe('apiErrorFromPayload', () => {
  it('reads the OPTIC envelope including reference id and field details', () => {
    const error = apiErrorFromPayload(
      400,
      {
        error: {
          errorCode: 'OPTIC-WF-40050',
          summary: 'Complete-action schema failed.',
          message: 'Complete-action schema failed.',
          referenceId: 'OPTIC-8F71C239',
          details: [{ field: 'receiptNumber', path: 'receiptNumber', message: 'Required', inputId: 'field-receiptNumber' }]
        },
        meta: { correlationId: 'c-1' }
      },
      'Request failed (400).'
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.errorCode).toBe('OPTIC-WF-40050');
    expect(error.referenceId).toBe('OPTIC-8F71C239');
    expect(error.correlationId).toBe('c-1');
    expect(error.details[0]).toMatchObject({ field: 'receiptNumber', inputId: 'field-receiptNumber' });
    expect(formatApiError(error)).toContain('Give this id to support: OPTIC-8F71C239');
  });

  it('uses the fallback when the body is not an OPTIC envelope', () => {
    const error = apiErrorFromPayload(502, { detail: 'bad gateway' }, 'Search failed (502).');
    expect(error.summary).toBe('Search failed (502).');
    expect(error.errorCode).toBeUndefined();
  });
});
