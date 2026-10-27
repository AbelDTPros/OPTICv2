import { AppError, conflict, notFound, validationFailed } from '../../../platform/errors/app-error.js';
import type { QueryExecutor } from '../../../platform/db/types.js';
import type { ActorContext } from '../../../platform/security/actor.js';
import type { AuthorizationPort } from '../../../platform/security/authorization-port.js';
import { assertReleaseVersion, assertStableKey, assertUniqueKeys } from '../domain/keys.js';
import {
  assertDraftOnly,
  assertLifecycleTransition,
  createDraftManifest,
  withManifestLifecycle,
  writeSchemaToManifest
} from '../domain/lifecycle.js';
import { DefinitionLoader } from '../definitions/definition-loader.js';
import { validateQueueDefinition } from '../../queue/domain/validate-queue.js';
import type {
  ActionDefinition,
  BulkActionDefinition,
  DefinitionRecord,
  DefinitionRelease,
  DefinitionReleaseRecord,
  JsonSchema,
  ReleaseCatalogItem,
  QueueDefinition,
  ScheduledActionDefinition,
  SearchDefinition,
  SlaDefinition,
  StageFormDefinition,
  WorkflowDefinition
} from '../domain/types.js';
import { assembleDefinitionRelease } from './assemble-release.js';
import {
  buildCanonicalPackage,
  checksumCanonicalPackage,
  type CanonicalPackage
} from './canonical-package.js';
import { buildPackageFiles, writeLocalPackage } from './export-package.js';
import {
  childrenFromCanonicalPackage,
  parseCanonicalPackage,
  verifyPackageChecksum,
  workflowGraphFromPackage
} from './import-package.js';
import { collectProjectionRequirements } from '../../queue/domain/projection-requirements.js';
import { assertPublishableDefinition } from './publish-validation.js';
import { diffReleases, type SemanticDiff } from './semantic-diff.js';
import { assertFormAccessibility } from '../../../platform/accessibility/form-accessibility.js';
import { createConfigOutboxEvent } from '../../../platform/outbox/config-events.js';
import type { OutboxRepository } from '../../../platform/outbox/outbox.repository.js';
import {
  createCloneRetarget,
  retargetClonedChild,
  retargetClonedValue,
  shouldRetargetClone
} from '../domain/clone-retarget.js';
import { ALL_CHILD_KINDS } from '../persistence/child-table-map.js';
import type { DefinitionChildKind, DefinitionRepository } from '../persistence/definition.repository.js';

export type TransactionRunner = <T>(work: (executor?: QueryExecutor) => Promise<T>) => Promise<T>;

export interface CreateDefinitionCommand {
  definitionKey: string;
  displayName: string;
  entityType: string;
}

export interface CreateDraftReleaseCommand {
  definitionKey: string;
  version: string;
  cloneFromVersion?: string;
  cloneFromDefinitionKey?: string;
}

export interface ImportReleasePackageCommand {
  definitionKey: string;
  package: unknown;
  checksum: string;
  checksumAlgorithm?: 'SHA-256';
  version?: string;
  createDefinitionIfMissing?: boolean;
  /** DRAFT (default) or PUBLISHED. Never auto-activates. */
  mode?: 'DRAFT' | 'PUBLISHED';
}

export interface SaveDraftCommand<T> {
  definitionKey: string;
  version: string;
  expectedRowVersion: number;
  payload: T;
}

export interface LifecycleCommand {
  definitionKey: string;
  version: string;
  expectedRowVersion: number;
  comment?: string;
}

export interface DefinitionReleaseServiceOptions {
  loader?: DefinitionLoader;
  exportDir?: string | null;
  /** Marks prior instances on the release as Try rehearsal and drops Live queue cards. */
  scrubReleaseForLive?: (releaseId: number, executor?: QueryExecutor) => Promise<void>;
}

export class DefinitionReleaseService {
  private readonly loader: DefinitionLoader;
  private readonly exportDir: string | null;
  private readonly scrubReleaseForLive?: (
    releaseId: number,
    executor?: QueryExecutor
  ) => Promise<void>;

  constructor(
    private readonly repository: DefinitionRepository,
    private readonly authorization: AuthorizationPort,
    private readonly runInTransaction: TransactionRunner,
    private readonly outbox: OutboxRepository,
    options: DefinitionReleaseServiceOptions = {}
  ) {
    this.loader = options.loader ?? new DefinitionLoader(repository);
    this.exportDir = options.exportDir ?? null;
    this.scrubReleaseForLive = options.scrubReleaseForLive;
  }

  async createDefinition(actor: ActorContext, command: CreateDefinitionCommand): Promise<DefinitionRecord> {
    await this.authorization.assertCanMutateConfiguration(actor);
    assertStableKey(command.definitionKey, 'definitionKey');
    if (!command.displayName.trim()) {
      throw validationFailed('OPTIC-VAL-40001', 'displayName is required.');
    }
    if (!command.entityType.trim()) {
      throw validationFailed('OPTIC-VAL-40001', 'entityType is required.');
    }

    return this.runInTransaction(async (executor) => {
      const created = await this.repository.createDefinition(
        {
          definitionKey: command.definitionKey,
          displayName: command.displayName.trim(),
          entityType: command.entityType,
          createdBy: actor.actorId
        },
        executor
      );
      await this.outbox.append(
        createConfigOutboxEvent({
          actor,
          eventType: 'CONFIG_CHANGED',
          aggregateType: 'DEFINITION',
          aggregateId: created.definitionKey,
          definitionKey: created.definitionKey,
          change: 'DEFINITION_CREATED'
        }),
        executor
      );
      return created;
    });
  }

