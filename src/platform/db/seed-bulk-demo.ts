import { pathToFileURL } from 'node:url';
import { loadConfig } from '../../config/env.js';
import { createConfigurationRuntime } from '../../modules/configuration/runtime.js';
import { bulkRelease } from '../../modules/bulk/fixtures/i131-bulk.js';
import { AppError } from '../errors/app-error.js';
import { log } from '../logging/logger.js';
import { closePool } from './pool.js';
import type { ActorContext } from '../security/actor.js';
import type { DefinitionReleaseService } from '../../modules/configuration/service/definition-release.service.js';
import type { WorkflowInstanceService } from '../../modules/workflow/service/workflow-instance.service.js';
import { seedI407Demo } from './seed-i407-demo.js';

const DEFINITION_KEY = 'I_131_BULK';
const VERSION = '1.0.0';
const DEMO_TRACKING_IDS = ['W-DEMO-SHIP-1', 'W-DEMO-SHIP-2'];

const author: ActorContext = {
  actorId: 'author@example.gov',
  roles: ['CONFIGURATOR'],
  correlationId: 'c-seed-bulk-author'
};
const approver: ActorContext = {
  actorId: 'approver@example.gov',
  roles: ['APPROVER'],
  correlationId: 'c-seed-bulk-approver'
};
const publisher: ActorContext = {
  actorId: 'publisher@example.gov',
  roles: ['PUBLISHER'],
  correlationId: 'c-seed-bulk-publisher'
};
const officer: ActorContext = {
  actorId: 'officer@example.gov',
  roles: ['OFFICER'],
  correlationId: 'c-seed-bulk-officer'
};
const officerB: ActorContext = {
  actorId: 'jordan.officer@example.gov',
  roles: ['OFFICER'],
  correlationId: 'c-seed-bulk-officer-b'
};
const supervisor: ActorContext = {
  actorId: 'supervisor@example.gov',
  roles: ['SUPERVISOR'],
  correlationId: 'c-seed-bulk-supervisor'
};
const DEMO_ASSIGNEES: Record<string, ActorContext> = {
  'W-DEMO-SHIP-1': officer,
  'W-DEMO-SHIP-2': officerB
};

export async function seedBulkDemo(): Promise<void> {
  const config = loadConfig();
  const runtime = createConfigurationRuntime(config);
  await ensurePublishedBulk(runtime.service);
  await ensureDemoInstances(runtime.workflow);
  await seedI407Demo(runtime);
}

async function ensurePublishedBulk(service: DefinitionReleaseService): Promise<void> {
  const definitions = await service.listDefinitions(author);
  const existing = definitions.find((item) => item.definitionKey === DEFINITION_KEY);
  if (existing?.activeReleaseId) {
    log('info', 'Bulk shipping definition is already active', {
      event: 'seed.bulk.definition.exists',
      definitionKey: DEFINITION_KEY
    });
    return;
  }

  if (existing) {
    try {
      const release = await service.getRelease(author, DEFINITION_KEY, VERSION);
      if (release.lifecycleStatus === 'PUBLISHED') {
        await service.activate(publisher, {
          definitionKey: DEFINITION_KEY,
          version: VERSION,
          expectedRowVersion: release.rowVersion
        });
        log('info', 'Activated existing published bulk shipping definition', {
          event: 'seed.bulk.definition.activated',
          definitionKey: DEFINITION_KEY
        });
        return;
      }
      throw new Error(
        `${DEFINITION_KEY} ${VERSION} exists as ${release.lifecycleStatus}. Finish or replace that release before seeding.`
      );
    } catch (error: unknown) {
      if (!(error instanceof AppError) || error.errorCode !== 'OPTIC-CONFIG-40402') {
        throw error;
      }
    }
  } else {
    await service.createDefinition(author, {
      definitionKey: DEFINITION_KEY,
      displayName: bulkRelease.displayName,
      entityType: 'WORKLOAD'
    });
  }

  const drafted = await authorBulkDraft(service);
  const submitted = await service.submit(author, {
    definitionKey: DEFINITION_KEY,
    version: VERSION,
    expectedRowVersion: drafted.rowVersion
  });
  const approved = await service.approve(approver, {
    definitionKey: DEFINITION_KEY,
    version: VERSION,
    expectedRowVersion: submitted.rowVersion
  });
  const published = await service.publish(publisher, {
    definitionKey: DEFINITION_KEY,
    version: VERSION,
    expectedRowVersion: approved.rowVersion
  });
  await service.activate(publisher, {
    definitionKey: DEFINITION_KEY,
    version: VERSION,
    expectedRowVersion: published.rowVersion
  });
  log('info', 'Published I_131_BULK for the live shipping queue', {
    event: 'seed.bulk.definition.published',
    definitionKey: DEFINITION_KEY,
    version: VERSION
  });
}

