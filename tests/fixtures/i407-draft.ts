import type { ActionDefinition, QueueDefinition, WorkflowDefinition } from '../../src/modules/configuration/domain/types.js';

export const i407Workflow: WorkflowDefinition = {
  initialStageKey: 'DOCUMENT_PREP',
  terminalStageKeys: ['COMPLETED', 'REJECTED'],
  stages: [
    {
      stageKey: 'DOCUMENT_PREP',
      displayName: 'Document Prep',
      order: 10,
      formKey: 'I407_DOCUMENT_PREP',
      queueKey: 'READY_FOR_DOC_PREP',
      actionKeys: ['COMPLETE_DOC_PREP'],
      assignmentPolicy: { required: true, clearOnTransition: true }
    },
    {
      stageKey: 'READY_FOR_DATA_ENTRY',
      displayName: 'Ready for Data Entry',
      order: 20,
      formKey: 'I407_DATA_ENTRY',
      queueKey: 'READY_FOR_DATA_ENTRY',
      slaKey: 'DATA_ENTRY_SLA',
      actionKeys: ['SAVE_DRAFT', 'COMPLETE_DATA_ENTRY', 'REFER_TO_FRAUD', 'RELEASE_TO_QUEUE'],
      assignmentPolicy: { required: true, clearOnTransition: true }
    },
    {
      stageKey: 'FRAUD_REVIEW',
      displayName: 'Ready for Fraud Review',
      order: 30,
      formKey: 'I407_FRAUD_REVIEW',
      queueKey: 'FRAUD_REVIEW',
      actionKeys: ['COMPLETE_FRAUD_REVIEW', 'RETURN_TO_DATA_ENTRY'],
      assignmentPolicy: { required: true, clearOnTransition: true }
    },
    {
      stageKey: 'READY_FOR_SHIPPING',
      displayName: 'Ready for Shipping',
      order: 40,
      formKey: 'I407_SHIPPING',
      queueKey: 'READY_FOR_SHIPPING',
      actionKeys: [],
      bulkActionKeys: ['BULK_SHIP'],
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
      transitionSetKey: 'COMPLETE_DATA_ENTRY_TRANSITIONS',
      evaluationMode: 'FIRST_MATCH',
      rules: [
        {
          ruleKey: 'FRAUD_REQUIRED',
          priority: 10,
          when: {
            all: [
              {
                path: '$.dataEntryDetails.fraudReferralRequired',
                operator: 'EQUALS',
                value: true
              }
            ]
          },
          targetStageKey: 'FRAUD_REVIEW'
        }
      ],
      defaultTargetStageKey: 'READY_FOR_SHIPPING'
    }
  ]
};

export const saveDraftAction: ActionDefinition = {
  actionKey: 'SAVE_DRAFT',
  label: 'Save Draft',
  type: 'SAVE',
  requireAssignmentToCurrentUser: true,
  validation: { validateStageForm: false },
  audit: { eventType: 'DRAFT_SAVED' }
};

export const dataEntryQueue: QueueDefinition = {
  queueKey: 'READY_FOR_DATA_ENTRY',
  displayName: 'Ready for Data Entry',
  entityType: 'WORKLOAD',
  eligibility: {
    all: [
      {
        source: 'workflow',
        field: 'currentStageKey',
        operator: 'EQUALS',
        value: 'READY_FOR_DATA_ENTRY'
      }
    ]
  },
  defaultSort: [{ field: 'enteredStageAt', direction: 'ASC' }],
  columns: ['trackingId', 'workloadType', 'assignedTo', 'ageInQueue', 'receiptNumber'],
  filters: ['workloadType', 'assignedStatus'],
  actions: ['ASSIGN_TO_SELF', 'RELEASE_TO_QUEUE'],
  pageSize: 25
};
