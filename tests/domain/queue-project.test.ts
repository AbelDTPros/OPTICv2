import { describe, expect, it } from 'vitest';
import type { CompiledDefinition } from '../../src/modules/configuration/definitions/compiled-definition.js';
import type { QueueDefinition } from '../../src/modules/configuration/domain/types.js';
import { projectInstance } from '../../src/modules/queue/domain/project.js';
import type { WorkflowInstanceRecord } from '../../src/modules/workflow/domain/types.js';
import { dataEntryQueue } from '../fixtures/i407-draft.js';

function compiled(queue: QueueDefinition): CompiledDefinition {
  return {
    releaseId: '1',
    definitionKey: 'I_90',
    version: '0.1.0',
    lifecycleStatus: 'DRAFT',
    rowVersion: 0,
    cacheKey: 'k',
    release: {
      displayName: 'I-90 Linear',
      queues: { [queue.queueKey]: queue }
    } as CompiledDefinition['release'],
    schema: { compiled: true } as CompiledDefinition['schema'],
    compiledRegexes: {}
  };
}

function instance(businessData: Record<string, unknown>): WorkflowInstanceRecord {
  return {
    id: 1,
    entityType: 'WORKLOAD',
    entityTrackingId: 'W-1',
    parentEntityType: null,
    parentTrackingId: null,
    definitionReleaseId: 1,
    currentStageDefinitionId: 1,
    currentStageKey: 'READY_FOR_DATA_ENTRY',
    status: 'ACTIVE',
    rehearsal: false,
    assignedTo: null,
    enteredStageAt: new Date('2026-09-03T00:00:00.000Z'),
    rowVersion: 0,
    businessData,
    createdAt: new Date('2026-09-03T00:00:00.000Z'),
    updatedAt: new Date('2026-09-03T00:00:00.000Z')
  };
}

describe('queue projection', () => {
  it('copies authored form fields into projectedJson', () => {
    const queue: QueueDefinition = {
      ...dataEntryQueue,
      columns: [...dataEntryQueue.columns, 'firstName', 'lastName'],
      projectedFields: [
        { fieldKey: 'firstName', label: 'Applicant First Name', path: '$.dataEntryDetails.firstName' },
        { fieldKey: 'lastName', label: 'Applicant Last Name', path: '$.dataEntryDetails.lastName' }
      ]
    };
    const row = projectInstance(
      instance({
        dataEntryDetails: { receiptNumber: 'ABC1234567890', firstName: 'Ada', lastName: 'Lovelace' }
      }),
      compiled(queue)
    );
    expect(row.receiptNumber).toBe('ABC1234567890');
    expect(row.projectedJson).toEqual({
      receiptNumber: 'ABC1234567890',
      firstName: 'Ada',
      lastName: 'Lovelace'
    });
  });

  it('projects Find a case BUSINESS_DATA fields even when no queue lists them', () => {
    const release = {
      displayName: 'I-90 Linear',
      queues: { [dataEntryQueue.queueKey]: dataEntryQueue },
      search: {
        searchKey: 'DEFAULT',
        fields: [
          {
            fieldKey: 'A_NUMBER',
            source: 'BUSINESS_DATA' as const,
            path: '$.dataEntryDetails.aNumber',
            match: 'CONTAINS',
            pii: true
          }
        ]
      }
    };
    const row = projectInstance(
      instance({
        dataEntryDetails: { receiptNumber: 'ABC1234567890', aNumber: 'A123343' }
      }),
      {
        ...compiled(dataEntryQueue),
        release: release as CompiledDefinition['release']
      }
    );
    expect(row.projectedJson).toMatchObject({
      receiptNumber: 'ABC1234567890',
      A_NUMBER: 'A123343'
    });
  });

  it('projects Dashboard-only indexed fields and skips unused ones', () => {
    const release = {
      displayName: 'I-90 Linear',
      queues: { [dataEntryQueue.queueKey]: dataEntryQueue },
      search: {
        searchKey: 'DEFAULT',
        fields: [
          {
            fieldKey: 'location',
            source: 'BUSINESS_DATA' as const,
            path: '$.dataEntryDetails.location',
            match: 'EXACT_PREFIX',
            pii: false,
            useInSearch: false,
            useInDashboard: true
          },
          {
            fieldKey: 'ignored',
            source: 'BUSINESS_DATA' as const,
            path: '$.dataEntryDetails.ignored',
            match: 'CONTAINS',
            pii: false,
            useInSearch: false,
            useInDashboard: false
          }
        ]
      }
    };
    const row = projectInstance(
      instance({
        dataEntryDetails: {
          receiptNumber: 'ABC1234567890',
          location: 'Atlanta',
          ignored: 'skip-me'
        }
      }),
      {
        ...compiled(dataEntryQueue),
        release: release as CompiledDefinition['release']
      }
    );
    expect(row.projectedJson).toMatchObject({
      receiptNumber: 'ABC1234567890',
      location: 'Atlanta'
    });
    expect(row.projectedJson).not.toHaveProperty('ignored');
  });

  it('projects SLA state from the current stage clock', () => {
    const now = new Date('2026-09-05T00:00:00.000Z'); // 48h after entered
    const withSla: CompiledDefinition = {
      ...compiled(dataEntryQueue),
      release: {
        ...compiled(dataEntryQueue).release,
        workflow: {
          initialStageKey: 'READY_FOR_DATA_ENTRY',
          stages: [
            {
              stageKey: 'READY_FOR_DATA_ENTRY',
              displayName: 'Ready',
              order: 1,
              slaKey: 'DATA_ENTRY_SLA',
              actionKeys: [],
              assignmentPolicy: { mode: 'PULL', allowSelfAssign: true, allowReassign: true, allowRelease: true }
            }
          ],
          terminalStageKeys: [],
          transitionSets: []
        },
        slas: {
          DATA_ENTRY_SLA: {
            slaKey: 'DATA_ENTRY_SLA',
            clock: 'CALENDAR',
            target: { durationHours: 48 },
            warningThresholdPercent: 75,
            breachThresholdPercent: 100,
            severityOnBreach: 'HIGH'
          }
        }
      }
    };
    const row = projectInstance(instance({ receiptNumber: 'ABC1234567890' }), withSla, now);
    expect(row.slaState).toBe('BREACHED');
  });
});
