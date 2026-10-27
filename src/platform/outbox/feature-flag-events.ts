import type { ActorContext } from '../security/actor.js';
import type { AppendOutboxEventInput } from './outbox.repository.js';

export function createFeatureFlagOutboxEvent(input: {
  actor: ActorContext;
  flagKey: string;
  enabled: boolean;
  previousEnabled: boolean;
}): AppendOutboxEventInput {
  const occurredAt = new Date().toISOString();
  const eventId = crypto.randomUUID();
  return {
    eventId,
    aggregateType: 'FEATURE_FLAG',
    aggregateId: input.flagKey,
    eventType: 'FEATURE_FLAG_CHANGED',
    eventVersion: 1,
    correlationId: input.actor.correlationId ?? `c-${eventId}`,
    sessionId: input.actor.sessionId ?? null,
    actorId: input.actor.actorId,
    payload: {
      eventId,
      eventType: 'FEATURE_FLAG_CHANGED',
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
        entityType: 'FEATURE_FLAG',
        definitionKey: input.flagKey,
        definitionVersion: null
      },
      payload: {
        change: 'FEATURE_FLAG_CHANGED',
        flagKey: input.flagKey,
        enabled: input.enabled,
        previousEnabled: input.previousEnabled
      }
    }
  };
}
