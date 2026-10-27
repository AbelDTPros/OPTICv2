import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../../src/platform/errors/app-error.js';
import { normalizeError } from '../../src/platform/errors/error-envelope.js';

describe('error envelope', () => {
  it('maps Zod issues to accessible field details', () => {
    const result = normalizeError(
      z.object({ displayName: z.string().min(1) }).safeParse({ displayName: '' }).error,
      'c-test'
    );
    expect(result.httpStatus).toBe(400);
    expect(result.envelope.error.errorCode).toBe('OPTIC-VAL-40001');
    expect(result.envelope.error.summary).toContain('Review the highlighted fields');
    expect(result.envelope.error.details[0]).toMatchObject({
      field: 'displayName',
      inputId: 'field-displayName'
    });
  });

  it('never puts stack traces on unexpected errors in the client envelope', () => {
    const result = normalizeError(new Error('boom at /secret/path'), 'c-test');
    expect(result.httpStatus).toBe(500);
    expect(result.envelope.error.message).toBe('An unexpected system error occurred.');
    expect(JSON.stringify(result.envelope)).not.toContain('boom');
    expect(JSON.stringify(result.envelope)).not.toContain('/secret/path');
  });

  it('preserves stable application error codes', () => {
    const result = normalizeError(new AppError('OPTIC-CONFIG-40902', 'Release is PUBLISHED', 409), 'c-test');
    expect(result.envelope.error.errorCode).toBe('OPTIC-CONFIG-40902');
    expect(result.logLevel).toBe('warn');
  });
});
