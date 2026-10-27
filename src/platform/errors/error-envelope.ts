import { ZodError } from 'zod';
import { AppError, createReferenceId, fieldInputId, type ErrorDetails } from './app-error.js';

export interface ErrorEnvelope {
  error: {
    errorCode: string;
    message: string;
    summary: string;
    referenceId: string;
    details: ErrorDetails;
  };
  meta: {
    correlationId: string;
    timestamp: string;
  };
}

export interface NormalizedError {
  httpStatus: number;
  envelope: ErrorEnvelope;
  logLevel: 'warn' | 'error';
  stack?: string;
}

export function normalizeError(error: unknown, correlationId: string): NormalizedError {
  const referenceId = createReferenceId();
  const timestamp = new Date().toISOString();

  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => {
      const path = issue.path.join('.');
      const field = String(issue.path[issue.path.length - 1] ?? path);
      return {
        field,
        path,
        message: issue.message,
        inputId: field ? fieldInputId(field) : undefined
      };
    });
    return {
      httpStatus: 400,
      logLevel: 'warn',
      envelope: envelope(
        'OPTIC-VAL-40001',
        'Request validation failed. Review the highlighted fields and try again.',
        referenceId,
        details,
        correlationId,
        timestamp
      )
    };
  }

  if (isJsonSyntaxError(error)) {
    return {
      httpStatus: 400,
      logLevel: 'warn',
      envelope: envelope(
        'OPTIC-VAL-40002',
        'Request body must be valid JSON.',
        referenceId,
        [],
        correlationId,
        timestamp
      )
    };
  }

  if (error instanceof AppError) {
    return {
      httpStatus: error.httpStatus,
      logLevel: error.httpStatus >= 500 ? 'error' : 'warn',
      envelope: envelope(
        error.errorCode,
        error.message,
        referenceId,
        error.details,
        correlationId,
        timestamp,
        error.summary
      )
    };
  }

  return {
    httpStatus: 500,
    logLevel: 'error',
    stack: error instanceof Error ? error.stack : undefined,
    envelope: envelope(
      'OPTIC-SYS-50001',
      'An unexpected system error occurred.',
      referenceId,
      [],
      correlationId,
      timestamp
    )
  };
}

function envelope(
  errorCode: string,
  message: string,
  referenceId: string,
  details: ErrorDetails,
  correlationId: string,
  timestamp: string,
  summary = message
): ErrorEnvelope {
  return {
    error: {
      errorCode,
      message,
      summary,
      referenceId,
      details
    },
    meta: {
      correlationId,
      timestamp
    }
  };
}

function isJsonSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError && 'body' in error;
}
