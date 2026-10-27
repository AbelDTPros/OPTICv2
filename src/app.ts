import express, { type Express } from 'express';
import type { AppConfig } from './config/env.js';
import { authenticationMiddleware } from './middleware/authentication.js';
import { authorizationMiddleware } from './middleware/authorization.js';
import { correlationMiddleware } from './middleware/correlation.js';
import { errorHandlerMiddleware } from './middleware/error-handler.js';
import { notFoundMiddleware } from './middleware/not-found.js';
import { requestLoggingMiddleware } from './middleware/request-logging.js';
import { createConfigurationRouter } from './modules/configuration/api/configuration.routes.js';
import type { DefinitionLoader } from './modules/configuration/definitions/definition-loader.js';
import type { DefinitionReleaseService } from './modules/configuration/service/definition-release.service.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import { createBulkActionRouter } from './modules/bulk/api/bulk.routes.js';
import type { BulkActionService } from './modules/bulk/service/bulk-action.service.js';
import { createAdminAuditRouter } from './modules/admin-audit/api/admin-audit.routes.js';
import type { AdminAuditService } from './modules/admin-audit/service/admin-audit.service.js';
import {
  createAdminFeatureFlagRouter,
  createFeatureFlagRouter
} from './modules/feature-flags/api/feature-flag.routes.js';
import type { FeatureFlagService } from './modules/feature-flags/service/feature-flag.service.js';
import { createQueueRouter } from './modules/queue/api/queue.routes.js';
import type { QueueService } from './modules/queue/service/queue.service.js';
import { createSearchRouter } from './modules/search/api/search.routes.js';
import type { SearchService } from './modules/search/service/search.service.js';
import { createTrackingRouter } from './modules/tracking/api/tracking.routes.js';
import type { TrackingService } from './modules/tracking/service/tracking.service.js';
import { createWorkloadAliasRouter, createWorkflowRouter } from './modules/workflow/api/workflow.routes.js';
import type { WorkflowInstanceService } from './modules/workflow/service/workflow-instance.service.js';
import type { IdempotencyRepository } from './platform/idempotency/idempotency.repository.js';
import type { OutboxRepository } from './platform/outbox/outbox.repository.js';

export function createApp(
  config: AppConfig,
  service: DefinitionReleaseService,
  loader: DefinitionLoader,
  workflow: WorkflowInstanceService,
  idempotency: IdempotencyRepository,
  queues: QueueService,
  outbox?: OutboxRepository,
  bulk?: BulkActionService,
  search?: SearchService,
  tracking?: TrackingService,
  features?: FeatureFlagService,
  adminAudit?: AdminAuditService
): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(correlationMiddleware);
  app.use(requestLoggingMiddleware);
  app.use(authenticationMiddleware(config.authMode));
  app.use(authorizationMiddleware);
  app.use('/health', createHealthRouter(config));
  app.use('/api/v1/config', createConfigurationRouter(service, loader, idempotency, features));
  app.use('/api/v1/workflows', createWorkflowRouter(workflow, idempotency));
  app.use('/api/v1/workloads', createWorkloadAliasRouter(workflow, idempotency));
  app.use('/api/v1/queues', createQueueRouter(queues, idempotency));
  if (features) {
    app.use('/api/v1/features', createFeatureFlagRouter(features));
    app.use('/api/v1/admin/features', createAdminFeatureFlagRouter(features));
  }
  if (adminAudit) {
    app.use('/api/v1/admin/audit', createAdminAuditRouter(adminAudit));
  }
  if (search) {
    app.use('/api/v1/search', createSearchRouter(search, features));
  }
  if (bulk) {
    app.use('/api/v1', createBulkActionRouter(bulk, idempotency, features));
  }
  if (tracking) {
    app.use('/api/v1/tracking-ids', createTrackingRouter(tracking));
  }
  app.use(notFoundMiddleware);
  app.use(errorHandlerMiddleware(outbox));
  return app;
}
