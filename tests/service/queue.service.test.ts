import { describe, expect, it } from 'vitest';
import { linearRelease } from '../fixtures/definitions/linear.js';
import { authorLinearDraft } from '../helpers/author-linear.js';
import { seedPublishedLinear } from '../helpers/publish-linear.js';
import { createTestRuntime } from '../helpers/test-app.js';

const actor = {
  actorId: 'officer@example.gov',
  roles: ['OFFICER'],
  correlationId: 'c-queue-service'
};

describe('QueueService', () => {
  it('lists published queues and pages matching projections', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-Q-1',
      definitionKey: 'I_90'
    });
    await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-Q-2',
      definitionKey: 'I_90'
    });

    const listed = await runtime.queues.listQueues(actor);
    expect(listed.map((item) => item.queueKey)).toEqual([
      'READY_FOR_DATA_ENTRY',
      'COMPLETED',
      'ASSIGNED_TO_ME',
      'ALL_ITEMS'
    ]);
    expect(listed.find((item) => item.queueKey === 'READY_FOR_DATA_ENTRY')?.total).toBe(2);
    expect(listed.find((item) => item.queueKey === 'ALL_ITEMS')?.total).toBe(2);
    expect(listed.find((item) => item.queueKey === 'ASSIGNED_TO_ME')?.total).toBe(0);
    expect(listed.find((item) => item.queueKey === 'COMPLETED')?.total).toBe(0);

    const page = await runtime.queues.getQueuePage(actor, 'READY_FOR_DATA_ENTRY', {
      page: 1,
      pageSize: 10,
      sort: 'trackingId',
      direction: 'ASC'
    });
    expect(page.total).toBe(2);
    expect(page.columns.map((column) => column.key)).toContain('trackingId');
    expect(page.rows.map((row) => row.trackingId)).toEqual(['W-Q-1', 'W-Q-2']);
    expect(page.rows[0]?.rowVersion).toBe(0);
    expect(page.rows[0]?.assignedStatus).toBe('UNASSIGNED');
    expect(page.rows[0]?.status).toBe('ACTIVE');
    expect(page.rows[0]?.allowAssign).toBe(true);
    expect(page.rows[0]?.allowReassign).toBe(true);
    expect(page.rows[0]?.allowRelease).toBe(true);
    expect(page.rows[0]?.pinnedColumns).toContain('receiptNumber');
    expect(page.rows[0]?.definitionVersion).toBe('1.0.0');
  });

  it('assigns from the queue and drops the row when filtered to unassigned', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-Q-3',
      definitionKey: 'I_90'
    });

    await runtime.queues.assignFromQueue(actor, {
      queueKey: 'READY_FOR_DATA_ENTRY',
      entityType: 'WORKLOAD',
      trackingId: 'W-Q-3',
      expectedRowVersion: created.workflow.rowVersion
    });

    const assigned = await runtime.queues.getQueuePage(actor, 'READY_FOR_DATA_ENTRY', {
      filters: { assignedStatus: 'ASSIGNED' }
    });
    expect(assigned.total).toBe(1);
    expect(assigned.rows[0]?.assignedTo).toBe(actor.actorId);

    const unassigned = await runtime.queues.getQueuePage(actor, 'READY_FOR_DATA_ENTRY', {
      filters: { assignedStatus: 'UNASSIGNED' }
    });
    expect(unassigned.total).toBe(0);
  });

  it('rejects a queue assign when the instance is no longer eligible', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-Q-4',
      definitionKey: 'I_90'
    });
    await runtime.workflow.enterStage(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-Q-4',
      stageKey: 'COMPLETED',
      expectedRowVersion: created.workflow.rowVersion
    });

    await expect(
      runtime.queues.assignFromQueue(actor, {
        queueKey: 'READY_FOR_DATA_ENTRY',
        entityType: 'WORKLOAD',
        trackingId: 'W-Q-4',
        expectedRowVersion: created.workflow.rowVersion + 1
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-WF-40061' });
  });

  it('rejects an unknown filter or page size', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    await expect(
      runtime.queues.getQueuePage(actor, 'READY_FOR_DATA_ENTRY', { filters: { secretNotes: 'x' } })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-WF-40060' });
    await expect(
      runtime.queues.getQueuePage(actor, 'READY_FOR_DATA_ENTRY', { pageSize: 7 })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-WF-40060' });
    await expect(runtime.queues.getQueuePage(actor, 'MISSING_QUEUE', {})).rejects.toMatchObject({
      errorCode: 'OPTIC-WF-40420'
    });
  });

  it('releases from the queue and keeps pinned columns after a newer release is activated', async () => {
    const runtime = createTestRuntime();
    const { releaseId } = await seedPublishedLinear(runtime);
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-Q-5',
      definitionKey: 'I_90'
    });
    const assigned = await runtime.queues.assignFromQueue(actor, {
      queueKey: 'READY_FOR_DATA_ENTRY',
      entityType: 'WORKLOAD',
      trackingId: 'W-Q-5',
      expectedRowVersion: created.workflow.rowVersion
    });
    await runtime.queues.releaseFromQueue(actor, {
      queueKey: 'READY_FOR_DATA_ENTRY',
      entityType: 'WORKLOAD',
      trackingId: 'W-Q-5',
      expectedRowVersion: assigned.workflow.rowVersion
    });

    const author = { actorId: 'configurator@example.gov', roles: ['CONFIGURATOR'], correlationId: 'c-queue-author' };
    const drafted = await authorLinearDraft(runtime.service, author, { version: '1.1.0' });
    await runtime.service.saveQueue(author, {
      definitionKey: 'I_90',
      version: '1.1.0',
      expectedRowVersion: drafted.rowVersion,
      payload: {
        ...linearRelease.queues.READY_FOR_DATA_ENTRY,
        columns: ['trackingId']
      }
    });
    runtime.repository.setLifecycleForTest('I_90', '1.1.0', 'PUBLISHED');
    runtime.repository.setActiveReleaseForTest('I_90', '1.1.0');

    const page = await runtime.queues.getQueuePage(actor, 'READY_FOR_DATA_ENTRY', {});
    expect(page.version).toBe('1.1.0');
    expect(page.columns.map((column) => column.key)).toEqual(
      expect.arrayContaining(['trackingId', 'receiptNumber'])
    );
    expect(page.rows[0]?.releaseId).toBe(releaseId);
    expect(page.rows[0]?.pinnedColumns).toContain('receiptNumber');
    expect(page.rows[0]?.values.receiptNumber).not.toBeUndefined();
    expect(page.rows[0]?.assignedTo).toBeNull();
  });

  it('backfills projections for instances created before the queue writer existed', async () => {
    const runtime = createTestRuntime();
    const { releaseId } = await seedPublishedLinear(runtime);
    const stages = await runtime.repository.listChildren(Number(releaseId), 'stage');
    const stage = stages.find((item) => item.stableKey === 'READY_FOR_DATA_ENTRY');
    expect(stage).toBeDefined();
    await runtime.instances.createInstance({
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-Q-BACKFILL',
      definitionReleaseId: Number(releaseId),
      currentStageDefinitionId: stage!.id,
      currentStageKey: 'READY_FOR_DATA_ENTRY',
      status: 'ACTIVE'
    });

    const missing = await runtime.queues.getQueuePage(actor, 'READY_FOR_DATA_ENTRY', {});
    expect(missing.total).toBe(0);
    expect(await runtime.queues.rebuildProjections()).toBe(1);
    const filled = await runtime.queues.getQueuePage(actor, 'READY_FOR_DATA_ENTRY', {});
    expect(filled.total).toBe(1);
    expect(filled.rows[0]?.trackingId).toBe('W-Q-BACKFILL');
  });

  it('keeps the same queue key on two definitions and pages each separately', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    await seedPublishedLinear(runtime, '1.0.0', 'I_407_WORKLOAD');
    await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-Q-90',
      definitionKey: 'I_90'
    });
    await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-Q-407',
      definitionKey: 'I_407_WORKLOAD'
    });

    const listed = await runtime.queues.listQueues(actor);
    expect(listed.filter((item) => item.queueKey === 'READY_FOR_DATA_ENTRY')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ definitionKey: 'I_90', queueKey: 'READY_FOR_DATA_ENTRY' }),
        expect.objectContaining({ definitionKey: 'I_407_WORKLOAD', queueKey: 'READY_FOR_DATA_ENTRY' })
      ])
    );
    await expect(runtime.queues.getQueuePage(actor, 'READY_FOR_DATA_ENTRY', {})).rejects.toMatchObject({
      errorCode: 'OPTIC-WF-40060'
    });
    const i90 = await runtime.queues.getQueuePage(actor, 'READY_FOR_DATA_ENTRY', { definitionKey: 'I_90' });
    expect(i90.rows.map((row) => row.trackingId)).toEqual(['W-Q-90']);
    const i407 = await runtime.queues.getQueuePage(actor, 'READY_FOR_DATA_ENTRY', {
      definitionKey: 'I_407_WORKLOAD'
    });
    expect(i407.rows.map((row) => row.trackingId)).toEqual(['W-Q-407']);
  });

  it('lists officer views and pages Assigned to Me, All Items, and Completed', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-Q-OPEN',
      definitionKey: 'I_90'
    });
    const mine = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-Q-MINE',
      definitionKey: 'I_90'
    });
    await runtime.queues.assignFromQueue(actor, {
      queueKey: 'ASSIGNED_TO_ME',
      definitionKey: 'I_90',
      entityType: 'WORKLOAD',
      trackingId: 'W-Q-MINE',
      expectedRowVersion: mine.workflow.rowVersion
    });
    const finished = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-Q-DONE',
      definitionKey: 'I_90'
    });
    const assignedDone = await runtime.queues.assignFromQueue(actor, {
      queueKey: 'ALL_ITEMS',
      definitionKey: 'I_90',
      entityType: 'WORKLOAD',
      trackingId: 'W-Q-DONE',
      expectedRowVersion: finished.workflow.rowVersion
    });
    await runtime.workflow.executeAction(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-Q-DONE',
      actionKey: 'COMPLETE_DATA_ENTRY',
      expectedRowVersion: assignedDone.workflow.rowVersion,
      dataPatch: { dataEntryDetails: { receiptNumber: 'ABC1234567890' } }
    });

    const assigned = await runtime.queues.getQueuePage(actor, 'ASSIGNED_TO_ME', { definitionKey: 'I_90' });
    expect(assigned.displayName).toBe('Assigned to Me');
    expect(assigned.rows.map((row) => row.trackingId)).toEqual(['W-Q-MINE']);

    const all = await runtime.queues.getQueuePage(actor, 'ALL_ITEMS', { definitionKey: 'I_90' });
    expect(all.rows.map((row) => row.trackingId)).toEqual(expect.arrayContaining(['W-Q-OPEN', 'W-Q-MINE', 'W-Q-DONE']));
    expect(all.total).toBe(3);

    const completed = await runtime.queues.getQueuePage(actor, 'COMPLETED', { definitionKey: 'I_90' });
    expect(completed.displayName).toBe('Completed');
    expect(completed.rows.map((row) => row.trackingId)).toEqual(['W-Q-DONE']);
  });
});