  async listDefinitions(actor: ActorContext): Promise<DefinitionRecord[]> {
    await this.authorization.assertCanReadConfiguration(actor);
    return this.repository.listDefinitions();
  }

  async listReleaseCatalog(actor: ActorContext): Promise<ReleaseCatalogItem[]> {
    await this.authorization.assertCanReadConfiguration(actor);
    return this.repository.listReleaseCatalog();
  }

  async createDraftRelease(
    actor: ActorContext,
    command: CreateDraftReleaseCommand
  ): Promise<DefinitionRelease> {
    await this.authorization.assertCanMutateConfiguration(actor);
    assertStableKey(command.definitionKey, 'definitionKey');
    assertReleaseVersion(command.version);
    if (command.cloneFromDefinitionKey) {
      assertStableKey(command.cloneFromDefinitionKey, 'cloneFromDefinitionKey');
    }

    const definition = await this.repository.findDefinitionByKey(command.definitionKey);
    if (!definition) {
      throw notFound('OPTIC-CONFIG-40401', `Definition ${command.definitionKey} was not found.`);
    }

    return this.runInTransaction(async (executor) => {
      const createdAt = new Date().toISOString();
      let manifest = createDraftManifest({
        definitionKey: definition.definitionKey,
        displayName: definition.displayName,
        entityType: definition.entityType,
        version: command.version,
        createdBy: actor.actorId,
        createdAt
      });

      const source =
        command.cloneFromVersion === undefined
          ? undefined
          : await this.requireRelease(
              command.cloneFromDefinitionKey ?? command.definitionKey,
              command.cloneFromVersion,
              executor
            );

      if (source) {
        manifest = structuredClone(source.manifest);
        manifest.metadata = {
          ...((manifest.metadata ?? {}) as Record<string, unknown>),
          definitionKey: definition.definitionKey,
          displayName: definition.displayName,
          entityType: definition.entityType,
          version: command.version,
          status: 'DRAFT',
          createdAt,
          createdBy: actor.actorId
        };
      }

      const sourceChildren = source
        ? await Promise.all(
            ALL_CHILD_KINDS.map(async (kind) => ({
              kind,
              children: await this.repository.listChildren(source.id, kind, executor)
            }))
          )
        : [];
      const retarget =
        source && shouldRetargetClone(source.definitionKey, definition.definitionKey)
          ? createCloneRetarget(
              source.definitionKey,
              definition.definitionKey,
              sourceChildren.flatMap(({ kind, children }) =>
                children.map((child) => ({
                  kind,
                  stableKey: child.stableKey,
                  config: child.config
                }))
              )
            )
          : undefined;
      if (retarget && manifest.spec && typeof manifest.spec === 'object') {
        manifest.spec = retargetClonedValue(manifest.spec, retarget) as Record<string, unknown>;
      }

      const release = await this.repository.createRelease(
        {
          definitionId: definition.id,
          definitionKey: definition.definitionKey,
          displayName: definition.displayName,
          entityType: definition.entityType,
          version: command.version,
          manifest,
          createdBy: actor.actorId
        },
        executor
      );

      if (source) {
        for (const { kind, children } of sourceChildren) {
          await this.repository.replaceChildren(
            release.id,
            kind,
            children.map((child) =>
              retarget
                ? retargetClonedChild(kind, { stableKey: child.stableKey, config: child.config }, retarget)
                : { stableKey: child.stableKey, config: child.config }
            ),
            executor
          );
        }
      }

      await this.outbox.append(
        createConfigOutboxEvent({
          actor,
          eventType: 'CONFIG_DRAFT_CREATED',
          aggregateType: 'DEFINITION_RELEASE',
          aggregateId: `${definition.definitionKey}:${command.version}`,
          definitionKey: definition.definitionKey,
          version: command.version,
          change: command.cloneFromVersion ? 'DRAFT_CLONED' : 'DRAFT_CREATED'
        }),
        executor
      );

      return assembleDefinitionRelease(this.repository, release, executor);
    });
  }

