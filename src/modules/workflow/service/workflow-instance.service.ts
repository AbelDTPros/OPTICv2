import type { QueryExecutor } from '../../../platform/db/types.js';
import { conflict, notFound, validationFailed, AppError } from '../../../platform/errors/app-error.js';
import type { ActorContext } from '../../../platform/security/actor.js';
import type { AuthorizationPort } from '../../../platform/security/authorization-port.js';
import { createWorkflowOutboxEvent } from '../../../platform/outbox/workflow-events.js';
import type { OutboxRepository } from '../../../platform/outbox/outbox.repository.js';
import { replayOrExecute } from '../../../platform/idempotency/replay.js';
import type { IdempotencyRepository } from '../../../platform/idempotency/idempotency.repository.js';
import type { DefinitionLoader } from '../../configuration/definitions/definition-loader.js';
import type { CompiledDefinition } from '../../configuration/definitions/compiled-definition.js';
import type { DefinitionRepository } from '../../configuration/persistence/definition.repository.js';
import { assignmentPermissions, type AssignmentPermissions } from '../../configuration/domain/assignment-policy.js';
import { applyFillFromToBusinessData } from '../../configuration/domain/fill-from.js';
import type { ActionDefinition, JsonSchema, ScheduledActionDefinition, StageFormDefinition, WorkflowDefinition } from '../../configuration/domain/types.js';
import { resolveTransitionSetKey } from '../../configuration/domain/transition-set-key.js';
import { resolveTransition } from '../../../rules/transition-resolver.js';
import { assertBulkEligibility } from '../../bulk/domain/eligibility.js';
import { applyWriteMappings } from '../../bulk/domain/write-mappings.js';
import { calculateFieldDeltas } from '../domain/field-deltas.js';
import { applyMergePatch, assertPatchWithinPath } from '../domain/merge-patch.js';
import { dueAtFromDelay, nextRetryDueAt, scheduledActionType, scheduledActionsForStage, scheduledBackoff, scheduledMaxAttempts, scheduledTargetStage, shouldCancelOnStageChange, triggerStageKey } from '../domain/scheduled-actions.js';
import { parseScanPayload } from '../../tracking/domain/scan-payload.js';
import { businessDataMentionsTrackingId, collectSpawnWorkloadRequests, overlaySpawnRowOnChild } from '../domain/spawn-workloads.js';
import {
  buildProjectChildWriteBack,
  projectChildrenOntoParentBusinessData,
  projectParentOntoChildBusinessData
} from '../domain/packet-field-bindings.js';
import { assertStageDataValid } from '../domain/validate-stage-data.js';
import type {
  ScheduledWorkflowActionRecord,
  WorkflowInstanceRecord,
  WorkflowInstanceStatus,
  WorkflowStageVisitRecord
} from '../domain/types.js';
import type { WorkflowInstanceRepository } from '../persistence/workflow-instance.repository.js';
import { projectInstance } from '../../queue/domain/project.js';
import type { QueueProjectionRepository } from '../../queue/persistence/queue-projection.repository.js';

export type TransactionRunner = <T>(work: (executor?: QueryExecutor) => Promise<T>) => Promise<T>;

export interface CreateInstanceCommand {
  entityType: string;
  entityTrackingId: string;
  definitionKey: string;
  version?: string;
}

export interface EnterStageCommand {
  entityType: string;
  entityTrackingId: string;
  stageKey: string;
  expectedRowVersion: number;
  exitActionKey?: string;
}

export interface AssignmentCommand {
  entityType: string;
  entityTrackingId: string;
  expectedRowVersion: number;
}

export interface ReassignCommand extends AssignmentCommand {
  assignedTo: string;
}

export interface SaveDraftCommand {
  entityType: string;
  entityTrackingId: string;
  expectedRowVersion: number;
  dataPatch: Record<string, unknown>;
  stageKey?: string;
}

export interface ExecuteActionCommand {
  entityType: string;
  entityTrackingId: string;
  actionKey: string;
  expectedRowVersion: number;
  dataPatch?: Record<string, unknown>;
  comment?: string;
}

export type ScheduledActionOutcome = 'COMPLETED' | 'SKIPPED';

export interface ExecuteScheduledActionCommand {
  scheduledActionId: number;
  leaseOwner: string;
}

export interface ApplyBulkItemCommand {
  entityType: string;
  entityTrackingId: string;
  bulkActionKey: string;
  expectedRowVersion: number;
  input: Record<string, unknown>;
}

export interface WorkflowSummary {
  trackingId: string;
  entityType: string;
  workflowInstanceId: number;
  status: WorkflowInstanceStatus;
  definition: {
    definitionKey: string;
    version: string;
    releaseId: string;
  };
  workflow: {
    currentStageKey: string;
    currentStageLabel: string;
    enteredStageAt: string;
    assignedTo: string | null;
    rowVersion: number;
    openVisitNumber: number | null;
  };
  businessData: Record<string, unknown>;
  assignmentPermissions: AssignmentPermissions;
  allowedActions: Array<{ actionKey: string; label: string }>;
  stageForm: {
    formKey: string;
    title: string;
    dataPath: string;
    schema: JsonSchema;
    ui: StageFormDefinition;
  } | null;
  visits: Array<{
    stageKey: string;
    visitNumber: number;
    enteredAt: string;
    completedAt: string | null;
    nextStageKey: string | null;
    enteredBy: string | null;
    assignedTo: string | null;
    completedBy: string | null;
  }>;
  forms: Record<string, StageFormDefinition>;
  workflowDefinition: WorkflowDefinition;
  packet?: {
    parent?: WorkflowSummary;
    children?: WorkflowSummary[];
  };
}

export interface WorkflowQueueItem {
  trackingId: string;
  entityType: string;
  workflowInstanceId: number;
  status: WorkflowInstanceStatus;
  currentStageKey: string;
  currentStageLabel: string;
  assignedTo: string | null;
  enteredStageAt: string;
  rowVersion: number;
  businessData: Record<string, unknown>;
}

export interface WorkflowInstanceList {
  definitionKey: string;
  version: string;
  releaseId: string;
  items: WorkflowQueueItem[];
}

export class WorkflowInstanceService {
  constructor(
    private readonly instances: WorkflowInstanceRepository,
    private readonly definitions: DefinitionRepository,
    private readonly loader: DefinitionLoader,
    private readonly authorization: AuthorizationPort,
    private readonly runInTransaction: TransactionRunner,
    private readonly outbox: OutboxRepository,
    private readonly projections: QueueProjectionRepository,
    private readonly idempotency?: IdempotencyRepository
  ) {}

  async createInstance(actor: ActorContext, command: CreateInstanceCommand): Promise<WorkflowSummary> {
    await this.authorization.assertCanCreateWorkflow(actor);
    const trackingId = command.entityTrackingId.trim();
    if (!trackingId) {
      throw validationFailed('OPTIC-VAL-40001', 'entityTrackingId is required.', [
        { field: 'entityTrackingId', path: 'entityTrackingId', message: 'Required' }
      ]);
    }

    const compiled = await this.loadPublishedRelease(command.definitionKey, command.version);
    if (compiled.release.entityType !== command.entityType) {
      throw validationFailed(
        'OPTIC-WF-40044',
        `Entity type ${command.entityType} does not match definition ${compiled.definitionKey}.`
      );
    }
    const rehearsal = isRehearsalCreate(command.version, compiled.lifecycleStatus);
    const instance = await this.runInTransaction(async (executor) => {
      return this.insertCreatedInstance(actor, command.entityType, trackingId, compiled, executor, undefined, rehearsal);
    });

    return this.summarize(instance, compiled);
  }

  async getSummary(actor: ActorContext, entityType: string, entityTrackingId: string): Promise<WorkflowSummary> {
    await this.authorization.assertCanReadWorkflow(actor);
    const instance = await this.requireInstance(entityType, entityTrackingId);
    const compiled = await this.loader.loadByReleaseId(instance.definitionReleaseId);
    return this.summarize(instance, compiled);
  }

  async scan(actor: ActorContext, rawQuery: string): Promise<{ query: string; matches: WorkflowSummary[] }> {
    await this.authorization.assertCanReadWorkflow(actor);
    const parsed = parseScanPayload(rawQuery);
    if (!parsed) {
      throw validationFailed('OPTIC-WF-40095', 'Scan a label or enter a tracking id.', [
        { field: 'q', path: 'q', message: 'Required' }
      ]);
    }
    const rows = parsed.entityType
      ? [await this.instances.findByEntity(parsed.entityType, parsed.trackingId)].filter(
          (row): row is WorkflowInstanceRecord => row !== null
        )
      : await this.instances.findByTrackingId(parsed.trackingId);
    if (rows.length === 0) {
      throw notFound('OPTIC-WF-40410', `No case matched that tracking label.`);
    }
    const matches = await Promise.all(
      rows.map(async (row) => this.summarize(row, await this.loader.loadByReleaseId(row.definitionReleaseId)))
    );
    return { query: parsed.trackingId, matches };
  }

