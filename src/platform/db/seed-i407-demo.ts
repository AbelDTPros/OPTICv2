import { pathToFileURL } from 'node:url';
import { loadConfig } from '../../config/env.js';
import { i407MailRelease, i407WorkloadRelease } from '../../modules/configuration/fixtures/i407.js';
import { createConfigurationRuntime } from '../../modules/configuration/runtime.js';
import type { DefinitionRelease } from '../../modules/configuration/domain/types.js';
import type { DefinitionReleaseService } from '../../modules/configuration/service/definition-release.service.js';
import type { WorkflowInstanceService } from '../../modules/workflow/service/workflow-instance.service.js';
import { AppError } from '../errors/app-error.js';
import { log } from '../logging/logger.js';
import { closePool } from './pool.js';
import type { ActorContext } from '../security/actor.js';

const PUBLISHED_VERSION = '1.0.0';
const DRAFT_VERSION = '1.1.0';

const MAIL_KEY = i407MailRelease.definitionKey;
const WORKLOAD_KEY = i407WorkloadRelease.definitionKey;

const DEMO_CASES = [
  { entityType: 'MAIL' as const, trackingId: 'M-DEMO-I407-1', definitionKey: MAIL_KEY },
  { entityType: 'WORKLOAD' as const, trackingId: 'W-DEMO-I407-1', definitionKey: WORKLOAD_KEY }
];

const author: ActorContext = {
  actorId: 'author@example.gov',
  roles: ['CONFIGURATOR'],
  correlationId: 'c-seed-i407-author'
};
const approver: ActorContext = {
  actorId: 'approver@example.gov',
  roles: ['APPROVER'],
  correlationId: 'c-seed-i407-approver'
};
const publisher: ActorContext = {
  actorId: 'publisher@example.gov',
  roles: ['PUBLISHER'],
  correlationId: 'c-seed-i407-publisher'
};
const officer: ActorContext = {
  actorId: 'officer@example.gov',
  roles: ['OFFICER'],
  correlationId: 'c-seed-i407-officer'
};

export async function seedI407Demo(
  runtime: ReturnType<typeof createConfigurationRuntime> = createConfigurationRuntime(loadConfig())
): Promise<void> {
  await ensurePublishedAndDraft(runtime.service, i407WorkloadRelease);
  await ensurePublishedAndDraft(runtime.service, i407MailRelease);
  await ensureDemoInstances(runtime.workflow);
}

async function ensurePublishedAndDraft(
  service: DefinitionReleaseService,
  release: DefinitionRelease
): Promise<void> {
  const definitionKey = release.definitionKey;
  const definitions = await service.listDefinitions(author);
  const existing = definitions.find((item) => item.definitionKey === definitionKey);
  const catalog = await service.listReleaseCatalog(author);
  const versions = catalog.filter((item) => item.definitionKey === definitionKey);
  const hasDraft = versions.some((item) => item.lifecycleStatus === 'DRAFT');

  if (!existing) {
    await service.createDefinition(author, {
      definitionKey,
      displayName: release.displayName,
      entityType: release.entityType
    });
  }

  if (existing?.activeReleaseId) {
    const active = await service.getReleaseById(author, existing.activeReleaseId);
    if (sameSeedPackage(active, release)) {
      log('info', 'I-407 definition is already active', {
        event: 'seed.i407.definition.exists',
        definitionKey
      });
    } else {
      const version = nextReleaseVersion(versions.map((item) => item.version));
      await publishAndActivate(service, release, version);
    }
  } else {
    await ensurePublishedVersion(service, release);
  }

  if (hasDraft) {
    log('info', 'I-407 draft already exists', {
      event: 'seed.i407.draft.exists',
      definitionKey
    });
    return;
  }

  const refreshed = await service.listReleaseCatalog(author);
  const published = refreshed.find(
    (item) => item.definitionKey === definitionKey && item.lifecycleStatus === 'PUBLISHED'
  );
  const cloneFromVersion = published?.version ?? PUBLISHED_VERSION;
  await service.createDraftRelease(author, {
    definitionKey,
    version: DRAFT_VERSION,
    cloneFromVersion
  });
  log('info', 'Created I-407 draft for Designer and Workspace Try', {
    event: 'seed.i407.draft.created',
    definitionKey,
    version: DRAFT_VERSION,
    cloneFromVersion
  });
}

async function ensurePublishedVersion(
  service: DefinitionReleaseService,
  release: DefinitionRelease
): Promise<void> {
  const definitionKey = release.definitionKey;
  try {
    const current = await service.getRelease(author, definitionKey, PUBLISHED_VERSION);
    if (current.lifecycleStatus === 'PUBLISHED') {
      await service.activate(publisher, {
        definitionKey,
        version: PUBLISHED_VERSION,
        expectedRowVersion: current.rowVersion
      });
      log('info', 'Activated existing published I-407 definition', {
        event: 'seed.i407.definition.activated',
        definitionKey
      });
      return;
    }
    throw new Error(
      `${definitionKey} ${PUBLISHED_VERSION} exists as ${current.lifecycleStatus}. Finish or replace that release before seeding.`
    );
  } catch (error: unknown) {
    if (!(error instanceof AppError) || error.errorCode !== 'OPTIC-CONFIG-40402') {
      throw error;
    }
  }

  await publishAndActivate(service, release, PUBLISHED_VERSION);
}

