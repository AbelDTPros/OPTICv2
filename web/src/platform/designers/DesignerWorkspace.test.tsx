import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import * as configApi from './config-api.js';
import { DesignerWorkspace } from './DesignerWorkspace.js';
import {
  demoDesignerAction,
  demoDesignerForm,
  demoDesignerQueue,
  demoDesignerWorkflow
} from './demo-draft.js';
import * as workflowApi from './workflow-api.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DesignerWorkspace', () => {
  it('has no automated accessibility violations on definition authoring surfaces', async () => {
    const user = userEvent.setup();
    const { container } = render(<DesignerWorkspace />);
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Schema' }));
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Workflow' }));
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Catalog' }));
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Try' }));
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Lifecycle' }));
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Simulate' }));
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Diff' }));
    expect(await axe(container)).toHaveNoViolations();
  }, 15_000);

  it('opens the designer user guide', async () => {
    const user = userEvent.setup();
    render(<DesignerWorkspace />);
    await user.click(screen.getByRole('button', { name: 'User guide' }));
    expect(screen.getByRole('dialog', { name: 'Designer user guide' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Designer user guide', level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close user guide' }));
    expect(screen.queryByRole('dialog', { name: 'Designer user guide' })).not.toBeInTheDocument();
  });

  it('opens simulate and diff tabs and exposes clone and form picker controls', async () => {
    const user = userEvent.setup();
    render(<DesignerWorkspace />);
    expect(screen.getByLabelText('Clone from')).toHaveTextContent('None — blank draft');
    expect(screen.getByLabelText('Entity type')).toHaveValue('WORKLOAD');
    expect(screen.getByLabelText('Form')).toHaveValue('I90_DATA_ENTRY');
    await user.click(screen.getByRole('button', { name: 'Schema' }));
    expect(screen.getByRole('heading', { name: 'Release schema' })).toBeInTheDocument();
    expect(screen.getByText('No form schema yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Form' }));
    await user.click(screen.getByRole('button', { name: 'Form schema' }));
    await user.click(screen.getByRole('button', { name: 'Generate schema' }));
    await user.click(screen.getByRole('button', { name: 'Schema' }));
    expect((screen.getByLabelText('Merged JSON Schema') as HTMLTextAreaElement).value).toContain(
      '"dataEntryDetails"'
    );
    await user.click(screen.getByRole('button', { name: 'Simulate' }));
    expect(screen.getByRole('heading', { name: 'Transition simulation' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Diff' }));
    expect(screen.getByRole('heading', { name: 'Compare versions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compare versions' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Catalog' }));
    expect(screen.getByRole('heading', { name: 'Catalog designer' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try' }));
    expect(screen.getByRole('heading', { name: 'Try as officer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New work arrives' })).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'Ready for Data Entry' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /Ready for Data Entry queue/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Assigned to Me/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /All Items/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Completed/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lifecycle' }));
    expect(screen.getByRole('heading', { name: 'Release lifecycle' })).toBeInTheDocument();
    expect(screen.getByLabelText('Actor id')).toHaveValue('author@example.gov');
    expect(screen.getByRole('button', { name: 'Validate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  it('opens a release from the Open definition picker', async () => {
    const user = userEvent.setup();
    vi.spyOn(configApi, 'listReleaseCatalog').mockResolvedValue([
      { definitionKey: 'I_407', displayName: 'I-407', version: '0.1.0', lifecycleStatus: 'DRAFT' },
      {
        definitionKey: 'I_936',
        displayName: 'I-936',
        version: '1.0.0',
        lifecycleStatus: 'PUBLISHED',
        active: true
      },
      { definitionKey: 'I_936', displayName: 'I-936', version: '0.2.0', lifecycleStatus: 'DRAFT' }
    ]);
    vi.spyOn(configApi, 'getRelease').mockResolvedValue({
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD',
      version: '0.1.0',
      lifecycleStatus: 'DRAFT',
      rowVersion: 3,
      workflow: demoDesignerWorkflow,
      forms: { [demoDesignerForm.formKey]: demoDesignerForm }
    });

    render(<DesignerWorkspace />);
    await user.click(screen.getByRole('button', { name: 'Open definition' }));
    expect(await screen.findByRole('dialog', { name: 'Open definition' })).toBeInTheDocument();
    expect(screen.getByText('I_936')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /I-936 0\.2\.0/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /I-936 1\.0\.0/ })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Search releases'), '407');
    expect(screen.queryByRole('button', { name: /I-936/ })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Show'), 'PUBLISHED');
    expect(screen.getByText('No releases match this search or filter.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search releases'));
    await user.selectOptions(screen.getByLabelText('Show'), 'ALL');
    await user.click(screen.getByRole('button', { name: /I-407/ }));
    expect(configApi.getRelease).toHaveBeenCalledWith('I_407', '0.1.0');
    expect(await screen.findByText(/I_407 0.1.0 is DRAFT/)).toBeInTheDocument();
    expect(screen.getByLabelText('Entity type')).toHaveValue('WORKLOAD');
    expect(screen.queryByRole('dialog', { name: 'Open definition' })).not.toBeInTheDocument();
  });

  it('selects the earliest workflow-linked form when opening a release', async () => {
    const user = userEvent.setup();
    const scanning = {
      ...demoDesignerForm,
      formKey: 'I936_SCANNING',
      title: 'Scanning'
    };
    const dataEntry = {
      ...demoDesignerForm,
      formKey: 'I936_DATA_ENTRY',
      title: 'Data Entry'
    };
    vi.spyOn(configApi, 'listReleaseCatalog').mockResolvedValue([
      { definitionKey: 'I_936', displayName: 'I-936', version: '0.1.0', lifecycleStatus: 'DRAFT' }
    ]);
    vi.spyOn(configApi, 'getRelease').mockResolvedValue({
      definitionKey: 'I_936',
      displayName: 'I-936',
      entityType: 'WORKLOAD',
      version: '0.1.0',
      lifecycleStatus: 'DRAFT',
      rowVersion: 1,
      workflow: {
        ...demoDesignerWorkflow,
        stages: [
          {
            ...demoDesignerWorkflow.stages[0]!,
            stageKey: 'READY_FOR_SCANNING',
            displayName: 'Ready for Scanning',
            order: 5,
            formKey: 'I936_SCANNING'
          },
          {
            ...demoDesignerWorkflow.stages[0]!,
            stageKey: 'READY_FOR_DATA_ENTRY',
            displayName: 'Ready for Data Entry',
            order: 10,
            formKey: 'I936_DATA_ENTRY'
          },
          demoDesignerWorkflow.stages[1]!
        ]
      },
      // Intentionally reverse object order so Object.keys would prefer DATA_ENTRY.
      forms: {
        I936_DATA_ENTRY: dataEntry,
        I936_SCANNING: scanning
      }
    });

    render(<DesignerWorkspace />);
    expect(screen.getByLabelText('Form')).toHaveValue('I90_DATA_ENTRY');
    await user.click(screen.getByRole('button', { name: 'Open definition' }));
    await user.click(screen.getByRole('button', { name: /I-936/ }));
    expect(await screen.findByText(/I_936 0.1.0 is DRAFT/)).toBeInTheDocument();
    expect(screen.getByLabelText('Form')).toHaveValue('I936_SCANNING');
  });

  it('opens the officer workspace from Try and lets the officer pick a queue item', async () => {
    const user = userEvent.setup();
    const created = {
      trackingId: 'TRIAL-I_407-1',
      entityType: 'WORKLOAD' as const,
      workflowInstanceId: 9,
      status: 'ACTIVE',
      definition: { definitionKey: 'I_407', version: '0.1.0', releaseId: '9' },
      workflow: {
        currentStageKey: 'READY_FOR_DATA_ENTRY',
        currentStageLabel: 'Ready for Data Entry',
        enteredStageAt: '2026-09-03T00:00:00.000Z',
        assignedTo: null as string | null,
        rowVersion: 0,
        openVisitNumber: 1
      },
      businessData: {},
      allowedActions: [
        { actionKey: 'COMPLETE', label: 'Complete' },
        { actionKey: 'RELEASE_ASSIGNMENT', label: 'Release' }
      ],
      stageForm: {
        formKey: demoDesignerForm.formKey,
        title: demoDesignerForm.title,
        dataPath: demoDesignerForm.dataPath,
        schema: { type: 'object', properties: {} },
        ui: demoDesignerForm
      },
      visits: [
        {
          stageKey: 'READY_FOR_DATA_ENTRY',
          visitNumber: 1,
          enteredAt: '2026-09-03T00:00:00.000Z',
          completedAt: null,
          nextStageKey: null
        }
      ]
    };
    let listed: workflowApi.WorkflowInstanceList = {
      definitionKey: 'I_407',
      version: '0.1.0',
      releaseId: '9',
      items: []
    };
    vi.spyOn(configApi, 'listReleaseCatalog').mockResolvedValue([
      { definitionKey: 'I_407', displayName: 'I-407', version: '0.1.0', lifecycleStatus: 'DRAFT' }
    ]);
    vi.spyOn(configApi, 'getRelease').mockResolvedValue({
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD',
      version: '0.1.0',
      lifecycleStatus: 'DRAFT',
      rowVersion: 3,
      workflow: demoDesignerWorkflow,
      forms: { [demoDesignerForm.formKey]: demoDesignerForm },
      actions: { [demoDesignerAction.actionKey]: demoDesignerAction },
      queues: { [demoDesignerQueue.queueKey]: demoDesignerQueue }
    });
    vi.spyOn(workflowApi, 'listWorkflowInstances').mockImplementation(async () => listed);
    vi.spyOn(workflowApi, 'createWorkflowInstance').mockImplementation(async (body) => {
      listed = {
        definitionKey: 'I_407',
        version: '0.1.0',
        releaseId: '9',
        items: [
          {
            trackingId: body.entityTrackingId,
            entityType: body.entityType,
            workflowInstanceId: 9,
            status: 'ACTIVE',
            currentStageKey: 'READY_FOR_DATA_ENTRY',
            currentStageLabel: 'Ready for Data Entry',
            assignedTo: null,
            enteredStageAt: '2026-09-03T00:00:00.000Z',
            rowVersion: 0,
            businessData: {}
          }
        ]
      };
      return { ...created, trackingId: body.entityTrackingId };
    });
    vi.spyOn(workflowApi, 'assignWorkflow').mockImplementation(async (_entityType, trackingId) => ({
      ...created,
      trackingId,
      workflow: { ...created.workflow, assignedTo: 'officer@example.gov', rowVersion: 1 }
    }));

    render(<DesignerWorkspace />);
    await user.click(screen.getByRole('button', { name: 'Open definition' }));
    await user.click(await screen.findByRole('button', { name: /I-407/ }));
    await user.click(screen.getByRole('button', { name: 'Try' }));
    expect(await screen.findByRole('heading', { name: 'Ready for Data Entry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Assigned to Me/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /All Items/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Completed/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign to me' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Tracking ID')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New work arrives' }));
    expect(workflowApi.createWorkflowInstance).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Ready for Data Entry' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Case status' })).toHaveTextContent('DRAFT');
    expect(screen.getByRole('button', { name: 'Assign to me' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Assign to me' }));
    expect(workflowApi.createWorkflowInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'WORKLOAD',
        definitionKey: 'I_407',
        version: '0.1.0',
        entityTrackingId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        )
      })
    );
    expect(workflowApi.assignWorkflow).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Complete' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Release' })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Data Entry' })).toBeInTheDocument();
  });

  it('releases a completed assigned workload from Assigned to Me', async () => {
    const user = userEvent.setup();
    let listed: workflowApi.WorkflowInstanceList = {
      definitionKey: 'I_407',
      version: '0.1.0',
      releaseId: '9',
      items: [
        {
          trackingId: 'TRIAL-DONE-1',
          entityType: 'WORKLOAD',
          workflowInstanceId: 11,
          status: 'COMPLETED',
          currentStageKey: 'COMPLETED',
          currentStageLabel: 'Completed',
          assignedTo: 'officer@example.gov',
          enteredStageAt: '2026-09-03T00:00:00.000Z',
          rowVersion: 4,
          businessData: {}
        }
      ]
    };
    vi.spyOn(configApi, 'listReleaseCatalog').mockResolvedValue([
      { definitionKey: 'I_407', displayName: 'I-407', version: '0.1.0', lifecycleStatus: 'DRAFT' }
    ]);
    vi.spyOn(configApi, 'getRelease').mockResolvedValue({
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD',
      version: '0.1.0',
      lifecycleStatus: 'DRAFT',
      rowVersion: 3,
      workflow: demoDesignerWorkflow,
      forms: { [demoDesignerForm.formKey]: demoDesignerForm }
    });
    vi.spyOn(workflowApi, 'listWorkflowInstances').mockImplementation(async () => listed);
    vi.spyOn(workflowApi, 'releaseWorkflow').mockImplementation(async () => {
      listed = {
        ...listed,
        items: [{ ...listed.items[0]!, assignedTo: null, rowVersion: 5 }]
      };
      return {
        trackingId: 'TRIAL-DONE-1',
        entityType: 'WORKLOAD',
        workflowInstanceId: 11,
        status: 'COMPLETED',
        definition: { definitionKey: 'I_407', version: '0.1.0', releaseId: '9' },
        workflow: {
          currentStageKey: 'COMPLETED',
          currentStageLabel: 'Completed',
          enteredStageAt: '2026-09-03T00:00:00.000Z',
          assignedTo: null,
          rowVersion: 5,
          openVisitNumber: null
        },
        businessData: {},
        allowedActions: [],
        stageForm: null,
        visits: []
      };
    });

    render(<DesignerWorkspace />);
    await user.click(screen.getByRole('button', { name: 'Open definition' }));
    await user.click(await screen.findByRole('button', { name: /I-407/ }));
    await user.click(screen.getByRole('button', { name: 'Try' }));
    await user.click(await screen.findByRole('button', { name: /Assigned to Me/ }));
    expect(screen.getByText('TRIAL-DONE-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign to me' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reassign TRIAL-DONE-1' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Release' }));
    expect(workflowApi.releaseWorkflow).toHaveBeenCalledWith('WORKLOAD', 'TRIAL-DONE-1', 4);
    expect(await screen.findByRole('heading', { name: 'Assigned to Me' })).toBeInTheDocument();
    expect(screen.queryByText('TRIAL-DONE-1')).not.toBeInTheDocument();
  });

  it('opens a completed case from Completed as a read-only earlier screen', async () => {
    const user = userEvent.setup();
    vi.spyOn(configApi, 'listReleaseCatalog').mockResolvedValue([
      { definitionKey: 'I_407', displayName: 'I-407', version: '0.1.0', lifecycleStatus: 'DRAFT' }
    ]);
    vi.spyOn(configApi, 'getRelease').mockResolvedValue({
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD',
      version: '0.1.0',
      lifecycleStatus: 'DRAFT',
      rowVersion: 3,
      workflow: demoDesignerWorkflow,
      forms: { [demoDesignerForm.formKey]: demoDesignerForm }
    });
    vi.spyOn(workflowApi, 'listWorkflowInstances').mockResolvedValue({
      definitionKey: 'I_407',
      version: '0.1.0',
      releaseId: '9',
      items: [
        {
          trackingId: 'DONE-1',
          entityType: 'WORKLOAD',
          workflowInstanceId: 12,
          status: 'COMPLETED',
          currentStageKey: 'COMPLETED',
          currentStageLabel: 'Completed',
          assignedTo: null,
          enteredStageAt: '2026-09-03T00:00:00.000Z',
          rowVersion: 4,
          businessData: { dataEntryDetails: { ANumber: 'A123456789' } }
        }
      ]
    });
    vi.spyOn(workflowApi, 'getWorkflowSummary').mockResolvedValue({
      trackingId: 'DONE-1',
      entityType: 'WORKLOAD',
      workflowInstanceId: 12,
      status: 'COMPLETED',
      definition: { definitionKey: 'I_407', version: '0.1.0', releaseId: '9' },
      workflow: {
        currentStageKey: 'COMPLETED',
        currentStageLabel: 'Completed',
        enteredStageAt: '2026-09-03T00:00:00.000Z',
        assignedTo: null,
        rowVersion: 4,
        openVisitNumber: null
      },
      businessData: { dataEntryDetails: { ANumber: 'A123456789' } },
      allowedActions: [],
      stageForm: null,
      visits: [
        {
          stageKey: 'READY_FOR_DATA_ENTRY',
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
      ]
    });

    render(<DesignerWorkspace />);
    await user.click(screen.getByRole('button', { name: 'Open definition' }));
    await user.click(await screen.findByRole('button', { name: /I-407/ }));
    await user.click(screen.getByRole('button', { name: 'Try' }));
    await user.click(await screen.findByRole('button', { name: /^Completed/ }));
    expect(screen.getByRole('heading', { name: 'Completed' })).toBeInTheDocument();
    expect(screen.getByText('DONE-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign to me' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reassign DONE-1' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open DONE-1' }));
    expect(await screen.findByText(/terminal stage/)).toBeInTheDocument();
    const stageTabs = screen.getByRole('navigation', { name: 'Stage screens' });
    const lastStage = within(stageTabs).getByRole('button', { name: 'Completed' });
    expect(within(stageTabs).getByRole('button', { name: 'Ready for Data Entry' })).toBeInTheDocument();
    expect(lastStage).toHaveAttribute('aria-pressed', 'true');
    expect(lastStage).toHaveFocus();
    await user.click(within(stageTabs).getByRole('button', { name: 'Ready for Data Entry' }));
    expect(await screen.findByRole('heading', { name: 'Data Entry' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument();
  });

  it('lists the opened mail release transition sets on Simulate, not the unsaved I-90 demo keys', async () => {
    const user = userEvent.setup();
    const mailWorkflow = {
      initialStageKey: 'MAIL_INTAKE',
      terminalStageKeys: ['COMPLETED'],
      stages: [
        {
          stageKey: 'MAIL_INTAKE',
          displayName: 'Mail intake',
          order: 10,
          actionKeys: ['COMPLETE'],
          transitionSetKey: 'FROM_MAIL_INTAKE',
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
      ],
      transitionSets: [
        {
          transitionSetKey: 'FROM_MAIL_INTAKE',
          evaluationMode: 'FIRST_MATCH' as const,
          rules: [],
          defaultTargetStageKey: 'COMPLETED'
        }
      ]
    };
    vi.spyOn(configApi, 'listReleaseCatalog').mockResolvedValue([
      { definitionKey: 'MAIL_ITEM', displayName: 'Mail item', version: '0.1.0', lifecycleStatus: 'DRAFT' }
    ]);
    vi.spyOn(configApi, 'getRelease').mockResolvedValue({
      definitionKey: 'MAIL_ITEM',
      displayName: 'Mail item',
      entityType: 'MAIL',
      version: '0.1.0',
      lifecycleStatus: 'DRAFT',
      rowVersion: 2,
      workflow: mailWorkflow,
      forms: { [demoDesignerForm.formKey]: demoDesignerForm },
      actions: { COMPLETE: { actionKey: 'COMPLETE', label: 'Complete', type: 'TRANSITION', transitionSetKey: 'FROM_MAIL_INTAKE' } }
    });

    render(<DesignerWorkspace />);
    await user.click(screen.getByRole('button', { name: 'Open definition' }));
    await user.click(await screen.findByRole('button', { name: /Mail item/ }));
    await user.click(screen.getByRole('button', { name: 'Simulate' }));
    expect(screen.getByLabelText('Transition set')).toHaveValue('FROM_MAIL_INTAKE');
    expect(screen.getByRole('option', { name: 'FROM_MAIL_INTAKE — From Mail intake' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /FROM_DATA_ENTRY/ })).not.toBeInTheDocument();
  });

  it('shows a default-target result when the simulated set has no extra rules', async () => {
    const user = userEvent.setup();
    vi.spyOn(configApi, 'simulateTransition').mockResolvedValue({
      definitionKey: 'I_DESIGN',
      version: '0.1.0',
      transitionSetKey: 'FROM_DATA_ENTRY',
      targetStageKey: 'COMPLETED',
      usedDefault: true,
      trace: []
    });
    render(<DesignerWorkspace />);
    await user.click(screen.getByRole('button', { name: 'Simulate' }));
    await user.click(screen.getByRole('button', { name: 'Run simulation' }));
    expect(await screen.findByRole('heading', { name: 'Result' })).toBeInTheDocument();
    expect(screen.getByText(/Complete would go to/)).toBeInTheDocument();
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
    expect(screen.getByText('This set has no extra rules, so the trace is empty.')).toBeInTheDocument();
  });

  it('creates a new definition draft cloned from a picked release', async () => {
    const user = userEvent.setup();
    vi.spyOn(configApi, 'listReleaseCatalog').mockResolvedValue([
      { definitionKey: 'I_90', displayName: 'I-90', version: '1.0.0', lifecycleStatus: 'PUBLISHED' }
    ]);
    vi.spyOn(configApi, 'createDefinition').mockResolvedValue(undefined);
    vi.spyOn(configApi, 'createDraftRelease').mockResolvedValue({
      definitionKey: 'I_131',
      displayName: 'I-131 Travel',
      entityType: 'WORKLOAD',
      version: '1.0.0',
      lifecycleStatus: 'DRAFT',
      rowVersion: 0,
      workflow: demoDesignerWorkflow,
      forms: { [demoDesignerForm.formKey]: demoDesignerForm }
    });

    render(<DesignerWorkspace />);
    const definitionKey = screen.getByLabelText('Definition key');
    await user.clear(definitionKey);
    await user.type(definitionKey, 'I_131');
    const displayName = screen.getByLabelText('Display name');
    await user.clear(displayName);
    await user.type(displayName, 'I-131 Travel');
    const version = screen.getByLabelText('Version');
    await user.clear(version);
    await user.type(version, '1.0.0');
    await user.click(await screen.findByLabelText('Clone from'));
    expect(await screen.findByRole('dialog', { name: 'Clone from' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /I-90 1\.0\.0/ }));
    expect(screen.queryByRole('dialog', { name: 'Clone from' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(configApi.createDefinition).toHaveBeenCalledWith({
      definitionKey: 'I_131',
      displayName: 'I-131 Travel',
      entityType: 'WORKLOAD'
    });
    expect(configApi.createDraftRelease).toHaveBeenCalledWith('I_131', '1.0.0', {
      definitionKey: 'I_90',
      version: '1.0.0'
    });
    expect(await screen.findByText(/I_131 1.0.0 is DRAFT/)).toBeInTheDocument();
  });

  it('fills Entity type from the clone source definition', async () => {
    const user = userEvent.setup();
    vi.spyOn(configApi, 'listReleaseCatalog').mockResolvedValue([
      {
        definitionKey: 'I_407_MAILITEM',
        displayName: 'I 407 Mail Item',
        entityType: 'MAIL',
        version: '0.1.0',
        lifecycleStatus: 'DRAFT'
      },
      {
        definitionKey: 'I_407_WORKLOAD',
        displayName: 'I 407 Workload',
        entityType: 'WORKLOAD',
        version: '0.1.0',
        lifecycleStatus: 'DRAFT'
      }
    ]);

    render(<DesignerWorkspace />);
    expect(screen.getByLabelText('Entity type')).toHaveValue('WORKLOAD');
    await user.click(await screen.findByLabelText('Clone from'));
    expect(await screen.findByRole('dialog', { name: 'Clone from' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /I 407 Mail Item 0\.1\.0/ }));
    expect(screen.getByLabelText('Entity type')).toHaveValue('MAIL');
    await user.click(screen.getByLabelText('Clone from'));
    await user.click(screen.getByRole('button', { name: /I 407 Workload 0\.1\.0/ }));
    expect(screen.getByLabelText('Entity type')).toHaveValue('WORKLOAD');
    await user.click(screen.getByLabelText('Clone from'));
    await user.click(screen.getByRole('button', { name: /None — blank draft/ }));
    expect(screen.getByLabelText('Entity type')).toHaveValue('WORKLOAD');
  });

  it('deletes an opened DRAFT after confirmation', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(configApi, 'listReleaseCatalog').mockResolvedValue([
      { definitionKey: 'I_407', displayName: 'I-407', version: '0.1.0', lifecycleStatus: 'DRAFT' }
    ]);
    vi.spyOn(configApi, 'getRelease').mockResolvedValue({
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD',
      version: '0.1.0',
      lifecycleStatus: 'DRAFT',
      rowVersion: 3,
      workflow: demoDesignerWorkflow,
      forms: { [demoDesignerForm.formKey]: demoDesignerForm }
    });
    vi.spyOn(configApi, 'deleteDraftRelease').mockResolvedValue({
      definitionKey: 'I_407',
      version: '0.1.0',
      definitionRemoved: true
    });

    render(<DesignerWorkspace />);
    expect(screen.getByRole('button', { name: 'Delete draft' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Open definition' }));
    await user.click(await screen.findByRole('button', { name: /I-407/ }));
    expect(await screen.findByText(/I_407 0.1.0 is DRAFT/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete draft' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Delete draft' }));
    expect(configApi.deleteDraftRelease).toHaveBeenCalledWith('I_407', '0.1.0', 3);
    expect(await screen.findByText(/I_407 was deleted \(no remaining releases\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete draft' })).toBeDisabled();
  });

  it('shows compile validation details when Simulate cannot load the saved release', async () => {
    const user = userEvent.setup();
    vi.spyOn(configApi, 'simulateTransition').mockRejectedValue(
      new configApi.DesignerApiError(
        'Definition release failed stable-key or reference validation.',
        400,
        'OPTIC-CONFIG-40020',
        ['Stage READY_FOR_DATA_ENTRY references missing form I90_DATA_ENTRY.']
      )
    );

    render(<DesignerWorkspace />);
    await user.click(screen.getByRole('button', { name: 'Simulate' }));
    await user.click(screen.getByRole('button', { name: 'Run simulation' }));
    expect(
      await screen.findByText('Definition release failed stable-key or reference validation.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Stage READY_FOR_DATA_ENTRY references missing form I90_DATA_ENTRY.')
    ).toBeInTheDocument();
  });

  it('creates a mail-item definition when Entity type is Mail item', async () => {
    const user = userEvent.setup();
    vi.spyOn(configApi, 'createDefinition').mockResolvedValue(undefined);
    vi.spyOn(configApi, 'createDraftRelease').mockResolvedValue({
      definitionKey: 'MAIL_ITEM',
      displayName: 'Mail item',
      entityType: 'MAIL',
      version: '0.1.0',
      lifecycleStatus: 'DRAFT',
      rowVersion: 0,
      workflow: demoDesignerWorkflow,
      forms: { [demoDesignerForm.formKey]: demoDesignerForm }
    });

    render(<DesignerWorkspace />);
    const definitionKey = screen.getByLabelText('Definition key');
    await user.clear(definitionKey);
    await user.type(definitionKey, 'MAIL_ITEM');
    const displayName = screen.getByLabelText('Display name');
    await user.clear(displayName);
    await user.type(displayName, 'Mail item');
    await user.selectOptions(screen.getByLabelText('Entity type'), 'MAIL');
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(configApi.createDefinition).toHaveBeenCalledWith({
      definitionKey: 'MAIL_ITEM',
      displayName: 'Mail item',
      entityType: 'MAIL'
    });
    expect(screen.getByLabelText('Entity type')).toHaveValue('MAIL');
  });

  it('shows Live after activate without changing PUBLISHED status', async () => {
    const user = userEvent.setup();
    vi.spyOn(configApi, 'listReleaseCatalog').mockResolvedValue([
      {
        definitionKey: 'I_407_MAILITEM',
        displayName: 'I-407 Mail',
        entityType: 'MAIL',
        version: '0.1.0',
        lifecycleStatus: 'PUBLISHED'
      }
    ]);
    vi.spyOn(configApi, 'getRelease').mockResolvedValue({
      definitionKey: 'I_407_MAILITEM',
      displayName: 'I-407 Mail',
      entityType: 'MAIL',
      version: '0.1.0',
      lifecycleStatus: 'PUBLISHED',
      rowVersion: 4,
      workflow: demoDesignerWorkflow,
      forms: { [demoDesignerForm.formKey]: demoDesignerForm }
    });
    vi.spyOn(configApi, 'mutateLifecycle').mockResolvedValue({
      definitionKey: 'I_407_MAILITEM',
      displayName: 'I-407 Mail',
      entityType: 'MAIL',
      version: '0.1.0',
      lifecycleStatus: 'PUBLISHED',
      active: true,
      rowVersion: 4,
      workflow: demoDesignerWorkflow,
      forms: { [demoDesignerForm.formKey]: demoDesignerForm }
    });

    render(<DesignerWorkspace />);
    await user.click(screen.getByRole('button', { name: 'Open definition' }));
    await user.click(await screen.findByRole('button', { name: /I-407 Mail/ }));
    expect(await screen.findByText(/I_407_MAILITEM 0.1.0 is PUBLISHED \(not the Live pointer\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lifecycle' }));
    expect(screen.getByText('Not Live')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Activate' }));
    expect(await screen.findByText(/is now the Live pointer/)).toBeInTheDocument();
    expect(screen.getAllByText('PUBLISHED').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Live').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Activate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeEnabled();
    expect(configApi.mutateLifecycle).toHaveBeenCalledWith(
      'I_407_MAILITEM',
      '0.1.0',
      'activate',
      4,
      'author@example.gov',
      ''
    );
  });

  it('downloads and imports a package from Lifecycle', async () => {
    const user = userEvent.setup();
    vi.spyOn(configApi, 'listReleaseCatalog').mockResolvedValue([
      {
        definitionKey: 'I_90',
        displayName: 'I-90',
        entityType: 'WORKLOAD',
        version: '1.0.0',
        lifecycleStatus: 'PUBLISHED'
      }
    ]);
    vi.spyOn(configApi, 'getRelease').mockResolvedValue({
      definitionKey: 'I_90',
      displayName: 'I-90',
      entityType: 'WORKLOAD',
      version: '1.0.0',
      lifecycleStatus: 'PUBLISHED',
      rowVersion: 2,
      workflow: demoDesignerWorkflow,
      forms: { [demoDesignerForm.formKey]: demoDesignerForm }
    });
    vi.spyOn(configApi, 'exportReleasePackage').mockResolvedValue({
      package: {
        apiVersion: 'optic.uscis/v1',
        kind: 'DefinitionRelease',
        metadata: {
          definitionKey: 'I_90',
          displayName: 'I-90',
          entityType: 'WORKLOAD',
          version: '1.0.0',
          status: 'PUBLISHED'
        },
        spec: {}
      },
      checksum: 'a'.repeat(64),
      checksumAlgorithm: 'SHA-256',
      files: { 'manifest.yaml': 'kind: DefinitionRelease\n' }
    });
    vi.spyOn(configApi, 'importReleasePackage').mockResolvedValue({
      definitionKey: 'I_90',
      displayName: 'I-90',
      entityType: 'WORKLOAD',
      version: '1.1.0',
      lifecycleStatus: 'DRAFT',
      rowVersion: 0,
      workflow: demoDesignerWorkflow,
      forms: { [demoDesignerForm.formKey]: demoDesignerForm }
    });
    const createObjectURL = vi.fn(() => 'blob:optic-package');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(<DesignerWorkspace />);
    await user.click(screen.getByRole('button', { name: 'Open definition' }));
    await user.click(await screen.findByRole('button', { name: /I-90/ }));
    await user.click(screen.getByRole('button', { name: 'Lifecycle' }));
    expect(screen.getByRole('button', { name: 'Download package' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Download package' }));
    expect(configApi.exportReleasePackage).toHaveBeenCalledWith('I_90', '1.0.0');
    expect(await screen.findByText(/Downloaded I_90 1.0.0 package/)).toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();

    const packageJson = JSON.stringify({
      package: {
        apiVersion: 'optic.uscis/v1',
        kind: 'DefinitionRelease',
        metadata: {
          definitionKey: 'I_90',
          displayName: 'I-90',
          entityType: 'WORKLOAD',
          version: '1.1.0',
          status: 'PUBLISHED'
        },
        spec: {}
      },
      checksum: 'a'.repeat(64)
    });
    const file = new File([packageJson], 'I_90-1.1.0.optic-package.json', { type: 'application/json' });
    const input = screen.getByLabelText('Import package file');
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText(/Imported I_90 1.1.0 as DRAFT/)).toBeInTheDocument();
    expect(configApi.importReleasePackage).toHaveBeenCalledWith(
      'I_90',
      expect.objectContaining({ mode: 'DRAFT', checksum: 'a'.repeat(64) }),
      'author@example.gov'
    );
    expect(screen.getByLabelText('Version')).toHaveValue('1.1.0');
  });

  it('removes an unsaved form from the picker', async () => {
    const user = userEvent.setup();
    render(<DesignerWorkspace />);
    await user.click(screen.getByRole('button', { name: 'New form' }));
    expect(screen.getByLabelText('Form')).toHaveValue('STAGE_FORM_2');
    await user.click(screen.getByRole('button', { name: 'Delete form' }));
    expect(screen.getByLabelText('Form')).toHaveValue('I90_DATA_ENTRY');
    expect(screen.queryByRole('option', { name: /STAGE_FORM_2/ })).not.toBeInTheDocument();
  });

  it('duplicates the selected form onto the draft without rewiring stages', async () => {
    const user = userEvent.setup();
    render(<DesignerWorkspace />);
    expect(screen.getByLabelText('Form')).toHaveValue('I90_DATA_ENTRY');
    await user.click(screen.getByRole('button', { name: 'Duplicate form' }));
    expect(screen.getByLabelText('Form')).toHaveValue('I90_DATA_ENTRY_2');
    expect(screen.getByText(/I90_DATA_ENTRY_2 was copied from I90_DATA_ENTRY/)).toBeInTheDocument();
    await user.click(screen.getByText(/Identity ·/));
    expect(screen.getByLabelText('formKey')).toHaveValue('I90_DATA_ENTRY_2');
    expect(screen.getByLabelText('Form title')).toHaveValue('Data Entry (copy)');
    await user.click(screen.getByRole('button', { name: 'Workflow' }));
    await user.click(screen.getByRole('button', { name: 'Stage Ready for Data Entry' }));
    await user.click(screen.getByRole('tab', { name: 'Routing' }));
    const formSelects = screen.getAllByLabelText('Form');
    expect(formSelects.map((element) => (element as HTMLSelectElement).value)).toEqual(
      expect.arrayContaining(['I90_DATA_ENTRY_2', 'I90_DATA_ENTRY'])
    );
  });
});
