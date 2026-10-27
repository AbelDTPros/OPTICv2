import { describe, expect, it } from 'vitest';
import { demoDesignerAction, demoDesignerForm, demoDesignerWorkflow } from '../designers/demo-draft.js';
import { buildDraftCase, isDraftCase } from './draft-case.js';

describe('draft-case', () => {
  it('builds an unpersisted summary at the initial stage', () => {
    const draft = buildDraftCase({
      trackingId: 'MAIL-DRAFT-1',
      entityType: 'MAIL',
      definitionKey: 'I_407_MAILITEM',
      version: '0.1.0',
      workflow: demoDesignerWorkflow,
      forms: { [demoDesignerForm.formKey]: demoDesignerForm },
      actions: { [demoDesignerAction.actionKey]: demoDesignerAction }
    });
    expect(isDraftCase(draft)).toBe(true);
    expect(draft.status).toBe('DRAFT');
    expect(draft.workflow.currentStageKey).toBe('READY_FOR_DATA_ENTRY');
    expect(draft.stageForm?.formKey).toBe('I90_DATA_ENTRY');
    expect(draft.allowedActions).toEqual([{ actionKey: 'COMPLETE', label: 'Complete' }]);
    expect(draft.assignmentPermissions?.allowAssign).toBe(true);
  });
});
