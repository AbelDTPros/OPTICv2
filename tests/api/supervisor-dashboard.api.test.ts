import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { seedPublishedLinear } from '../helpers/publish-linear.js';
import { authHeaders, createTestRuntime } from '../helpers/test-app.js';

const supervisorHeaders = {
  ...authHeaders,
  'X-Actor-Id': 'supervisor@example.gov',
  'X-Actor-Roles': 'SUPERVISOR'
};

const configurator = {
  actorId: 'configurator@example.gov',
  roles: ['CONFIGURATOR'],
  correlationId: 'c-dash-indexed'
};

describe('supervisor dashboard API', () => {
  it('rejects actors without SUPERVISOR or ADMIN', async () => {
    const { app } = createTestRuntime();
    const response = await request(app)
      .get('/api/v1/supervisor/dashboard')
      .query({ definitionKey: 'I_407' })
      .set(authHeaders);
    expect(response.status).toBe(403);
    expect(response.body.error.errorCode).toBe('OPTIC-AUTHZ-40306');
  });

  it('aggregates open backlog, logged today, and recent activity', async () => {
    const { app, projections, audit } = createTestRuntime();
    const now = new Date();
    await projections.upsert({
      workflowInstanceId: 1,
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-DASHBOARD1',
      definitionKey: 'I_407',
      definitionReleaseId: 9,
      workloadType: 'I-407',
      currentStageKey: 'DATA_ENTRY',
      assignedTo: null,
      branchKey: null,
      locationKey: null,
      priority: null,
      receivedAt: now,
      enteredStageAt: new Date(now.getTime() - 3 * 3_600_000),
      slaState: 'BREACHED',
      receiptNumber: null,
      status: 'ACTIVE',
      rowVersion: 1,
      projectedJson: {},
      updatedAt: now
    });
    await projections.upsert({
      workflowInstanceId: 2,
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-DASHBOARD2',
      definitionKey: 'I_407',
      definitionReleaseId: 9,
      workloadType: 'I-407',
      currentStageKey: 'COMPLETED',
      assignedTo: null,
      branchKey: null,
      locationKey: null,
      priority: null,
      receivedAt: new Date(now.getTime() - 86_400_000 * 3),
      enteredStageAt: now,
      slaState: null,
      receiptNumber: null,
      status: 'COMPLETED',
      rowVersion: 2,
      projectedJson: {},
      updatedAt: now
    });
    await audit.append({
      eventId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      eventType: 'WORKLOAD_ASSIGNED',
      occurredAt: now,
      actorId: 'supervisor@example.gov',
      actorName: 'Supervisor',
      sessionId: null,
      correlationId: 'c-dash-1',
      sourceService: 'api-server',
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-DASHBOARD1',
      definitionKey: 'I_407',
      definitionVersion: '1.0.0',
      stageKey: 'DATA_ENTRY',
      actionKey: null,
      eventData: { eventType: 'WORKLOAD_ASSIGNED' }
    });

    const response = await request(app)
      .get('/api/v1/supervisor/dashboard')
      .query({ definitionKey: 'I_407' })
      .set(supervisorHeaders);
    expect(response.status).toBe(200);
    expect(response.body.data.dimensions).toEqual([]);
    expect(response.body.data.appliedFilters).toEqual({});
    expect(response.body.data.kpis).toMatchObject({
      loggedToday: 1,
      openBacklog: 1,
      pastSla: 1
    });
    expect(response.body.data.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stageKey: 'DATA_ENTRY',
          count: 1,
          lateCount: 1
        })
      ])
    );
    expect(response.body.data.pressure[0]).toMatchObject({
      stageKey: 'DATA_ENTRY',
      lateCount: 1
    });
    expect(response.body.data.assignees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assignedTo: null,
          label: 'Unassigned',
          count: 1,
          lateCount: 1,
          cases: expect.arrayContaining([
            expect.objectContaining({
              trackingId: 'W-DASHBOARD1',
              pastSla: true,
              assignedTo: null
            })
          ])
        })
      ])
    );
    expect(response.body.data.actionQueue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trackingId: 'W-DASHBOARD1',
          pastSla: true,
          assignedTo: null
        })
      ])
    );
    expect(response.body.data.recentActivity).toHaveLength(1);
    expect(response.body.data.recentActivity[0].summary).toMatch(/claimed/i);
  });

  it('filters KPIs by Catalog indexed fields marked for Dashboard', async () => {
    const runtime = createTestRuntime();
    const { releaseId } = await seedPublishedLinear(runtime);
    runtime.repository.setLifecycleForTest('I_90', '1.0.0', 'DRAFT');
    const release = await runtime.repository.findReleaseByKeyAndVersion('I_90', '1.0.0');
    expect(release).toBeTruthy();
    await runtime.service.saveSearch(configurator, {
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
            fieldKey: 'location',
            source: 'BUSINESS_DATA',
            path: '$.dataEntryDetails.location',
            match: 'EXACT_PREFIX',
            pii: false,
            useInSearch: false,
            useInDashboard: true
          }
        ]
      }
    });
    runtime.repository.setLifecycleForTest('I_90', '1.0.0', 'PUBLISHED');
    runtime.repository.setActiveReleaseForTest('I_90', '1.0.0');
    runtime.loader.getCache().clear();

    const now = new Date();
    await runtime.projections.upsert({
      workflowInstanceId: 11,
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-LOC-A',
      definitionKey: 'I_90',
      definitionReleaseId: Number(releaseId),
      workloadType: 'I-90',
      currentStageKey: 'READY_FOR_DATA_ENTRY',
      assignedTo: null,
      branchKey: null,
      locationKey: null,
      priority: null,
      receivedAt: now,
      enteredStageAt: now,
      slaState: null,
      receiptNumber: null,
      status: 'ACTIVE',
      rowVersion: 1,
      projectedJson: { location: 'Atlanta' },
      updatedAt: now
    });
    await runtime.projections.upsert({
      workflowInstanceId: 12,
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-LOC-B',
      definitionKey: 'I_90',
      definitionReleaseId: Number(releaseId),
      workloadType: 'I-90',
      currentStageKey: 'READY_FOR_DATA_ENTRY',
      assignedTo: null,
      branchKey: null,
      locationKey: null,
      priority: null,
      receivedAt: now,
      enteredStageAt: now,
      slaState: null,
      receiptNumber: null,
      status: 'ACTIVE',
      rowVersion: 1,
      projectedJson: { location: 'Boston' },
      updatedAt: now
    });

    const unfiltered = await request(runtime.app)
      .get('/api/v1/supervisor/dashboard')
      .query({ definitionKey: 'I_90' })
      .set(supervisorHeaders);
    expect(unfiltered.status).toBe(200);
    expect(unfiltered.body.data.dimensions).toEqual([
      expect.objectContaining({ fieldKey: 'location', match: 'EXACT_PREFIX' })
    ]);
    expect(unfiltered.body.data.kpis.openBacklog).toBe(2);

    const filtered = await request(runtime.app)
      .get('/api/v1/supervisor/dashboard')
      .query({ definitionKey: 'I_90', 'filter.location': 'Atl' })
      .set(supervisorHeaders);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.appliedFilters).toEqual({ location: 'Atl' });
    expect(filtered.body.data.kpis.openBacklog).toBe(1);
    expect(filtered.body.data.actionQueue).toEqual([
      expect.objectContaining({ trackingId: 'W-LOC-A' })
    ]);
  });
});
