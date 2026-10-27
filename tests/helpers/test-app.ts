import { createApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config/env.js';
import { DefinitionLoader } from '../../src/modules/configuration/definitions/definition-loader.js';
import { InMemoryDefinitionRepository } from '../../src/modules/configuration/persistence/in-memory-definition.repository.js';
import { DefinitionReleaseService } from '../../src/modules/configuration/service/definition-release.service.js';
import { InMemoryQueueProjectionRepository } from '../../src/modules/queue/persistence/in-memory-queue-projection.repository.js';
import { InMemoryBulkOperationRepository } from '../../src/modules/bulk/persistence/in-memory-bulk-operation.repository.js';
import { BulkActionService } from '../../src/modules/bulk/service/bulk-action.service.js';
import { QueueService } from '../../src/modules/queue/service/queue.service.js';
import { AdminAuditService } from '../../src/modules/admin-audit/service/admin-audit.service.js';
import { InMemoryFeatureFlagRepository } from '../../src/modules/feature-flags/persistence/in-memory-feature-flag.repository.js';
import { FeatureFlagService } from '../../src/modules/feature-flags/service/feature-flag.service.js';
import { SearchService } from '../../src/modules/search/service/search.service.js';
import { InMemoryTrackingRepository } from '../../src/modules/tracking/persistence/in-memory-tracking.repository.js';
import { TrackingService } from '../../src/modules/tracking/service/tracking.service.js';
import { InMemoryWorkflowInstanceRepository } from '../../src/modules/workflow/persistence/in-memory-workflow-instance.repository.js';
import { WorkflowInstanceService } from '../../src/modules/workflow/service/workflow-instance.service.js';
import { configureLogger } from '../../src/platform/logging/logger.js';
import { InMemoryIdempotencyRepository } from '../../src/platform/idempotency/in-memory-idempotency.repository.js';
import { InMemoryAuditEventRepository } from '../../src/platform/audit/in-memory-audit-event.repository.js';
import { InMemoryOutboxDeliveryRepository } from '../../src/platform/outbox/in-memory-outbox-delivery.repository.js';
import { InMemoryOutboxRepository } from '../../src/platform/outbox/in-memory-outbox.repository.js';
import { OutboxPipeline } from '../../src/platform/outbox/outbox.pipeline.js';
import {
  AuthenticatedActorAuthorization,
  type AuthorizationPort
} from '../../src/platform/security/authorization-port.js';
import { InMemorySplunkEventRepository } from '../../src/platform/splunk/in-memory-splunk-event.repository.js';

export const testConfig: AppConfig = {
  nodeEnv: 'test',
  port: 0,
  authMode: 'dev',
  serviceName: 'api-server',
  serviceVersion: '0.1.0',
  logLevel: 'error',
  includeStackTraces: false,
  definitionExportDir: '/tmp/optic-definition-export-test',
  featureAdmin: {
    uiEnabled: true,
    apiEnabled: true
  },
  scheduler: {
    enabled: false,
    pollIntervalMs: 10_000,
    batchSize: 10,
    leaseMs: 30_000,
    backoffBaseMs: 50,
    defaultMaxAttempts: 5,
    workerId: 'test-scheduler'
  },
  outboxPublisher: {
    enabled: false,
    pollIntervalMs: 10_000,
    batchSize: 25,
    leaseMs: 30_000,
    backoffBaseMs: 50,
    defaultMaxAttempts: 5,
    workerId: 'test-outbox'
  },
  database: {
    host: '127.0.0.1',
    port: 3306,
    user: 'optic',
    password: 'optic',
    database: 'optic_nextgen_test'
  }
};

export function createTestRuntime(
  options: {
    authorization?: AuthorizationPort;
    featureAdmin?: AppConfig['featureAdmin'];
  } = {}
) {
  configureLogger({
    service: testConfig.serviceName,
    serviceVersion: testConfig.serviceVersion,
    environment: 'test',
    minLevel: 'error',
    includeStackTraces: false
  });
  const config: AppConfig = {
    ...testConfig,
    featureAdmin: options.featureAdmin ?? testConfig.featureAdmin
  };
  const repository = new InMemoryDefinitionRepository();
  const outbox = new InMemoryOutboxRepository();
  const authorization = options.authorization ?? new AuthenticatedActorAuthorization();
  const loader = new DefinitionLoader(repository);
  const instances = new InMemoryWorkflowInstanceRepository();
  const idempotency = new InMemoryIdempotencyRepository();
  const projections = new InMemoryQueueProjectionRepository();
  const service = new DefinitionReleaseService(repository, authorization, async (work) => work(), outbox, {
    loader,
    exportDir: config.definitionExportDir,
    scrubReleaseForLive: async (releaseId) => {
      await instances.markRehearsalByReleaseId(releaseId);
      await projections.deleteByReleaseId(releaseId);
    }
  });
  const workflow = new WorkflowInstanceService(
    instances,
    repository,
    loader,
    authorization,
    async (work) => work(),
    outbox,
    projections,
    idempotency
  );
  const queues = new QueueService(repository, loader, projections, workflow, authorization);
  const search = new SearchService(projections, loader, authorization, instances);
  const tracking = new TrackingService(new InMemoryTrackingRepository(), authorization);
  const bulkOperations = new InMemoryBulkOperationRepository();
  const bulk = new BulkActionService(
    workflow,
    loader,
    bulkOperations,
    outbox,
    authorization,
    async (work) => work()
  );
  const featureFlags = new InMemoryFeatureFlagRepository();
  const features = new FeatureFlagService(
    featureFlags,
    authorization,
    async (work) => work(),
    outbox,
    {
      uiEnabled: config.featureAdmin.uiEnabled,
      apiEnabled: config.featureAdmin.apiEnabled
    }
  );
  const deliveries = new InMemoryOutboxDeliveryRepository();
  const audit = new InMemoryAuditEventRepository();
  const adminAudit = new AdminAuditService(audit, authorization, {
    uiEnabled: config.featureAdmin.uiEnabled,
    apiEnabled: config.featureAdmin.apiEnabled
  });
  const splunk = new InMemorySplunkEventRepository();
  const pipeline = new OutboxPipeline(outbox, deliveries, audit, splunk, config.outboxPublisher);
  const app = createApp(
    config,
    service,
    loader,
    workflow,
    idempotency,
    queues,
    outbox,
    bulk,
    search,
    tracking,
    features,
    adminAudit
  );
  return {
    app,
    repository,
    service,
    outbox,
    loader,
    workflow,
    instances,
    idempotency,
    projections,
    queues,
    search,
    tracking,
    bulk,
    bulkOperations,
    features,
    featureFlags,
    adminAudit,
    deliveries,
    audit,
    splunk,
    pipeline
  };
}

export const authHeaders = {
  Authorization: 'Bearer dev-token',
  'X-Actor-Id': 'configurator@example.gov'
};
