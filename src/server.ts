import { loadConfig } from './config/env.js';
import { createApp } from './app.js';
import { createConfigurationRuntime } from './modules/configuration/runtime.js';
import { SchedulerWorker } from './modules/scheduler/scheduler.worker.js';
import { configureLogger, log, logError } from './platform/logging/logger.js';
import { installProcessHandlers } from './platform/process/process-handlers.js';

async function main(): Promise<void> {
  const config = loadConfig();
  configureLogger({
    service: config.serviceName,
    serviceVersion: config.serviceVersion,
    environment: config.nodeEnv,
    minLevel: config.logLevel,
    includeStackTraces: config.includeStackTraces
  });

  const {
    service,
    loader,
    workflow,
    idempotency,
    queues,
    search,
    tracking,
    bulk,
    features,
    adminAudit,
    pipeline,
    outbox
  } = createConfigurationRuntime(config);
  const rebuilt = await workflow.rebuildProjections();
  if (rebuilt > 0) {
    log('info', 'Rebuilt queue projections', { event: 'queue.projection_backfill', count: rebuilt });
  }
  const scheduler = new SchedulerWorker(workflow, config.scheduler);
  const app = createApp(
    config,
    service,
    loader,
    workflow,
    idempotency,
    queues,
    outbox,
    bulk,
    search,
    tracking,
    features,
    adminAudit
  );
  const server = await listenHttp(app, config.port);
  log('info', 'API server listening', {
    event: 'server.started',
    port: config.port,
    databaseHost: config.database.host,
    databasePort: config.database.port,
    databaseName: config.database.database
  });

  scheduler.start();
  pipeline.start();
  installProcessHandlers(server, {
    onShutdown: async () => {
      await Promise.all([scheduler.stop(), pipeline.stop()]);
    }
  });
}

async function listenHttp(app: ReturnType<typeof createApp>, port: number) {
  for (;;) {
    try {
      return await bindHttp(app, port);
    } catch (error: unknown) {
      const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
      if (code !== 'EADDRINUSE') {
        throw error;
      }
      const occupantIsOptic = await portAlreadyServesOptic(port);
      log('warn', occupantIsOptic
          ? `Port ${port} already has an OPTIC API. Waiting to bind if that process stops...`
          : `Port ${port} is in use. Waiting to bind...`, {
        event: 'server.listen_retry',
        port,
        occupantIsOptic
      });
      await delay(2000);
    }
  }
}

function bindHttp(app: ReturnType<typeof createApp>, port: number) {
  const server = app.listen(port);
  return new Promise<typeof server>((resolve, reject) => {
    const onError = (error: Error) => {
      server.close();
      reject(error);
    };
    server.once('error', onError);
    server.once('listening', () => {
      server.off('error', onError);
      resolve(server);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function portAlreadyServesOptic(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health/live`, {
      signal: AbortSignal.timeout(800)
    });
    if (!response.ok) {
      return false;
    }
    const body = (await response.json()) as { status?: string; checks?: { process?: string } };
    return body.status === 'ok' && body.checks?.process === 'up';
  } catch {
    return false;
  }
}

main().catch((error: unknown) => {
  logError('API server failed to start', error, { event: 'server.failed' });
  process.exit(1);
});
