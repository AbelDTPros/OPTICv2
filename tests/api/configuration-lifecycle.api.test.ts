import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { authorLinearDraft } from '../helpers/author-linear.js';
import { createTestRuntime } from '../helpers/test-app.js';

const authorHeaders = { Authorization: 'Bearer dev-token', 'X-Actor-Id': 'author@example.gov' };
const approverHeaders = { Authorization: 'Bearer dev-token', 'X-Actor-Id': 'approver@example.gov' };
const publisherHeaders = { Authorization: 'Bearer dev-token', 'X-Actor-Id': 'publisher@example.gov' };

describe('configuration lifecycle APIs', () => {
  it('submits, approves, publishes, exports, and activates a linear release', async () => {
    const runtime = createTestRuntime();
    const actor = { actorId: 'author@example.gov', roles: ['CONFIGURATOR'], correlationId: 'c-api-author' };
    const drafted = await authorLinearDraft(runtime.service, actor);
    const invalid = await request(runtime.app)
      .post('/api/v1/config/definitions/I_90/releases/1.0.0/validate')
      .set(authorHeaders);
    expect(invalid.status).toBe(200);
    expect(invalid.body.data.valid).toBe(true);
    expect(invalid.body.data.projections.map((field: { key: string }) => field.key)).toEqual(
      expect.arrayContaining(['currentStageKey', 'trackingId', 'receiptNumber'])
    );

    const submitted = await request(runtime.app)
      .post('/api/v1/config/definitions/I_90/releases/1.0.0/submit')
      .set(authorHeaders)
      .send({ expectedRowVersion: drafted.rowVersion });
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.lifecycleStatus).toBe('IN_REVIEW');

    const selfApprove = await request(runtime.app)
      .post('/api/v1/config/definitions/I_90/releases/1.0.0/approve')
      .set(authorHeaders)
      .send({ expectedRowVersion: submitted.body.data.rowVersion });
    expect(selfApprove.status).toBe(403);
    expect(selfApprove.body.error.errorCode).toBe('OPTIC-AUTHZ-40302');

    const approved = await request(runtime.app)
      .post('/api/v1/config/definitions/I_90/releases/1.0.0/approve')
      .set(approverHeaders)
      .send({ expectedRowVersion: submitted.body.data.rowVersion });
    expect(approved.status).toBe(200);
    expect(approved.body.data.lifecycleStatus).toBe('APPROVED');

    const published = await request(runtime.app)
      .post('/api/v1/config/definitions/I_90/releases/1.0.0/publish')
      .set(publisherHeaders)
      .send({ expectedRowVersion: approved.body.data.rowVersion });
    expect(published.status).toBe(200);
    expect(published.body.data.lifecycleStatus).toBe('PUBLISHED');
    expect(published.body.data.checksum).toMatch(/^[a-f0-9]{64}$/);

    const exported = await request(runtime.app)
      .get('/api/v1/config/definitions/I_90/releases/1.0.0/export')
      .set(publisherHeaders);
    expect(exported.status).toBe(200);
    expect(exported.body.data.checksum).toBe(published.body.data.checksum);
    expect(exported.body.data.package.metadata.definitionKey).toBe('I_90');
    expect(exported.body.data.files['manifest.yaml']).toContain('I_90');

    const activated = await request(runtime.app)
      .post('/api/v1/config/definitions/I_90/activate/1.0.0')
      .set(publisherHeaders)
      .send({ expectedRowVersion: published.body.data.rowVersion });
    expect(activated.status).toBe(200);
    expect(activated.body.data.lifecycleStatus).toBe('PUBLISHED');
    expect(activated.body.data.active).toBe(true);

    const definitions = await request(runtime.app).get('/api/v1/config/definitions').set(authorHeaders);
    expect(definitions.body.data[0].activeReleaseId).toBe(Number(published.body.data.id));

    const replayed = await request(runtime.app)
      .post('/api/v1/config/definitions/I_90/activate/1.0.0')
      .set({ ...publisherHeaders, 'X-Idempotency-Key': 'activate-1' })
      .send({ expectedRowVersion: published.body.data.rowVersion });
    expect(replayed.status).toBe(200);
    const again = await request(runtime.app)
      .post('/api/v1/config/definitions/I_90/activate/1.0.0')
      .set({ ...publisherHeaders, 'X-Idempotency-Key': 'activate-1' })
      .send({ expectedRowVersion: published.body.data.rowVersion });
    expect(again.status).toBe(200);
    expect(again.body.meta.idempotencyKey).toBe('activate-1');

    const deactivated = await request(runtime.app)
      .post('/api/v1/config/definitions/I_90/deactivate/1.0.0')
      .set(publisherHeaders)
      .send({ expectedRowVersion: published.body.data.rowVersion });
    expect(deactivated.status).toBe(200);
    const after = await request(runtime.app).get('/api/v1/config/definitions').set(authorHeaders);
    expect(after.body.data[0].activeReleaseId).toBeNull();
  });

  it('imports an exported package as a DRAFT in another runtime', async () => {
    const source = createTestRuntime();
    const actor = { actorId: 'author@example.gov', roles: ['CONFIGURATOR'], correlationId: 'c-import-src' };
    const drafted = await authorLinearDraft(source.service, actor);
    const submitted = await source.service.submit(actor, {
      definitionKey: 'I_90',
      version: '1.0.0',
      expectedRowVersion: drafted.rowVersion
    });
    const approved = await source.service.approve(
      { actorId: 'approver@example.gov', roles: ['CONFIGURATOR'], correlationId: 'c-import-appr' },
      { definitionKey: 'I_90', version: '1.0.0', expectedRowVersion: submitted.rowVersion }
    );
    await source.service.publish(
      { actorId: 'publisher@example.gov', roles: ['CONFIGURATOR'], correlationId: 'c-import-pub' },
      { definitionKey: 'I_90', version: '1.0.0', expectedRowVersion: approved.rowVersion }
    );
    const exported = await source.service.exportRelease(actor, 'I_90', '1.0.0');

    const target = createTestRuntime();
    const badChecksum = await request(target.app)
      .post('/api/v1/config/definitions/I_90/releases/import')
      .set(authorHeaders)
      .send({ package: exported.package, checksum: '0'.repeat(64) });
    expect(badChecksum.status).toBe(400);
    expect(badChecksum.body.error.errorCode).toBe('OPTIC-CONFIG-40028');

    const imported = await request(target.app)
      .post('/api/v1/config/definitions/I_90/releases/import')
      .set(authorHeaders)
      .send({ package: exported.package, checksum: exported.checksum });
    expect(imported.status).toBe(201);
    expect(imported.body.data.lifecycleStatus).toBe('DRAFT');
    expect(imported.body.data.definitionKey).toBe('I_90');
    expect(imported.body.data.version).toBe('1.0.0');
    expect(imported.body.data.workflow.stages.map((stage: { stageKey: string }) => stage.stageKey)).toEqual(
      expect.arrayContaining(['READY_FOR_DATA_ENTRY', 'COMPLETED'])
    );
    expect(Object.keys(imported.body.data.actions)).toContain('COMPLETE_DATA_ENTRY');
    expect(imported.body.data.checksum).toBeUndefined();

    const duplicate = await request(target.app)
      .post('/api/v1/config/definitions/I_90/releases/import')
      .set(authorHeaders)
      .send({ package: exported.package, checksum: exported.checksum });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.errorCode).toBe('OPTIC-CONFIG-40901');
  });

  it('imports a package as PUBLISHED without activating Live', async () => {
    const source = createTestRuntime();
    const actor = { actorId: 'author@example.gov', roles: ['CONFIGURATOR'], correlationId: 'c-pub-src' };
    const drafted = await authorLinearDraft(source.service, actor);
    const submitted = await source.service.submit(actor, {
      definitionKey: 'I_90',
      version: '1.0.0',
      expectedRowVersion: drafted.rowVersion
    });
    const approved = await source.service.approve(
      { actorId: 'approver@example.gov', roles: ['CONFIGURATOR'], correlationId: 'c-pub-appr' },
      { definitionKey: 'I_90', version: '1.0.0', expectedRowVersion: submitted.rowVersion }
    );
    await source.service.publish(
      { actorId: 'publisher@example.gov', roles: ['CONFIGURATOR'], correlationId: 'c-pub-pub' },
      { definitionKey: 'I_90', version: '1.0.0', expectedRowVersion: approved.rowVersion }
    );
    const exported = await source.service.exportRelease(actor, 'I_90', '1.0.0');

    const target = createTestRuntime();
    const imported = await request(target.app)
      .post('/api/v1/config/definitions/I_90/releases/import')
      .set(publisherHeaders)
      .send({ package: exported.package, checksum: exported.checksum, mode: 'PUBLISHED' });
    expect(imported.status).toBe(201);
    expect(imported.body.data.lifecycleStatus).toBe('PUBLISHED');
    expect(imported.body.data.active).toBe(false);
    expect(imported.body.data.checksum).toBe(exported.checksum);

    const definitions = await request(target.app).get('/api/v1/config/definitions').set(authorHeaders);
    expect(definitions.body.data[0].activeReleaseId).toBeNull();
  });
});
