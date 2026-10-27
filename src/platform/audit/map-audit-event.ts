import type { OutboxEventRecord } from '../outbox/outbox.repository.js';
import type { AppendAuditEventInput } from './audit-event.repository.js';

export function mapOutboxToAuditInput(event: OutboxEventRecord): AppendAuditEventInput {
  const payload = event.payload;
  const actor = asRecord(payload.actor);
  const entity = asRecord(payload.entity);
  const workflow = asRecord(payload.workflow);
  const occurredAt = parseOccurredAt(payload.occurredAt, event.occurredAt);
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt,
    actorId: stringOrNull(actor.id) ?? event.actorId,
    actorName: stringOrNull(actor.displayName),
    sessionId: stringOrNull(payload.sessionId) ?? event.sessionId,
    correlationId: stringOrNull(payload.correlationId) ?? event.correlationId,
    sourceService: stringOrNull(payload.sourceService) ?? 'api-server',
    entityType: stringOrNull(entity.entityType),
    entityTrackingId: stringOrNull(entity.trackingId) ?? stringOrNull(entity.definitionKey),
    definitionKey: stringOrNull(entity.definitionKey),
    definitionVersion: stringOrNull(entity.definitionVersion),
    stageKey: stringOrNull(workflow.toStageKey) ?? stringOrNull(workflow.fromStageKey),
    actionKey: stringOrNull(workflow.actionKey) ?? stringOrNull(workflow.scheduledActionKey),
    eventData: structuredClone(payload)
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function parseOccurredAt(value: unknown, fallback: Date): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return fallback;
}
