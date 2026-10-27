import { describe, expect, it } from 'vitest';
import { dueAtFromDelay, nextRetryDueAt } from '../../src/modules/workflow/domain/scheduled-actions.js';

describe('nextRetryDueAt', () => {
  const from = new Date('2026-08-23T12:00:00.000Z');

  it('uses a fixed delay when backoff is FIXED', () => {
    expect(nextRetryDueAt(1, 'FIXED', 5_000, from).toISOString()).toBe('2026-08-23T12:00:05.000Z');
    expect(nextRetryDueAt(4, 'FIXED', 5_000, from).toISOString()).toBe('2026-08-23T12:00:05.000Z');
  });

  it('doubles the delay on each exponential attempt and caps at one hour', () => {
    expect(nextRetryDueAt(1, 'EXPONENTIAL', 5_000, from).toISOString()).toBe('2026-08-23T12:00:05.000Z');
    expect(nextRetryDueAt(2, 'EXPONENTIAL', 5_000, from).toISOString()).toBe('2026-08-23T12:00:10.000Z');
    expect(nextRetryDueAt(3, 'EXPONENTIAL', 5_000, from).toISOString()).toBe('2026-08-23T12:00:20.000Z');
    expect(nextRetryDueAt(20, 'EXPONENTIAL', 5_000, from).getTime() - from.getTime()).toBe(3_600_000);
  });
});

describe('dueAtFromDelay', () => {
  const from = new Date('2026-08-23T12:00:00.000Z');

  it('uses CONFIG duration days/hours/minutes', () => {
    expect(
      dueAtFromDelay({ source: 'CONFIG', duration: { days: 1, hours: 2, minutes: 30 } }, from).toISOString()
    ).toBe('2026-08-24T14:30:00.000Z');
  });

  it('reads a numeric FIELD path as days by default', () => {
    expect(
      dueAtFromDelay(
        { source: 'FIELD', path: '$.dataEntryDetails.daysOnHold' },
        from,
        { dataEntryDetails: { daysOnHold: 2 } }
      ).toISOString()
    ).toBe('2026-08-25T12:00:00.000Z');
  });

  it('reads a numeric FIELD path with unit hours', () => {
    expect(
      dueAtFromDelay(
        { source: 'FIELD', path: '$.holdHours', unit: 'hours' },
        from,
        { holdHours: 3 }
      ).toISOString()
    ).toBe('2026-08-23T15:00:00.000Z');
  });

  it('rejects a missing FIELD path value', () => {
    expect(() =>
      dueAtFromDelay({ source: 'FIELD', path: '$.missing' }, from, {})
    ).toThrowError(/OPTIC-WF-40073|was not found/);
  });
});
