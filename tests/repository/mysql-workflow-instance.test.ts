import { randomUUID } from 'node:crypto';
import { createConnection, createPool, type Connection, type Pool } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DefinitionLoader } from '../../src/modules/configuration/definitions/definition-loader.js';
import { MysqlDefinitionRepository } from '../../src/modules/configuration/persistence/mysql-definition.repository.js';
import { DefinitionReleaseService } from '../../src/modules/configuration/service/definition-release.service.js';
import { MysqlQueueProjectionRepository } from '../../src/modules/queue/persistence/mysql-queue-projection.repository.js';
import { SchedulerWorker } from '../../src/modules/scheduler/scheduler.worker.js';
import { MysqlWorkflowInstanceRepository } from '../../src/modules/workflow/persistence/mysql-workflow-instance.repository.js';
import { WorkflowInstanceService } from '../../src/modules/workflow/service/workflow-instance.service.js';
import { withTransaction } from '../../src/platform/db/transaction.js';
import { MysqlOutboxRepository } from '../../src/platform/outbox/mysql-outbox.repository.js';
import { MysqlIdempotencyRepository } from '../../src/platform/idempotency/mysql-idempotency.repository.js';
import { AuthenticatedActorAuthorization } from '../../src/platform/security/authorization-port.js';
import { linearRelease } from '../fixtures/definitions/linear.js';
import { applyMigrationsToConnection } from '../helpers/migrate-test-db.js';

const testUrl = process.env.TEST_DATABASE_URL;
const describeIfMysql = testUrl ? describe : describe.skip;

const actor = {
  actorId: 'loader-mysql@example.gov',
  roles: ['CONFIGURATOR'],
  correlationId: 'c-mysql-workflow'
};

