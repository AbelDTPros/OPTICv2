import { describe, expect, it } from 'vitest';
import {
  createCloneRetarget,
  retargetClonedChild,
  retargetSpawnDefinitionKey,
  shouldRetargetClone
} from '../../src/modules/configuration/domain/clone-retarget.js';

describe('clone retarget', () => {
  it('does not retarget a new version of the same definition', () => {
    expect(shouldRetargetClone('I_407_MAILITEM', 'I_407_MAILITEM')).toBe(false);
    expect(shouldRetargetClone('I_407_MAILITEM', 'I_936_MAILITEM')).toBe(true);
  });

  it('rewrites I-407 form keys, titles, queue keys, and spawn onto I-936', () => {
    const retarget = createCloneRetarget('I_407_MAILITEM', 'I_936_MAILITEM', [
      {
        kind: 'form',
        stableKey: 'I407_DOCUMENT_PREP',
        config: {
          formKey: 'I407_DOCUMENT_PREP',
          title: 'I-407 Document Prep',
          sections: [{ sectionKey: 'WORKLOADS', spawnDefinitionKey: 'I_407_WORKLOAD', fields: [] }]
        }
      },
      {
        kind: 'queue',
        stableKey: 'READY_FOR_DOC_PREP',
        config: { queueKey: 'READY_FOR_DOC_PREP', displayName: 'Ready for Doc Prep' }
      },
      {
        kind: 'stage',
        stableKey: 'DOCUMENT_PREP',
        config: {
          stageKey: 'DOCUMENT_PREP',
          formKey: 'I407_DOCUMENT_PREP',
          queueKey: 'READY_FOR_DOC_PREP',
          displayName: 'Document Prep'
        }
      }
    ]);

    const form = retargetClonedChild(
      'form',
      {
        stableKey: 'I407_DOCUMENT_PREP',
        config: {
          formKey: 'I407_DOCUMENT_PREP',
          title: 'I-407 Document Prep',
          sections: [{ sectionKey: 'WORKLOADS', spawnDefinitionKey: 'I_407_WORKLOAD', fields: [] }]
        }
      },
      retarget
    );
    expect(form.stableKey).toBe('I936_DOCUMENT_PREP');
    expect(form.config.formKey).toBe('I936_DOCUMENT_PREP');
    expect(form.config.title).toBe('I-936 Document Prep');
    const spaced = retargetClonedChild(
      'form',
      { stableKey: 'I_407_MAILITEM', config: { formKey: 'I_407_MAILITEM', title: 'I 407 Mail Item' } },
      retarget
    );
    expect(spaced.config.title).toBe('I 936 Mail Item');
    expect((form.config.sections as Array<{ spawnDefinitionKey: string }>)[0]?.spawnDefinitionKey).toBe(
      'I_936_WORKLOAD'
    );

    const queue = retargetClonedChild(
      'queue',
      {
        stableKey: 'READY_FOR_DOC_PREP',
        config: { queueKey: 'READY_FOR_DOC_PREP', displayName: 'Ready for Doc Prep' }
      },
      retarget
    );
    expect(queue.stableKey).toBe('I_936_READY_FOR_DOC_PREP');
    expect(queue.config.queueKey).toBe('I_936_READY_FOR_DOC_PREP');
    expect(queue.config.displayName).toBe('Ready for Doc Prep');

    const stage = retargetClonedChild(
      'stage',
      {
        stableKey: 'DOCUMENT_PREP',
        config: {
          stageKey: 'DOCUMENT_PREP',
          formKey: 'I407_DOCUMENT_PREP',
          queueKey: 'READY_FOR_DOC_PREP',
          displayName: 'Document Prep'
        }
      },
      retarget
    );
    expect(stage.stableKey).toBe('DOCUMENT_PREP');
    expect(stage.config.stageKey).toBe('DOCUMENT_PREP');
    expect(stage.config.formKey).toBe('I936_DOCUMENT_PREP');
    expect(stage.config.queueKey).toBe('I_936_READY_FOR_DOC_PREP');
  });

  it('maps a bare I_407 spawn key to I_936_WORKLOAD', () => {
    const retarget = createCloneRetarget('I_407_MAILITEM', 'I_936_MAILITEM', []);
    expect(retargetSpawnDefinitionKey('I_407', retarget)).toBe('I_936_WORKLOAD');
    expect(retargetSpawnDefinitionKey('I_407_WORKLOAD', retarget)).toBe('I_936_WORKLOAD');
  });

  it('keeps eligibility stage values when the queue key matches the stage key', () => {
    const retarget = createCloneRetarget('I_407_WORKLOAD', 'I_936_WORKLOAD', [
      {
        kind: 'queue',
        stableKey: 'READY_FOR_DATA_ENTRY',
        config: { queueKey: 'READY_FOR_DATA_ENTRY', displayName: 'Ready for Data Entry' }
      }
    ]);
    const queue = retargetClonedChild(
      'queue',
      {
        stableKey: 'READY_FOR_DATA_ENTRY',
        config: {
          queueKey: 'READY_FOR_DATA_ENTRY',
          displayName: 'Ready for Data Entry',
          eligibility: {
            all: [{ source: 'workflow', field: 'currentStageKey', operator: 'EQUALS', value: 'READY_FOR_DATA_ENTRY' }]
          }
        }
      },
      retarget
    );
    expect(queue.config.queueKey).toBe('I_936_READY_FOR_DATA_ENTRY');
    expect(queue.config.eligibility).toEqual({
      all: [{ source: 'workflow', field: 'currentStageKey', operator: 'EQUALS', value: 'READY_FOR_DATA_ENTRY' }]
    });
  });
});
