import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import type { StageFormDefinition } from '../../../../src/modules/configuration/domain/types.js';
import {
  demoDesignerAction,
  demoDesignerBulk,
  demoDesignerForm,
  demoDesignerQueue,
  demoDesignerSla,
  demoDesignerWorkflow
} from './demo-draft.js';
import { WorkflowDesigner } from './WorkflowDesigner.js';
import { catalogFromRelease } from './workflow-model.js';

const demoCatalog = catalogFromRelease({
  forms: { [demoDesignerForm.formKey]: demoDesignerForm, I90_REVIEW: {} },
  queues: { [demoDesignerQueue.queueKey]: demoDesignerQueue },
  slas: { [demoDesignerSla.slaKey]: demoDesignerSla },
  bulkActions: { [demoDesignerBulk.bulkActionKey]: demoDesignerBulk },
  actions: { [demoDesignerAction.actionKey]: demoDesignerAction, SAVE_DRAFT: { type: 'SAVE', label: 'Save' } }
});

function Harness({ forms }: { forms?: Record<string, StageFormDefinition> } = {}) {
  const [workflow, setWorkflow] = useState(demoDesignerWorkflow);
  return <WorkflowDesigner workflow={workflow} catalog={demoCatalog} forms={forms} onChange={setWorkflow} />;
}