  async listInstancesForRelease(
    actor: ActorContext,
    definitionKey: string,
    version: string
  ): Promise<WorkflowInstanceList> {
    await this.authorization.assertCanReadWorkflow(actor);
    const compiled = await this.loadPublishedRelease(definitionKey, version);
    const rows = await this.instances.listByReleaseId(Number(compiled.releaseId));
    return {
      definitionKey: compiled.definitionKey,
      version: compiled.version,
      releaseId: compiled.releaseId,
      items: rows.map((instance) => this.toQueueItem(instance, compiled))
    };
  }

  async enterStage(actor: ActorContext, command: EnterStageCommand): Promise<WorkflowSummary> {
    await this.authorization.assertCanCreateWorkflow(actor);
    const instance = await this.requireInstance(command.entityType, command.entityTrackingId);
    const compiled = await this.loader.loadByReleaseId(instance.definitionReleaseId);
    const stage = compiled.release.workflow.stages.find((item) => item.stageKey === command.stageKey);
    if (!stage) {
      throw validationFailed(
        'OPTIC-WF-40042',
        `Pinned release ${compiled.definitionKey} ${compiled.version} does not contain stage ${command.stageKey}.`
      );
    }
    const stageRow = await this.requireStageRow(instance.definitionReleaseId, command.stageKey);

    const updated = await this.runInTransaction(async (executor) => {
      const current = await this.instances.findById(instance.id, executor);
      if (!current) {
        throw notFound('OPTIC-WF-40410', `Workflow instance ${instance.id} was not found.`);
      }
      const open = await this.instances.findOpenVisit(current.id, executor);
      if (open) {
        await this.instances.completeVisit(
          {
            visitId: open.id,
            completedBy: actor.actorId,
            exitActionKey: command.exitActionKey,
            nextStageKey: command.stageKey
          },
          executor
        );
      }
      const visitNumber = await this.instances.nextVisitNumber(current.id, command.stageKey, executor);
      await this.cancelCancellableScheduledActions(compiled, current.id, executor);
      const opened = await this.instances.insertVisit(
        {
          workflowInstanceId: current.id,
          stageDefinitionId: stageRow.id,
          stageKey: command.stageKey,
          visitNumber,
          enteredBy: actor.actorId
        },
        executor
      );
      const next = await this.instances.updateStage(
        {
          instanceId: current.id,
          expectedRowVersion: command.expectedRowVersion,
          currentStageDefinitionId: stageRow.id,
          currentStageKey: command.stageKey,
          status: stageStatus(compiled, command.stageKey)
        },
        executor
      );
      await this.scheduleForEnteredStage(actor, compiled, next, opened.id, executor);
      await this.instances.insertWorkloadTransition(
        {
          workflowInstanceId: current.id,
          entityType: current.entityType,
          entityTrackingId: current.entityTrackingId,
          definitionReleaseId: current.definitionReleaseId,
          fromStageKey: current.currentStageKey,
          toStageKey: command.stageKey,
          actionKey: command.exitActionKey ?? 'STAGE_REENTRY',
          stageVisitId: open?.id ?? null,
          actorId: actor.actorId
        },
        executor
      );
      await this.outbox.append(
        createWorkflowOutboxEvent({
          actor,
          eventType: 'STAGE_TRANSITIONED',
          entityType: current.entityType,
          entityTrackingId: current.entityTrackingId,
          definitionKey: compiled.definitionKey,
          definitionVersion: compiled.version,
          workflowInstanceId: current.id,
          fromStageKey: current.currentStageKey,
          toStageKey: command.stageKey,
          actionKey: command.exitActionKey ?? 'STAGE_REENTRY',
          stageVisitId: open?.id ?? null
        }),
        executor
      );
      await this.outbox.append(
        createWorkflowOutboxEvent({
          actor,
          eventType: 'STAGE_ENTERED',
          entityType: current.entityType,
          entityTrackingId: current.entityTrackingId,
          definitionKey: compiled.definitionKey,
          definitionVersion: compiled.version,
          workflowInstanceId: current.id,
          fromStageKey: current.currentStageKey,
          toStageKey: command.stageKey,
          actionKey: command.exitActionKey ?? 'STAGE_REENTRY',
          stageVisitId: opened.id
        }),
        executor
      );
      await this.syncProjection(next, compiled, executor);
      return next;
    });

    return this.summarize(updated, compiled);
  }

  async assignToSelf(actor: ActorContext, command: AssignmentCommand): Promise<WorkflowSummary> {
    await this.authorization.assertCanCreateWorkflow(actor);
    const instance = await this.requireInstance(command.entityType, command.entityTrackingId);
    const compiled = await this.loader.loadByReleaseId(instance.definitionReleaseId);
    assertAssignmentPermission(instance, compiled, 'assign');
    const updated = await this.runInTransaction(async (executor) => {
      const next = await this.instances.assignToSelf(
        {
          instanceId: instance.id,
          expectedRowVersion: command.expectedRowVersion,
          assignedTo: actor.actorId
        },
        executor
      );
      await this.instances.updateOpenVisitAssignment(instance.id, actor.actorId, executor);
      const open = await this.instances.findOpenVisit(instance.id, executor);
      await this.outbox.append(
        createWorkflowOutboxEvent({
          actor,
          eventType: 'WORKLOAD_ASSIGNED',
          entityType: instance.entityType,
          entityTrackingId: instance.entityTrackingId,
          definitionKey: compiled.definitionKey,
          definitionVersion: compiled.version,
          workflowInstanceId: instance.id,
          toStageKey: instance.currentStageKey,
          assignedTo: actor.actorId,
          stageVisitId: open?.id ?? null
        }),
        executor
      );
      await this.syncProjection(next, compiled, executor);
      return next;
    });
    return this.summarize(updated, compiled);
  }

  async reassign(actor: ActorContext, command: ReassignCommand): Promise<WorkflowSummary> {
    await this.authorization.assertCanReassignWorkflow(actor);
    const assignedTo = command.assignedTo.trim();
    if (!assignedTo) {
      throw validationFailed('OPTIC-WF-40090', 'assignedTo is required for reassignment.', [
        { field: 'assignedTo', path: 'assignedTo', message: 'Enter the officer to assign.' }
      ]);
    }
    const instance = await this.requireInstance(command.entityType, command.entityTrackingId);
    const compiled = await this.loader.loadByReleaseId(instance.definitionReleaseId);
    assertAssignmentPermission(instance, compiled, 'reassign');
    if (instance.assignedTo === assignedTo) {
      throw validationFailed(
        'OPTIC-WF-40091',
        `${command.entityTrackingId} is already assigned to ${assignedTo}.`,
        [{ field: 'assignedTo', path: 'assignedTo', message: 'Choose a different assignee.' }]
      );
    }
    const previousAssignedTo = instance.assignedTo;
    const updated = await this.runInTransaction(async (executor) => {
      const next = await this.instances.reassignTo(
        {
          instanceId: instance.id,
          expectedRowVersion: command.expectedRowVersion,
          assignedTo
        },
        executor
      );
      await this.instances.updateOpenVisitAssignment(instance.id, assignedTo, executor);
      const open = await this.instances.findOpenVisit(instance.id, executor);
      await this.outbox.append(
        createWorkflowOutboxEvent({
          actor,
          eventType: 'WORKLOAD_REASSIGNED',
          entityType: instance.entityType,
          entityTrackingId: instance.entityTrackingId,
          definitionKey: compiled.definitionKey,
          definitionVersion: compiled.version,
          workflowInstanceId: instance.id,
          toStageKey: instance.currentStageKey,
          assignedTo,
          previousAssignedTo,
          stageVisitId: open?.id ?? null
        }),
        executor
      );
      await this.syncProjection(next, compiled, executor);
      return next;
    });
    return this.summarize(updated, compiled);
  }

