import type { AppendOutboxEventInput } from './outbox.repository.js';

export function createDiagnosticOutboxEvent(input: {
  actor?: { actorId?: string; actorName?: string; sessionId?: string | null } | null;
  eventType: 'AUTHORIZATION_DENIED' | 'SYSTEM_ERROR';
  correlationId: string;
  errorCode: string;
  referenceId: string;
  httpStatus: number;
  operation: string;
}): AppendOutboxEventInput {
  const occurredAt = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const actorId = input.actor?.actorId ?? null;
  return {
    eventId,
    aggregateType: 'DIAGNOSTIC',
    aggregateId: input.referenceId,
    eventType: input.eventType,
    eventVersion: 1,
    correlationId: input.correlationId,
    sessionId: input.actor?.sessionId ?? null,
    actorId,
    payload: {
      eventId,
      eventType: input.eventType,
      eventVersion: 1,
      occurredAt,
      sourceService: 'api-server',
      correlationId: input.correlationId,
      sessionId: input.actor?.sessionId ?? null,
      actor: actorId
        ? {
            id: actorId,
            displayName: input.actor?.actorName ?? actorId,
            actorType: 'USER'
          }
        : null,
      payload: {
        errorCode: input.errorCode,
        referenceId: input.referenceId,
        httpStatus: input.httpStatus,
        operation: input.operation
      }
    }
  };
}

export function diagnosticEventType(
  errorCode: string,
  httpStatus: number
): 'AUTHORIZATION_DENIED' | 'SYSTEM_ERROR' | null {
  if (errorCode.startsWith('OPTIC-AUTHZ-')) {
    return 'AUTHORIZATION_DENIED';
  }
  if (httpStatus >= 500) {
    return 'SYSTEM_ERROR';
  }
  return null;
}
