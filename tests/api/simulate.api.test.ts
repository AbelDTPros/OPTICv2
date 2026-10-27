import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { branchingRelease } from '../fixtures/definitions/branching.js';
import { authHeaders, createTestRuntime } from '../helpers/test-app.js';

const actor = {
  actorId: 'configurator@example.gov',
  roles: ['CONFIGURATOR'],
  correlationId: 'c-simulate'
};

async function seedBranchingDraft() {
  const runtime = createTestRuntime();
  await runtime.service.createDefinition(actor, {
    definitionKey: 'I_407',
    displayName: 'I-407',
    entityType: 'WORKLOAD'
  });
  await runtime.service.createDraftRelease(actor, { definitionKey: 'I_407', version: '0.1.0' });
  let rowVersion = 0;
  await runtime.service.saveSchema(actor, {
    definitionKey: 'I_407',
    version: '0.1.0',
    expectedRowVersion: rowVersion++,
    payload: branchingRelease.schema
  });
  await runtime.service.saveWorkflow(actor, {
    definitionKey: 'I_407',
    version: '0.1.0',
    expectedRowVersion: rowVersion++,
    payload: branchingRelease.workflow
  });
  for (const form of Object.values(branchingRelease.forms)) {
    await runtime.service.saveForm(actor, {
      definitionKey: 'I_407',
      version: '0.1.0',
      expectedRowVersion: rowVersion++,
      payload: form
    });
  }
  for (const action of Object.values(branchingRelease.actions)) {
    await runtime.service.saveAction(actor, {
      definitionKey: 'I_407',
      version: '0.1.0',
      expectedRowVersion: rowVersion++,
      payload: action
    });
  }
  for (const queue of Object.values(branchingRelease.queues)) {
    await runtime.service.saveQueue(actor, {
      definitionKey: 'I_407',
      version: '0.1.0',
      expectedRowVersion: rowVersion++,
      payload: queue
    });
  }
  for (const bulkAction of Object.values(branchingRelease.bulkActions)) {
    await runtime.service.saveBulkAction(actor, {
      definitionKey: 'I_407',
      version: '0.1.0',
      expectedRowVersion: rowVersion++,
      payload: bulkAction
    });
  }
  for (const sla of Object.values(branchingRelease.slas)) {
    await runtime.service.saveSla(actor, {
      definitionKey: 'I_407',
      version: '0.1.0',
      expectedRowVersion: rowVersion++,
      payload: sla
    });
  }
  return runtime;
}

describe('simulate API', () => {
  it('requires authentication', async () => {
    const { app } = createTestRuntime();
    const response = await request(app)
      .post('/api/v1/config/definitions/I_407/releases/0.1.0/simulate')
      .send({ transitionSetKey: 'COMPLETE_PAYMENT', businessData: {} });
    expect(response.status).toBe(401);
  });

  it('routes a rejected Pay.gov payment to REJECTED and redacts raw values', async () => {
    const { app } = await seedBranchingDraft();
    const response = await request(app)
      .post('/api/v1/config/definitions/I_407/releases/0.1.0/simulate')
      .set(authHeaders)
      .send({
        transitionSetKey: 'COMPLETE_PAYMENT',
        businessData: {
          paymentDetails: { details: { payGovReadyDetails: { rejected: true } } },
          dataEntryDetails: { ANumber: 'A123456789', fraudReferralRequired: true }
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.data.targetStageKey).toBe('REJECTED');
    expect(response.body.data.matchedRuleKey).toBe('PAYMENT_REJECTED');
    expect(response.body.data.usedDefault).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain('A123456789');
  });

  it('uses the default target when no rule matches', async () => {
    const { app } = await seedBranchingDraft();
    const response = await request(app)
      .post('/api/v1/config/definitions/I_407/releases/0.1.0/simulate')
      .set(authHeaders)
      .send({
        transitionSetKey: 'COMPLETE_PAYMENT',
        businessData: {
          paymentDetails: { details: { payGovReadyDetails: { rejected: false } } },
          dataEntryDetails: { fraudReferralRequired: false }
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.data.targetStageKey).toBe('READY_FOR_SHIPPING');
    expect(response.body.data.usedDefault).toBe(true);
  });

  it('fails closed for an unknown transition set', async () => {
    const { app } = await seedBranchingDraft();
    const response = await request(app)
      .post('/api/v1/config/definitions/I_407/releases/0.1.0/simulate')
      .set(authHeaders)
      .send({ transitionSetKey: 'DOES_NOT_EXIST', businessData: {} });
    expect(response.status).toBe(400);
    expect(response.body.error.errorCode).toBe('OPTIC-CONFIG-40023');
  });
});
