export type WorkflowInstanceStatus = 'ACTIVE' | 'COMPLETED';

export interface WorkflowInstanceRecord {
  id: number;
  entityType: string;
  entityTrackingId: string;
  parentEntityType: string | null;
  parentTrackingId: string | null;
  definitionReleaseId: number;
  currentStageDefinitionId: number;
  currentStageKey: string;
  status: WorkflowInstanceStatus;
  /** True for Try / draft sandbox cases — never shown in Live queues. */
  rehearsal: boolean;
  assignedTo: string | null;
  enteredStageAt: Date;
  rowVersion: number;
  businessData: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowStageVisitRecord {
  id: number;
  workflowInstanceId: number;
  stageDefinitionId: number;
  stageKey: string;
  visitNumber: number;
  enteredAt: Date;
  enteredBy: string | null;
  assignedAt: Date | null;
  assignedTo: string | null;
  processingStartedAt: Date | null;
  completedAt: Date | null;
  completedBy: string | null;
  exitActionKey: string | null;
  nextStageKey: string | null;
  durationSeconds: number | null;
}

export interface CreateWorkflowInstanceInput {
  entityType: string;
  entityTrackingId: string;
  parentEntityType?: string | null;
  parentTrackingId?: string | null;
  definitionReleaseId: number;
  currentStageDefinitionId: number;
  currentStageKey: string;
  status: WorkflowInstanceStatus;
  rehearsal?: boolean;
}

export interface OpenStageVisitInput {
  workflowInstanceId: number;
  stageDefinitionId: number;
  stageKey: string;
  visitNumber: number;
  enteredBy: string | null;
}

export interface CompleteStageVisitInput {
  visitId: number;
  completedBy: string | null;
  exitActionKey?: string;
  nextStageKey: string;
}

export interface UpdateInstanceStageInput {
  instanceId: number;
  expectedRowVersion: number;
  currentStageDefinitionId: number;
  currentStageKey: string;
  status: WorkflowInstanceStatus;
}

export interface AssignInstanceInput {
  instanceId: number;
  expectedRowVersion: number;
  assignedTo: string;
}

export interface ReleaseInstanceInput {
  instanceId: number;
  expectedRowVersion: number;
  assignedTo: string;
}

export interface UpdateBusinessDataInput {
  instanceId: number;
  expectedRowVersion: number;
  businessData: Record<string, unknown>;
}

export interface ApplyActionMutationInput {
  instanceId: number;
  expectedRowVersion: number;
  businessData: Record<string, unknown>;
  currentStageDefinitionId: number;
  currentStageKey: string;
  status: WorkflowInstanceStatus;
  clearAssignment: boolean;
  requireAssignedTo?: string;
}

export type ScheduledActionStatus = 'PENDING' | 'CANCELLED' | 'COMPLETED' | 'FAILED' | 'DEAD_LETTER';

export interface ScheduledWorkflowActionRecord {
  id: number;
  workflowInstanceId: number;
  definitionReleaseId: number;
  scheduledActionKey: string;
  stageVisitId: number | null;
  dueAt: Date;
  status: ScheduledActionStatus;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  attemptCount: number;
  lastAttemptAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  idempotencyKey: string;
}

export interface ClaimDueScheduledActionsInput {
  owner: string;
  leaseMs: number;
  limit: number;
  now?: Date;
}

export interface CompleteScheduledActionInput {
  id: number;
  leaseOwner?: string | null;
}

export interface RetryScheduledActionInput {
  id: number;
  leaseOwner: string;
  dueAt: Date;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface FailScheduledActionInput {
  id: number;
  leaseOwner: string;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface InsertScheduledActionInput {
  workflowInstanceId: number;
  definitionReleaseId: number;
  scheduledActionKey: string;
  stageVisitId: number | null;
  dueAt: Date;
  idempotencyKey: string;
}

export interface WorkloadTransitionRecord {
  id: number;
  workflowInstanceId: number;
  entityType: string;
  entityTrackingId: string;
  definitionReleaseId: number;
  fromStageKey: string;
  toStageKey: string;
  actionKey: string;
  stageVisitId: number | null;
  actorId: string | null;
  occurredAt: Date;
}

export interface InsertWorkloadTransitionInput {
  workflowInstanceId: number;
  entityType: string;
  entityTrackingId: string;
  definitionReleaseId: number;
  fromStageKey: string;
  toStageKey: string;
  actionKey: string;
  stageVisitId: number | null;
  actorId: string | null;
}
