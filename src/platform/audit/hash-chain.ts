import { createHash } from 'node:crypto';
import type { AppendAuditEventInput } from './audit-event.repository.js';

export function auditPartitionKey(input: {
  entityType?: string | null;
  entityTrackingId?: string | null;
  definitionKey?: string | null;
}): string {
  if (input.entityType && input.entityTrackingId) {
    return `${input.entityType}:${input.entityTrackingId}`;
  }
  if (input.definitionKey) {
    return `DEFINITION:${input.definitionKey}`;
  }
  if (input.entityType) {
    return input.entityType;
  }
  return 'GLOBAL';
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function canonicalAudit(input: AppendAuditEventInput): string {
  return stableStringify({
    actionKey: input.actionKey,
    actorId: input.actorId,
    actorName: input.actorName,
    correlationId: input.correlationId,
    definitionKey: input.definitionKey,
    definitionVersion: input.definitionVersion,
    entityTrackingId: input.entityTrackingId,
    entityType: input.entityType,
    eventData: input.eventData,
    eventId: input.eventId,
    eventType: input.eventType,
    occurredAt: input.occurredAt.toISOString(),
    sessionId: input.sessionId,
    sourceService: input.sourceService,
    stageKey: input.stageKey
  });
}

export function computeEventHash(canonicalEventWithoutHash: string, previousHash: string | null): string {
  return createHash('sha256')
    .update(`${canonicalEventWithoutHash}${previousHash ?? ''}`, 'utf8')
    .digest('hex');
}

function sortValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortValue((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

