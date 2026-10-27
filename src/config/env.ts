import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface SchedulerConfig {
  enabled: boolean;
  pollIntervalMs: number;
  batchSize: number;
  leaseMs: number;
  backoffBaseMs: number;
  defaultMaxAttempts: number;
  workerId: string;
}

export interface OutboxPublisherConfig {
  enabled: boolean;
  pollIntervalMs: number;
  batchSize: number;
  leaseMs: number;
  backoffBaseMs: number;
  defaultMaxAttempts: number;
  workerId: string;
}

export interface FeatureAdminConfig {
  /** When false, Admin nav/page is hidden (clients still learn this via GET /api/v1/features). */
  uiEnabled: boolean;
  /** When false, admin mutate/list APIs return 403 even for ADMIN actors. */
  apiEnabled: boolean;
}

export interface AppConfig {
  nodeEnv: string;
  port: number;
  authMode: 'dev' | 'disabled';
  serviceName: string;
  serviceVersion: string;
  logLevel: LogLevel;
  includeStackTraces: boolean;
  definitionExportDir: string;
  featureAdmin: FeatureAdminConfig;
  scheduler: SchedulerConfig;
  outboxPublisher: OutboxPublisherConfig;
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    adminUser?: string;
    adminPassword?: string;
  };
}

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), '.env');
  try {
    const text = readFileSync(envPath, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      const separator = line.indexOf('=');
      if (separator < 1) {
        continue;
      }
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // Optional local file; Docker Compose defaults still apply below.
  }
}

export function loadConfig(): AppConfig {
  loadDotEnv();
  const authMode = (process.env.AUTH_MODE ?? 'dev') as AppConfig['authMode'];
  if (authMode !== 'dev' && authMode !== 'disabled') {
    throw new Error('AUTH_MODE must be "dev" or "disabled"');
  }

  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const logLevel = (process.env.LOG_LEVEL ?? (nodeEnv === 'production' ? 'info' : 'debug')) as LogLevel;
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new Error('LOG_LEVEL must be debug, info, warn, or error');
  }

  const featureAdminDefault = nodeEnv === 'production' ? 'false' : 'true';

  return {
    nodeEnv,
    port: Number(process.env.PORT ?? 3000),
    authMode,
    serviceName: process.env.SERVICE_NAME ?? 'api-server',
    serviceVersion: process.env.SERVICE_VERSION ?? '0.1.0',
    logLevel,
    includeStackTraces: (process.env.LOG_STACK_TRACES ?? String(nodeEnv !== 'production')) === 'true',
    definitionExportDir: process.env.DEFINITION_EXPORT_DIR ?? resolve(process.cwd(), 'var/definition-export'),
    featureAdmin: {
      uiEnabled: (process.env.FEATURE_ADMIN_UI ?? featureAdminDefault) === 'true',
      apiEnabled: (process.env.FEATURE_ADMIN_API ?? featureAdminDefault) === 'true'
    },
    scheduler: {
      enabled: (process.env.SCHEDULER_ENABLED ?? (nodeEnv === 'test' ? 'false' : 'true')) === 'true',
      pollIntervalMs: Number(process.env.SCHEDULER_POLL_INTERVAL_MS ?? 1000),
      batchSize: Number(process.env.SCHEDULER_BATCH_SIZE ?? 10),
      leaseMs: Number(process.env.SCHEDULER_LEASE_MS ?? 30_000),
      backoffBaseMs: Number(process.env.SCHEDULER_BACKOFF_BASE_MS ?? 5_000),
      defaultMaxAttempts: Number(process.env.SCHEDULER_MAX_ATTEMPTS ?? 5),
      workerId: process.env.SCHEDULER_WORKER_ID ?? `scheduler-${hostname()}-${process.pid}`
    },
    outboxPublisher: {
      enabled: (process.env.OUTBOX_PUBLISHER_ENABLED ?? (nodeEnv === 'test' ? 'false' : 'true')) === 'true',
      pollIntervalMs: Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 1000),
      batchSize: Number(process.env.OUTBOX_BATCH_SIZE ?? 25),
      leaseMs: Number(process.env.OUTBOX_LEASE_MS ?? 30_000),
      backoffBaseMs: Number(process.env.OUTBOX_BACKOFF_BASE_MS ?? 5_000),
      defaultMaxAttempts: Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 5),
      workerId: process.env.OUTBOX_WORKER_ID ?? `outbox-${hostname()}-${process.pid}`
    },
    database: {
      host: required('DATABASE_HOST', '127.0.0.1'),
      port: Number(process.env.DATABASE_PORT ?? 3307),
      user: required('DATABASE_USER', 'optic'),
      password: required('DATABASE_PASSWORD', 'optic'),
      database: required('DATABASE_NAME', 'optic_nextgen'),
      ...(process.env.DATABASE_ADMIN_USER && process.env.DATABASE_ADMIN_PASSWORD
        ? {
            adminUser: process.env.DATABASE_ADMIN_USER,
            adminPassword: process.env.DATABASE_ADMIN_PASSWORD
          }
        : {})
    }
  };
}