async function authorBulkDraft(service: DefinitionReleaseService): Promise<{ rowVersion: number }> {
  await service.createDraftRelease(author, { definitionKey: DEFINITION_KEY, version: VERSION });
  let rowVersion = 0;
  await service.saveSchema(author, {
    definitionKey: DEFINITION_KEY,
    version: VERSION,
    expectedRowVersion: rowVersion++,
    payload: bulkRelease.schema
  });
  await service.saveWorkflow(author, {
    definitionKey: DEFINITION_KEY,
    version: VERSION,
    expectedRowVersion: rowVersion++,
    payload: bulkRelease.workflow
  });
  for (const form of Object.values(bulkRelease.forms)) {
    await service.saveForm(author, {
      definitionKey: DEFINITION_KEY,
      version: VERSION,
      expectedRowVersion: rowVersion++,
      payload: form
    });
  }
  for (const queue of Object.values(bulkRelease.queues)) {
    await service.saveQueue(author, {
      definitionKey: DEFINITION_KEY,
      version: VERSION,
      expectedRowVersion: rowVersion++,
      payload: queue
    });
  }
  for (const bulk of Object.values(bulkRelease.bulkActions)) {
    await service.saveBulkAction(author, {
      definitionKey: DEFINITION_KEY,
      version: VERSION,
      expectedRowVersion: rowVersion++,
      payload: bulk
    });
  }
  return { rowVersion };
}

async function ensureDemoInstances(workflow: WorkflowInstanceService): Promise<void> {
  for (const trackingId of DEMO_TRACKING_IDS) {
    const assignee = DEMO_ASSIGNEES[trackingId] ?? officer;
    let summary;
    try {
      summary = await workflow.getSummary(officer, 'WORKLOAD', trackingId);
      log('info', 'Demo shipping instance already exists', {
        event: 'seed.bulk.instance.exists',
        entityTrackingId: trackingId
      });
    } catch (error: unknown) {
      if (!(error instanceof AppError) || error.errorCode !== 'OPTIC-WF-40410') {
        throw error;
      }
      summary = await workflow.createInstance(officer, {
        entityType: 'WORKLOAD',
        entityTrackingId: trackingId,
        definitionKey: DEFINITION_KEY
      });
      log('info', 'Created demo shipping instance', {
        event: 'seed.bulk.instance.created',
        entityTrackingId: trackingId
      });
    }
    if (!summary.workflow.assignedTo) {
      await workflow.assignToSelf(assignee, {
        entityType: 'WORKLOAD',
        entityTrackingId: trackingId,
        expectedRowVersion: summary.workflow.rowVersion
      });
      log('info', 'Assigned demo shipping instance', {
        event: 'seed.bulk.instance.assigned',
        entityTrackingId: trackingId,
        assignedTo: assignee.actorId
      });
    } else if (summary.workflow.assignedTo !== assignee.actorId) {
      await workflow.reassign(supervisor, {
        entityType: 'WORKLOAD',
        entityTrackingId: trackingId,
        expectedRowVersion: summary.workflow.rowVersion,
        assignedTo: assignee.actorId
      });
      log('info', 'Reassigned demo shipping instance', {
        event: 'seed.bulk.instance.reassigned',
        entityTrackingId: trackingId,
        assignedTo: assignee.actorId
      });
    }
  }
}

const isCli = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  seedBulkDemo()
    .then(async () => {
      log('info', 'Demo seed complete (I-131 shipping and I-407)', { event: 'seed.bulk.complete' });
      await closePool();
    })
    .catch(async (error: unknown) => {
      log('error', 'Bulk shipping demo seed failed', {
        event: 'seed.bulk.failed',
        error: error instanceof Error ? error.message : 'unknown'
      });
      process.exitCode = 1;
      await closePool();
    });
}
