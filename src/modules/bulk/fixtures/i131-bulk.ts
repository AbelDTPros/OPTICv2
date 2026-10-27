import { DEFAULT_SPLUNK_MASK_POLICY, type DefinitionRelease } from '../../configuration/domain/types.js';

export const bulkRelease: DefinitionRelease = {
  id: '303',
  definitionKey: 'I_131_BULK',
  displayName: 'I-131 Bulk Shipping',
  entityType: 'WORKLOAD',
  version: '1.0.0',
  lifecycleStatus: 'PUBLISHED',
  rowVersion: 3,
  schema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      shippingDetails: {
        type: 'object',
        properties: {
          shipDate: { type: 'string', format: 'date' },
          shipPoc: { type: 'string' }
        }
      }
    }
  },
  workflow: {
    initialStageKey: 'READY_FOR_SHIPPING',
    terminalStageKeys: ['COMPLETED'],
    stages: [
      {
        stageKey: 'READY_FOR_SHIPPING',
        displayName: 'Ready for Shipping',
        order: 10,
        formKey: 'I131_SHIPPING',
        queueKey: 'READY_FOR_SHIPPING',
        actionKeys: [],
        bulkActionKeys: ['BULK_SHIP', 'BULK_SHIP_ATOMIC'],
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
  },
  forms: {
    I131_SHIPPING: {
      formKey: 'I131_SHIPPING',
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
              label: 'Ship date',
              splunkPolicy: DEFAULT_SPLUNK_MASK_POLICY
            }
          ]
        }
      ]
    }
  },
  actions: {},
  queues: {
    READY_FOR_SHIPPING: {
      queueKey: 'READY_FOR_SHIPPING',
      displayName: 'Ready for Shipping',
      entityType: 'WORKLOAD',
      eligibility: {
        all: [
          {
            source: 'workflow',
            field: 'currentStageKey',
            operator: 'EQUALS',
            value: 'READY_FOR_SHIPPING'
          }
        ]
      },
      defaultSort: [{ field: 'enteredStageAt', direction: 'ASC' }],
      columns: ['trackingId', 'workloadType', 'assignedTo'],
      filters: ['assignedStatus'],
      actions: ['ASSIGN_TO_SELF', 'RELEASE_TO_QUEUE'],
      pageSize: 25
    }
  },
  bulkActions: {
    BULK_SHIP: {
      bulkActionKey: 'BULK_SHIP',
      label: 'Ship Selected',
      stageKey: 'READY_FOR_SHIPPING',
      maxSelection: 100,
      transactionMode: 'BEST_EFFORT',
      eligibility: {
        requireUnassignedOrAssignedToCurrentUser: true,
        all: [{ source: 'workflow', field: 'status', operator: 'EQUALS', value: 'ACTIVE' }]
      },
      sharedInputSchema: {
        type: 'object',
        properties: {
          shipDate: { type: 'string', format: 'date', title: 'Ship date' },
          shipPoc: { type: 'string', maxLength: 100, title: 'Ship POC' }
        },
        required: ['shipDate']
      },
      writeMappings: [
        { source: '$.shipDate', target: '$.shippingDetails.shipDate' },
        { source: '$.shipPoc', target: '$.shippingDetails.shipPoc' }
      ],
      transition: { targetStage: 'COMPLETED' }
    },
    BULK_SHIP_ATOMIC: {
      bulkActionKey: 'BULK_SHIP_ATOMIC',
      label: 'Ship Selected (atomic)',
      stageKey: 'READY_FOR_SHIPPING',
      maxSelection: 2,
      transactionMode: 'ATOMIC',
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
  slas: {},
  search: { searchKey: 'DEFAULT', fields: [] }
};
