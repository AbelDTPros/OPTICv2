import type { Server } from 'node:http';
import { closePool } from '../db/pool.js';
import { log, logError } from '../logging/logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

export function installProcessHandlers(
  server?: Server,
  options?: { onShutdown?: () => Promise<void> }
): void {
  process.on('unhandledRejection', (reason) => {
    logError('Unhandled promise rejection', reason, { event: 'process.unhandled_rejection' });
    if (process.env.NODE_ENV === 'production') {
      void shutdown(server, 'unhandledRejection', 1, options);
    }
  });

  process.on('uncaughtException', (error) => {
    logError('Uncaught exception', error, { event: 'process.uncaught_exception' });
    void shutdown(server, 'uncaughtException', 1, options);
  });

  process.on('SIGTERM', () => {
    void shutdown(server, 'SIGTERM', 0, options);
  });
  process.on('SIGINT', () => {
    void shutdown(server, 'SIGINT', 0, options);
  });
}

export async function shutdown(
  server: Server | undefined,
  signal: string,
  exitCode: number,
  options?: { onShutdown?: () => Promise<void> }
): Promise<void> {
  log('info', 'Shutting down API server', { event: 'server.shutdown', signal });
  const timer = setTimeout(() => {
    log('error', 'Graceful shutdown timed out', { event: 'server.shutdown_timeout', signal });
    process.exit(exitCode || 1);
  }, SHUTDOWN_TIMEOUT_MS);
  timer.unref();

  try {
    await options?.onShutdown?.();
  } catch (error) {
    logError('Shutdown hook failed', error, { event: 'server.shutdown_hook_failed', signal });
  }

  if (!server) {
    await closePool();
    process.exit(exitCode);
    return;
  }

  server.close(async () => {
    await closePool();
    process.exit(exitCode);
  });
}
