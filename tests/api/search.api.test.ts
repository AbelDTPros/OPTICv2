import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { seedPublishedLinear } from '../helpers/publish-linear.js';
import { authHeaders, createTestRuntime } from '../helpers/test-app.js';

describe('search APIs', () => {
  it('rejects unauthenticated search', async () => {
    const { app } = createTestRuntime();
    const response = await request(app).get('/api/v1/search?q=W-1');
    expect(response.status).toBe(401);
  });

  it('finds a workflow instance by tracking id prefix', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    await request(runtime.app).post('/api/v1/workflows').set(authHeaders).send({
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-SEARCH-1',
      definitionKey: 'I_90'
    });

    const response = await request(runtime.app).get('/api/v1/search?q=W-SEARCH').set(authHeaders);
    expect(response.status).toBe(200);
    expect(response.body.data.hits.map((hit: { trackingId: string }) => hit.trackingId)).toContain('W-SEARCH-1');
  });

  it('finds a workflow instance from a scanned label or a middle slice of the tracking id', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    await request(runtime.app).post('/api/v1/workflows').set(authHeaders).send({
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-SEARCH-2',
      definitionKey: 'I_90'
    });

    const scanned = await request(runtime.app)
      .get('/api/v1/search?q=OPTIC:WORKLOAD:W-SEARCH-2')
      .set(authHeaders);
    expect(scanned.status).toBe(200);
    expect(scanned.body.data.hits.map((hit: { trackingId: string }) => hit.trackingId)).toContain('W-SEARCH-2');

    const partial = await request(runtime.app).get('/api/v1/search?q=SEARCH-2').set(authHeaders);
    expect(partial.status).toBe(200);
    expect(partial.body.data.hits.map((hit: { trackingId: string }) => hit.trackingId)).toContain('W-SEARCH-2');
  });

  it('finds a workload by receipt number without matching that value as a tracking id', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await request(runtime.app).post('/api/v1/workflows').set(authHeaders).send({
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-SEARCH-3',
      definitionKey: 'I_90'
    });
    const assigned = await request(runtime.app)
      .post('/api/v1/workflows/WORKLOAD/W-SEARCH-3/assign')
      .set(authHeaders)
      .send({ expectedRowVersion: created.body.data.workflow.rowVersion });
    await request(runtime.app)
      .patch('/api/v1/workflows/WORKLOAD/W-SEARCH-3/data')
      .set(authHeaders)
      .send({
        expectedRowVersion: assigned.body.data.workflow.rowVersion,
        dataPatch: { dataEntryDetails: { receiptNumber: 'ABC1234567890' } }
      });

    const byReceipt = await request(runtime.app)
      .get('/api/v1/search?receiptNumber=ABC123')
      .set(authHeaders);
    expect(byReceipt.status).toBe(200);
    expect(byReceipt.body.data.hits.map((hit: { trackingId: string }) => hit.trackingId)).toContain('W-SEARCH-3');

    const asTracking = await request(runtime.app).get('/api/v1/search?q=ABC123').set(authHeaders);
    expect(asTracking.status).toBe(200);
    expect(asTracking.body.data.hits.map((hit: { trackingId: string }) => hit.trackingId)).not.toContain('W-SEARCH-3');
  });

  it('rejects a disallowed search page size', async () => {
    const runtime = createTestRuntime();
    const response = await request(runtime.app).get('/api/v1/search?pageSize=7').set(authHeaders);
    expect(response.status).toBe(400);
    expect(response.body.error.errorCode).toBe('OPTIC-WF-40060');
  });

  it('finds an unprojected Try/draft case by a partial tracking id', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    runtime.repository.setLifecycleForTest('I_90', '1.0.0', 'DRAFT');
    const created = await request(runtime.app).post('/api/v1/workflows').set(authHeaders).send({
      entityType: 'WORKLOAD',
      entityTrackingId: 'TRIAL-I_90-PARTIAL-9',
      definitionKey: 'I_90',
      version: '1.0.0'
    });
    expect(created.status).toBe(201);
    expect(await runtime.projections.findByEntity('WORKLOAD', 'TRIAL-I_90-PARTIAL-9')).toBeNull();

    const response = await request(runtime.app).get('/api/v1/search?q=PARTIAL-9').set(authHeaders);
    expect(response.status).toBe(200);
    expect(response.body.data.hits.map((hit: { trackingId: string }) => hit.trackingId)).toContain(
      'TRIAL-I_90-PARTIAL-9'
    );
  });

  it('finds an unprojected case by catalog extra alone (no tracking id)', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    runtime.repository.setLifecycleForTest('I_90', '1.0.0', 'DRAFT');
    const release = await runtime.repository.findReleaseByKeyAndVersion('I_90', '1.0.0');
    expect(release).toBeTruthy();
    await runtime.service.saveSearch(
      {
        actorId: 'configurator@example.gov',
        roles: ['CONFIGURATOR'],
        correlationId: 'c-search-extra'
      },
      {
        definitionKey: 'I_90',
        version: '1.0.0',
        expectedRowVersion: release!.rowVersion,
        payload: {
          searchKey: 'DEFAULT',
          fields: [
            {
              fieldKey: 'trackingId',
              source: 'SYSTEM',
              path: '$workflow.trackingId',
              match: 'CONTAINS',
              pii: false
            },
            {
              fieldKey: 'LastName',
              source: 'BUSINESS_DATA',
              path: '$.dataEntryDetails.workloadStatus',
              match: 'CONTAINS',
              pii: false
            }
          ]
        }
      }
    );

    const created = await request(runtime.app).post('/api/v1/workflows').set(authHeaders).send({
      entityType: 'WORKLOAD',
      entityTrackingId: 'TRIAL-I_90-LAST-ONLY',
      definitionKey: 'I_90',
      version: '1.0.0'
    });
    expect(created.status).toBe(201);
    expect(await runtime.projections.findByEntity('WORKLOAD', 'TRIAL-I_90-LAST-ONLY')).toBeNull();

    const assigned = await request(runtime.app)
      .post('/api/v1/workflows/WORKLOAD/TRIAL-I_90-LAST-ONLY/assign')
      .set(authHeaders)
      .send({ expectedRowVersion: created.body.data.workflow.rowVersion });
    await request(runtime.app)
      .patch('/api/v1/workflows/WORKLOAD/TRIAL-I_90-LAST-ONLY/data')
      .set(authHeaders)
      .send({
        expectedRowVersion: assigned.body.data.workflow.rowVersion,
        dataPatch: { dataEntryDetails: { receiptNumber: 'ABC1234567890', workloadStatus: 'Accepted' } }
      });

    const withTracking = await request(runtime.app)
      .get(
        `/api/v1/search?q=TRIAL-I_90-LAST-ONLY&criteria=${encodeURIComponent(JSON.stringify({ LastName: 'Acc' }))}`
      )
      .set(authHeaders);
    expect(withTracking.status).toBe(200);
    expect(withTracking.body.data.hits.map((hit: { trackingId: string }) => hit.trackingId)).toContain(
      'TRIAL-I_90-LAST-ONLY'
    );

    const extrasOnly = await request(runtime.app)
      .get(`/api/v1/search?criteria=${encodeURIComponent(JSON.stringify({ LastName: 'Acc' }))}`)
      .set(authHeaders);
    expect(extrasOnly.status).toBe(200);
    expect(extrasOnly.body.data.hits.map((hit: { trackingId: string }) => hit.trackingId)).toContain(
      'TRIAL-I_90-LAST-ONLY'
    );
  });
});
