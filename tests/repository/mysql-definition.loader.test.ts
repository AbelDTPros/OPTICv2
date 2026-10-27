import { randomUUID } from 'node:crypto';
import { createConnection, createPool, type Connection, type Pool } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DefinitionLoader } from '../../src/modules/configuration/definitions/definition-loader.js';
import { MysqlDefinitionRepository } from '../../src/modules/configuration/persistence/mysql-definition.repository.js';
import { DefinitionReleaseService } from '../../src/modules/configuration/service/definition-release.service.js';
import { withTransaction } from '../../src/platform/db/transaction.js';
import { MysqlOutboxRepository } from '../../src/platform/outbox/mysql-outbox.repository.js';
import { AuthenticatedActorAuthorization } from '../../src/platform/security/authorization-port.js';
import { linearRelease } from '../fixtures/definitions/linear.js';
import { applyMigrationsToConnection } from '../helpers/migrate-test-db.js';

const testUrl = process.env.TEST_DATABASE_URL;
const describeIfMysql = testUrl ? describe : describe.skip;

const actor = {
  actorId: 'loader-mysql@example.gov',
  roles: ['CONFIGURATOR'],
  correlationId: 'c-mysql-loader'
};

describeIfMysql('DefinitionLoader against MySQL', () => {
  let admin: Connection;
  let pool: Pool;
  let repository: MysqlDefinitionRepository;
  let service: DefinitionReleaseService;
  const databaseName = `optic_slice2_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

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
    repository = new MysqlDefinitionRepository(pool);
    service = new DefinitionReleaseService(
      repository,
      new AuthenticatedActorAuthorization(),
      (work) => withTransaction(pool, (connection) => work(connection)),
      new MysqlOutboxRepository(pool)
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

  it('assembles, compiles, and caches a persisted linear release', async () => {
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

    const draftLoader = new DefinitionLoader(repository);
    const fromDraft = await draftLoader.loadByReleaseId(draft.id);
    expect(fromDraft.schema.compiled).toBe(true);
    expect(fromDraft.release.workflow.initialStageKey).toBe('READY_FOR_DATA_ENTRY');
    expect(draftLoader.getCache().size()).toBe(0);

    await pool.execute(`UPDATE definition_release SET lifecycle_status = 'PUBLISHED' WHERE id = ?`, [draft.id]);

    const loader = new DefinitionLoader(repository);
    const byKey = await loader.loadByKeyVersion('I_90', '1.0.0');
    const byId = await loader.loadByReleaseId(draft.id);
    expect(byKey.lifecycleStatus).toBe('PUBLISHED');
    expect(byKey.schema.compiled).toBe(true);
    expect(byKey.release.workflow.transitionSets[0]?.defaultTargetStageKey).toBe('COMPLETED');
    expect(byId.releaseId).toBe(String(draft.id));
    expect(loader.getCache().peekByReleaseId(String(draft.id))).toBeDefined();
    expect(loader.getCache().size()).toBe(1);
    expect(byKey).toBe(byId);
  });
});
