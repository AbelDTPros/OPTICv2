import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { authHeaders, createTestRuntime } from '../helpers/test-app.js';

const adminHeaders = {
  ...authHeaders,
  'X-Actor-Id': 'admin@example.gov',
  'X-Actor-Roles': 'ADMIN'
};

describe('feature flag APIs', () => {
  it('returns effective flags and admin env gates to any authenticated actor', async () => {
    const { app } = createTestRuntime();
    const response = await request(app).get('/api/v1/features').set(authHeaders);
    expect(response.status).toBe(200);
    expect(response.body.data.flags['ui.shell.designer']).toBe(true);
    expect(response.body.data.admin).toEqual({ uiEnabled: true, apiEnabled: true });
  });

  it('lists admin flags for ADMIN when FEATURE_ADMIN_API is enabled', async () => {
    const { app } = createTestRuntime();
    const response = await request(app).get('/api/v1/admin/features').set(adminHeaders);
    expect(response.status).toBe(200);
    expect(response.body.data.flags.length).toBeGreaterThan(0);
    expect(response.body.data.flags[0]).toMatchObject({
      key: expect.any(String),
      label: expect.any(String),
      enabled: expect.any(Boolean),
      rowVersion: expect.any(Number)
    });
    expect(response.body.data.flags.find((flag: { key: string }) => flag.key === 'ui.shell.workspace')).toMatchObject({
      label: 'Workspace'
    });
  });

  it('rejects admin list without ADMIN role', async () => {
    const { app } = createTestRuntime();
    const response = await request(app).get('/api/v1/admin/features').set(authHeaders);
    expect(response.status).toBe(403);
    expect(response.body.error.errorCode).toBe('OPTIC-AUTHZ-40304');
  });

  it('rejects admin APIs when FEATURE_ADMIN_API is false', async () => {
    const { app } = createTestRuntime({
      featureAdmin: { uiEnabled: true, apiEnabled: false }
    });
    const response = await request(app).get('/api/v1/admin/features').set(adminHeaders);
    expect(response.status).toBe(403);
    expect(response.body.error.errorCode).toBe('OPTIC-FEATURE-40302');
  });

  it('updates a flag, audits via outbox, and enforces search API gate', async () => {
    const { app, outbox } = createTestRuntime();
    const listed = await request(app).get('/api/v1/admin/features').set(adminHeaders);
    const searchFlag = listed.body.data.flags.find((flag: { key: string }) => flag.key === 'api.search');
    expect(searchFlag).toBeTruthy();

    const updated = await request(app)
      .put('/api/v1/admin/features/api.search')
      .set(adminHeaders)
      .send({ enabled: false, expectedRowVersion: searchFlag.rowVersion });
    expect(updated.status).toBe(200);
    expect(updated.body.data.enabled).toBe(false);
    expect(updated.body.data.rowVersion).toBe(searchFlag.rowVersion + 1);

    const events = await outbox.listByAggregate('FEATURE_FLAG', 'api.search');
    expect(events.some((event) => event.eventType === 'FEATURE_FLAG_CHANGED')).toBe(true);

    const effective = await request(app).get('/api/v1/features').set(authHeaders);
    expect(effective.body.data.flags['api.search']).toBe(false);

    const search = await request(app).get('/api/v1/search').query({ q: 'x' }).set(authHeaders);
    expect(search.status).toBe(403);
    expect(search.body.error.errorCode).toBe('OPTIC-FEATURE-40301');
  });

  it('rejects stale row versions', async () => {
    const { app } = createTestRuntime();
    const response = await request(app)
      .put('/api/v1/admin/features/ui.shell.designer')
      .set(adminHeaders)
      .send({ enabled: false, expectedRowVersion: 99 });
    expect(response.status).toBe(409);
    expect(response.body.error.errorCode).toBe('OPTIC-FEATURE-40901');
  });
});
