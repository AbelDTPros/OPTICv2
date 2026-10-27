import type { NextFunction, Request, Response } from 'express';
import { safePath } from '../platform/http/safe-path.js';
import { log } from '../platform/logging/logger.js';

export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV === 'test') {
    next();
    return;
  }
  const started = Date.now();
  res.on('finish', () => {
    const statusCode = res.statusCode;
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    log(level, 'HTTP request completed', {
      event: 'http.request',
      correlationId: req.correlationId,
      sessionId: req.actor?.sessionId,
      actorId: req.actor?.actorId,
      method: req.method,
      path: safePath(req),
      statusCode,
      durationMs: Date.now() - started
    });
  });
  next();
}
