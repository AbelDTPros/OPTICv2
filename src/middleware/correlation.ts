import type { NextFunction, Request, Response } from 'express';
import { runWithRequestContext } from '../platform/logging/request-context.js';

const UUID_LIKE = /^[A-Za-z0-9._:-]{8,128}$/;

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-correlation-id');
  const correlationId = incoming && UUID_LIKE.test(incoming) ? incoming : `c-${crypto.randomUUID()}`;
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);
  runWithRequestContext({ correlationId, sessionId: req.header('x-session-id') ?? undefined }, () => {
    next();
  });
}
