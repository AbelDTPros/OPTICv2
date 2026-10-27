import { DEFAULT_SPLUNK_MASK_POLICY, type StageFormDefinition } from '../../../../src/modules/configuration/domain/types.js';

export const demoDataEntryForm: StageFormDefinition = {
  formKey: 'I407_DATA_ENTRY',
  dataPath: '$.dataEntryDetails',
  title: 'Data Entry',
  schema: {
    type: 'object',
    properties: {
      paymentType: { type: 'string', enum: ['Card', 'Check(s)'] }
    }
  },
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
          helpText: 'Enter the A-Number including the leading A.',
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
        },
        {
          fieldKey: 'APPLICATION_COUNT',
          path: '$.applicationCount',
          component: 'NUMBER_INPUT',
          label: 'Application count',
          width: 6
        },
        {
          fieldKey: 'SIU_COMPLETE_DATE',
          path: '$.siuCompleteDate',
          component: 'DATE_INPUT',
          label: 'SIU Complete Date',
          width: 6
        }
      ]
    },
    {
      sectionKey: 'PAYMENT',
      title: 'Payment',
      fields: [
        {
          fieldKey: 'PAYMENT_TYPE',
          path: '$.paymentType',
          component: 'SELECT',
          label: 'Payment type',
          options: [
            { value: 'Card', label: 'Card' },
            { value: 'Check(s)', label: 'Check(s)' }
          ]
        },
        {
          fieldKey: 'VOUCHER_NUMBER',
          path: '$.voucherNumber',
          component: 'TEXT_INPUT',
          label: 'Voucher number',
          helpText: 'Required when payment is by check.'
        },
        {
          fieldKey: 'DIGITAL_FILE',
          path: '$.digitalFileUploaded',
          component: 'BOOLEAN_CHECKBOX',
          label: 'Digital file uploaded'
        },
        {
          fieldKey: 'NOTES',
          path: '$.notes',
          component: 'TEXT_AREA',
          label: 'Notes',
          rows: 4
        },
        {
          fieldKey: 'TRACKING_ID',
          path: '$.trackingId',
          component: 'READ_ONLY_VALUE',
          label: 'Tracking ID'
        }
      ]
    }
  ],
  behaviors: [
    {
      behaviorKey: 'SHOW_VOUCHER_FOR_CHECK',
      when: { path: '$.paymentType', operator: 'EQUALS', value: 'Check(s)' },
      effects: [{ fieldKey: 'VOUCHER_NUMBER', visible: true, required: true }]
    },
    {
      behaviorKey: 'LOCK_RECEIPT_AFTER_APPROVAL',
      when: { path: '$workflow.currentStageKey', operator: 'IN', value: ['APPROVAL', 'SHIPPING', 'COMPLETED'] },
      effects: [{ fieldKey: 'RECEIPT_NUMBER', readOnly: true }]
    }
  ]
};
