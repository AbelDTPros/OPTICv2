import { conflict, notFound } from '../../../platform/errors/app-error.js';
import { throwAssignConflict, throwReassignConflict, throwReleaseConflict } from '../domain/assignment-errors.js';
import type {
  ApplyActionMutationInput,
  AssignInstanceInput,
  ClaimDueScheduledActionsInput,
  CompleteScheduledActionInput,
  CompleteStageVisitInput,
  CreateWorkflowInstanceInput,
  FailScheduledActionInput,
  InsertScheduledActionInput,
  InsertWorkloadTransitionInput,
  OpenStageVisitInput,
  ReleaseInstanceInput,
  RetryScheduledActionInput,
  ScheduledWorkflowActionRecord,
  UpdateBusinessDataInput,
  UpdateInstanceStageInput,
  WorkloadTransitionRecord,
  WorkflowInstanceRecord,
  WorkflowStageVisitRecord
} from '../domain/types.js';
import type { WorkflowInstanceRepository } from './workflow-instance.repository.js';

export class InMemoryWorkflowInstanceRepository implements WorkflowInstanceRepository {
  private instanceId = 1;
  private visitId = 1;
  private scheduledId = 1;
  private transitionId = 1;
  private readonly instances = new Map<number, WorkflowInstanceRecord>();
  private readonly visits = new Map<number, WorkflowStageVisitRecord>();
  private readonly scheduled = new Map<number, ScheduledWorkflowActionRecord>();
  private readonly transitions = new Map<number, WorkloadTransitionRecord>();

  async createInstance(input: CreateWorkflowInstanceInput): Promise<WorkflowInstanceRecord> {
    const existing = [...this.instances.values()].find(
      (row) => row.entityType === input.entityType && row.entityTrackingId === input.entityTrackingId
    );
    if (existing) {
      throw conflict(
        'OPTIC-WF-40902',
        `A workflow instance already exists for ${input.entityType} ${input.entityTrackingId}.`
      );
    }
    const now = new Date();
    const record: WorkflowInstanceRecord = {
      id: this.instanceId++,
      entityType: input.entityType,
      entityTrackingId: input.entityTrackingId,
      parentEntityType: input.parentEntityType?.trim() || null,
      parentTrackingId: input.parentTrackingId?.trim() || null,
      definitionReleaseId: input.definitionReleaseId,
      currentStageDefinitionId: input.currentStageDefinitionId,
      currentStageKey: input.currentStageKey,
      status: input.status,
      rehearsal: Boolean(input.rehearsal),
      assignedTo: null,
      enteredStageAt: now,
      rowVersion: 0,
      businessData: {},
      createdAt: now,
      updatedAt: now
    };
    this.instances.set(record.id, record);
    return clone(record);
  }

  async findByEntity(entityType: string, entityTrackingId: string): Promise<WorkflowInstanceRecord | null> {
    const record = [...this.instances.values()].find(
      (row) => row.entityType === entityType && row.entityTrackingId === entityTrackingId
    );
    return record ? clone(record) : null;
  }

  async findByTrackingId(entityTrackingId: string): Promise<WorkflowInstanceRecord[]> {
    return [...this.instances.values()]
      .filter((row) => row.entityTrackingId === entityTrackingId)
      .sort((left, right) => left.id - right.id)
      .map(clone);
  }

  async searchByTrackingIdContains(
    needle: string,
    options?: { limit?: number }
  ): Promise<WorkflowInstanceRecord[]> {
    const trimmed = needle.trim().toLowerCase();
    if (!trimmed) {
      return [];
    }
    const limit = Math.max(1, Math.min(options?.limit ?? 100, 200));
    return [...this.instances.values()]
      .filter((row) => row.entityTrackingId.toLowerCase().includes(trimmed))
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .slice(0, limit)
      .map(clone);
  }

  async findByParent(parentEntityType: string, parentTrackingId: string): Promise<WorkflowInstanceRecord[]> {
    return [...this.instances.values()]
      .filter((row) => row.parentEntityType === parentEntityType && row.parentTrackingId === parentTrackingId)
      .sort((left, right) => left.id - right.id)
      .map(clone);
  }

  async attachParentIfMissing(
    instanceId: number,
    parentEntityType: string,
    parentTrackingId: string
  ): Promise<WorkflowInstanceRecord | null> {
    const record = this.instances.get(instanceId);
    if (!record) {
      return null;
    }
    if (record.parentEntityType && record.parentTrackingId) {
      return clone(record);
    }
    record.parentEntityType = parentEntityType;
    record.parentTrackingId = parentTrackingId;
    record.updatedAt = new Date();
    return clone(record);
  }

