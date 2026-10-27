import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoDesignerForm, demoDesignerQueue, demoDesignerWorkflow } from '../designers/demo-draft.js';
import * as configApi from '../designers/config-api.js';
import * as workflowApi from '../designers/workflow-api.js';
import * as opticApi from '../queues/optic-api.js';
import { OFFICER_ACTOR_ID, setCurrentOfficerId } from '../actors/demo-officers.js';
import * as searchApi from '../search/search-api.js';
import { OfficerWorkspace } from './OfficerWorkspace.js';

afterEach(() => {
  vi.restoreAllMocks();
  setCurrentOfficerId(OFFICER_ACTOR_ID);
});

function stubCatalog() {
  vi.spyOn(configApi, 'listDefinitions').mockResolvedValue([
    { definitionKey: 'I_407_MAILITEM', displayName: 'I-407 Mail', entityType: 'MAIL' },
    { definitionKey: 'I_407_WORKLOAD', displayName: 'I-407 Workload', entityType: 'WORKLOAD' }
  ]);
  vi.spyOn(configApi, 'listReleaseCatalog').mockResolvedValue([
    { definitionKey: 'I_407_MAILITEM', displayName: 'I-407 Mail', version: '0.1.0', lifecycleStatus: 'DRAFT' },
    { definitionKey: 'I_407_WORKLOAD', displayName: 'I-407 Workload', version: '0.1.0', lifecycleStatus: 'DRAFT' }
  ]);
  vi.spyOn(configApi, 'getRelease').mockImplementation(async (definitionKey) => ({
    definitionKey,
    displayName: definitionKey === 'I_407_MAILITEM' ? 'I-407 Mail' : 'I-407 Workload',
    entityType: definitionKey === 'I_407_MAILITEM' ? 'MAIL' : 'WORKLOAD',
    version: '0.1.0',
    lifecycleStatus: 'DRAFT',
    rowVersion: 1,
    workflow: demoDesignerWorkflow,
    forms: { [demoDesignerForm.formKey]: demoDesignerForm }
  }));
  vi.spyOn(workflowApi, 'listWorkflowInstances').mockResolvedValue({
    definitionKey: 'I_407_MAILITEM',
    version: '0.1.0',
    releaseId: '1',
    items: []
  });
}

/** Workspace defaults to Live; draft stubs need Try. */
async function enterTryMode(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Try' }));
  await screen.findByRole('combobox', { name: 'Workload Type' });
}

async function selectWorkloadType(
  user: ReturnType<typeof userEvent.setup>,
  label = 'I-407'
) {
  const combobox = await screen.findByRole('combobox', { name: 'Workload Type' });
  await user.click(combobox);
  await user.click(await screen.findByRole('option', { name: new RegExp(label, 'i') }));
}

