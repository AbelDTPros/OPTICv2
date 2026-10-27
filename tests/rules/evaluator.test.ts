import { describe, expect, it } from 'vitest';
import type { RuleExpression } from '../../src/modules/configuration/domain/types.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import { evaluateExpression } from '../../src/rules/evaluator.js';

describe('rule evaluator', () => {
  it('evaluates all, any, and not groups', () => {
    const context = { businessData: { flag: true, code: 'A', count: 2 } };
    expect(
      evaluateExpression(
        {
          all: [
            { path: '$.flag', operator: 'TRUE' },
            { path: '$.code', operator: 'EQUALS', value: 'A' }
          ]
        },
        context
      ).matched
    ).toBe(true);
    expect(
      evaluateExpression(
        {
          any: [
            { path: '$.flag', operator: 'FALSE' },
            { path: '$.count', operator: 'EQUALS', value: 2 }
          ]
        },
        context
      ).matched
    ).toBe(true);
    expect(
      evaluateExpression({ not: { path: '$.flag', operator: 'FALSE' } }, context).matched
    ).toBe(true);
    expect(
      evaluateExpression(
        {
          all: [
            { path: '$.flag', operator: 'TRUE' },
            { path: '$.code', operator: 'EQUALS', value: 'B' }
          ]
        },
        context
      ).matched
    ).toBe(false);
  });

  it('fails closed when nesting exceeds the cap', () => {
    let expression: RuleExpression = { path: '$.flag', operator: 'TRUE' };
    for (let index = 0; index < 9; index += 1) {
      expression = { all: [expression] };
    }
    try {
      evaluateExpression(expression, { businessData: { flag: true } });
      throw new Error('expected nesting cap');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).errorCode).toBe('OPTIC-WF-40034');
    }
  });

  it('resolves a JSONPath value when comparing two fields', () => {
    const context = {
      businessData: { startDate: '2026-01-10', endDate: '2026-01-12' }
    };
    expect(
      evaluateExpression(
        { path: '$.endDate', operator: 'GREATER_THAN', value: '$.startDate' },
        context
      ).matched
    ).toBe(true);
    expect(
      evaluateExpression(
        { path: '$.endDate', operator: 'EQUALS', value: '$.startDate' },
        context
      ).matched
    ).toBe(false);
    expect(
      evaluateExpression(
        { path: '$.endDate', operator: 'EQUALS', value: '$.missingDate' },
        context
      ).matched
    ).toBe(false);
  });
});
