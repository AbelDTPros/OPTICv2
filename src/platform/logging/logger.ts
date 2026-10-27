import { hostname } from 'node:os';
import { getRequestContext, type RequestLogContext } from './request-context.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  correlationId?: string;
  sessionId?: string;
  actorId?: string;
  event?: string;
  operation?: string;
  errorCode?: string;
  [key: string]: unknown;
}

export interface LoggerRuntimeConfig {
  service: string;
  serviceVersion: string;
  environment: string;
  minLevel: LogLevel;
  includeStackTraces: boolean;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const PROHIBITED_KEY_PATTERN =
  /password|passwd|authorization|authheader|token|secret|cookie|saml|assertion|ssn|anumber|a_number|receiptnumber|receipt_number|creditcard|cardnumber|piv/i;

const RECEIPT_IN_TEXT = /\b[A-Z]{3}\d{10}\b/g;
const A_NUMBER_IN_TEXT = /\bA\d{8,9}\b/gi;
const SSN_IN_TEXT = /\b\d{3}-\d{2}-\d{4}\b/g;
const BEARER_IN_TEXT = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_IN_TEXT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

let runtime: LoggerRuntimeConfig = {
  service: 'api-server',
  serviceVersion: process.env.SERVICE_VERSION ?? '0.1.0',
  environment: process.env.NODE_ENV ?? 'development',
  minLevel: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  includeStackTraces: process.env.NODE_ENV !== 'production'
};

export function configureLogger(config: Partial<LoggerRuntimeConfig>): void {
  runtime = { ...runtime, ...config };
}

export function getLoggerConfig(): LoggerRuntimeConfig {
  return runtime;
}

export function redactSensitiveText(text: string): string {
  return text
    .replace(RECEIPT_IN_TEXT, '[REDACTED]')
    .replace(A_NUMBER_IN_TEXT, '[REDACTED]')
    .replace(SSN_IN_TEXT, '[REDACTED]')
    .replace(BEARER_IN_TEXT, 'Bearer [REDACTED]')
    .replace(JWT_IN_TEXT, '[REDACTED]');
}

export function sanitize(value: unknown, key?: string): unknown {
  if (key && isProhibitedKey(key)) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        sanitize(childValue, childKey)
      ])
    );
  }
  return value;
}

export function log(level: LogLevel, message: string, fields: LogFields = {}): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[runtime.minLevel]) {
    return;
  }

  const context = getRequestContext();
  const sanitized = sanitize(fields) as LogFields;
  const entry = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    service: runtime.service,
    serviceVersion: runtime.serviceVersion,
    environment: runtime.environment,
    host: hostname(),
    message: redactSensitiveText(message),
    ...contextFields(context),
    ...sanitized
  };

  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(`${line}\n`);
    return;
  }
  process.stdout.write(`${line}\n`);
}

export function logError(message: string, error: unknown, fields: LogFields = {}): void {
  const details: LogFields = { ...fields };
  if (error instanceof Error) {
    details.errorName = error.name;
    details.errorMessage = error.message;
    if (runtime.includeStackTraces && error.stack) {
      details.stack = error.stack;
    }
  } else {
    details.errorMessage = 'unknown';
  }
  log('error', message, details);
}

function contextFields(context: RequestLogContext): LogFields {
  return {
    ...(context.correlationId ? { correlationId: context.correlationId } : {}),
    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    ...(context.actorId ? { actorId: context.actorId } : {}),
    ...(context.operation ? { operation: context.operation } : {}),
    ...(context.entityType ? { entityType: context.entityType } : {}),
    ...(context.trackingId ? { trackingId: context.trackingId } : {})
  };
}

function isProhibitedKey(key: string): boolean {
  return PROHIBITED_KEY_PATTERN.test(key);
}
