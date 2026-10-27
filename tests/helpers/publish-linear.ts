import { linearRelease } from '../fixtures/definitions/linear.js';
import type { createTestRuntime } from './test-app.js';

const actor = {
  actorId: 'configurator@example.gov',
  roles: ['CONFIGURATOR'],
  correlationId: 'c-publish-linear'
};

export async function seedPublishedLinear(
  runtime: ReturnType<typeof createTestRuntime>,
  version = '1.0.0',
  definitionKey = 'I_90'
): Promise<{ releaseId: string }> {
  await runtime.service.createDefinition(actor, {
    definitionKey,
    displayName: `${definitionKey} Linear`,
    entityType: 'WORKLOAD'
  });
  const draft = await runtime.service.createDraftRelease(actor, { definitionKey, version });
  let rowVersion = 0;
  await runtime.service.saveSchema(actor, {
    definitionKey,
    version,
    expectedRowVersion: rowVersion++,
    payload: linearRelease.schema
  });
  await runtime.service.saveWorkflow(actor, {
    definitionKey,
    version,
    expectedRowVersion: rowVersion++,
    payload: linearRelease.workflow
  });
  for (const form of Object.values(linearRelease.forms)) {
    await runtime.service.saveForm(actor, {
      definitionKey,
      version,
      expectedRowVersion: rowVersion++,
      payload: form
    });
  }
  for (const action of Object.values(linearRelease.actions)) {
    await runtime.service.saveAction(actor, {
      definitionKey,
      version,
      expectedRowVersion: rowVersion++,
      payload: action
    });
  }
  for (const queue of Object.values(linearRelease.queues)) {
    await runtime.service.saveQueue(actor, {
      definitionKey,
      version,
      expectedRowVersion: rowVersion++,
      payload: queue
    });
  }
  for (const scheduled of Object.values(linearRelease.scheduledActions)) {
    await runtime.service.saveScheduledAction(actor, {
      definitionKey,
      version,
      expectedRowVersion: rowVersion++,
      payload: scheduled
    });
  }
  await runtime.service.saveSearch(actor, {
    definitionKey,
    version,
    expectedRowVersion: rowVersion++,
    payload: linearRelease.search
  });
  runtime.repository.setLifecycleForTest(definitionKey, version, 'PUBLISHED');
  runtime.repository.setActiveReleaseForTest(definitionKey, version);
  return { releaseId: draft.id };
}
