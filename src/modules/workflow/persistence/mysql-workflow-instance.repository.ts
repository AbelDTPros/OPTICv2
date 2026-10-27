import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { QueryExecutor } from '../../../platform/db/types.js';
import { withTransaction } from '../../../platform/db/transaction.js';
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
  ScheduledActionStatus,
  ScheduledWorkflowActionRecord,
  UpdateBusinessDataInput,
  UpdateInstanceStageInput,
  WorkloadTransitionRecord,
  WorkflowInstanceRecord,
  WorkflowInstanceStatus,
  WorkflowStageVisitRecord
} from '../domain/types.js';
import type { WorkflowInstanceRepository } from './workflow-instance.repository.js';

interface InstanceRow extends RowDataPacket {
  id: number;
  entity_type: string;
  entity_tracking_id: string;
  parent_entity_type: string | null;
  parent_tracking_id: string | null;
  definition_release_id: number;
  current_stage_definition_id: number;
  current_stage_key: string;
  status: WorkflowInstanceStatus;
  rehearsal: number | boolean;
  assigned_to: string | null;
  entered_stage_at: Date;
  row_version: number;
  business_data: unknown;
  created_at: Date;
  updated_at: Date;
}

const INSTANCE_COLUMNS = `id, entity_type, entity_tracking_id, parent_entity_type, parent_tracking_id, definition_release_id, current_stage_definition_id,
              current_stage_key, status, rehearsal, assigned_to, entered_stage_at, row_version, business_data,
              created_at, updated_at`;

interface VisitRow extends RowDataPacket {
  id: number;
  workflow_instance_id: number;
  stage_definition_id: number;
  stage_key: string;
  visit_number: number;
  entered_at: Date;
  entered_by: string | null;
  assigned_at: Date | null;
  assigned_to: string | null;
  processing_started_at: Date | null;
  completed_at: Date | null;
  completed_by: string | null;
  exit_action_key: string | null;
  next_stage_key: string | null;
  duration_seconds: number | null;
}

export class MysqlWorkflowInstanceRepository implements WorkflowInstanceRepository {
  constructor(private readonly pool: Pool) {}

