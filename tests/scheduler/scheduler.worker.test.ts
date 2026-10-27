import { describe, expect, it } from 'vitest';
import { SchedulerWorker } from '../../src/modules/scheduler/scheduler.worker.js';
import { schedulerActor } from '../../src/platform/security/actor.js';
import { seedPublishedLinear } from '../helpers/publish-linear.js';
import { createTestRuntime, testConfig } from '../helpers/test-app.js';

const actor = {
  actorId: 'officer@example.gov',
  roles: ['OFFICER'],
  correlationId: 'c-scheduler'
};

function workerFor(
  workflow: ReturnType<typeof createTestRuntime>['workflow'],
  workerId: string,
  overrides: Partial<typeof testConfig.scheduler> = {}
): SchedulerWorker {
  return new SchedulerWorker(workflow, {
    ...testConfig.scheduler,
    enabled: true,
    workerId,
    backoffBaseMs: 50,
    defaultMaxAttempts: 5,
    ...overrides
  });
}

async function createHeldInstance(
  runtime: ReturnType<typeof createTestRuntime>,
  trackingId: string
) {
  const created = await runtime.workflow.createInstance(actor, {
    entityType: 'WORKLOAD',
    entityTrackingId: trackingId,
    definitionKey: 'I_90'
  });
  const assigned = await runtime.workflow.assignToSelf(actor, {
    entityType: 'WORKLOAD',
    entityTrackingId: trackingId,
    expectedRowVersion: created.workflow.rowVersion
  });
  return runtime.workflow.executeAction(actor, {
    entityType: 'WORKLOAD',
    entityTrackingId: trackingId,
    actionKey: 'COMPLETE_DATA_ENTRY',
    expectedRowVersion: assigned.workflow.rowVersion,
    dataPatch: { dataEntryDetails: { receiptNumber: 'ABC1234567890', fraudReferralRequired: true } }
  });
}