  async releaseAssignment(actor: ActorContext, command: AssignmentCommand): Promise<WorkflowSummary> {
    await this.authorization.assertCanCreateWorkflow(actor);
    const instance = await this.requireInstance(command.entityType, command.entityTrackingId);
    const compiled = await this.loader.loadByReleaseId(instance.definitionReleaseId);
    assertAssignmentPermission(instance, compiled, 'release');
    const updated = await this.runInTransaction(async (executor) => {
      const next = await this.instances.releaseAssignment(
        {
          instanceId: instance.id,
          expectedRowVersion: command.expectedRowVersion,
          assignedTo: actor.actorId
        },
        executor
      );
      await this.instances.updateOpenVisitAssignment(instance.id, null, executor);
      const open = await this.instances.findOpenVisit(instance.id, executor);
      await this.outbox.append(
        createWorkflowOutboxEvent({
          actor,
          eventType: 'WORKLOAD_RELEASED',
          entityType: instance.entityType,
          entityTrackingId: instance.entityTrackingId,
          definitionKey: compiled.definitionKey,
          definitionVersion: compiled.version,
          workflowInstanceId: instance.id,
          toStageKey: instance.currentStageKey,
          assignedTo: null,
          stageVisitId: open?.id ?? null
        }),
        executor
      );
      await this.syncProjection(next, compiled, executor);
      return next;
    });
    return this.summarize(updated, compiled);
  }

  async saveDraft(actor: ActorContext, command: SaveDraftCommand): Promise<WorkflowSummary> {
    await this.authorization.assertCanCreateWorkflow(actor);
    const instance = await this.requireInstance(command.entityType, command.entityTrackingId);
    const compiled = await this.loader.loadByReleaseId(instance.definitionReleaseId);
    const stage = compiled.release.workflow.stages.find((item) => item.stageKey === instance.currentStageKey);
    if (command.stageKey && command.stageKey !== instance.currentStageKey) {
      throw validationFailed(
        'OPTIC-WF-40045',
        `Workflow is at ${instance.currentStageKey}, not ${command.stageKey}.`
      );
    }
    if (!stage?.formKey) {
      throw validationFailed(
        'OPTIC-WF-40046',
        `Stage ${instance.currentStageKey} has no form, so draft data cannot be saved.`
      );
    }
    const form = compiled.release.forms[stage.formKey];
    if (!form) {
      throw validationFailed(
        'OPTIC-WF-40046',
        `Pinned release does not contain form ${stage.formKey}.`
      );
    }
    if (stage.assignmentPolicy.required && instance.assignedTo !== actor.actorId) {
      throw conflict(
        'OPTIC-WF-40905',
        'This item must be assigned to you before you can save.',
        [
          {
            field: 'assignedTo',
            path: 'assignedTo',
            message: 'Assign the item to yourself and try again.',
            currentRowVersion: instance.rowVersion,
            assignedTo: instance.assignedTo
          }
        ]
      );
    }

    assertPatchWithinPath(command.dataPatch, form.dataPath, { entityType: instance.entityType });
    const nextData = applyMergePatch(instance.businessData, command.dataPatch);
    if (nextData === null || typeof nextData !== 'object' || Array.isArray(nextData)) {
      throw validationFailed('OPTIC-WF-40047', 'Stage data must remain a JSON object.');
    }
    const businessData = applyFillFromToBusinessData(
      form,
      nextData as Record<string, unknown>,
      instance.assignedTo
    );
    assertStageDataValid(compiled.schema, businessData, form, {
      mode: 'draft',
      schema: compiled.release.schema
    });
    const deltas = calculateFieldDeltas(instance.businessData, businessData, form);

    const updated = await this.runInTransaction(async (executor) => {
      const next = await this.instances.updateBusinessData(
        {
          instanceId: instance.id,
          expectedRowVersion: command.expectedRowVersion,
          businessData
        },
        executor
      );
      const open = await this.instances.findOpenVisit(instance.id, executor);
      await this.outbox.append(
        createWorkflowOutboxEvent({
          actor,
          eventType: 'DRAFT_SAVED',
          entityType: instance.entityType,
          entityTrackingId: instance.entityTrackingId,
          definitionKey: compiled.definitionKey,
          definitionVersion: compiled.version,
          workflowInstanceId: instance.id,
          toStageKey: instance.currentStageKey,
          formKey: form.formKey,
          dataPath: form.dataPath,
          changedFieldCount: deltas.length,
          stageVisitId: open?.id ?? null
        }),
        executor
      );
      await this.outbox.append(
        createWorkflowOutboxEvent({
          actor,
          eventType: 'FIELD_CHANGED',
          entityType: instance.entityType,
          entityTrackingId: instance.entityTrackingId,
          definitionKey: compiled.definitionKey,
          definitionVersion: compiled.version,
          workflowInstanceId: instance.id,
          toStageKey: instance.currentStageKey,
          formKey: form.formKey,
          dataPath: form.dataPath,
          changedFieldCount: deltas.length,
          fieldDeltas: deltas,
          stageVisitId: open?.id ?? null
        }),
        executor
      );
      await this.syncProjection(next, compiled, executor);
      return next;
    });

    await this.writeBackProjectChildBindings(updated, compiled, businessData);
    return this.summarize(updated, compiled);
  }

  async executeAction(actor: ActorContext, command: ExecuteActionCommand): Promise<WorkflowSummary> {
    await this.authorization.assertCanCreateWorkflow(actor);
    const instance = await this.requireInstance(command.entityType, command.entityTrackingId);
    const compiled = await this.loader.loadByReleaseId(instance.definitionReleaseId);
    const currentStage = compiled.release.workflow.stages.find(
      (item) => item.stageKey === instance.currentStageKey
    );
    if (!currentStage) {
      throw validationFailed(
        'OPTIC-WF-40042',
        `Pinned release ${compiled.definitionKey} ${compiled.version} does not contain stage ${instance.currentStageKey}.`
      );
    }
    const action = compiled.release.actions[command.actionKey];
    if (!action) {
      throw validationFailed('OPTIC-WF-40048', `Action ${command.actionKey} is not defined on the pinned release.`);
    }
    if (!currentStage.actionKeys.includes(command.actionKey)) {
      throw validationFailed(
        'OPTIC-WF-40049',
        `Action ${command.actionKey} is not allowed in stage ${instance.currentStageKey}.`
      );
    }

    if (action.type === 'SAVE') {
      return this.saveDraft(actor, {
        entityType: command.entityType,
        entityTrackingId: command.entityTrackingId,
        expectedRowVersion: command.expectedRowVersion,
        dataPatch: command.dataPatch ?? {}
      });
    }
    if (action.type === 'RELEASE_ASSIGNMENT') {
      return this.releaseAssignment(actor, {
        entityType: command.entityType,
        entityTrackingId: command.entityTrackingId,
        expectedRowVersion: command.expectedRowVersion
      });
    }

    const requireAssignee = requiresAssignee(action, currentStage);
    if (requireAssignee && instance.assignedTo !== actor.actorId) {
      throw conflict('OPTIC-WF-40905', 'This item must be assigned to you before you can continue.', [
        {
          field: 'assignedTo',
          path: 'assignedTo',
          message: 'Assign the item to yourself and try again.',
          currentRowVersion: instance.rowVersion,
          assignedTo: instance.assignedTo
        }
      ]);
    }

    const form = currentStage.formKey ? compiled.release.forms[currentStage.formKey] : undefined;
    let businessData = instance.businessData;
    let deltas: ReturnType<typeof calculateFieldDeltas> = [];
    if (command.dataPatch && Object.keys(command.dataPatch).length > 0) {
      if (form) {
        assertPatchWithinPath(command.dataPatch, form.dataPath, { entityType: instance.entityType });
      }
      const merged = applyMergePatch(instance.businessData, command.dataPatch);
      if (merged === null || typeof merged !== 'object' || Array.isArray(merged)) {
        throw validationFailed('OPTIC-WF-40047', 'Stage data must remain a JSON object.');
      }
      businessData = merged as Record<string, unknown>;
    }
    if (form) {
      businessData = applyFillFromToBusinessData(form, businessData, instance.assignedTo);
      deltas = calculateFieldDeltas(instance.businessData, businessData, form);
    }

    if (action.validation?.validateStageForm !== false) {
      assertStageDataValid(compiled.schema, businessData, form);
    }

    const transitionSetKey = resolveTransitionSetKey(currentStage, action);
    if (!transitionSetKey) {
      throw validationFailed(
        'OPTIC-CONFIG-40023',
        `Action ${action.actionKey} has no transition set.`
      );
    }
    const transitionSet = compiled.release.workflow.transitionSets.find(
      (set) => set.transitionSetKey === transitionSetKey
    );
    if (!transitionSet) {
      throw validationFailed(
        'OPTIC-CONFIG-40023',
        `Unknown transition set ${transitionSetKey}.`
      );
    }

    const decision = resolveTransition(
      transitionSet,
      {
        businessData,
        workflow: {
          currentStageKey: instance.currentStageKey,
          assignedTo: instance.assignedTo
        }
      },
      compiled.compiledRegexes
    );
    const destination = compiled.release.workflow.stages.find((item) => item.stageKey === decision.targetStageKey);
    if (!destination) {
      throw validationFailed(
        'OPTIC-WF-40042',
        `Pinned release ${compiled.definitionKey} ${compiled.version} does not contain stage ${decision.targetStageKey}.`
      );
    }
    const destRow = await this.requireStageRow(instance.definitionReleaseId, destination.stageKey);
    const clearAssignment =
      action.assignment?.clearOnTransition === true ||
      (action.assignment?.clearOnTransition !== false && currentStage.assignmentPolicy.clearOnTransition);

    const updated = await this.runInTransaction(async (executor) => {
      const next = await this.applyStageTransition(
        actor,
        instance,
        compiled,
        destination.stageKey,
        destRow.id,
        action.actionKey,
        {
          expectedRowVersion: command.expectedRowVersion,
          businessData,
          deltas,
          form,
          comment: command.comment,
          requireAssignedTo: requireAssignee ? actor.actorId : undefined,
          clearAssignment
        },
        executor
      );
      await this.spawnMailWorkloads(actor, instance, compiled, form, businessData, executor);
      return next;
    });

    await this.writeBackProjectChildBindings(updated, compiled, businessData);
    return this.summarize(updated, compiled);
  }

