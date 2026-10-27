import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/platform/errors/app-error.js';
import { MISSING } from '../../src/rules/json-path-resolver.js';
import { evaluateOperator } from '../../src/rules/operators.js';

describe('rule operators', () => {
  it('EQUALS is strict and type-aware, and accepts lowercase equals', () => {
    expect(evaluateOperator('equals', true, true)).toBe(true);
    expect(evaluateOperator('EQUALS', true, 'true')).toBe(false);
    expect(evaluateOperator('EQUALS', 1, true)).toBe(false);
    expect(evaluateOperator('EQUALS', '10', 10)).toBe(false);
    expect(evaluateOperator('EQUALS', MISSING, null)).toBe(false);
    expect(evaluateOperator('EQUALS', null, null)).toBe(true);
  });

  it('treats MISSING as not null and not existing', () => {
    expect(evaluateOperator('IS_NULL', MISSING, undefined)).toBe(false);
    expect(evaluateOperator('IS_NULL', null, undefined)).toBe(true);
    expect(evaluateOperator('EXISTS', MISSING, undefined)).toBe(false);
    expect(evaluateOperator('NOT_EXISTS', MISSING, undefined)).toBe(true);
    expect(evaluateOperator('EXISTS', null, undefined)).toBe(true);
  });

  it('compares ISO dates by calendar day for EQUALS and ordering', () => {
    expect(evaluateOperator('EQUALS', '2026-03-15', '2026-03-15')).toBe(true);
    expect(evaluateOperator('EQUALS', '2026-03-15T18:00:00.000Z', '2026-03-15')).toBe(true);
    expect(evaluateOperator('EQUALS', '2026-03-15', '2026-03-16')).toBe(false);
    expect(evaluateOperator('GREATER_THAN', '2026-08-22', '2026-01-01')).toBe(true);
    expect(evaluateOperator('LESS_THAN', '2026-01-01', '2026-08-22')).toBe(true);
    expect(evaluateOperator('GREATER_THAN', '2026-03-15T12:00:00.000Z', '2026-03-14')).toBe(true);
  });

  it('does not coerce strings to numbers for comparison', () => {
    try {
      evaluateOperator('GREATER_THAN', '10', 5);
      throw new Error('expected comparison to fail closed');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).errorCode).toBe('OPTIC-WF-40033');
    }
  });

  it('supports membership, contains, boolean, and prefix operators', () => {
    expect(evaluateOperator('IN', 'READY', ['READY', 'HOLD'])).toBe(true);
    expect(evaluateOperator('NOT_IN', 'CLOSED', ['READY', 'HOLD'])).toBe(true);
    expect(evaluateOperator('IN', 'READY', 'READY')).toBe(false);
    expect(evaluateOperator('CONTAINS', 'ABC123', 'BC1')).toBe(true);
    expect(evaluateOperator('CONTAINS', ['A', 'B'], 'B')).toBe(true);
    expect(evaluateOperator('STARTS_WITH', 'ABC123', 'AB')).toBe(true);
    expect(evaluateOperator('ENDS_WITH', 'ABC123', '123')).toBe(true);
    expect(evaluateOperator('TRUE', true, undefined)).toBe(true);
    expect(evaluateOperator('TRUE', false, undefined)).toBe(false);
    expect(evaluateOperator('FALSE', false, undefined)).toBe(true);
    expect(evaluateOperator('GTE', 10, 10)).toBe(true);
    expect(evaluateOperator('LTE', '2026-01-01', '2026-08-22')).toBe(true);
  });

  it('rejects unknown operators', () => {
    try {
      evaluateOperator('EVAL', true, true);
      throw new Error('expected unknown operator to fail closed');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).errorCode).toBe('OPTIC-WF-40031');
    }
  });
});