  async createInstance(
    input: CreateWorkflowInstanceInput,
    executor?: QueryExecutor
  ): Promise<WorkflowInstanceRecord> {
    try {
      const [result] = await this.executor(executor).execute<ResultSetHeader>(
        `INSERT INTO workflow_instance
          (entity_type, entity_tracking_id, parent_entity_type, parent_tracking_id, definition_release_id, current_stage_definition_id,
           current_stage_key, status, rehearsal, assigned_to, entered_stage_at, row_version, business_data,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, UTC_TIMESTAMP(6), 0, JSON_OBJECT(), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
        [
          input.entityType,
          input.entityTrackingId,
          input.parentEntityType ?? null,
          input.parentTrackingId ?? null,
          input.definitionReleaseId,
          input.currentStageDefinitionId,
          input.currentStageKey,
          input.status,
          input.rehearsal ? 1 : 0
        ]
      );
      const created = await this.findById(result.insertId, executor);
      if (!created) {
        throw new Error('Workflow instance insert succeeded but row was not readable.');
      }
      return created;
    } catch (error) {
      if (isDuplicate(error)) {
        throw conflict(
          'OPTIC-WF-40902',
          `A workflow instance already exists for ${input.entityType} ${input.entityTrackingId}.`
        );
      }
      throw error;
    }
  }

  async findByEntity(
    entityType: string,
    entityTrackingId: string,
    executor?: QueryExecutor
  ): Promise<WorkflowInstanceRecord | null> {
    const [rows] = await this.executor(executor).execute<InstanceRow[]>(
      `SELECT ${INSTANCE_COLUMNS}
         FROM workflow_instance
        WHERE entity_type = ? AND entity_tracking_id = ?`,
      [entityType, entityTrackingId]
    );
    return rows[0] ? mapInstance(rows[0]) : null;
  }

  async findByTrackingId(entityTrackingId: string, executor?: QueryExecutor): Promise<WorkflowInstanceRecord[]> {
    const [rows] = await this.executor(executor).execute<InstanceRow[]>(
      `SELECT ${INSTANCE_COLUMNS}
         FROM workflow_instance
        WHERE entity_tracking_id = ?
        ORDER BY id`,
      [entityTrackingId]
    );
    return rows.map(mapInstance);
  }

  async searchByTrackingIdContains(
    needle: string,
    options?: { limit?: number },
    executor?: QueryExecutor
  ): Promise<WorkflowInstanceRecord[]> {
    const trimmed = needle.trim();
    if (!trimmed) {
      return [];
    }
    const limit = Math.max(1, Math.min(Math.trunc(options?.limit ?? 100), 200));
    const [rows] = await this.executor(executor).execute<InstanceRow[]>(
      `SELECT ${INSTANCE_COLUMNS}
         FROM workflow_instance
        WHERE entity_tracking_id LIKE ? ESCAPE '!'
        ORDER BY updated_at DESC
        LIMIT ${limit}`,
      [sqlLikeContains(trimmed)]
    );
    return rows.map(mapInstance);
  }

  async findByParent(
    parentEntityType: string,
    parentTrackingId: string,
    executor?: QueryExecutor
  ): Promise<WorkflowInstanceRecord[]> {
    const [rows] = await this.executor(executor).execute<InstanceRow[]>(
      `SELECT ${INSTANCE_COLUMNS}
         FROM workflow_instance
        WHERE parent_entity_type = ? AND parent_tracking_id = ?
        ORDER BY id`,
      [parentEntityType, parentTrackingId]
    );
    return rows.map(mapInstance);
  }

  async attachParentIfMissing(
    instanceId: number,
    parentEntityType: string,
    parentTrackingId: string,
    executor?: QueryExecutor
  ): Promise<WorkflowInstanceRecord | null> {
    await this.executor(executor).execute(
      `UPDATE workflow_instance
          SET parent_entity_type = ?, parent_tracking_id = ?, updated_at = UTC_TIMESTAMP(6)
        WHERE id = ? AND (parent_tracking_id IS NULL OR parent_tracking_id = '')`,
      [parentEntityType, parentTrackingId, instanceId]
    );
    return this.findById(instanceId, executor);
  }

  async listAll(executor?: QueryExecutor): Promise<WorkflowInstanceRecord[]> {
    const [rows] = await this.executor(executor).execute<InstanceRow[]>(
      `SELECT ${INSTANCE_COLUMNS}
         FROM workflow_instance
        ORDER BY id`
    );
    return rows.map(mapInstance);
  }

  async listByReleaseId(definitionReleaseId: number, executor?: QueryExecutor): Promise<WorkflowInstanceRecord[]> {
    const [rows] = await this.executor(executor).execute<InstanceRow[]>(
      `SELECT ${INSTANCE_COLUMNS}
         FROM workflow_instance
        WHERE definition_release_id = ?
        ORDER BY id`,
      [definitionReleaseId]
    );
    return rows.map(mapInstance);
  }

  async markRehearsalByReleaseId(definitionReleaseId: number, executor?: QueryExecutor): Promise<number> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE workflow_instance
          SET rehearsal = 1, updated_at = UTC_TIMESTAMP(6)
        WHERE definition_release_id = ? AND rehearsal = 0`,
      [definitionReleaseId]
    );
    return result.affectedRows;
  }

  async findById(id: number, executor?: QueryExecutor): Promise<WorkflowInstanceRecord | null> {
    const [rows] = await this.executor(executor).execute<InstanceRow[]>(
      `SELECT ${INSTANCE_COLUMNS}
         FROM workflow_instance
        WHERE id = ?`,
      [id]
    );
    return rows[0] ? mapInstance(rows[0]) : null;
  }

  async updateStage(
    input: UpdateInstanceStageInput,
    executor?: QueryExecutor
  ): Promise<WorkflowInstanceRecord> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE workflow_instance
          SET current_stage_definition_id = ?,
              current_stage_key = ?,
              status = ?,
              entered_stage_at = UTC_TIMESTAMP(6),
              row_version = row_version + 1,
              updated_at = UTC_TIMESTAMP(6)
        WHERE id = ? AND row_version = ?`,
      [
        input.currentStageDefinitionId,
        input.currentStageKey,
        input.status,
        input.instanceId,
        input.expectedRowVersion
      ]
    );
    if (result.affectedRows === 0) {
      const existing = await this.findById(input.instanceId, executor);
      if (!existing) {
        throw notFound('OPTIC-WF-40410', `Workflow instance ${input.instanceId} was not found.`);
      }
      throw conflict('OPTIC-WF-40901', 'This item changed after you opened it. Refresh and try again.');
    }
    const updated = await this.findById(input.instanceId, executor);
    if (!updated) {
      throw notFound('OPTIC-WF-40410', `Workflow instance ${input.instanceId} was not found.`);
    }
    return updated;
  }

  async insertVisit(input: OpenStageVisitInput, executor?: QueryExecutor): Promise<WorkflowStageVisitRecord> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `INSERT INTO workflow_stage_visit
        (workflow_instance_id, stage_definition_id, stage_key, visit_number, entered_at, entered_by)
       VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6), ?)`,
      [input.workflowInstanceId, input.stageDefinitionId, input.stageKey, input.visitNumber, input.enteredBy]
    );
    const visit = await this.findVisitById(result.insertId, executor);
    if (!visit) {
      throw new Error('Stage visit insert succeeded but row was not readable.');
    }
    return visit;
  }

  async findOpenVisit(
    workflowInstanceId: number,
    executor?: QueryExecutor
  ): Promise<WorkflowStageVisitRecord | null> {
    const [rows] = await this.executor(executor).execute<VisitRow[]>(
      `SELECT id, workflow_instance_id, stage_definition_id, stage_key, visit_number, entered_at,
              entered_by, assigned_at, assigned_to, processing_started_at, completed_at, completed_by,
              exit_action_key, next_stage_key, duration_seconds
         FROM workflow_stage_visit
        WHERE workflow_instance_id = ? AND completed_at IS NULL
        ORDER BY id DESC
        LIMIT 1`,
      [workflowInstanceId]
    );
    return rows[0] ? mapVisit(rows[0]) : null;
  }

  async completeVisit(
    input: CompleteStageVisitInput,
    executor?: QueryExecutor
  ): Promise<WorkflowStageVisitRecord> {
    const existing = await this.findVisitById(input.visitId, executor);
    if (!existing) {
      throw notFound('OPTIC-WF-40411', `Stage visit ${input.visitId} was not found.`);
    }
    await this.executor(executor).execute(
      `UPDATE workflow_stage_visit
          SET completed_at = UTC_TIMESTAMP(6),
              completed_by = ?,
              exit_action_key = ?,
              next_stage_key = ?,
              duration_seconds = TIMESTAMPDIFF(SECOND, entered_at, UTC_TIMESTAMP(6))
        WHERE id = ?`,
      [input.completedBy, input.exitActionKey ?? null, input.nextStageKey, input.visitId]
    );
    const updated = await this.findVisitById(input.visitId, executor);
    if (!updated) {
      throw notFound('OPTIC-WF-40411', `Stage visit ${input.visitId} was not found.`);
    }
    return updated;
  }

  async nextVisitNumber(
    workflowInstanceId: number,
    stageKey: string,
    executor?: QueryExecutor
  ): Promise<number> {
    const [rows] = await this.executor(executor).execute<Array<RowDataPacket & { next_number: number }>>(
      `SELECT COALESCE(MAX(visit_number), 0) + 1 AS next_number
         FROM workflow_stage_visit
        WHERE workflow_instance_id = ? AND stage_key = ?`,
      [workflowInstanceId, stageKey]
    );
    return Number(rows[0]?.next_number ?? 1);
  }

  async listVisits(workflowInstanceId: number, executor?: QueryExecutor): Promise<WorkflowStageVisitRecord[]> {
    const [rows] = await this.executor(executor).execute<VisitRow[]>(
      `SELECT id, workflow_instance_id, stage_definition_id, stage_key, visit_number, entered_at,
              entered_by, assigned_at, assigned_to, processing_started_at, completed_at, completed_by,
              exit_action_key, next_stage_key, duration_seconds
         FROM workflow_stage_visit
        WHERE workflow_instance_id = ?
        ORDER BY entered_at ASC, id ASC`,
      [workflowInstanceId]
    );
    return rows.map(mapVisit);
  }

  async assignToSelf(input: AssignInstanceInput, executor?: QueryExecutor): Promise<WorkflowInstanceRecord> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE workflow_instance
          SET assigned_to = ?,
              row_version = row_version + 1,
              updated_at = UTC_TIMESTAMP(6)
        WHERE id = ?
          AND assigned_to IS NULL
          AND row_version = ?`,
      [input.assignedTo, input.instanceId, input.expectedRowVersion]
    );
    if (result.affectedRows === 0) {
      throwAssignConflict(await this.findById(input.instanceId, executor), input.expectedRowVersion);
    }
    const updated = await this.findById(input.instanceId, executor);
    if (!updated) {
      throw notFound('OPTIC-WF-40410', `Workflow instance ${input.instanceId} was not found.`);
    }
    return updated;
  }

  async reassignTo(input: AssignInstanceInput, executor?: QueryExecutor): Promise<WorkflowInstanceRecord> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE workflow_instance
          SET assigned_to = ?,
              row_version = row_version + 1,
              updated_at = UTC_TIMESTAMP(6)
        WHERE id = ?
          AND row_version = ?`,
      [input.assignedTo, input.instanceId, input.expectedRowVersion]
    );
    if (result.affectedRows === 0) {
      throwReassignConflict(await this.findById(input.instanceId, executor), input.expectedRowVersion);
    }
    const updated = await this.findById(input.instanceId, executor);
    if (!updated) {
      throw notFound('OPTIC-WF-40410', `Workflow instance ${input.instanceId} was not found.`);
    }
    return updated;
  }

  async releaseAssignment(
    input: ReleaseInstanceInput,
    executor?: QueryExecutor
  ): Promise<WorkflowInstanceRecord> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE workflow_instance
          SET assigned_to = NULL,
              row_version = row_version + 1,
              updated_at = UTC_TIMESTAMP(6)
        WHERE id = ?
          AND assigned_to = ?
          AND row_version = ?`,
      [input.instanceId, input.assignedTo, input.expectedRowVersion]
    );
    if (result.affectedRows === 0) {
      throwReleaseConflict(
        await this.findById(input.instanceId, executor),
        input.expectedRowVersion,
        input.assignedTo
      );
    }
    const updated = await this.findById(input.instanceId, executor);
    if (!updated) {
      throw notFound('OPTIC-WF-40410', `Workflow instance ${input.instanceId} was not found.`);
    }
    return updated;
  }

  async updateBusinessData(
    input: UpdateBusinessDataInput,
    executor?: QueryExecutor
  ): Promise<WorkflowInstanceRecord> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE workflow_instance
          SET business_data = ?,
              row_version = row_version + 1,
              updated_at = UTC_TIMESTAMP(6)
        WHERE id = ? AND row_version = ?`,
      [JSON.stringify(input.businessData), input.instanceId, input.expectedRowVersion]
    );
    if (result.affectedRows === 0) {
      const existing = await this.findById(input.instanceId, executor);
      if (!existing) {
        throw notFound('OPTIC-WF-40410', `Workflow instance ${input.instanceId} was not found.`);
      }
      throw conflict('OPTIC-WF-40901', 'This item changed after you opened it. Refresh and try again.', [
        {
          field: 'expectedRowVersion',
          path: 'expectedRowVersion',
          message: 'Refresh and try again.',
          currentRowVersion: existing.rowVersion
        }
      ]);
    }
    const updated = await this.findById(input.instanceId, executor);
    if (!updated) {
      throw notFound('OPTIC-WF-40410', `Workflow instance ${input.instanceId} was not found.`);
    }
    return updated;
  }

  async applyActionMutation(
    input: ApplyActionMutationInput,
    executor?: QueryExecutor
  ): Promise<WorkflowInstanceRecord> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE workflow_instance
          SET business_data = ?,
              current_stage_definition_id = ?,
              current_stage_key = ?,
              status = ?,
              entered_stage_at = UTC_TIMESTAMP(6),
              assigned_to = IF(?, NULL, assigned_to),
              row_version = row_version + 1,
              updated_at = UTC_TIMESTAMP(6)
        WHERE id = ?
          AND row_version = ?
          AND (? IS NULL OR assigned_to = ?)`,
      [
        JSON.stringify(input.businessData),
        input.currentStageDefinitionId,
        input.currentStageKey,
        input.status,
        input.clearAssignment ? 1 : 0,
        input.instanceId,
        input.expectedRowVersion,
        input.requireAssignedTo ?? null,
        input.requireAssignedTo ?? null
      ]
    );
    if (result.affectedRows === 0) {
      const existing = await this.findById(input.instanceId, executor);
      if (!existing) {
        throw notFound('OPTIC-WF-40410', `Workflow instance ${input.instanceId} was not found.`);
      }
      if (input.requireAssignedTo && existing.assignedTo !== input.requireAssignedTo) {
        throw conflict('OPTIC-WF-40905', 'This item must be assigned to you before you can continue.', [
          {
            field: 'assignedTo',
            path: 'assignedTo',
            message: 'Assign the item to yourself and try again.',
            currentRowVersion: existing.rowVersion,
            assignedTo: existing.assignedTo
          }
        ]);
      }
      throw conflict('OPTIC-WF-40901', 'This item changed after you opened it. Refresh and try again.', [
        {
          field: 'expectedRowVersion',
          path: 'expectedRowVersion',
          message: 'Refresh and try again.',
          currentRowVersion: existing.rowVersion
        }
      ]);
    }
    const updated = await this.findById(input.instanceId, executor);
    if (!updated) {
      throw notFound('OPTIC-WF-40410', `Workflow instance ${input.instanceId} was not found.`);
    }
    return updated;
  }

  async insertWorkloadTransition(
    input: InsertWorkloadTransitionInput,
    executor?: QueryExecutor
  ): Promise<WorkloadTransitionRecord> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `INSERT INTO workload_transition
        (workflow_instance_id, entity_type, entity_tracking_id, definition_release_id,
         from_stage_key, to_stage_key, action_key, stage_visit_id, actor_id, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`,
      [
        input.workflowInstanceId,
        input.entityType,
        input.entityTrackingId,
        input.definitionReleaseId,
        input.fromStageKey,
        input.toStageKey,
        input.actionKey,
        input.stageVisitId,
        input.actorId
      ]
    );
    const [rows] = await this.executor(executor).execute<
      Array<RowDataPacket & {
        id: number;
        workflow_instance_id: number;
        entity_type: string;
        entity_tracking_id: string;
        definition_release_id: number;
        from_stage_key: string;
        to_stage_key: string;
        action_key: string;
        stage_visit_id: number | null;
        actor_id: string | null;
        occurred_at: Date;
      }>
    >(
      `SELECT id, workflow_instance_id, entity_type, entity_tracking_id, definition_release_id,
              from_stage_key, to_stage_key, action_key, stage_visit_id, actor_id, occurred_at
         FROM workload_transition WHERE id = ?`,
      [result.insertId]
    );
    const row = rows[0];
    if (!row) {
      throw new Error('Workload transition insert succeeded but row was not readable.');
    }
    return {
      id: row.id,
      workflowInstanceId: row.workflow_instance_id,
      entityType: row.entity_type,
      entityTrackingId: row.entity_tracking_id,
      definitionReleaseId: row.definition_release_id,
      fromStageKey: row.from_stage_key,
      toStageKey: row.to_stage_key,
      actionKey: row.action_key,
      stageVisitId: row.stage_visit_id,
      actorId: row.actor_id,
      occurredAt: toDate(row.occurred_at)
    };
  }

  async cancelPendingScheduledActions(
    workflowInstanceId: number,
    scheduledActionKeys?: string[],
    executor?: QueryExecutor
  ): Promise<number> {
    if (scheduledActionKeys && scheduledActionKeys.length === 0) {
      return 0;
    }
    const keys = scheduledActionKeys ?? [];
    const placeholders = keys.map(() => '?').join(', ');
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE scheduled_workflow_action
          SET status = 'CANCELLED',
              cancelled_at = UTC_TIMESTAMP(6),
              lease_owner = NULL,
              lease_expires_at = NULL
        WHERE workflow_instance_id = ?
          AND status = 'PENDING'
          ${placeholders ? `AND scheduled_action_key IN (${placeholders})` : ''}`,
      placeholders ? [workflowInstanceId, ...keys] : [workflowInstanceId]
    );
    return result.affectedRows;
  }

  async insertScheduledAction(
    input: InsertScheduledActionInput,
    executor?: QueryExecutor
  ): Promise<ScheduledWorkflowActionRecord> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `INSERT INTO scheduled_workflow_action
        (workflow_instance_id, definition_release_id, scheduled_action_key, stage_visit_id,
         due_at, status, idempotency_key)
       VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`,
      [
        input.workflowInstanceId,
        input.definitionReleaseId,
        input.scheduledActionKey,
        input.stageVisitId,
        input.dueAt,
        input.idempotencyKey
      ]
    );
    const rows = await this.listScheduledActions(input.workflowInstanceId, executor);
    const created = rows.find((row) => row.id === result.insertId);
    if (!created) {
      throw new Error('Scheduled action insert succeeded but row was not readable.');
    }
    return created;
  }

  async listScheduledActions(
    workflowInstanceId: number,
    executor?: QueryExecutor
  ): Promise<ScheduledWorkflowActionRecord[]> {
    const [rows] = await this.executor(executor).execute<ScheduledActionRow[]>(
      `${SCHEDULED_ACTION_SELECT}
        WHERE workflow_instance_id = ?
        ORDER BY id ASC`,
      [workflowInstanceId]
    );
    return rows.map(mapScheduledAction);
  }

  async findScheduledActionById(
    id: number,
    executor?: QueryExecutor
  ): Promise<ScheduledWorkflowActionRecord | null> {
    const [rows] = await this.executor(executor).execute<ScheduledActionRow[]>(
      `${SCHEDULED_ACTION_SELECT}
        WHERE id = ?`,
      [id]
    );
    return rows[0] ? mapScheduledAction(rows[0]) : null;
  }

  async claimDueScheduledActions(input: ClaimDueScheduledActionsInput): Promise<ScheduledWorkflowActionRecord[]> {
    const limit = Math.max(1, Math.min(input.limit, 100));
    return withTransaction(this.pool, async (connection) => {
      const [due] = await connection.execute<Array<RowDataPacket & { id: number }>>(
        `SELECT id
           FROM scheduled_workflow_action
          WHERE status = 'PENDING'
            AND due_at <= UTC_TIMESTAMP(6)
            AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at < UTC_TIMESTAMP(6))
          ORDER BY due_at ASC, id ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED`
      );
      const ids = due.map((row) => row.id);
      if (ids.length === 0) {
        return [];
      }
      const placeholders = ids.map(() => '?').join(', ');
      await connection.execute(
        `UPDATE scheduled_workflow_action
            SET lease_owner = ?,
                lease_expires_at = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ? MICROSECOND),
                last_attempt_at = UTC_TIMESTAMP(6)
          WHERE id IN (${placeholders})`,
        [input.owner, input.leaseMs * 1000, ...ids]
      );
      const [rows] = await connection.execute<ScheduledActionRow[]>(
        `${SCHEDULED_ACTION_SELECT}
          WHERE id IN (${placeholders})
          ORDER BY due_at ASC, id ASC`,
        ids
      );
      return rows.map(mapScheduledAction);
    });
  }

  async completeScheduledAction(
    input: CompleteScheduledActionInput,
    executor?: QueryExecutor
  ): Promise<boolean> {
    const leaseClause =
      input.leaseOwner !== undefined && input.leaseOwner !== null
        ? 'AND lease_owner = ?'
        : '';
    const params =
      input.leaseOwner !== undefined && input.leaseOwner !== null
        ? [input.id, input.leaseOwner]
        : [input.id];
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE scheduled_workflow_action
          SET status = 'COMPLETED',
              completed_at = UTC_TIMESTAMP(6),
              lease_owner = NULL,
              lease_expires_at = NULL
        WHERE id = ?
          AND status = 'PENDING'
          ${leaseClause}`,
      params
    );
    return result.affectedRows === 1;
  }

  async retryScheduledAction(input: RetryScheduledActionInput, executor?: QueryExecutor): Promise<boolean> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE scheduled_workflow_action
          SET due_at = ?,
              attempt_count = attempt_count + 1,
              last_attempt_at = UTC_TIMESTAMP(6),
              last_error_code = ?,
              last_error_message = ?,
              lease_owner = NULL,
              lease_expires_at = NULL
        WHERE id = ?
          AND status = 'PENDING'
          AND lease_owner = ?`,
      [input.dueAt, input.errorCode, truncateError(input.errorMessage), input.id, input.leaseOwner]
    );
    return result.affectedRows === 1;
  }

  async failScheduledAction(input: FailScheduledActionInput, executor?: QueryExecutor): Promise<boolean> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE scheduled_workflow_action
          SET status = 'DEAD_LETTER',
              attempt_count = attempt_count + 1,
              last_attempt_at = UTC_TIMESTAMP(6),
              last_error_code = ?,
              last_error_message = ?,
              lease_owner = NULL,
              lease_expires_at = NULL
        WHERE id = ?
          AND status = 'PENDING'
          AND lease_owner = ?`,
      [input.errorCode, truncateError(input.errorMessage), input.id, input.leaseOwner]
    );
    return result.affectedRows === 1;
  }

  async abandonScheduledLeases(owner: string, executor?: QueryExecutor): Promise<number> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE scheduled_workflow_action
          SET lease_owner = NULL,
              lease_expires_at = NULL
        WHERE lease_owner = ?
          AND status = 'PENDING'`,
      [owner]
    );
    return result.affectedRows;
  }

  async updateScheduledDueAt(id: number, dueAt: Date, executor?: QueryExecutor): Promise<void> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE scheduled_workflow_action SET due_at = ? WHERE id = ?`,
      [dueAt, id]
    );
    if (result.affectedRows === 0) {
      throw notFound('OPTIC-WF-40421', `Scheduled action ${id} was not found.`);
    }
  }

  async listTransitions(workflowInstanceId: number, executor?: QueryExecutor): Promise<WorkloadTransitionRecord[]> {
    const [rows] = await this.executor(executor).execute<
      Array<
        RowDataPacket & {
          id: number;
          workflow_instance_id: number;
          entity_type: string;
          entity_tracking_id: string;
          definition_release_id: number;
          from_stage_key: string;
          to_stage_key: string;
          action_key: string;
          stage_visit_id: number | null;
          actor_id: string | null;
          occurred_at: Date;
        }
      >
    >(
      `SELECT id, workflow_instance_id, entity_type, entity_tracking_id, definition_release_id,
              from_stage_key, to_stage_key, action_key, stage_visit_id, actor_id, occurred_at
         FROM workload_transition
        WHERE workflow_instance_id = ?
        ORDER BY id ASC`,
      [workflowInstanceId]
    );
    return rows.map((row) => ({
      id: row.id,
      workflowInstanceId: row.workflow_instance_id,
      entityType: row.entity_type,
      entityTrackingId: row.entity_tracking_id,
      definitionReleaseId: row.definition_release_id,
      fromStageKey: row.from_stage_key,
      toStageKey: row.to_stage_key,
      actionKey: row.action_key,
      stageVisitId: row.stage_visit_id,
      actorId: row.actor_id,
      occurredAt: toDate(row.occurred_at)
    }));
  }

  async updateOpenVisitAssignment(
    workflowInstanceId: number,
    assignedTo: string | null,
    executor?: QueryExecutor
  ): Promise<void> {
    await this.executor(executor).execute(
      `UPDATE workflow_stage_visit
          SET assigned_to = ?,
              assigned_at = IF(? IS NULL, NULL, UTC_TIMESTAMP(6))
        WHERE workflow_instance_id = ?
          AND completed_at IS NULL`,
      [assignedTo, assignedTo, workflowInstanceId]
    );
  }

  private async findVisitById(
    id: number,
    executor?: QueryExecutor
  ): Promise<WorkflowStageVisitRecord | null> {
    const [rows] = await this.executor(executor).execute<VisitRow[]>(
      `SELECT id, workflow_instance_id, stage_definition_id, stage_key, visit_number, entered_at,
              entered_by, assigned_at, assigned_to, processing_started_at, completed_at, completed_by,
              exit_action_key, next_stage_key, duration_seconds
         FROM workflow_stage_visit
        WHERE id = ?`,
      [id]
    );
    return rows[0] ? mapVisit(rows[0]) : null;
  }

  private executor(executor?: QueryExecutor): QueryExecutor {
    return executor ?? this.pool;
  }
}

