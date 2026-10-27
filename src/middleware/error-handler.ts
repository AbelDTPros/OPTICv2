import type { NextFunction, Request, Response } from 'express';
import { normalizeError } from '../platform/errors/error-envelope.js';
import { safePath } from '../platform/http/safe-path.js';
import { log, logError } from '../platform/logging/logger.js';
import { createDiagnosticOutboxEvent, diagnosticEventType } from '../platform/outbox/diagnostic-events.js';
import type { OutboxRepository } from '../platform/outbox/outbox.repository.js';

export function errorHandlerMiddleware(outbox?: OutboxRepository) {
  return (error: unknown, req: Request, res: Response, _next: NextFunction): void => {
    void respond(error, req, res, outbox);
  };
}

async function respond(
  error: unknown,
  req: Request,
  res: Response,
  outbox?: OutboxRepository
): Promise<void> {
  const correlationId = req.correlationId ?? `c-${crypto.randomUUID()}`;
  const normalized = normalizeError(error, correlationId);
  const operation = req.method + ' ' + safePath(req);

  if (normalized.logLevel === 'error') {
    logError('HTTP request failed', error, {
      event: 'http.error',
      correlationId,
      errorCode: normalized.envelope.error.errorCode,
      referenceId: normalized.envelope.error.referenceId,
      statusCode: normalized.httpStatus,
      operation,
      actorId: req.actor?.actorId,
      sessionId: req.actor?.sessionId
    });
  } else {
    log('warn', 'HTTP request rejected', {
      event: 'http.client_error',
      correlationId,
      errorCode: normalized.envelope.error.errorCode,
      referenceId: normalized.envelope.error.referenceId,
      statusCode: normalized.httpStatus,
      operation,
      actorId: req.actor?.actorId
    });
  }

  const diagnosticType = diagnosticEventType(
    normalized.envelope.error.errorCode,
    normalized.httpStatus
  );
  if (outbox && diagnosticType) {
    try {
      await outbox.append(
        createDiagnosticOutboxEvent({
          actor: req.actor,
          eventType: diagnosticType,
          correlationId,
          errorCode: normalized.envelope.error.errorCode,
          referenceId: normalized.envelope.error.referenceId,
          httpStatus: normalized.httpStatus,
          operation
        })
      );
    } catch (appendError: unknown) {
      logError('Diagnostic outbox append failed', appendError, {
        event: 'outbox.diagnostic_failed',
        correlationId,
        eventType: diagnosticType
      });
    }
  }

  res.status(normalized.httpStatus).json(normalized.envelope);
}
