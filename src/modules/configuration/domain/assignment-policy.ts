import type { AssignmentPolicy, StageDefinition } from './types.js';

export interface AssignmentPermissions {
  allowAssign: boolean;
  allowReassign: boolean;
  allowRelease: boolean;
}

export function assignmentPermissions(
  stage: Pick<StageDefinition, 'terminal' | 'assignmentPolicy'> | undefined,
  status?: string
): AssignmentPermissions {
  if (!stage) {
    const completed = status === 'COMPLETED';
    return {
      allowAssign: !completed,
      allowReassign: !completed,
      allowRelease: true
    };
  }
  const terminal = Boolean(stage.terminal);
  return {
    allowAssign: stage.assignmentPolicy.allowAssign ?? !terminal,
    allowReassign: stage.assignmentPolicy.allowReassign ?? !terminal,
    allowRelease: stage.assignmentPolicy.allowRelease ?? true
  };
}

export function resolveAssignmentPolicy(
  stage: Pick<StageDefinition, 'terminal' | 'assignmentPolicy'>,
  patch: Partial<AssignmentPolicy> = {}
): AssignmentPolicy {
  const current = assignmentPermissions(stage);
  return {
    required: stage.assignmentPolicy.required,
    clearOnTransition: stage.assignmentPolicy.clearOnTransition,
    allowAssign: current.allowAssign,
    allowReassign: current.allowReassign,
    allowRelease: current.allowRelease,
    ...patch
  };
}
