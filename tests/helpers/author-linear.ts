import type { ActorContext } from '../../src/platform/security/actor.js';
import type { DefinitionReleaseService } from '../../src/modules/configuration/service/definition-release.service.js';
import { linearRelease } from '../fixtures/definitions/linear.js';

export async function authorLinearDraft(
  service: DefinitionReleaseService,
  actor: ActorContext,
  options: { definitionKey?: string; version?: string } = {}
): Promise<{ rowVersion: number }> {
  const definitionKey = options.definitionKey ?? 'I_90';
  const version = options.version ?? '1.0.0';
  if (!(await service.listDefinitions(actor)).some((item) => item.definitionKey === definitionKey)) {
    await service.createDefinition(actor, {
      definitionKey,
      displayName: linearRelease.displayName,
      entityType: 'WORKLOAD'
    });
  }
  await service.createDraftRelease(actor, { definitionKey, version });
  let rowVersion = 0;
  await service.saveSchema(actor, {
    definitionKey,
    version,
    expectedRowVersion: rowVersion++,
    payload: linearRelease.schema
  });
  await service.saveWorkflow(actor, {
    definitionKey,
    version,
    expectedRowVersion: rowVersion++,
    payload: linearRelease.workflow
  });
  for (const form of Object.values(linearRelease.forms)) {
    await service.saveForm(actor, {
      definitionKey,
      version,
      expectedRowVersion: rowVersion++,
      payload: form
    });
  }
  for (const action of Object.values(linearRelease.actions)) {
    await service.saveAction(actor, {
      definitionKey,
      version,
      expectedRowVersion: rowVersion++,
      payload: action
    });
  }
  for (const queue of Object.values(linearRelease.queues)) {
    await service.saveQueue(actor, {
      definitionKey,
      version,
      expectedRowVersion: rowVersion++,
      payload: queue
    });
  }
  for (const scheduled of Object.values(linearRelease.scheduledActions)) {
    await service.saveScheduledAction(actor, {
      definitionKey,
      version,
      expectedRowVersion: rowVersion++,
      payload: scheduled
    });
  }
  await service.saveSearch(actor, {
    definitionKey,
    version,
    expectedRowVersion: rowVersion++,
    payload: linearRelease.search
  });
  return { rowVersion };
}
