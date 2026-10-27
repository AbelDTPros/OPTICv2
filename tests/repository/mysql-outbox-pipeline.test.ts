import { randomUUID } from 'node:crypto';
import { createConnection, createPool, type Connection, type Pool } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restrictAuditEventPrivileges } from '../../src/platform/db/audit-privileges.js';
import { MysqlAuditEventRepository } from '../../src/platform/audit/mysql-audit-event.repository.js';
import { MysqlOutboxDeliveryRepository } from '../../src/platform/outbox/mysql-outbox-delivery.repository.js';
import { MysqlOutboxRepository } from '../../src/platform/outbox/mysql-outbox.repository.js';
import { OutboxPipeline } from '../../src/platform/outbox/outbox.pipeline.js';
import { toAuditChanges } from '../../src/platform/outbox/workflow-events.js';
import { DEFAULT_SPLUNK_MASK_POLICY } from '../../src/modules/configuration/domain/types.js';
import { MysqlSplunkEventRepository } from '../../src/platform/splunk/mysql-splunk-event.repository.js';
import { applyMigrationsToConnection } from '../helpers/migrate-test-db.js';

const testUrl = process.env.TEST_DATABASE_URL;
const describeIfMysql = testUrl ? describe : describe.skip;

function pipelineFor(
  outbox: MysqlOutboxRepository,
  deliveries: MysqlOutboxDeliveryRepository,
  audit: MysqlAuditEventRepository,
  splunk: MysqlSplunkEventRepository,
  workerId: string
): OutboxPipeline {
  return new OutboxPipeline(outbox, deliveries, audit, splunk, {
    enabled: true,
    pollIntervalMs: 10_000,
    batchSize: 25,
    leaseMs: 30_000,
    backoffBaseMs: 50,
    defaultMaxAttempts: 5,
    workerId
  });
}

async function appendFieldChanged(
  outbox: MysqlOutboxRepository,
  trackingId: string,
  correlationId: string
): Promise<string> {
  const eventId = randomUUID();
  await outbox.append({
    eventId,
    aggregateType: 'WORKFLOW_INSTANCE',
    aggregateId: `WORKLOAD:${trackingId}`,
    eventType: 'FIELD_CHANGED',
    eventVersion: 1,
    correlationId,
    sessionId: 's-mysql-audit',
    actorId: 'officer@example.gov',
    payload: {
      eventId,
      eventType: 'FIELD_CHANGED',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      sourceService: 'workflow-runtime',
      correlationId,
      sessionId: 's-mysql-audit',
      actor: { id: 'officer@example.gov', displayName: 'Officer', actorType: 'USER' },
      entity: {
        entityType: 'WORKLOAD',
        trackingId,
        definitionKey: 'I_90',
        definitionVersion: '1.0.0'
      },
      workflow: { actionKey: null, toStageKey: 'READY_FOR_DATA_ENTRY', stageVisitId: 1 },
      fieldDeltas: [
        {
          fieldKey: 'RECEIPT_NUMBER',
          path: '$.dataEntryDetails.receiptNumber',
          before: null,
          after: 'ABC1234567890',
          piiClassification: 'SENSITIVE',
          splunkPolicy: DEFAULT_SPLUNK_MASK_POLICY
        }
      ],
      changes: toAuditChanges([
        {
          fieldKey: 'RECEIPT_NUMBER',
          path: '$.dataEntryDetails.receiptNumber',
          before: null,
          after: 'ABC1234567890',
          piiClassification: 'SENSITIVE',
          splunkPolicy: DEFAULT_SPLUNK_MASK_POLICY
        }
      ])
    }
  });
  return eventId;
}

