import { randomUUID } from 'node:crypto';
import { createConnection, createPool, type Connection, type Pool, type ResultSetHeader } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MysqlDefinitionRepository } from '../../src/modules/configuration/persistence/mysql-definition.repository.js';
import { applyMigrationsToConnection } from '../helpers/migrate-test-db.js';

const testUrl = process.env.TEST_DATABASE_URL;
const describeIfMysql = testUrl ? describe : describe.skip;

describeIfMysql('MysqlDefinitionRepository', () => {
  let admin: Connection;
  let pool: Pool;
  let repository: MysqlDefinitionRepository;
  const databaseName = `optic_slice1_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

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

  it('enforces unique definition keys and release versions', async () => {
    const created = await repository.createDefinition({
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD',
      createdBy: 'tester@example.gov'
    });
    await expect(
      repository.createDefinition({
        definitionKey: 'I_407',
        displayName: 'I-407',
        entityType: 'WORKLOAD',
        createdBy: 'tester@example.gov'
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-CONFIG-40901' });

    const release = await repository.createRelease({
      definitionId: created.id,
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD',
      version: '0.1.0',
      manifest: { apiVersion: 'optic.uscis/v1' },
      createdBy: 'tester@example.gov'
    });
    expect(release.lifecycleStatus).toBe('DRAFT');

    await repository.replaceChildren(release.id, 'stage', [
      {
        stableKey: 'DOCUMENT_PREP',
        config: { stageKey: 'DOCUMENT_PREP', displayName: 'Document Prep' }
      }
    ]);
    const stages = await repository.listChildren(release.id, 'stage');
    expect(stages).toHaveLength(1);
    expect(await repository.listReleaseCatalog()).toEqual([
      {
        definitionKey: 'I_407',
        displayName: 'I-407',
        entityType: 'WORKLOAD',
        version: '0.1.0',
        lifecycleStatus: 'DRAFT',
        active: false
      }
    ]);

    await expect(
      repository.updateReleaseManifest(release.id, 99, { changed: true })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-WF-40901' });
  });

  it('commits definition and outbox together and rolls both back on failure', async () => {
    const { withTransaction } = await import('../../src/platform/db/transaction.js');
    const { MysqlOutboxRepository } = await import('../../src/platform/outbox/mysql-outbox.repository.js');
    const outbox = new MysqlOutboxRepository(pool);

    await withTransaction(pool, async (connection) => {
      await repository.createDefinition(
        {
          definitionKey: 'I_131PIP',
          displayName: 'I-131PIP',
          entityType: 'WORKLOAD',
          createdBy: 'tester@example.gov'
        },
        connection
      );
      await outbox.append(
        {
          eventId: randomUUID(),
          aggregateType: 'DEFINITION',
          aggregateId: 'I_131PIP',
          eventType: 'CONFIG_CHANGED',
          correlationId: 'c-mysql-commit',
          actorId: 'tester@example.gov',
          payload: { eventType: 'CONFIG_CHANGED' }
        },
        connection
      );
    });

    expect(await repository.findDefinitionByKey('I_131PIP')).not.toBeNull();
    expect(await outbox.listByAggregate('DEFINITION', 'I_131PIP')).toHaveLength(1);

    await expect(
      withTransaction(pool, async (connection) => {
        await repository.createDefinition(
          {
            definitionKey: 'I_590',
            displayName: 'I-590',
            entityType: 'WORKLOAD',
            createdBy: 'tester@example.gov'
          },
          connection
        );
        await outbox.append(
          {
            eventId: randomUUID(),
            aggregateType: 'DEFINITION',
            aggregateId: 'I_590',
            eventType: 'CONFIG_CHANGED',
            correlationId: 'c-mysql-rollback',
            actorId: 'tester@example.gov',
            payload: { eventType: 'CONFIG_CHANGED' }
          },
          connection
        );
        throw new Error('force rollback');
      })
    ).rejects.toThrow('force rollback');

    expect(await repository.findDefinitionByKey('I_590')).toBeNull();
    expect(await outbox.listByAggregate('DEFINITION', 'I_590')).toHaveLength(0);
  });

  it('persists a published snapshot, checksum, and active release pointer', async () => {
    const created = await repository.createDefinition({
      definitionKey: 'I_90',
      displayName: 'I-90',
      entityType: 'WORKLOAD',
      createdBy: 'tester@example.gov'
    });
    const release = await repository.createRelease({
      definitionId: created.id,
      definitionKey: 'I_90',
      displayName: 'I-90',
      entityType: 'WORKLOAD',
      version: '1.0.0',
      manifest: { apiVersion: 'optic.uscis/v1', metadata: { status: 'DRAFT' } },
      createdBy: 'tester@example.gov'
    });
    const submitted = await repository.updateLifecycle({
      releaseId: release.id,
      expectedRowVersion: 0,
      expectedStatus: 'DRAFT',
      lifecycleStatus: 'IN_REVIEW',
      manifest: { apiVersion: 'optic.uscis/v1', metadata: { status: 'IN_REVIEW' } },
      submittedBy: 'author@example.gov'
    });
    const approved = await repository.updateLifecycle({
      releaseId: release.id,
      expectedRowVersion: submitted.rowVersion,
      expectedStatus: 'IN_REVIEW',
      lifecycleStatus: 'APPROVED',
      manifest: { apiVersion: 'optic.uscis/v1', metadata: { status: 'APPROVED' } },
      approvedBy: 'approver@example.gov'
    });
    const published = await repository.updateLifecycle({
      releaseId: release.id,
      expectedRowVersion: approved.rowVersion,
      expectedStatus: 'APPROVED',
      lifecycleStatus: 'PUBLISHED',
      manifest: { apiVersion: 'optic.uscis/v1', metadata: { status: 'PUBLISHED' } },
      publishedBy: 'publisher@example.gov',
      canonicalPackage: { kind: 'DefinitionRelease', metadata: { version: '1.0.0' } },
      checksum: 'abc123',
      checksumAlgorithm: 'SHA-256'
    });
    await repository.setActiveRelease(created.id, published.id);
    const reread = await repository.findReleaseById(published.id);
    const definition = await repository.findDefinitionByKey('I_90');
    expect(reread?.lifecycleStatus).toBe('PUBLISHED');
    expect(reread?.checksum).toBe('abc123');
    expect(reread?.canonicalPackage).toMatchObject({ kind: 'DefinitionRelease' });
    expect(reread?.publishedBy).toBe('publisher@example.gov');
    expect(definition?.activeReleaseId).toBe(published.id);
  });

  it('deletes a draft release and an empty definition', async () => {
    const created = await repository.createDefinition({
      definitionKey: 'I_DEL',
      displayName: 'Delete me',
      entityType: 'WORKLOAD',
      createdBy: 'tester@example.gov'
    });
    const release = await repository.createRelease({
      definitionId: created.id,
      definitionKey: 'I_DEL',
      displayName: 'Delete me',
      entityType: 'WORKLOAD',
      version: '0.1.0',
      manifest: { apiVersion: 'optic.uscis/v1' },
      createdBy: 'tester@example.gov'
    });
    await repository.replaceChildren(release.id, 'stage', [
      {
        stableKey: 'DOCUMENT_PREP',
        config: { stageKey: 'DOCUMENT_PREP', displayName: 'Document Prep' }
      }
    ]);
    expect(await repository.countReleasesForDefinition(created.id)).toBe(1);

    await repository.replaceChildren(release.id, 'stage', []);
    await repository.deleteRelease(release.id, release.rowVersion);
    expect(await repository.findReleaseById(release.id)).toBeNull();
    expect(await repository.countReleasesForDefinition(created.id)).toBe(0);

    await repository.deleteDefinition(created.id);
    expect(await repository.findDefinitionByKey('I_DEL')).toBeNull();
  });

  it('purges try cases so a draft with stage visits can be deleted', async () => {
    const created = await repository.createDefinition({
      definitionKey: 'I_936_MAIL_ITEM',
      displayName: 'I-936 Mail',
      entityType: 'MAIL',
      createdBy: 'tester@example.gov'
    });
    const release = await repository.createRelease({
      definitionId: created.id,
      definitionKey: 'I_936_MAIL_ITEM',
      displayName: 'I-936 Mail',
      entityType: 'MAIL',
      version: '0.1.0',
      manifest: { apiVersion: 'optic.uscis/v1' },
      createdBy: 'tester@example.gov'
    });
    await repository.replaceChildren(release.id, 'stage', [
      { stableKey: 'DOCUMENT_PREP', config: { stageKey: 'DOCUMENT_PREP', displayName: 'Document Prep' } }
    ]);
    const stages = await repository.listChildren(release.id, 'stage');
    const stageId = stages[0]?.id;
    expect(stageId).toBeDefined();
    const [inserted] = await pool.execute<ResultSetHeader>(
      `INSERT INTO workflow_instance
        (entity_type, entity_tracking_id, definition_release_id, current_stage_definition_id,
         current_stage_key, status, entered_stage_at, created_at, updated_at)
       VALUES ('MAIL', 'TRY-936', ?, ?, 'DOCUMENT_PREP', 'ACTIVE', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [release.id, stageId]
    );
    const instanceId = inserted.insertId;
    await pool.execute(
      `INSERT INTO workflow_stage_visit
        (workflow_instance_id, stage_definition_id, stage_key, visit_number, entered_at)
       VALUES (?, ?, 'DOCUMENT_PREP', 1, UTC_TIMESTAMP(6))`,
      [instanceId, stageId]
    );

    await repository.purgeRuntimeForRelease(release.id);
    await repository.replaceChildren(release.id, 'stage', []);
    await repository.deleteRelease(release.id, release.rowVersion);
    expect(await repository.findReleaseById(release.id)).toBeNull();
  });

  it('keeps stage ids when a draft workflow is saved again so try cases stay attached', async () => {
    const created = await repository.createDefinition({
      definitionKey: 'I_407_MAILITEM',
      displayName: 'I-407 Mail',
      entityType: 'MAIL',
      createdBy: 'tester@example.gov'
    });
    const release = await repository.createRelease({
      definitionId: created.id,
      definitionKey: 'I_407_MAILITEM',
      displayName: 'I-407 Mail',
      entityType: 'MAIL',
      version: '0.1.0',
      manifest: { apiVersion: 'optic.uscis/v1' },
      createdBy: 'tester@example.gov'
    });
    await repository.replaceChildren(release.id, 'stage', [
      { stableKey: 'NEW_MAIL_ITEM', config: { stageKey: 'NEW_MAIL_ITEM', displayName: 'New Mail Item' } }
    ]);
    const first = await repository.listChildren(release.id, 'stage');
    const stageId = first[0]?.id;
    expect(stageId).toBeDefined();
    const [inserted] = await pool.execute<ResultSetHeader>(
      `INSERT INTO workflow_instance
        (entity_type, entity_tracking_id, definition_release_id, current_stage_definition_id,
         current_stage_key, status, entered_stage_at, created_at, updated_at)
       VALUES ('MAIL', 'TRY-407', ?, ?, 'NEW_MAIL_ITEM', 'ACTIVE', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [release.id, stageId]
    );
    await pool.execute(
      `INSERT INTO workflow_stage_visit
        (workflow_instance_id, stage_definition_id, stage_key, visit_number, entered_at)
       VALUES (?, ?, 'NEW_MAIL_ITEM', 1, UTC_TIMESTAMP(6))`,
      [inserted.insertId, stageId]
    );

    await repository.replaceChildren(release.id, 'stage', [
      {
        stableKey: 'NEW_MAIL_ITEM',
        config: { stageKey: 'NEW_MAIL_ITEM', displayName: 'New Mail Item', queueKey: 'NEW_MAIL_ITEM' }
      }
    ]);
    const second = await repository.listChildren(release.id, 'stage');
    expect(second[0]?.id).toBe(stageId);
    expect(second[0]?.config).toMatchObject({ queueKey: 'NEW_MAIL_ITEM' });
  });
});
