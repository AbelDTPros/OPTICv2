import { DEFAULT_SPLUNK_MASK_POLICY, type DefinitionRelease } from '../../../src/modules/configuration/domain/types.js';
import { dataEntryQueue, i407Workflow, saveDraftAction } from '../i407-draft.js';

export const branchingRelease: DefinitionRelease = {
  id: '202',
  definitionKey: 'I_407',
  displayName: 'I-407',
  entityType: 'WORKLOAD',
  version: '2.3.0',
  lifecycleStatus: 'PUBLISHED',
  rowVersion: 8,
  schema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      dataEntryDetails: {
        type: 'object',
        properties: {
          fraudReferralRequired: { type: 'boolean' }
        }
      }
    }
  },
  workflow: {
    ...i407Workflow,
    stages: [
      ...i407Workflow.stages,
      {
        stageKey: 'REJECTED',
        displayName: 'Rejected',
        order: 998,
        terminal: true,
        actionKeys: [],
        assignmentPolicy: { required: false, clearOnTransition: false }
      }
    ],
    transitionSets: [
      ...i407Workflow.transitionSets,
      {
        transitionSetKey: 'COMPLETE_PAYMENT',
        evaluationMode: 'FIRST_MATCH',
        rules: [
          {
            ruleKey: 'PAYMENT_REJECTED',
            priority: 10,
            when: {
              all: [
                {
                  path: '$.paymentDetails.details.payGovReadyDetails.rejected',
                  operator: 'EQUALS',
                  value: true
                }
              ]
            },
            targetStageKey: 'REJECTED',
            description: 'Rejected Pay.gov payment moves to Rejected.'
          },
          {
            ruleKey: 'FRAUD_REQUIRED',
            priority: 20,
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
  },
  forms: {
    I407_DOCUMENT_PREP: {
      formKey: 'I407_DOCUMENT_PREP',
      dataPath: '$.scanningDetails',
      title: 'Document Prep',
      sections: [
        {
          sectionKey: 'INTAKE',
          title: 'Intake',
          fields: [
            {
              fieldKey: 'APPLICATION_COUNT',
              path: '$.applicationCount',
              component: 'NUMBER_INPUT',
              label: 'Application count'
            }
          ]
        }
      ]
    },
    I407_DATA_ENTRY: {
      formKey: 'I407_DATA_ENTRY',
      dataPath: '$.dataEntryDetails',
      title: 'Data Entry',
      sections: [
        {
          sectionKey: 'APPLICANT',
          title: 'Applicant Information',
          fields: [
            {
              fieldKey: 'A_NUMBER',
              path: '$.ANumber',
              component: 'A_NUMBER_INPUT',
              label: 'A-Number',
              piiClassification: 'PII',
              splunkPolicy: DEFAULT_SPLUNK_MASK_POLICY
            }
          ]
        }
      ]
    },
    I407_FRAUD_REVIEW: {
      formKey: 'I407_FRAUD_REVIEW',
      dataPath: '$.fraudReviewDetails',
      title: 'Fraud Review',
      sections: [
        {
          sectionKey: 'DECISION',
          title: 'Decision',
          fields: [
            {
              fieldKey: 'NOTES',
              path: '$.notes',
              component: 'TEXT_AREA',
              label: 'Review notes'
            }
          ]
        }
      ]
    },
    I407_SHIPPING: {
      formKey: 'I407_SHIPPING',
      dataPath: '$.shippingDetails',
      title: 'Shipping',
      sections: [
        {
          sectionKey: 'SHIP',
          title: 'Shipment',
          fields: [
            {
              fieldKey: 'SHIP_DATE',
              path: '$.shipDate',
              component: 'DATE_INPUT',
              label: 'Ship date'
            }
          ]
        }
      ]
    }
  },
  actions: {
    SAVE_DRAFT: saveDraftAction,
    COMPLETE_DOC_PREP: { actionKey: 'COMPLETE_DOC_PREP', label: 'Complete Doc Prep', type: 'TRANSITION' },
    COMPLETE_DATA_ENTRY: {
      actionKey: 'COMPLETE_DATA_ENTRY',
      label: 'Complete Data Entry',
      type: 'TRANSITION',
      transitionSetKey: 'COMPLETE_DATA_ENTRY_TRANSITIONS'
    },
    REFER_TO_FRAUD: { actionKey: 'REFER_TO_FRAUD', label: 'Refer to Fraud', type: 'TRANSITION' },
    RELEASE_TO_QUEUE: { actionKey: 'RELEASE_TO_QUEUE', label: 'Release', type: 'RELEASE_ASSIGNMENT' },
    COMPLETE_FRAUD_REVIEW: { actionKey: 'COMPLETE_FRAUD_REVIEW', label: 'Complete Fraud Review', type: 'TRANSITION' },
    RETURN_TO_DATA_ENTRY: { actionKey: 'RETURN_TO_DATA_ENTRY', label: 'Return to Data Entry', type: 'TRANSITION' }
  },
  queues: {
    READY_FOR_DOC_PREP: {
      ...dataEntryQueue,
      queueKey: 'READY_FOR_DOC_PREP',
      displayName: 'Ready for Doc Prep'
    },
    READY_FOR_DATA_ENTRY: dataEntryQueue,
    FRAUD_REVIEW: { ...dataEntryQueue, queueKey: 'FRAUD_REVIEW', displayName: 'Fraud Review' },
    READY_FOR_SHIPPING: {
      ...dataEntryQueue,
      queueKey: 'READY_FOR_SHIPPING',
      displayName: 'Ready for Shipping',
      eligibility: {
        all: [
          {
            source: 'workflow',
            field: 'currentStageKey',
            operator: 'EQUALS',
            value: 'READY_FOR_SHIPPING'
          }
        ]
      }
    }
  },
  bulkActions: {
    BULK_SHIP: {
      bulkActionKey: 'BULK_SHIP',
      label: 'Ship Selected',
      stageKey: 'READY_FOR_SHIPPING',
      maxSelection: 100,
      transactionMode: 'BEST_EFFORT',
      eligibility: { requireUnassignedOrAssignedToCurrentUser: true },
      sharedInputSchema: {
        type: 'object',
        properties: {
          shipDate: { type: 'string', format: 'date', title: 'Ship date' }
        },
        required: ['shipDate']
      },
      writeMappings: [{ source: '$.shipDate', target: '$.shippingDetails.shipDate' }],
      transition: { targetStage: 'COMPLETED' }
    }
  },
  scheduledActions: {},
  slas: {
    DATA_ENTRY_SLA: {
      slaKey: 'DATA_ENTRY_SLA',
      clock: 'CALENDAR',
      target: { durationHours: 48 },
      warningThresholdPercent: 75,
      breachThresholdPercent: 100,
      severityOnBreach: 'HIGH'
    }
  },
  search: { searchKey: 'DEFAULT', fields: [] }
};
