import { describe, expect, it } from 'vitest';
import { assignmentPermissions } from '../../src/modules/configuration/domain/assignment-policy.js';

describe('assignmentPermissions', () => {
  it('infers assign and reassign from terminal when flags are omitted', () => {
    expect(
      assignmentPermissions({
        terminal: false,
        assignmentPolicy: { required: true, clearOnTransition: true }
      })
    ).toEqual({ allowAssign: true, allowReassign: true, allowRelease: true });
    expect(
      assignmentPermissions({
        terminal: true,
        assignmentPolicy: { required: false, clearOnTransition: false }
      })
    ).toEqual({ allowAssign: false, allowReassign: false, allowRelease: true });
  });

  it('honors explicit stage flags on any stage', () => {
    expect(
      assignmentPermissions({
        terminal: false,
        assignmentPolicy: {
          required: false,
          clearOnTransition: false,
          allowAssign: false,
          allowReassign: false,
          allowRelease: false
        }
      })
    ).toEqual({ allowAssign: false, allowReassign: false, allowRelease: false });
    expect(
      assignmentPermissions({
        terminal: true,
        assignmentPolicy: {
          required: false,
          clearOnTransition: false,
          allowAssign: true,
          allowReassign: true,
          allowRelease: false
        }
      })
    ).toEqual({ allowAssign: true, allowReassign: true, allowRelease: false });
  });

  it('treats a missing stage with COMPLETED status as terminal defaults', () => {
    expect(assignmentPermissions(undefined, 'COMPLETED')).toEqual({
      allowAssign: false,
      allowReassign: false,
      allowRelease: true
    });
  });
});