  async importReleasePackage(
    actor: ActorContext,
    command: ImportReleasePackageCommand
  ): Promise<DefinitionRelease> {
    const mode = command.mode ?? 'DRAFT';
    if (mode === 'PUBLISHED') {
      await this.authorization.assertCanPublishConfiguration(actor);
    } else {
      await this.authorization.assertCanMutateConfiguration(actor);
    }
    assertStableKey(command.definitionKey, 'definitionKey');
    const pkg = parseCanonicalPackage(command.package);
    const signed = verifyPackageChecksum(pkg, command.checksum, command.checksumAlgorithm ?? 'SHA-256');
    if (pkg.metadata.definitionKey !== command.definitionKey) {
      throw validationFailed(
        'OPTIC-CONFIG-40027',
        `Package definitionKey ${pkg.metadata.definitionKey} does not match route key ${command.definitionKey}.`
      );
    }
    const version = command.version ?? pkg.metadata.version;
    assertReleaseVersion(version);
    const createIfMissing = command.createDefinitionIfMissing !== false;
    const children = childrenFromCanonicalPackage(pkg);
    const workflowGraph = workflowGraphFromPackage(pkg);
    const workflowPayload: WorkflowDefinition = {
      initialStageKey: workflowGraph.initialStageKey,
      terminalStageKeys: workflowGraph.terminalStageKeys,
      stages: (pkg.spec.workflow as WorkflowDefinition).stages ?? [],
      transitionSets: (pkg.spec.workflow as WorkflowDefinition).transitionSets ?? []
    };
    validateWorkflow(workflowPayload);

    return this.runInTransaction(async (executor) => {
      let definition = await this.repository.findDefinitionByKey(command.definitionKey, executor);
      if (!definition) {
        if (!createIfMissing) {
          throw notFound('OPTIC-CONFIG-40401', `Definition ${command.definitionKey} was not found.`);
        }
        definition = await this.repository.createDefinition(
          {
            definitionKey: command.definitionKey,
            displayName: pkg.metadata.displayName,
            entityType: pkg.metadata.entityType,
            createdBy: actor.actorId
          },
          executor
        );
        await this.outbox.append(
          createConfigOutboxEvent({
            actor,
            eventType: 'CONFIG_CHANGED',
            aggregateType: 'DEFINITION',
            aggregateId: definition.definitionKey,
            definitionKey: definition.definitionKey,
            change: 'DEFINITION_CREATED'
          }),
          executor
        );
      }

      const existing = await this.repository.findReleaseByKeyAndVersion(
        command.definitionKey,
        version,
        executor
      );
      if (existing) {
        throw conflict(
          'OPTIC-CONFIG-40901',
          `Release ${command.definitionKey} ${version} already exists.`
        );
      }

      const createdAt = new Date().toISOString();
      let manifest = createDraftManifest({
        definitionKey: definition.definitionKey,
        displayName: definition.displayName,
        entityType: definition.entityType,
        version,
        createdBy: actor.actorId,
        createdAt
      });
      manifest = writeSchemaToManifest(
        manifest,
        (pkg.spec.schema && typeof pkg.spec.schema === 'object'
          ? pkg.spec.schema
          : {}) as Record<string, unknown>
      );
      const spec = { ...((manifest.spec ?? {}) as Record<string, unknown>), workflowGraph };
      const metadata = {
        ...((manifest.metadata ?? {}) as Record<string, unknown>),
        importedChecksum: signed.checksum,
        importedChecksumAlgorithm: signed.algorithm,
        importedAt: createdAt,
        sourceStatus: pkg.metadata.status,
        importMode: mode
      };
      manifest = { ...manifest, metadata, spec };

      const approvedBy =
        typeof pkg.metadata.approvedBy === 'string' && pkg.metadata.approvedBy
          ? pkg.metadata.approvedBy
          : null;
      if (mode === 'PUBLISHED') {
        manifest = withManifestLifecycle(manifest, 'PUBLISHED', {
          approvedBy,
          publishedBy: actor.actorId,
          checksumAlgorithm: signed.algorithm,
          checksum: signed.checksum
        });
      }

      const release = await this.repository.createRelease(
        {
          definitionId: definition.id,
          definitionKey: definition.definitionKey,
          displayName: definition.displayName,
          entityType: definition.entityType,
          version,
          manifest,
          createdBy: actor.actorId,
          ...(mode === 'PUBLISHED'
            ? {
                lifecycleStatus: 'PUBLISHED' as const,
                canonicalPackage: pkg as unknown as Record<string, unknown>,
                checksum: signed.checksum,
                checksumAlgorithm: signed.algorithm,
                approvedBy,
                publishedBy: actor.actorId,
                submittedBy:
                  typeof pkg.metadata.approvedBy === 'string' ? pkg.metadata.approvedBy : actor.actorId
              }
            : {})
        },
        executor
      );

      for (const kind of ALL_CHILD_KINDS) {
        await this.repository.replaceChildren(release.id, kind, children[kind], executor);
      }

      if (mode === 'PUBLISHED') {
        const assembled = await assembleDefinitionRelease(this.repository, release, executor);
        assertPublishableDefinition(assembled);
        await this.outbox.append(
          createConfigOutboxEvent({
            actor,
            eventType: 'CONFIG_PUBLISHED',
            aggregateType: 'DEFINITION_RELEASE',
            aggregateId: `${definition.definitionKey}:${version}`,
            definitionKey: definition.definitionKey,
            version,
            change: 'PUBLISHED_IMPORTED',
            checksum: signed.checksum
          }),
          executor
        );
        return assembled;
      }

      await this.outbox.append(
        createConfigOutboxEvent({
          actor,
          eventType: 'CONFIG_DRAFT_CREATED',
          aggregateType: 'DEFINITION_RELEASE',
          aggregateId: `${definition.definitionKey}:${version}`,
          definitionKey: definition.definitionKey,
          version,
          change: 'DRAFT_IMPORTED',
          checksum: signed.checksum
        }),
        executor
      );

      return assembleDefinitionRelease(this.repository, release, executor);
    }).then((assembled) => {
      if (mode === 'PUBLISHED') {
        this.loader.compile(assembled);
      }
      return assembled;
    });
  }

