import { Router, type Request } from 'express';
import { unauthorized } from '../../../platform/errors/app-error.js';
import type { IdempotencyRepository } from '../../../platform/idempotency/idempotency.repository.js';
import { replayOrExecute } from '../../../platform/idempotency/replay.js';
import type { ActorContext } from '../../../platform/security/actor.js';
import type { QueueService } from '../service/queue.service.js';
import { queueAssignBody, queuePageQuery, queueReassignBody } from './schemas.js';

export function createQueueRouter(service: QueueService, idempotency: IdempotencyRepository): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const queues = await service.listQueues(requireActor(req));
      res.json(
        success(
          {
            queues: queues.map((item) => ({
              queueKey: item.queueKey,
              displayName: item.displayName,
              entityType: item.entityType,
              definitionKey: item.definitionKey,
              version: item.version,
              officerSortIndex: item.officerSortIndex,
              total: item.total ?? 0
            }))
          },
          req.correlationId
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.get('/:queueKey', async (req, res, next) => {
    try {
      const query = queuePageQuery.parse(req.query);
      const data = await service.getQueuePage(requireActor(req), req.params.queueKey ?? '', {
        page: query.page,
        pageSize: query.pageSize,
        sort: query.sort,
        direction: query.direction,
        definitionKey: query.definitionKey,
        filters: {
          assignedStatus: query.assignedStatus ?? '',
          workloadType: query.workloadType ?? '',
          slaState: query.slaState ?? '',
          branch: query.branch ?? '',
          location: query.location ?? '',
          receiptNumber: query.receiptNumber ?? ''
        }
      });
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.post('/:queueKey/assign', async (req, res, next) => {
    try {
      const actor = requireActor(req);
      const body = queueAssignBody.parse(req.body);
      const queueKey = req.params.queueKey ?? '';
      const data = await replayOrExecute(
        idempotency,
        actor,
        `queue-assign:${queueKey}:${body.entityType}:${body.trackingId}`,
        idempotencyKey(req),
        body,
        () =>
          service.assignFromQueue(actor, {
            queueKey,
            definitionKey: body.definitionKey,
            entityType: body.entityType,
            trackingId: body.trackingId,
            expectedRowVersion: body.expectedRowVersion
          })
      );
      res.json(success(data, req.correlationId, idempotencyKey(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/:queueKey/release', async (req, res, next) => {
    try {
      const actor = requireActor(req);
      const body = queueAssignBody.parse(req.body);
      const queueKey = req.params.queueKey ?? '';
      const data = await replayOrExecute(
        idempotency,
        actor,
        `queue-release:${queueKey}:${body.entityType}:${body.trackingId}`,
        idempotencyKey(req),
        body,
        () =>
          service.releaseFromQueue(actor, {
            queueKey,
            definitionKey: body.definitionKey,
            entityType: body.entityType,
            trackingId: body.trackingId,
            expectedRowVersion: body.expectedRowVersion
          })
      );
      res.json(success(data, req.correlationId, idempotencyKey(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/:queueKey/reassign', async (req, res, next) => {
    try {
      const actor = requireActor(req);
      const body = queueReassignBody.parse(req.body);
      const queueKey = req.params.queueKey ?? '';
      const data = await replayOrExecute(
        idempotency,
        actor,
        `queue-reassign:${queueKey}:${body.entityType}:${body.trackingId}`,
        idempotencyKey(req),
        body,
        () =>
          service.reassignFromQueue(actor, {
            queueKey,
            definitionKey: body.definitionKey,
            entityType: body.entityType,
            trackingId: body.trackingId,
            expectedRowVersion: body.expectedRowVersion,
            assignedTo: body.assignedTo
          })
      );
      res.json(success(data, req.correlationId, idempotencyKey(req)));
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
