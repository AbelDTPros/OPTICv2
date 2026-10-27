import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureLogger, log, redactSensitiveText, sanitize } from '../../src/platform/logging/logger.js';

describe('structured logger', () => {
  afterEach(() => {
    configureLogger({ minLevel: 'debug', includeStackTraces: false, environment: 'test' });
    vi.restoreAllMocks();
  });

  it('redacts secrets and identifier fields', () => {
    const sanitized = sanitize({
      authorization: 'Bearer secret-token',
      receiptNumber: 'ABC1234567890',
      aNumber: 'A123456789',
      nested: { password: 'hunter2', stageKey: 'READY_FOR_DATA_ENTRY' }
    }) as Record<string, unknown>;

    expect(sanitized.authorization).toBe('[REDACTED]');
    expect(sanitized.receiptNumber).toBe('[REDACTED]');
    expect(sanitized.aNumber).toBe('[REDACTED]');
    expect((sanitized.nested as Record<string, unknown>).password).toBe('[REDACTED]');
    expect((sanitized.nested as Record<string, unknown>).stageKey).toBe('READY_FOR_DATA_ENTRY');
  });

  it('redacts receipt numbers and A-Numbers inside free-text messages', () => {
    expect(redactSensitiveText('Saved receipt MSC1234567890 for A123456789')).toBe(
      'Saved receipt [REDACTED] for [REDACTED]'
    );
    expect(redactSensitiveText('Authorization: Bearer secret-token.jwt')).toContain('Bearer [REDACTED]');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    log('info', 'Officer typed MSC1234567890 in notes', { note: 'A987654321 on the form' });
    const line = JSON.parse(String(stdout.mock.calls[0]?.[0]));
    expect(line.message).toBe('Officer typed [REDACTED] in notes');
    expect(line.note).toBe('[REDACTED] on the form');
  });

  it('does not emit debug lines when the minimum level is info', () => {
    configureLogger({ minLevel: 'info', environment: 'production', includeStackTraces: false });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    log('debug', 'should not appear', { token: 'abc' });
    expect(stdout).not.toHaveBeenCalled();
  });
});