  async findById(id: number): Promise<WorkflowInstanceRecord | null> {
    const record = this.instances.get(id);
    return record ? clone(record) : null;
  }

  async updateStage(input: UpdateInstanceStageInput): Promise<WorkflowInstanceRecord> {
    const record = this.instances.get(input.instanceId);
    if (!record) {
      throw notFound('OPTIC-WF-40410', `Workflow instance ${input.instanceId} was not found.`);
    }
    if (record.rowVersion !== input.expectedRowVersion) {
      throw conflict('OPTIC-WF-40901', 'This item changed after you opened it. Refresh and try again.');
    }
    const now = new Date();
    record.currentStageDefinitionId = input.currentStageDefinitionId;
    record.currentStageKey = input.currentStageKey;
    record.status = input.status;
    record.enteredStageAt = now;
    record.rowVersion += 1;
    record.updatedAt = now;
    return clone(record);
  }

  async insertVisit(input: OpenStageVisitInput): Promise<WorkflowStageVisitRecord> {
    const now = new Date();
    const record: WorkflowStageVisitRecord = {
      id: this.visitId++,
      workflowInstanceId: input.workflowInstanceId,
      stageDefinitionId: input.stageDefinitionId,
      stageKey: input.stageKey,
      visitNumber: input.visitNumber,
      enteredAt: now,
      enteredBy: input.enteredBy,
      assignedAt: null,
      assignedTo: null,
      processingStartedAt: null,
      completedAt: null,
      completedBy: null,
      exitActionKey: null,
      nextStageKey: null,
      durationSeconds: null
    };
    this.visits.set(record.id, record);
    return clone(record);
  }

  async findOpenVisit(workflowInstanceId: number): Promise<WorkflowStageVisitRecord | null> {
    const record = [...this.visits.values()].find(
      (visit) => visit.workflowInstanceId === workflowInstanceId && visit.completedAt === null
    );
    return record ? clone(record) : null;
  }

  async completeVisit(input: CompleteStageVisitInput): Promise<WorkflowStageVisitRecord> {
    const record = this.visits.get(input.visitId);
    if (!record) {
      throw notFound('OPTIC-WF-40411', `Stage visit ${input.visitId} was not found.`);
    }
    const now = new Date();
    record.completedAt = now;
    record.completedBy = input.completedBy;
    record.exitActionKey = input.exitActionKey ?? null;
    record.nextStageKey = input.nextStageKey;
    record.durationSeconds = Math.max(0, Math.floor((now.getTime() - record.enteredAt.getTime()) / 1000));
    return clone(record);
  }

  async nextVisitNumber(workflowInstanceId: number, stageKey: string): Promise<number> {
    const numbers = [...this.visits.values()]
      .filter((visit) => visit.workflowInstanceId === workflowInstanceId && visit.stageKey === stageKey)
      .map((visit) => visit.visitNumber);
    return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
  }

  async listVisits(workflowInstanceId: number): Promise<WorkflowStageVisitRecord[]> {
    return [...this.visits.values()]
      .filter((visit) => visit.workflowInstanceId === workflowInstanceId)
      .sort((left, right) => left.enteredAt.getTime() - right.enteredAt.getTime() || left.id - right.id)
      .map(clone);
  }

  async assignToSelf(input: AssignInstanceInput): Promise<WorkflowInstanceRecord> {
    const record = this.instances.get(input.instanceId);
    if (!record || record.assignedTo !== null || record.rowVersion !== input.expectedRowVersion) {
      throwAssignConflict(record ? clone(record) : null, input.expectedRowVersion);
    }
    record.assignedTo = input.assignedTo;
    record.rowVersion += 1;
    record.updatedAt = new Date();
    return clone(record);
  }

  async reassignTo(input: AssignInstanceInput): Promise<WorkflowInstanceRecord> {
    const record = this.instances.get(input.instanceId);
    if (!record || record.rowVersion !== input.expectedRowVersion) {
      throwReassignConflict(record ? clone(record) : null, input.expectedRowVersion);
    }
    record.assignedTo = input.assignedTo;
    record.rowVersion += 1;
    record.updatedAt = new Date();
    return clone(record);
  }

  async releaseAssignment(input: ReleaseInstanceInput): Promise<WorkflowInstanceRecord> {
    const record = this.instances.get(input.instanceId);
    if (!record || record.assignedTo !== input.assignedTo || record.rowVersion !== input.expectedRowVersion) {
      throwReleaseConflict(record ? clone(record) : null, input.expectedRowVersion, input.assignedTo);
    }
    record.assignedTo = null;
    record.rowVersion += 1;
    record.updatedAt = new Date();
    return clone(record);
  }

