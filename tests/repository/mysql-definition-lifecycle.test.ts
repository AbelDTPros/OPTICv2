import { randomUUID } from 'node:crypto';
import { createConnection, createPool, type Connection, type Pool } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DefinitionLoader } from '../../src/modules/configuration/definitions/definition-loader.js';
import { MysqlDefinitionRepository } from '../../src/modules/configuration/persistence/mysql-definition.repository.js';
import { DefinitionReleaseService } from '../../src/modules/configuration/service/definition-release.service.js';
import { withTransaction } from '../../src/platform/db/transaction.js';
import { MysqlOutboxRepository } from '../../src/platform/outbox/mysql-outbox.repository.js';
import { AuthenticatedActorAuthorization } from '../../src/platform/security/authorization-port.js';
import { authorLinearDraft } from '../helpers/author-linear.js';
import { applyMigrationsToConnection } from '../helpers/migrate-test-db.js';

const testUrl = process.env.TEST_DATABASE_URL;
const describeIfMysql = testUrl ? describe : describe.skip;

const author = { actorId: 'author@example.gov', roles: ['CONFIGURATOR'], correlationId: 'c-mysql-author' };
const approver = { actorId: 'approver@example.gov', roles: ['APPROVER'], correlationId: 'c-mysql-approver' };

describeIfMysql('DefinitionReleaseService lifecycle against MySQL', () => {
  let admin: Connection;
  let pool: Pool;
  let service: DefinitionReleaseService;
  const databaseName = `optic_slice9_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

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
    const repository = new MysqlDefinitionRepository(pool);
    const outbox = new MysqlOutboxRepository(pool);
    const authorization = new AuthenticatedActorAuthorization();
    const runInTransaction = <T>(work: (executor?: import('../../src/platform/db/types.js').QueryExecutor) => Promise<T>) =>
      withTransaction(pool, (connection) => work(connection));
    const loader = new DefinitionLoader(repository);
    service = new DefinitionReleaseService(repository, authorization, runInTransaction, outbox, { loader });
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

  it('lets exactly one of two simultaneous publishes succeed', async () => {
    const drafted = await authorLinearDraft(service, author);
    const submitted = await service.submit(author, {
      definitionKey: 'I_90',
      version: '1.0.0',
      expectedRowVersion: drafted.rowVersion
    });
    const approved = await service.approve(approver, {
      definitionKey: 'I_90',
      version: '1.0.0',
      expectedRowVersion: submitted.rowVersion
    });
    const command = {
      definitionKey: 'I_90',
      version: '1.0.0',
      expectedRowVersion: approved.rowVersion
    };
    const publisherA = { ...author, actorId: 'publisher-a@example.gov', correlationId: 'c-pub-a' };
    const publisherB = { ...author, actorId: 'publisher-b@example.gov', correlationId: 'c-pub-b' };

    const outcomes = await Promise.allSettled([
      service.publish(publisherA, command),
      service.publish(publisherB, command)
    ]);
    const succeeded = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const failed = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      status: 'rejected',
      reason: { errorCode: 'OPTIC-WF-40901' }
    });
    const winner = succeeded[0];
    expect(winner?.status).toBe('fulfilled');
    if (winner?.status === 'fulfilled') {
      expect(winner.value.lifecycleStatus).toBe('PUBLISHED');
      expect(winner.value.checksum).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
