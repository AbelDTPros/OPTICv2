import { describe, expect, it } from 'vitest';
import { assertFormAccessibility } from '../../src/platform/accessibility/form-accessibility.js';
import { DEFAULT_SPLUNK_MASK_POLICY, type StageFormDefinition } from '../../src/modules/configuration/domain/types.js';

const validForm: StageFormDefinition = {
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
};

describe('form accessibility gate', () => {
  it('accepts a labeled form from the approved component library', () => {
    expect(() => assertFormAccessibility(validForm)).not.toThrow();
  });

  it('rejects a field without a programmatic label', () => {
    expect(() =>
      assertFormAccessibility({
        ...validForm,
        sections: [
          {
            sectionKey: 'APPLICANT',
            title: 'Applicant Information',
            fields: [
              {
                fieldKey: 'A_NUMBER',
                path: '$.ANumber',
                component: 'A_NUMBER_INPUT',
                label: ''
              }
            ]
          }
        ]
      })
    ).toThrowError(/inaccessible user interface/);
  });

  it('rejects a radio group without two labeled choices', () => {
    expect(() =>
      assertFormAccessibility({
        ...validForm,
        sections: [
          {
            sectionKey: 'APPLICANT',
            title: 'Applicant Information',
            fields: [
              {
                fieldKey: 'PAYMENT',
                path: '$.paymentType',
                component: 'RADIO',
                label: 'Payment type',
                options: [{ value: 'CARD', label: 'Card' }]
              }
            ]
          }
        ]
      })
    ).toThrowError(/inaccessible user interface/);
  });

  it('rejects a repeatable section on a workload form', () => {
    expect(() =>
      assertFormAccessibility(
        {
          ...validForm,
          sections: [
            {
              sectionKey: 'WORKLOADS',
              title: 'Workloads',
              repeatable: true,
              path: '$.workloads',
              fields: [
                { fieldKey: 'TRACKING_ID', path: '$.trackingId', component: 'TRACKING_ID_DISPLAY', label: 'Tracking ID' }
              ]
            }
          ]
        },
        { entityType: 'WORKLOAD' }
      )
    ).toThrowError(/inaccessible user interface/);
  });

  it('accepts a repeatable section on a mail form', () => {
    expect(() =>
      assertFormAccessibility(
        {
          ...validForm,
          sections: [
            {
              sectionKey: 'WORKLOADS',
              title: 'Workloads',
              repeatable: true,
              path: '$.workloads',
              addButtonLabel: 'Add Workload',
              fields: [
                { fieldKey: 'TRACKING_ID', path: '$.trackingId', component: 'TRACKING_ID_DISPLAY', label: 'Tracking ID' }
              ]
            }
          ]
        },
        { entityType: 'MAIL' }
      )
    ).not.toThrow();
  });
});
