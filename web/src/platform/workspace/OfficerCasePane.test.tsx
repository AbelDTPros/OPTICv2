import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { StageFormDefinition, WorkflowDefinition } from '../../../../src/modules/configuration/domain/types.js';
import { demoDesignerForm, demoDesignerWorkflow } from '../designers/demo-draft.js';
import type { WorkflowSummary } from '../designers/workflow-api.js';
import { OfficerCasePane } from './OfficerCasePane.js';

const mailForm: StageFormDefinition = {
  ...demoDesignerForm,
  formKey: 'MAIL_DOC_PREP',
  dataPath: '$',
  title: 'Doc Prep'
};

const mailWorkflow: WorkflowDefinition = {
  initialStageKey: 'DOC_PREP',
  terminalStageKeys: ['COMPLETED'],
  stages: [
    {
      stageKey: 'DOC_PREP',
      displayName: 'Doc Prep',
      order: 10,
      formKey: 'MAIL_DOC_PREP',
      actionKeys: ['COMPLETE_DOC_PREP'],
      assignmentPolicy: { required: true, clearOnTransition: true }
    },
    {
      stageKey: 'COMPLETED',
      displayName: 'Completed',
      order: 999,
      terminal: true,
      actionKeys: [],
      assignmentPolicy: { required: false, clearOnTransition: false }
    }
  ],
  transitionSets: []
};

function workloadSummary(): WorkflowSummary {
  return {
    trackingId: 'WL-1',
    entityType: 'WORKLOAD',
    workflowInstanceId: 2,
    status: 'ACTIVE',
    definition: { definitionKey: 'I_407_WORKLOAD', version: '0.1.0', releaseId: '2' },
    workflow: {
      currentStageKey: 'READY_FOR_DATA_ENTRY',
      currentStageLabel: 'Ready for Data Entry',
      enteredStageAt: '2026-09-04T00:00:00.000Z',
      assignedTo: 'officer@example.gov',
      rowVersion: 1,
      openVisitNumber: 1
    },
    businessData: { dataEntryDetails: { receiptNumber: 'WL-RECEIPT' } },
    allowedActions: [{ actionKey: 'COMPLETE', label: 'Complete' }],
    stageForm: {
      formKey: demoDesignerForm.formKey,
      title: demoDesignerForm.title,
      dataPath: demoDesignerForm.dataPath,
      schema: {},
      ui: demoDesignerForm
    },
    visits: [
      {
        stageKey: 'READY_FOR_DATA_ENTRY',
        visitNumber: 1,
        enteredAt: '2026-09-04T00:00:00.000Z',
        completedAt: null,
        nextStageKey: null
      }
    ],
    forms: { [demoDesignerForm.formKey]: demoDesignerForm },
    workflowDefinition: demoDesignerWorkflow,
    packet: {
      parent: {
        trackingId: 'MAIL-ENVELOPE',
        entityType: 'MAIL',
        workflowInstanceId: 1,
        status: 'COMPLETED',
        definition: { definitionKey: 'I_407_MAILITEM', version: '0.1.0', releaseId: '1' },
        workflow: {
          currentStageKey: 'COMPLETED',
          currentStageLabel: 'Completed',
          enteredStageAt: '2026-09-04T00:00:00.000Z',
          assignedTo: null,
          rowVersion: 2,
          openVisitNumber: 1
        },
        businessData: { receiptNumber: 'MAIL-RECEIPT', ANumber: 'A123456789' },
        allowedActions: [],
        stageForm: null,
        visits: [
          {
            stageKey: 'DOC_PREP',
            visitNumber: 1,
            enteredAt: '2026-09-03T00:00:00.000Z',
            completedAt: '2026-09-03T01:00:00.000Z',
            nextStageKey: 'COMPLETED'
          },
          {
            stageKey: 'COMPLETED',
            visitNumber: 1,
            enteredAt: '2026-09-03T01:00:00.000Z',
            completedAt: null,
            nextStageKey: null
          }
        ],
        forms: { MAIL_DOC_PREP: mailForm },
        workflowDefinition: mailWorkflow
      }
    }
  };
}

