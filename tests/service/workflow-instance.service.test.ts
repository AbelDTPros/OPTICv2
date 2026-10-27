import { describe, expect, it } from 'vitest';
import { DEFAULT_SPLUNK_MASK_POLICY } from '../../src/modules/configuration/domain/types.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import { seedPublishedLinear } from '../helpers/publish-linear.js';
import { createTestRuntime } from '../helpers/test-app.js';

const actor = {
  actorId: 'officer@example.gov',
  roles: ['OFFICER'],
  correlationId: 'c-wf-service'
};

describe('WorkflowInstanceService', () => {
  it('creates an instance pinned to a published release and opens visit 1', async () => {
    const runtime = createTestRuntime();
    const { releaseId } = await seedPublishedLinear(runtime);
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1001',
      definitionKey: 'I_90'
    });

    expect(created.definition.releaseId).toBe(releaseId);
    expect(created.definition.version).toBe('1.0.0');
    expect(created.workflow.currentStageKey).toBe('READY_FOR_DATA_ENTRY');
    expect(created.workflow.openVisitNumber).toBe(1);
    expect(created.visits).toHaveLength(1);
    expect(created.visits[0]?.visitNumber).toBe(1);
    expect(runtime.outbox.events.some((event) => event.eventType === 'WORKLOAD_CREATED')).toBe(true);
    expect(runtime.outbox.events.some((event) => event.eventType === 'SCHEDULED_ACTION_CREATED')).toBe(true);
    const stored = await runtime.instances.findByEntity('WORKLOAD', 'W-1001');
    expect(stored?.rehearsal).toBe(false);
    expect(await runtime.projections.findByEntity('WORKLOAD', 'W-1001')).not.toBeNull();
  });

  it('creates a rehearsal instance against a DRAFT when version is explicit', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    runtime.repository.setLifecycleForTest('I_90', '1.0.0', 'DRAFT');
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'TRIAL-W-1002',
      definitionKey: 'I_90',
      version: '1.0.0'
    });
    expect(created.workflow.currentStageKey).toBe('READY_FOR_DATA_ENTRY');
    expect(created.stageForm?.formKey).toBe('I90_DATA_ENTRY');
    expect((await runtime.instances.findByEntity('WORKLOAD', 'TRIAL-W-1002'))?.rehearsal).toBe(true);
    expect(await runtime.projections.findByEntity('WORKLOAD', 'TRIAL-W-1002')).toBeNull();
    expect(runtime.outbox.events.some((event) => event.eventType === 'SCHEDULED_ACTION_CREATED')).toBe(false);
    await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'TRIAL-W-1003',
      definitionKey: 'I_90',
      version: '1.0.0'
    });
    const listed = await runtime.workflow.listInstancesForRelease(actor, 'I_90', '1.0.0');
    expect(listed.items.map((item) => item.trackingId)).toEqual(['TRIAL-W-1002', 'TRIAL-W-1003']);
    expect(listed.items[0]?.currentStageKey).toBe('READY_FOR_DATA_ENTRY');
  });

  it('treats explicit version creates as rehearsal even on a published release', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'TRY-PINNED-1',
      definitionKey: 'I_90',
      version: '1.0.0'
    });
    expect((await runtime.instances.findByEntity('WORKLOAD', 'TRY-PINNED-1'))?.rehearsal).toBe(true);
    expect(await runtime.projections.findByEntity('WORKLOAD', 'TRY-PINNED-1')).toBeNull();
    const page = await runtime.queues.getQueuePage(actor, 'READY_FOR_DATA_ENTRY', {
      definitionKey: 'I_90'
    });
    expect(page.total).toBe(0);
  });

  it('scrubs existing cases from Live when a release is activated', async () => {
    const runtime = createTestRuntime();
    const { releaseId } = await seedPublishedLinear(runtime);
    await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-LIVE-THEN-SCRUB',
      definitionKey: 'I_90'
    });
    expect(await runtime.projections.findByEntity('WORKLOAD', 'W-LIVE-THEN-SCRUB')).not.toBeNull();

    const release = await runtime.repository.findReleaseByKeyAndVersion('I_90', '1.0.0');
    expect(release).toBeTruthy();
    await runtime.service.activate(actor, {
      definitionKey: 'I_90',
      version: '1.0.0',
      expectedRowVersion: release!.rowVersion
    });

    expect((await runtime.instances.findByEntity('WORKLOAD', 'W-LIVE-THEN-SCRUB'))?.rehearsal).toBe(true);
    expect(await runtime.projections.findByEntity('WORKLOAD', 'W-LIVE-THEN-SCRUB')).toBeNull();
    expect(Number(releaseId)).toBeGreaterThan(0);
  });

  it('rejects create against a DRAFT when version is omitted', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    runtime.repository.setLifecycleForTest('I_90', '1.0.0', 'DRAFT');
    try {
      await runtime.workflow.createInstance(actor, {
        entityType: 'WORKLOAD',
        entityTrackingId: 'W-1002',
        definitionKey: 'I_90'
      });
      throw new Error('expected draft create without version to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).errorCode).toBe('OPTIC-WF-40040');
    }
  });

  it('increments visit_number when the same stage is re-entered', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1003',
      definitionKey: 'I_90',
      version: '1.0.0'
    });
    await runtime.workflow.enterStage(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1003',
      stageKey: 'COMPLETED',
      expectedRowVersion: created.workflow.rowVersion
    });
    const returned = await runtime.workflow.enterStage(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1003',
      stageKey: 'READY_FOR_DATA_ENTRY',
      expectedRowVersion: created.workflow.rowVersion + 1
    });

    const dataEntryVisits = returned.visits.filter((visit) => visit.stageKey === 'READY_FOR_DATA_ENTRY');
    expect(dataEntryVisits.map((visit) => visit.visitNumber)).toEqual([1, 2]);
    expect(returned.workflow.currentStageKey).toBe('READY_FOR_DATA_ENTRY');
    expect(returned.workflow.openVisitNumber).toBe(2);
    expect(returned.status).toBe('ACTIVE');
    expect(runtime.outbox.events.some((event) => event.eventType === 'STAGE_ENTERED')).toBe(true);
    const transitions = await runtime.instances.listTransitions(created.workflowInstanceId);
    expect(transitions.map((row) => row.actionKey)).toEqual(['STAGE_REENTRY', 'STAGE_REENTRY']);
  });

  it('keeps the pinned release after a newer release becomes active', async () => {
    const runtime = createTestRuntime();
    const first = await seedPublishedLinear(runtime, '1.0.0');
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1004',
      definitionKey: 'I_90',
      version: '1.0.0'
    });
    await runtime.service.createDraftRelease(actor, { definitionKey: 'I_90', version: '1.1.0' });
    await runtime.service.saveWorkflow(actor, {
      definitionKey: 'I_90',
      version: '1.1.0',
      expectedRowVersion: 0,
      payload: {
        initialStageKey: 'READY_FOR_DATA_ENTRY',
        terminalStageKeys: ['COMPLETED'],
        stages: [
          {
            stageKey: 'READY_FOR_DATA_ENTRY',
            displayName: 'Ready for Data Entry',
            order: 10,
            formKey: 'I90_DATA_ENTRY',
            queueKey: 'READY_FOR_DATA_ENTRY',
            actionKeys: ['SAVE_DRAFT', 'COMPLETE_DATA_ENTRY'],
            assignmentPolicy: { required: true, clearOnTransition: true }
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
    runtime.repository.setLifecycleForTest('I_90', '1.1.0', 'PUBLISHED');
    runtime.repository.setActiveReleaseForTest('I_90', '1.1.0');

    const after = await runtime.workflow.enterStage(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1004',
      stageKey: 'COMPLETED',
      expectedRowVersion: created.workflow.rowVersion
    });
    expect(after.definition.version).toBe('1.0.0');
    expect(after.definition.releaseId).toBe(first.releaseId);
  });

  it('assigns to self, rejects a second assign, and releases back to the queue', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1005',
      definitionKey: 'I_90'
    });
    const assigned = await runtime.workflow.assignToSelf(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1005',
      expectedRowVersion: created.workflow.rowVersion
    });
    expect(assigned.workflow.assignedTo).toBe(actor.actorId);
    expect(runtime.outbox.events.some((event) => event.eventType === 'WORKLOAD_ASSIGNED')).toBe(true);

    await expect(
      runtime.workflow.assignToSelf(
        { ...actor, actorId: 'other@example.gov' },
        {
          entityType: 'WORKLOAD',
          entityTrackingId: 'W-1005',
          expectedRowVersion: assigned.workflow.rowVersion
        }
      )
    ).rejects.toMatchObject({ errorCode: 'OPTIC-WF-40903' });

    await expect(
      runtime.workflow.releaseAssignment(
        { ...actor, actorId: 'other@example.gov' },
        {
          entityType: 'WORKLOAD',
          entityTrackingId: 'W-1005',
          expectedRowVersion: assigned.workflow.rowVersion
        }
      )
    ).rejects.toMatchObject({ errorCode: 'OPTIC-WF-40904' });

    const released = await runtime.workflow.releaseAssignment(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1005',
      expectedRowVersion: assigned.workflow.rowVersion
    });
    expect(released.workflow.assignedTo).toBeNull();
    expect(runtime.outbox.events.some((event) => event.eventType === 'WORKLOAD_RELEASED')).toBe(true);
  });

  it('releases a completed instance that is still assigned', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1015',
      definitionKey: 'I_90'
    });
    const assigned = await runtime.workflow.assignToSelf(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1015',
      expectedRowVersion: created.workflow.rowVersion
    });
    const completed = await runtime.workflow.enterStage(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1015',
      stageKey: 'COMPLETED',
      expectedRowVersion: assigned.workflow.rowVersion
    });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.workflow.assignedTo).toBe(actor.actorId);
    const released = await runtime.workflow.releaseAssignment(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1015',
      expectedRowVersion: completed.workflow.rowVersion
    });
    expect(released.workflow.assignedTo).toBeNull();
    expect(released.status).toBe('COMPLETED');
  });

  it('lets a supervisor reassign and rejects officers', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1099',
      definitionKey: 'I_90'
    });
    const assigned = await runtime.workflow.assignToSelf(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1099',
      expectedRowVersion: created.workflow.rowVersion
    });

    await expect(
      runtime.workflow.reassign(actor, {
        entityType: 'WORKLOAD',
        entityTrackingId: 'W-1099',
        expectedRowVersion: assigned.workflow.rowVersion,
        assignedTo: 'other@example.gov'
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-AUTHZ-40303' });

    const supervisor = {
      actorId: 'supervisor@example.gov',
      roles: ['SUPERVISOR'],
      correlationId: 'c-wf-reassign'
    };
    const reassigned = await runtime.workflow.reassign(supervisor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1099',
      expectedRowVersion: assigned.workflow.rowVersion,
      assignedTo: 'other@example.gov'
    });
    expect(reassigned.workflow.assignedTo).toBe('other@example.gov');
    expect(runtime.outbox.events.some((event) => event.eventType === 'WORKLOAD_REASSIGNED')).toBe(true);
  });

  it('rejects assign and reassign on a completed case', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1092',
      definitionKey: 'I_90'
    });
    const assigned = await runtime.workflow.assignToSelf(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1092',
      expectedRowVersion: created.workflow.rowVersion
    });
    const completed = await runtime.workflow.enterStage(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1092',
      stageKey: 'COMPLETED',
      expectedRowVersion: assigned.workflow.rowVersion
    });
    expect(completed.status).toBe('COMPLETED');

    await expect(
      runtime.workflow.assignToSelf(actor, {
        entityType: 'WORKLOAD',
        entityTrackingId: 'W-1092',
        expectedRowVersion: completed.workflow.rowVersion
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-WF-40092' });

    const supervisor = {
      actorId: 'supervisor@example.gov',
      roles: ['SUPERVISOR'],
      correlationId: 'c-wf-completed-reassign'
    };
    await expect(
      runtime.workflow.reassign(supervisor, {
        entityType: 'WORKLOAD',
        entityTrackingId: 'W-1092',
        expectedRowVersion: completed.workflow.rowVersion,
        assignedTo: 'other@example.gov'
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-WF-40092' });
    expect(completed.assignmentPermissions).toEqual({
      allowAssign: false,
      allowReassign: false,
      allowRelease: true
    });
  });

  it('honors stage assignmentPolicy for assign, reassign, and release', async () => {
    const runtime = createTestRuntime();
    await runtime.service.createDefinition(configurator, {
      definitionKey: 'I_LOCK',
      displayName: 'Lock test',
      entityType: 'WORKLOAD'
    });
    await runtime.service.createDraftRelease(configurator, { definitionKey: 'I_LOCK', version: '1.0.0' });
    await runtime.service.saveWorkflow(configurator, {
      definitionKey: 'I_LOCK',
      version: '1.0.0',
      expectedRowVersion: 0,
      payload: {
        initialStageKey: 'REVIEW',
        terminalStageKeys: ['COMPLETED'],
        stages: [
          {
            stageKey: 'REVIEW',
            displayName: 'Review',
            order: 10,
            actionKeys: [],
            assignmentPolicy: {
              required: false,
              clearOnTransition: false,
              allowAssign: true,
              allowReassign: false,
              allowRelease: false
            }
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
    runtime.repository.setLifecycleForTest('I_LOCK', '1.0.0', 'PUBLISHED');
    runtime.repository.setActiveReleaseForTest('I_LOCK', '1.0.0');

    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-LOCK-1',
      definitionKey: 'I_LOCK'
    });
    expect(created.assignmentPermissions).toEqual({
      allowAssign: true,
      allowReassign: false,
      allowRelease: false
    });
    const assigned = await runtime.workflow.assignToSelf(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-LOCK-1',
      expectedRowVersion: created.workflow.rowVersion
    });
    await expect(
      runtime.workflow.releaseAssignment(actor, {
        entityType: 'WORKLOAD',
        entityTrackingId: 'W-LOCK-1',
        expectedRowVersion: assigned.workflow.rowVersion
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-WF-40093' });

    const supervisor = {
      actorId: 'supervisor@example.gov',
      roles: ['SUPERVISOR'],
      correlationId: 'c-wf-stage-reassign'
    };
    await expect(
      runtime.workflow.reassign(supervisor, {
        entityType: 'WORKLOAD',
        entityTrackingId: 'W-LOCK-1',
        expectedRowVersion: assigned.workflow.rowVersion,
        assignedTo: 'other@example.gov'
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-WF-40092' });
  });

  it('saves a draft inside the stage path, writes field deltas, and rejects outside writes', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1006',
      definitionKey: 'I_90'
    });
    await expect(
      runtime.workflow.saveDraft(actor, {
        entityType: 'WORKLOAD',
        entityTrackingId: 'W-1006',
        expectedRowVersion: created.workflow.rowVersion,
        dataPatch: { dataEntryDetails: { receiptNumber: 'ABC1234567890' } }
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-WF-40905' });

    const assigned = await runtime.workflow.assignToSelf(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1006',
      expectedRowVersion: created.workflow.rowVersion
    });
    const saved = await runtime.workflow.saveDraft(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1006',
      expectedRowVersion: assigned.workflow.rowVersion,
      stageKey: 'READY_FOR_DATA_ENTRY',
      dataPatch: { dataEntryDetails: { receiptNumber: 'ABC1234567890' } }
    });
    expect(saved.businessData).toEqual({ dataEntryDetails: { receiptNumber: 'ABC1234567890' } });
    expect(saved.workflow.rowVersion).toBe(assigned.workflow.rowVersion + 1);
    expect(runtime.outbox.events.some((event) => event.eventType === 'DRAFT_SAVED')).toBe(true);
    const fieldChanged = runtime.outbox.events.find((event) => event.eventType === 'FIELD_CHANGED');
    expect(fieldChanged?.payload.fieldDeltas).toEqual([
      {
        fieldKey: 'RECEIPT_NUMBER',
        path: '$.dataEntryDetails.receiptNumber',
        before: null,
        after: 'ABC1234567890',
        piiClassification: 'SENSITIVE',
        splunkPolicy: DEFAULT_SPLUNK_MASK_POLICY
      }
    ]);
    expect(fieldChanged?.payload.changes).toEqual([
      {
        fieldKey: 'RECEIPT_NUMBER',
        path: '$.dataEntryDetails.receiptNumber',
        classification: 'SENSITIVE',
        before: null,
        after: 'ABC1234567890'
      }
    ]);
    expect(fieldChanged?.payload.sourceService).toBe('workflow-runtime');
    expect((fieldChanged?.payload.workflow as { stageVisitId?: number }).stageVisitId).toBeGreaterThan(0);

    await expect(
      runtime.workflow.saveDraft(actor, {
        entityType: 'WORKLOAD',
        entityTrackingId: 'W-1006',
        expectedRowVersion: saved.workflow.rowVersion,
        dataPatch: { mailDetails: { courier: 'UPS' } }
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-WF-40047' });

    await expect(
      runtime.workflow.saveDraft(actor, {
        entityType: 'WORKLOAD',
        entityTrackingId: 'W-1006',
        expectedRowVersion: 0,
        dataPatch: { dataEntryDetails: { receiptNumber: 'ZZZ' } }
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-WF-40901' });

    const emptyDraft = await runtime.workflow.saveDraft(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1006',
      expectedRowVersion: saved.workflow.rowVersion,
      dataPatch: {}
    });
    expect(runtime.outbox.events.filter((event) => event.eventType === 'FIELD_CHANGED')).toHaveLength(2);
    expect(
      runtime.outbox.events.filter((event) => event.eventType === 'FIELD_CHANGED').at(-1)?.payload.fieldDeltas
    ).toEqual([]);

    await expect(
      runtime.workflow.saveDraft(actor, {
        entityType: 'WORKLOAD',
        entityTrackingId: 'W-1006',
        expectedRowVersion: emptyDraft.workflow.rowVersion,
        dataPatch: { dataEntryDetails: { receiptNumber: 12 } }
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-WF-40051' });
  });

  it('executes a transition action, validates schema, clears assignment, and writes history', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1007',
      definitionKey: 'I_90'
    });
    const scheduledAtCreate = await runtime.instances.listScheduledActions(created.workflowInstanceId);
    expect(scheduledAtCreate.map((row) => row.scheduledActionKey)).toEqual(['DATA_ENTRY_NUDGE']);

    await expect(
      runtime.workflow.executeAction(actor, {
        entityType: 'WORKLOAD',
        entityTrackingId: 'W-1007',
        actionKey: 'COMPLETE_DATA_ENTRY',
        expectedRowVersion: created.workflow.rowVersion,
        dataPatch: { dataEntryDetails: { receiptNumber: 'ABC1234567890' } }
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-WF-40905' });

    const assigned = await runtime.workflow.assignToSelf(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1007',
      expectedRowVersion: created.workflow.rowVersion
    });
    await expect(
      runtime.workflow.executeAction(actor, {
        entityType: 'WORKLOAD',
        entityTrackingId: 'W-1007',
        actionKey: 'COMPLETE_DATA_ENTRY',
        expectedRowVersion: assigned.workflow.rowVersion,
        dataPatch: { dataEntryDetails: { receiptNumber: '' } }
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-WF-40050' });

    const completed = await runtime.workflow.executeAction(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1007',
      actionKey: 'COMPLETE_DATA_ENTRY',
      expectedRowVersion: assigned.workflow.rowVersion,
      dataPatch: { dataEntryDetails: { receiptNumber: 'ABC1234567890' } },
      comment: 'Ready for completion'
    });
    expect(completed.workflow.currentStageKey).toBe('COMPLETED');
    expect(completed.status).toBe('COMPLETED');
    expect(completed.workflow.assignedTo).toBeNull();
    expect(completed.businessData).toEqual({ dataEntryDetails: { receiptNumber: 'ABC1234567890' } });
    expect(runtime.outbox.events.some((event) => event.eventType === 'STAGE_COMPLETED')).toBe(true);
    expect(runtime.outbox.events.some((event) => event.eventType === 'STAGE_TRANSITIONED')).toBe(true);
    expect(runtime.outbox.events.some((event) => event.eventType === 'STAGE_ENTERED')).toBe(true);
    const completedEvent = runtime.outbox.events.find((event) => event.eventType === 'STAGE_COMPLETED');
    expect((completedEvent?.payload as { workflow?: { comment?: string } }).workflow?.comment).toBe(
      'Ready for completion'
    );
    const transitions = await runtime.instances.listTransitions(created.workflowInstanceId);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]?.actionKey).toBe('COMPLETE_DATA_ENTRY');
    const scheduled = await runtime.instances.listScheduledActions(created.workflowInstanceId);
    expect(scheduled.find((row) => row.scheduledActionKey === 'DATA_ENTRY_NUDGE')?.status).toBe('CANCELLED');
  });

  it('branches COMPLETE_DATA_ENTRY to ON_HOLD when fraudReferralRequired is true', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1008',
      definitionKey: 'I_90'
    });
    const assigned = await runtime.workflow.assignToSelf(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1008',
      expectedRowVersion: created.workflow.rowVersion
    });
    const held = await runtime.workflow.executeAction(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1008',
      actionKey: 'COMPLETE_DATA_ENTRY',
      expectedRowVersion: assigned.workflow.rowVersion,
      dataPatch: { dataEntryDetails: { receiptNumber: 'ABC1234567890', fraudReferralRequired: true } }
    });
    expect(held.workflow.currentStageKey).toBe('ON_HOLD');
    expect(held.status).toBe('ACTIVE');
    const scheduled = await runtime.instances.listScheduledActions(created.workflowInstanceId);
    expect(scheduled.find((row) => row.scheduledActionKey === 'ON_HOLD_EXPIRATION')?.status).toBe('PENDING');
  });

  it('creates I_407 workload cases from a mail Doc Prep complete', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    await seedPublishedMailDocPrep(runtime, 'I_90');
    const mail = await runtime.workflow.createInstance(actor, {
      entityType: 'MAIL',
      entityTrackingId: 'MAIL-1',
      definitionKey: 'MAIL_ITEM'
    });
    const assigned = await runtime.workflow.assignToSelf(actor, {
      entityType: 'MAIL',
      entityTrackingId: 'MAIL-1',
      expectedRowVersion: mail.workflow.rowVersion
    });
    await runtime.workflow.executeAction(actor, {
      entityType: 'MAIL',
      entityTrackingId: 'MAIL-1',
      actionKey: 'COMPLETE_DOC_PREP',
      expectedRowVersion: assigned.workflow.rowVersion,
      dataPatch: {
        workloads: [
          { trackingId: 'WL-407-A', workloadStatus: 'accepted' },
          { trackingId: 'WL-407-B', workloadStatus: 'fraud' }
        ]
      }
    });
    const first = await runtime.workflow.getSummary(actor, 'WORKLOAD', 'WL-407-A');
    const second = await runtime.workflow.getSummary(actor, 'WORKLOAD', 'WL-407-B');
    expect(first.definition.definitionKey).toBe('I_90');
    expect(first.workflow.currentStageKey).toBe('READY_FOR_DATA_ENTRY');
    expect(first.businessData).toMatchObject({ dataEntryDetails: { workloadStatus: 'Accepted' } });
    expect(second.workflow.currentStageKey).toBe('READY_FOR_DATA_ENTRY');
    expect(second.businessData).toMatchObject({ dataEntryDetails: { workloadStatus: 'Fraud Review' } });
    expect(first.packet?.parent).toMatchObject({
      entityType: 'MAIL',
      trackingId: 'MAIL-1'
    });
    expect(first.packet?.parent?.visits.some((visit) => visit.stageKey === 'DOC_PREP')).toBe(true);
    expect(first.packet?.parent?.forms.MAIL_DOC_PREP?.formKey).toBe('MAIL_DOC_PREP');
    expect(second.packet?.parent?.trackingId).toBe('MAIL-1');
    const parent = await runtime.workflow.getSummary(actor, 'MAIL', 'MAIL-1');
    expect(parent.packet?.children?.map((child) => child.trackingId)).toEqual(['WL-407-A', 'WL-407-B']);
    const scanned = await runtime.workflow.scan(actor, 'OPTIC:WORKLOAD:WL-407-A');
    expect(scanned.matches).toHaveLength(1);
    expect(scanned.matches[0]?.packet?.parent?.trackingId).toBe('MAIL-1');
    expect(await runtime.projections.findByEntity('WORKLOAD', 'WL-407-A')).toMatchObject({
      entityTrackingId: 'WL-407-A',
      currentStageKey: 'READY_FOR_DATA_ENTRY'
    });
    expect(runtime.outbox.events.filter((event) => event.eventType === 'WORKLOAD_CREATED')).toHaveLength(2);
    expect((await runtime.instances.findByEntity('WORKLOAD', 'WL-407-A'))?.rehearsal).toBe(false);
  });

  it('marks spawned workloads as rehearsal when the mail parent is Try', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    await seedPublishedMailDocPrep(runtime, 'I_90');
    const mail = await runtime.workflow.createInstance(actor, {
      entityType: 'MAIL',
      entityTrackingId: 'MAIL-TRY-SPAWN',
      definitionKey: 'MAIL_ITEM',
      version: '1.0.0'
    });
    expect((await runtime.instances.findByEntity('MAIL', 'MAIL-TRY-SPAWN'))?.rehearsal).toBe(true);
    const assigned = await runtime.workflow.assignToSelf(actor, {
      entityType: 'MAIL',
      entityTrackingId: 'MAIL-TRY-SPAWN',
      expectedRowVersion: mail.workflow.rowVersion
    });
    await runtime.workflow.executeAction(actor, {
      entityType: 'MAIL',
      entityTrackingId: 'MAIL-TRY-SPAWN',
      actionKey: 'COMPLETE_DOC_PREP',
      expectedRowVersion: assigned.workflow.rowVersion,
      dataPatch: {
        workloads: [{ trackingId: 'WL-TRY-SPAWN', workloadStatus: 'accepted' }]
      }
    });
    expect((await runtime.instances.findByEntity('WORKLOAD', 'WL-TRY-SPAWN'))?.rehearsal).toBe(true);
    expect(await runtime.projections.findByEntity('WORKLOAD', 'WL-TRY-SPAWN')).toBeNull();
  });

  it('attaches a mail parent when Complete finds an already-created workload', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    await seedPublishedMailDocPrep(runtime, 'I_90');
    await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'WL-EXISTING',
      definitionKey: 'I_90'
    });
    const mail = await runtime.workflow.createInstance(actor, {
      entityType: 'MAIL',
      entityTrackingId: 'MAIL-EXISTING',
      definitionKey: 'MAIL_ITEM'
    });
    const assigned = await runtime.workflow.assignToSelf(actor, {
      entityType: 'MAIL',
      entityTrackingId: 'MAIL-EXISTING',
      expectedRowVersion: mail.workflow.rowVersion
    });
    await runtime.workflow.executeAction(actor, {
      entityType: 'MAIL',
      entityTrackingId: 'MAIL-EXISTING',
      actionKey: 'COMPLETE_DOC_PREP',
      expectedRowVersion: assigned.workflow.rowVersion,
      dataPatch: { workloads: [{ trackingId: 'WL-EXISTING', workloadStatus: 'rejected' }] }
    });
    const child = await runtime.workflow.getSummary(actor, 'WORKLOAD', 'WL-EXISTING');
    expect(child.packet?.parent?.trackingId).toBe('MAIL-EXISTING');
    expect(child.packet?.parent?.forms.MAIL_DOC_PREP?.formKey).toBe('MAIL_DOC_PREP');
    expect(child.businessData).toMatchObject({ dataEntryDetails: { workloadStatus: 'Rejected' } });
  });

  it('does not overwrite a workload status the officer already saved', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    await seedPublishedMailDocPrep(runtime, 'I_90');
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'WL-KEPT',
      definitionKey: 'I_90'
    });
    const assigned = await runtime.workflow.assignToSelf(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'WL-KEPT',
      expectedRowVersion: created.workflow.rowVersion
    });
    await runtime.workflow.saveDraft(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'WL-KEPT',
      expectedRowVersion: assigned.workflow.rowVersion,
      dataPatch: { dataEntryDetails: { workloadStatus: 'Rejected' } }
    });
    const mail = await runtime.workflow.createInstance(actor, {
      entityType: 'MAIL',
      entityTrackingId: 'MAIL-KEPT',
      definitionKey: 'MAIL_ITEM'
    });
    const mailAssigned = await runtime.workflow.assignToSelf(actor, {
      entityType: 'MAIL',
      entityTrackingId: 'MAIL-KEPT',
      expectedRowVersion: mail.workflow.rowVersion
    });
    await runtime.workflow.executeAction(actor, {
      entityType: 'MAIL',
      entityTrackingId: 'MAIL-KEPT',
      actionKey: 'COMPLETE_DOC_PREP',
      expectedRowVersion: mailAssigned.workflow.rowVersion,
      dataPatch: { workloads: [{ trackingId: 'WL-KEPT', workloadStatus: 'accepted' }] }
    });
    const child = await runtime.workflow.getSummary(actor, 'WORKLOAD', 'WL-KEPT');
    expect(child.businessData).toMatchObject({ dataEntryDetails: { workloadStatus: 'Rejected' } });
  });

  it('recovers mail screens for a workload whose parent columns were never stored', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    await seedPublishedMailDocPrep(runtime, 'I_90');
    const mail = await runtime.workflow.createInstance(actor, {
      entityType: 'MAIL',
      entityTrackingId: 'MAIL-ORPHAN-PARENT',
      definitionKey: 'MAIL_ITEM'
    });
    await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'WL-ORPHAN',
      definitionKey: 'I_90'
    });
    await runtime.instances.updateBusinessData({
      instanceId: mail.workflowInstanceId,
      expectedRowVersion: mail.workflow.rowVersion,
      businessData: {
        workloads: [{ workloadTrackingId: 'WL-ORPHAN', workloadStatus: 'accepted' }]
      }
    });
    const child = await runtime.workflow.getSummary(actor, 'WORKLOAD', 'WL-ORPHAN');
    expect(child.packet?.parent?.trackingId).toBe('MAIL-ORPHAN-PARENT');
    expect(child.businessData).toMatchObject({ dataEntryDetails: { workloadStatus: 'Accepted' } });
    const parent = await runtime.workflow.getSummary(actor, 'MAIL', 'MAIL-ORPHAN-PARENT');
    expect(parent.packet?.children?.map((item) => item.trackingId)).toEqual(['WL-ORPHAN']);
  });

  it('stamps Fill from Assigned officer on save and complete', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    await runtime.service.createDraftRelease(configurator, {
      definitionKey: 'I_90',
      version: '1.1.0',
      cloneFromVersion: '1.0.0'
    });
    const draft = await runtime.service.getRelease(configurator, 'I_90', '1.1.0');
    const form = structuredClone(draft.forms.I90_DATA_ENTRY);
    form.sections[0]?.fields.push({
      fieldKey: 'DATA_KEYER_NAME',
      path: '$.dataKeyerName',
      component: 'READ_ONLY_VALUE',
      label: 'Data Keyer Name',
      fillFrom: 'ASSIGNED_TO'
    });
    await runtime.service.saveForm(configurator, {
      definitionKey: 'I_90',
      version: '1.1.0',
      expectedRowVersion: draft.rowVersion,
      payload: form
    });
    runtime.repository.setLifecycleForTest('I_90', '1.1.0', 'PUBLISHED');
    runtime.repository.setActiveReleaseForTest('I_90', '1.1.0');

    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-FILL-1',
      definitionKey: 'I_90'
    });
    const assigned = await runtime.workflow.assignToSelf(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-FILL-1',
      expectedRowVersion: created.workflow.rowVersion
    });
    const saved = await runtime.workflow.saveDraft(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-FILL-1',
      expectedRowVersion: assigned.workflow.rowVersion,
      dataPatch: { dataEntryDetails: { receiptNumber: 'ABC1234567890' } }
    });
    expect(saved.businessData).toEqual({
      dataEntryDetails: { receiptNumber: 'ABC1234567890', dataKeyerName: actor.actorId }
    });

    const completed = await runtime.workflow.executeAction(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-FILL-1',
      actionKey: 'COMPLETE_DATA_ENTRY',
      expectedRowVersion: saved.workflow.rowVersion,
      dataPatch: { dataEntryDetails: { receiptNumber: 'ABC1234567890' } }
    });
    expect(completed.businessData).toEqual({
      dataEntryDetails: { receiptNumber: 'ABC1234567890', dataKeyerName: actor.actorId }
    });
    expect(completed.workflow.assignedTo).toBeNull();
  });
});