  async getRelease(actor: ActorContext, definitionKey: string, version: string): Promise<DefinitionRelease> {
    await this.authorization.assertCanReadConfiguration(actor);
    const release = await this.requireRelease(definitionKey, version);
    return assembleDefinitionRelease(this.repository, release);
  }

  async getReleaseById(actor: ActorContext, releaseId: number): Promise<DefinitionRelease> {
    await this.authorization.assertCanReadConfiguration(actor);
    const release = await this.repository.findReleaseById(releaseId);
    if (!release) {
      throw notFound('OPTIC-CONFIG-40402', `Release ${releaseId} was not found.`);
    }
    return assembleDefinitionRelease(this.repository, release);
  }

  async saveWorkflow(
    actor: ActorContext,
    command: SaveDraftCommand<WorkflowDefinition>
  ): Promise<DefinitionRelease> {
    return this.saveDraft(actor, command, async (release, executor) => {
      validateWorkflow(command.payload);
      await this.repository.replaceChildren(
        release.id,
        'stage',
        command.payload.stages.map((stage) => ({
          stableKey: stage.stageKey,
          config: stage as unknown as Record<string, unknown>
        })),
        executor
      );
      await this.repository.replaceChildren(
        release.id,
        'transition',
        command.payload.transitionSets.map((set) => ({
          stableKey: set.transitionSetKey,
          config: set as unknown as Record<string, unknown>
        })),
        executor
      );
      const spec = { ...((release.manifest.spec ?? {}) as Record<string, unknown>) };
      spec.workflowGraph = {
        initialStageKey: command.payload.initialStageKey,
        terminalStageKeys: command.payload.terminalStageKeys
      };
      return { ...release.manifest, spec };
    });
  }

  async saveForm(
    actor: ActorContext,
    command: SaveDraftCommand<StageFormDefinition>
  ): Promise<DefinitionRelease> {
    assertStableKey(command.payload.formKey, 'formKey');
    return this.saveDraft(actor, command, async (release, executor) => {
      assertFormAccessibility(command.payload, { entityType: release.entityType });
      await this.repository.upsertChild(
        release.id,
        'form',
        command.payload.formKey,
        command.payload as unknown as Record<string, unknown>,
        executor
      );
      return release.manifest;
    });
  }

  async deleteForm(
    actor: ActorContext,
    command: { definitionKey: string; version: string; expectedRowVersion: number; formKey: string }
  ): Promise<DefinitionRelease> {
    return this.deleteChild(actor, command, 'form', command.formKey, 'formKey');
  }

  async deleteAction(
    actor: ActorContext,
    command: { definitionKey: string; version: string; expectedRowVersion: number; actionKey: string }
  ): Promise<DefinitionRelease> {
    return this.deleteChild(actor, command, 'action', command.actionKey, 'actionKey');
  }

  async deleteQueue(
    actor: ActorContext,
    command: { definitionKey: string; version: string; expectedRowVersion: number; queueKey: string }
  ): Promise<DefinitionRelease> {
    return this.deleteChild(actor, command, 'queue', command.queueKey, 'queueKey');
  }

  async deleteSla(
    actor: ActorContext,
    command: { definitionKey: string; version: string; expectedRowVersion: number; slaKey: string }
  ): Promise<DefinitionRelease> {
    return this.deleteChild(actor, command, 'sla', command.slaKey, 'slaKey');
  }

  async deleteBulkAction(
    actor: ActorContext,
    command: { definitionKey: string; version: string; expectedRowVersion: number; bulkActionKey: string }
  ): Promise<DefinitionRelease> {
    return this.deleteChild(actor, command, 'bulkAction', command.bulkActionKey, 'bulkActionKey');
  }

  async deleteScheduledAction(
    actor: ActorContext,
    command: {
      definitionKey: string;
      version: string;
      expectedRowVersion: number;
      scheduledActionKey: string;
    }
  ): Promise<DefinitionRelease> {
    return this.deleteChild(actor, command, 'scheduledAction', command.scheduledActionKey, 'scheduledActionKey');
  }