async function publishAndActivate(
  service: DefinitionReleaseService,
  release: DefinitionRelease,
  version: string
): Promise<void> {
  const definitionKey = release.definitionKey;
  const drafted = await authorRelease(service, release, version);
  const submitted = await service.submit(author, {
    definitionKey,
    version,
    expectedRowVersion: drafted.rowVersion
  });
  const approved = await service.approve(approver, {
    definitionKey,
    version,
    expectedRowVersion: submitted.rowVersion
  });
  const published = await service.publish(publisher, {
    definitionKey,
    version,
    expectedRowVersion: approved.rowVersion
  });
  await service.activate(publisher, {
    definitionKey,
    version,
    expectedRowVersion: published.rowVersion
  });
  log('info', 'Published I-407 definition for Workspace Live', {
    event: 'seed.i407.definition.published',
    definitionKey,
    version
  });
}

function sameSeedPackage(active: DefinitionRelease, fixture: DefinitionRelease): boolean {
  return seedFingerprint(active) === seedFingerprint(fixture);
}

function seedFingerprint(release: DefinitionRelease): string {
  return JSON.stringify({
    initialStageKey: release.workflow.initialStageKey,
    stages: [...release.workflow.stages.map((stage) => stage.stageKey)].sort(),
    forms: Object.keys(release.forms).sort()
  });
}

function nextReleaseVersion(existing: string[]): string {
  const used = new Set(existing);
  let minor = 0;
  while (used.has(`1.${minor}.0`)) {
    minor += 1;
  }
  return `1.${minor}.0`;
}

async function authorRelease(
  service: DefinitionReleaseService,
  release: DefinitionRelease,
  version: string
): Promise<{ rowVersion: number }> {
  await service.createDraftRelease(author, { definitionKey: release.definitionKey, version });
  let rowVersion = 0;
  await service.saveSchema(author, {
    definitionKey: release.definitionKey,
    version,
    expectedRowVersion: rowVersion++,
    payload: release.schema
  });
  await service.saveWorkflow(author, {
    definitionKey: release.definitionKey,
    version,
    expectedRowVersion: rowVersion++,
    payload: release.workflow
  });
  for (const form of Object.values(release.forms)) {
    await service.saveForm(author, {
      definitionKey: release.definitionKey,
      version,
      expectedRowVersion: rowVersion++,
      payload: form
    });
  }
  for (const action of Object.values(release.actions)) {
    await service.saveAction(author, {
      definitionKey: release.definitionKey,
      version,
      expectedRowVersion: rowVersion++,
      payload: action
    });
  }
  for (const queue of Object.values(release.queues)) {
    await service.saveQueue(author, {
      definitionKey: release.definitionKey,
      version,
      expectedRowVersion: rowVersion++,
      payload: queue
    });
  }
  for (const bulk of Object.values(release.bulkActions)) {
    await service.saveBulkAction(author, {
      definitionKey: release.definitionKey,
      version,
      expectedRowVersion: rowVersion++,
      payload: bulk
    });
  }
  for (const sla of Object.values(release.slas)) {
    await service.saveSla(author, {
      definitionKey: release.definitionKey,
      version,
      expectedRowVersion: rowVersion++,
      payload: sla
    });
  }
  await service.saveSearch(author, {
    definitionKey: release.definitionKey,
    version,
    expectedRowVersion: rowVersion++,
    payload: release.search
  });
  return { rowVersion };
}

async function ensureDemoInstances(workflow: WorkflowInstanceService): Promise<void> {
  for (const item of DEMO_CASES) {
    let summary;
    try {
      summary = await workflow.getSummary(officer, item.entityType, item.trackingId);
      log('info', 'I-407 demo instance already exists', {
        event: 'seed.i407.instance.exists',
        entityType: item.entityType,
        entityTrackingId: item.trackingId
      });
    } catch (error: unknown) {
      if (!(error instanceof AppError) || error.errorCode !== 'OPTIC-WF-40410') {
        throw error;
      }
      summary = await workflow.createInstance(officer, {
        entityType: item.entityType,
        entityTrackingId: item.trackingId,
        definitionKey: item.definitionKey
      });
      log('info', 'Created I-407 demo instance', {
        event: 'seed.i407.instance.created',
        entityType: item.entityType,
        entityTrackingId: item.trackingId
      });
    }
    if (!summary.workflow.assignedTo) {
      await workflow.assignToSelf(officer, {
        entityType: item.entityType,
        entityTrackingId: item.trackingId,
        expectedRowVersion: summary.workflow.rowVersion
      });
      log('info', 'Assigned I-407 demo instance', {
        event: 'seed.i407.instance.assigned',
        entityType: item.entityType,
        entityTrackingId: item.trackingId,
        assignedTo: officer.actorId
      });
    }
  }
}

const isCli = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  seedI407Demo()
    .then(async () => {
      log('info', 'I-407 demo seed complete', { event: 'seed.i407.complete' });
      await closePool();
    })
    .catch(async (error: unknown) => {
      log('error', 'I-407 demo seed failed', {
        event: 'seed.i407.failed',
        error: error instanceof Error ? error.message : 'unknown'
      });
      process.exitCode = 1;
      await closePool();
    });
}