describe('OfficerWorkspace', () => {
  it('opens the officer user guide from Workspace', async () => {
    const user = userEvent.setup();
    stubCatalog();
    render(<OfficerWorkspace />);
    await user.click(await screen.findByRole('button', { name: 'User guide' }));
    expect(screen.getByRole('dialog', { name: 'Officer Workspace user guide' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Officer Workspace user guide', level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close user guide' }));
    expect(screen.queryByRole('dialog', { name: 'Officer Workspace user guide' })).not.toBeInTheDocument();
  });

  it('groups mail and workload drafts under one kind tile', async () => {
    const user = userEvent.setup();
    stubCatalog();
    render(<OfficerWorkspace />);
    expect(await screen.findByRole('heading', { name: 'Officer workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Live' })).toHaveAttribute('aria-pressed', 'true');
    await enterTryMode(user);
    expect(screen.getByText(/Rehearsal/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Workload Type' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Workload Type' })).toHaveDisplayValue('');
    expect(screen.getByRole('combobox', { name: 'Workload Type' })).toHaveAttribute(
      'placeholder',
      'Select a workload type'
    );
    expect(screen.queryByRole('heading', { name: 'Mail item queues' })).not.toBeInTheDocument();
    await selectWorkloadType(user);
    expect(screen.getByRole('combobox', { name: 'Workload Type' })).toHaveDisplayValue('I-407');
    expect(screen.getByRole('heading', { name: 'Mail item queues' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Workload queues' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New mail arrives' })).toBeInTheDocument();
    expect(screen.getByLabelText('Tracking ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Receipt number')).toBeInTheDocument();
    expect(screen.queryByLabelText('Entity type')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Find a case' })).toBeInTheDocument();
    expect(screen.getByLabelText('Signed in as')).toHaveDisplayValue('officer@example.gov');
  });

  it('does not auto-open Completed even when only completed cases exist', async () => {
    const user = userEvent.setup();
    stubCatalog();
    vi.spyOn(configApi, 'getRelease').mockImplementation(async (definitionKey) => ({
      definitionKey,
      displayName: definitionKey === 'I_407_MAILITEM' ? 'I-407 Mail' : 'I-407 Workload',
      entityType: definitionKey === 'I_407_MAILITEM' ? 'MAIL' : 'WORKLOAD',
      version: '0.1.0',
      lifecycleStatus: 'DRAFT',
      rowVersion: 1,
      workflow: demoDesignerWorkflow,
      forms: { [demoDesignerForm.formKey]: demoDesignerForm },
      queues: {
        [demoDesignerQueue.queueKey]: {
          ...demoDesignerQueue,
          entityType: definitionKey === 'I_407_MAILITEM' ? 'MAIL' : 'WORKLOAD'
        }
      }
    }));
    vi.spyOn(workflowApi, 'listWorkflowInstances').mockImplementation(async (definitionKey) => ({
      definitionKey,
      version: '0.1.0',
      releaseId: '1',
      items:
        definitionKey === 'I_407_MAILITEM'
          ? [
              {
                trackingId: 'MAIL-DONE',
                entityType: 'MAIL',
                workflowInstanceId: 9,
                status: 'COMPLETED',
                currentStageKey: 'COMPLETED',
                currentStageLabel: 'Completed',
                assignedTo: null,
                enteredStageAt: '2026-09-04T00:00:00.000Z',
                rowVersion: 2,
                businessData: {}
              }
            ]
          : []
    }));
    render(<OfficerWorkspace />);
    await enterTryMode(user);
    await selectWorkloadType(user);
    const readyQueues = await screen.findAllByRole('button', { name: /^Ready for Data Entry/ });
    expect(readyQueues[0]).toHaveAttribute('aria-pressed', 'true');
    const completedButtons = screen.getAllByRole('button', { name: /^Completed/ });
    expect(completedButtons.every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('shortlists workload types in the dropdown as the officer types', async () => {
    const user = userEvent.setup();
    vi.spyOn(configApi, 'listDefinitions').mockResolvedValue([
      { definitionKey: 'I_407_MAILITEM', displayName: 'I-407 Mail', entityType: 'MAIL' },
      { definitionKey: 'I_407_WORKLOAD', displayName: 'I-407 Workload', entityType: 'WORKLOAD' },
      { definitionKey: 'I_90', displayName: 'I-90', entityType: 'WORKLOAD' }
    ]);
    vi.spyOn(configApi, 'listReleaseCatalog').mockResolvedValue([
      { definitionKey: 'I_407_MAILITEM', displayName: 'I-407 Mail', version: '0.1.0', lifecycleStatus: 'DRAFT' },
      { definitionKey: 'I_407_WORKLOAD', displayName: 'I-407 Workload', version: '0.1.0', lifecycleStatus: 'DRAFT' },
      { definitionKey: 'I_90', displayName: 'I-90', version: '0.1.0', lifecycleStatus: 'DRAFT' }
    ]);
    vi.spyOn(configApi, 'getRelease').mockImplementation(async (definitionKey) => ({
      definitionKey,
      displayName: definitionKey === 'I_90' ? 'I-90' : definitionKey === 'I_407_MAILITEM' ? 'I-407 Mail' : 'I-407 Workload',
      entityType: definitionKey === 'I_407_MAILITEM' ? 'MAIL' : 'WORKLOAD',
      version: '0.1.0',
      lifecycleStatus: 'DRAFT',
      rowVersion: 1,
      workflow: demoDesignerWorkflow,
      forms: { [demoDesignerForm.formKey]: demoDesignerForm }
    }));
    vi.spyOn(workflowApi, 'listWorkflowInstances').mockResolvedValue({
      definitionKey: 'I_90',
      version: '0.1.0',
      releaseId: '2',
      items: []
    });

    render(<OfficerWorkspace />);
    await enterTryMode(user);
    const combobox = screen.getByRole('combobox', { name: 'Workload Type' });
    expect(combobox).toHaveDisplayValue('');
    await user.click(combobox);
    expect(screen.getByRole('option', { name: /I-407/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /I-90/ })).toBeInTheDocument();
    await user.type(combobox, '90');
    expect(screen.queryByRole('option', { name: /I-407/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /I-90/ })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /I-90/ }));
    expect(combobox).toHaveDisplayValue('I-90');
    expect(screen.getByRole('heading', { name: 'Workload queues' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Mail item queues' })).not.toBeInTheDocument();
  });

  it('lets the officer type the working-as name', async () => {
    const user = userEvent.setup();
    stubCatalog();
    render(<OfficerWorkspace />);
    await screen.findByRole('heading', { name: 'Officer workspace' });
    const field = screen.getByLabelText('Signed in as');
    await user.clear(field);
    await user.type(field, 'Jordan Lee{Enter}');
    expect(screen.getByLabelText('Signed in as')).toHaveDisplayValue('Jordan Lee');
  });

  it('opens a draft mail case without persisting until assign', async () => {
    const user = userEvent.setup();
    stubCatalog();
    const create = vi.spyOn(workflowApi, 'createWorkflowInstance').mockResolvedValue({
      trackingId: 'mail-1',
      entityType: 'MAIL',
      workflowInstanceId: 1,
      status: 'ACTIVE',
      definition: { definitionKey: 'I_407_MAILITEM', version: '0.1.0', releaseId: '1' },
      workflow: {
        currentStageKey: 'READY_FOR_DATA_ENTRY',
        currentStageLabel: 'Ready for Data Entry',
        enteredStageAt: '2026-09-04T00:00:00.000Z',
        assignedTo: null,
        rowVersion: 0,
        openVisitNumber: 1
      },
      businessData: {},
      allowedActions: [{ actionKey: 'COMPLETE', label: 'Complete' }],
      stageForm: null,
      visits: []
    });
    vi.spyOn(workflowApi, 'assignWorkflow').mockResolvedValue({
      trackingId: 'mail-1',
      entityType: 'MAIL',
      workflowInstanceId: 1,
      status: 'ACTIVE',
      definition: { definitionKey: 'I_407_MAILITEM', version: '0.1.0', releaseId: '1' },
      workflow: {
        currentStageKey: 'READY_FOR_DATA_ENTRY',
        currentStageLabel: 'Ready for Data Entry',
        enteredStageAt: '2026-09-04T00:00:00.000Z',
        assignedTo: 'officer@example.gov',
        rowVersion: 1,
        openVisitNumber: 1
      },
      businessData: {},
      allowedActions: [{ actionKey: 'COMPLETE', label: 'Complete' }],
      stageForm: null,
      visits: []
    });
    render(<OfficerWorkspace />);
    await enterTryMode(user);
    await selectWorkloadType(user);
    await user.click(screen.getByRole('button', { name: 'New mail arrives' }));
    expect(create).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Ready for Data Entry' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Case status' })).toHaveTextContent('DRAFT');
    await user.click(screen.getByRole('button', { name: 'Back to queues' }));
    expect(create).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'New mail arrives' }));
    await user.click(await screen.findByRole('button', { name: 'Assign to me' }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'MAIL',
        definitionKey: 'I_407_MAILITEM',
        version: '0.1.0'
      })
    );
    expect(workflowApi.assignWorkflow).toHaveBeenCalled();
  });

  it('opens a scanned tracking label from Find a case', async () => {
    const user = userEvent.setup();
    stubCatalog();
    const summary = {
      trackingId: 'MAIL-ENVELOPE',
      entityType: 'MAIL',
      workflowInstanceId: 1,
      status: 'ACTIVE',
      definition: { definitionKey: 'I_407_MAILITEM', version: '0.1.0', releaseId: '1' },
      workflow: {
        currentStageKey: 'READY_FOR_DATA_ENTRY',
        currentStageLabel: 'Ready for Data Entry',
        enteredStageAt: '2026-09-04T00:00:00.000Z',
        assignedTo: null,
        rowVersion: 0,
        openVisitNumber: 1
      },
      businessData: {},
      allowedActions: [],
      stageForm: null,
      visits: [],
      forms: { [demoDesignerForm.formKey]: demoDesignerForm },
      workflowDefinition: demoDesignerWorkflow
    };
    vi.spyOn(searchApi, 'findCases').mockResolvedValue({
      q: 'OPTIC:MAIL:MAIL-ENVELOPE',
      page: 1,
      pageSize: 25,
      total: 1,
      hits: [
        {
          trackingId: 'MAIL-ENVELOPE',
          entityType: 'MAIL',
          definitionKey: 'I_407_MAILITEM',
          version: '0.1.0',
          currentStageKey: 'READY_FOR_DATA_ENTRY',
          assignedTo: null,
          slaState: null,
          rowVersion: 0,
          matchedFields: [{ fieldKey: 'trackingId', value: 'MAIL-ENVELOPE', pii: false }]
        }
      ]
    });
    vi.spyOn(workflowApi, 'getWorkflowSummary').mockResolvedValue(summary);
    render(<OfficerWorkspace />);
    await user.type(await screen.findByLabelText('Tracking ID'), 'OPTIC:MAIL:MAIL-ENVELOPE');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(searchApi.findCases).toHaveBeenCalled();
    expect(await screen.findByRole('article', { name: 'MAIL label MAIL-ENVELOPE' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Find a case' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Workload Type' })).toBeInTheDocument();
  });

  it('shows Assigned to Me, All Items, and Completed on Live after activate', async () => {
    vi.spyOn(configApi, 'listDefinitions').mockResolvedValue([
      { definitionKey: 'I_407_MAILITEM', displayName: 'I-407 Mail', entityType: 'MAIL' },
      { definitionKey: 'I_407_WORKLOAD', displayName: 'I-407 Workload', entityType: 'WORKLOAD' }
    ]);
    vi.spyOn(configApi, 'listReleaseCatalog').mockResolvedValue([
      {
        definitionKey: 'I_407_MAILITEM',
        displayName: 'I-407 Mail',
        version: '0.1.0',
        lifecycleStatus: 'PUBLISHED',
        active: true
      },
      {
        definitionKey: 'I_407_WORKLOAD',
        displayName: 'I-407 Workload',
        version: '0.1.0',
        lifecycleStatus: 'PUBLISHED',
        active: true
      }
    ]);
    vi.spyOn(configApi, 'getRelease').mockImplementation(async (definitionKey) => ({
      definitionKey,
      displayName: definitionKey === 'I_407_MAILITEM' ? 'I-407 Mail' : 'I-407 Workload',
      entityType: definitionKey === 'I_407_MAILITEM' ? 'MAIL' : 'WORKLOAD',
      version: '0.1.0',
      lifecycleStatus: 'PUBLISHED',
      active: true,
      rowVersion: 1,
      workflow: demoDesignerWorkflow,
      forms: { [demoDesignerForm.formKey]: demoDesignerForm }
    }));
    vi.spyOn(workflowApi, 'listWorkflowInstances').mockResolvedValue({
      definitionKey: 'I_407_MAILITEM',
      version: '0.1.0',
      releaseId: '1',
      items: []
    });
    vi.spyOn(opticApi, 'listLiveQueues').mockResolvedValue([
      {
        queueKey: 'NEW_MAIL_ITEM',
        displayName: 'New Mail Item',
        entityType: 'MAIL',
        definitionKey: 'I_407_MAILITEM',
        version: '0.1.0',
        total: 3
      },
      {
        queueKey: 'COMPLETED',
        displayName: 'Completed',
        entityType: 'MAIL',
        definitionKey: 'I_407_MAILITEM',
        version: '0.1.0',
        total: 0
      },
      {
        queueKey: 'ASSIGNED_TO_ME',
        displayName: 'Assigned to Me',
        entityType: 'MAIL',
        definitionKey: 'I_407_MAILITEM',
        version: '0.1.0',
        total: 1
      },
      {
        queueKey: 'ALL_ITEMS',
        displayName: 'All Items',
        entityType: 'MAIL',
        definitionKey: 'I_407_MAILITEM',
        version: '0.1.0',
        total: 3
      }
    ]);
    vi.spyOn(opticApi, 'fetchQueuePage').mockResolvedValue({
      queueKey: 'NEW_MAIL_ITEM',
      displayName: 'New Mail Item',
      entityType: 'MAIL',
      definitionKey: 'I_407_MAILITEM',
      version: '0.1.0',
      columns: [{ key: 'trackingId', label: 'Tracking ID', sortable: true }],
      filters: [],
      actions: [],
      page: 1,
      pageSize: 25,
      total: 0,
      sort: [],
      appliedFilters: {},
      rows: []
    });

    const user = userEvent.setup();
    render(<OfficerWorkspace />);
    expect(await screen.findByRole('button', { name: 'Live' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('combobox', { name: 'Workload Type' })).toHaveDisplayValue('');
    await selectWorkloadType(user);
    expect(screen.getByRole('combobox', { name: 'Workload Type' })).toHaveDisplayValue('I-407');
    const mailNav = screen.getByRole('navigation', { name: 'Mail item queues' });
    expect(within(mailNav).getByRole('button', { name: /Assigned to Me/ })).toHaveTextContent('1');
    expect(within(mailNav).getByRole('button', { name: /All Items/ })).toHaveTextContent('3');
    expect(within(mailNav).getByRole('button', { name: /^Completed/ })).toHaveTextContent('0');
    expect(within(mailNav).getByRole('button', { name: /New Mail Item/ })).toHaveTextContent('3');
  });

  it('orders Live workload queues by workflow stage order, not alphabetically', async () => {
    const workloadWorkflow = {
      ...demoDesignerWorkflow,
      initialStageKey: 'Z_FIRST',
      stages: [
        {
          stageKey: 'Z_FIRST',
          displayName: 'First stage',
          order: 10,
          queueKey: 'Z_QUEUE',
          actionKeys: [],
          assignmentPolicy: { required: false, clearOnTransition: true }
        },
        {
          stageKey: 'A_SECOND',
          displayName: 'Second stage',
          order: 20,
          queueKey: 'A_QUEUE',
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
    vi.spyOn(configApi, 'listDefinitions').mockResolvedValue([
      { definitionKey: 'I_407_WORKLOAD', displayName: 'I-407 Workload', entityType: 'WORKLOAD' }
    ]);
    vi.spyOn(configApi, 'listReleaseCatalog').mockResolvedValue([
      {
        definitionKey: 'I_407_WORKLOAD',
        displayName: 'I-407 Workload',
        version: '0.1.0',
        lifecycleStatus: 'PUBLISHED',
        active: true
      }
    ]);
    vi.spyOn(configApi, 'getRelease').mockResolvedValue({
      definitionKey: 'I_407_WORKLOAD',
      displayName: 'I-407 Workload',
      entityType: 'WORKLOAD',
      version: '0.1.0',
      lifecycleStatus: 'PUBLISHED',
      active: true,
      rowVersion: 1,
      workflow: workloadWorkflow,
      forms: { [demoDesignerForm.formKey]: demoDesignerForm },
      queues: {
        Z_QUEUE: {
          ...demoDesignerQueue,
          queueKey: 'Z_QUEUE',
          displayName: 'Z First'
        },
        A_QUEUE: {
          ...demoDesignerQueue,
          queueKey: 'A_QUEUE',
          displayName: 'A Second'
        }
      }
    });
    // Deliberately alpha-reversed vs stage order.
    vi.spyOn(opticApi, 'listLiveQueues').mockResolvedValue([
      {
        queueKey: 'A_QUEUE',
        displayName: 'A Second',
        entityType: 'WORKLOAD',
        definitionKey: 'I_407_WORKLOAD',
        version: '0.1.0',
        officerSortIndex: 1,
        total: 0
      },
      {
        queueKey: 'Z_QUEUE',
        displayName: 'Z First',
        entityType: 'WORKLOAD',
        definitionKey: 'I_407_WORKLOAD',
        version: '0.1.0',
        officerSortIndex: 0,
        total: 0
      },
      {
        queueKey: 'COMPLETED',
        displayName: 'Completed',
        entityType: 'WORKLOAD',
        definitionKey: 'I_407_WORKLOAD',
        version: '0.1.0',
        officerSortIndex: 2,
        total: 0
      },
      {
        queueKey: 'ASSIGNED_TO_ME',
        displayName: 'Assigned to Me',
        entityType: 'WORKLOAD',
        definitionKey: 'I_407_WORKLOAD',
        version: '0.1.0',
        officerSortIndex: 3,
        total: 0
      },
      {
        queueKey: 'ALL_ITEMS',
        displayName: 'All Items',
        entityType: 'WORKLOAD',
        definitionKey: 'I_407_WORKLOAD',
        version: '0.1.0',
        officerSortIndex: 4,
        total: 0
      }
    ]);
    vi.spyOn(opticApi, 'fetchQueuePage').mockResolvedValue({
      queueKey: 'Z_QUEUE',
      displayName: 'Z First',
      entityType: 'WORKLOAD',
      definitionKey: 'I_407_WORKLOAD',
      version: '0.1.0',
      columns: [{ key: 'trackingId', label: 'Tracking ID', sortable: true }],
      filters: [],
      actions: [],
      page: 1,
      pageSize: 25,
      total: 0,
      sort: [],
      appliedFilters: {},
      rows: []
    });

    const user = userEvent.setup();
    render(<OfficerWorkspace />);
    await selectWorkloadType(user);
    const workloadNav = await screen.findByRole('navigation', { name: 'Workload queues' });
    const labels = within(workloadNav)
      .getAllByRole('button')
      .map((button) => button.textContent?.replace(/\d+$/, '').trim());
    expect(labels).toEqual(['Z First', 'A Second', 'Completed', 'Assigned to Me', 'All Items']);
  });
});