const SCHEDULED_ACTION_SELECT = `SELECT id, workflow_instance_id, definition_release_id, scheduled_action_key,
        stage_visit_id, due_at, status, lease_owner, lease_expires_at, attempt_count, last_attempt_at,
        last_error_code, last_error_message, completed_at, cancelled_at, idempotency_key
   FROM scheduled_workflow_action`;

interface ScheduledActionRow extends RowDataPacket {
  id: number;
  workflow_instance_id: number;
  definition_release_id: number;
  scheduled_action_key: string;
  stage_visit_id: number | null;
  due_at: Date;
  status: ScheduledActionStatus;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  attempt_count: number;
  last_attempt_at: Date | null;
  last_error_code: string | null;
  last_error_message: string | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  idempotency_key: string;
}

function mapScheduledAction(row: ScheduledActionRow): ScheduledWorkflowActionRecord {
  return {
    id: row.id,
    workflowInstanceId: row.workflow_instance_id,
    definitionReleaseId: row.definition_release_id,
    scheduledActionKey: row.scheduled_action_key,
    stageVisitId: row.stage_visit_id,
    dueAt: toDate(row.due_at),
    status: row.status,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at ? toDate(row.lease_expires_at) : null,
    attemptCount: Number(row.attempt_count),
    lastAttemptAt: row.last_attempt_at ? toDate(row.last_attempt_at) : null,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    completedAt: row.completed_at ? toDate(row.completed_at) : null,
    cancelledAt: row.cancelled_at ? toDate(row.cancelled_at) : null,
    idempotencyKey: row.idempotency_key
  };
}

