import type { ActorContext } from '../security/actor.js';
import type { AppendOutboxEventInput } from './outbox.repository.js';

export type BulkOutboxEventType =
  | 'BULK_ACTION_STARTED'
  | 'BULK_ITEM_SUCCEEDED'
  | 'BULK_ITEM_FAILED'
  | 'BULK_ACTION_COMPLETED';

export function createBulkOutboxEvent(input: {
  actor: ActorContext;
  eventType: BulkOutboxEventType;
  bulkOperationId: number;
  bulkActionKey: string;
  definitionKey: string;
  definitionVersion: string;
  transactionMode: 'ATOMIC' | 'BEST_EFFORT';
  entityType?: string;
  entityTrackingId?: string;
  workflowInstanceId?: number;
  status?: string;
  errorCode?: string | null;
  successfulItems?: number;
  failedItems?: number;
  totalItems?: number;
}): AppendOutboxEventInput {
  const occurredAt = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const trackingId = input.entityTrackingId ?? `BULK-${input.bulkOperationId}`;
  return {
    eventId,
    aggregateType: 'BULK_OPERATION',
    aggregateId: `BULK:${input.bulkOperationId}`,
    eventType: input.eventType,
    eventVersion: 1,
    correlationId: input.actor.correlationId ?? `c-${eventId}`,
    sessionId: input.actor.sessionId ?? null,
    actorId: input.actor.actorId,
    payload: {
      eventId,
      eventType: input.eventType,
      eventVersion: 1,
      occurredAt,
      sourceService: 'workflow-runtime',
      correlationId: input.actor.correlationId ?? `c-${eventId}`,
      sessionId: input.actor.sessionId ?? null,
      actor: {
        id: input.actor.actorId,
        displayName: input.actor.actorName ?? input.actor.actorId,
        actorType: input.actor.actorType ?? (input.actor.roles.includes('SYSTEM') ? 'SYSTEM' : 'USER')
      },
      entity: {
        entityType: input.entityType ?? 'BULK_OPERATION',
        trackingId,
        definitionKey: input.definitionKey,
        definitionVersion: input.definitionVersion,
        workflowInstanceId: input.workflowInstanceId ?? null
      },
      workflow: {
        actionKey: input.bulkActionKey,
        bulkOperationId: input.bulkOperationId,
        transactionMode: input.transactionMode,
        status: input.status ?? null,
        errorCode: input.errorCode ?? null,
        successfulItems: input.successfulItems ?? null,
        failedItems: input.failedItems ?? null,
        totalItems: input.totalItems ?? null
      },
      fieldDeltas: [],
      changes: []
    }
  };
}
