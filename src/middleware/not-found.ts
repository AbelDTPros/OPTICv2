import type { NextFunction, Request, Response } from 'express';
import { notFound } from '../platform/errors/app-error.js';
import { safePath } from '../platform/http/safe-path.js';

export function notFoundMiddleware(req: Request, _res: Response, next: NextFunction): void {
  next(notFound('OPTIC-SYS-40401', `The requested resource ${req.method} ${safePath(req)} was not found.`));
}
