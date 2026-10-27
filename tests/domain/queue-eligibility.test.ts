import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/platform/errors/app-error.js';
import { eligibilityToSql, matchesEligibility, parseQueueEligibility } from '../../src/modules/queue/domain/eligibility.js';
import { applyQueueQuery } from '../../src/modules/queue/domain/query.js';
import { validateQueueDefinition } from '../../src/modules/queue/domain/validate-queue.js';
import type { QueueProjectionRecord } from '../../src/modules/queue/domain/types.js';
import { dataEntryQueue } from '../fixtures/i407-draft.js';

function row(overrides: Partial<QueueProjectionRecord> = {}): QueueProjectionRecord {
  return {
    workflowInstanceId: 1,
    entityType: 'WORKLOAD',
    entityTrackingId: 'W-1',
    definitionKey: 'I_90',
    definitionReleaseId: 10,
    workloadType: 'I-90 Linear',
    currentStageKey: 'READY_FOR_DATA_ENTRY',
    assignedTo: null,
    branchKey: null,
    locationKey: null,
    priority: null,
    receivedAt: new Date('2026-08-22T12:00:00.000Z'),
    enteredStageAt: new Date('2026-08-22T15:00:00.000Z'),
    slaState: null,
    receiptNumber: 'ABC1234567890',
    status: 'ACTIVE',
    rowVersion: 0,
    projectedJson: {},
    updatedAt: new Date('2026-08-22T15:00:00.000Z'),
    ...overrides
  };
}

describe('queue eligibility', () => {
  it('translates stage equality to parameterized SQL', () => {
    const eligibility = parseQueueEligibility(dataEntryQueue.eligibility, dataEntryQueue.queueKey);
    const sql = eligibilityToSql(eligibility);
    expect(sql.sql).toContain('p.current_stage_key = ?');
    expect(sql.params).toEqual(['READY_FOR_DATA_ENTRY']);
    expect(matchesEligibility(row(), eligibility)).toBe(true);
    expect(matchesEligibility(row({ currentStageKey: 'COMPLETED' }), eligibility)).toBe(false);
  });

  it('rejects JSONPath-only or unprojected eligibility fields', () => {
    try {
      parseQueueEligibility({
        all: [{ source: 'business', field: '$.notes', operator: 'EQUALS', value: 'secret' }]
      });
      throw new Error('expected validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).errorCode).toBe('OPTIC-CONFIG-40026');
    }
  });

  it('rejects MATCHES because it cannot be an indexed SQL predicate', () => {
    try {
      parseQueueEligibility({
        all: [{ source: 'workflow', field: 'currentStageKey', operator: 'MATCHES', value: '^READY' }]
      });
      throw new Error('expected validation failure');
    } catch (error) {
      expect((error as AppError).errorCode).toBe('OPTIC-CONFIG-40026');
    }
  });

  it('pages, sorts, and filters in memory with the same eligibility rules', () => {
    const eligibility = parseQueueEligibility(dataEntryQueue.eligibility, 'READY_FOR_DATA_ENTRY');
    const result = applyQueueQuery(
      [
        row({ workflowInstanceId: 1, entityTrackingId: 'W-1', assignedTo: null }),
        row({
          workflowInstanceId: 2,
          entityTrackingId: 'W-2',
          assignedTo: 'officer@example.gov',
          enteredStageAt: new Date('2026-08-22T16:00:00.000Z')
        }),
        row({ workflowInstanceId: 3, entityTrackingId: 'W-3', currentStageKey: 'COMPLETED' })
      ],
      {
        eligibility,
        entityType: 'WORKLOAD',
        filters: { assignedStatus: 'UNASSIGNED' },
        sort: [{ field: 'enteredStageAt', direction: 'ASC' }],
        page: 1,
        pageSize: 10
      }
    );
    expect(result.total).toBe(1);
    expect(result.rows.map((item) => item.entityTrackingId)).toEqual(['W-1']);
  });

  it('rejects an unknown configured column', () => {
    try {
      validateQueueDefinition(
        { ...dataEntryQueue, columns: ['trackingId', 'secretNotes'] },
        { requireEligibility: false }
      );
      throw new Error('expected validation failure');
    } catch (error) {
      expect((error as AppError).errorCode).toBe('OPTIC-CONFIG-40026');
    }
  });

  it('allows a form field column when the queue declares it', () => {
    expect(() =>
      validateQueueDefinition(
        {
          ...dataEntryQueue,
          columns: ['trackingId', 'firstName', 'lastName'],
          projectedFields: [
            { fieldKey: 'firstName', label: 'Applicant First Name', path: '$.dataEntryDetails.firstName' },
            { fieldKey: 'lastName', label: 'Applicant Last Name', path: '$.dataEntryDetails.lastName' }
          ]
        },
        { requireEligibility: false }
      )
    ).not.toThrow();
  });

  it('rejects a projected field that collides with a platform column', () => {
    try {
      validateQueueDefinition(
        {
          ...dataEntryQueue,
          projectedFields: [{ fieldKey: 'receiptNumber', label: 'Receipt', path: '$.receiptNumber' }]
        },
        { requireEligibility: false }
      );
      throw new Error('expected validation failure');
    } catch (error) {
      expect((error as AppError).errorCode).toBe('OPTIC-CONFIG-40026');
    }
  });
});