  async deleteDraftRelease(
    actor: ActorContext,
    command: { definitionKey: string; version: string; expectedRowVersion: number }
  ): Promise<{ definitionKey: string; version: string; definitionRemoved: boolean }> {
    await this.authorization.assertCanMutateConfiguration(actor);
    return this.runInTransaction(async (executor) => {
      const release = await this.requireRelease(command.definitionKey, command.version, executor);
      if (release.lifecycleStatus !== 'DRAFT') {
        throw conflict(
          'OPTIC-CONFIG-40908',
          `Only a DRAFT release can be deleted. This release is ${release.lifecycleStatus}.`
        );
      }
      if (release.rowVersion !== command.expectedRowVersion) {
        throw conflict('OPTIC-WF-40901', 'This item changed after you opened it. Refresh and try again.');
      }

      const definition = await this.repository.findDefinitionByKey(command.definitionKey, executor);
      if (!definition) {
        throw notFound('OPTIC-CONFIG-40401', `Definition ${command.definitionKey} was not found.`);
      }
      if (definition.activeReleaseId === release.id) {
        throw conflict(
          'OPTIC-CONFIG-40908',
          'Cannot delete the active release. Deactivate it first, or retire a published snapshot instead.'
        );
      }

      await this.repository.purgeRuntimeForRelease(release.id, executor);
      for (const kind of ALL_CHILD_KINDS) {
        await this.repository.replaceChildren(release.id, kind, [], executor);
      }
      await this.repository.deleteRelease(release.id, command.expectedRowVersion, executor);

      const remaining = await this.repository.countReleasesForDefinition(definition.id, executor);
      const definitionRemoved = remaining === 0;
      if (definitionRemoved) {
        await this.repository.deleteDefinition(definition.id, executor);
      }

      await this.outbox.append(
        createConfigOutboxEvent({
          actor,
          eventType: 'CONFIG_CHANGED',
          aggregateType: 'DEFINITION_RELEASE',
          aggregateId: `${command.definitionKey}:${command.version}`,
          definitionKey: command.definitionKey,
          version: command.version,
          change: 'DRAFT_DELETED'
        }),
        executor
      );
      if (definitionRemoved) {
        await this.outbox.append(
          createConfigOutboxEvent({
            actor,
            eventType: 'CONFIG_CHANGED',
            aggregateType: 'DEFINITION',
            aggregateId: command.definitionKey,
            definitionKey: command.definitionKey,
            change: 'DEFINITION_DELETED'
          }),
          executor
        );
      }

      return {
        definitionKey: command.definitionKey,
        version: command.version,
        definitionRemoved
      };
    });
  }

  async saveAction(
    actor: ActorContext,
    command: SaveDraftCommand<ActionDefinition>
  ): Promise<DefinitionRelease> {
    return this.saveChild(actor, command, 'action', command.payload.actionKey, command.payload);
  }

  async saveQueue(
    actor: ActorContext,
    command: SaveDraftCommand<QueueDefinition>
  ): Promise<DefinitionRelease> {
    validateQueueDefinition(command.payload, { requireEligibility: false });
    return this.saveChild(actor, command, 'queue', command.payload.queueKey, command.payload);
  }

  async saveBulkAction(
    actor: ActorContext,
    command: SaveDraftCommand<BulkActionDefinition>
  ): Promise<DefinitionRelease> {
    return this.saveChild(actor, command, 'bulkAction', command.payload.bulkActionKey, command.payload);
  }

  async saveScheduledAction(
    actor: ActorContext,
    command: SaveDraftCommand<ScheduledActionDefinition>
  ): Promise<DefinitionRelease> {
    return this.saveChild(
      actor,
      command,
      'scheduledAction',
      command.payload.scheduledActionKey,
      command.payload
    );
  }

  async saveSla(actor: ActorContext, command: SaveDraftCommand<SlaDefinition>): Promise<DefinitionRelease> {
    return this.saveChild(actor, command, 'sla', command.payload.slaKey, command.payload);
  }

  async saveSearch(
    actor: ActorContext,
    command: SaveDraftCommand<SearchDefinition>
  ): Promise<DefinitionRelease> {
    return this.saveChild(actor, command, 'search', command.payload.searchKey, command.payload);
  }

  async saveSchema(
    actor: ActorContext,
    command: SaveDraftCommand<JsonSchema>
  ): Promise<DefinitionRelease> {
    return this.saveDraft(actor, command, async (release) => writeSchemaToManifest(release.manifest, command.payload));
  }

  async validateRelease(actor: ActorContext, definitionKey: string, version: string): Promise<{
    valid: true;
    definitionKey: string;
    version: string;
    projections: ReturnType<typeof collectProjectionRequirements>;
  }> {
    await this.authorization.assertCanReadConfiguration(actor);
    const assembled = await this.assemble(definitionKey, version);
    assertPublishableDefinition(assembled);
    return {
      valid: true,
      definitionKey,
      version,
      projections: collectProjectionRequirements(assembled)
    };
  }

  async submit(actor: ActorContext, command: LifecycleCommand): Promise<DefinitionRelease> {
    await this.authorization.assertCanSubmitConfiguration(actor);
    const assembled = await this.assemble(command.definitionKey, command.version);
    assertPublishableDefinition(assembled);
    return this.transition(actor, command, 'DRAFT', 'IN_REVIEW', 'CONFIG_SUBMITTED', 'SUBMITTED', {
      submittedBy: actor.actorId
    });
  }

  async approve(actor: ActorContext, command: LifecycleCommand): Promise<DefinitionRelease> {
    await this.authorization.assertCanApproveConfiguration(actor);
    const current = await this.requireRelease(command.definitionKey, command.version);
    assertNotSameActor(actor.actorId, current.submittedBy, 'approve a release you submitted');
    return this.transition(actor, command, 'IN_REVIEW', 'APPROVED', 'CONFIG_APPROVED', 'APPROVED', {
      approvedBy: actor.actorId
    });
  }

  async reject(actor: ActorContext, command: LifecycleCommand): Promise<DefinitionRelease> {
    await this.authorization.assertCanApproveConfiguration(actor);
    return this.transition(actor, command, 'IN_REVIEW', 'REJECTED', 'CONFIG_CHANGED', 'REJECTED', {
      comment: command.comment
    });
  }