function truncateError(message: string | null): string | null {
  if (!message) {
    return null;
  }
  return message.length > 1000 ? message.slice(0, 1000) : message;
}

function mapInstance(row: InstanceRow): WorkflowInstanceRecord {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityTrackingId: row.entity_tracking_id,
    parentEntityType: row.parent_entity_type ?? null,
    parentTrackingId: row.parent_tracking_id ?? null,
    definitionReleaseId: row.definition_release_id,
    currentStageDefinitionId: row.current_stage_definition_id,
    currentStageKey: row.current_stage_key,
    status: row.status,
    rehearsal: Boolean(row.rehearsal),
    assignedTo: row.assigned_to,
    enteredStageAt: toDate(row.entered_stage_at),
    rowVersion: Number(row.row_version),
    businessData: asObject(row.business_data),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at)
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (value == null) {
    return {};
  }
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return {};
}

function mapVisit(row: VisitRow): WorkflowStageVisitRecord {
  return {
    id: row.id,
    workflowInstanceId: row.workflow_instance_id,
    stageDefinitionId: row.stage_definition_id,
    stageKey: row.stage_key,
    visitNumber: row.visit_number,
    enteredAt: toDate(row.entered_at),
    enteredBy: row.entered_by,
    assignedAt: row.assigned_at ? toDate(row.assigned_at) : null,
    assignedTo: row.assigned_to,
    processingStartedAt: row.processing_started_at ? toDate(row.processing_started_at) : null,
    completedAt: row.completed_at ? toDate(row.completed_at) : null,
    completedBy: row.completed_by,
    exitActionKey: row.exit_action_key,
    nextStageKey: row.next_stage_key,
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds)
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function isDuplicate(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY');
}

/** Escape LIKE wildcards so tracking ids with `_` (for example TRIAL-I_407-…) match literally. */
function sqlLikeContains(needle: string): string {
  return `%${needle.replace(/[!%_]/g, (char) => `!${char}`)}%`;
}
