import type { ActorContext } from '../security/actor.js';
import type { AppendOutboxEventInput } from './outbox.repository.js';

export function createConfigOutboxEvent(input: {
  actor: ActorContext;
  eventType:
    | 'CONFIG_DRAFT_CREATED'
    | 'CONFIG_CHANGED'
    | 'CONFIG_SUBMITTED'
    | 'CONFIG_APPROVED'
    | 'CONFIG_PUBLISHED'
    | 'CONFIG_ACTIVATED'
    | 'CONFIG_RETIRED';
  aggregateType: 'DEFINITION' | 'DEFINITION_RELEASE';
  aggregateId: string;
  definitionKey: string;
  version?: string;
  change?: string;
  checksum?: string;
  comment?: string;
}): AppendOutboxEventInput {
  const occurredAt = new Date().toISOString();
  const eventId = crypto.randomUUID();
  return {
    eventId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
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
      sourceService: 'api-server',
      correlationId: input.actor.correlationId ?? `c-${eventId}`,
      sessionId: input.actor.sessionId ?? null,
      actor: {
        id: input.actor.actorId,
        displayName: input.actor.actorName ?? input.actor.actorId,
        actorType: 'USER'
      },
      entity: {
        entityType: 'CONFIGURATION',
        definitionKey: input.definitionKey,
        definitionVersion: input.version ?? null
      },
      payload: {
        change: input.change ?? input.eventType,
        checksum: input.checksum ?? null,
        comment: input.comment ?? null
      }
    }
  };
}