  async returnToDraft(actor: ActorContext, command: LifecycleCommand): Promise<DefinitionRelease> {
    await this.authorization.assertCanMutateConfiguration(actor);
    const current = await this.requireRelease(command.definitionKey, command.version);
    if (current.lifecycleStatus !== 'IN_REVIEW' && current.lifecycleStatus !== 'REJECTED') {
      assertLifecycleTransition(current.lifecycleStatus, 'DRAFT', 'Return to draft');
    }
    return this.transition(actor, command, current.lifecycleStatus, 'DRAFT', 'CONFIG_CHANGED', 'RETURNED_TO_DRAFT');
  }

  async publish(actor: ActorContext, command: LifecycleCommand): Promise<DefinitionRelease> {
    await this.authorization.assertCanPublishConfiguration(actor);
    const current = await this.requireRelease(command.definitionKey, command.version);
    assertLifecycleTransition(current.lifecycleStatus, 'PUBLISHED', 'Publish');
    assertNotSameActor(actor.actorId, current.submittedBy, 'publish a release you submitted');
    assertNotSameActor(actor.actorId, current.approvedBy, 'publish a release you approved');
    const assembled = await assembleDefinitionRelease(this.repository, current);
    assertPublishableDefinition(assembled);

    const pkg = buildCanonicalPackage(assembled, {
      status: 'PUBLISHED',
      approvedBy: current.approvedBy,
      publishedBy: actor.actorId
    });
    const signed = checksumCanonicalPackage(pkg);

    const published = await this.runInTransaction(async (executor) => {
      const updated = await this.repository.updateLifecycle(
        {
          releaseId: current.id,
          expectedRowVersion: command.expectedRowVersion,
          expectedStatus: 'APPROVED',
          lifecycleStatus: 'PUBLISHED',
          manifest: withManifestLifecycle(current.manifest, 'PUBLISHED', {
            approvedBy: current.approvedBy,
            publishedBy: actor.actorId,
            checksumAlgorithm: signed.algorithm,
            checksum: signed.checksum
          }),
          publishedBy: actor.actorId,
          canonicalPackage: pkg as unknown as Record<string, unknown>,
          checksum: signed.checksum,
          checksumAlgorithm: signed.algorithm
        },
        executor
      );
      await this.scrubReleaseForLive?.(updated.id, executor);
      await this.outbox.append(
        createConfigOutboxEvent({
          actor,
          eventType: 'CONFIG_PUBLISHED',
          aggregateType: 'DEFINITION_RELEASE',
          aggregateId: `${command.definitionKey}:${command.version}`,
          definitionKey: command.definitionKey,
          version: command.version,
          change: 'PUBLISHED',
          checksum: signed.checksum
        }),
        executor
      );
      return assembleDefinitionRelease(this.repository, updated, executor);
    });

    if (this.exportDir) {
      await writeLocalPackage(
        this.exportDir,
        published.definitionKey,
        published.version,
        signed.canonicalJson,
        signed.checksum,
        buildPackageFiles(pkg, published)
      );
    }
    this.loader.compile(published);
    return published;
  }

  async retire(actor: ActorContext, command: LifecycleCommand): Promise<DefinitionRelease> {
    await this.authorization.assertCanPublishConfiguration(actor);
    const current = await this.requireRelease(command.definitionKey, command.version);
    const definition = await this.repository.findDefinitionByKey(command.definitionKey);
    if (definition?.activeReleaseId === current.id) {
      throw conflict(
        'OPTIC-CONFIG-40904',
        'Activate another published release before retiring the active release.',
        [{ definitionKey: command.definitionKey, version: command.version }]
      );
    }
    return this.transition(actor, command, 'PUBLISHED', 'RETIRED', 'CONFIG_RETIRED', 'RETIRED', {
      setRetired: true
    });
  }

  async activate(actor: ActorContext, command: LifecycleCommand): Promise<DefinitionRelease> {
    await this.authorization.assertCanActivateConfiguration(actor);
    return this.runInTransaction(async (executor) => {
      let current = await this.requireRelease(command.definitionKey, command.version, executor);
      if (current.lifecycleStatus === 'RETIRED') {
        current = await this.repository.updateLifecycle(
          {
            releaseId: current.id,
            expectedRowVersion: command.expectedRowVersion,
            expectedStatus: 'RETIRED',
            lifecycleStatus: 'PUBLISHED',
            manifest: withManifestLifecycle(current.manifest, 'PUBLISHED'),
            clearRetired: true
          },
          executor
        );
      } else if (current.lifecycleStatus !== 'PUBLISHED') {
        throw conflict(
          'OPTIC-CONFIG-40905',
          `Only a PUBLISHED release can be activated. ${command.definitionKey} ${command.version} is ${current.lifecycleStatus}.`
        );
      } else if (current.rowVersion !== command.expectedRowVersion) {
        throw conflict('OPTIC-WF-40901', 'This item changed after you opened it. Refresh and try again.');
      }
      await this.repository.setActiveRelease(current.definitionId, current.id, executor);
      await this.scrubReleaseForLive?.(current.id, executor);
      await this.outbox.append(
        createConfigOutboxEvent({
          actor,
          eventType: 'CONFIG_ACTIVATED',
          aggregateType: 'DEFINITION_RELEASE',
          aggregateId: `${command.definitionKey}:${command.version}`,
          definitionKey: command.definitionKey,
          version: command.version,
          change: 'ACTIVATED',
          checksum: current.checksum ?? undefined
        }),
        executor
      );
      return assembleDefinitionRelease(this.repository, current, executor);
    });
  }

