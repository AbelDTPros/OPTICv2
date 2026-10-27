import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/platform/errors/app-error.js';
import { seedPublishedBulk } from '../helpers/publish-bulk.js';
import { createTestRuntime } from '../helpers/test-app.js';

const actor = {
  actorId: 'officer@example.gov',
  roles: ['OFFICER'],
  correlationId: 'c-bulk-service'
};

describe('BulkActionService', () => {
  it('BEST_EFFORT records per-item success and failure and writes bulk outbox events', async () => {
    const runtime = createTestRuntime();
    await seedPublishedBulk(runtime);
    const first = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-BULK-1',
      definitionKey: 'I_131_BULK'
    });
    await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-BULK-2',
      definitionKey: 'I_131_BULK'
    });
    await runtime.workflow.enterStage(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-BULK-2',
      stageKey: 'COMPLETED',
      expectedRowVersion: 0,
      exitActionKey: 'FORCE_COMPLETE'
    });

    const result = await runtime.bulk.execute(actor, {
      bulkActionKey: 'BULK_SHIP',
      items: [
        { entityType: 'WORKLOAD', trackingId: 'W-BULK-1', expectedRowVersion: first.workflow.rowVersion },
        { entityType: 'WORKLOAD', trackingId: 'W-BULK-2', expectedRowVersion: 1 }
      ],
      input: { shipDate: '2026-08-23', shipPoc: 'Officer' }
    });

    expect(result.status).toBe('PARTIAL');
    expect(result.successfulItems).toBe(1);
    expect(result.failedItems).toBe(1);
    expect(result.items.find((item) => item.trackingId === 'W-BULK-1')?.status).toBe('SUCCEEDED');
    expect(result.items.find((item) => item.trackingId === 'W-BULK-2')?.status).toBe('FAILED');
    expect(result.items.find((item) => item.trackingId === 'W-BULK-2')?.errorCode).toBe('OPTIC-WF-40084');

    const shipped = await runtime.workflow.getSummary(actor, 'WORKLOAD', 'W-BULK-1');
    expect(shipped.workflow.currentStageKey).toBe('COMPLETED');
    expect((shipped.businessData.shippingDetails as { shipDate?: string }).shipDate).toBe('2026-08-23');

    const stuck = await runtime.workflow.getSummary(actor, 'WORKLOAD', 'W-BULK-2');
    expect(stuck.workflow.currentStageKey).toBe('COMPLETED');

    const events = runtime.outbox.events.map((event) => event.eventType);
    expect(events).toContain('BULK_ACTION_STARTED');
    expect(events).toContain('BULK_ITEM_SUCCEEDED');
    expect(events).toContain('BULK_ITEM_FAILED');
    expect(events).toContain('BULK_ACTION_COMPLETED');
    expect(events).toContain('STAGE_TRANSITIONED');
  });

  it('rejects a selection larger than maxSelection', async () => {
    const runtime = createTestRuntime();
    await seedPublishedBulk(runtime);
    await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-BULK-A',
      definitionKey: 'I_131_BULK'
    });
    await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-BULK-B',
      definitionKey: 'I_131_BULK'
    });
    await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-BULK-C',
      definitionKey: 'I_131_BULK'
    });

    try {
      await runtime.bulk.execute(actor, {
        bulkActionKey: 'BULK_SHIP_ATOMIC',
        items: [
          { entityType: 'WORKLOAD', trackingId: 'W-BULK-A', expectedRowVersion: 0 },
          { entityType: 'WORKLOAD', trackingId: 'W-BULK-B', expectedRowVersion: 0 },
          { entityType: 'WORKLOAD', trackingId: 'W-BULK-C', expectedRowVersion: 0 }
        ],
        input: { shipDate: '2026-08-23' }
      });
      throw new Error('expected maxSelection to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).errorCode).toBe('OPTIC-WF-40082');
    }
  });

  it('records OPTIC-WF-40085 when the item is assigned to someone else', async () => {
    const runtime = createTestRuntime();
    await seedPublishedBulk(runtime);
    const created = await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-BULK-TAKEN',
      definitionKey: 'I_131_BULK'
    });
    const other = {
      actorId: 'other@example.gov',
      roles: ['OFFICER'],
      correlationId: 'c-bulk-other'
    };
    const assigned = await runtime.workflow.assignToSelf(other, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-BULK-TAKEN',
      expectedRowVersion: created.workflow.rowVersion
    });

    const result = await runtime.bulk.execute(actor, {
      bulkActionKey: 'BULK_SHIP',
      items: [
        {
          entityType: 'WORKLOAD',
          trackingId: 'W-BULK-TAKEN',
          expectedRowVersion: assigned.workflow.rowVersion
        }
      ],
      input: { shipDate: '2026-08-23' }
    });

    expect(result.status).toBe('FAILED');
    expect(result.failedItems).toBe(1);
    expect(result.items[0]?.errorCode).toBe('OPTIC-WF-40085');
    const leftover = await runtime.workflow.getSummary(actor, 'WORKLOAD', 'W-BULK-TAKEN');
    expect(leftover.workflow.currentStageKey).toBe('READY_FOR_SHIPPING');
  });

  it('rejects invalid shared input', async () => {
    const runtime = createTestRuntime();
    await seedPublishedBulk(runtime);
    await runtime.workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-BULK-INPUT',
      definitionKey: 'I_131_BULK'
    });
    try {
      await runtime.bulk.execute(actor, {
        bulkActionKey: 'BULK_SHIP',
        items: [{ entityType: 'WORKLOAD', trackingId: 'W-BULK-INPUT', expectedRowVersion: 0 }],
        input: {}
      });
      throw new Error('expected shared input to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).errorCode).toBe('OPTIC-WF-40086');
    }
  });
});