  async updateOpenVisitAssignment(workflowInstanceId: number, assignedTo: string | null): Promise<void> {
    const open = [...this.visits.values()].find(
      (visit) => visit.workflowInstanceId === workflowInstanceId && visit.completedAt === null
    );
    if (!open) {
      return;
    }
    open.assignedTo = assignedTo;
    open.assignedAt = assignedTo ? new Date() : null;
  }

  async updateBusinessData(input: UpdateBusinessDataInput): Promise<WorkflowInstanceRecord> {
    const record = this.instances.get(input.instanceId);
    if (!record) {
      throw notFound('OPTIC-WF-40410', `Workflow instance ${input.instanceId} was not found.`);
    }
    if (record.rowVersion !== input.expectedRowVersion) {
      throw conflict('OPTIC-WF-40901', 'This item changed after you opened it. Refresh and try again.', [
        {
          field: 'expectedRowVersion',
          path: 'expectedRowVersion',
          message: 'Refresh and try again.',
          currentRowVersion: record.rowVersion
        }
      ]);
    }
    record.businessData = structuredClone(input.businessData);
    record.rowVersion += 1;
    record.updatedAt = new Date();
    return clone(record);
  }

  async applyActionMutation(input: ApplyActionMutationInput): Promise<WorkflowInstanceRecord> {
    const record = this.instances.get(input.instanceId);
    if (!record) {
      throw notFound('OPTIC-WF-40410', `Workflow instance ${input.instanceId} was not found.`);
    }
    if (record.rowVersion !== input.expectedRowVersion) {
      throw conflict('OPTIC-WF-40901', 'This item changed after you opened it. Refresh and try again.', [
        {
          field: 'expectedRowVersion',
          path: 'expectedRowVersion',
          message: 'Refresh and try again.',
          currentRowVersion: record.rowVersion
        }
      ]);
    }
    if (input.requireAssignedTo && record.assignedTo !== input.requireAssignedTo) {
      throw conflict('OPTIC-WF-40905', 'This item must be assigned to you before you can continue.', [
        {
          field: 'assignedTo',
          path: 'assignedTo',
          message: 'Assign the item to yourself and try again.',
          currentRowVersion: record.rowVersion,
          assignedTo: record.assignedTo
        }
      ]);
    }
    const now = new Date();
    record.businessData = structuredClone(input.businessData);
    record.currentStageDefinitionId = input.currentStageDefinitionId;
    record.currentStageKey = input.currentStageKey;
    record.status = input.status;
    record.enteredStageAt = now;
    if (input.clearAssignment) {
      record.assignedTo = null;
    }
    record.rowVersion += 1;
    record.updatedAt = now;
    return clone(record);
  }

  async insertWorkloadTransition(input: InsertWorkloadTransitionInput): Promise<WorkloadTransitionRecord> {
    const record: WorkloadTransitionRecord = {
      id: this.transitionId++,
      workflowInstanceId: input.workflowInstanceId,
      entityType: input.entityType,
      entityTrackingId: input.entityTrackingId,
      definitionReleaseId: input.definitionReleaseId,
      fromStageKey: input.fromStageKey,
      toStageKey: input.toStageKey,
      actionKey: input.actionKey,
      stageVisitId: input.stageVisitId,
      actorId: input.actorId,
      occurredAt: new Date()
    };
    this.transitions.set(record.id, record);
    return clone(record);
  }

  async cancelPendingScheduledActions(
    workflowInstanceId: number,
    scheduledActionKeys?: string[]
  ): Promise<number> {
    let count = 0;
    for (const row of this.scheduled.values()) {
      if (row.workflowInstanceId !== workflowInstanceId || row.status !== 'PENDING') {
        continue;
      }
      if (scheduledActionKeys && !scheduledActionKeys.includes(row.scheduledActionKey)) {
        continue;
      }
      row.status = 'CANCELLED';
      row.cancelledAt = new Date();
      row.leaseOwner = null;
      row.leaseExpiresAt = null;
      count += 1;
    }
    return count;
  }

  async insertScheduledAction(input: InsertScheduledActionInput): Promise<ScheduledWorkflowActionRecord> {
    const record: ScheduledWorkflowActionRecord = {
      id: this.scheduledId++,
      workflowInstanceId: input.workflowInstanceId,
      definitionReleaseId: input.definitionReleaseId,
      scheduledActionKey: input.scheduledActionKey,
      stageVisitId: input.stageVisitId,
      dueAt: input.dueAt,
      status: 'PENDING',
      leaseOwner: null,
      leaseExpiresAt: null,
      attemptCount: 0,
      lastAttemptAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      completedAt: null,
      cancelledAt: null,
      idempotencyKey: input.idempotencyKey
    };
    this.scheduled.set(record.id, record);
    return clone(record);
  }

