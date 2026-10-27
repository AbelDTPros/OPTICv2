import { describe, expect, it } from 'vitest';
import {
  assertBulkEligibility,
  matchesBulkEligibility,
  type BulkEligibility
} from '../../src/modules/bulk/domain/eligibility.js';
import type { WorkflowInstanceRecord } from '../../src/modules/workflow/domain/types.js';
import { AppError } from '../../src/platform/errors/app-error.js';

const actor = {
  actorId: 'officer@example.gov',
  roles: ['OFFICER'],
  correlationId: 'c-bulk-elig'
};

function instance(overrides: Partial<WorkflowInstanceRecord> = {}): WorkflowInstanceRecord {
  return {
    id: 1,
    entityType: 'WORKLOAD',
    entityTrackingId: 'W-1',
    parentEntityType: null,
    parentTrackingId: null,
    definitionReleaseId: 10,
    currentStageDefinitionId: 20,
    currentStageKey: 'READY_FOR_SHIPPING',
    status: 'ACTIVE',
    rehearsal: false,
    assignedTo: null,
    enteredStageAt: new Date('2026-08-23T12:00:00.000Z'),
    rowVersion: 0,
    businessData: {},
    createdAt: new Date('2026-08-23T12:00:00.000Z'),
    updatedAt: new Date('2026-08-23T12:00:00.000Z'),
    ...overrides
  };
}

describe('bulk eligibility', () => {
  it('allows empty eligibility', () => {
    expect(() => assertBulkEligibility(undefined, instance(), actor)).not.toThrow();
    expect(() => assertBulkEligibility({}, instance(), actor)).not.toThrow();
  });

  it('requires the item to be unassigned or assigned to the current user', () => {
    expect(() =>
      assertBulkEligibility(
        { requireUnassignedOrAssignedToCurrentUser: true },
        instance({ assignedTo: null }),
        actor
      )
    ).not.toThrow();
    expect(() =>
      assertBulkEligibility(
        { requireUnassignedOrAssignedToCurrentUser: true },
        instance({ assignedTo: actor.actorId }),
        actor
      )
    ).not.toThrow();
    try {
      assertBulkEligibility(
        { requireUnassignedOrAssignedToCurrentUser: true },
        instance({ assignedTo: 'other@example.gov' }),
        actor
      );
      throw new Error('expected assigned-to-other to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).errorCode).toBe('OPTIC-WF-40085');
    }
  });

  it('evaluates all / any / not predicates and $currentUser', () => {
    const expression: BulkEligibility = {
      all: [
        { source: 'workflow', field: 'status', operator: 'EQUALS', value: 'ACTIVE' },
        {
          any: [
            { source: 'workflow', field: 'assignedTo', operator: 'IS_NULL' },
            { source: 'workflow', field: 'assignedTo', operator: 'EQUALS', value: '$currentUser' }
          ]
        },
        {
          not: { source: 'workflow', field: 'currentStageKey', operator: 'EQUALS', value: 'COMPLETED' }
        }
      ]
    };
    expect(matchesBulkEligibility(expression, instance(), actor)).toBe(true);
    expect(matchesBulkEligibility(expression, instance({ assignedTo: actor.actorId }), actor)).toBe(true);
    expect(matchesBulkEligibility(expression, instance({ assignedTo: 'other@example.gov' }), actor)).toBe(false);
    expect(matchesBulkEligibility(expression, instance({ status: 'COMPLETED' }), actor)).toBe(false);
    expect(
      matchesBulkEligibility(expression, instance({ currentStageKey: 'COMPLETED' }), actor)
    ).toBe(false);
  });

  it('rejects unknown predicate fields', () => {
    try {
      assertBulkEligibility(
        { source: 'workflow', field: 'receiptNumber', operator: 'EQUALS', value: 'ABC' },
        instance(),
        actor
      );
      throw new Error('expected unknown field to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).errorCode).toBe('OPTIC-WF-40085');
    }
  });
});
