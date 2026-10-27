import { randomUUID } from 'node:crypto';
import { createConnection, createPool, type Connection, type Pool } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DefinitionLoader } from '../../src/modules/configuration/definitions/definition-loader.js';
import { MysqlDefinitionRepository } from '../../src/modules/configuration/persistence/mysql-definition.repository.js';
import { DefinitionReleaseService } from '../../src/modules/configuration/service/definition-release.service.js';
import { MysqlQueueProjectionRepository } from '../../src/modules/queue/persistence/mysql-queue-projection.repository.js';
import { QueueService } from '../../src/modules/queue/service/queue.service.js';
import { MysqlWorkflowInstanceRepository } from '../../src/modules/workflow/persistence/mysql-workflow-instance.repository.js';
import { WorkflowInstanceService } from '../../src/modules/workflow/service/workflow-instance.service.js';
import { withTransaction } from '../../src/platform/db/transaction.js';
import { MysqlOutboxRepository } from '../../src/platform/outbox/mysql-outbox.repository.js';
import { AuthenticatedActorAuthorization } from '../../src/platform/security/authorization-port.js';
import { authorLinearDraft } from '../helpers/author-linear.js';
import { applyMigrationsToConnection } from '../helpers/migrate-test-db.js';

const testUrl = process.env.TEST_DATABASE_URL;
const describeIfMysql = testUrl ? describe : describe.skip;

const author = { actorId: 'author@example.gov', roles: ['CONFIGURATOR'], correlationId: 'c-mysql-q-author' };
const officer = { actorId: 'officer@example.gov', roles: ['OFFICER'], correlationId: 'c-mysql-q-officer' };

describeIfMysql('Queue projection against MySQL', () => {
  let admin: Connection;
  let pool: Pool;
  let workflow: WorkflowInstanceService;
  let queues: QueueService;
  const databaseName = `optic_slice10_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

  beforeAll(async () => {
    if (!testUrl) {
      return;
    }
    const url = new URL(testUrl);
    admin = await createConnection({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      multipleStatements: true
    });
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    await admin.changeUser({ database: databaseName });
    await applyMigrationsToConnection(admin);

    pool = createPool({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: databaseName
    });
    const definitions = new MysqlDefinitionRepository(pool);
    const outbox = new MysqlOutboxRepository(pool);
    const authorization = new AuthenticatedActorAuthorization();
    const runInTransaction = <T>(work: (executor?: import('../../src/platform/db/types.js').QueryExecutor) => Promise<T>) =>
      withTransaction(pool, (connection) => work(connection));
    const loader = new DefinitionLoader(definitions);
    const service = new DefinitionReleaseService(definitions, authorization, runInTransaction, outbox, { loader });
    const projections = new MysqlQueueProjectionRepository(pool);
    workflow = new WorkflowInstanceService(
      new MysqlWorkflowInstanceRepository(pool),
      definitions,
      loader,
      authorization,
      runInTransaction,
      outbox,
      projections
    );
    queues = new QueueService(definitions, loader, projections, workflow, authorization);

    const drafted = await authorLinearDraft(service, author);
    const submitted = await service.submit(author, {
      definitionKey: 'I_90',
      version: '1.0.0',
      expectedRowVersion: drafted.rowVersion
    });
    const approved = await service.approve(
      { actorId: 'approver@example.gov', roles: ['APPROVER'], correlationId: 'c-mysql-q-appr' },
      { definitionKey: 'I_90', version: '1.0.0', expectedRowVersion: submitted.rowVersion }
    );
    const published = await service.publish(
      { actorId: 'publisher@example.gov', roles: ['PUBLISHER'], correlationId: 'c-mysql-q-pub' },
      { definitionKey: 'I_90', version: '1.0.0', expectedRowVersion: approved.rowVersion }
    );
    await service.activate(
      { actorId: 'publisher@example.gov', roles: ['PUBLISHER'], correlationId: 'c-mysql-q-pub' },
      { definitionKey: 'I_90', version: '1.0.0', expectedRowVersion: published.rowVersion }
    );
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await admin.end();
    }
  });

  it('projects created instances and pages with equivalent count and row filters', async () => {
    const first = await workflow.createInstance(officer, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-MYSQL-Q1',
      definitionKey: 'I_90'
    });
    await workflow.createInstance(officer, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-MYSQL-Q2',
      definitionKey: 'I_90'
    });

    const listed = await queues.listQueues(officer);
    expect(listed.map((item) => item.queueKey)).toEqual([
      'READY_FOR_DATA_ENTRY',
      'COMPLETED',
      'ASSIGNED_TO_ME',
      'ALL_ITEMS'
    ]);

    const page = await queues.getQueuePage(officer, 'READY_FOR_DATA_ENTRY', {
      page: 1,
      pageSize: 10,
      sort: 'trackingId',
      direction: 'ASC'
    });
    expect(page.total).toBe(2);
    expect(page.rows).toHaveLength(2);
    expect(page.rows.map((row) => row.trackingId)).toEqual(['W-MYSQL-Q1', 'W-MYSQL-Q2']);

    await queues.assignFromQueue(officer, {
      queueKey: 'READY_FOR_DATA_ENTRY',
      entityType: 'WORKLOAD',
      trackingId: 'W-MYSQL-Q1',
      expectedRowVersion: first.workflow.rowVersion
    });

    const unassigned = await queues.getQueuePage(officer, 'READY_FOR_DATA_ENTRY', {
      filters: { assignedStatus: 'UNASSIGNED' }
    });
    expect(unassigned.total).toBe(1);
    expect(unassigned.rows[0]?.trackingId).toBe('W-MYSQL-Q2');
  });
});
