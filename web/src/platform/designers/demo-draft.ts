import {
  DEFAULT_SPLUNK_MASK_POLICY,
  type ActionDefinition,
  type BulkActionDefinition,
  type QueueDefinition,
  type ScheduledActionDefinition,
  type SearchDefinition,
  type SlaDefinition,
  type StageFormDefinition,
  type WorkflowDefinition
} from '../../../../src/modules/configuration/domain/types.js';

export const demoDesignerForm: StageFormDefinition = {
  formKey: 'I90_DATA_ENTRY',
  dataPath: '$.dataEntryDetails',
  title: 'Data Entry',
  sections: [
    {
      sectionKey: 'APPLICANT',
      title: 'Applicant Information',
      layout: 'TWO_COLUMN',
      fields: [
        {
          fieldKey: 'A_NUMBER',
          path: '$.ANumber',
          component: 'A_NUMBER_INPUT',
          label: 'A-Number',
          width: 6,
          piiClassification: 'PII',
          splunkPolicy: DEFAULT_SPLUNK_MASK_POLICY
        },
        {
          fieldKey: 'RECEIPT_NUMBER',
          path: '$.receiptNumber',
          component: 'RECEIPT_NUMBER_INPUT',
          label: 'Receipt Number',
          width: 6
        }
      ]
    }
  ]
};

export const demoDesignerWorkflow: WorkflowDefinition = {
  initialStageKey: 'READY_FOR_DATA_ENTRY',
  terminalStageKeys: ['COMPLETED'],
  stages: [
    {
      stageKey: 'READY_FOR_DATA_ENTRY',
      displayName: 'Ready for Data Entry',
      order: 10,
      formKey: 'I90_DATA_ENTRY',
      queueKey: 'READY_FOR_DATA_ENTRY',
      actionKeys: ['COMPLETE'],
      assignmentPolicy: { required: false, clearOnTransition: true },
      layout: { x: 24, y: 32 }
    },
    {
      stageKey: 'COMPLETED',
      displayName: 'Completed',
      order: 999,
      terminal: true,
      actionKeys: [],
      assignmentPolicy: { required: false, clearOnTransition: false },
      layout: { x: 280, y: 32 }
    }
  ],
  transitionSets: [
    {
      transitionSetKey: 'FROM_DATA_ENTRY',
      evaluationMode: 'FIRST_MATCH',
      rules: [],
      defaultTargetStageKey: 'COMPLETED'
    }
  ]
};

export const blankDesignerForm: StageFormDefinition = {
  formKey: 'STAGE_FORM',
  dataPath: '$.details',
  title: 'Untitled form',
  sections: [{ sectionKey: 'SECTION', title: 'Section', layout: 'ONE_COLUMN', fields: [] }]
};

export const blankDesignerWorkflow: WorkflowDefinition = {
  initialStageKey: 'START',
  terminalStageKeys: ['COMPLETED'],
  stages: [
    {
      stageKey: 'START',
      displayName: 'Start',
      order: 10,
      formKey: 'STAGE_FORM',
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
  ],
  transitionSets: []
};

export const demoDesignerAction: ActionDefinition = {
  actionKey: 'COMPLETE',
  label: 'Complete',
  type: 'TRANSITION',
  requireAssignmentToCurrentUser: false,
  validation: { validateStageForm: true },
  transitionSetKey: 'FROM_DATA_ENTRY',
  assignment: { clearOnTransition: true }
};

export const demoDesignerQueue: QueueDefinition = {
  queueKey: 'READY_FOR_DATA_ENTRY',
  displayName: 'Ready for Data Entry',
  entityType: 'WORKLOAD',
  eligibility: {
    all: [{ source: 'workflow', field: 'currentStageKey', operator: 'EQUALS', value: 'READY_FOR_DATA_ENTRY' }]
  },
  defaultSort: [{ field: 'enteredStageAt', direction: 'ASC' }],
  columns: ['trackingId', 'assignedTo', 'receiptNumber'],
  filters: ['assignedStatus'],
  actions: ['ASSIGN_TO_SELF', 'RELEASE_TO_QUEUE'],
  pageSize: 25
};

export const demoDesignerSla: SlaDefinition = {
  slaKey: 'DATA_ENTRY_SLA',
  clock: 'CALENDAR',
  target: { durationHours: 24 },
  warningThresholdPercent: 75,
  breachThresholdPercent: 100,
  severityOnBreach: 'HIGH'
};

export const demoDesignerSearch: SearchDefinition = {
  searchKey: 'DEFAULT',
  fields: [
    { fieldKey: 'trackingId', source: 'SYSTEM', path: '$workflow.trackingId', match: 'EXACT_PREFIX', pii: false },
    { fieldKey: 'receiptNumber', source: 'BUSINESS_DATA', path: '$.receiptNumber', match: 'EXACT_PREFIX', pii: true }
  ]
};

export const demoDesignerBulk: BulkActionDefinition = {
  bulkActionKey: 'BULK_COMPLETE',
  label: 'Bulk complete',
  stageKey: 'READY_FOR_DATA_ENTRY',
  maxSelection: 25,
  transactionMode: 'BEST_EFFORT',
  eligibility: {
    requireUnassignedOrAssignedToCurrentUser: true,
    all: [{ source: 'workflow', field: 'currentStageKey', operator: 'EQUALS', value: 'READY_FOR_DATA_ENTRY' }]
  },
  sharedInputSchema: {
    type: 'object',
    properties: {
      note: { type: 'string', title: 'Note' }
    }
  },
  writeMappings: [{ source: '$.note', target: '$.dataEntryDetails.bulkNote' }],
  transition: { targetStage: 'COMPLETED' }
};

export const demoDesignerScheduled: ScheduledActionDefinition = {
  scheduledActionKey: 'ON_HOLD_NUDGE',
  trigger: { type: 'STAGE_ENTERED', stageKey: 'READY_FOR_DATA_ENTRY' },
  delay: { source: 'CONFIG', duration: { hours: 24 } },
  action: { type: 'NOTIFICATION' },
  cancellation: { cancelIfStageChanges: true },
  retry: { maxAttempts: 5, backoff: 'EXPONENTIAL' }
};