  async deactivate(actor: ActorContext, command: LifecycleCommand): Promise<DefinitionRelease> {
    await this.authorization.assertCanActivateConfiguration(actor);
    return this.runInTransaction(async (executor) => {
      const current = await this.requireRelease(command.definitionKey, command.version, executor);
      const definition = await this.repository.findDefinitionByKey(command.definitionKey, executor);
      if (!definition || definition.activeReleaseId !== current.id) {
        throw conflict(
          'OPTIC-CONFIG-40907',
          `${command.definitionKey} ${command.version} is not the active release.`,
          [{ definitionKey: command.definitionKey, version: command.version }]
        );
      }
      if (current.rowVersion !== command.expectedRowVersion) {
        throw conflict('OPTIC-WF-40901', 'This item changed after you opened it. Refresh and try again.');
      }
      await this.repository.setActiveRelease(current.definitionId, null, executor);
      await this.outbox.append(
        createConfigOutboxEvent({
          actor,
          eventType: 'CONFIG_ACTIVATED',
          aggregateType: 'DEFINITION_RELEASE',
          aggregateId: `${command.definitionKey}:${command.version}`,
          definitionKey: command.definitionKey,
          version: command.version,
          change: 'DEACTIVATED',
          checksum: current.checksum ?? undefined
        }),
        executor
      );
      return assembleDefinitionRelease(this.repository, current, executor);
    });
  }

  async exportRelease(
    actor: ActorContext,
    definitionKey: string,
    version: string
  ): Promise<{
    package: Record<string, unknown>;
    checksum: string | null;
    checksumAlgorithm: string | null;
    files: Record<string, string>;
  }> {
    await this.authorization.assertCanReadConfiguration(actor);
    const record = await this.requireRelease(definitionKey, version);
    const assembled = await assembleDefinitionRelease(this.repository, record);
    const pkg = record.canonicalPackage
      ? (record.canonicalPackage as unknown as CanonicalPackage)
      : buildCanonicalPackage(assembled);
    const signed = record.checksum
      ? { checksum: record.checksum, algorithm: record.checksumAlgorithm }
      : checksumCanonicalPackage(pkg);
    return {
      package: pkg as unknown as Record<string, unknown>,
      checksum: signed.checksum,
      checksumAlgorithm: signed.algorithm ?? 'SHA-256',
      files: buildPackageFiles(pkg, assembled)
    };
  }

  async diffReleases(
    actor: ActorContext,
    definitionKey: string,
    fromVersion: string,
    toVersion: string
  ): Promise<SemanticDiff> {
    await this.authorization.assertCanReadConfiguration(actor);
    const from = await this.assemble(definitionKey, fromVersion);
    const to = await this.assemble(definitionKey, toVersion);
    return diffReleases(from, to);
  }

  private async assemble(definitionKey: string, version: string): Promise<DefinitionRelease> {
    const release = await this.requireRelease(definitionKey, version);
    return assembleDefinitionRelease(this.repository, release);
  }

  private async transition(
    actor: ActorContext,
    command: LifecycleCommand,
    from: DefinitionRelease['lifecycleStatus'],
    to: DefinitionRelease['lifecycleStatus'],
    eventType: 'CONFIG_SUBMITTED' | 'CONFIG_APPROVED' | 'CONFIG_CHANGED' | 'CONFIG_RETIRED',
    change: string,
    extras: {
      submittedBy?: string | null;
      approvedBy?: string | null;
      setRetired?: boolean;
      comment?: string;
    } = {}
  ): Promise<DefinitionRelease> {
    return this.runInTransaction(async (executor) => {
      const current = await this.requireRelease(command.definitionKey, command.version, executor);
      assertLifecycleTransition(current.lifecycleStatus, to, change);
      if (current.lifecycleStatus !== from || current.rowVersion !== command.expectedRowVersion) {
        throw conflict('OPTIC-WF-40901', 'This item changed after you opened it. Refresh and try again.');
      }
      const updated = await this.repository.updateLifecycle(
        {
          releaseId: current.id,
          expectedRowVersion: command.expectedRowVersion,
          expectedStatus: from,
          lifecycleStatus: to,
          manifest: withManifestLifecycle(current.manifest, to, {
            ...(extras.approvedBy ? { approvedBy: extras.approvedBy } : {}),
            rejectedComment: to === 'REJECTED' ? extras.comment ?? command.comment ?? null : null
          }),
          submittedBy: extras.submittedBy,
          approvedBy: extras.approvedBy,
          setRetired: extras.setRetired
        },
        executor
      );
      await this.outbox.append(
        createConfigOutboxEvent({
          actor,
          eventType,
          aggregateType: 'DEFINITION_RELEASE',
          aggregateId: `${command.definitionKey}:${command.version}`,
          definitionKey: command.definitionKey,
          version: command.version,
          change,
          comment: extras.comment ?? command.comment
        }),
        executor
      );
      return assembleDefinitionRelease(this.repository, updated, executor);
    });
  }