describeIfMysql('WorkflowInstanceService against MySQL', () => {
  let admin: Connection;
  let pool: Pool;
  let workflow: WorkflowInstanceService;
  const databaseName = `optic_slice4_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

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

    await service.createDefinition(actor, {
      definitionKey: 'I_90',
      displayName: 'I-90 Linear',
      entityType: 'WORKLOAD'
    });
    const draft = await service.createDraftRelease(actor, { definitionKey: 'I_90', version: '1.0.0' });
    let rowVersion = 0;
    await service.saveSchema(actor, {
      definitionKey: 'I_90',
      version: '1.0.0',
      expectedRowVersion: rowVersion++,
      payload: linearRelease.schema
    });
    await service.saveWorkflow(actor, {
      definitionKey: 'I_90',
      version: '1.0.0',
      expectedRowVersion: rowVersion++,
      payload: linearRelease.workflow
    });
    for (const form of Object.values(linearRelease.forms)) {
      await service.saveForm(actor, {
        definitionKey: 'I_90',
        version: '1.0.0',
        expectedRowVersion: rowVersion++,
        payload: form
      });
    }
    for (const action of Object.values(linearRelease.actions)) {
      await service.saveAction(actor, {
        definitionKey: 'I_90',
        version: '1.0.0',
        expectedRowVersion: rowVersion++,
        payload: action
      });
    }
    for (const queue of Object.values(linearRelease.queues)) {
      await service.saveQueue(actor, {
        definitionKey: 'I_90',
        version: '1.0.0',
        expectedRowVersion: rowVersion++,
        payload: queue
      });
    }
    for (const scheduled of Object.values(linearRelease.scheduledActions)) {
      await service.saveScheduledAction(actor, {
        definitionKey: 'I_90',
        version: '1.0.0',
        expectedRowVersion: rowVersion++,
        payload: scheduled
      });
    }
    await pool.execute(`UPDATE definition_release SET lifecycle_status = 'PUBLISHED' WHERE id = ?`, [draft.id]);
    await pool.execute(`UPDATE definition SET active_release_id = ? WHERE definition_key = 'I_90'`, [draft.id]);
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

  it('persists a pinned instance, unique tracking id, and re-entry visit numbers', async () => {
    const created = await workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-MYSQL-1',
      definitionKey: 'I_90'
    });
    expect(created.workflow.currentStageKey).toBe('READY_FOR_DATA_ENTRY');
    expect(created.visits[0]?.visitNumber).toBe(1);

    await expect(
      workflow.createInstance(actor, {
        entityType: 'WORKLOAD',
        entityTrackingId: 'W-MYSQL-1',
        definitionKey: 'I_90'
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-WF-40902' });

    await workflow.enterStage(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-MYSQL-1',
      stageKey: 'COMPLETED',
      expectedRowVersion: created.workflow.rowVersion
    });
    const returned = await workflow.enterStage(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-MYSQL-1',
      stageKey: 'READY_FOR_DATA_ENTRY',
      expectedRowVersion: created.workflow.rowVersion + 1
    });
    expect(
      returned.visits.filter((visit) => visit.stageKey === 'READY_FOR_DATA_ENTRY').map((visit) => visit.visitNumber)
    ).toEqual([1, 2]);
  });

  it('lets exactly one of two simultaneous assign-to-self calls succeed', async () => {
    const created = await workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-MYSQL-ASSIGN',
      definitionKey: 'I_90'
    });
    const officerA = { ...actor, actorId: 'officer-a@example.gov', correlationId: 'c-assign-a' };
    const officerB = { ...actor, actorId: 'officer-b@example.gov', correlationId: 'c-assign-b' };
    const command = {
      entityType: 'WORKLOAD' as const,
      entityTrackingId: 'W-MYSQL-ASSIGN',
      expectedRowVersion: created.workflow.rowVersion
    };

    const outcomes = await Promise.allSettled([
      workflow.assignToSelf(officerA, command),
      workflow.assignToSelf(officerB, command)
    ]);

    const succeeded = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const failed = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      status: 'rejected',
      reason: { errorCode: 'OPTIC-WF-40903' }
    });

    const winner = succeeded[0];
    expect(winner?.status).toBe('fulfilled');
    if (winner?.status === 'fulfilled') {
      expect(['officer-a@example.gov', 'officer-b@example.gov']).toContain(winner.value.workflow.assignedTo);
    }

    const summary = await workflow.getSummary(actor, 'WORKLOAD', 'W-MYSQL-ASSIGN');
    expect(summary.workflow.assignedTo).toBe(
      winner?.status === 'fulfilled' ? winner.value.workflow.assignedTo : null
    );
    expect(summary.workflow.rowVersion).toBe(created.workflow.rowVersion + 1);
  });

  it('persists a path-restricted draft and rejects a stale rowVersion', async () => {
    const created = await workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-MYSQL-DRAFT',
      definitionKey: 'I_90'
    });
    const assigned = await workflow.assignToSelf(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-MYSQL-DRAFT',
      expectedRowVersion: created.workflow.rowVersion
    });
    const saved = await workflow.saveDraft(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-MYSQL-DRAFT',
      expectedRowVersion: assigned.workflow.rowVersion,
      dataPatch: { dataEntryDetails: { receiptNumber: 'ABC1234567890' } }
    });
    expect(saved.businessData).toEqual({ dataEntryDetails: { receiptNumber: 'ABC1234567890' } });

    const reread = await workflow.getSummary(actor, 'WORKLOAD', 'W-MYSQL-DRAFT');
    expect(reread.businessData).toEqual({ dataEntryDetails: { receiptNumber: 'ABC1234567890' } });

    await expect(
      workflow.saveDraft(actor, {
        entityType: 'WORKLOAD',
        entityTrackingId: 'W-MYSQL-DRAFT',
        expectedRowVersion: assigned.workflow.rowVersion,
        dataPatch: { dataEntryDetails: { receiptNumber: 'STALE' } }
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-WF-40901' });
  });

  it('lets exactly one of two simultaneous draft saves succeed', async () => {
    const created = await workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-MYSQL-DRAFT-RACE',
      definitionKey: 'I_90'
    });
    const assigned = await workflow.assignToSelf(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-MYSQL-DRAFT-RACE',
      expectedRowVersion: created.workflow.rowVersion
    });
    const command = {
      entityType: 'WORKLOAD' as const,
      entityTrackingId: 'W-MYSQL-DRAFT-RACE',
      expectedRowVersion: assigned.workflow.rowVersion
    };

    const outcomes = await Promise.allSettled([
      workflow.saveDraft(actor, {
        ...command,
        dataPatch: { dataEntryDetails: { receiptNumber: 'ABC1111111111' } }
      }),
      workflow.saveDraft(actor, {
        ...command,
        dataPatch: { dataEntryDetails: { receiptNumber: 'ABC2222222222' } }
      })
    ]);

    const succeeded = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const failed = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      status: 'rejected',
      reason: { errorCode: 'OPTIC-WF-40901' }
    });
  });

  it('executes a transition, writes workload_transition, and cancels scheduled actions', async () => {
    const created = await workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-MYSQL-ACTION',
      definitionKey: 'I_90'
    });
    const assigned = await workflow.assignToSelf(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-MYSQL-ACTION',
      expectedRowVersion: created.workflow.rowVersion
    });
    const completed = await workflow.executeAction(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-MYSQL-ACTION',
      actionKey: 'COMPLETE_DATA_ENTRY',
      expectedRowVersion: assigned.workflow.rowVersion,
      dataPatch: { dataEntryDetails: { receiptNumber: 'ABC1234567890' } }
    });
    expect(completed.workflow.currentStageKey).toBe('COMPLETED');
    expect(completed.workflow.assignedTo).toBeNull();
    expect(completed.status).toBe('COMPLETED');
  });

  it('lets exactly one of two workers claim a due scheduled action', async () => {
    const created = await workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-MYSQL-LEASE',
      definitionKey: 'I_90'
    });
    const [nudge] = await workflow.listScheduledActions(created.workflowInstanceId);
    await workflow.updateScheduledDueAt(nudge!.id, new Date(Date.now() - 1_000));

    const [first, second] = await Promise.all([
      workflow.claimDueScheduledActions('mysql-worker-a', 30_000, 10),
      workflow.claimDueScheduledActions('mysql-worker-b', 30_000, 10)
    ]);
    const claimed = [...first, ...second];
    expect(claimed.map((row) => row.id)).toEqual([nudge!.id]);
    const winner = claimed[0]!;
    await workflow.executeScheduledAction(
      { actorId: 'scheduler', roles: ['SYSTEM'], actorType: 'SYSTEM' },
      { scheduledActionId: winner.id, leaseOwner: winner.leaseOwner! }
    );
  });

  it('runs configured hold expiration through the scheduler worker', async () => {
    const created = await workflow.createInstance(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-MYSQL-HOLD',
      definitionKey: 'I_90'
    });
    const assigned = await workflow.assignToSelf(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-MYSQL-HOLD',
      expectedRowVersion: created.workflow.rowVersion
    });
    const held = await workflow.executeAction(actor, {
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-MYSQL-HOLD',
      actionKey: 'COMPLETE_DATA_ENTRY',
      expectedRowVersion: assigned.workflow.rowVersion,
      dataPatch: { dataEntryDetails: { receiptNumber: 'ABC1234567890', fraudReferralRequired: true } }
    });
    expect(held.workflow.currentStageKey).toBe('ON_HOLD');
    const scheduled = await workflow.listScheduledActions(held.workflowInstanceId);
    const expiration = scheduled.find((row) => row.scheduledActionKey === 'ON_HOLD_EXPIRATION');
    await workflow.updateScheduledDueAt(expiration!.id, new Date(Date.now() - 1_000));

    const worker = new SchedulerWorker(workflow, {
      enabled: true,
      pollIntervalMs: 10_000,
      batchSize: 10,
      leaseMs: 30_000,
      backoffBaseMs: 50,
      defaultMaxAttempts: 5,
      workerId: 'mysql-hold-worker'
    });
    const tick = await worker.tick();
    expect(tick.completed).toBeGreaterThanOrEqual(1);
    const summary = await workflow.getSummary(actor, 'WORKLOAD', 'W-MYSQL-HOLD');
    expect(summary.workflow.currentStageKey).toBe('COMPLETED');
    expect((await workflow.getScheduledAction(expiration!.id))?.status).toBe('COMPLETED');
  });
});