const configurator = {
  actorId: 'configurator@example.gov',
  roles: ['CONFIGURATOR'],
  correlationId: 'c-mail-doc-prep'
};

async function seedPublishedMailDocPrep(
  runtime: ReturnType<typeof createTestRuntime>,
  spawnDefinitionKey: string
): Promise<void> {
  await runtime.service.createDefinition(configurator, {
    definitionKey: 'MAIL_ITEM',
    displayName: 'Mail item',
    entityType: 'MAIL'
  });
  await runtime.service.createDraftRelease(configurator, { definitionKey: 'MAIL_ITEM', version: '1.0.0' });
  let rowVersion = 0;
  await runtime.service.saveWorkflow(configurator, {
    definitionKey: 'MAIL_ITEM',
    version: '1.0.0',
    expectedRowVersion: rowVersion++,
    payload: {
      initialStageKey: 'DOC_PREP',
      terminalStageKeys: ['COMPLETED'],
      stages: [
        {
          stageKey: 'DOC_PREP',
          displayName: 'Doc Prep',
          order: 10,
          formKey: 'MAIL_DOC_PREP',
          actionKeys: ['COMPLETE_DOC_PREP'],
          assignmentPolicy: { required: true, clearOnTransition: true }
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
      transitionSets: [
        {
          transitionSetKey: 'FROM_DOC_PREP',
          evaluationMode: 'FIRST_MATCH',
          rules: [],
          defaultTargetStageKey: 'COMPLETED'
        }
      ]
    }
  });
  await runtime.service.saveForm(configurator, {
    definitionKey: 'MAIL_ITEM',
    version: '1.0.0',
    expectedRowVersion: rowVersion++,
    payload: {
      formKey: 'MAIL_DOC_PREP',
      dataPath: '$',
      title: 'Doc Prep',
      schema: { type: 'object', additionalProperties: true },
      sections: [
        {
          sectionKey: 'WORKLOADS',
          title: 'Workloads',
          repeatable: true,
          path: '$.workloads',
          spawnDefinitionKey,
          fields: [
            {
              fieldKey: 'TRACKING_ID',
              path: '$.trackingId',
              component: 'TRACKING_ID_DISPLAY',
              label: 'Workload Tracking #'
            },
            {
              fieldKey: 'WORKLOAD_STATUS',
              path: '$.workloadStatus',
              component: 'RADIO',
              label: 'Workload Status',
              options: [
                { value: 'accepted', label: 'Accept' },
                { value: 'rejected', label: 'Reject' },
                { value: 'fraud', label: 'Fraud Review' }
              ]
            }
          ]
        }
      ]
    }
  });
  await runtime.service.saveAction(configurator, {
    definitionKey: 'MAIL_ITEM',
    version: '1.0.0',
    expectedRowVersion: rowVersion++,
    payload: {
      actionKey: 'COMPLETE_DOC_PREP',
      label: 'Complete',
      type: 'TRANSITION',
      requireAssignmentToCurrentUser: true,
      validation: { validateStageForm: true },
      transitionSetKey: 'FROM_DOC_PREP'
    }
  });
  runtime.repository.setLifecycleForTest('MAIL_ITEM', '1.0.0', 'PUBLISHED');
  runtime.repository.setActiveReleaseForTest('MAIL_ITEM', '1.0.0');
}
