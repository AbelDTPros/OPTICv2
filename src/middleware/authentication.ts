import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '../platform/errors/app-error.js';
import { updateRequestContext } from '../platform/logging/request-context.js';

export function authenticationMiddleware(authMode: 'dev' | 'disabled') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.originalUrl.startsWith('/health')) {
      next();
      return;
    }

    if (authMode === 'disabled') {
      req.actor = {
        actorId: 'system-disabled-auth',
        roles: ['CONFIGURATOR']
      };
      updateRequestContext({ actorId: req.actor.actorId });
      next();
      return;
    }

    const authorization = req.header('authorization');
    if (!authorization?.startsWith('Bearer ') || authorization.slice(7).trim() === '') {
      next(unauthorized());
      return;
    }

    const actorId = req.header('x-actor-id') ?? 'dev-user';
    req.actor = {
      actorId,
      actorName: req.header('x-actor-name') ?? actorId,
      sessionId: req.header('x-session-id'),
      roles: parseRoles(req.header('x-actor-roles'))
    };
    updateRequestContext({ actorId, sessionId: req.actor.sessionId });
    next();
  };
}

function parseRoles(header: string | undefined): string[] {
  const roles = (header ?? '')
    .split(',')
    .map((role) => role.trim().toUpperCase())
    .filter(Boolean);
  return roles.length > 0 ? roles : ['CONFIGURATOR'];
}
