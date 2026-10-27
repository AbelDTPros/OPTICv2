import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { ActorContext } from '../../src/platform/security/actor.js';
import { AuthenticatedActorAuthorization } from '../../src/platform/security/authorization-port.js';
import { seedPublishedBulk } from '../helpers/publish-bulk.js';
import { seedPublishedLinear } from '../helpers/publish-linear.js';
import { authHeaders, createTestRuntime } from '../helpers/test-app.js';

describe('queue APIs', () => {
  it('rejects unauthenticated list', async () => {
    const { app } = createTestRuntime();
    const response = await request(app).get('/api/v1/queues');
    expect(response.status).toBe(401);
  });

  it('lists queues and returns paged rows with rowVersion', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    await request(runtime.app)
      .post('/api/v1/workflows')
      .set(authHeaders)
      .send({ entityType: 'WORKLOAD', entityTrackingId: 'W-API-1', definitionKey: 'I_90' });

    const listed = await request(runtime.app).get('/api/v1/queues').set(authHeaders);
    expect(listed.status).toBe(200);
    expect(listed.body.data.queues.map((item: { queueKey: string }) => item.queueKey)).toContain(
      'READY_FOR_DATA_ENTRY'
    );
    expect(
      listed.body.data.queues.find((item: { queueKey: string; total?: number }) => item.queueKey === 'READY_FOR_DATA_ENTRY')
        ?.total
    ).toBe(1);

    const page = await request(runtime.app)
      .get('/api/v1/queues/READY_FOR_DATA_ENTRY?page=1&pageSize=25&sort=trackingId&direction=ASC')
      .set(authHeaders);
    expect(page.status).toBe(200);
    expect(page.body.data.total).toBe(1);
    expect(page.body.data.rows[0].trackingId).toBe('W-API-1');
    expect(page.body.data.rows[0].rowVersion).toBe(0);
    expect(page.body.data.columns.map((column: { key: string }) => column.key)).toContain('assignedTo');
  });

  it('assigns from the queue using the assign action', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await request(runtime.app)
      .post('/api/v1/workflows')
      .set(authHeaders)
      .send({ entityType: 'WORKLOAD', entityTrackingId: 'W-API-2', definitionKey: 'I_90' });

    const assigned = await request(runtime.app)
      .post('/api/v1/queues/READY_FOR_DATA_ENTRY/assign')
      .set(authHeaders)
      .send({
        entityType: 'WORKLOAD',
        trackingId: 'W-API-2',
        expectedRowVersion: created.body.data.workflow.rowVersion
      });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.workflow.assignedTo).toBe('configurator@example.gov');

    const filtered = await request(runtime.app)
      .get('/api/v1/queues/READY_FOR_DATA_ENTRY?assignedStatus=UNASSIGNED')
      .set(authHeaders);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.total).toBe(0);

    const released = await request(runtime.app)
      .post('/api/v1/queues/READY_FOR_DATA_ENTRY/release')
      .set({ ...authHeaders, 'X-Idempotency-Key': 'queue-rel-1' })
      .send({
        entityType: 'WORKLOAD',
        trackingId: 'W-API-2',
        expectedRowVersion: assigned.body.data.workflow.rowVersion
      });
    expect(released.status).toBe(200);
    expect(released.body.data.workflow.assignedTo).toBeNull();

    const replayed = await request(runtime.app)
      .post('/api/v1/queues/READY_FOR_DATA_ENTRY/release')
      .set({ ...authHeaders, 'X-Idempotency-Key': 'queue-rel-1' })
      .send({
        entityType: 'WORKLOAD',
        trackingId: 'W-API-2',
        expectedRowVersion: assigned.body.data.workflow.rowVersion
      });
    expect(replayed.status).toBe(200);
    expect(replayed.body.meta.idempotencyKey).toBe('queue-rel-1');

    const conflicted = await request(runtime.app)
      .post('/api/v1/queues/READY_FOR_DATA_ENTRY/release')
      .set({ ...authHeaders, 'X-Idempotency-Key': 'queue-rel-1' })
      .send({
        entityType: 'WORKLOAD',
        trackingId: 'W-API-2',
        expectedRowVersion: 99
      });
    expect(conflicted.status).toBe(409);
    expect(conflicted.body.error.errorCode).toBe('OPTIC-WF-40906');
  });

  it('lets a supervisor reassign from the queue', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await request(runtime.app)
      .post('/api/v1/workflows')
      .set(authHeaders)
      .send({ entityType: 'WORKLOAD', entityTrackingId: 'W-API-REASSIGN', definitionKey: 'I_90' });
    const assigned = await request(runtime.app)
      .post('/api/v1/queues/READY_FOR_DATA_ENTRY/assign')
      .set(authHeaders)
      .send({
        entityType: 'WORKLOAD',
        trackingId: 'W-API-REASSIGN',
        expectedRowVersion: created.body.data.workflow.rowVersion
      });

    const denied = await request(runtime.app)
      .post('/api/v1/queues/READY_FOR_DATA_ENTRY/reassign')
      .set(authHeaders)
      .send({
        entityType: 'WORKLOAD',
        trackingId: 'W-API-REASSIGN',
        expectedRowVersion: assigned.body.data.workflow.rowVersion,
        assignedTo: 'other@example.gov'
      });
    expect(denied.status).toBe(403);
    expect(denied.body.error.errorCode).toBe('OPTIC-AUTHZ-40303');

    const reassigned = await request(runtime.app)
      .post('/api/v1/queues/READY_FOR_DATA_ENTRY/reassign')
      .set({
        Authorization: 'Bearer dev-token',
        'X-Actor-Id': 'supervisor@example.gov',
        'X-Actor-Roles': 'SUPERVISOR'
      })
      .send({
        entityType: 'WORKLOAD',
        trackingId: 'W-API-REASSIGN',
        expectedRowVersion: assigned.body.data.workflow.rowVersion,
        assignedTo: 'other@example.gov'
      });
    expect(reassigned.status).toBe(200);
    expect(reassigned.body.data.workflow.assignedTo).toBe('other@example.gov');
  });

  it('omits bulk actions the actor cannot execute', async () => {
    class DenyAtomicBulk extends AuthenticatedActorAuthorization {
      override async canExecuteBulkAction(
        actor: ActorContext,
        bulkActionKey: string
      ): Promise<boolean> {
        return Boolean(actor.actorId) && bulkActionKey !== 'BULK_SHIP_ATOMIC';
      }
    }

    const runtime = createTestRuntime({ authorization: new DenyAtomicBulk() });
    await seedPublishedBulk(runtime);
    await request(runtime.app)
      .post('/api/v1/workflows')
      .set(authHeaders)
      .send({ entityType: 'WORKLOAD', entityTrackingId: 'W-API-BULK-AUTH', definitionKey: 'I_131_BULK' });

    const page = await request(runtime.app).get('/api/v1/queues/READY_FOR_SHIPPING').set(authHeaders);
    expect(page.status).toBe(200);
    const keys = page.body.data.bulkActions.map((item: { bulkActionKey: string }) => item.bulkActionKey);
    expect(keys).toContain('BULK_SHIP');
    expect(keys).not.toContain('BULK_SHIP_ATOMIC');
  });

  it('rejects a disallowed page size', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const response = await request(runtime.app)
      .get('/api/v1/queues/READY_FOR_DATA_ENTRY?pageSize=7')
      .set(authHeaders);
    expect(response.status).toBe(400);
    expect(response.body.error.errorCode).toBe('OPTIC-WF-40060');
  });
});