describeIfMysql('OutboxPipeline against MySQL', () => {
  let admin: Connection;
  let pool: Pool;
  let outbox: MysqlOutboxRepository;
  let deliveries: MysqlOutboxDeliveryRepository;
  let audit: MysqlAuditEventRepository;
  let splunk: MysqlSplunkEventRepository;
  const databaseName = `optic_slice12_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

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
    outbox = new MysqlOutboxRepository(pool);
    deliveries = new MysqlOutboxDeliveryRepository(pool);
    audit = new MysqlAuditEventRepository(pool);
    splunk = new MysqlSplunkEventRepository(pool);
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await admin.end();
    }
  });

  it('persists full values in audit_event and masked values in splunk_event', async () => {
    const eventId = await appendFieldChanged(outbox, 'W-MYSQL-AUDIT-1', 'c-mysql-audit-1');
    const tick = await pipelineFor(outbox, deliveries, audit, splunk, 'mysql-pipeline-a').tick();
    expect(tick.published).toBe(1);
    expect(tick.auditPublished).toBe(1);
    expect(tick.splunkPublished).toBe(1);

    const auditRow = await audit.findByEventId(eventId);
    const splunkRow = await splunk.findByEventId(eventId);
    expect(auditRow?.correlationId).toBe('c-mysql-audit-1');
    expect(splunkRow?.correlationId).toBe('c-mysql-audit-1');
    const auditDeltas = (auditRow?.eventData.fieldDeltas as Array<Record<string, unknown>>) ?? [];
    const splunkDeltas = (splunkRow?.payload.fieldDeltas as Array<Record<string, unknown>>) ?? [];
    expect(auditDeltas[0]?.after).toBe('ABC1234567890');
    expect(splunkDeltas[0]?.after).toBe('A*********890');

    const [hashRows] = await pool.query<Array<{ previous_hash: string | null; event_hash: string }>>(
      'SELECT previous_hash, event_hash FROM audit_event WHERE event_id = ?',
      [eventId]
    );
    expect(hashRows[0]?.event_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashRows[0]?.previous_hash).toBeNull();
  });

  it('chains hashes for the same entity partition', async () => {
    const firstId = await appendFieldChanged(outbox, 'W-MYSQL-CHAIN', 'c-mysql-chain-1');
    const secondId = await appendFieldChanged(outbox, 'W-MYSQL-CHAIN', 'c-mysql-chain-2');
    await pipelineFor(outbox, deliveries, audit, splunk, 'mysql-pipeline-chain').tick();
    const first = await audit.findByEventId(firstId);
    const second = await audit.findByEventId(secondId);
    expect(second?.previousHash).toBe(first?.eventHash);
  });

  it('lets exactly one of two workers publish a pending outbox row', async () => {
    const eventId = await appendFieldChanged(outbox, 'W-MYSQL-RACE', 'c-mysql-race');
    const [first, second] = await Promise.all([
      pipelineFor(outbox, deliveries, audit, splunk, 'mysql-outbox-a').tick(),
      pipelineFor(outbox, deliveries, audit, splunk, 'mysql-outbox-b').tick()
    ]);
    expect(first.published + second.published).toBe(1);
    const rows = await deliveries.listByEventId(eventId);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.consumerKey).sort()).toEqual(['AUDIT', 'SPLUNK']);
  });

  it('denies UPDATE and DELETE on audit_event for a restricted API account', async () => {
    if (!testUrl) {
      return;
    }
    const eventId = await appendFieldChanged(outbox, 'W-MYSQL-PRIV', 'c-mysql-priv');
    await pipelineFor(outbox, deliveries, audit, splunk, 'mysql-priv').tick();

    const url = new URL(testUrl);
    const apiUser = `oa${databaseName.replace(/[^a-z0-9]/gi, '').slice(-16)}`;
    await admin.query(`CREATE USER '${apiUser}'@'%' IDENTIFIED BY 'optic'`);
    await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${databaseName}\`.* TO '${apiUser}'@'%'`);
    const revoked = await restrictAuditEventPrivileges(admin, databaseName, apiUser);
    expect(revoked).toBe(true);

    const restricted = await createConnection({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: apiUser,
      password: 'optic',
      database: databaseName
    });
    try {
      await expect(
        restricted.query(`UPDATE audit_event SET event_type = 'TAMPER' WHERE event_id = ?`, [eventId])
      ).rejects.toMatchObject({ code: 'ER_TABLEACCESS_DENIED_ERROR' });
      await expect(
        restricted.query(`DELETE FROM audit_event WHERE event_id = ?`, [eventId])
      ).rejects.toMatchObject({ code: 'ER_TABLEACCESS_DENIED_ERROR' });
      const [rows] = await restricted.query<Array<{ event_id: string }>>(
        `SELECT event_id FROM audit_event WHERE event_id = ?`,
        [eventId]
      );
      expect(rows).toHaveLength(1);
      await restricted.query(`UPDATE outbox_event SET aggregate_type = aggregate_type WHERE event_id = ?`, [
        eventId
      ]);
    } finally {
      await restricted.end();
      await admin.query(`DROP USER IF EXISTS '${apiUser}'@'%'`);
    }
  });
});