describe('OfficerCasePane', () => {
  it('shows a stage history timeline with officer and jump to earlier screen', async () => {
    const user = userEvent.setup();
    const working = workloadSummary();
    working.visits = [
      {
        stageKey: 'READY_FOR_SCANNING',
        visitNumber: 1,
        enteredAt: '2026-09-04T00:00:00.000Z',
        completedAt: '2026-09-04T01:00:00.000Z',
        nextStageKey: 'READY_FOR_DATA_ENTRY',
        enteredBy: 'system',
        assignedTo: 'scanner@example.gov',
        completedBy: 'scanner@example.gov'
      },
      {
        stageKey: 'READY_FOR_DATA_ENTRY',
        visitNumber: 1,
        enteredAt: '2026-09-04T01:00:00.000Z',
        completedAt: null,
        nextStageKey: null,
        enteredBy: 'scanner@example.gov',
        assignedTo: 'officer@example.gov',
        completedBy: null
      }
    ];
    render(
      <OfficerCasePane working={working} busy={false} onComplete={vi.fn()} onRelease={vi.fn()} onClose={vi.fn()} />
    );
    await user.click(screen.getByText(/Stage history \(2\)/));
    const history = screen.getByText(/Stage history \(2\)/).closest('details');
    expect(history).toBeTruthy();
    expect(history).toHaveTextContent(/Ready for Scanning/i);
    expect(history).toHaveTextContent('scanner@example.gov');
    expect(history).toHaveTextContent(/Moved to Ready for Data Entry/i);
    expect(history).toHaveTextContent('officer@example.gov');
    expect(history).toHaveTextContent('Current');
    const jump = within(history as HTMLElement).getByRole('button', {
      name: /Ready For Scanning/i
    });
    await user.click(jump);
    const stageTabs = screen.getByRole('navigation', { name: 'Stage screens' });
    expect(
      within(stageTabs).getByRole('button', { name: /READY_FOR_SCANNING|Ready For Scanning/i })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows parent mail screens on a workload so the officer can see the envelope', async () => {
    const user = userEvent.setup();
    render(
      <OfficerCasePane
        working={workloadSummary()}
        busy={false}
        onComplete={vi.fn()}
        onRelease={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole('heading', { name: 'Ready for Data Entry' })).toBeInTheDocument();
    expect(document.querySelector('.optic-case-tracking')).toHaveTextContent('WL-1');
    expect(screen.getByRole('status', { name: 'Case status' })).toHaveTextContent('ACTIVE');
    expect(screen.getByText('This case')).toBeInTheDocument();
    expect(screen.getByText(/Linked mail item/i)).toBeInTheDocument();
    expect(screen.getAllByText('MAIL-ENVELOPE').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Copy tracking id MAIL-ENVELOPE' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('navigation', { name: 'Mail item screens' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Doc Prep' }));
    expect(screen.getByText(/from mail item/i)).toBeInTheDocument();
    expect(screen.getAllByText('MAIL-ENVELOPE').length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue('MAIL-RECEIPT')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Release' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Print labels' })).toBeInTheDocument();
    expect(screen.getByText('Labels')).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Case actions' })).toBeInTheDocument();
  });

  it('shows Release on the form even when assigned to someone else', () => {
    const working = workloadSummary();
    working.workflow.assignedTo = 'Jordan Lee';
    render(
      <OfficerCasePane working={working} busy={false} onComplete={vi.fn()} onRelease={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: 'Release' })).toBeEnabled();
  });

  it('shows a disabled Release when the open case is unassigned', () => {
    const working = workloadSummary();
    working.workflow.assignedTo = null;
    render(
      <OfficerCasePane working={working} busy={false} onComplete={vi.fn()} onRelease={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: 'Release' })).toBeDisabled();
  });

  it('highlights whether the open case is assigned or unassigned', () => {
    const assigned = workloadSummary();
    assigned.workflow.assignedTo = 'officer@example.gov';
    const { rerender } = render(
      <OfficerCasePane working={assigned} busy={false} onComplete={vi.fn()} onRelease={vi.fn()} onClose={vi.fn()} />
    );
    const banner = screen.getByRole('status', { name: 'Case status' });
    expect(banner).toHaveClass('is-assigned');
    expect(banner).toHaveTextContent('Assigned to');
    expect(banner).toHaveTextContent('officer@example.gov');

    const open = workloadSummary();
    open.workflow.assignedTo = null;
    rerender(
      <OfficerCasePane working={open} busy={false} onComplete={vi.fn()} onRelease={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByRole('status', { name: 'Case status' })).toHaveClass('is-unassigned');
    expect(screen.getByRole('status', { name: 'Case status' })).toHaveTextContent('Unassigned');
  });

  it('puts assignment actions above the form in Assign, Release, Reassign order', () => {
    const working = workloadSummary();
    working.workflow.assignedTo = null;
    working.assignmentPermissions = { allowAssign: true, allowReassign: true, allowRelease: true };
    render(
      <OfficerCasePane
        working={working}
        busy={false}
        onComplete={vi.fn()}
        onAssign={vi.fn()}
        onReassign={vi.fn()}
        onRelease={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const assignment = screen.getByRole('group', { name: 'Assignment' });
    const labels = within(assignment)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    expect(labels).toEqual(['Assign to me', 'Release', 'Reassign']);
    expect(assignment.compareDocumentPosition(screen.getByText('This case'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('lets the officer assign an unassigned open case to themselves', async () => {
    const user = userEvent.setup();
    const onAssign = vi.fn();
    const working = workloadSummary();
    working.workflow.assignedTo = null;
    render(
      <OfficerCasePane
        working={working}
        busy={false}
        onComplete={vi.fn()}
        onAssign={onAssign}
        onRelease={vi.fn()}
        onClose={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Assign to me' }));
    expect(onAssign).toHaveBeenCalled();
  });

  it('disables Assign to me when the open case is already assigned', () => {
    render(
      <OfficerCasePane
        working={workloadSummary()}
        busy={false}
        onComplete={vi.fn()}
        onAssign={vi.fn()}
        onRelease={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Assign to me' })).toBeDisabled();
  });

  it('hides Assign to me when the stage does not allow it', () => {
    const working = workloadSummary();
    working.workflow.assignedTo = null;
    working.assignmentPermissions = { allowAssign: false, allowReassign: true, allowRelease: true };
    render(
      <OfficerCasePane
        working={working}
        busy={false}
        onComplete={vi.fn()}
        onAssign={vi.fn()}
        onReassign={vi.fn()}
        onRelease={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Assign to me' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reassign' })).toBeEnabled();
  });

  it('asks who should receive the open case before reassigning', async () => {
    const user = userEvent.setup();
    const onReassign = vi.fn();
    render(
      <OfficerCasePane
        working={workloadSummary()}
        busy={false}
        onComplete={vi.fn()}
        onReassign={onReassign}
        onRelease={vi.fn()}
        onClose={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Reassign' }));
    const dialog = screen.getByRole('dialog', { name: 'Reassign WL-1' });
    await user.type(within(dialog).getByLabelText('Reassign to'), 'Jordan Lee');
    await user.click(within(dialog).getByRole('button', { name: 'Reassign' }));
    expect(onReassign).toHaveBeenCalledWith('Jordan Lee');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('hides Reassign when the stage does not allow it', () => {
    const working = workloadSummary();
    working.assignmentPermissions = { allowAssign: true, allowReassign: false, allowRelease: true };
    render(
      <OfficerCasePane
        working={working}
        busy={false}
        onComplete={vi.fn()}
        onAssign={vi.fn()}
        onReassign={vi.fn()}
        onRelease={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Reassign' })).not.toBeInTheDocument();
  });

  it('hides Release when the stage does not allow it', () => {
    const working = workloadSummary();
    working.assignmentPermissions = { allowAssign: true, allowReassign: true, allowRelease: false };
    render(
      <OfficerCasePane working={working} busy={false} onComplete={vi.fn()} onRelease={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.queryByRole('button', { name: 'Release' })).not.toBeInTheDocument();
  });

  it('orders this-case tabs by visit sequence and selects the last stage on a completed case', () => {
    const working = workloadSummary();
    delete working.packet;
    working.status = 'COMPLETED';
    working.stageForm = null;
    working.allowedActions = [];
    working.workflow.currentStageKey = 'COMPLETED';
    working.workflow.currentStageLabel = 'Completed';
    working.workflowDefinition = {
      ...demoDesignerWorkflow,
      stages: [
        {
          stageKey: 'READY_FOR_DATA_ENTRY',
          displayName: 'Ready for Data Entry',
          order: 10,
          formKey: demoDesignerForm.formKey,
          actionKeys: [],
          assignmentPolicy: { required: false, clearOnTransition: true }
        },
        {
          stageKey: 'REVIEW',
          displayName: 'Review',
          order: 20,
          formKey: 'REVIEW_FORM',
          actionKeys: [],
          assignmentPolicy: { required: false, clearOnTransition: true }
        },
        {
          stageKey: 'COMPLETED',
          displayName: 'Completed',
          order: 999,
          terminal: true,
          actionKeys: [],
          assignmentPolicy: { required: false, clearOnTransition: false }
        }
      ]
    };
    working.forms = {
      [demoDesignerForm.formKey]: demoDesignerForm,
      REVIEW_FORM: { ...demoDesignerForm, formKey: 'REVIEW_FORM', title: 'Review' }
    };
    working.visits = [
      {
        stageKey: 'COMPLETED',
        visitNumber: 1,
        enteredAt: '2026-09-04T02:00:00.000Z',
        completedAt: null,
        nextStageKey: null
      },
      {
        stageKey: 'REVIEW',
        visitNumber: 1,
        enteredAt: '2026-09-04T01:00:00.000Z',
        completedAt: '2026-09-04T02:00:00.000Z',
        nextStageKey: 'COMPLETED'
      },
      {
        stageKey: 'READY_FOR_DATA_ENTRY',
        visitNumber: 1,
        enteredAt: '2026-09-04T00:00:00.000Z',
        completedAt: '2026-09-04T01:00:00.000Z',
        nextStageKey: 'REVIEW'
      }
    ];

    render(
      <OfficerCasePane working={working} busy={false} onComplete={vi.fn()} onRelease={vi.fn()} onClose={vi.fn()} />
    );

    const tabs = screen.getByRole('navigation', { name: 'Stage screens' });
    const buttons = within(tabs).getAllByRole('button');
    expect(buttons[0]).toHaveAccessibleName('Ready for Data Entry');
    expect(buttons[1]).toHaveAccessibleName('Review');
    expect(buttons[2]).toHaveAccessibleName('Completed');
    expect(buttons[2]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[2]).toHaveFocus();
    expect(screen.getByText(/no form/i)).toBeInTheDocument();
  });

  it('stamps Fill from Assigned officer into Complete', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const working = workloadSummary();
    const form: StageFormDefinition = {
      ...demoDesignerForm,
      sections: [
        {
          sectionKey: 'TRACKING',
          title: 'Tracking',
          fields: [
            {
              fieldKey: 'DATA_KEYER_NAME',
              path: '$.dataKeyerName',
              component: 'READ_ONLY_VALUE',
              label: 'Data Keyer Name',
              fillFrom: 'ASSIGNED_TO'
            }
          ]
        }
      ]
    };
    working.stageForm = {
      formKey: form.formKey,
      title: form.title,
      dataPath: form.dataPath,
      schema: {},
      ui: form
    };
    working.businessData = { dataEntryDetails: {} };
    render(
      <OfficerCasePane working={working} busy={false} onComplete={onComplete} onRelease={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByText('Data Keyer Name')).toBeInTheDocument();
    expect(screen.getAllByText('officer@example.gov').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Complete' }));
    expect(onComplete).toHaveBeenCalledWith('COMPLETE', {
      dataEntryDetails: { dataKeyerName: 'officer@example.gov' }
    });
  });

  it('explains when a workload has no mail packet', () => {
    const working = workloadSummary();
    delete working.packet;
    render(
      <OfficerCasePane working={working} busy={false} onComplete={vi.fn()} onRelease={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByText(/not linked to a mail item/i)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Mail item screens' })).not.toBeInTheDocument();
  });

  it('shows saved scanning fields when opening an earlier stage that uses shared workload paths', async () => {
    const user = userEvent.setup();
    const scanningForm: StageFormDefinition = {
      formKey: 'I936_SCANNING_DETAILS',
      dataPath: '$.scanningDetails',
      title: 'Scanning',
      sections: [
        {
          sectionKey: 'TRACKING',
          title: 'Tracking',
          fields: [
            {
              fieldKey: 'WORKLOAD_STATUS',
              path: '$.workload.workloadStatus',
              component: 'SELECT',
              label: 'Workload Status',
              options: [
                { label: 'Accepted', value: 'Accepted' },
                { label: 'Rejected', value: 'Rejected' }
              ]
            },
            {
              fieldKey: 'APPLICANT_FIRST_NAME',
              path: '$.applicantFirstName',
              component: 'TEXT_INPUT',
              label: 'Applicant First Name'
            }
          ]
        }
      ]
    };
    const working = workloadSummary();
    delete working.packet;
    working.businessData = {
      workload: { workloadStatus: 'Accepted' },
      scanningDetails: { applicantFirstName: 'John' },
      dataEntryDetails: { receiptNumber: 'WL-RECEIPT' }
    };
    working.forms = {
      I936_SCANNING_DETAILS: scanningForm,
      [demoDesignerForm.formKey]: demoDesignerForm
    };
    working.workflowDefinition = {
      ...demoDesignerWorkflow,
      stages: [
        {
          stageKey: 'READY_FOR_SCANNING',
          displayName: 'Ready for Scanning',
          order: 10,
          formKey: 'I936_SCANNING_DETAILS',
          actionKeys: ['COMPLETE'],
          assignmentPolicy: { required: true, clearOnTransition: true }
        },
        {
          stageKey: 'READY_FOR_DATA_ENTRY',
          displayName: 'Ready for Data Entry',
          order: 20,
          formKey: demoDesignerForm.formKey,
          actionKeys: ['COMPLETE'],
          assignmentPolicy: { required: true, clearOnTransition: true }
        }
      ]
    };
    working.visits = [
      {
        stageKey: 'READY_FOR_SCANNING',
        visitNumber: 1,
        enteredAt: '2026-09-04T00:00:00.000Z',
        completedAt: '2026-09-04T01:00:00.000Z',
        nextStageKey: 'READY_FOR_DATA_ENTRY'
      },
      {
        stageKey: 'READY_FOR_DATA_ENTRY',
        visitNumber: 1,
        enteredAt: '2026-09-04T01:00:00.000Z',
        completedAt: null,
        nextStageKey: null
      }
    ];
    render(
      <OfficerCasePane working={working} busy={false} onComplete={vi.fn()} onRelease={vi.fn()} onClose={vi.fn()} />
    );
    await user.click(screen.getByRole('button', { name: 'Ready for Scanning' }));
    expect(screen.getByText(/using the data stored on this case/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('John')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Accepted')).toBeInTheDocument();
  });
});
