import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { authHeaders, createTestRuntime } from '../helpers/test-app.js';

describe('tracking id APIs', () => {
  it('mints a MAIL tracking id', async () => {
    const { app } = createTestRuntime();
    const minted = await request(app).post('/api/v1/tracking-ids').set(authHeaders).send({ entityType: 'MAIL' });
    expect(minted.status).toBe(201);
    expect(minted.body.data.entityType).toBe('MAIL');
    expect(minted.body.data.trackingId).toMatch(/^M-[0-9A-HJKMNP-TV-Z]{10}$/);

    const workload = await request(app)
      .post('/api/v1/tracking-ids')
      .set(authHeaders)
      .send({ entityType: 'WORKLOAD' });
    expect(workload.status).toBe(201);
    expect(workload.body.data.trackingId).toMatch(/^W-[0-9A-HJKMNP-TV-Z]{10}$/);
  });

  it('rejects an unknown entity type', async () => {
    const { app } = createTestRuntime();
    const minted = await request(app).post('/api/v1/tracking-ids').set(authHeaders).send({ entityType: 'BOX' });
    expect(minted.status).toBe(400);
    expect(minted.body.error.errorCode).toBe('OPTIC-WF-40094');
  });
});
