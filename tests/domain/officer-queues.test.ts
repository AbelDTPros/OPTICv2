import { describe, expect, it } from 'vitest';
import type { QueueDefinition, WorkflowDefinition } from '../../src/modules/configuration/domain/types.js';
import { orderedOfficerQueueKeys } from '../../src/modules/queue/domain/officer-queues.js';

describe('orderedOfficerQueueKeys', () => {
  it('orders stage queues by workflow stage order, not alphabetically', () => {
    const workflow: WorkflowDefinition = {
      initialStageKey: 'Z_FIRST',
      terminalStageKeys: ['COMPLETED'],
      stages: [
        {
          stageKey: 'Z_FIRST',
          displayName: 'First',
          order: 10,
          queueKey: 'Z_QUEUE',
          actionKeys: [],
          assignmentPolicy: { required: false, clearOnTransition: true }
        },
        {
          stageKey: 'A_SECOND',
          displayName: 'Second',
          order: 20,
          queueKey: 'A_QUEUE',
          actionKeys: [],
          assignmentPolicy: { required: false, clearOnTransition: true }
        },
        {
          stageKey: 'COMPLETED',
          displayName: 'Completed',
          order: 999,
          terminal: true,
          actionKeys: [],
          assignmentPolicy: { required: false, clearOnTransition: false }
        }
      ],
      transitionSets: []
    };
    const queues: Record<string, QueueDefinition> = {
      Z_QUEUE: {
        queueKey: 'Z_QUEUE',
        displayName: 'Z queue',
        entityType: 'WORKLOAD',
        eligibility: { source: 'workflow', field: 'currentStageKey', operator: 'EQUALS', value: 'Z_FIRST' },
        defaultSort: [],
        columns: [],
        filters: [],
        actions: [],
        pageSize: 25
      },
      A_QUEUE: {
        queueKey: 'A_QUEUE',
        displayName: 'A queue',
        entityType: 'WORKLOAD',
        eligibility: { source: 'workflow', field: 'currentStageKey', operator: 'EQUALS', value: 'A_SECOND' },
        defaultSort: [],
        columns: [],
        filters: [],
        actions: [],
        pageSize: 25
      }
    };

    expect(orderedOfficerQueueKeys(workflow, queues, 'WORKLOAD')).toEqual([
      'Z_QUEUE',
      'A_QUEUE',
      'COMPLETED',
      'ASSIGNED_TO_ME',
      'ALL_ITEMS'
    ]);
  });
});
