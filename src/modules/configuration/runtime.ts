import type { AppConfig } from '../../config/env.js';
import { getPool } from '../../platform/db/pool.js';
import type { QueryExecutor } from '../../platform/db/types.js';
import { withTransaction } from '../../platform/db/transaction.js';
import { MysqlAuditEventRepository } from '../../platform/audit/mysql-audit-event.repository.js';
import { AuthenticatedActorAuthorization } from '../../platform/security/authorization-port.js';
import { MysqlIdempotencyRepository } from '../../platform/idempotency/mysql-idempotency.repository.js';
import { MysqlOutboxDeliveryRepository } from '../../platform/outbox/mysql-outbox-delivery.repository.js';
import { MysqlOutboxRepository } from '../../platform/outbox/mysql-outbox.repository.js';
import { OutboxPipeline } from '../../platform/outbox/outbox.pipeline.js';
import { MysqlSplunkEventRepository } from '../../platform/splunk/mysql-splunk-event.repository.js';
import { MysqlBulkOperationRepository } from '../bulk/persistence/mysql-bulk-operation.repository.js';
import { BulkActionService } from '../bulk/service/bulk-action.service.js';
import { AdminAuditService } from '../admin-audit/service/admin-audit.service.js';
import { MysqlFeatureFlagRepository } from '../feature-flags/persistence/mysql-feature-flag.repository.js';
import { FeatureFlagService } from '../feature-flags/service/feature-flag.service.js';
import { MysqlQueueProjectionRepository } from '../queue/persistence/mysql-queue-projection.repository.js';
import { QueueService } from '../queue/service/queue.service.js';
import { SearchService } from '../search/service/search.service.js';
import { SupervisorDashboardService } from '../supervisor/service/supervisor-dashboard.service.js';
import { MysqlTrackingRepository } from '../tracking/persistence/mysql-tracking.repository.js';
import { TrackingService } from '../tracking/service/tracking.service.js';
import { MysqlWorkflowInstanceRepository } from '../workflow/persistence/mysql-workflow-instance.repository.js';
import { WorkflowInstanceService } from '../workflow/service/workflow-instance.service.js';
import { DefinitionLoader } from './definitions/definition-loader.js';
import { MysqlDefinitionRepository } from './persistence/mysql-definition.repository.js';
import { DefinitionReleaseService } from './service/definition-release.service.js';

export function createConfigurationRuntime(config: AppConfig): {
  service: DefinitionReleaseService;
  loader: DefinitionLoader;
  workflow: WorkflowInstanceService;
  idempotency: MysqlIdempotencyRepository;
  queues: QueueService;
  search: SearchService;
  tracking: TrackingService;
  bulk: BulkActionService;
  features: FeatureFlagService;
  adminAudit: AdminAuditService;
  supervisor: SupervisorDashboardService;
  pipeline: OutboxPipeline;
  outbox: MysqlOutboxRepository;
} {
  const pool = getPool(config.database);
  const repository = new MysqlDefinitionRepository(pool);
  const outbox = new MysqlOutboxRepository(pool);
  const deliveries = new MysqlOutboxDeliveryRepository(pool);
  const audit = new MysqlAuditEventRepository(pool);
  const splunk = new MysqlSplunkEventRepository(pool);
  const authorization = new AuthenticatedActorAuthorization();
  const runInTransaction = <T>(work: (executor?: QueryExecutor) => Promise<T>): Promise<T> =>
    withTransaction(pool, (connection) => work(connection));
  const loader = new DefinitionLoader(repository);
  const projections = new MysqlQueueProjectionRepository(pool);
  const idempotency = new MysqlIdempotencyRepository(pool);
  const instances = new MysqlWorkflowInstanceRepository(pool);
  const service = new DefinitionReleaseService(repository, authorization, runInTransaction, outbox, {
    loader,
    exportDir: config.definitionExportDir,
    scrubReleaseForLive: async (releaseId, executor) => {
      await instances.markRehearsalByReleaseId(releaseId, executor);
      await projections.deleteByReleaseId(releaseId, executor);
    }
  });
  const workflow = new WorkflowInstanceService(
    instances,
    repository,
    loader,
    authorization,
    runInTransaction,
    outbox,
    projections,
    idempotency
  );
  const queues = new QueueService(repository, loader, projections, workflow, authorization);
  const search = new SearchService(projections, loader, authorization, instances);
  const tracking = new TrackingService(new MysqlTrackingRepository(pool), authorization);
  const bulk = new BulkActionService(
    workflow,
    loader,
    new MysqlBulkOperationRepository(pool),
    outbox,
    authorization,
    runInTransaction
  );
  const features = new FeatureFlagService(
    new MysqlFeatureFlagRepository(pool),
    authorization,
    runInTransaction,
    outbox,
    {
      uiEnabled: config.featureAdmin.uiEnabled,
      apiEnabled: config.featureAdmin.apiEnabled
    }
  );
  const adminAudit = new AdminAuditService(audit, authorization, {
    uiEnabled: config.featureAdmin.uiEnabled,
    apiEnabled: config.featureAdmin.apiEnabled
  });
  const supervisor = new SupervisorDashboardService(
    projections,
    audit,
    repository,
    loader,
    authorization
  );
  const pipeline = new OutboxPipeline(outbox, deliveries, audit, splunk, config.outboxPublisher);
  return {
    service,
    loader,
    workflow,
    idempotency,
    queues,
    search,
    tracking,
    bulk,
    features,
    adminAudit,
    supervisor,
    pipeline,
    outbox
  };
}
