import type { QueryExecutor } from '../../../platform/db/types.js';
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

export interface WorkflowInstanceRepository {
  createInstance(
    input: CreateWorkflowInstanceInput,
    executor?: QueryExecutor
  ): Promise<WorkflowInstanceRecord>;
  findByEntity(
    entityType: string,
    entityTrackingId: string,
    executor?: QueryExecutor
  ): Promise<WorkflowInstanceRecord | null>;
  findByTrackingId(entityTrackingId: string, executor?: QueryExecutor): Promise<WorkflowInstanceRecord[]>;
  /** Case-insensitive contains match on entity_tracking_id (Try / unprojected cases). */
  searchByTrackingIdContains(
    needle: string,
    options?: { limit?: number },
    executor?: QueryExecutor
  ): Promise<WorkflowInstanceRecord[]>;
  findByParent(
    parentEntityType: string,
    parentTrackingId: string,
    executor?: QueryExecutor
  ): Promise<WorkflowInstanceRecord[]>;
  attachParentIfMissing(
    instanceId: number,
    parentEntityType: string,
    parentTrackingId: string,
    executor?: QueryExecutor
  ): Promise<WorkflowInstanceRecord | null>;
  findById(id: number, executor?: QueryExecutor): Promise<WorkflowInstanceRecord | null>;
  updateStage(input: UpdateInstanceStageInput, executor?: QueryExecutor): Promise<WorkflowInstanceRecord>;
  insertVisit(input: OpenStageVisitInput, executor?: QueryExecutor): Promise<WorkflowStageVisitRecord>;
  findOpenVisit(
    workflowInstanceId: number,
    executor?: QueryExecutor
  ): Promise<WorkflowStageVisitRecord | null>;
  completeVisit(
    input: CompleteStageVisitInput,
    executor?: QueryExecutor
  ): Promise<WorkflowStageVisitRecord>;
  nextVisitNumber(
    workflowInstanceId: number,
    stageKey: string,
    executor?: QueryExecutor
  ): Promise<number>;
  listVisits(workflowInstanceId: number, executor?: QueryExecutor): Promise<WorkflowStageVisitRecord[]>;
  assignToSelf(input: AssignInstanceInput, executor?: QueryExecutor): Promise<WorkflowInstanceRecord>;
  reassignTo(input: AssignInstanceInput, executor?: QueryExecutor): Promise<WorkflowInstanceRecord>;
  releaseAssignment(input: ReleaseInstanceInput, executor?: QueryExecutor): Promise<WorkflowInstanceRecord>;
  updateOpenVisitAssignment(
    workflowInstanceId: number,
    assignedTo: string | null,
    executor?: QueryExecutor
  ): Promise<void>;
  updateBusinessData(input: UpdateBusinessDataInput, executor?: QueryExecutor): Promise<WorkflowInstanceRecord>;
  applyActionMutation(input: ApplyActionMutationInput, executor?: QueryExecutor): Promise<WorkflowInstanceRecord>;
  insertWorkloadTransition(
    input: InsertWorkloadTransitionInput,
    executor?: QueryExecutor
  ): Promise<WorkloadTransitionRecord>;
  cancelPendingScheduledActions(
    workflowInstanceId: number,
    scheduledActionKeys?: string[],
    executor?: QueryExecutor
  ): Promise<number>;
  insertScheduledAction(
    input: InsertScheduledActionInput,
    executor?: QueryExecutor
  ): Promise<ScheduledWorkflowActionRecord>;
  listScheduledActions(
    workflowInstanceId: number,
    executor?: QueryExecutor
  ): Promise<ScheduledWorkflowActionRecord[]>;
  findScheduledActionById(
    id: number,
    executor?: QueryExecutor
  ): Promise<ScheduledWorkflowActionRecord | null>;
  claimDueScheduledActions(input: ClaimDueScheduledActionsInput): Promise<ScheduledWorkflowActionRecord[]>;
  completeScheduledAction(
    input: CompleteScheduledActionInput,
    executor?: QueryExecutor
  ): Promise<boolean>;
  retryScheduledAction(input: RetryScheduledActionInput, executor?: QueryExecutor): Promise<boolean>;
  failScheduledAction(input: FailScheduledActionInput, executor?: QueryExecutor): Promise<boolean>;
  abandonScheduledLeases(owner: string, executor?: QueryExecutor): Promise<number>;
  updateScheduledDueAt(id: number, dueAt: Date, executor?: QueryExecutor): Promise<void>;
  listTransitions(workflowInstanceId: number, executor?: QueryExecutor): Promise<WorkloadTransitionRecord[]>;
  listAll(executor?: QueryExecutor): Promise<WorkflowInstanceRecord[]>;
  listByReleaseId(definitionReleaseId: number, executor?: QueryExecutor): Promise<WorkflowInstanceRecord[]>;
  /** Marks every instance pinned to the release as Try rehearsal (hidden from Live). */
  markRehearsalByReleaseId(definitionReleaseId: number, executor?: QueryExecutor): Promise<number>;
}
