import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AuditEventRecord } from '../../../platform/audit/audit-event.repository.js';
import { unauthorized } from '../../../platform/errors/app-error.js';
import type { ActorContext } from '../../../platform/security/actor.js';
import type { AdminAuditService } from '../service/admin-audit.service.js';

const listQuery = z.object({
  eventType: z.string().min(1).optional(),
  actorId: z.string().min(1).optional(),
  entityType: z.string().min(1).optional(),
  entityTrackingId: z.string().min(1).optional(),
  definitionKey: z.string().min(1).optional(),
  correlationId: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

export function createAdminAuditRouter(service: AdminAuditService): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const query = listQuery.parse(req.query);
      const result = await service.list(requireActor(req), {
        eventType: query.eventType,
        actorId: query.actorId,
        entityType: query.entityType,
        entityTrackingId: query.entityTrackingId,
        definitionKey: query.definitionKey,
        correlationId: query.correlationId,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        page: query.page ?? 1,
        limit: query.limit ?? 25
      });
      res.json({
        data: {
          items: result.items.map((item) => serializeAudit(item, false)),
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          totalPages: result.totalPages,
          admin: service.getAdminGates()
        },
        meta: { correlationId: req.correlationId, timestamp: new Date().toISOString() }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/filter-options', async (req, res, next) => {
    try {
      const options = await service.filterOptions(requireActor(req));
      res.json({
        data: {
          actors: options.actors,
          definitionKeys: options.definitionKeys,
          admin: service.getAdminGates()
        },
        meta: { correlationId: req.correlationId, timestamp: new Date().toISOString() }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:eventId', async (req, res, next) => {
    try {
      const event = await service.getByEventId(requireActor(req), req.params.eventId ?? '');
      res.json({
        data: serializeAudit(event, true),
        meta: { correlationId: req.correlationId, timestamp: new Date().toISOString() }
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function serializeAudit(event: AuditEventRecord, includeEventData: boolean) {
  return {
    id: event.id ?? null,
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt: event.occurredAt.toISOString(),
    actorId: event.actorId,
    actorName: event.actorName,
    sessionId: event.sessionId,
    correlationId: event.correlationId,
    sourceService: event.sourceService,
    entityType: event.entityType,
    entityTrackingId: event.entityTrackingId,
    definitionKey: event.definitionKey,
    definitionVersion: event.definitionVersion,
    stageKey: event.stageKey,
    actionKey: event.actionKey,
    previousHash: event.previousHash,
    eventHash: event.eventHash,
    createdAt: event.createdAt.toISOString(),
    ...(includeEventData ? { eventData: event.eventData } : {})
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
