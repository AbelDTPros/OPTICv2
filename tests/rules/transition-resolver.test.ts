import { describe, expect, it } from 'vitest';
import { DefinitionLoader } from '../../src/modules/configuration/definitions/definition-loader.js';
import { InMemoryDefinitionRepository } from '../../src/modules/configuration/persistence/in-memory-definition.repository.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import { compileRuleExpressions } from '../../src/rules/compile-rules.js';
import { resolveTransition } from '../../src/rules/transition-resolver.js';
import { branchingRelease } from '../fixtures/definitions/branching.js';
import { linearRelease } from '../fixtures/definitions/linear.js';

const paymentSet = () => {
  const set = branchingRelease.workflow.transitionSets.find((item) => item.transitionSetKey === 'COMPLETE_PAYMENT');
  if (!set) {
    throw new Error('COMPLETE_PAYMENT fixture is missing');
  }
  return set;
};

describe('transition resolver', () => {
  it('selects the first matching rule by priority and uses a stable targetStageKey', () => {
    const decision = resolveTransition(paymentSet(), {
      businessData: {
        paymentDetails: { details: { payGovReadyDetails: { rejected: true } } },
        dataEntryDetails: { fraudReferralRequired: true }
      }
    });
    expect(decision.targetStageKey).toBe('REJECTED');
    expect(decision.matchedRuleKey).toBe('PAYMENT_REJECTED');
    expect(decision.usedDefault).toBe(false);
  });

  it('falls through to the next rule when the first does not match', () => {
    const decision = resolveTransition(paymentSet(), {
      businessData: {
        paymentDetails: { details: { payGovReadyDetails: { rejected: false } } },
        dataEntryDetails: { fraudReferralRequired: true }
      }
    });
    expect(decision.targetStageKey).toBe('FRAUD_REVIEW');
    expect(decision.matchedRuleKey).toBe('FRAUD_REQUIRED');
  });

  it('uses the default target when no rule matches', () => {
    const decision = resolveTransition(paymentSet(), {
      businessData: {
        paymentDetails: { details: { payGovReadyDetails: { rejected: false } } },
        dataEntryDetails: { fraudReferralRequired: false }
      }
    });
    expect(decision.targetStageKey).toBe('READY_FOR_SHIPPING');
    expect(decision.usedDefault).toBe(true);
    expect(decision.matchedRuleKey).toBeUndefined();
  });

  it('fails closed when no rule matches and no default is configured', () => {
    try {
      resolveTransition(
        { transitionSetKey: 'NO_DEFAULT', evaluationMode: 'FIRST_MATCH', rules: [] },
        { businessData: {} }
      );
      throw new Error('expected fail-closed default error');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).errorCode).toBe('OPTIC-WF-40037');
    }
  });

  it('redacts sensitive and string values from the evaluation trace', () => {
    const decision = resolveTransition(
      {
        transitionSetKey: 'PII_CHECK',
        evaluationMode: 'FIRST_MATCH',
        rules: [
          {
            ruleKey: 'HAS_ANUMBER',
            priority: 10,
            when: { path: '$.dataEntryDetails.ANumber', operator: 'EQUALS', value: 'A123456789' },
            targetStageKey: 'COMPLETED'
          }
        ],
        defaultTargetStageKey: 'COMPLETED'
      },
      { businessData: { dataEntryDetails: { ANumber: 'A123456789' } } }
    );
    const predicate = decision.trace.find((entry) => entry.path === '$.dataEntryDetails.ANumber');
    expect(predicate?.resolvedValue).toBe('[REDACTED]');
    expect(JSON.stringify(decision.trace)).not.toContain('A123456789');
  });

  it('compiles MATCHES at load and rejects invalid regex', () => {
    const loader = new DefinitionLoader(new InMemoryDefinitionRepository());
    const compiled = loader.compile({
      ...linearRelease,
      workflow: {
        ...linearRelease.workflow,
        transitionSets: [
          {
            transitionSetKey: 'COMPLETE_DATA_ENTRY_TRANSITIONS',
            evaluationMode: 'FIRST_MATCH',
            rules: [
              {
                ruleKey: 'RECEIPT_PATTERN',
                priority: 10,
                when: { path: '$.dataEntryDetails.receiptNumber', operator: 'MATCHES', value: '^ABC' },
                targetStageKey: 'COMPLETED'
              }
            ],
            defaultTargetStageKey: 'COMPLETED'
          }
        ]
      }
    });
    expect(compiled.compiledRegexes.size).toBe(1);
    const decision = resolveTransition(
      compiled.release.workflow.transitionSets[0]!,
      { businessData: { dataEntryDetails: { receiptNumber: 'ABC999' } } },
      compiled.compiledRegexes
    );
    expect(decision.matchedRuleKey).toBe('RECEIPT_PATTERN');

    expect(() =>
      compileRuleExpressions({
        ...linearRelease,
        workflow: {
          ...linearRelease.workflow,
          transitionSets: [
            {
              transitionSetKey: 'COMPLETE_DATA_ENTRY_TRANSITIONS',
              evaluationMode: 'FIRST_MATCH',
              rules: [
                {
                  ruleKey: 'BAD_REGEX',
                  priority: 10,
                  when: { path: '$.dataEntryDetails.receiptNumber', operator: 'MATCHES', value: '(' },
                  targetStageKey: 'COMPLETED'
                }
              ]
            }
          ]
        }
      })
    ).toThrowError(/invalid regex/i);
  });
});