  async applyBulkItem(
    actor: ActorContext,
    command: ApplyBulkItemCommand,
    executor?: QueryExecutor
  ): Promise<WorkflowInstanceRecord> {
    const instance = await this.requireInstance(command.entityType, command.entityTrackingId, executor);
    const compiled = await this.loader.loadByReleaseId(instance.definitionReleaseId);
    const bulk = compiled.release.bulkActions[command.bulkActionKey];
    if (!bulk) {
      throw validationFailed(
        'OPTIC-WF-40080',
        `Bulk action ${command.bulkActionKey} is not defined on the pinned release.`
      );
    }
    if (instance.currentStageKey !== bulk.stageKey) {
      throw validationFailed(
        'OPTIC-WF-40084',
        `${command.entityTrackingId} is in ${instance.currentStageKey}, not ${bulk.stageKey}.`,
        [{ field: 'trackingId', path: 'items.trackingId', message: `Required stage is ${bulk.stageKey}.` }]
      );
    }
    assertBulkEligibility(bulk.eligibility, instance, actor);

    const currentStage = compiled.release.workflow.stages.find(
      (item) => item.stageKey === instance.currentStageKey
    );
    const form = currentStage?.formKey ? compiled.release.forms[currentStage.formKey] : undefined;
    const businessData =
      bulk.writeMappings && bulk.writeMappings.length > 0
        ? applyWriteMappings(instance.businessData, command.input, bulk.writeMappings)
        : instance.businessData;
    const deltas = form ? calculateFieldDeltas(instance.businessData, businessData, form) : [];

    if (bulk.transition?.targetStage) {
      const destination = compiled.release.workflow.stages.find(
        (item) => item.stageKey === bulk.transition?.targetStage
      );
      if (!destination) {
        throw validationFailed(
          'OPTIC-WF-40042',
          `Pinned release ${compiled.definitionKey} ${compiled.version} does not contain stage ${bulk.transition.targetStage}.`
        );
      }
      const destRow = await this.requireStageRow(instance.definitionReleaseId, destination.stageKey);
      return this.applyStageTransition(
        actor,
        instance,
        compiled,
        destination.stageKey,
        destRow.id,
        command.bulkActionKey,
        {
          expectedRowVersion: command.expectedRowVersion,
          businessData,
          deltas,
          form,
          clearAssignment: currentStage?.assignmentPolicy.clearOnTransition ?? true
        },
        executor
      );
    }

    if (businessData === instance.businessData) {
      return instance;
    }
    const next = await this.instances.updateBusinessData(
      {
        instanceId: instance.id,
        expectedRowVersion: command.expectedRowVersion,
        businessData
      },
      executor
    );
    const open = await this.instances.findOpenVisit(instance.id, executor);
    if (deltas.length > 0) {
      await this.outbox.append(
        createWorkflowOutboxEvent({
          actor,
          eventType: 'FIELD_CHANGED',
          entityType: instance.entityType,
          entityTrackingId: instance.entityTrackingId,
          definitionKey: compiled.definitionKey,
          definitionVersion: compiled.version,
          workflowInstanceId: instance.id,
          toStageKey: instance.currentStageKey,
          actionKey: command.bulkActionKey,
          formKey: form?.formKey,
          dataPath: form?.dataPath,
          changedFieldCount: deltas.length,
          fieldDeltas: deltas,
          stageVisitId: open?.id ?? null
        }),
        executor
      );
    }
    await this.syncProjection(next, compiled, executor);
    return next;
  }

  async claimDueScheduledActions(
    owner: string,
    leaseMs: number,
    limit: number
  ): Promise<ScheduledWorkflowActionRecord[]> {
    return this.instances.claimDueScheduledActions({ owner, leaseMs, limit });
  }

  async abandonScheduledLeases(owner: string): Promise<number> {
    return this.instances.abandonScheduledLeases(owner);
  }

  async updateScheduledDueAt(id: number, dueAt: Date): Promise<void> {
    await this.instances.updateScheduledDueAt(id, dueAt);
  }

  async getScheduledAction(id: number): Promise<ScheduledWorkflowActionRecord | null> {
    return this.instances.findScheduledActionById(id);
  }

  async listScheduledActions(workflowInstanceId: number): Promise<ScheduledWorkflowActionRecord[]> {
    return this.instances.listScheduledActions(workflowInstanceId);
  }

  async executeScheduledAction(
    actor: ActorContext,
    command: ExecuteScheduledActionCommand
  ): Promise<ScheduledActionOutcome> {
    const scheduled = await this.instances.findScheduledActionById(command.scheduledActionId);
    if (!scheduled) {
      throw notFound('OPTIC-WF-40421', `Scheduled action ${command.scheduledActionId} was not found.`);
    }
    const work = () => this.performScheduledAction(actor, scheduled, command.leaseOwner);
    if (!this.idempotency) {
      return work();
    }
    return replayOrExecute(
      this.idempotency,
      actor,
      'workflow.scheduled.execute',
      scheduled.idempotencyKey,
      {
        scheduledActionId: scheduled.id,
        scheduledActionKey: scheduled.scheduledActionKey,
        idempotencyKey: scheduled.idempotencyKey
      },
      work
    );
  }

  private async performScheduledAction(
    actor: ActorContext,
    scheduled: ScheduledWorkflowActionRecord,
    leaseOwner: string
  ): Promise<ScheduledActionOutcome> {
    const current = await this.instances.findScheduledActionById(scheduled.id);
    if (!current) {
      throw notFound('OPTIC-WF-40421', `Scheduled action ${scheduled.id} was not found.`);
    }
    if (
      current.status === 'COMPLETED' ||
      current.status === 'CANCELLED' ||
      current.status === 'FAILED' ||
      current.status === 'DEAD_LETTER'
    ) {
      return 'SKIPPED';
    }
    if (current.status !== 'PENDING') {
      return 'SKIPPED';
    }

    const instance = await this.instances.findById(current.workflowInstanceId);
    if (!instance) {
      throw notFound('OPTIC-WF-40410', `Workflow instance ${current.workflowInstanceId} was not found.`);
    }
    const compiled = await this.loader.loadByReleaseId(instance.definitionReleaseId);
    const definition = compiled.release.scheduledActions[current.scheduledActionKey];
    if (!definition) {
      throw validationFailed(
        'OPTIC-WF-40070',
        `Scheduled action ${current.scheduledActionKey} is not defined on the pinned release.`
      );
    }

    const expectedStage = triggerStageKey(definition);
    const open = await this.instances.findOpenVisit(instance.id);
    const stillApplies =
      Boolean(expectedStage) &&
      instance.currentStageKey === expectedStage &&
      (current.stageVisitId === null || open?.id === current.stageVisitId);

    if (!stillApplies) {
      return this.completeScheduledNoop(actor, instance, compiled, current, leaseOwner);
    }

    const actionType = scheduledActionType(definition);
    if (actionType === 'NOTIFICATION') {
      return this.completeScheduledNoop(
        actor,
        instance,
        compiled,
        current,
        leaseOwner,
        'SCHEDULED_ACTION_EXECUTED'
      );
    }
    if (actionType !== 'TRANSITION') {
      throw validationFailed(
        'OPTIC-WF-40072',
        `Scheduled action ${current.scheduledActionKey} has unsupported type ${actionType ?? 'undefined'}.`
      );
    }

    const targetStage = scheduledTargetStage(definition);
    if (!targetStage) {
      throw validationFailed(
        'OPTIC-WF-40071',
        `Scheduled action ${current.scheduledActionKey} TRANSITION requires targetStage.`
      );
    }
    const destination = compiled.release.workflow.stages.find((item) => item.stageKey === targetStage);
    if (!destination) {
      throw validationFailed(
        'OPTIC-WF-40042',
        `Pinned release ${compiled.definitionKey} ${compiled.version} does not contain stage ${targetStage}.`
      );
    }
    const destRow = await this.requireStageRow(instance.definitionReleaseId, destination.stageKey);
    const currentStage = compiled.release.workflow.stages.find(
      (item) => item.stageKey === instance.currentStageKey
    );
    const clearAssignment = currentStage?.assignmentPolicy.clearOnTransition !== false;

    let outcome: ScheduledActionOutcome = 'COMPLETED';
    await this.runInTransaction(async (executor) => {
      const latest = await this.instances.findById(instance.id, executor);
      if (!latest) {
        throw notFound('OPTIC-WF-40410', `Workflow instance ${instance.id} was not found.`);
      }
      const latestOpen = await this.instances.findOpenVisit(latest.id, executor);
      if (
        latest.currentStageKey !== expectedStage ||
        (current.stageVisitId !== null && latestOpen?.id !== current.stageVisitId)
      ) {
        const marked = await this.instances.completeScheduledAction(
          { id: current.id, leaseOwner },
          executor
        );
        if (!marked) {
          throw conflict('OPTIC-WF-40907', 'Scheduled action lease is no longer owned by this worker.');
        }
        await this.appendScheduledOutcome(
          actor,
          latest,
          compiled,
          current,
          'SCHEDULED_ACTION_SKIPPED',
          executor
        );
        outcome = 'SKIPPED';
        return;
      }

      const marked = await this.instances.completeScheduledAction(
        { id: current.id, leaseOwner },
        executor
      );
      if (!marked) {
        throw conflict('OPTIC-WF-40907', 'Scheduled action lease is no longer owned by this worker.');
      }

      await this.applyStageTransition(
        actor,
        latest,
        compiled,
        destination.stageKey,
        destRow.id,
        current.scheduledActionKey,
        {
          expectedRowVersion: latest.rowVersion,
          businessData: latest.businessData,
          deltas: [],
          clearAssignment,
          scheduledActionKey: current.scheduledActionKey
        },
        executor
      );
      await this.appendScheduledOutcome(
        actor,
        latest,
        compiled,
        current,
        'SCHEDULED_ACTION_EXECUTED',
        executor,
        destination.stageKey
      );
    });

    return outcome;
  }

