import { DEFAULT_SPLUNK_MASK_POLICY, type DefinitionRelease } from '../../../src/modules/configuration/domain/types.js';

export const linearWorkloadSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  properties: {
    dataEntryDetails: {
      type: 'object',
      properties: {
        receiptNumber: { type: 'string', minLength: 1 },
        fraudReferralRequired: { type: 'boolean' },
        workloadStatus: { type: 'string', enum: ['Accepted', 'Rejected', 'Fraud Review'] }
      },
      required: ['receiptNumber']
    }
  },
  required: ['dataEntryDetails']
};

export const linearRelease: DefinitionRelease = {
  id: '101',
  definitionKey: 'I_90',
  displayName: 'I-90 Linear',
  entityType: 'WORKLOAD',
  version: '1.0.0',
  lifecycleStatus: 'PUBLISHED',
  rowVersion: 3,
  schema: linearWorkloadSchema,
  workflow: {
    initialStageKey: 'READY_FOR_DATA_ENTRY',
    terminalStageKeys: ['COMPLETED'],
    stages: [
      {
        stageKey: 'READY_FOR_DATA_ENTRY',
        displayName: 'Ready for Data Entry',
        order: 10,
        formKey: 'I90_DATA_ENTRY',
        queueKey: 'READY_FOR_DATA_ENTRY',
        actionKeys: ['SAVE_DRAFT', 'COMPLETE_DATA_ENTRY'],
        assignmentPolicy: { required: true, clearOnTransition: true }
      },
      {
        stageKey: 'ON_HOLD',
        displayName: 'On Hold',
        order: 20,
        actionKeys: [],
        assignmentPolicy: { required: false, clearOnTransition: false }
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
            ruleKey: 'FRAUD_HOLD',
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
            targetStageKey: 'ON_HOLD'
          }
        ],
        defaultTargetStageKey: 'COMPLETED'
      }
    ]
  },
  forms: {
    I90_DATA_ENTRY: {
      formKey: 'I90_DATA_ENTRY',
      dataPath: '$.dataEntryDetails',
      title: 'Data Entry',
      sections: [
        {
          sectionKey: 'APPLICATION',
          title: 'Application',
          fields: [
            {
              fieldKey: 'RECEIPT_NUMBER',
              path: '$.receiptNumber',
              component: 'RECEIPT_NUMBER_INPUT',
              label: 'Receipt Number',
              piiClassification: 'SENSITIVE',
              splunkPolicy: DEFAULT_SPLUNK_MASK_POLICY
            },
            {
              fieldKey: 'WORKLOAD_STATUS',
              path: '$.workloadStatus',
              component: 'SELECT',
              label: 'Workload Status',
              options: [
                { value: 'Accepted', label: 'Accepted' },
                { value: 'Rejected', label: 'Rejected' },
                { value: 'Fraud Review', label: 'Fraud Review' }
              ]
            }
          ]
        }
      ]
    }
  },
  actions: {
    SAVE_DRAFT: {
      actionKey: 'SAVE_DRAFT',
      label: 'Save Draft',
      type: 'SAVE',
      requireAssignmentToCurrentUser: true,
      validation: { validateStageForm: false },
      audit: { eventType: 'DRAFT_SAVED' }
    },
    COMPLETE_DATA_ENTRY: {
      actionKey: 'COMPLETE_DATA_ENTRY',
      label: 'Complete Data Entry',
      type: 'TRANSITION',
      requireAssignmentToCurrentUser: true,
      validation: { validateStageForm: true },
      transitionSetKey: 'COMPLETE_DATA_ENTRY_TRANSITIONS',
      assignment: { clearOnTransition: true },
      audit: { eventType: 'STAGE_COMPLETED' }
    }
  },
  queues: {
    READY_FOR_DATA_ENTRY: {
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
      filters: ['assignedStatus', 'workloadType'],
      actions: ['ASSIGN_TO_SELF', 'RELEASE_TO_QUEUE'],
      pageSize: 25
    }
  },
  bulkActions: {},
  scheduledActions: {
    DATA_ENTRY_NUDGE: {
      scheduledActionKey: 'DATA_ENTRY_NUDGE',
      trigger: { type: 'STAGE_ENTERED', stageKey: 'READY_FOR_DATA_ENTRY' },
      delay: { source: 'CONFIG', duration: { hours: 24 } },
      action: { type: 'NOTIFICATION' },
      cancellation: { cancelIfStageChanges: true }
    },
    ON_HOLD_EXPIRATION: {
      scheduledActionKey: 'ON_HOLD_EXPIRATION',
      trigger: { type: 'STAGE_ENTERED', stageKey: 'ON_HOLD' },
      delay: { source: 'CONFIG', duration: { days: 90 } },
      action: { type: 'TRANSITION', targetStage: 'COMPLETED' },
      cancellation: { cancelIfStageChanges: true },
      retry: { maxAttempts: 5, backoff: 'EXPONENTIAL' }
    }
  },
  slas: {},
  search: {
    searchKey: 'DEFAULT',
    fields: [
      { fieldKey: 'trackingId', source: 'SYSTEM', path: '$workflow.trackingId', match: 'EXACT_PREFIX', pii: false },
      { fieldKey: 'receiptNumber', source: 'BUSINESS_DATA', path: '$.dataEntryDetails.receiptNumber', match: 'EXACT_PREFIX', pii: true }
    ]
  }
};