  async listScheduledActions(workflowInstanceId: number): Promise<ScheduledWorkflowActionRecord[]> {
    return [...this.scheduled.values()]
      .filter((row) => row.workflowInstanceId === workflowInstanceId)
      .sort((left, right) => left.id - right.id)
      .map(clone);
  }

  async findScheduledActionById(id: number): Promise<ScheduledWorkflowActionRecord | null> {
    const record = this.scheduled.get(id);
    return record ? clone(record) : null;
  }

  async claimDueScheduledActions(input: ClaimDueScheduledActionsInput): Promise<ScheduledWorkflowActionRecord[]> {
    const now = input.now ?? new Date();
    const claimed: ScheduledWorkflowActionRecord[] = [];
    const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
    const eligible = [...this.scheduled.values()]
      .filter((row) => row.status === 'PENDING' && row.dueAt.getTime() <= now.getTime())
      .filter((row) => row.leaseOwner === null || !row.leaseExpiresAt || row.leaseExpiresAt.getTime() <= now.getTime())
      .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime() || left.id - right.id)
      .slice(0, input.limit);
    for (const row of eligible) {
      row.leaseOwner = input.owner;
      row.leaseExpiresAt = leaseExpiresAt;
      row.lastAttemptAt = now;
      claimed.push(clone(row));
    }
    return claimed;
  }

  async completeScheduledAction(input: CompleteScheduledActionInput): Promise<boolean> {
    const row = this.scheduled.get(input.id);
    if (!row || row.status !== 'PENDING') {
      return false;
    }
    if (input.leaseOwner !== undefined && input.leaseOwner !== null && row.leaseOwner !== input.leaseOwner) {
      return false;
    }
    row.status = 'COMPLETED';
    row.completedAt = new Date();
    row.leaseOwner = null;
    row.leaseExpiresAt = null;
    return true;
  }

  async retryScheduledAction(input: RetryScheduledActionInput): Promise<boolean> {
    const row = this.scheduled.get(input.id);
    if (!row || row.status !== 'PENDING' || row.leaseOwner !== input.leaseOwner) {
      return false;
    }
    row.dueAt = input.dueAt;
    row.attemptCount += 1;
    row.lastAttemptAt = new Date();
    row.lastErrorCode = input.errorCode;
    row.lastErrorMessage = input.errorMessage;
    row.leaseOwner = null;
    row.leaseExpiresAt = null;
    return true;
  }

  async failScheduledAction(input: FailScheduledActionInput): Promise<boolean> {
    const row = this.scheduled.get(input.id);
    if (!row || row.status !== 'PENDING' || row.leaseOwner !== input.leaseOwner) {
      return false;
    }
    row.status = 'DEAD_LETTER';
    row.attemptCount += 1;
    row.lastAttemptAt = new Date();
    row.lastErrorCode = input.errorCode;
    row.lastErrorMessage = input.errorMessage;
    row.leaseOwner = null;
    row.leaseExpiresAt = null;
    return true;
  }

  async abandonScheduledLeases(owner: string): Promise<number> {
    let count = 0;
    for (const row of this.scheduled.values()) {
      if (row.leaseOwner !== owner || row.status !== 'PENDING') {
        continue;
      }
      row.leaseOwner = null;
      row.leaseExpiresAt = null;
      count += 1;
    }
    return count;
  }

  async updateScheduledDueAt(id: number, dueAt: Date): Promise<void> {
    const row = this.scheduled.get(id);
    if (!row) {
      throw notFound('OPTIC-WF-40421', `Scheduled action ${id} was not found.`);
    }
    row.dueAt = dueAt;
  }

  async listTransitions(workflowInstanceId: number): Promise<WorkloadTransitionRecord[]> {
    return [...this.transitions.values()]
      .filter((row) => row.workflowInstanceId === workflowInstanceId)
      .sort((left, right) => left.id - right.id)
      .map(clone);
  }

  async listAll(): Promise<WorkflowInstanceRecord[]> {
    return [...this.instances.values()].sort((left, right) => left.id - right.id).map(clone);
  }

  async listByReleaseId(definitionReleaseId: number): Promise<WorkflowInstanceRecord[]> {
    return [...this.instances.values()]
      .filter((row) => row.definitionReleaseId === definitionReleaseId)
      .sort((left, right) => left.id - right.id)
      .map(clone);
  }

  async markRehearsalByReleaseId(definitionReleaseId: number): Promise<number> {
    let updated = 0;
    for (const [id, row] of this.instances) {
      if (row.definitionReleaseId !== definitionReleaseId || row.rehearsal) {
        continue;
      }
      this.instances.set(id, { ...row, rehearsal: true, updatedAt: new Date() });
      updated += 1;
    }
    return updated;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