  async retryOrFailScheduledAction(
    actor: ActorContext,
    scheduled: ScheduledWorkflowActionRecord,
    leaseOwner: string,
    error: unknown,
    options: { maxAttempts: number; backoffBaseMs: number }
  ): Promise<'RETRIED' | 'DEAD_LETTER' | 'SKIPPED'> {
    const current = await this.instances.findScheduledActionById(scheduled.id);
    if (!current || current.status !== 'PENDING' || current.leaseOwner !== leaseOwner) {
      return 'SKIPPED';
    }
    const compiled = await this.loader.loadByReleaseId(current.definitionReleaseId);
    const definition = compiled.release.scheduledActions[current.scheduledActionKey];
    const maxAttempts = scheduledMaxAttempts(definition, options.maxAttempts);
    const nextAttempt = current.attemptCount + 1;
    const { errorCode, errorMessage } = scheduledErrorFields(error);
    const instance = await this.instances.findById(current.workflowInstanceId);
    if (!instance) {
      throw notFound('OPTIC-WF-40410', `Workflow instance ${current.workflowInstanceId} was not found.`);
    }

    if (!isTransientSchedulerError(error) || nextAttempt >= maxAttempts) {
      const marked = await this.runInTransaction(async (executor) => {
        const failed = await this.instances.failScheduledAction(
          {
            id: current.id,
            leaseOwner,
            errorCode,
            errorMessage
          },
          executor
        );
        if (!failed) {
          return false;
        }
        await this.appendScheduledOutcome(
          actor,
          instance,
          compiled,
          current,
          'SCHEDULED_ACTION_FAILED',
          executor
        );
        return true;
      });
      return marked ? 'DEAD_LETTER' : 'SKIPPED';
    }

    const dueAt = nextRetryDueAtFor(definition, nextAttempt, options.backoffBaseMs);
    const marked = await this.instances.retryScheduledAction({
      id: current.id,
      leaseOwner,
      dueAt,
      errorCode,
      errorMessage
    });
    return marked ? 'RETRIED' : 'SKIPPED';
  }

  private async applyStageTransition(
    actor: ActorContext,
    instance: WorkflowInstanceRecord,
    compiled: CompiledDefinition,
    destinationStageKey: string,
    destinationStageDefinitionId: number,
    actionKey: string,
    options: {
      expectedRowVersion: number;
      businessData: Record<string, unknown>;
      deltas: ReturnType<typeof calculateFieldDeltas>;
      form?: { formKey: string; dataPath: string };
      comment?: string;
      requireAssignedTo?: string;
      clearAssignment: boolean;
      scheduledActionKey?: string;
    },
    executor?: QueryExecutor
  ): Promise<WorkflowInstanceRecord> {
    const open = await this.instances.findOpenVisit(instance.id, executor);
    if (open) {
      await this.instances.completeVisit(
        {
          visitId: open.id,
          completedBy: actor.actorId,
          exitActionKey: actionKey,
          nextStageKey: destinationStageKey
        },
        executor
      );
    }
    await this.cancelCancellableScheduledActions(compiled, instance.id, executor);
    const visitNumber = await this.instances.nextVisitNumber(instance.id, destinationStageKey, executor);
    const opened = await this.instances.insertVisit(
      {
        workflowInstanceId: instance.id,
        stageDefinitionId: destinationStageDefinitionId,
        stageKey: destinationStageKey,
        visitNumber,
        enteredBy: actor.actorId
      },
      executor
    );
    const next = await this.instances.applyActionMutation(
      {
        instanceId: instance.id,
        expectedRowVersion: options.expectedRowVersion,
        businessData: options.businessData,
        currentStageDefinitionId: destinationStageDefinitionId,
        currentStageKey: destinationStageKey,
        status: stageStatus(compiled, destinationStageKey),
        clearAssignment: options.clearAssignment,
        requireAssignedTo: options.requireAssignedTo
      },
      executor
    );
    await this.instances.insertWorkloadTransition(
      {
        workflowInstanceId: instance.id,
        entityType: instance.entityType,
        entityTrackingId: instance.entityTrackingId,
        definitionReleaseId: instance.definitionReleaseId,
        fromStageKey: instance.currentStageKey,
        toStageKey: destinationStageKey,
        actionKey,
        stageVisitId: open?.id ?? null,
        actorId: actor.actorId
      },
      executor
    );
    await this.scheduleForEnteredStage(actor, compiled, next, opened.id, executor);
    await this.outbox.append(
      createWorkflowOutboxEvent({
        actor,
        eventType: 'STAGE_COMPLETED',
        entityType: instance.entityType,
        entityTrackingId: instance.entityTrackingId,
        definitionKey: compiled.definitionKey,
        definitionVersion: compiled.version,
        workflowInstanceId: instance.id,
        fromStageKey: instance.currentStageKey,
        toStageKey: destinationStageKey,
        actionKey,
        scheduledActionKey: options.scheduledActionKey,
        assignedTo: next.assignedTo,
        changedFieldCount: options.deltas.length,
        fieldDeltas: options.deltas,
        comment: options.comment,
        stageVisitId: open?.id ?? null
      }),
      executor
    );
    await this.outbox.append(
      createWorkflowOutboxEvent({
        actor,
        eventType: 'STAGE_TRANSITIONED',
        entityType: instance.entityType,
        entityTrackingId: instance.entityTrackingId,
        definitionKey: compiled.definitionKey,
        definitionVersion: compiled.version,
        workflowInstanceId: instance.id,
        fromStageKey: instance.currentStageKey,
        toStageKey: destinationStageKey,
        actionKey,
        scheduledActionKey: options.scheduledActionKey,
        assignedTo: next.assignedTo,
        comment: options.comment,
        stageVisitId: open?.id ?? null
      }),
      executor
    );
    await this.outbox.append(
      createWorkflowOutboxEvent({
        actor,
        eventType: 'STAGE_ENTERED',
        entityType: instance.entityType,
        entityTrackingId: instance.entityTrackingId,
        definitionKey: compiled.definitionKey,
        definitionVersion: compiled.version,
        workflowInstanceId: instance.id,
        fromStageKey: instance.currentStageKey,
        toStageKey: destinationStageKey,
        actionKey,
        scheduledActionKey: options.scheduledActionKey,
        assignedTo: next.assignedTo,
        comment: options.comment,
        stageVisitId: opened.id
      }),
      executor
    );
    if (options.deltas.length > 0) {
      await this.outbox.append(
        createWorkflowOutboxEvent({
          actor,
          eventType: 'FIELD_CHANGED',
          entityType: instance.entityType,
          entityTrackingId: instance.entityTrackingId,
          definitionKey: compiled.definitionKey,
          definitionVersion: compiled.version,
          workflowInstanceId: instance.id,
          fromStageKey: instance.currentStageKey,
          toStageKey: destinationStageKey,
          actionKey,
          scheduledActionKey: options.scheduledActionKey,
          formKey: options.form?.formKey,
          dataPath: options.form?.dataPath,
          changedFieldCount: options.deltas.length,
          fieldDeltas: options.deltas,
          stageVisitId: open?.id ?? null
        }),
        executor
      );
    }
    if (options.clearAssignment && instance.assignedTo) {
      await this.outbox.append(
        createWorkflowOutboxEvent({
          actor,
          eventType: 'WORKLOAD_RELEASED',
          entityType: instance.entityType,
          entityTrackingId: instance.entityTrackingId,
          definitionKey: compiled.definitionKey,
          definitionVersion: compiled.version,
          workflowInstanceId: instance.id,
          fromStageKey: instance.currentStageKey,
          toStageKey: destinationStageKey,
          assignedTo: null,
          actionKey,
          scheduledActionKey: options.scheduledActionKey,
          stageVisitId: opened.id
        }),
        executor
      );
    }
    await this.syncProjection(next, compiled, executor);
    return next;
  }

