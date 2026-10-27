import { describe, expect, it } from 'vitest';
import type { RuleExpression } from '../../src/modules/configuration/domain/types.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import { compileRuleExpressions } from '../../src/rules/compile-rules.js';
import { linearRelease } from '../fixtures/definitions/linear.js';

function withRule(when: RuleExpression) {
  return {
    ...linearRelease,
    workflow: {
      ...linearRelease.workflow,
      transitionSets: [
        {
          transitionSetKey: 'COMPLETE_DATA_ENTRY_TRANSITIONS',
          evaluationMode: 'FIRST_MATCH' as const,
          rules: [
            {
              ruleKey: 'LOAD_TIME_CHECK',
              priority: 10,
              when,
              targetStageKey: 'COMPLETED'
            }
          ],
          defaultTargetStageKey: 'COMPLETED'
        }
      ]
    }
  };
}

describe('compileRuleExpressions', () => {
  it('rejects an unknown operator at load time', () => {
    try {
      compileRuleExpressions(
        withRule({ path: '$.flag', operator: 'EVAL' as unknown as 'EQUALS', value: true })
      );
      throw new Error('expected load-time operator rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).errorCode).toBe('OPTIC-CONFIG-40024');
    }
  });

  it('rejects an unsafe JSONPath at load time', () => {
    try {
      compileRuleExpressions(
        withRule({ path: '$.paymentDetails..rejected', operator: 'EQUALS', value: true })
      );
      throw new Error('expected load-time JSONPath rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).errorCode).toBe('OPTIC-CONFIG-40024');
    }
  });
});
