import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryDefinitionRepository } from '../../src/modules/configuration/persistence/in-memory-definition.repository.js';
import { DefinitionLoader } from '../../src/modules/configuration/definitions/definition-loader.js';
import { DefinitionReleaseService } from '../../src/modules/configuration/service/definition-release.service.js';
import { InMemoryOutboxRepository } from '../../src/platform/outbox/in-memory-outbox.repository.js';
import { AuthenticatedActorAuthorization } from '../../src/platform/security/authorization-port.js';
import { authorLinearDraft } from '../helpers/author-linear.js';

const author = { actorId: 'author@example.gov', roles: ['CONFIGURATOR'], correlationId: 'c-author' };
const approver = { actorId: 'approver@example.gov', roles: ['APPROVER'], correlationId: 'c-approver' };
const publisher = { actorId: 'publisher@example.gov', roles: ['PUBLISHER'], correlationId: 'c-publisher' };

async function createService() {
  const repository = new InMemoryDefinitionRepository();
  const outbox = new InMemoryOutboxRepository();
  const loader = new DefinitionLoader(repository);
  const exportDir = await mkdtemp(join(tmpdir(), 'optic-export-'));
  const service = new DefinitionReleaseService(
    repository,
    new AuthenticatedActorAuthorization(),
    async (work) => work(),
    outbox,
    { loader, exportDir }
  );
  return { repository, service, outbox, loader, exportDir };
}

