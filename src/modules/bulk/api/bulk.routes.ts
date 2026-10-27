import { Router, type Request } from 'express';
import { requireFeatureFlag } from '../../../middleware/feature-flag.js';
import { notFound, unauthorized } from '../../../platform/errors/app-error.js';
import type { IdempotencyRepository } from '../../../platform/idempotency/idempotency.repository.js';
import { replayOrExecute } from '../../../platform/idempotency/replay.js';
import type { ActorContext } from '../../../platform/security/actor.js';
import type { FeatureFlagService } from '../../feature-flags/service/feature-flag.service.js';
import type { BulkActionService } from '../service/bulk-action.service.js';
import { executeBulkBody } from './schemas.js';

export function createBulkActionRouter(
  service: BulkActionService,
  idempotency: IdempotencyRepository,
  features?: FeatureFlagService
): Router {
  const router = Router();
  if (features) {
    router.use(requireFeatureFlag(features, 'api.bulk_actions'));
  }

  router.post('/bulk-actions/:bulkActionKey/execute', async (req, res, next) => {
    try {
      const actor = requireActor(req);
      const body = executeBulkBody.parse(req.body);
      const bulkActionKey = req.params.bulkActionKey ?? '';
      const data = await replayOrExecute(
        idempotency,
        actor,
        `bulk-execute:${bulkActionKey}`,
        idempotencyKey(req),
        body,
        () =>
          service.execute(actor, {
            bulkActionKey,
            items: body.items.map((item) => ({
              entityType: item.entityType,
              trackingId: item.trackingId,
              expectedRowVersion: item.expectedRowVersion
            })),
            input: body.input
          })
      );
      res.status(201).json(success(data, req.correlationId, idempotencyKey(req)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/bulk-operations/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw notFound('OPTIC-WF-40430', `Bulk operation ${req.params.id} was not found.`);
      }
      const data = await service.getOperation(requireActor(req), id);
      res.json(success(data, req.correlationId));
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

function idempotencyKey(req: Request): string | undefined {
  const value = req.header('x-idempotency-key')?.trim();
  if (!value) {
    return undefined;
  }
  return value.slice(0, 255);
}

function success(data: unknown, correlationId: string, idempotencyKeyValue?: string) {
  return {
    data,
    meta: {
      correlationId,
      timestamp: new Date().toISOString(),
      ...(idempotencyKeyValue ? { idempotencyKey: idempotencyKeyValue } : {})
    }
  };
}
