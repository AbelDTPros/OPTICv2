import { Router, type Request } from 'express';
import { requireFeatureFlag } from '../../../middleware/feature-flag.js';
import { unauthorized } from '../../../platform/errors/app-error.js';
import { log } from '../../../platform/logging/logger.js';
import type { FeatureFlagService } from '../../feature-flags/service/feature-flag.service.js';
import type { SearchService } from '../service/search.service.js';
import { searchQuery } from './schemas.js';

export function createSearchRouter(service: SearchService, features?: FeatureFlagService): Router {
  const router = Router();
  if (features) {
    router.use(requireFeatureFlag(features, 'api.search'));
  }

  router.get('/', async (req, res, next) => {
    try {
      const actor = req.actor;
      if (!actor) {
        throw unauthorized();
      }
      const query = searchQuery.parse(req.query);
      const data = await service.search(
        {
          ...actor,
          correlationId: req.correlationId,
          sessionId: actor.sessionId ?? req.header('x-session-id') ?? undefined
        },
        {
          q: query.q,
          receiptNumber: query.receiptNumber,
          entityType: query.entityType,
          definitionKey: query.definitionKey,
          currentStageKey: query.currentStageKey,
          assignedTo: query.assignedTo,
          criteria: query.criteria,
          page: query.page ?? 1,
          pageSize: query.pageSize ?? 25
        }
      );
      if (process.env.NODE_ENV !== 'test') {
        log('info', 'Search executed', {
          event: 'search.executed',
          hitCount: data.hits.length,
          page: data.page,
          entityType: query.entityType
        });
      }
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
