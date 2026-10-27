import { Router, type Request } from 'express';
import { z } from 'zod';
import { unauthorized } from '../../../platform/errors/app-error.js';
import type { ActorContext } from '../../../platform/security/actor.js';
import type { FeatureFlagService } from '../service/feature-flag.service.js';

const updateBody = z.object({
  enabled: z.boolean(),
  expectedRowVersion: z.number().int().positive()
});

export function createFeatureFlagRouter(service: FeatureFlagService): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const data = await service.listEffective(requireActor(req));
      res.json({
        data,
        meta: { correlationId: req.correlationId, timestamp: new Date().toISOString() }
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function createAdminFeatureFlagRouter(service: FeatureFlagService): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const flags = await service.listAdmin(requireActor(req));
      res.json({
        data: {
          flags: flags.map(serializeFlag),
          admin: service.getAdminGates()
        },
        meta: { correlationId: req.correlationId, timestamp: new Date().toISOString() }
      });
    } catch (error) {
      next(error);
    }
  });

  router.put('/:flagKey', async (req, res, next) => {
    try {
      const body = updateBody.parse(req.body);
      const updated = await service.update(requireActor(req), {
        key: req.params.flagKey ?? '',
        enabled: body.enabled,
        expectedRowVersion: body.expectedRowVersion
      });
      res.json({
        data: serializeFlag(updated),
        meta: { correlationId: req.correlationId, timestamp: new Date().toISOString() }
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function serializeFlag(flag: {
  key: string;
  label: string;
  enabled: boolean;
  description: string;
  rowVersion: number;
  updatedAt: Date;
  updatedBy: string;
  group: string;
}) {
  return {
    key: flag.key,
    label: flag.label,
    enabled: flag.enabled,
    description: flag.description,
    rowVersion: flag.rowVersion,
    updatedAt: flag.updatedAt.toISOString(),
    updatedBy: flag.updatedBy,
    group: flag.group
  };
}

function requireActor(req: Request): ActorContext {
  if (!req.actor) {
    throw unauthorized();
  }
  return {
    ...req.actor,
    correlationId: req.correlationId,
    sessionId: req.actor.sessionId ?? req.header('x-session-id') ?? undefined
  };
}
