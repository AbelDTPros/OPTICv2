import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { seedPublishedLinear } from '../helpers/publish-linear.js';
import { authHeaders, createTestRuntime } from '../helpers/test-app.js';

describe('workflow instance APIs', () => {
  it('rejects unauthenticated create', async () => {
    const { app } = createTestRuntime();
    const response = await request(app).post('/api/v1/workflows').send({
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1',
      definitionKey: 'I_90'
    });
    expect(response.status).toBe(401);
  });

  it('creates an instance and returns a summary', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);

    const created = await request(runtime.app)
      .post('/api/v1/workflows')
      .set(authHeaders)
      .send({
        entityType: 'WORKLOAD',
        entityTrackingId: 'W-2001',
        definitionKey: 'I_90'
      });
    expect(created.status).toBe(201);
    expect(created.body.data.workflow.currentStageKey).toBe('READY_FOR_DATA_ENTRY');
    expect(created.body.data.visits[0].visitNumber).toBe(1);
    expect(created.body.data.visits[0]).toMatchObject({
      enteredBy: 'configurator@example.gov',
      assignedTo: null,
      completedBy: null
    });

    const summary = await request(runtime.app)
      .get('/api/v1/workflows/WORKLOAD/W-2001')
      .set(authHeaders);
    expect(summary.status).toBe(200);
    expect(summary.body.data.definition.definitionKey).toBe('I_90');
    expect(summary.body.data.allowedActions.map((action: { actionKey: string }) => action.actionKey)).toContain(
      'COMPLETE_DATA_ENTRY'
    );
    expect(summary.body.data.stageForm.formKey).toBe('I90_DATA_ENTRY');
    expect(summary.body.data.stageForm.ui.title).toBe('Data Entry');
  });

  it('creates a rehearsal instance against a DRAFT when version is explicit', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    runtime.repository.setLifecycleForTest('I_90', '1.0.0', 'DRAFT');

    const created = await request(runtime.app)
      .post('/api/v1/workflows')
      .set(authHeaders)
      .send({
        entityType: 'WORKLOAD',
        entityTrackingId: 'TRIAL-W-2001',
        definitionKey: 'I_90',
        version: '1.0.0'
      });
    expect(created.status).toBe(201);
    expect(created.body.data.workflow.currentStageKey).toBe('READY_FOR_DATA_ENTRY');
    expect(await runtime.projections.findByEntity('WORKLOAD', 'TRIAL-W-2001')).toBeNull();

    const second = await request(runtime.app)
      .post('/api/v1/workflows')
      .set(authHeaders)
      .send({
        entityType: 'WORKLOAD',
        entityTrackingId: 'TRIAL-W-2002',
        definitionKey: 'I_90',
        version: '1.0.0'
      });
    expect(second.status).toBe(201);

    const listed = await request(runtime.app)
      .get('/api/v1/workflows')
      .query({ definitionKey: 'I_90', version: '1.0.0' })
      .set(authHeaders);
    expect(listed.status).toBe(200);
    expect(listed.body.data.items.map((item: { trackingId: string }) => item.trackingId)).toEqual([
      'TRIAL-W-2001',
      'TRIAL-W-2002'
    ]);
  });

  it('re-enters a stage with an incremented visit_number', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await request(runtime.app)
      .post('/api/v1/workflows')
      .set(authHeaders)
      .send({
        entityType: 'WORKLOAD',
        entityTrackingId: 'W-2002',
        definitionKey: 'I_90',
        version: '1.0.0'
      });

    await request(runtime.app)
      .post('/api/v1/workflows/WORKLOAD/W-2002/stage-visits')
      .set(authHeaders)
      .send({
        stageKey: 'COMPLETED',
        expectedRowVersion: created.body.data.workflow.rowVersion,
        reentry: true
      });
    const reentered = await request(runtime.app)
      .post('/api/v1/workflows/WORKLOAD/W-2002/stage-visits')
      .set(authHeaders)
      .send({
        stageKey: 'READY_FOR_DATA_ENTRY',
        expectedRowVersion: created.body.data.workflow.rowVersion + 1,
        reentry: true
      });

    expect(reentered.status).toBe(200);
    const visits = reentered.body.data.visits.filter(
      (visit: { stageKey: string }) => visit.stageKey === 'READY_FOR_DATA_ENTRY'
    );
    expect(visits.map((visit: { visitNumber: number }) => visit.visitNumber)).toEqual([1, 2]);

    const history = await request(runtime.app)
      .get('/api/v1/workflows/WORKLOAD/W-2002/history')
      .set(authHeaders);
    expect(history.status).toBe(200);
    expect(history.body.data.visits).toHaveLength(3);
  });

  it('rejects a duplicate tracking id', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    await request(runtime.app).post('/api/v1/workflows').set(authHeaders).send({
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-2003',
      definitionKey: 'I_90'
    });
    const duplicate = await request(runtime.app).post('/api/v1/workflows').set(authHeaders).send({
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-2003',
      definitionKey: 'I_90'
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.errorCode).toBe('OPTIC-WF-40902');
  });

  it('assigns to the current actor and rejects a second assignee', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await request(runtime.app).post('/api/v1/workflows').set(authHeaders).send({
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-2004',
      definitionKey: 'I_90'
    });
    const assigned = await request(runtime.app)
      .post('/api/v1/workflows/WORKLOAD/W-2004/assign')
      .set(authHeaders)
      .send({ expectedRowVersion: created.body.data.workflow.rowVersion });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.workflow.assignedTo).toBe('configurator@example.gov');

    const conflicted = await request(runtime.app)
      .post('/api/v1/workflows/WORKLOAD/W-2004/assign')
      .set({ Authorization: 'Bearer dev-token', 'X-Actor-Id': 'other@example.gov' })
      .send({ expectedRowVersion: assigned.body.data.workflow.rowVersion });
    expect(conflicted.status).toBe(409);
    expect(conflicted.body.error.errorCode).toBe('OPTIC-WF-40903');
    expect(conflicted.body.error.details[0].currentRowVersion).toBeDefined();

    const released = await request(runtime.app)
      .post('/api/v1/workflows/WORKLOAD/W-2004/release')
      .set(authHeaders)
      .send({ expectedRowVersion: assigned.body.data.workflow.rowVersion });
    expect(released.status).toBe(200);
    expect(released.body.data.workflow.assignedTo).toBeNull();
  });

  it('lets a supervisor reassign an item and rejects officers', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await request(runtime.app).post('/api/v1/workflows').set(authHeaders).send({
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-2099',
      definitionKey: 'I_90'
    });
    const assigned = await request(runtime.app)
      .post('/api/v1/workflows/WORKLOAD/W-2099/assign')
      .set(authHeaders)
      .send({ expectedRowVersion: created.body.data.workflow.rowVersion });

    const denied = await request(runtime.app)
      .post('/api/v1/workflows/WORKLOAD/W-2099/reassign')
      .set(authHeaders)
      .send({ expectedRowVersion: assigned.body.data.workflow.rowVersion, assignedTo: 'other@example.gov' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.errorCode).toBe('OPTIC-AUTHZ-40303');

    const reassigned = await request(runtime.app)
      .post('/api/v1/workflows/WORKLOAD/W-2099/reassign')
      .set({
        Authorization: 'Bearer dev-token',
        'X-Actor-Id': 'supervisor@example.gov',
        'X-Actor-Roles': 'SUPERVISOR'
      })
      .send({ expectedRowVersion: assigned.body.data.workflow.rowVersion, assignedTo: 'other@example.gov' });
    expect(reassigned.status).toBe(200);
    expect(reassigned.body.data.workflow.assignedTo).toBe('other@example.gov');
    expect(runtime.outbox.events.some((event) => event.eventType === 'WORKLOAD_REASSIGNED')).toBe(true);
  });

  it('saves allowed stage data after assign and returns businessData', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await request(runtime.app).post('/api/v1/workflows').set(authHeaders).send({
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-2005',
      definitionKey: 'I_90'
    });
    const assigned = await request(runtime.app)
      .post('/api/v1/workflows/WORKLOAD/W-2005/assign')
      .set(authHeaders)
      .send({ expectedRowVersion: created.body.data.workflow.rowVersion });
    const saved = await request(runtime.app)
      .patch('/api/v1/workflows/WORKLOAD/W-2005/data')
      .set(authHeaders)
      .send({
        expectedRowVersion: assigned.body.data.workflow.rowVersion,
        dataPatch: { dataEntryDetails: { receiptNumber: 'ABC1234567890' } }
      });
    expect(saved.status).toBe(200);
    expect(saved.body.data.businessData.dataEntryDetails.receiptNumber).toBe('ABC1234567890');

    const summary = await request(runtime.app)
      .get('/api/v1/workflows/WORKLOAD/W-2005')
      .set(authHeaders);
    expect(summary.body.data.businessData.dataEntryDetails.receiptNumber).toBe('ABC1234567890');

    const denied = await request(runtime.app)
      .patch('/api/v1/workflows/WORKLOAD/W-2005/data')
      .set(authHeaders)
      .send({
        expectedRowVersion: saved.body.data.workflow.rowVersion,
        dataPatch: { fraudReview: { notes: 'no' } }
      });
    expect(denied.status).toBe(400);
    expect(denied.body.error.errorCode).toBe('OPTIC-WF-40047');
  });

  it('executes COMPLETE_DATA_ENTRY and returns the destination stage', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await request(runtime.app).post('/api/v1/workflows').set(authHeaders).send({
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-2006',
      definitionKey: 'I_90'
    });
    const assigned = await request(runtime.app)
      .post('/api/v1/workflows/WORKLOAD/W-2006/assign')
      .set(authHeaders)
      .send({ expectedRowVersion: created.body.data.workflow.rowVersion });
    const executed = await request(runtime.app)
      .post('/api/v1/workflows/WORKLOAD/W-2006/actions/COMPLETE_DATA_ENTRY')
      .set(authHeaders)
      .send({
        expectedRowVersion: assigned.body.data.workflow.rowVersion,
        dataPatch: { dataEntryDetails: { receiptNumber: 'ABC1234567890' } }
      });
    expect(executed.status).toBe(200);
    expect(executed.body.data.workflow.currentStageKey).toBe('COMPLETED');
    expect(executed.body.data.workflow.assignedTo).toBeNull();
    expect(executed.body.data.status).toBe('COMPLETED');
  });

  it('replays assign with the same idempotency key and rejects a different body', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await request(runtime.app).post('/api/v1/workflows').set(authHeaders).send({
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-2007',
      definitionKey: 'I_90'
    });
    const first = await request(runtime.app)
      .post('/api/v1/workflows/WORKLOAD/W-2007/assign')
      .set({ ...authHeaders, 'X-Idempotency-Key': 'assign-1' })
      .send({ expectedRowVersion: created.body.data.workflow.rowVersion });
    const replayed = await request(runtime.app)
      .post('/api/v1/workflows/WORKLOAD/W-2007/assign')
      .set({ ...authHeaders, 'X-Idempotency-Key': 'assign-1' })
      .send({ expectedRowVersion: created.body.data.workflow.rowVersion });
    expect(first.status).toBe(200);
    expect(replayed.status).toBe(200);
    expect(replayed.body.data.workflow.rowVersion).toBe(first.body.data.workflow.rowVersion);
    expect(replayed.body.meta.idempotencyKey).toBe('assign-1');

    const conflicted = await request(runtime.app)
      .post('/api/v1/workflows/WORKLOAD/W-2007/assign')
      .set({ ...authHeaders, 'X-Idempotency-Key': 'assign-1' })
      .send({ expectedRowVersion: 99 });
    expect(conflicted.status).toBe(409);
    expect(conflicted.body.error.errorCode).toBe('OPTIC-WF-40906');
  });

  it('serves WORKLOAD aliases and spec-style workflow paths', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    await request(runtime.app).post('/api/v1/workflows').set(authHeaders).send({
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-2008',
      definitionKey: 'I_90'
    });
    const summary = await request(runtime.app).get('/api/v1/workloads/W-2008').set(authHeaders);
    expect(summary.status).toBe(200);
    expect(summary.body.data.entityType).toBe('WORKLOAD');

    const assigned = await request(runtime.app)
      .post('/api/v1/workflows/W-2008/assign')
      .set(authHeaders)
      .send({ expectedRowVersion: summary.body.data.workflow.rowVersion });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.workflow.assignedTo).toBe('configurator@example.gov');

    const saved = await request(runtime.app)
      .patch('/api/v1/workloads/W-2008/data')
      .set(authHeaders)
      .send({
        expectedRowVersion: assigned.body.data.workflow.rowVersion,
        dataPatch: { dataEntryDetails: {} }
      });
    expect(saved.status).toBe(200);
  });

  it('rejects stage-visits without an explicit reentry flag', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    const created = await request(runtime.app).post('/api/v1/workflows').set(authHeaders).send({
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-2009',
      definitionKey: 'I_90'
    });
    const skipped = await request(runtime.app)
      .post('/api/v1/workflows/WORKLOAD/W-2009/stage-visits')
      .set(authHeaders)
      .send({
        stageKey: 'COMPLETED',
        expectedRowVersion: created.body.data.workflow.rowVersion
      });
    expect(skipped.status).toBe(400);
  });

  it('opens a case from a scanned label payload', async () => {
    const runtime = createTestRuntime();
    await seedPublishedLinear(runtime);
    await request(runtime.app).post('/api/v1/workflows').set(authHeaders).send({
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-SCAN-1',
      definitionKey: 'I_90'
    });
    const scanned = await request(runtime.app)
      .get('/api/v1/workflows/scan')
      .query({ q: 'OPTIC:WORKLOAD:W-SCAN-1' })
      .set(authHeaders);
    expect(scanned.status).toBe(200);
    expect(scanned.body.data.matches).toHaveLength(1);
    expect(scanned.body.data.matches[0].trackingId).toBe('W-SCAN-1');
  });
});