describe('WorkflowDesigner', () => {
  it('renders stage nodes and properties without accessibility violations', async () => {
    const { container } = render(<Harness />);
    expect(screen.getByRole('heading', { level: 1, name: 'Workflow designer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stage Ready for Data Entry' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Stage key')).toHaveValue('READY_FOR_DATA_ENTRY');
    expect(document.querySelector('.optic-workflow-graph')).not.toHaveAttribute('style');
    expect(document.querySelector('.optic-workflow-scene')).toHaveAttribute('style');
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('adds a stage from the toolbar', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Add stage' }));
    expect(screen.getByRole('button', { name: 'Stage New stage' })).toBeInTheDocument();
  });

  it('selects a newly added stage so rename applies to it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Stage Ready for Data Entry' }));
    await user.click(screen.getByRole('button', { name: 'Add stage' }));
    const newStage = screen.getByRole('button', { name: 'Stage New stage' });
    expect(newStage).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Display name')).toHaveValue('New stage');
    const name = screen.getByLabelText('Display name');
    await user.clear(name);
    await user.type(name, 'Payment Review');
    expect(screen.getByRole('button', { name: 'Stage Payment Review' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Stage Ready for Data Entry' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('keeps the renamed stage selected while editing the stage key', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Add stage' }));
    const key = screen.getByLabelText('Stage key');
    await user.clear(key);
    await user.type(key, 'PAYMENT_REVIEW');
    expect(screen.getByLabelText('Stage key')).toHaveValue('PAYMENT_REVIEW');
    expect(screen.getByLabelText('Display name')).toHaveValue('New stage');
    expect(screen.getByRole('button', { name: 'Stage New stage' })).toHaveAttribute('aria-pressed', 'true');
    const name = screen.getByLabelText('Display name');
    await user.clear(name);
    await user.type(name, 'Payment Review');
    expect(screen.getByRole('button', { name: 'Stage Payment Review' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('edits the selected stage display name', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const name = screen.getByLabelText('Display name');
    await user.clear(name);
    await user.type(name, 'Intake');
    expect(screen.getByRole('button', { name: 'Stage Intake' })).toBeInTheDocument();
  });

  it('lets the author turn assign, reassign, and release on or off per stage', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('tab', { name: 'Assign' }));
    expect(screen.getByRole('checkbox', { name: 'Allow assign' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Allow reassign' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Allow release' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Allow assign' }));
    expect(screen.getByRole('checkbox', { name: 'Allow assign' })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Stage Completed' }));
    await user.click(screen.getByRole('tab', { name: 'Assign' }));
    expect(screen.getByRole('checkbox', { name: 'Allow assign' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Allow reassign' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Allow release' })).toBeChecked();
  });

  it('picks form, SLA, and actions from the catalog instead of typing keys', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('tab', { name: 'Routing' }));
    expect(screen.getByLabelText('Form')).toHaveValue('I90_DATA_ENTRY');
    expect(screen.getByLabelText('Queue')).toHaveValue('READY_FOR_DATA_ENTRY');
    expect(screen.getByLabelText('SLA')).toHaveDisplayValue('None');
    await user.selectOptions(screen.getByLabelText('SLA'), 'DATA_ENTRY_SLA');
    expect(screen.getByLabelText('SLA')).toHaveValue('DATA_ENTRY_SLA');
    await user.selectOptions(screen.getByLabelText('Form'), 'I90_REVIEW');
    expect(screen.getByLabelText('Form')).toHaveValue('I90_REVIEW');
    expect(screen.getByRole('checkbox', { name: 'Complete (COMPLETE)' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Save (SAVE_DRAFT)' }));
    expect(screen.getByRole('checkbox', { name: 'Save (SAVE_DRAFT)' })).toBeChecked();
    expect(screen.getByRole('group', { name: 'Bulk actions' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'BULK_COMPLETE' })).not.toBeChecked();
  });

  it('removes the selected canvas stage when Delete is pressed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Stage Ready for Data Entry' }));
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('{Delete}');
    expect(screen.queryByRole('button', { name: 'Stage Ready for Data Entry' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stage Completed' })).toBeInTheDocument();
    expect(screen.getByLabelText('Stage key')).toHaveValue('COMPLETED');
  });

  it('removes the selected stage from Properties', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Stage Ready for Data Entry' }));
    await user.click(screen.getByRole('button', { name: 'Remove Ready for Data Entry' }));
    expect(screen.queryByRole('button', { name: 'Stage Ready for Data Entry' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stage Completed' })).toBeInTheDocument();
  });

  it('does not delete the selected stage while typing in Properties', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Stage Ready for Data Entry' }));
    await user.click(screen.getByLabelText('Display name'));
    await user.keyboard('{Backspace}{Backspace}{Delete}');
    expect(screen.getByRole('button', { name: /Stage Ready for Data Ent/i })).toBeInTheDocument();
  });

  it('removes the selected connection when Delete is pressed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Default: Ready for Data Entry to Completed/i }));
    expect(screen.getByRole('heading', { name: 'Connection' })).toBeInTheDocument();
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('{Delete}');
    expect(screen.queryByRole('button', { name: /Default: Ready for Data Entry to Completed/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Properties' })).toBeInTheDocument();
  });

  it('lets the author select a connection arrow and edit it in Properties', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Default: Ready for Data Entry to Completed/i }));
    expect(screen.getByRole('heading', { name: 'Connection' })).toBeInTheDocument();
    expect(screen.getByLabelText('Default path target')).toHaveValue('COMPLETED');
    expect(screen.getByRole('button', { name: /Default: Ready for Data Entry to Completed/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await user.selectOptions(screen.getByLabelText('Default path target'), 'READY_FOR_DATA_ENTRY');
    expect(screen.getByLabelText('Default path target')).toHaveValue('READY_FOR_DATA_ENTRY');
  });

  it('connects from Properties and selects the new arrow', async () => {
    const user = userEvent.setup();
    const shipping = {
      stageKey: 'READY_FOR_SHIPPING',
      displayName: 'Ready for Shipping',
      order: 20,
      actionKeys: ['COMPLETE'],
      assignmentPolicy: { required: false, clearOnTransition: true }
    };
    function ConnectHarness() {
      const [workflow, setWorkflow] = useState({
        ...demoDesignerWorkflow,
        stages: [demoDesignerWorkflow.stages[0]!, shipping, demoDesignerWorkflow.stages[1]!]
      });
      return <WorkflowDesigner workflow={workflow} catalog={demoCatalog} onChange={setWorkflow} />;
    }
    render(<ConnectHarness />);
    await user.click(screen.getByRole('button', { name: 'Stage Ready for Shipping' }));
    await user.click(screen.getByRole('tab', { name: 'Routing' }));
    expect(screen.getByRole('group', { name: 'Connect to' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect from Ready for Shipping' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Target stage'), 'COMPLETED');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(screen.getByRole('heading', { name: 'Connection' })).toBeInTheDocument();
    expect(screen.getByLabelText('Default path target')).toHaveValue('COMPLETED');
    expect(screen.getByRole('group', { name: 'From Ready for Shipping' })).toBeInTheDocument();
  });

  it('reorders a selected rule with Try later', async () => {
    const user = userEvent.setup();
    function PriorityHarness() {
      const [workflow, setWorkflow] = useState({
        ...demoDesignerWorkflow,
        transitionSets: [
          {
            transitionSetKey: 'FROM_DATA_ENTRY',
            evaluationMode: 'FIRST_MATCH' as const,
            rules: [
              {
                ruleKey: 'WHEN_A',
                priority: 1,
                when: { path: '$.a', operator: 'EQUALS' as const, value: '1' },
                targetStageKey: 'COMPLETED'
              },
              {
                ruleKey: 'WHEN_B',
                priority: 2,
                when: { path: '$.b', operator: 'EQUALS' as const, value: '2' },
                targetStageKey: 'COMPLETED'
              }
            ],
            defaultTargetStageKey: 'COMPLETED'
          }
        ]
      });
      return <WorkflowDesigner workflow={workflow} catalog={demoCatalog} onChange={setWorkflow} />;
    }
    render(<PriorityHarness />);
    await user.click(screen.getByRole('button', { name: /Priority 1: Ready for Data Entry to Completed via WHEN_A/i }));
    expect(screen.getByLabelText('Priority')).toHaveValue(1);
    await user.click(screen.getByRole('button', { name: 'Connection: try later WHEN_A' }));
    expect(screen.getByLabelText('Priority')).toHaveValue(2);
    expect(screen.getByRole('button', { name: /Priority 1: Ready for Data Entry to Completed via WHEN_B/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Priority 2: Ready for Data Entry to Completed via WHEN_A/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('selects a timer edge and edits its target', async () => {
    const user = userEvent.setup();
    const holdExpire = {
      scheduledActionKey: 'HOLD_EXPIRE',
      trigger: { type: 'STAGE_ENTERED', stageKey: 'READY_FOR_DATA_ENTRY' },
      delay: { source: 'CONFIG', duration: { days: 90 } },
      action: { type: 'TRANSITION', targetStage: 'COMPLETED' },
      cancellation: { cancelIfStageChanges: true }
    };
    function TimerHarness() {
      const [workflow, setWorkflow] = useState(demoDesignerWorkflow);
      const [scheduled, setScheduled] = useState({ [holdExpire.scheduledActionKey]: holdExpire });
      const timerCatalog = catalogFromRelease({
        forms: { [demoDesignerForm.formKey]: demoDesignerForm },
        queues: { [demoDesignerQueue.queueKey]: demoDesignerQueue },
        slas: { [demoDesignerSla.slaKey]: demoDesignerSla },
        bulkActions: { [demoDesignerBulk.bulkActionKey]: demoDesignerBulk },
        actions: { [demoDesignerAction.actionKey]: demoDesignerAction, SAVE_DRAFT: { type: 'SAVE', label: 'Save' } },
        scheduledActions: scheduled
      });
      return (
        <WorkflowDesigner
          workflow={workflow}
          catalog={timerCatalog}
          scheduledActions={scheduled}
          onChange={setWorkflow}
          onScheduledActionsChange={setScheduled}
        />
      );
    }
    render(<TimerHarness />);
    await user.click(
      screen.getByRole('button', { name: /Timer: Ready for Data Entry to Completed after 90d via HOLD_EXPIRE/i })
    );
    expect(screen.getByRole('heading', { name: 'Connection' })).toBeInTheDocument();
    expect(screen.getByLabelText('Delay days')).toHaveValue(90);
    expect(screen.getByLabelText('Target stage')).toHaveValue('COMPLETED');
    await user.selectOptions(screen.getByLabelText('Target stage'), 'READY_FOR_DATA_ENTRY');
    expect(screen.getByLabelText('Target stage')).toHaveValue('READY_FOR_DATA_ENTRY');
    await user.click(screen.getByRole('button', { name: 'Clear timer path' }));
    expect(
      screen.queryByRole('button', { name: /Timer: Ready for Data Entry/i })
    ).not.toBeInTheDocument();
  });

  it('lets the user keep typing a rule key', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    const ruleKey = screen.getByLabelText('Rule key');
    await user.clear(ruleKey);
    await user.type(ruleKey, 'shred_when');
    expect(ruleKey).toHaveValue('SHRED_WHEN');
    expect(ruleKey).toHaveFocus();
  });

  it('shows compact rule rows and expands one rule to edit', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(screen.getByLabelText('Rule key')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Collapse rule RULE_1/ }));
    expect(screen.queryByLabelText('Rule key')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Expand rule RULE_1:/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(screen.getByRole('list', { name: 'Rules for FROM_DATA_ENTRY' }).children).toHaveLength(2);
    expect(screen.getByLabelText('Rule key')).toHaveValue('RULE_2');
    await user.click(screen.getByRole('button', { name: /Expand rule RULE_1:/ }));
    expect(screen.getAllByLabelText('Rule key')).toHaveLength(1);
    expect(screen.getByLabelText('Rule key')).toHaveValue('RULE_1');
  });

  it('picks rule paths from form fields instead of typing JSONPath', async () => {
    const user = userEvent.setup();
    const applicant = demoDesignerForm.sections[0]!;
    const forms: Record<string, StageFormDefinition> = {
      [demoDesignerForm.formKey]: {
        ...demoDesignerForm,
        sections: [
          {
            ...applicant,
            fields: [
              ...applicant.fields,
              {
                fieldKey: 'WORKLOAD_STATUS',
                path: '$.workload_status',
                component: 'SELECT',
                label: 'Workload Status',
                width: 6,
                options: [
                  { value: 'Accepted', label: 'Accepted' },
                  { value: 'Rejected', label: 'Rejected' }
                ]
              }
            ]
          }
        ]
      }
    };
    render(<Harness forms={forms} />);
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    const path = screen.getByLabelText('Path');
    expect(path.tagName).toBe('SELECT');
    expect(path).toHaveDisplayValue('A-Number · $.dataEntryDetails.ANumber');
    await user.selectOptions(path, '$.dataEntryDetails.workload_status');
    expect(path).toHaveValue('$.dataEntryDetails.workload_status');
    const value = screen.getByLabelText('Value');
    expect(value.tagName).toBe('SELECT');
    await user.selectOptions(value, 'Rejected');
    expect(value).toHaveValue('Rejected');
  });

  it('adds outbound transitions when a new stage is created', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Add stage' }));
    expect(screen.getByRole('group', { name: 'From New stage' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Arrange stages' })).toBeInTheDocument();
  });

  it('lets a later stage split off shared Complete rules', async () => {
    const user = userEvent.setup();
    const shipping = {
      stageKey: 'READY_FOR_SHIPPING',
      displayName: 'Ready for Shipping',
      order: 20,
      actionKeys: ['COMPLETE'],
      assignmentPolicy: { required: false, clearOnTransition: true }
    };
    function SharedHarness() {
      const [workflow, setWorkflow] = useState({
        ...demoDesignerWorkflow,
        stages: [demoDesignerWorkflow.stages[0]!, shipping, demoDesignerWorkflow.stages[1]!]
      });
      return <WorkflowDesigner workflow={workflow} catalog={demoCatalog} onChange={setWorkflow} />;
    }
    render(<SharedHarness />);
    expect(screen.getByRole('group', { name: 'From Ready for Data Entry' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Give this stage its own transitions' }));
    expect(screen.getByRole('group', { name: 'From Ready for Shipping' })).toBeInTheDocument();
    expect(screen.getAllByLabelText('Default target')).toHaveLength(2);
  });

  it('collapses other stages’ transition rules until you expand them', async () => {
    const user = userEvent.setup();
    const shipping = {
      stageKey: 'READY_FOR_SHIPPING',
      displayName: 'Ready for Shipping',
      order: 20,
      actionKeys: ['COMPLETE'],
      transitionSetKey: 'FROM_SHIPPING',
      assignmentPolicy: { required: false, clearOnTransition: true }
    };
    function TwoOwnedHarness() {
      const [workflow, setWorkflow] = useState({
        ...demoDesignerWorkflow,
        stages: [demoDesignerWorkflow.stages[0]!, shipping, demoDesignerWorkflow.stages[1]!],
        transitionSets: [
          ...demoDesignerWorkflow.transitionSets,
          {
            transitionSetKey: 'FROM_SHIPPING',
            evaluationMode: 'FIRST_MATCH' as const,
            rules: [],
            defaultTargetStageKey: 'COMPLETED'
          }
        ]
      });
      return <WorkflowDesigner workflow={workflow} catalog={demoCatalog} onChange={setWorkflow} />;
    }
    render(<TwoOwnedHarness />);
    expect(screen.getAllByText('Default → Completed · No extra rules')).toHaveLength(2);
    expect(screen.getAllByLabelText('Default target')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Stage Ready for Shipping' }));
    expect(screen.getAllByLabelText('Default target')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Collapse others' }));
    expect(screen.getAllByLabelText('Default target')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getAllByLabelText('Default target')).toHaveLength(2);
  });

  it('lets the user delete an unused transition set', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Add transition set' }));
    expect(screen.getByRole('group', { name: 'TRANSITIONS (not used by a stage)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    await user.click(screen.getByRole('button', { name: 'Remove transition set' }));
    expect(screen.queryByRole('group', { name: 'TRANSITIONS (not used by a stage)' })).not.toBeInTheDocument();
  });

  it('lets the user remove a leftover clone set even when Complete still names it', async () => {
    const user = userEvent.setup();
    const mailStage = {
      stageKey: 'MAIL_INTAKE',
      displayName: 'Mail intake',
      order: 10,
      actionKeys: ['COMPLETE'],
      transitionSetKey: 'FROM_MAIL_INTAKE',
      assignmentPolicy: { required: false, clearOnTransition: true }
    };
    function LeftoverHarness() {
      const [workflow, setWorkflow] = useState({
        ...demoDesignerWorkflow,
        initialStageKey: 'MAIL_INTAKE',
        stages: [mailStage, demoDesignerWorkflow.stages[1]!],
        transitionSets: [
          demoDesignerWorkflow.transitionSets[0]!,
          {
            transitionSetKey: 'FROM_MAIL_INTAKE',
            evaluationMode: 'FIRST_MATCH' as const,
            rules: [],
            defaultTargetStageKey: 'COMPLETED'
          }
        ]
      });
      const [detached, setDetached] = useState<{ removedKey: string; replacementKey?: string } | undefined>();
      return (
        <>
          <WorkflowDesigner
            workflow={workflow}
            catalog={demoCatalog}
            onChange={setWorkflow}
            onDetachTransitionSet={(removedKey, replacementKey) => setDetached({ removedKey, replacementKey })}
          />
          {detached ? (
            <p>
              Detached {detached.removedKey} to {detached.replacementKey}
            </p>
          ) : null}
        </>
      );
    }
    render(<LeftoverHarness />);
    expect(screen.getByRole('group', { name: 'FROM_DATA_ENTRY (not used by a stage)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    const remove = screen.getByRole('button', { name: 'Remove transition set' });
    expect(remove).toBeEnabled();
    await user.click(remove);
    expect(screen.queryByRole('group', { name: 'FROM_DATA_ENTRY (not used by a stage)' })).not.toBeInTheDocument();
    expect(screen.getByText('Detached FROM_DATA_ENTRY to FROM_MAIL_INTAKE')).toBeInTheDocument();
  });

  it('shows an empty canvas call-to-action when there are no stages', async () => {
    const user = userEvent.setup();
    function EmptyHarness() {
      const [workflow, setWorkflow] = useState({
        ...demoDesignerWorkflow,
        initialStageKey: '',
        stages: [],
        transitionSets: []
      });
      return <WorkflowDesigner workflow={workflow} catalog={demoCatalog} onChange={setWorkflow} />;
    }
    render(<EmptyHarness />);
    expect(screen.getByText('Build the path officers follow')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Workflow tools' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add stage' }));
    expect(screen.getByRole('button', { name: 'Stage New stage' })).toBeInTheDocument();
    expect(screen.queryByText('Build the path officers follow')).not.toBeInTheDocument();
  });

  it('shows queue and action meta on stage cards plus canvas zoom controls', () => {
    render(<Harness />);
    expect(screen.getByText(/Queue DATA_ENTRY/)).toBeInTheDocument();
    expect(screen.getByText(/1 action/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Canvas view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '100%' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Identity' })).toHaveAttribute('aria-selected', 'true');
  });
});
