import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { authHeaders, createTestRuntime } from '../helpers/test-app.js';

const adminHeaders = {
  ...authHeaders,
  'X-Actor-Id': 'admin@example.gov',
  'X-Actor-Roles': 'ADMIN'
};

async function seedAudit(
  audit: ReturnType<typeof createTestRuntime>['audit'],
  overrides: Partial<Parameters<typeof audit.append>[0]> = {}
) {
  const eventId = overrides.eventId ?? crypto.randomUUID();
  const eventType = overrides.eventType ?? 'FEATURE_FLAG_CHANGED';
  const { eventData: overrideEventData, ...rest } = overrides;
  return audit.append({
    occurredAt: new Date('2026-10-23T12:00:00.000Z'),
    actorId: 'admin@example.gov',
    actorName: 'Admin',
    sessionId: null,
    correlationId: `c-${eventId}`,
    sourceService: 'api-server',
    entityType: 'FEATURE_FLAG',
    entityTrackingId: 'api.search',
    definitionKey: 'api.search',
    definitionVersion: null,
    stageKey: null,
    actionKey: null,
    ...rest,
    eventId,
    eventType,
    eventData: overrideEventData ?? { eventType, payload: { enabled: false } }
  });
}

describe('admin audit APIs', () => {
  it('lists audit events for ADMIN and returns detail with eventData', async () => {
    const { app, audit } = createTestRuntime();
    const first = await seedAudit(audit, {
      eventId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      eventType: 'CONFIG_CHANGED',
      definitionKey: 'I_90'
    });
    await seedAudit(audit, {
      eventId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      eventType: 'FEATURE_FLAG_CHANGED',
      definitionKey: 'api.search'
    });

    const listed = await request(app).get('/api/v1/admin/audit').query({ limit: 10 }).set(adminHeaders);
    expect(listed.status).toBe(200);
    expect(listed.body.data.items.length).toBeGreaterThanOrEqual(2);
    expect(listed.body.data.items[0].eventData).toBeUndefined();

    const filtered = await request(app)
      .get('/api/v1/admin/audit')
      .query({ eventType: 'CONFIG_CHANGED' })
      .set(adminHeaders);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.items).toHaveLength(1);
    expect(filtered.body.data.items[0].eventId).toBe(first.eventId);

    const detail = await request(app).get(`/api/v1/admin/audit/${first.eventId}`).set(adminHeaders);
    expect(detail.status).toBe(200);
    expect(detail.body.data.eventData).toMatchObject({ eventType: 'CONFIG_CHANGED' });
    expect(detail.body.data.eventHash).toBeTruthy();
  });

  it('rejects non-ADMIN readers', async () => {
    const { app } = createTestRuntime();
    const response = await request(app).get('/api/v1/admin/audit').set(authHeaders);
    expect(response.status).toBe(403);
    expect(response.body.error.errorCode).toBe('OPTIC-AUTHZ-40305');
  });

  it('rejects audit APIs when FEATURE_ADMIN_API is false', async () => {
    const { app } = createTestRuntime({
      featureAdmin: { uiEnabled: true, apiEnabled: false }
    });
    const response = await request(app).get('/api/v1/admin/audit').set(adminHeaders);
    expect(response.status).toBe(403);
    expect(response.body.error.errorCode).toBe('OPTIC-FEATURE-40302');
  });

  it('matches free-text filters as contains, not exact', async () => {
    const { app, audit } = createTestRuntime();
    await seedAudit(audit, {
      eventId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      eventType: 'CONFIG_CHANGED',
      actorId: 'configurator@example.gov',
      actorName: 'Config User',
      definitionKey: 'I_407_MAILITEM',
      entityTrackingId: 'trk-partial-match-99',
      correlationId: 'c-audit-contains-xyz'
    });

    const byActor = await request(app)
      .get('/api/v1/admin/audit')
      .query({ actorId: 'configurator' })
      .set(adminHeaders);
    expect(byActor.status).toBe(200);
    expect(byActor.body.data.items.some((item: { eventId: string }) => item.eventId.endsWith('cccc'))).toBe(
      true
    );

    const byDefinition = await request(app)
      .get('/api/v1/admin/audit')
      .query({ definitionKey: '407_MAIL' })
      .set(adminHeaders);
    expect(byDefinition.body.data.items).toHaveLength(1);

    const byTracking = await request(app)
      .get('/api/v1/admin/audit')
      .query({ entityTrackingId: 'partial-match' })
      .set(adminHeaders);
    expect(byTracking.body.data.items).toHaveLength(1);
  });

  it('returns distinct actor and definition filter options', async () => {
    const { app, audit } = createTestRuntime();
    await seedAudit(audit, {
      eventId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      actorId: 'officer@example.gov',
      actorName: 'Officer One',
      definitionKey: 'I_90'
    });
    await seedAudit(audit, {
      eventId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      actorId: 'admin@example.gov',
      actorName: 'Admin',
      definitionKey: 'api.search'
    });
    await seedAudit(audit, {
      eventId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      actorId: 'admin@example.gov',
      actorName: 'Admin',
      definitionKey: 'api.search'
    });

    const response = await request(app).get('/api/v1/admin/audit/filter-options').set(adminHeaders);
    expect(response.status).toBe(200);
    expect(response.body.data.actors).toEqual(
      expect.arrayContaining([
        { value: 'admin@example.gov', label: 'Admin (admin@example.gov)' },
        { value: 'officer@example.gov', label: 'Officer One (officer@example.gov)' }
      ])
    );
    expect(response.body.data.definitionKeys).toEqual(['api.search', 'I_90']);
  });

  it('pages by page number and page size', async () => {
    const { app, audit } = createTestRuntime();
    for (let index = 0; index < 3; index += 1) {
      await seedAudit(audit, {
        eventId: `00000000-0000-0000-0000-00000000000${index}`,
        eventType: 'SYSTEM_ERROR',
        correlationId: `c-page-${index}`
      });
    }
    const page1 = await request(app)
      .get('/api/v1/admin/audit')
      .query({ eventType: 'SYSTEM_ERROR', page: 1, limit: 2 })
      .set(adminHeaders);
    expect(page1.status).toBe(200);
    expect(page1.body.data.items).toHaveLength(2);
    expect(page1.body.data).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });

    const page2 = await request(app)
      .get('/api/v1/admin/audit')
      .query({ eventType: 'SYSTEM_ERROR', page: 2, limit: 2 })
      .set(adminHeaders);
    expect(page2.status).toBe(200);
    expect(page2.body.data.items).toHaveLength(1);
    expect(page2.body.data).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
  });
});
