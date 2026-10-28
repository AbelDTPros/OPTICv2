import { Router, type Request } from 'express';
import { z } from 'zod';
import { unauthorized } from '../../../platform/errors/app-error.js';
import type { ActorContext } from '../../../platform/security/actor.js';
import type { SupervisorDashboardService } from '../service/supervisor-dashboard.service.js';

const querySchema = z.object({
  definitionKey: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
  activityLimit: z.coerce.number().int().min(1).max(50).optional()
});

export function createSupervisorRouter(service: SupervisorDashboardService): Router {
  const router = Router();

  router.get('/dashboard', async (req, res, next) => {
    try {
      const query = querySchema.parse(req.query);
      const definitionKeys = normalizeDefinitionKeys(query.definitionKey);
      const data = await service.getDashboard(requireActor(req), {
        definitionKeys,
        activityLimit: query.activityLimit,
        filters: collectFilterParams(req.query)
      });
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

/** Reads filter.<fieldKey>=value query params for Dashboard dimensions. */
function collectFilterParams(query: Request['query']): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const [key, raw] of Object.entries(query)) {
    if (!key.startsWith('filter.') || key.length <= 'filter.'.length) {
      continue;
    }
    const fieldKey = key.slice('filter.'.length);
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === 'string' && value.trim()) {
      filters[fieldKey] = value.trim();
    }
  }
  return filters;
}

function normalizeDefinitionKeys(value: string | string[] | undefined): string[] {
  if (value == null) {
    return [];
  }
  return (Array.isArray(value) ? value : [value]).flatMap((item) =>
    item.split(',').map((part) => part.trim()).filter(Boolean)
  );
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
