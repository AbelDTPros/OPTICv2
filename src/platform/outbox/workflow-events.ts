import type { ActorContext } from '../security/actor.js';
import type { AppendOutboxEventInput } from './outbox.repository.js';

export function createWorkflowOutboxEvent(input: {
  actor: ActorContext;
  eventType:
    | 'MAIL_CREATED'
    | 'WORKLOAD_CREATED'
    | 'STAGE_TRANSITIONED'
    | 'STAGE_ENTERED'
    | 'WORKLOAD_ASSIGNED'
    | 'WORKLOAD_RELEASED'
    | 'WORKLOAD_REASSIGNED'
    | 'DRAFT_SAVED'
    | 'FIELD_CHANGED'
    | 'STAGE_COMPLETED'
    | 'SCHEDULED_ACTION_CREATED'
    | 'SCHEDULED_ACTION_EXECUTED'
    | 'SCHEDULED_ACTION_SKIPPED'
    | 'SCHEDULED_ACTION_FAILED';
  entityType: string;
  entityTrackingId: string;
  definitionKey: string;
  definitionVersion: string;
  workflowInstanceId: number;
  fromStageKey?: string;
  toStageKey?: string;
  assignedTo?: string | null;
  previousAssignedTo?: string | null;
  formKey?: string;
  dataPath?: string;
  changedFieldCount?: number;
  fieldDeltas?: unknown[];
  actionKey?: string;
  scheduledActionKey?: string;
  comment?: string;
  stageVisitId?: number | null;
}): AppendOutboxEventInput {
  const occurredAt = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const fieldDeltas = input.fieldDeltas ?? [];
  return {
    eventId,
    aggregateType: 'WORKFLOW_INSTANCE',
    aggregateId: `${input.entityType}:${input.entityTrackingId}`,
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
        entityType: input.entityType,
        trackingId: input.entityTrackingId,
        definitionKey: input.definitionKey,
        definitionVersion: input.definitionVersion,
        workflowInstanceId: input.workflowInstanceId
      },
      workflow: {
        fromStageKey: input.fromStageKey ?? null,
        toStageKey: input.toStageKey ?? null,
        assignedTo: input.assignedTo ?? null,
        previousAssignedTo: input.previousAssignedTo ?? null,
        formKey: input.formKey ?? null,
        dataPath: input.dataPath ?? null,
        changedFieldCount: input.changedFieldCount ?? 0,
        actionKey: input.actionKey ?? null,
        scheduledActionKey: input.scheduledActionKey ?? null,
        comment: input.comment ?? null,
        stageVisitId: input.stageVisitId ?? null
      },
      fieldDeltas,
      changes: toAuditChanges(fieldDeltas)
    }
  };
}

export function toAuditChanges(deltas: unknown[]): Array<{
  fieldKey: string;
  path: string;
  classification: string | null;
  before: unknown;
  after: unknown;
}> {
  return deltas
    .filter((delta): delta is Record<string, unknown> => Boolean(delta) && typeof delta === 'object' && !Array.isArray(delta))
    .map((delta) => ({
      fieldKey: typeof delta.fieldKey === 'string' ? delta.fieldKey : '',
      path: typeof delta.path === 'string' ? delta.path : '',
      classification:
        typeof delta.piiClassification === 'string'
          ? delta.piiClassification
          : typeof delta.classification === 'string'
            ? delta.classification
            : null,
      before: delta.before ?? null,
      after: delta.after ?? null
    }));
}
