import { Router, type Request } from 'express';
import { z } from 'zod';
import { unauthorized } from '../../../platform/errors/app-error.js';
import type { ActorContext } from '../../../platform/security/actor.js';
import type { TrackingService } from '../service/tracking.service.js';

const mintBody = z.object({
  entityType: z.string().min(1)
});

export function createTrackingRouter(service: TrackingService): Router {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const actor = requireActor(req);
      const body = mintBody.parse(req.body);
      const issued = await service.mint(actor, body.entityType);
      res.status(201).json({
        data: {
          trackingId: issued.trackingId,
          entityType: issued.entityType,
          issuedAt: issued.issuedAt.toISOString()
        },
        meta: { correlationId: req.correlationId, timestamp: new Date().toISOString() }
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
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
