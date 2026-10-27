import { bulkRelease } from '../fixtures/definitions/bulk.js';
import type { createTestRuntime } from './test-app.js';

const actor = {
  actorId: 'configurator@example.gov',
  roles: ['CONFIGURATOR'],
  correlationId: 'c-publish-bulk'
};

export async function seedPublishedBulk(
  runtime: ReturnType<typeof createTestRuntime>,
  version = '1.0.0'
): Promise<{ releaseId: string }> {
  await runtime.service.createDefinition(actor, {
    definitionKey: 'I_131_BULK',
    displayName: 'I-131 Bulk Shipping',
    entityType: 'WORKLOAD'
  });
  const draft = await runtime.service.createDraftRelease(actor, { definitionKey: 'I_131_BULK', version });
  let rowVersion = 0;
  await runtime.service.saveSchema(actor, {
    definitionKey: 'I_131_BULK',
    version,
    expectedRowVersion: rowVersion++,
    payload: bulkRelease.schema
  });
  await runtime.service.saveWorkflow(actor, {
    definitionKey: 'I_131_BULK',
    version,
    expectedRowVersion: rowVersion++,
    payload: bulkRelease.workflow
  });
  for (const form of Object.values(bulkRelease.forms)) {
    await runtime.service.saveForm(actor, {
      definitionKey: 'I_131_BULK',
      version,
      expectedRowVersion: rowVersion++,
      payload: form
    });
  }
  for (const queue of Object.values(bulkRelease.queues)) {
    await runtime.service.saveQueue(actor, {
      definitionKey: 'I_131_BULK',
      version,
      expectedRowVersion: rowVersion++,
      payload: queue
    });
  }
  for (const bulk of Object.values(bulkRelease.bulkActions)) {
    await runtime.service.saveBulkAction(actor, {
      definitionKey: 'I_131_BULK',
      version,
      expectedRowVersion: rowVersion++,
      payload: bulk
    });
  }
  runtime.repository.setLifecycleForTest('I_131_BULK', version, 'PUBLISHED');
  runtime.repository.setActiveReleaseForTest('I_131_BULK', version);
  return { releaseId: draft.id };
}
