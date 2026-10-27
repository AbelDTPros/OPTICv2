import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { seedPublishedBulk } from '../helpers/publish-bulk.js';
import { authHeaders, createTestRuntime } from '../helpers/test-app.js';

describe('bulk action APIs', () => {
  it('rejects unauthenticated execute', async () => {
    const { app } = createTestRuntime();
    const response = await request(app).post('/api/v1/bulk-actions/BULK_SHIP/execute').send({
      items: [{ trackingId: 'W-1', expectedRowVersion: 0 }]
    });
    expect(response.status).toBe(401);
  });

  it('executes BEST_EFFORT, returns the operation, and replays the same idempotency key', async () => {
    const runtime = createTestRuntime();
    await seedPublishedBulk(runtime);
    const created = await request(runtime.app)
      .post('/api/v1/workflows')
      .set(authHeaders)
      .send({ entityType: 'WORKLOAD', entityTrackingId: 'W-API-BULK', definitionKey: 'I_131_BULK' });
    expect(created.status).toBe(201);

    const queue = await request(runtime.app).get('/api/v1/queues/READY_FOR_SHIPPING').set(authHeaders);
    expect(queue.status).toBe(200);
    expect(queue.body.data.bulkActions.map((item: { bulkActionKey: string }) => item.bulkActionKey)).toContain(
      'BULK_SHIP'
    );

    const executed = await request(runtime.app)
      .post('/api/v1/bulk-actions/BULK_SHIP/execute')
      .set({ ...authHeaders, 'X-Idempotency-Key': 'bulk-1' })
      .send({
        items: [
          {
            entityType: 'WORKLOAD',
            trackingId: 'W-API-BULK',
            expectedRowVersion: created.body.data.workflow.rowVersion
          }
        ],
        input: { shipDate: '2026-08-23' }
      });
    expect(executed.status).toBe(201);
    expect(executed.body.data.status).toBe('COMPLETED');
    expect(executed.body.data.successfulItems).toBe(1);

    const replayed = await request(runtime.app)
      .post('/api/v1/bulk-actions/BULK_SHIP/execute')
      .set({ ...authHeaders, 'X-Idempotency-Key': 'bulk-1' })
      .send({
        items: [
          {
            entityType: 'WORKLOAD',
            trackingId: 'W-API-BULK',
            expectedRowVersion: created.body.data.workflow.rowVersion
          }
        ],
        input: { shipDate: '2026-08-23' }
      });
    expect(replayed.status).toBe(201);
    expect(replayed.body.data.id).toBe(executed.body.data.id);

    const fetched = await request(runtime.app)
      .get(`/api/v1/bulk-operations/${executed.body.data.id}`)
      .set(authHeaders);
    expect(fetched.status).toBe(200);
    expect(fetched.body.data.items[0].trackingId).toBe('W-API-BULK');
    expect(fetched.body.data.items[0].status).toBe('SUCCEEDED');
  });
});
