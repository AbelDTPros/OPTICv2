import { Router, type Request } from 'express';
import { unauthorized } from '../../../platform/errors/app-error.js';
import type { IdempotencyRepository } from '../../../platform/idempotency/idempotency.repository.js';
import { replayOrExecute } from '../../../platform/idempotency/replay.js';
import type { ActorContext } from '../../../platform/security/actor.js';
import type { WorkflowInstanceService } from '../service/workflow-instance.service.js';
import {
  assignmentBody,
  createInstanceBody,
  enterStageBody,
  executeActionBody,
  listInstancesQuery,
  reassignBody,
  saveDraftBody,
  scanQuery
} from './schemas.js';

export function createWorkflowRouter(service: WorkflowInstanceService, idempotency: IdempotencyRepository): Router {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const body = createInstanceBody.parse(req.body);
      const data = await service.createInstance(requireActor(req), body);
      res.status(201).json(success(data, req.correlationId, idempotencyKey(req)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/', async (req, res, next) => {
    try {
      const query = listInstancesQuery.parse(req.query);
      const data = await service.listInstancesForRelease(requireActor(req), query.definitionKey, query.version);
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.get('/scan', async (req, res, next) => {
    try {
      const query = scanQuery.parse(req.query);
      const data = await service.scan(requireActor(req), query.q);
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  mountEntityRoutes(router, service, idempotency, (req) => req.params.entityType ?? '', true);
  mountEntityRoutes(router, service, idempotency, () => 'WORKLOAD', false);
  return router;
}

export function createWorkloadAliasRouter(
  service: WorkflowInstanceService,
  idempotency: IdempotencyRepository
): Router {
  const router = Router();
  mountEntityRoutes(router, service, idempotency, () => 'WORKLOAD', false);
  return router;
}

function mountEntityRoutes(
  router: Router,
  service: WorkflowInstanceService,
  idempotency: IdempotencyRepository,
  entityTypeOf: (req: Request) => string,
  includeEntityType: boolean
): void {
  const prefix = includeEntityType ? '/:entityType/:trackingId' : '/:trackingId';

  router.get(prefix, async (req, res, next) => {
    try {
      const data = await service.getSummary(requireActor(req), entityTypeOf(req), req.params.trackingId ?? '');
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.get(`${prefix}/history`, async (req, res, next) => {
    try {
      const summary = await service.getSummary(requireActor(req), entityTypeOf(req), req.params.trackingId ?? '');
      res.json(
        success(
          {
            trackingId: summary.trackingId,
            entityType: summary.entityType,
            definition: summary.definition,
            visits: summary.visits
          },
          req.correlationId
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.post(`${prefix}/assign`, async (req, res, next) => {
    try {
      const actor = requireActor(req);
      const body = assignmentBody.parse(req.body);
      const entityType = entityTypeOf(req);
      const entityTrackingId = req.params.trackingId ?? '';
      const data = await replayOrExecute(
        idempotency,
        actor,
        `assign:${entityType}:${entityTrackingId}`,
        idempotencyKey(req),
        body,
        () =>
          service.assignToSelf(actor, {
            entityType,
            entityTrackingId,
            expectedRowVersion: body.expectedRowVersion
          })
      );
      res.json(success(data, req.correlationId, idempotencyKey(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post(`${prefix}/reassign`, async (req, res, next) => {
    try {
      const actor = requireActor(req);
      const body = reassignBody.parse(req.body);
      const entityType = entityTypeOf(req);
      const entityTrackingId = req.params.trackingId ?? '';
      const data = await replayOrExecute(
        idempotency,
        actor,
        `reassign:${entityType}:${entityTrackingId}`,
        idempotencyKey(req),
        body,
        () =>
          service.reassign(actor, {
            entityType,
            entityTrackingId,
            expectedRowVersion: body.expectedRowVersion,
            assignedTo: body.assignedTo
          })
      );
      res.json(success(data, req.correlationId, idempotencyKey(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post(`${prefix}/release`, async (req, res, next) => {
    try {
      const actor = requireActor(req);
      const body = assignmentBody.parse(req.body);
      const entityType = entityTypeOf(req);
      const entityTrackingId = req.params.trackingId ?? '';
      const data = await replayOrExecute(
        idempotency,
        actor,
        `release:${entityType}:${entityTrackingId}`,
        idempotencyKey(req),
        body,
        () =>
          service.releaseAssignment(actor, {
            entityType,
            entityTrackingId,
            expectedRowVersion: body.expectedRowVersion
          })
      );
      res.json(success(data, req.correlationId, idempotencyKey(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post(`${prefix}/actions/:actionKey`, async (req, res, next) => {
    try {
      const actor = requireActor(req);
      const body = executeActionBody.parse(req.body);
      const entityType = entityTypeOf(req);
      const entityTrackingId = req.params.trackingId ?? '';
      const actionKey = req.params.actionKey ?? '';
      const data = await replayOrExecute(
        idempotency,
        actor,
        `action:${entityType}:${entityTrackingId}:${actionKey}`,
        idempotencyKey(req),
        { actionKey, ...body },
        () =>
          service.executeAction(actor, {
            entityType,
            entityTrackingId,
            actionKey,
            expectedRowVersion: body.expectedRowVersion,
            dataPatch: body.dataPatch,
            comment: body.comment
          })
      );
      res.json(success(data, req.correlationId, idempotencyKey(req)));
    } catch (error) {
      next(error);
    }
  });

  router.patch(`${prefix}/data`, async (req, res, next) => {
    try {
      const actor = requireActor(req);
      const body = saveDraftBody.parse(req.body);
      const entityType = entityTypeOf(req);
      const entityTrackingId = req.params.trackingId ?? '';
      const data = await replayOrExecute(
        idempotency,
        actor,
        `draft:${entityType}:${entityTrackingId}`,
        idempotencyKey(req),
        body,
        () =>
          service.saveDraft(actor, {
            entityType,
            entityTrackingId,
            expectedRowVersion: body.expectedRowVersion,
            dataPatch: body.dataPatch,
            stageKey: body.stageKey
          })
      );
      res.json(success(data, req.correlationId, idempotencyKey(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post(`${prefix}/stage-visits`, async (req, res, next) => {
    try {
      const body = enterStageBody.parse(req.body);
      const data = await service.enterStage(requireActor(req), {
        entityType: entityTypeOf(req),
        entityTrackingId: req.params.trackingId ?? '',
        stageKey: body.stageKey,
        expectedRowVersion: body.expectedRowVersion,
        exitActionKey: body.exitActionKey
      });
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });
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