describe('definition lifecycle', () => {
  it('rejects an incomplete submit and blocks the submitter from approving', async () => {
    const { service } = await createService();
    await service.createDefinition(author, {
      definitionKey: 'I_90',
      displayName: 'I-90',
      entityType: 'WORKLOAD'
    });
    await service.createDraftRelease(author, { definitionKey: 'I_90', version: '1.0.0' });
    await expect(service.submit(author, { definitionKey: 'I_90', version: '1.0.0', expectedRowVersion: 0 })).rejects.toMatchObject({
      errorCode: 'OPTIC-CONFIG-40025'
    });

    const drafted = await authorLinearDraft(service, author, { definitionKey: 'I_91', version: '1.0.0' });
    const submitted = await service.submit(author, {
      definitionKey: 'I_91',
      version: '1.0.0',
      expectedRowVersion: drafted.rowVersion
    });
    expect(submitted.lifecycleStatus).toBe('IN_REVIEW');
    await expect(
      service.saveWorkflow(author, {
        definitionKey: 'I_91',
        version: '1.0.0',
        expectedRowVersion: submitted.rowVersion,
        payload: submitted.workflow
      })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-CONFIG-40902' });
    await expect(
      service.approve(author, { definitionKey: 'I_91', version: '1.0.0', expectedRowVersion: submitted.rowVersion })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-AUTHZ-40302' });
  });

  it('publishes with a checksum after separated approve and activate', async () => {
    const { service, outbox, loader, repository } = await createService();
    const drafted = await authorLinearDraft(service, author);
    const submitted = await service.submit(author, {
      definitionKey: 'I_90',
      version: '1.0.0',
      expectedRowVersion: drafted.rowVersion
    });
    const approved = await service.approve(approver, {
      definitionKey: 'I_90',
      version: '1.0.0',
      expectedRowVersion: submitted.rowVersion
    });
    await expect(
      service.publish(approver, { definitionKey: 'I_90', version: '1.0.0', expectedRowVersion: approved.rowVersion })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-AUTHZ-40302' });

    const published = await service.publish(publisher, {
      definitionKey: 'I_90',
      version: '1.0.0',
      expectedRowVersion: approved.rowVersion
    });
    expect(published.lifecycleStatus).toBe('PUBLISHED');
    expect(published.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(published.publishedBy).toBe(publisher.actorId);
    expect(outbox.events.map((event) => event.eventType)).toContain('CONFIG_PUBLISHED');
    expect(loader.getCache().peekByCacheKey('definition-release:I_90:1.0.0')?.lifecycleStatus).toBe('PUBLISHED');

    const exported = await service.exportRelease(publisher, 'I_90', '1.0.0');
    expect(exported.checksum).toBe(published.checksum);
    expect(exported.files['manifest.yaml']).toContain('kind: DefinitionRelease');
    expect(exported.files['workflow.yaml']).toContain('READY_FOR_DATA_ENTRY');
    expect(exported.files['ui/i90-data-entry.ui.yaml']).toContain('RECEIPT_NUMBER');
    expect(exported.files['projections.yaml']).toContain('receiptNumber');
    expect(exported.files['projections.yaml']).toContain('current_stage_key');

    const activated = await service.activate(publisher, {
      definitionKey: 'I_90',
      version: '1.0.0',
      expectedRowVersion: published.rowVersion
    });
    expect(activated.lifecycleStatus).toBe('PUBLISHED');
    expect(activated.active).toBe(true);
    expect((await repository.findDefinitionByKey('I_90'))?.activeReleaseId).toBe(Number(published.id));
    expect(outbox.events.some((event) => event.eventType === 'CONFIG_ACTIVATED')).toBe(true);

    await expect(
      service.retire(publisher, { definitionKey: 'I_90', version: '1.0.0', expectedRowVersion: activated.rowVersion })
    ).rejects.toMatchObject({ errorCode: 'OPTIC-CONFIG-40904' });

    const deactivated = await service.deactivate(publisher, {
      definitionKey: 'I_90',
      version: '1.0.0',
      expectedRowVersion: activated.rowVersion
    });
    expect(deactivated.active).toBe(false);
    expect((await repository.findDefinitionByKey('I_90'))?.activeReleaseId).toBeNull();
    const retired = await service.retire(publisher, {
      definitionKey: 'I_90',
      version: '1.0.0',
      expectedRowVersion: activated.rowVersion
    });
    expect(retired.lifecycleStatus).toBe('RETIRED');
  });

  it('returns a rejected release to draft and diffs two versions', async () => {
    const { service, outbox } = await createService();
    const first = await authorLinearDraft(service, author, { version: '1.0.0' });
    const submitted = await service.submit(author, {
      definitionKey: 'I_90',
      version: '1.0.0',
      expectedRowVersion: first.rowVersion
    });
    const rejected = await service.reject(approver, {
      definitionKey: 'I_90',
      version: '1.0.0',
      expectedRowVersion: submitted.rowVersion,
      comment: 'Need another stage label'
    });
    expect(rejected.lifecycleStatus).toBe('REJECTED');
    expect(rejected.rejectedComment).toBe('Need another stage label');
    const rejectEvent = outbox.events.find((event) => {
      const payload = event.payload as { payload?: { change?: string; comment?: string } };
      return payload.payload?.change === 'REJECTED';
    });
    expect((rejectEvent?.payload as { payload?: { comment?: string } }).payload?.comment).toBe(
      'Need another stage label'
    );
    const draft = await service.returnToDraft(author, {
      definitionKey: 'I_90',
      version: '1.0.0',
      expectedRowVersion: rejected.rowVersion
    });
    expect(draft.lifecycleStatus).toBe('DRAFT');
    expect(draft.rejectedComment).toBeNull();

    await service.createDraftRelease(author, { definitionKey: 'I_90', version: '1.1.0', cloneFromVersion: '1.0.0' });
    const clone = await service.getRelease(author, 'I_90', '1.1.0');
    await service.saveWorkflow(author, {
      definitionKey: 'I_90',
      version: '1.1.0',
      expectedRowVersion: clone.rowVersion,
      payload: {
        ...clone.workflow,
        stages: clone.workflow.stages.map((stage) =>
          stage.stageKey === 'ON_HOLD' ? { ...stage, displayName: 'Fraud Hold' } : stage
        )
      }
    });
    const diff = await service.diffReleases(author, 'I_90', '1.0.0', '1.1.0');
    expect(diff.changes.some((change) => change.category === 'stages' && change.key === 'ON_HOLD')).toBe(true);
    expect(
      diff.changes.some(
        (change) => change.path === 'ON_HOLD.displayName' && change.after === 'Fraud Hold'
      )
    ).toBe(true);
    expect(diff.raw.from).toContain('On Hold');
    expect(diff.raw.to).toContain('Fraud Hold');
  });
});