  private async saveChild<T extends object>(
    actor: ActorContext,
    command: SaveDraftCommand<T>,
    kind: DefinitionChildKind,
    stableKey: string,
    payload: T
  ): Promise<DefinitionRelease> {
    assertStableKey(stableKey, `${kind}Key`);
    return this.saveDraft(actor, command, async (release, executor) => {
      await this.repository.upsertChild(
        release.id,
        kind,
        stableKey,
        payload as Record<string, unknown>,
        executor
      );
      return release.manifest;
    });
  }

  private async deleteChild(
    actor: ActorContext,
    command: { definitionKey: string; version: string; expectedRowVersion: number },
    kind: DefinitionChildKind,
    stableKey: string,
    keyLabel: string
  ): Promise<DefinitionRelease> {
    assertStableKey(stableKey, keyLabel);
    return this.saveDraft(actor, command, async (release, executor) => {
      await this.repository.deleteChild(release.id, kind, stableKey, executor);
      return release.manifest;
    });
  }

  private async saveDraft<T>(
    actor: ActorContext,
    command: Pick<SaveDraftCommand<T>, 'definitionKey' | 'version' | 'expectedRowVersion'>,
    mutate: (release: DefinitionReleaseRecord, executor?: QueryExecutor) => Promise<Record<string, unknown>>
  ): Promise<DefinitionRelease> {
    await this.authorization.assertCanMutateConfiguration(actor);
    return this.runInTransaction(async (executor) => {
      const release = await this.requireRelease(command.definitionKey, command.version, executor);
      assertDraftOnly(release.lifecycleStatus, 'Save draft');
      if (release.rowVersion !== command.expectedRowVersion) {
        throw conflict('OPTIC-WF-40901', 'This item changed after you opened it. Refresh and try again.');
      }
      const nextManifest = await mutate(release, executor);
      await this.repository.updateReleaseManifest(release.id, command.expectedRowVersion, nextManifest, executor);
      await this.outbox.append(
        createConfigOutboxEvent({
          actor,
          eventType: 'CONFIG_CHANGED',
          aggregateType: 'DEFINITION_RELEASE',
          aggregateId: `${command.definitionKey}:${command.version}`,
          definitionKey: command.definitionKey,
          version: command.version,
          change: 'DRAFT_UPDATED'
        }),
        executor
      );
      const updated = await this.requireRelease(command.definitionKey, command.version, executor);
      return assembleDefinitionRelease(this.repository, updated, executor);
    });
  }

  private async requireRelease(definitionKey: string, version: string, executor?: QueryExecutor) {
    const release = await this.repository.findReleaseByKeyAndVersion(definitionKey, version, executor);
    if (!release) {
      throw notFound('OPTIC-CONFIG-40402', `Release ${definitionKey} ${version} was not found.`);
    }
    return release;
  }
}

function assertNotSameActor(actorId: string, blockedId: string | null, action: string): void {
  if (blockedId && blockedId === actorId) {
    throw new AppError(
      'OPTIC-AUTHZ-40302',
      `Separation of duties does not allow you to ${action}.`,
      403,
      [{ actorId, blockedActorId: blockedId }],
      `Separation of duties does not allow you to ${action}.`
    );
  }
}

function validateWorkflow(workflow: WorkflowDefinition): void {
  if (workflow.initialStageKey) {
    assertStableKey(workflow.initialStageKey, 'initialStageKey');
  }
  workflow.terminalStageKeys.forEach((key) => assertStableKey(key, 'terminalStageKeys'));
  assertUniqueKeys(
    workflow.stages.map((stage) => stage.stageKey),
    'stageKey'
  );
  assertUniqueKeys(
    workflow.transitionSets.map((set) => set.transitionSetKey),
    'transitionSetKey'
  );
  for (const stage of workflow.stages) {
    assertStableKey(stage.stageKey, 'stageKey');
    if (stage.formKey) {
      assertStableKey(stage.formKey, 'formKey');
    }
    if (stage.queueKey) {
      assertStableKey(stage.queueKey, 'queueKey');
    }
    if (stage.slaKey) {
      assertStableKey(stage.slaKey, 'slaKey');
    }
    if (stage.transitionSetKey) {
      assertStableKey(stage.transitionSetKey, 'transitionSetKey');
    }
    stage.actionKeys.forEach((key) => assertStableKey(key, 'actionKey'));
    (stage.bulkActionKeys ?? []).forEach((key) => assertStableKey(key, 'bulkActionKey'));
  }
  for (const set of workflow.transitionSets) {
    assertStableKey(set.transitionSetKey, 'transitionSetKey');
    if (set.defaultTargetStageKey) {
      assertStableKey(set.defaultTargetStageKey, 'defaultTargetStageKey');
    }
    for (const rule of set.rules) {
      assertStableKey(rule.ruleKey, 'ruleKey');
      assertStableKey(rule.targetStageKey, 'targetStageKey');
    }
  }
}