  private async completeScheduledNoop(
    actor: ActorContext,
    instance: WorkflowInstanceRecord,
    compiled: CompiledDefinition,
    scheduled: ScheduledWorkflowActionRecord,
    leaseOwner: string,
    eventType: 'SCHEDULED_ACTION_SKIPPED' | 'SCHEDULED_ACTION_EXECUTED' = 'SCHEDULED_ACTION_SKIPPED'
  ): Promise<ScheduledActionOutcome> {
    await this.runInTransaction(async (executor) => {
      const marked = await this.instances.completeScheduledAction({ id: scheduled.id, leaseOwner }, executor);
      if (!marked) {
        throw conflict('OPTIC-WF-40907', 'Scheduled action lease is no longer owned by this worker.');
      }
      await this.appendScheduledOutcome(actor, instance, compiled, scheduled, eventType, executor);
    });
    return eventType === 'SCHEDULED_ACTION_EXECUTED' ? 'COMPLETED' : 'SKIPPED';
  }

  private async appendScheduledOutcome(
    actor: ActorContext,
    instance: WorkflowInstanceRecord,
    compiled: CompiledDefinition,
    scheduled: ScheduledWorkflowActionRecord,
    eventType:
      | 'SCHEDULED_ACTION_CREATED'
      | 'SCHEDULED_ACTION_EXECUTED'
      | 'SCHEDULED_ACTION_SKIPPED'
      | 'SCHEDULED_ACTION_FAILED',
    executor?: QueryExecutor,
    toStageKey?: string
  ): Promise<void> {
    await this.outbox.append(
      createWorkflowOutboxEvent({
        actor,
        eventType,
        entityType: instance.entityType,
        entityTrackingId: instance.entityTrackingId,
        definitionKey: compiled.definitionKey,
        definitionVersion: compiled.version,
        workflowInstanceId: instance.id,
        fromStageKey: instance.currentStageKey,
        toStageKey: toStageKey ?? instance.currentStageKey,
        actionKey: scheduled.scheduledActionKey,
        scheduledActionKey: scheduled.scheduledActionKey,
        stageVisitId: scheduled.stageVisitId
      }),
      executor
    );
  }

  private async insertCreatedInstance(
    actor: ActorContext,
    entityType: string,
    trackingId: string,
    compiled: CompiledDefinition,
    executor?: QueryExecutor,
    parent?: { entityType: string; trackingId: string },
    rehearsal = false
  ): Promise<WorkflowInstanceRecord> {
    const initialStageKey = compiled.release.workflow.initialStageKey;
    if (!initialStageKey) {
      throw validationFailed('OPTIC-WF-40043', `Release ${compiled.definitionKey} ${compiled.version} has no initial stage.`);
    }
    const stageRow = await this.requireStageRow(Number(compiled.releaseId), initialStageKey);
    const status = stageStatus(compiled, initialStageKey);
    const created = await this.instances.createInstance(
      {
        entityType,
        entityTrackingId: trackingId,
        parentEntityType: parent?.entityType,
        parentTrackingId: parent?.trackingId,
        definitionReleaseId: Number(compiled.releaseId),
        currentStageDefinitionId: stageRow.id,
        currentStageKey: initialStageKey,
        status,
        rehearsal: rehearsal || compiled.lifecycleStatus !== 'PUBLISHED'
      },
      executor
    );
    const visit = await this.instances.insertVisit(
      {
        workflowInstanceId: created.id,
        stageDefinitionId: stageRow.id,
        stageKey: initialStageKey,
        visitNumber: 1,
        enteredBy: actor.actorId
      },
      executor
    );
    await this.scheduleForEnteredStage(actor, compiled, created, visit.id, executor);
    await this.outbox.append(
      createWorkflowOutboxEvent({
        actor,
        eventType: entityType === 'MAIL' ? 'MAIL_CREATED' : 'WORKLOAD_CREATED',
        entityType,
        entityTrackingId: trackingId,
        definitionKey: compiled.definitionKey,
        definitionVersion: compiled.version,
        workflowInstanceId: created.id,
        toStageKey: initialStageKey,
        stageVisitId: visit.id
      }),
      executor
    );
    await this.syncProjection(created, compiled, executor);
    return created;
  }

  private async spawnMailWorkloads(
    actor: ActorContext,
    parentInstance: WorkflowInstanceRecord,
    parent: CompiledDefinition,
    form: StageFormDefinition | undefined,
    businessData: Record<string, unknown>,
    executor?: QueryExecutor
  ): Promise<void> {
    if (parent.release.entityType !== 'MAIL') {
      return;
    }
    const plan = collectSpawnWorkloadRequests(form, businessData);
    if (plan.missingTrackingIds > 0) {
      throw validationFailed(
        'OPTIC-WF-40093',
        'Each workload copy needs a tracking id before Complete can create the cases.',
        [
          {
            field: 'trackingId',
            path: 'workloads.trackingId',
            message: `${plan.missingTrackingIds} workload ${plan.missingTrackingIds === 1 ? 'copy is' : 'copies are'} missing a tracking id.`
          }
        ]
      );
    }
    for (const request of plan.requests) {
      const existing = await this.instances.findByEntity('WORKLOAD', request.trackingId, executor);
      if (existing) {
        await this.instances.attachParentIfMissing(
          existing.id,
          parentInstance.entityType,
          parentInstance.entityTrackingId,
          executor
        );
        const child = await this.loader.loadByReleaseId(existing.definitionReleaseId);
        await this.seedSpawnedWorkload(child, existing, parent.release.forms, businessData, request.trackingId, executor);
        continue;
      }
      const version = await this.resolveSpawnVersion(request.definitionKey, parent);
      const child = await this.loadPublishedRelease(request.definitionKey, version);
      if (child.release.entityType !== 'WORKLOAD') {
        throw validationFailed(
          'OPTIC-WF-40044',
          `Spawn definition ${request.definitionKey} must be a WORKLOAD definition.`
        );
      }
      const created = await this.insertCreatedInstance(
        actor,
        'WORKLOAD',
        request.trackingId,
        child,
        executor,
        {
          entityType: parentInstance.entityType,
          trackingId: parentInstance.entityTrackingId
        },
        parentInstance.rehearsal || isRehearsalCreate(version, child.lifecycleStatus)
      );
      await this.seedSpawnedWorkload(child, created, parent.release.forms, businessData, request.trackingId, executor);
    }
  }

  private spawnTargetForm(
    compiled: CompiledDefinition,
    instance?: WorkflowInstanceRecord
  ): StageFormDefinition | undefined {
    const workflow = compiled.release.workflow;
    const stageKey = instance?.currentStageKey ?? workflow.initialStageKey;
    const formKey =
      workflow.stages.find((stage) => stage.stageKey === stageKey)?.formKey ??
      workflow.stages.find((stage) => stage.stageKey === workflow.initialStageKey)?.formKey;
    return formKey ? compiled.release.forms[formKey] : undefined;
  }