describe('SchedulerWorker', () => {
  it('executes configured hold expiration as a TRANSITION to the target stage', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const held = await createHeldInstance(runtime, 'W-HOLD-1');
    expect(held.workflow.currentStageKey).toBe('ON_HOLD');

    const scheduled = await runtime.instances.listScheduledActions(held.workflowInstanceId);
    const expiration = scheduled.find((row) => row.scheduledActionKey === 'ON_HOLD_EXPIRATION');
    expect(expiration?.status).toBe('PENDING');
    await runtime.workflow.updateScheduledDueAt(expiration!.id, new Date(Date.now() - 1_000));

    const worker = workerFor(runtime.workflow, 'hold-worker');
    const tick = await worker.tick();
    expect(tick.claimed).toBe(1);
    expect(tick.completed).toBe(1);

    const summary = await runtime.workflow.getSummary(actor, 'WORKLOAD', 'W-HOLD-1');
    expect(summary.workflow.currentStageKey).toBe('COMPLETED');
    expect(summary.status).toBe('COMPLETED');
    const after = await runtime.instances.findScheduledActionById(expiration!.id);
    expect(after?.status).toBe('COMPLETED');
    expect(runtime.outbox.events.some((event) => event.eventType === 'SCHEDULED_ACTION_EXECUTED')).toBe(true);
    expect(runtime.outbox.events.some((event) => event.eventType === 'STAGE_TRANSITIONED')).toBe(true);

    const replay = await worker.tick();
    expect(replay.claimed).toBe(0);
    const still = await runtime.workflow.getSummary(actor, 'WORKLOAD', 'W-HOLD-1');
    expect(still.workflow.currentStageKey).toBe('COMPLETED');
    expect(await runtime.instances.listTransitions(held.workflowInstanceId)).toHaveLength(2);
  });

  it('completes a NOTIFICATION scheduled action without changing stage', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-NUDGE-1',
      definitionKey: 'I_90'
    });
    const [nudge] = await runtime.instances.listScheduledActions(created.workflowInstanceId);
    await runtime.workflow.updateScheduledDueAt(nudge!.id, new Date(Date.now() - 1_000));

    const tick = await workerFor(runtime.workflow, 'nudge-worker').tick();
    expect(tick.completed).toBe(1);
    const summary = await runtime.workflow.getSummary(actor, 'WORKLOAD', 'W-NUDGE-1');
    expect(summary.workflow.currentStageKey).toBe('READY_FOR_DATA_ENTRY');
    expect((await runtime.instances.findScheduledActionById(nudge!.id))?.status).toBe('COMPLETED');
    expect(runtime.outbox.events.some((event) => event.eventType === 'SCHEDULED_ACTION_EXECUTED')).toBe(true);
  });

  it('skips a claimed action when the instance has already left the trigger stage', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-SKIP-1',
      definitionKey: 'I_90'
    });
    const [nudge] = await runtime.instances.listScheduledActions(created.workflowInstanceId);
    await runtime.workflow.updateScheduledDueAt(nudge!.id, new Date(Date.now() - 1_000));
    const claimed = await runtime.workflow.claimDueScheduledActions('skip-worker', 30_000, 10);
    expect(claimed).toHaveLength(1);

    const assigned = await runtime.workflow.assignToSelf(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-SKIP-1',
      expectedRowVersion: created.workflow.rowVersion
    });
    await runtime.workflow.executeAction(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-SKIP-1',
      actionKey: 'COMPLETE_DATA_ENTRY',
      expectedRowVersion: assigned.workflow.rowVersion,
      dataPatch: { dataEntryDetails: { receiptNumber: 'ABC1234567890' } }
    });

    const outcome = await runtime.workflow.executeScheduledAction(
      { actorId: 'scheduler', roles: ['SYSTEM'], actorType: 'SYSTEM' },
      { scheduledActionId: nudge!.id, leaseOwner: 'skip-worker' }
    );
    expect(outcome).toBe('SKIPPED');
    const summary = await runtime.workflow.getSummary(actor, 'WORKLOAD', 'W-SKIP-1');
    expect(summary.workflow.currentStageKey).toBe('COMPLETED');
    expect(await runtime.instances.listTransitions(created.workflowInstanceId)).toHaveLength(1);
  });

  it('lets only one worker claim a due scheduled action', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-LEASE-1',
      definitionKey: 'I_90'
    });
    const [nudge] = await runtime.instances.listScheduledActions(created.workflowInstanceId);
    await runtime.workflow.updateScheduledDueAt(nudge!.id, new Date(Date.now() - 1_000));

    const first = await runtime.workflow.claimDueScheduledActions('worker-a', 30_000, 10);
    const second = await runtime.workflow.claimDueScheduledActions('worker-b', 30_000, 10);
    expect(first.map((row) => row.id)).toEqual([nudge!.id]);
    expect(second).toEqual([]);
  });

  it('retries a transient failure and marks DEAD_LETTER after max attempts', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-FAIL-1',
      definitionKey: 'I_90'
    });
    const [nudge] = await runtime.instances.listScheduledActions(created.workflowInstanceId);
    await runtime.workflow.updateScheduledDueAt(nudge!.id, new Date(Date.now() - 1_000));
    const [claimed] = await runtime.workflow.claimDueScheduledActions('fail-worker', 30_000, 10);
    const scheduler = { actorId: 'scheduler', roles: ['SYSTEM'], actorType: 'SYSTEM' as const };

    const retried = await runtime.workflow.retryOrFailScheduledAction(
      scheduler,
      claimed!,
      'fail-worker',
      new Error('temporary outage'),
      { maxAttempts: 2, backoffBaseMs: 50 }
    );
    expect(retried).toBe('RETRIED');
    const pending = await runtime.instances.findScheduledActionById(nudge!.id);
    expect(pending?.status).toBe('PENDING');
    expect(pending?.attemptCount).toBe(1);
    expect(pending?.leaseOwner).toBeNull();

    await runtime.workflow.updateScheduledDueAt(nudge!.id, new Date(Date.now() - 1_000));
    const [claimedAgain] = await runtime.workflow.claimDueScheduledActions('fail-worker', 30_000, 10);
    const failed = await runtime.workflow.retryOrFailScheduledAction(
      scheduler,
      claimedAgain!,
      'fail-worker',
      new Error('temporary outage'),
      { maxAttempts: 2, backoffBaseMs: 50 }
    );
    expect(failed).toBe('DEAD_LETTER');
    expect((await runtime.instances.findScheduledActionById(nudge!.id))?.status).toBe('DEAD_LETTER');
    expect(runtime.outbox.events.some((event) => event.eventType === 'SCHEDULED_ACTION_FAILED')).toBe(true);
  });

  it('abandons leases on stop so another worker can claim', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-STOP-1',
      definitionKey: 'I_90'
    });
    const [nudge] = await runtime.instances.listScheduledActions(created.workflowInstanceId);
    await runtime.workflow.updateScheduledDueAt(nudge!.id, new Date(Date.now() - 1_000));
    await runtime.workflow.claimDueScheduledActions('stopping-worker', 30_000, 10);

    const worker = workerFor(runtime.workflow, 'stopping-worker');
    await worker.stop();
    const claimed = await runtime.workflow.claimDueScheduledActions('other-worker', 30_000, 10);
    expect(claimed.map((row) => row.id)).toEqual([nudge!.id]);
  });

  it('replays a scheduled action through the idempotency store without a second transition', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-IDEM-1',
      definitionKey: 'I_90'
    });
    const assigned = await runtime.workflow.assignToSelf(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-IDEM-1',
      expectedRowVersion: created.workflow.rowVersion
    });
    const held = await runtime.workflow.executeAction(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-IDEM-1',
      actionKey: 'COMPLETE_DATA_ENTRY',
      expectedRowVersion: assigned.workflow.rowVersion,
      dataPatch: { dataEntryDetails: { receiptNumber: 'ABC1234567890', fraudReferralRequired: true } }
    });
    const expiration = (await runtime.instances.listScheduledActions(held.workflowInstanceId)).find(
      (row) => row.scheduledActionKey === 'ON_HOLD_EXPIRATION'
    );
    await runtime.workflow.updateScheduledDueAt(expiration!.id, new Date(Date.now() - 1_000));
    await runtime.workflow.claimDueScheduledActions('idem-worker', 30_000, 10);
    const scheduler = schedulerActor();
    const first = await runtime.workflow.executeScheduledAction(scheduler, {
      scheduledActionId: expiration!.id,
      leaseOwner: 'idem-worker'
    });
    const second = await runtime.workflow.executeScheduledAction(scheduler, {
      scheduledActionId: expiration!.id,
      leaseOwner: 'idem-worker'
    });
    expect(first).toBe('COMPLETED');
    expect(second).toBe('COMPLETED');
    expect(await runtime.instances.listTransitions(held.workflowInstanceId)).toHaveLength(2);
  });
});
