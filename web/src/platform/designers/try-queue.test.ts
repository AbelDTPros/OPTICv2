import { describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '../../../../src/modules/configuration/domain/types.js';
import { demoDesignerForm, demoDesignerQueue, demoDesignerWorkflow } from './demo-draft.js';
import {
  isTerminalStage,
  itemsInQueue,
  itemFromSummary,
  listOfficerQueues,
  nextTrackingId,
  journeyStageTabs,
  priorStageScreens,
  queueForStage,
  trialQueuePage,
  visitedFormScreens
} from './try-queue.js';
import type { WorkflowQueueItem, WorkflowSummary } from './workflow-api.js';

const summary: WorkflowSummary = {
  trackingId: 'TRIAL-1',
  entityType: 'WORKLOAD',
  workflowInstanceId: 1,
  status: 'ACTIVE',
  definition: { definitionKey: 'I_90', version: '0.1.0', releaseId: '1' },
  workflow: {
    currentStageKey: 'READY_FOR_DATA_ENTRY',
    currentStageLabel: 'Ready for Data Entry',
    enteredStageAt: '2026-09-03T00:00:00.000Z',
    assignedTo: null,
    rowVersion: 0,
    openVisitNumber: 1
  },
  businessData: { dataEntryDetails: { receiptNumber: 'ABC1234567890' } },
  allowedActions: [],
  stageForm: null,
  visits: []
};

const twoStageWorkflow: WorkflowDefinition = {
  initialStageKey: 'INTAKE',
  terminalStageKeys: ['COMPLETED'],
  stages: [
    {
      stageKey: 'INTAKE',
      displayName: 'Intake',
      order: 10,
      queueKey: 'INTAKE_Q',
      actionKeys: ['COMPLETE'],
      assignmentPolicy: { required: false, clearOnTransition: true }
    },
    {
      stageKey: 'REVIEW',
      displayName: 'Review',
      order: 20,
      queueKey: 'REVIEW_Q',
      actionKeys: ['COMPLETE'],
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
  transitionSets: []
};

function item(partial: Partial<WorkflowQueueItem> & Pick<WorkflowQueueItem, 'trackingId' | 'currentStageKey'>): WorkflowQueueItem {
  return {
    entityType: 'WORKLOAD',
    workflowInstanceId: 1,
    status: 'ACTIVE',
    currentStageLabel: partial.currentStageKey,
    assignedTo: null,
    enteredStageAt: '2026-09-03T00:00:00.000Z',
    rowVersion: 0,
    businessData: {},
    ...partial
  };
}

describe('try queue', () => {
  it('builds the stage queue page from the catalog queue and every item in it', () => {
    const queues = listOfficerQueues(demoDesignerWorkflow, { [demoDesignerQueue.queueKey]: demoDesignerQueue }, 'WORKLOAD');
    expect(queues.map((queue) => queue.queueKey)).toEqual([
      'READY_FOR_DATA_ENTRY',
      'COMPLETED',
      'ASSIGNED_TO_ME',
      'ALL_ITEMS'
    ]);
    const queue = queueForStage(demoDesignerWorkflow, { [demoDesignerQueue.queueKey]: demoDesignerQueue }, summary);
    expect(queue?.queueKey).toBe('READY_FOR_DATA_ENTRY');
    const second = itemFromSummary({
      ...summary,
      trackingId: 'TRIAL-2',
      workflowInstanceId: 2,
      workflow: { ...summary.workflow, assignedTo: 'officer@example.gov' }
    });
    const page = trialQueuePage(queue!, [itemFromSummary(summary), second], 'I_90', '0.1.0', demoDesignerWorkflow);
    expect(page.displayName).toBe('Ready for Data Entry');
    expect(page.total).toBe(2);
    expect(page.page).toBe(1);
    expect(page.rows[0]?.values.receiptNumber).toBe('ABC1234567890');
    expect(page.columns.some((column) => column.key === 'receiptNumber')).toBe(true);
    expect(page.rows[0]?.assignedStatus).toBe('UNASSIGNED');
    expect(page.rows[1]?.assignedStatus).toBe('ASSIGNED');
    expect(page.rows[0]?.allowAssign).toBe(true);
    expect(page.rows[0]?.allowReassign).toBe(true);
    expect(page.rows[0]?.allowRelease).toBe(true);
    expect(page.actions.map((action) => action.actionKey)).toEqual(['ASSIGN_TO_SELF', 'RELEASE_TO_QUEUE']);
  });

  it('slices trial queue rows by page size', () => {
    const queue = {
      ...demoDesignerQueue,
      pageSize: 2,
      columns: ['trackingId'],
      projectedFields: []
    };
    const items = [1, 2, 3, 4, 5].map((n) =>
      item({ trackingId: `T-${n}`, currentStageKey: 'READY_FOR_DATA_ENTRY', workflowInstanceId: n })
    );
    const page1 = trialQueuePage(queue, items, 'I_90', '0.1.0', demoDesignerWorkflow, 1);
    expect(page1.total).toBe(5);
    expect(page1.page).toBe(1);
    expect(page1.rows.map((row) => row.trackingId)).toEqual(['T-1', 'T-2']);
    const page3 = trialQueuePage(queue, items, 'I_90', '0.1.0', demoDesignerWorkflow, 3);
    expect(page3.page).toBe(3);
    expect(page3.rows.map((row) => row.trackingId)).toEqual(['T-5']);
  });

  it('exposes authored filters and applies assignedStatus in Try', () => {
    const queue = {
      ...demoDesignerQueue,
      filters: ['assignedStatus'],
      columns: ['trackingId', 'assignedTo'],
      projectedFields: []
    };
    const items = [
      item({ trackingId: 'OPEN', currentStageKey: 'READY_FOR_DATA_ENTRY', workflowInstanceId: 1 }),
      item({
        trackingId: 'MINE',
        currentStageKey: 'READY_FOR_DATA_ENTRY',
        workflowInstanceId: 2,
        assignedTo: 'officer@example.gov'
      })
    ];
    const page = trialQueuePage(
      queue,
      items,
      'I_90',
      '0.1.0',
      demoDesignerWorkflow,
      1,
      { assignedStatus: 'MINE' },
      'officer@example.gov'
    );
    expect(page.filters).toEqual([{ key: 'assignedStatus', label: 'Assignment' }]);
    expect(page.total).toBe(1);
    expect(page.rows.map((row) => row.trackingId)).toEqual(['MINE']);
    expect(page.appliedFilters).toEqual({ assignedStatus: 'MINE' });
  });

  it('marks completed rows with inferred terminal assignment permissions', () => {
    const completed = listOfficerQueues(twoStageWorkflow, {}, 'WORKLOAD').find((queue) => queue.queueKey === 'COMPLETED');
    const page = trialQueuePage(
      completed!,
      [item({ trackingId: 'C', currentStageKey: 'COMPLETED', status: 'COMPLETED', workflowInstanceId: 3 })],
      'I_90',
      '0.1.0',
      twoStageWorkflow
    );
    expect(page.rows[0]?.allowAssign).toBe(false);
    expect(page.rows[0]?.allowReassign).toBe(false);
    expect(page.rows[0]?.allowRelease).toBe(true);
    expect(page.actions.map((action) => action.actionKey)).toEqual(['ASSIGN_TO_SELF', 'RELEASE_TO_QUEUE']);
  });

  it('lists every live queue and only the items that belong there', () => {
    const intake = { queueKey: 'INTAKE_Q', displayName: 'Intake', entityType: 'WORKLOAD' as const, eligibility: {}, defaultSort: [], columns: ['trackingId'], filters: [], actions: ['ASSIGN_TO_SELF'], pageSize: 25 };
    const review = { queueKey: 'REVIEW_Q', displayName: 'Review', entityType: 'WORKLOAD' as const, eligibility: {}, defaultSort: [], columns: ['trackingId'], filters: [], actions: ['ASSIGN_TO_SELF'], pageSize: 25 };
    const catalog = { INTAKE_Q: intake, REVIEW_Q: review };
    const queues = listOfficerQueues(twoStageWorkflow, catalog, 'WORKLOAD');
    expect(queues.map((queue) => queue.queueKey)).toEqual([
      'INTAKE_Q',
      'REVIEW_Q',
      'COMPLETED',
      'ASSIGNED_TO_ME',
      'ALL_ITEMS'
    ]);
    const listed = [
      item({ trackingId: 'A', currentStageKey: 'INTAKE', workflowInstanceId: 1 }),
      item({
        trackingId: 'B',
        currentStageKey: 'REVIEW',
        workflowInstanceId: 2,
        assignedTo: 'officer@example.gov'
      }),
      item({ trackingId: 'C', currentStageKey: 'COMPLETED', status: 'COMPLETED', workflowInstanceId: 3 })
    ];
    const byKey = Object.fromEntries(queues.map((queue) => [queue.queueKey, queue]));
    expect(itemsInQueue(intake, twoStageWorkflow, listed).map((row) => row.trackingId)).toEqual(['A']);
    expect(itemsInQueue(review, twoStageWorkflow, listed).map((row) => row.trackingId)).toEqual(['B']);
    expect(itemsInQueue(byKey.ASSIGNED_TO_ME!, twoStageWorkflow, listed).map((row) => row.trackingId)).toEqual(['B']);
    expect(itemsInQueue(byKey.ALL_ITEMS!, twoStageWorkflow, listed).map((row) => row.trackingId)).toEqual(['A', 'B', 'C']);
    expect(itemsInQueue(byKey.COMPLETED!, twoStageWorkflow, listed).map((row) => row.trackingId)).toEqual(['C']);
  });

  it('shows authored form fields on the trial queue', () => {
    const queue = {
      ...demoDesignerQueue,
      columns: [...demoDesignerQueue.columns, 'firstName', 'lastName'],
      projectedFields: [
        { fieldKey: 'firstName', label: 'Applicant First Name', path: '$.dataEntryDetails.firstName' },
        { fieldKey: 'lastName', label: 'Applicant Last Name', path: '$.dataEntryDetails.lastName' }
      ]
    };
    const named = itemFromSummary({
      ...summary,
      businessData: { dataEntryDetails: { receiptNumber: 'ABC1234567890', firstName: 'Ada', lastName: 'Lovelace' } }
    });
    const page = trialQueuePage(queue, [named], 'I_90', '0.1.0');
    expect(page.columns.map((column) => column.label)).toContain('Applicant First Name');
    expect(page.rows[0]?.values.firstName).toBe('Ada');
    expect(page.rows[0]?.values.lastName).toBe('Lovelace');
  });

  it('mints a short Crockford tracking id for new work', () => {
    expect(nextTrackingId('MAIL')).toMatch(/^M-[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(nextTrackingId('WORKLOAD')).toMatch(/^W-[0-9A-HJKMNP-TV-Z]{10}$/);
  });

  it('uses the same default queues for mail items', () => {
    const queues = listOfficerQueues(twoStageWorkflow, {}, 'MAIL');
    expect(queues.map((queue) => queue.queueKey)).toEqual([
      'COMPLETED',
      'ASSIGNED_TO_ME',
      'ALL_ITEMS'
    ]);
    expect(queues.at(-1)?.entityType).toBe('MAIL');
  });

  it('does not invent a stage queue that is missing from the draft catalog', () => {
    const queues = listOfficerQueues(twoStageWorkflow, {}, 'WORKLOAD');
    expect(queues.map((queue) => queue.queueKey)).toEqual(['COMPLETED', 'ASSIGNED_TO_ME', 'ALL_ITEMS']);
  });

  it('does not put a completed case on a queue', () => {
    const done = {
      ...summary,
      status: 'COMPLETED',
      workflow: { ...summary.workflow, currentStageKey: 'COMPLETED', currentStageLabel: 'Completed' }
    };
    expect(isTerminalStage(demoDesignerWorkflow, done)).toBe(true);
    expect(queueForStage(demoDesignerWorkflow, { [demoDesignerQueue.queueKey]: demoDesignerQueue }, done)).toBeUndefined();
  });

  it('lists completed earlier stages that still have a form', () => {
    const workflow: WorkflowDefinition = {
      ...twoStageWorkflow,
      stages: twoStageWorkflow.stages.map((stage) =>
        stage.stageKey === 'INTAKE' ? { ...stage, formKey: 'INTAKE_FORM' } : stage
      )
    };
    const intakeForm = { ...demoDesignerForm, formKey: 'INTAKE_FORM', title: 'Intake' };
    const screens = priorStageScreens(
      workflow,
      { INTAKE_FORM: intakeForm },
      [
        { stageKey: 'INTAKE', visitNumber: 1, completedAt: '2026-09-03T01:00:00.000Z' },
        { stageKey: 'REVIEW', visitNumber: 1, completedAt: null }
      ],
      'REVIEW'
    );
    expect(screens.map((screen) => screen.stageKey)).toEqual(['INTAKE']);
    expect(screens[0]?.form.formKey).toBe('INTAKE_FORM');
  });

  it('lists earlier forms on a finished case', () => {
    const workflow: WorkflowDefinition = {
      ...twoStageWorkflow,
      stages: twoStageWorkflow.stages.map((stage) =>
        stage.stageKey === 'INTAKE' ? { ...stage, formKey: 'INTAKE_FORM' } : stage
      )
    };
    const intakeForm = { ...demoDesignerForm, formKey: 'INTAKE_FORM', title: 'Intake' };
    const screens = priorStageScreens(
      workflow,
      { INTAKE_FORM: intakeForm },
      [
        { stageKey: 'INTAKE', visitNumber: 1, completedAt: '2026-09-03T01:00:00.000Z' },
        { stageKey: 'COMPLETED', visitNumber: 1, completedAt: null }
      ],
      'COMPLETED'
    );
    expect(screens.map((screen) => screen.stageKey)).toEqual(['INTAKE']);
  });

  it('lists every visited form on a parent mail item, including the current stage', () => {
    const workflow: WorkflowDefinition = {
      ...twoStageWorkflow,
      stages: twoStageWorkflow.stages.map((stage) =>
        stage.stageKey === 'INTAKE' ? { ...stage, formKey: 'INTAKE_FORM' } : stage
      )
    };
    const intakeForm = { ...demoDesignerForm, formKey: 'INTAKE_FORM', title: 'Intake' };
    const screens = visitedFormScreens(workflow, { INTAKE_FORM: intakeForm }, [
      { stageKey: 'INTAKE', visitNumber: 1, completedAt: '2026-09-03T01:00:00.000Z' },
      { stageKey: 'COMPLETED', visitNumber: 1, completedAt: null }
    ]);
    expect(screens.map((screen) => screen.stageKey)).toEqual(['INTAKE']);
  });

  it('orders visited forms by when the case first entered each stage', () => {
    const workflow: WorkflowDefinition = {
      ...twoStageWorkflow,
      stages: twoStageWorkflow.stages.map((stage) =>
        stage.stageKey === 'INTAKE'
          ? { ...stage, formKey: 'INTAKE_FORM' }
          : stage.stageKey === 'REVIEW'
            ? { ...stage, formKey: 'REVIEW_FORM' }
            : stage
      )
    };
    const intakeForm = { ...demoDesignerForm, formKey: 'INTAKE_FORM', title: 'Intake' };
    const reviewForm = { ...demoDesignerForm, formKey: 'REVIEW_FORM', title: 'Review' };
    const screens = visitedFormScreens(workflow, { INTAKE_FORM: intakeForm, REVIEW_FORM: reviewForm }, [
      { stageKey: 'REVIEW', visitNumber: 1, enteredAt: '2026-09-03T02:00:00.000Z', completedAt: null },
      { stageKey: 'INTAKE', visitNumber: 1, enteredAt: '2026-09-03T01:00:00.000Z', completedAt: '2026-09-03T02:00:00.000Z' }
    ]);
    expect(screens.map((screen) => screen.stageKey)).toEqual(['INTAKE', 'REVIEW']);
  });

  it('lists journey tabs in visit order and keeps the current stage last when it was reached last', () => {
    const workflow: WorkflowDefinition = {
      ...twoStageWorkflow,
      stages: twoStageWorkflow.stages.map((stage) =>
        stage.stageKey === 'INTAKE' ? { ...stage, formKey: 'INTAKE_FORM' } : stage
      )
    };
    const intakeForm = { ...demoDesignerForm, formKey: 'INTAKE_FORM', title: 'Intake' };
    const tabs = journeyStageTabs(
      workflow,
      { INTAKE_FORM: intakeForm },
      [
        { stageKey: 'COMPLETED', visitNumber: 1, enteredAt: '2026-09-03T03:00:00.000Z', completedAt: null },
        { stageKey: 'REVIEW', visitNumber: 1, enteredAt: '2026-09-03T02:00:00.000Z', completedAt: '2026-09-03T03:00:00.000Z' },
        { stageKey: 'INTAKE', visitNumber: 1, enteredAt: '2026-09-03T01:00:00.000Z', completedAt: '2026-09-03T02:00:00.000Z' }
      ],
      'COMPLETED',
      'Completed'
    );
    expect(tabs.map((tab) => tab.stageKey)).toEqual(['INTAKE', 'REVIEW', 'COMPLETED']);
    expect(tabs.at(-1)?.isCurrent).toBe(true);
  });
});