  private async writeBackProjectChildBindings(
    instance: WorkflowInstanceRecord,
    compiled: CompiledDefinition,
    businessData: Record<string, unknown>
  ): Promise<void> {
    if (instance.entityType !== 'WORKLOAD') {
      return;
    }
    const childForm = this.spawnTargetForm(compiled, instance);
    if (!childForm) {
      return;
    }
    const parent = await this.loadPacketParent(instance);
    if (!parent) {
      return;
    }
    const parentRecord = await this.instances.findByEntity(parent.entityType, parent.trackingId);
    if (!parentRecord) {
      return;
    }
    const nextParentData = buildProjectChildWriteBack(
      parent.forms ?? {},
      parentRecord.businessData ?? {},
      instance.entityTrackingId,
      childForm,
      businessData
    );
    if (!nextParentData) {
      return;
    }
    const parentCompiled = await this.loader.loadByReleaseId(parentRecord.definitionReleaseId);
    const updatedParent = await this.instances.updateBusinessData({
      instanceId: parentRecord.id,
      expectedRowVersion: parentRecord.rowVersion,
      businessData: nextParentData
    });
    await this.syncProjection(updatedParent, parentCompiled);
  }

  private async seedSpawnedWorkload(
    child: CompiledDefinition,
    instance: WorkflowInstanceRecord,
    parentForms: Record<string, StageFormDefinition>,
    parentBusinessData: unknown,
    trackingId: string,
    executor?: QueryExecutor
  ): Promise<void> {
    const seeded = overlaySpawnRowOnChild(
      instance.businessData ?? {},
      this.spawnTargetForm(child, instance),
      parentForms,
      parentBusinessData,
      trackingId
    );
    if (JSON.stringify(seeded) === JSON.stringify(instance.businessData ?? {})) {
      return;
    }
    const updated = await this.instances.updateBusinessData(
      {
        instanceId: instance.id,
        expectedRowVersion: instance.rowVersion,
        businessData: seeded
      },
      executor
    );
    await this.syncProjection(updated, child, executor);
  }

  private async resolveSpawnVersion(
    definitionKey: string,
    parent: CompiledDefinition
  ): Promise<string | undefined> {
    if (parent.lifecycleStatus === 'PUBLISHED') {
      return undefined;
    }
    const sameVersion = await this.definitions.findReleaseByKeyAndVersion(definitionKey, parent.version);
    if (sameVersion && sameVersion.lifecycleStatus !== 'RETIRED') {
      return parent.version;
    }
    const catalog = await this.definitions.listReleaseCatalog();
    const matches = catalog.filter(
      (item) => item.definitionKey === definitionKey && item.lifecycleStatus !== 'RETIRED'
    );
    return (
      matches.find((item) => item.lifecycleStatus === 'DRAFT')?.version ??
      matches.find((item) => item.lifecycleStatus === 'PUBLISHED')?.version ??
      parent.version
    );
  }

  private async loadPublishedRelease(definitionKey: string, version?: string): Promise<CompiledDefinition> {
    let releaseId: number;
    if (version) {
      const release = await this.definitions.findReleaseByKeyAndVersion(definitionKey, version);
      if (!release) {
        throw notFound('OPTIC-CONFIG-40402', `Release ${definitionKey} ${version} was not found.`);
      }
      releaseId = release.id;
    } else {
      const definition = await this.definitions.findDefinitionByKey(definitionKey);
      if (!definition) {
        throw notFound('OPTIC-CONFIG-40401', `Definition ${definitionKey} was not found.`);
      }
      if (!definition.activeReleaseId) {
        throw validationFailed(
          'OPTIC-WF-40041',
          `Definition ${definitionKey} has no active published release for new instances.`
        );
      }
      releaseId = definition.activeReleaseId;
    }
    const compiled = await this.loader.loadByReleaseId(releaseId);
    const unpublishedOk = Boolean(version) && compiled.lifecycleStatus !== 'RETIRED';
    if (compiled.lifecycleStatus !== 'PUBLISHED' && !unpublishedOk) {
      throw validationFailed(
        'OPTIC-WF-40040',
        version
          ? `New instances cannot be pinned to a RETIRED release. ${compiled.definitionKey} ${compiled.version} is ${compiled.lifecycleStatus}.`
          : `New instances can only be pinned to a PUBLISHED release. ${compiled.definitionKey} ${compiled.version} is ${compiled.lifecycleStatus}. Pass version to try a draft before publish.`
      );
    }
    return compiled;
  }

  private async requireInstance(
    entityType: string,
    entityTrackingId: string,
    executor?: QueryExecutor
  ): Promise<WorkflowInstanceRecord> {
    const instance = await this.instances.findByEntity(entityType, entityTrackingId, executor);
    if (!instance) {
      throw notFound('OPTIC-WF-40410', `Workflow instance ${entityType} ${entityTrackingId} was not found.`);
    }
    return instance;
  }

  private async requireStageRow(releaseId: number, stageKey: string) {
    const stages = await this.definitions.listChildren(releaseId, 'stage');
    const row = stages.find((stage) => stage.stableKey === stageKey);
    if (!row) {
      throw validationFailed('OPTIC-WF-40042', `Stage ${stageKey} is not persisted on release ${releaseId}.`);
    }
    return row;
  }

  private toQueueItem(instance: WorkflowInstanceRecord, compiled: CompiledDefinition): WorkflowQueueItem {
    const stage = compiled.release.workflow.stages.find((item) => item.stageKey === instance.currentStageKey);
    return {
      trackingId: instance.entityTrackingId,
      entityType: instance.entityType,
      workflowInstanceId: instance.id,
      status: instance.status,
      currentStageKey: instance.currentStageKey,
      currentStageLabel: stage?.displayName ?? instance.currentStageKey,
      assignedTo: instance.assignedTo,
      enteredStageAt: instance.enteredStageAt.toISOString(),
      rowVersion: instance.rowVersion,
      businessData: structuredClone(instance.businessData ?? {})
    };
  }

  private async summarize(
    instance: WorkflowInstanceRecord,
    compiled: CompiledDefinition,
    options: { includePacket?: boolean } = {}
  ): Promise<WorkflowSummary> {
    const visits = await this.instances.listVisits(instance.id);
    const stage = compiled.release.workflow.stages.find((item) => item.stageKey === instance.currentStageKey);
    const open = visits.find((visit) => visit.completedAt === null);
    const summary: WorkflowSummary = {
      trackingId: instance.entityTrackingId,
      entityType: instance.entityType,
      workflowInstanceId: instance.id,
      status: instance.status,
      definition: {
        definitionKey: compiled.definitionKey,
        version: compiled.version,
        releaseId: compiled.releaseId
      },
      workflow: {
        currentStageKey: instance.currentStageKey,
        currentStageLabel: stage?.displayName ?? instance.currentStageKey,
        enteredStageAt: instance.enteredStageAt.toISOString(),
        assignedTo: instance.assignedTo,
        rowVersion: instance.rowVersion,
        openVisitNumber: open?.visitNumber ?? null
      },
      assignmentPermissions: assignmentPermissions(stage, instance.status),
      businessData: structuredClone(instance.businessData ?? {}),
      allowedActions: (stage?.actionKeys ?? []).map((actionKey) => ({
        actionKey,
        label: compiled.release.actions[actionKey]?.label ?? actionKey
      })),
      stageForm: toStageForm(compiled, stage?.formKey),
      visits: visits.map(toVisitSummary),
      forms: structuredClone(compiled.release.forms ?? {}),
      workflowDefinition: structuredClone(compiled.release.workflow)
    };
    if (options.includePacket === false) {
      return summary;
    }
    const parent = await this.loadPacketParent(instance);
    const children = await this.loadPacketChildren(instance, compiled);
    if (parent || children.length > 0) {
      summary.packet = {
        ...(parent ? { parent } : {}),
        ...(children.length > 0 ? { children } : {})
      };
    }
    if (parent && instance.entityType === 'WORKLOAD') {
      summary.businessData = overlaySpawnRowOnChild(
        summary.businessData,
        this.spawnTargetForm(compiled, instance),
        parent.forms,
        parent.businessData,
        instance.entityTrackingId
      );
      summary.businessData = projectParentOntoChildBusinessData(
        summary.businessData,
        this.spawnTargetForm(compiled, instance),
        parent.forms,
        parent.businessData,
        instance.entityTrackingId
      );
    }
    if (instance.entityType === 'MAIL' && children.length > 0) {
      summary.businessData = projectChildrenOntoParentBusinessData(
        summary.businessData,
        compiled.release.forms ?? {},
        children.map((child) => ({
          trackingId: child.trackingId,
          businessData: child.businessData ?? {},
          forms: child.forms
        }))
      );
    }
    return summary;
  }

