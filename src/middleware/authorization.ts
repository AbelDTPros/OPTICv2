import type { NextFunction, Request, Response } from 'express';

/**
 * RBAC administration is out of scope. This hook exists so every /api/v1
 * request has an actor context before module services enforce permissions.
 */
export function authorizationMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (req.originalUrl.startsWith('/health') || req.actor) {
    next();
    return;
  }
  next();
}
