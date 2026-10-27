import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/platform/errors/app-error.js';
import { AuthenticatedActorAuthorization } from '../../src/platform/security/authorization-port.js';
import { InMemoryDefinitionRepository } from '../../src/modules/configuration/persistence/in-memory-definition.repository.js';
import { DefinitionReleaseService } from '../../src/modules/configuration/service/definition-release.service.js';
import { InMemoryOutboxRepository } from '../../src/platform/outbox/in-memory-outbox.repository.js';
import { dataEntryQueue, i407Workflow, saveDraftAction } from '../fixtures/i407-draft.js';

const actor = {
  actorId: 'configurator@example.gov',
  roles: ['CONFIGURATOR'],
  correlationId: 'c-slice1-test',
  sessionId: 's-slice1-test'
};

function createService() {
  const repository = new InMemoryDefinitionRepository();
  const outbox = new InMemoryOutboxRepository();
  const service = new DefinitionReleaseService(
    repository,
    new AuthenticatedActorAuthorization(),
    async (work) => work(),
    outbox
  );
  return { repository, service, outbox };
}

describe('DefinitionReleaseService draft lifecycle', () => {
  it('creates a definition and empty DRAFT release', async () => {
    const { service } = createService();
    const definition = await service.createDefinition(actor, {
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    const release = await service.createDraftRelease(actor, {
      definitionKey: definition.definitionKey,
      version: '0.1.0'
    });

    expect(release.lifecycleStatus).toBe('DRAFT');
    expect(release.definitionKey).toBe('I_407');
    expect(release.workflow.stages).toEqual([]);
    expect(release.rowVersion).toBe(0);
  });

  it('writes CONFIG_DRAFT_CREATED and CONFIG_CHANGED outbox events with the mutation', async () => {
    const { service, outbox } = createService();
    await service.createDefinition(actor, {
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    await service.createDraftRelease(actor, { definitionKey: 'I_407', version: '0.1.0' });
    await service.saveWorkflow(actor, {
      definitionKey: 'I_407',
      version: '0.1.0',
      expectedRowVersion: 0,
      payload: i407Workflow
    });

    expect(outbox.events.map((event) => event.eventType)).toEqual([
      'CONFIG_CHANGED',
      'CONFIG_DRAFT_CREATED',
      'CONFIG_CHANGED'
    ]);
    expect(outbox.events.every((event) => event.publishStatus === 'PENDING')).toBe(true);
    expect(outbox.events[1]?.correlationId).toBe('c-slice1-test');
    expect(outbox.events[1]?.payload).not.toHaveProperty('receiptNumber');
  });

  it('persists workflow children and increments rowVersion', async () => {
    const { service, repository } = createService();
    await service.createDefinition(actor, {
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    await service.createDraftRelease(actor, { definitionKey: 'I_407', version: '0.1.0' });

    const saved = await service.saveWorkflow(actor, {
      definitionKey: 'I_407',
      version: '0.1.0',
      expectedRowVersion: 0,
      payload: i407Workflow
    });

    expect(saved.rowVersion).toBe(1);
    expect(saved.workflow.initialStageKey).toBe('DOCUMENT_PREP');
    expect(saved.workflow.stages.map((stage) => stage.stageKey)).toContain('FRAUD_REVIEW');
    expect(saved.workflow.transitionSets[0]?.defaultTargetStageKey).toBe('READY_FOR_SHIPPING');
    const first = await repository.listChildren(Number(saved.id), 'stage');
    const again = await service.saveWorkflow(actor, {
      definitionKey: 'I_407',
      version: '0.1.0',
      expectedRowVersion: 1,
      payload: {
        ...i407Workflow,
        stages: i407Workflow.stages.map((stage) =>
          stage.stageKey === 'DOCUMENT_PREP' ? { ...stage, displayName: 'Document Prep (edited)' } : stage
        )
      }
    });
    const second = await repository.listChildren(Number(again.id), 'stage');
    expect(second.map((stage) => stage.id)).toEqual(first.map((stage) => stage.id));
    expect(second.find((stage) => stage.stableKey === 'DOCUMENT_PREP')?.config).toMatchObject({
      displayName: 'Document Prep (edited)'
    });
  });

  it('persists each normalized child table type on a draft', async () => {
    const { service } = createService();
    await service.createDefinition(actor, {
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    await service.createDraftRelease(actor, { definitionKey: 'I_407', version: '0.1.0' });

    await service.saveAction(actor, {
      definitionKey: 'I_407',
      version: '0.1.0',
      expectedRowVersion: 0,
      payload: saveDraftAction
    });
    await service.saveQueue(actor, {
      definitionKey: 'I_407',
      version: '0.1.0',
      expectedRowVersion: 1,
      payload: dataEntryQueue
    });
    await service.saveForm(actor, {
      definitionKey: 'I_407',
      version: '0.1.0',
      expectedRowVersion: 2,
      payload: {
        formKey: 'I407_DATA_ENTRY',
        dataPath: '$.dataEntryDetails',
        title: 'Data Entry',
        sections: []
      }
    });
    await service.saveBulkAction(actor, {
      definitionKey: 'I_407',
      version: '0.1.0',
      expectedRowVersion: 3,
      payload: {
        bulkActionKey: 'BULK_SHIP',
        label: 'Ship Selected',
        stageKey: 'READY_FOR_SHIPPING',
        maxSelection: 100,
        transactionMode: 'BEST_EFFORT'
      }
    });
    await service.saveScheduledAction(actor, {
      definitionKey: 'I_407',
      version: '0.1.0',
      expectedRowVersion: 4,
      payload: {
        scheduledActionKey: 'ON_HOLD_EXPIRATION',
        trigger: { type: 'STAGE_ENTERED', stageKey: 'ON_HOLD' },
        delay: { source: 'CONFIG', duration: { days: 90 } },
        action: { type: 'TRANSITION', targetStage: 'QA' }
      }
    });
    await service.saveSla(actor, {
      definitionKey: 'I_407',
      version: '0.1.0',
      expectedRowVersion: 5,
      payload: {
        slaKey: 'DATA_ENTRY_SLA',
        clock: 'CALENDAR',
        target: { durationHours: 48 },
        warningThresholdPercent: 75,
        breachThresholdPercent: 100,
        severityOnBreach: 'HIGH'
      }
    });
    const saved = await service.saveSearch(actor, {
      definitionKey: 'I_407',
      version: '0.1.0',
      expectedRowVersion: 6,
      payload: {
        searchKey: 'DEFAULT',
        fields: [
          {
            fieldKey: 'trackingId',
            source: 'SYSTEM',
            path: '$.trackingId',
            match: 'EXACT_PREFIX',
            pii: false
          }
        ]
      }
    });

    expect(saved.actions.SAVE_DRAFT?.label).toBe('Save Draft');
    expect(saved.queues.READY_FOR_DATA_ENTRY?.pageSize).toBe(25);
    expect(saved.queues.READY_FOR_DATA_ENTRY?.columns).toContain('receiptNumber');
    expect(saved.forms.I407_DATA_ENTRY?.dataPath).toBe('$.dataEntryDetails');
    expect(saved.bulkActions.BULK_SHIP?.transactionMode).toBe('BEST_EFFORT');
    expect(saved.scheduledActions.ON_HOLD_EXPIRATION?.trigger).toMatchObject({ type: 'STAGE_ENTERED' });
    expect(saved.slas.DATA_ENTRY_SLA?.target.durationHours).toBe(48);
    expect(saved.search.fields[0]?.fieldKey).toBe('trackingId');
    expect(saved.rowVersion).toBe(7);
  });

  it('rejects a queue column that is not projected', async () => {
    const { service } = createService();
    await service.createDefinition(actor, {
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    await service.createDraftRelease(actor, { definitionKey: 'I_407', version: '0.1.0' });
    await expect(
      service.saveQueue(actor, {
        definitionKey: 'I_407',
        version: '0.1.0',
        expectedRowVersion: 0,
        payload: { ...dataEntryQueue, columns: ['trackingId', 'secretNotes'] }
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-CONFIG-40026' });
  });

  it('rejects stale rowVersion without overwriting', async () => {
    const { service } = createService();
    await service.createDefinition(actor, {
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    await service.createDraftRelease(actor, { definitionKey: 'I_407', version: '0.1.0' });
    await service.saveAction(actor, {
      definitionKey: 'I_407',
      version: '0.1.0',
      expectedRowVersion: 0,
      payload: saveDraftAction
    });

    await expect(
      service.saveQueue(actor, {
        definitionKey: 'I_407',
        version: '0.1.0',
        expectedRowVersion: 0,
        payload: dataEntryQueue
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-WF-40901' });

    const current = await service.getRelease(actor, 'I_407', '0.1.0');
    expect(current.queues.READY_FOR_DATA_ENTRY).toBeUndefined();
    expect(current.actions.SAVE_DRAFT).toBeDefined();
  });

  it('blocks edits once a release is no longer DRAFT', async () => {
    const { service, repository } = createService();
    await service.createDefinition(actor, {
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    await service.createDraftRelease(actor, { definitionKey: 'I_407', version: '0.1.0' });
    repository.setLifecycleForTest('I_407', '0.1.0', 'PUBLISHED');

    await expect(
      service.saveWorkflow(actor, {
        definitionKey: 'I_407',
        version: '0.1.0',
        expectedRowVersion: 0,
        payload: i407Workflow
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-CONFIG-40902' });
  });

  it('clones children into a new DRAFT without sharing identity', async () => {
    const { service } = createService();
    await service.createDefinition(actor, {
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    await service.createDraftRelease(actor, { definitionKey: 'I_407', version: '0.1.0' });
    await service.saveWorkflow(actor, {
      definitionKey: 'I_407',
      version: '0.1.0',
      expectedRowVersion: 0,
      payload: i407Workflow
    });

    const clone = await service.createDraftRelease(actor, {
      definitionKey: 'I_407',
      version: '0.2.0',
      cloneFromVersion: '0.1.0'
    });

    expect(clone.version).toBe('0.2.0');
    expect(clone.lifecycleStatus).toBe('DRAFT');
    expect(clone.id).not.toBe('1');
    expect(clone.workflow.stages).toHaveLength(5);
  });

  it('clones a release onto a new definition key', async () => {
    const { service } = createService();
    await service.createDefinition(actor, {
      definitionKey: 'I_90',
      displayName: 'I-90',
      entityType: 'WORKLOAD'
    });
    await service.createDraftRelease(actor, { definitionKey: 'I_90', version: '1.0.0' });
    await service.saveWorkflow(actor, {
      definitionKey: 'I_90',
      version: '1.0.0',
      expectedRowVersion: 0,
      payload: i407Workflow
    });
    await service.createDefinition(actor, {
      definitionKey: 'I_131',
      displayName: 'I-131 Travel',
      entityType: 'WORKLOAD'
    });

    const clone = await service.createDraftRelease(actor, {
      definitionKey: 'I_131',
      version: '1.0.0',
      cloneFromDefinitionKey: 'I_90',
      cloneFromVersion: '1.0.0'
    });
    const source = await service.getRelease(actor, 'I_90', '1.0.0');

    expect(clone.definitionKey).toBe('I_131');
    expect(clone.displayName).toBe('I-131 Travel');
    expect(clone.version).toBe('1.0.0');
    expect(clone.lifecycleStatus).toBe('DRAFT');
    expect(clone.workflow.stages).toHaveLength(5);
    expect(clone.id).not.toBe(source.id);
    expect(source.definitionKey).toBe('I_90');
    expect(source.workflow.stages).toHaveLength(5);
  });

  it('retargets form keys, queue keys, titles, and spawn when cloning onto a new type', async () => {
    const { service } = createService();
    await service.createDefinition(actor, {
      definitionKey: 'I_407_MAILITEM',
      displayName: 'I-407 Mail',
      entityType: 'MAIL'
    });
    await service.createDraftRelease(actor, { definitionKey: 'I_407_MAILITEM', version: '0.1.0' });
    await service.saveForm(actor, {
      definitionKey: 'I_407_MAILITEM',
      version: '0.1.0',
      expectedRowVersion: 0,
      payload: {
        formKey: 'I407_DOCUMENT_PREP',
        dataPath: '$',
        title: 'I-407 Document Prep',
        schema: { type: 'object', additionalProperties: true },
        sections: [
          {
            sectionKey: 'WORKLOADS',
            title: 'Workloads',
            repeatable: true,
            path: '$.workloads',
            spawnDefinitionKey: 'I_407_WORKLOAD',
            fields: [{ fieldKey: 'TRACKING_ID', path: '$.trackingId', component: 'TEXT_INPUT', label: 'Tracking ID' }]
          }
        ]
      }
    });
    await service.saveQueue(actor, {
      definitionKey: 'I_407_MAILITEM',
      version: '0.1.0',
      expectedRowVersion: 1,
      payload: {
        ...dataEntryQueue,
        queueKey: 'READY_FOR_DOC_PREP',
        displayName: 'Ready for Doc Prep',
        entityType: 'MAIL'
      }
    });
    await service.saveWorkflow(actor, {
      definitionKey: 'I_407_MAILITEM',
      version: '0.1.0',
      expectedRowVersion: 2,
      payload: {
        initialStageKey: 'DOCUMENT_PREP',
        terminalStageKeys: ['COMPLETED'],
        stages: [
          {
            stageKey: 'DOCUMENT_PREP',
            displayName: 'Document Prep',
            order: 10,
            formKey: 'I407_DOCUMENT_PREP',
            queueKey: 'READY_FOR_DOC_PREP',
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
      }
    });
    await service.createDefinition(actor, {
      definitionKey: 'I_936_MAILITEM',
      displayName: 'I-936 Mail',
      entityType: 'MAIL'
    });

    const clone = await service.createDraftRelease(actor, {
      definitionKey: 'I_936_MAILITEM',
      version: '0.1.0',
      cloneFromDefinitionKey: 'I_407_MAILITEM',
      cloneFromVersion: '0.1.0'
    });

    expect(clone.forms.I936_DOCUMENT_PREP?.formKey).toBe('I936_DOCUMENT_PREP');
    expect(clone.forms.I936_DOCUMENT_PREP?.title).toBe('I-936 Document Prep');
    expect(clone.forms.I936_DOCUMENT_PREP?.sections[0]?.spawnDefinitionKey).toBe('I_936_WORKLOAD');
    expect(clone.forms.I407_DOCUMENT_PREP).toBeUndefined();
    expect(clone.queues.I_936_READY_FOR_DOC_PREP?.queueKey).toBe('I_936_READY_FOR_DOC_PREP');
    expect(clone.queues.I_936_READY_FOR_DOC_PREP?.displayName).toBe('Ready for Doc Prep');
    expect(clone.queues.READY_FOR_DOC_PREP).toBeUndefined();
    expect(clone.workflow.stages[0]?.formKey).toBe('I936_DOCUMENT_PREP');
    expect(clone.workflow.stages[0]?.queueKey).toBe('I_936_READY_FOR_DOC_PREP');
    expect(clone.workflow.stages[0]?.stageKey).toBe('DOCUMENT_PREP');
  });

  it('deletes a DRAFT and removes the definition when it was the last release', async () => {
    const { service, outbox } = createService();
    await service.createDefinition(actor, {
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    await service.createDraftRelease(actor, { definitionKey: 'I_407', version: '0.1.0' });
    await service.saveWorkflow(actor, {
      definitionKey: 'I_407',
      version: '0.1.0',
      expectedRowVersion: 0,
      payload: i407Workflow
    });

    const deleted = await service.deleteDraftRelease(actor, {
      definitionKey: 'I_407',
      version: '0.1.0',
      expectedRowVersion: 1
    });

    expect(deleted).toEqual({
      definitionKey: 'I_407',
      version: '0.1.0',
      definitionRemoved: true
    });
    await expect(service.getRelease(actor, 'I_407', '0.1.0')).rejects.toMatchObject({
      errorCode: 'OPTIC-CONFIG-40402'
    });
    expect(await service.listReleaseCatalog(actor)).toEqual([]);
    const changes = outbox.events.map((event) => {
      const inner = event.payload.payload as { change?: string } | undefined;
      return inner?.change;
    });
    expect(changes).toContain('DRAFT_DELETED');
    expect(changes).toContain('DEFINITION_DELETED');

    await expect(
      service.createDefinition(actor, {
        definitionKey: 'I_407',
        displayName: 'I-407 Workload',
        entityType: 'WORKLOAD'
      })
    ).resolves.toMatchObject({ definitionKey: 'I_407' });
  });

  it('keeps the definition when another release remains', async () => {
    const { service } = createService();
    await service.createDefinition(actor, {
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    await service.createDraftRelease(actor, { definitionKey: 'I_407', version: '0.1.0' });
    await service.createDraftRelease(actor, { definitionKey: 'I_407', version: '0.2.0' });

    const deleted = await service.deleteDraftRelease(actor, {
      definitionKey: 'I_407',
      version: '0.1.0',
      expectedRowVersion: 0
    });

    expect(deleted.definitionRemoved).toBe(false);
    await expect(service.getRelease(actor, 'I_407', '0.2.0')).resolves.toMatchObject({ version: '0.2.0' });
    await expect(
      service.createDefinition(actor, {
        definitionKey: 'I_407',
        displayName: 'I-407',
        entityType: 'WORKLOAD'
      })
    ).rejects.toBeInstanceOf(AppError);
  });

  it('refuses to delete a non-DRAFT release', async () => {
    const { service, repository } = createService();
    await service.createDefinition(actor, {
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    await service.createDraftRelease(actor, { definitionKey: 'I_407', version: '0.1.0' });
    repository.setLifecycleForTest('I_407', '0.1.0', 'PUBLISHED');

    await expect(
      service.deleteDraftRelease(actor, {
        definitionKey: 'I_407',
        version: '0.1.0',
        expectedRowVersion: 0
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-CONFIG-40908' });
  });

  it('refuses to delete the active release', async () => {
    const { service, repository } = createService();
    await service.createDefinition(actor, {
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    await service.createDraftRelease(actor, { definitionKey: 'I_407', version: '0.1.0' });
    repository.setActiveReleaseForTest('I_407', '0.1.0');

    await expect(
      service.deleteDraftRelease(actor, {
        definitionKey: 'I_407',
        version: '0.1.0',
        expectedRowVersion: 0
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-CONFIG-40908' });
  });

  it('refuses to delete a stale DRAFT rowVersion', async () => {
    const { service } = createService();
    await service.createDefinition(actor, {
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    await service.createDraftRelease(actor, { definitionKey: 'I_407', version: '0.1.0' });

    await expect(
      service.deleteDraftRelease(actor, {
        definitionKey: 'I_407',
        version: '0.1.0',
        expectedRowVersion: 9
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-WF-40901' });
  });

  it('rejects duplicate definition keys', async () => {
    const { service } = createService();
    await service.createDefinition(actor, {
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    await expect(
      service.createDefinition(actor, {
        definitionKey: 'I_407',
        displayName: 'I-407 Duplicate',
        entityType: 'WORKLOAD'
      })
    ).rejects.toBeInstanceOf(AppError);
  });
});
