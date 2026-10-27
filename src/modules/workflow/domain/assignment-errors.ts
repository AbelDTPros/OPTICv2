import { conflict, notFound } from '../../../platform/errors/app-error.js';
import type { WorkflowInstanceRecord } from './types.js';

export function throwAssignConflict(
  existing: WorkflowInstanceRecord | null,
  expectedRowVersion: number
): never {
  if (!existing) {
    throw notFound('OPTIC-WF-40410', 'Workflow instance was not found.');
  }
  const details = [
    {
      field: 'expectedRowVersion',
      path: 'expectedRowVersion',
      message: 'Refresh and try again.',
      currentRowVersion: existing.rowVersion,
      assignedTo: existing.assignedTo
    }
  ];
  if (existing.assignedTo !== null) {
    throw conflict(
      'OPTIC-WF-40903',
      'This item is already assigned. Refresh the queue and select another item.',
      details
    );
  }
  throw conflict(
    'OPTIC-WF-40901',
    'This item changed after you opened it. Refresh and try again.',
    details
  );
}

export function throwReleaseConflict(
  existing: WorkflowInstanceRecord | null,
  expectedRowVersion: number,
  actorId: string
): never {
  if (!existing) {
    throw notFound('OPTIC-WF-40410', 'Workflow instance was not found.');
  }
  const details = [
    {
      field: 'expectedRowVersion',
      path: 'expectedRowVersion',
      message: 'Refresh and try again.',
      currentRowVersion: existing.rowVersion,
      assignedTo: existing.assignedTo
    }
  ];
  if (existing.rowVersion !== expectedRowVersion) {
    throw conflict(
      'OPTIC-WF-40901',
      'This item changed after you opened it. Refresh and try again.',
      details
    );
  }
  if (existing.assignedTo && existing.assignedTo !== actorId) {
    throw conflict(
      'OPTIC-WF-40904',
      'Only the assigned user can release this item.',
      details
    );
  }
  throw conflict('OPTIC-WF-40904', 'This item is not assigned.', details);
}

export function throwReassignConflict(
  existing: WorkflowInstanceRecord | null,
  expectedRowVersion: number
): never {
  if (!existing) {
    throw notFound('OPTIC-WF-40410', 'Workflow instance was not found.');
  }
  throw conflict(
    'OPTIC-WF-40908',
    'This item changed after you opened it. Refresh and try again.',
    [
      {
        field: 'expectedRowVersion',
        path: 'expectedRowVersion',
        message: 'Refresh and try again.',
        currentRowVersion: existing.rowVersion,
        assignedTo: existing.assignedTo
      }
    ]
  );
}
