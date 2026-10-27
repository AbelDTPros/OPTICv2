import { Router, type Request } from 'express';
import { requireFeatureFlag } from '../../../middleware/feature-flag.js';
import { unauthorized } from '../../../platform/errors/app-error.js';
import type { IdempotencyRepository } from '../../../platform/idempotency/idempotency.repository.js';
import { replayOrExecute } from '../../../platform/idempotency/replay.js';
import { log } from '../../../platform/logging/logger.js';
import type { ActorContext } from '../../../platform/security/actor.js';
import type { FeatureFlagService } from '../../feature-flags/service/feature-flag.service.js';
import type { StageFormDefinition, WorkflowDefinition } from '../domain/types.js';
import type { DefinitionLoader } from '../definitions/definition-loader.js';
import { simulateTransition } from '../service/simulate-transition.js';
import type { DefinitionReleaseService } from '../service/definition-release.service.js';
import {
  actionBody,
  bulkActionBody,
  createDefinitionBody,
  createReleaseBody,
  formBody,
  expectedRowVersionBody,
  importReleaseBody,
  lifecycleBody,
  queueBody,
  scheduledActionBody,
  schemaBody,
  searchBody,
  simulateBody,
  slaBody,
  workflowBody
} from './schemas.js';

export function createConfigurationRouter(
  service: DefinitionReleaseService,
  loader: DefinitionLoader,
  idempotency: IdempotencyRepository,
  features?: FeatureFlagService
): Router {
  const router = Router();
  const requireCatalogSla = features ? requireFeatureFlag(features, 'ui.designer.catalog.sla') : undefined;
  const requireCatalogBulk = features ? requireFeatureFlag(features, 'ui.designer.catalog.bulk') : undefined;
  const requireCatalogScheduled = features
    ? requireFeatureFlag(features, 'ui.designer.catalog.scheduled')
    : undefined;
  const requireCatalogSearch = features ? requireFeatureFlag(features, 'ui.designer.catalog.search') : undefined;

  router.post('/definitions', async (req, res, next) => {
    try {
      const body = createDefinitionBody.parse(req.body);
      const data = await service.createDefinition(requireActor(req), body);
      res.status(201).json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.get('/definitions', async (req, res, next) => {
    try {
      const data = await service.listDefinitions(requireActor(req));
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.get('/releases', async (req, res, next) => {
    try {
      const data = await service.listReleaseCatalog(requireActor(req));
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.post('/definitions/:definitionKey/releases', async (req, res, next) => {
    try {
      const body = createReleaseBody.parse(req.body);
      const data = await service.createDraftRelease(requireActor(req), {
        definitionKey: req.params.definitionKey ?? '',
        version: body.version,
        cloneFromVersion: body.cloneFromVersion,
        cloneFromDefinitionKey: body.cloneFromDefinitionKey
      });
      res.status(201).json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.post('/definitions/:definitionKey/releases/import', async (req, res, next) => {
    try {
      const body = importReleaseBody.parse(req.body);
      const data = await service.importReleasePackage(requireActor(req), {
        definitionKey: req.params.definitionKey ?? '',
        package: body.package,
        checksum: body.checksum,
        checksumAlgorithm: body.checksumAlgorithm,
        version: body.version,
        createDefinitionIfMissing: body.createDefinitionIfMissing,
        mode: body.mode
      });
      res.status(201).json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.get('/definitions/:definitionKey/releases/:version/compiled', async (req, res, next) => {
    try {
      requireActor(req);
      const data = await loader.summarizeByKeyVersion(
        req.params.definitionKey ?? '',
        req.params.version ?? ''
      );
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.post('/definitions/:definitionKey/releases/:version/simulate', async (req, res, next) => {
    try {
      requireActor(req);
      const body = simulateBody.parse(req.body);
      const data = await simulateTransition(
        loader,
        req.params.definitionKey ?? '',
        req.params.version ?? '',
        body
      );
      if (process.env.NODE_ENV !== 'test') {
        log('info', 'Definition transition simulated', {
          event: 'definition.simulated',
          definitionKey: data.definitionKey,
          version: data.version,
          transitionSetKey: data.transitionSetKey,
          targetStageKey: data.targetStageKey,
          usedDefault: data.usedDefault,
          matchedRuleKey: data.matchedRuleKey
        });
      }
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.get('/releases/:releaseId/compiled', async (req, res, next) => {
    try {
      requireActor(req);
      const releaseId = req.params.releaseId ?? '';
      const cacheHit = Boolean(loader.getCache().peekByReleaseId(releaseId));
      const compiled = await loader.loadByReleaseId(releaseId);
      res.json(
        success(
          {
            releaseId: compiled.releaseId,
            definitionKey: compiled.definitionKey,
            version: compiled.version,
            lifecycleStatus: compiled.lifecycleStatus,
            cacheKey: compiled.cacheKey,
            cacheHit,
            schemaCompiled: compiled.schema.compiled,
            stageKeys: compiled.release.workflow.stages.map((stage) => stage.stageKey)
          },
          req.correlationId
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.post('/definitions/:definitionKey/releases/:version/validate', async (req, res, next) => {
    try {
      const data = await service.validateRelease(
        requireActor(req),
        req.params.definitionKey ?? '',
        req.params.version ?? ''
      );
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.post('/definitions/:definitionKey/releases/:version/submit', async (req, res, next) => {
    await runLifecycle(req, res, next, idempotency, 'submit', (actor, body) =>
      service.submit(actor, body)
    );
  });

  router.post('/definitions/:definitionKey/releases/:version/approve', async (req, res, next) => {
    await runLifecycle(req, res, next, idempotency, 'approve', (actor, body) =>
      service.approve(actor, body)
    );
  });

  router.post('/definitions/:definitionKey/releases/:version/reject', async (req, res, next) => {
    await runLifecycle(req, res, next, idempotency, 'reject', (actor, body) =>
      service.reject(actor, body)
    );
  });

  router.post('/definitions/:definitionKey/releases/:version/return-to-draft', async (req, res, next) => {
    await runLifecycle(req, res, next, idempotency, 'return-to-draft', (actor, body) =>
      service.returnToDraft(actor, body)
    );
  });

  router.post('/definitions/:definitionKey/releases/:version/publish', async (req, res, next) => {
    await runLifecycle(req, res, next, idempotency, 'publish', (actor, body) =>
      service.publish(actor, body)
    );
  });

  router.post('/definitions/:definitionKey/releases/:version/retire', async (req, res, next) => {
    await runLifecycle(req, res, next, idempotency, 'retire', (actor, body) =>
      service.retire(actor, body)
    );
  });

  router.post('/definitions/:definitionKey/activate/:version', async (req, res, next) => {
    await runLifecycle(req, res, next, idempotency, 'activate', (actor, body) =>
      service.activate(actor, body)
    );
  });

  router.post('/definitions/:definitionKey/deactivate/:version', async (req, res, next) => {
    await runLifecycle(req, res, next, idempotency, 'deactivate', (actor, body) =>
      service.deactivate(actor, body)
    );
  });

  router.get('/definitions/:definitionKey/releases/:version/export', async (req, res, next) => {
    try {
      const data = await service.exportRelease(
        requireActor(req),
        req.params.definitionKey ?? '',
        req.params.version ?? ''
      );
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.get('/definitions/:definitionKey/releases/:fromVersion/diff/:toVersion', async (req, res, next) => {
    try {
      const data = await service.diffReleases(
        requireActor(req),
        req.params.definitionKey ?? '',
        req.params.fromVersion ?? '',
        req.params.toVersion ?? ''
      );
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.get('/definitions/:definitionKey/releases/:version', async (req, res, next) => {
    try {
      const data = await service.getRelease(
        requireActor(req),
        req.params.definitionKey ?? '',
        req.params.version ?? ''
      );
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.delete('/definitions/:definitionKey/releases/:version', async (req, res, next) => {
    try {
      const body = expectedRowVersionBody.parse(req.body);
      const data = await service.deleteDraftRelease(requireActor(req), {
        definitionKey: req.params.definitionKey ?? '',
        version: req.params.version ?? '',
        expectedRowVersion: body.expectedRowVersion
      });
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.put('/definitions/:definitionKey/releases/:version/workflow', async (req, res, next) => {
    try {
      const body = workflowBody.parse(req.body);
      const data = await service.saveWorkflow(requireActor(req), {
        definitionKey: req.params.definitionKey ?? '',
        version: req.params.version ?? '',
        expectedRowVersion: body.expectedRowVersion,
        payload: body.workflow as WorkflowDefinition
      });
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.put('/definitions/:definitionKey/releases/:version/schema', async (req, res, next) => {
    try {
      const body = schemaBody.parse(req.body);
      const data = await service.saveSchema(requireActor(req), command(req, body));
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.delete('/definitions/:definitionKey/releases/:version/forms/:formKey', async (req, res, next) => {
    try {
      const body = expectedRowVersionBody.parse(req.body);
      const data = await service.deleteForm(requireActor(req), {
        definitionKey: req.params.definitionKey ?? '',
        version: req.params.version ?? '',
        expectedRowVersion: body.expectedRowVersion,
        formKey: req.params.formKey ?? ''
      });
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.put('/definitions/:definitionKey/releases/:version/forms/:formKey', async (req, res, next) => {
    try {
      const body = formBody.parse(req.body);
      const data = await service.saveForm(requireActor(req), {
        ...command(req, body),
        payload: {
          ...body.payload,
          formKey: req.params.formKey ?? body.payload.formKey
        } as unknown as StageFormDefinition
      });
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.put('/definitions/:definitionKey/releases/:version/actions/:actionKey', async (req, res, next) => {
    try {
      const body = actionBody.parse(req.body);
      const data = await service.saveAction(requireActor(req), {
        ...command(req, body),
        payload: { ...body.payload, actionKey: req.params.actionKey ?? body.payload.actionKey }
      });
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.delete('/definitions/:definitionKey/releases/:version/actions/:actionKey', async (req, res, next) => {
    try {
      const body = expectedRowVersionBody.parse(req.body);
      const data = await service.deleteAction(requireActor(req), {
        definitionKey: req.params.definitionKey ?? '',
        version: req.params.version ?? '',
        expectedRowVersion: body.expectedRowVersion,
        actionKey: req.params.actionKey ?? ''
      });
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.put('/definitions/:definitionKey/releases/:version/queues/:queueKey', async (req, res, next) => {
    try {
      const body = queueBody.parse(req.body);
      const data = await service.saveQueue(requireActor(req), {
        ...command(req, body),
        payload: { ...body.payload, queueKey: req.params.queueKey ?? body.payload.queueKey }
      });
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.delete('/definitions/:definitionKey/releases/:version/queues/:queueKey', async (req, res, next) => {
    try {
      const body = expectedRowVersionBody.parse(req.body);
      const data = await service.deleteQueue(requireActor(req), {
        definitionKey: req.params.definitionKey ?? '',
        version: req.params.version ?? '',
        expectedRowVersion: body.expectedRowVersion,
        queueKey: req.params.queueKey ?? ''
      });
      res.json(success(data, req.correlationId));
    } catch (error) {
      next(error);
    }
  });

  router.put(
    '/definitions/:definitionKey/releases/:version/bulk-actions/:bulkActionKey',
    ...(requireCatalogBulk ? [requireCatalogBulk] : []),
    async (req, res, next) => {
      try {
        const body = bulkActionBody.parse(req.body);
        const data = await service.saveBulkAction(requireActor(req), {
          ...command(req, body),
          payload: { ...body.payload, bulkActionKey: req.params.bulkActionKey ?? body.payload.bulkActionKey }
        });
        res.json(success(data, req.correlationId));
      } catch (error) {
        next(error);
      }
    }
  );

  router.delete(
    '/definitions/:definitionKey/releases/:version/bulk-actions/:bulkActionKey',
    ...(requireCatalogBulk ? [requireCatalogBulk] : []),
    async (req, res, next) => {
      try {
        const body = expectedRowVersionBody.parse(req.body);
        const data = await service.deleteBulkAction(requireActor(req), {
          definitionKey: req.params.definitionKey ?? '',
          version: req.params.version ?? '',
          expectedRowVersion: body.expectedRowVersion,
          bulkActionKey: req.params.bulkActionKey ?? ''
        });
        res.json(success(data, req.correlationId));
      } catch (error) {
        next(error);
      }
    }
  );

  router.put(
    '/definitions/:definitionKey/releases/:version/scheduled-actions/:scheduledActionKey',
    ...(requireCatalogScheduled ? [requireCatalogScheduled] : []),
    async (req, res, next) => {
      try {
        const body = scheduledActionBody.parse(req.body);
        const data = await service.saveScheduledAction(requireActor(req), {
          ...command(req, body),
          payload: {
            ...body.payload,
            scheduledActionKey: req.params.scheduledActionKey ?? body.payload.scheduledActionKey
          }
        });
        res.json(success(data, req.correlationId));
      } catch (error) {
        next(error);
      }
    }
  );

  router.delete(
    '/definitions/:definitionKey/releases/:version/scheduled-actions/:scheduledActionKey',
    ...(requireCatalogScheduled ? [requireCatalogScheduled] : []),
    async (req, res, next) => {
      try {
        const body = expectedRowVersionBody.parse(req.body);
        const data = await service.deleteScheduledAction(requireActor(req), {
          definitionKey: req.params.definitionKey ?? '',
          version: req.params.version ?? '',
          expectedRowVersion: body.expectedRowVersion,
          scheduledActionKey: req.params.scheduledActionKey ?? ''
        });
        res.json(success(data, req.correlationId));
      } catch (error) {
        next(error);
      }
    }
  );

  router.put(
    '/definitions/:definitionKey/releases/:version/slas/:slaKey',
    ...(requireCatalogSla ? [requireCatalogSla] : []),
    async (req, res, next) => {
      try {
        const body = slaBody.parse(req.body);
        const data = await service.saveSla(requireActor(req), {
          ...command(req, body),
          payload: { ...body.payload, slaKey: req.params.slaKey ?? body.payload.slaKey }
        });
        res.json(success(data, req.correlationId));
      } catch (error) {
        next(error);
      }
    }
  );

  router.delete(
    '/definitions/:definitionKey/releases/:version/slas/:slaKey',
    ...(requireCatalogSla ? [requireCatalogSla] : []),
    async (req, res, next) => {
      try {
        const body = expectedRowVersionBody.parse(req.body);
        const data = await service.deleteSla(requireActor(req), {
          definitionKey: req.params.definitionKey ?? '',
          version: req.params.version ?? '',
          expectedRowVersion: body.expectedRowVersion,
          slaKey: req.params.slaKey ?? ''
        });
        res.json(success(data, req.correlationId));
      } catch (error) {
        next(error);
      }
    }
  );

  router.put(
    '/definitions/:definitionKey/releases/:version/search',
    ...(requireCatalogSearch ? [requireCatalogSearch] : []),
    async (req, res, next) => {
      try {
        const body = searchBody.parse(req.body);
        const data = await service.saveSearch(requireActor(req), command(req, body));
        res.json(success(data, req.correlationId));
      } catch (error) {
        next(error);
      }
    }
  );

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

function command<T>(
  req: { params: { definitionKey?: string; version?: string } },
  body: { expectedRowVersion: number; payload: T }
) {
  return {
    definitionKey: req.params.definitionKey ?? '',
    version: req.params.version ?? '',
    expectedRowVersion: body.expectedRowVersion,
    payload: body.payload
  };
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

function idempotencyKeyOf(req: Request): string | undefined {
  const value = req.header('x-idempotency-key')?.trim();
  return value ? value.slice(0, 255) : undefined;
}

async function runLifecycle(
  req: Request,
  res: import('express').Response,
  next: import('express').NextFunction,
  idempotency: IdempotencyRepository,
  operation: string,
  work: (
    actor: ActorContext,
    command: {
      definitionKey: string;
      version: string;
      expectedRowVersion: number;
      comment?: string;
    }
  ) => Promise<unknown>
): Promise<void> {
  try {
    const actor = requireActor(req);
    const body = lifecycleBody.parse(req.body);
    const command = {
      definitionKey: req.params.definitionKey ?? '',
      version: req.params.version ?? '',
      expectedRowVersion: body.expectedRowVersion,
      comment: body.comment
    };
    const data = await replayOrExecute(
      idempotency,
      actor,
      `${operation}:${command.definitionKey}:${command.version}`,
      idempotencyKeyOf(req),
      command,
      () => work(actor, command)
    );
    res.json(success(data, req.correlationId, idempotencyKeyOf(req)));
  } catch (error) {
    next(error);
  }
}
