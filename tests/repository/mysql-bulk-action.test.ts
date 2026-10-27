import { randomUUID } from 'node:crypto';
import { createConnection, createPool, type Connection, type Pool } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MysqlBulkOperationRepository } from '../../src/modules/bulk/persistence/mysql-bulk-operation.repository.js';
import { BulkActionService } from '../../src/modules/bulk/service/bulk-action.service.js';
import { DefinitionLoader } from '../../src/modules/configuration/definitions/definition-loader.js';
import { MysqlDefinitionRepository } from '../../src/modules/configuration/persistence/mysql-definition.repository.js';
import { DefinitionReleaseService } from '../../src/modules/configuration/service/definition-release.service.js';
import { MysqlQueueProjectionRepository } from '../../src/modules/queue/persistence/mysql-queue-projection.repository.js';
import { MysqlWorkflowInstanceRepository } from '../../src/modules/workflow/persistence/mysql-workflow-instance.repository.js';
import { WorkflowInstanceService } from '../../src/modules/workflow/service/workflow-instance.service.js';
import { withTransaction } from '../../src/platform/db/transaction.js';
import { MysqlIdempotencyRepository } from '../../src/platform/idempotency/mysql-idempotency.repository.js';
import { MysqlOutboxRepository } from '../../src/platform/outbox/mysql-outbox.repository.js';
import { AuthenticatedActorAuthorization } from '../../src/platform/security/authorization-port.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import { bulkRelease } from '../fixtures/definitions/bulk.js';
import { applyMigrationsToConnection } from '../helpers/migrate-test-db.js';

const testUrl = process.env.TEST_DATABASE_URL;
const describeIfMysql = testUrl ? describe : describe.skip;

const actor = {
  actorId: 'officer@example.gov',
  roles: ['OFFICER'],
  correlationId: 'c-mysql-bulk'
};

describeIfMysql('BulkActionService against MySQL', () => {
  let admin: Connection;
  let pool: Pool;
  let workflow: WorkflowInstanceService;
  let bulk: BulkActionService;
  const databaseName = `optic_slice13_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

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
    const runInTransaction = <T>(
      work: (executor?: import('../../src/platform/db/types.js').QueryExecutor) => Promise<T>
    ) => withTransaction(pool, (connection) => work(connection));
    const service = new DefinitionReleaseService(definitions, authorization, runInTransaction, outbox);
    const loader = new DefinitionLoader(definitions);
    workflow = new WorkflowInstanceService(
      new MysqlWorkflowInstanceRepository(pool),
      definitions,
      loader,
      authorization,
      runInTransaction,
      outbox,
      new MysqlQueueProjectionRepository(pool),
      new MysqlIdempotencyRepository(pool)
    );
    bulk = new BulkActionService(
      workflow,
      loader,
      new MysqlBulkOperationRepository(pool),
      outbox,
      authorization,
      runInTransaction
    );

    await service.createDefinition(actor, {
      definitionKey: 'I_131_BULK',
      displayName: 'I-131 Bulk Shipping',
      entityType: 'WORKLOAD'
    });
    const draft = await service.createDraftRelease(actor, { definitionKey: 'I_131_BULK', version: '1.0.0' });
    let rowVersion = 0;
    await service.saveSchema(actor, {
      definitionKey: 'I_131_BULK',
      version: '1.0.0',
      expectedRowVersion: rowVersion++,
      payload: bulkRelease.schema
    });
    await service.saveWorkflow(actor, {
      definitionKey: 'I_131_BULK',
      version: '1.0.0',
      expectedRowVersion: rowVersion++,
      payload: bulkRelease.workflow
    });
    for (const form of Object.values(bulkRelease.forms)) {
      await service.saveForm(actor, {
        definitionKey: 'I_131_BULK',
        version: '1.0.0',
        expectedRowVersion: rowVersion++,
        payload: form
      });
    }
    for (const queue of Object.values(bulkRelease.queues)) {
      await service.saveQueue(actor, {
        definitionKey: 'I_131_BULK',
        version: '1.0.0',
        expectedRowVersion: rowVersion++,
        payload: queue
      });
    }
    for (const action of Object.values(bulkRelease.bulkActions)) {
      await service.saveBulkAction(actor, {
        definitionKey: 'I_131_BULK',
        version: '1.0.0',
        expectedRowVersion: rowVersion++,
        payload: action
      });
    }
    await pool.execute(`UPDATE definition_release SET lifecycle_status = 'PUBLISHED' WHERE id = ?`, [draft.id]);
    await pool.execute(`UPDATE definition SET active_release_id = ? WHERE definition_key = 'I_131_BULK'`, [
      draft.id
    ]);
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

  it('ATOMIC rolls back every item when one item fails', async () => {
    const first = await workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-MYSQL-ATOMIC-1',
      definitionKey: 'I_131_BULK'
    });
    const second = await workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-MYSQL-ATOMIC-2',
      definitionKey: 'I_131_BULK'
    });

    try {
      await bulk.execute(actor, {
        bulkActionKey: 'BULK_SHIP_ATOMIC',
        items: [
          {
            entityType: 'WORKLOAD',
            trackingId: 'W-MYSQL-ATOMIC-1',
            expectedRowVersion: first.workflow.rowVersion
          },
          {
            entityType: 'WORKLOAD',
            trackingId: 'W-MYSQL-ATOMIC-2',
            expectedRowVersion: second.workflow.rowVersion + 9
          }
        ],
        input: { shipDate: '2026-08-23' }
      });
      throw new Error('expected ATOMIC bulk to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).errorCode).toBe('OPTIC-WF-40901');
    }

    const firstAfter = await workflow.getSummary(actor, 'WORKLOAD', 'W-MYSQL-ATOMIC-1');
    const secondAfter = await workflow.getSummary(actor, 'WORKLOAD', 'W-MYSQL-ATOMIC-2');
    expect(firstAfter.workflow.currentStageKey).toBe('READY_FOR_SHIPPING');
    expect(secondAfter.workflow.currentStageKey).toBe('READY_FOR_SHIPPING');

    const [rows] = await pool.query<Array<{ count: number }>>(
      'SELECT COUNT(*) AS count FROM bulk_operation WHERE bulk_action_key = ?',
      ['BULK_SHIP_ATOMIC']
    );
    expect(Number(rows[0]?.count ?? -1)).toBe(0);
  });
});