  private async loadPacketParent(instance: WorkflowInstanceRecord): Promise<WorkflowSummary | undefined> {
    let parent =
      instance.parentEntityType && instance.parentTrackingId
        ? await this.instances.findByEntity(instance.parentEntityType, instance.parentTrackingId)
        : null;
    if (!parent && instance.entityType === 'WORKLOAD') {
      parent = await this.inferMailParent(instance);
      if (parent) {
        await this.instances.attachParentIfMissing(instance.id, parent.entityType, parent.entityTrackingId);
      }
    }
    if (!parent) {
      return undefined;
    }
    const compiled = await this.loader.loadByReleaseId(parent.definitionReleaseId);
    return this.summarize(parent, compiled, { includePacket: false });
  }

  private async inferMailParent(instance: WorkflowInstanceRecord): Promise<WorkflowInstanceRecord | null> {
    const mails = (await this.instances.listAll()).filter((row) => row.entityType === 'MAIL');
    const matches = mails.filter((mail) =>
      businessDataMentionsTrackingId(mail.businessData, instance.entityTrackingId)
    );
    return matches.at(-1) ?? null;
  }

  private async loadPacketChildren(
    instance: WorkflowInstanceRecord,
    compiled: CompiledDefinition
  ): Promise<WorkflowSummary[]> {
    const linked = await this.instances.findByParent(instance.entityType, instance.entityTrackingId);
    const seen = new Set(linked.map((row) => row.entityTrackingId));
    if (instance.entityType === 'MAIL') {
      for (const form of Object.values(compiled.release.forms ?? {})) {
        for (const request of collectSpawnWorkloadRequests(form, instance.businessData).requests) {
          if (seen.has(request.trackingId)) {
            continue;
          }
          const child = await this.instances.findByEntity('WORKLOAD', request.trackingId);
          if (!child) {
            continue;
          }
          await this.instances.attachParentIfMissing(child.id, instance.entityType, instance.entityTrackingId);
          linked.push(child);
          seen.add(child.entityTrackingId);
        }
      }
    }
    linked.sort((left, right) => left.id - right.id);
    return Promise.all(
      linked.map(async (row) =>
        this.summarize(row, await this.loader.loadByReleaseId(row.definitionReleaseId), {
          includePacket: false
        })
      )
    );
  }

  private async cancelCancellableScheduledActions(
    compiled: CompiledDefinition,
    workflowInstanceId: number,
    executor?: QueryExecutor
  ): Promise<void> {
    const pending = await this.instances.listScheduledActions(workflowInstanceId, executor);
    const keys = pending
      .filter((row) => row.status === 'PENDING')
      .filter((row) => shouldCancelOnStageChange(compiled.release.scheduledActions[row.scheduledActionKey]))
      .map((row) => row.scheduledActionKey);
    if (keys.length === 0) {
      return;
    }
    await this.instances.cancelPendingScheduledActions(workflowInstanceId, keys, executor);
  }

  async rebuildProjections(): Promise<number> {
    const instances = await this.instances.listAll();
    let written = 0;
    for (const instance of instances) {
      if (instance.rehearsal) {
        continue;
      }
      const compiled = await this.loader.loadByReleaseId(instance.definitionReleaseId);
      if (compiled.lifecycleStatus !== 'PUBLISHED') {
        continue;
      }
      await this.projections.upsert(projectInstance(instance, compiled));
      written += 1;
    }
    return written;
  }

  /** Hide prior Try cases from Live when a release is published or activated. */
  async scrubReleaseForLive(definitionReleaseId: number, executor?: QueryExecutor): Promise<void> {
    await this.instances.markRehearsalByReleaseId(definitionReleaseId, executor);
    await this.projections.deleteByReleaseId(definitionReleaseId, executor);
  }

  private async syncProjection(
    instance: WorkflowInstanceRecord,
    compiled: CompiledDefinition,
    executor?: QueryExecutor
  ): Promise<void> {
    if (instance.rehearsal || compiled.lifecycleStatus !== 'PUBLISHED') {
      return;
    }
    await this.projections.upsert(projectInstance(instance, compiled), executor);
  }

  private async scheduleForEnteredStage(
    actor: ActorContext,
    compiled: CompiledDefinition,
    instance: WorkflowInstanceRecord,
    stageVisitId: number,
    executor?: QueryExecutor
  ): Promise<void> {
    if (compiled.lifecycleStatus !== 'PUBLISHED') {
      return;
    }
    for (const definition of scheduledActionsForStage(
      compiled.release.scheduledActions,
      instance.currentStageKey
    )) {
      const created = await this.instances.insertScheduledAction(
        {
          workflowInstanceId: instance.id,
          definitionReleaseId: instance.definitionReleaseId,
          scheduledActionKey: definition.scheduledActionKey,
          stageVisitId,
          dueAt: dueAtFromDelay(definition.delay, new Date(), instance.businessData),
          idempotencyKey: `swa:${instance.id}:${stageVisitId}:${definition.scheduledActionKey}`
        },
        executor
      );
      await this.appendScheduledOutcome(
        actor,
        instance,
        compiled,
        created,
        'SCHEDULED_ACTION_CREATED',
        executor
      );
    }
  }
}

function assertAssignmentPermission(
  instance: WorkflowInstanceRecord,
  compiled: CompiledDefinition,
  kind: 'assign' | 'reassign' | 'release'
): void {
  const stage = compiled.release.workflow.stages.find((item) => item.stageKey === instance.currentStageKey);
  const permissions = assignmentPermissions(stage, instance.status);
  const allowed =
    kind === 'assign' ? permissions.allowAssign : kind === 'reassign' ? permissions.allowReassign : permissions.allowRelease;
  if (allowed) {
    return;
  }
  const verb = kind === 'assign' ? 'assigned' : kind === 'reassign' ? 'reassigned' : 'released';
  throw validationFailed(
    kind === 'release' ? 'OPTIC-WF-40093' : 'OPTIC-WF-40092',
    `This stage does not allow the case to be ${verb}.`,
    [
      {
        field: kind === 'release' ? 'allowRelease' : kind === 'reassign' ? 'allowReassign' : 'allowAssign',
        path: `workflow.stages.${instance.currentStageKey}.assignmentPolicy`,
        message: `Turn on ${kind} for ${instance.currentStageKey} in the workflow definition.`
      }
    ]
  );
}

function requiresAssignee(
  action: ActionDefinition,
  stage: { assignmentPolicy: { required: boolean } } | undefined
): boolean {
  if (action.requireAssignmentToCurrentUser === false) {
    return false;
  }
  if (action.requireAssignmentToCurrentUser === true) {
    return true;
  }
  return stage?.assignmentPolicy.required === true;
}

function stageStatus(compiled: CompiledDefinition, stageKey: string): WorkflowInstanceStatus {
  const stage = compiled.release.workflow.stages.find((item) => item.stageKey === stageKey);
  return stage?.terminal ? 'COMPLETED' : 'ACTIVE';
}

function toStageForm(
  compiled: CompiledDefinition,
  formKey: string | undefined
): WorkflowSummary['stageForm'] {
  if (!formKey) {
    return null;
  }
  const ui = compiled.release.forms[formKey];
  if (!ui) {
    return null;
  }
  return {
    formKey: ui.formKey,
    title: ui.title,
    dataPath: ui.dataPath,
    schema: (ui.schema ?? compiled.release.schema) as JsonSchema,
    ui
  };
}

function toVisitSummary(visit: WorkflowStageVisitRecord) {
  return {
    stageKey: visit.stageKey,
    visitNumber: visit.visitNumber,
    enteredAt: visit.enteredAt.toISOString(),
    completedAt: visit.completedAt ? visit.completedAt.toISOString() : null,
    nextStageKey: visit.nextStageKey,
    enteredBy: visit.enteredBy,
    assignedTo: visit.assignedTo,
    completedBy: visit.completedBy
  };
}

/** Try passes an explicit version; unpublished pins are always rehearsal. */
function isRehearsalCreate(version: string | undefined, lifecycleStatus: string): boolean {
  return Boolean(version?.trim()) || lifecycleStatus !== 'PUBLISHED';
}

function isTransientSchedulerError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.httpStatus >= 500 || error.errorCode === 'OPTIC-WF-40901';
  }
  return true;
}

function scheduledErrorFields(error: unknown): { errorCode: string; errorMessage: string } {
  if (error instanceof AppError) {
    return { errorCode: error.errorCode, errorMessage: error.message };
  }
  if (error instanceof Error) {
    return { errorCode: 'OPTIC-SYS-50001', errorMessage: error.message };
  }
  return { errorCode: 'OPTIC-SYS-50001', errorMessage: 'Scheduled action failed.' };
}

function nextRetryDueAtFor(
  definition: ScheduledActionDefinition | undefined,
  nextAttempt: number,
  backoffBaseMs: number
): Date {
  return nextRetryDueAt(nextAttempt, scheduledBackoff(definition), backoffBaseMs);
}

