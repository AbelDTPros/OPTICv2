import { describe, expect, it } from 'vitest';
import { demoDataEntryForm } from './demo-form.js';
import { absolutizeFormExpression, resolveFieldStates } from './resolve-field-state.js';

describe('resolveFieldStates', () => {
  it('hides voucher until payment type is Check(s)', () => {
    const hidden = resolveFieldStates(demoDataEntryForm, { paymentType: 'Card' }, {});
    expect(hidden.VOUCHER_NUMBER?.visible).toBe(false);
    const shown = resolveFieldStates(demoDataEntryForm, { paymentType: 'Check(s)' }, {});
    expect(shown.VOUCHER_NUMBER?.visible).toBe(true);
    expect(shown.VOUCHER_NUMBER?.required).toBe(true);
  });

  it('matches absolute When paths against the form dataPath folder', () => {
    const form = {
      ...demoDataEntryForm,
      behaviors: [
        {
          behaviorKey: 'RECEIPT_WHEN_ACCEPTED',
          when: {
            path: '$.dataEntryDetails.workloadStatus',
            operator: 'EQUALS' as const,
            value: 'Accepted'
          },
          effects: [{ fieldKey: 'RECEIPT_NUMBER', visible: true, required: true }]
        }
      ],
      sections: demoDataEntryForm.sections.map((section) =>
        section.sectionKey === 'PAYMENT'
          ? {
              ...section,
              fields: [
                ...section.fields,
                {
                  fieldKey: 'WORKLOAD_STATUS',
                  path: '$.workloadStatus',
                  component: 'SELECT',
                  label: 'Status',
                  options: [
                    { value: 'Accepted', label: 'Accepted' },
                    { value: 'Rejected', label: 'Rejected' }
                  ]
                }
              ]
            }
          : section
      )
    };
    const hidden = resolveFieldStates(form, { workloadStatus: 'Rejected' }, {});
    expect(hidden.RECEIPT_NUMBER?.visible).toBe(false);
    const shown = resolveFieldStates(form, { workloadStatus: 'Accepted' }, {});
    expect(shown.RECEIPT_NUMBER?.visible).toBe(true);
    expect(shown.RECEIPT_NUMBER?.required).toBe(true);
  });

  it('uses full businessData when provided so cross-folder paths resolve', () => {
    const form = {
      ...demoDataEntryForm,
      behaviors: [
        {
          behaviorKey: 'FROM_SHIPPING',
          when: {
            path: '$.shippingDetails.ready',
            operator: 'EQUALS' as const,
            value: true
          },
          effects: [{ fieldKey: 'VOUCHER_NUMBER', visible: true }]
        }
      ]
    };
    const hidden = resolveFieldStates(form, { paymentType: 'Card' }, {}, {
      businessData: { dataEntryDetails: { paymentType: 'Card' }, shippingDetails: { ready: false } }
    });
    expect(hidden.VOUCHER_NUMBER?.visible).toBe(false);
    const shown = resolveFieldStates(form, { paymentType: 'Card' }, {}, {
      businessData: { dataEntryDetails: { paymentType: 'Card' }, shippingDetails: { ready: true } }
    });
    expect(shown.VOUCHER_NUMBER?.visible).toBe(true);
  });

  it('marks a field required from the form definition', () => {
    const form = {
      ...demoDataEntryForm,
      sections: demoDataEntryForm.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) =>
          field.fieldKey === 'RECEIPT_NUMBER' ? { ...field, required: true } : field
        )
      }))
    };
    const states = resolveFieldStates(form, {}, {});
    expect(states.RECEIPT_NUMBER?.required).toBe(true);
    expect(states.A_NUMBER?.required).toBe(false);
  });

  it('locks receipt number when the workflow stage is COMPLETED', () => {
    const states = resolveFieldStates(
      demoDataEntryForm,
      { receiptNumber: 'ABC1234567890' },
      { currentStageKey: 'COMPLETED' }
    );
    expect(states.RECEIPT_NUMBER?.readOnly).toBe(true);
  });

  it('forces every field read-only for a prior stage screen', () => {
    const states = resolveFieldStates(demoDataEntryForm, { paymentType: 'Check(s)' }, {}, { forceReadOnly: true });
    expect(states.RECEIPT_NUMBER?.readOnly).toBe(true);
    expect(states.VOUCHER_NUMBER?.readOnly).toBe(true);
    expect(states.VOUCHER_NUMBER?.required).toBe(false);
  });

  it('matches date GREATER_THAN behaviors using calendar dates', () => {
    const form = {
      ...demoDataEntryForm,
      behaviors: [
        {
          behaviorKey: 'AFTER_START',
          when: { path: '$.completeDate', operator: 'GREATER_THAN' as const, value: '$.startDate' },
          effects: [{ fieldKey: 'VOUCHER_NUMBER', visible: true }]
        }
      ],
      sections: [
        ...demoDataEntryForm.sections,
        {
          sectionKey: 'DATES',
          title: 'Dates',
          fields: [
            {
              fieldKey: 'START_DATE',
              path: '$.startDate',
              component: 'DATE_INPUT',
              label: 'Start'
            },
            {
              fieldKey: 'COMPLETE_DATE',
              path: '$.completeDate',
              component: 'DATE_INPUT',
              label: 'Complete'
            }
          ]
        }
      ]
    };
    const hidden = resolveFieldStates(form, { startDate: '2026-01-10', completeDate: '2026-01-09' }, {});
    expect(hidden.VOUCHER_NUMBER?.visible).toBe(false);
    const shown = resolveFieldStates(form, { startDate: '2026-01-10', completeDate: '2026-01-11' }, {});
    expect(shown.VOUCHER_NUMBER?.visible).toBe(true);
  });

  it('absolutizes form-relative paths under dataPath', () => {
    const paths = new Set(['$.workloadStatus', '$.receiptNumber']);
    expect(
      absolutizeFormExpression(
        { path: '$.workloadStatus', operator: 'EQUALS', value: 'Accepted' },
        '$.dataEntryDetails',
        paths
      )
    ).toEqual({ path: '$.dataEntryDetails.workloadStatus', operator: 'EQUALS', value: 'Accepted' });
    expect(
      absolutizeFormExpression(
        { path: '$.dataEntryDetails.workloadStatus', operator: 'EQUALS', value: 'Accepted' },
        '$.dataEntryDetails',
        paths
      )
    ).toEqual({ path: '$.dataEntryDetails.workloadStatus', operator: 'EQUALS', value: 'Accepted' });
  });

  it('leaves shared $.workload paths absolute', () => {
    const form = {
      ...demoDataEntryForm,
      behaviors: [
        {
          behaviorKey: 'STATUS',
          when: {
            path: '$.workload.workloadStatus',
            operator: 'EQUALS' as const,
            value: 'Accepted'
          },
          effects: [{ fieldKey: 'RECEIPT_NUMBER', visible: true, required: true }]
        }
      ],
      sections: demoDataEntryForm.sections.map((section) =>
        section.sectionKey === 'PAYMENT'
          ? {
              ...section,
              fields: [
                ...section.fields,
                {
                  fieldKey: 'WORKLOAD_STATUS',
                  path: '$.workload.workloadStatus',
                  component: 'SELECT',
                  label: 'Status',
                  options: [
                    { value: 'Accepted', label: 'Accepted' },
                    { value: 'Rejected', label: 'Rejected' }
                  ]
                }
              ]
            }
          : section
      )
    };
    const hidden = resolveFieldStates(form, {}, {}, {
      businessData: { dataEntryDetails: {}, workload: { workloadStatus: 'Rejected' } }
    });
    expect(hidden.RECEIPT_NUMBER?.visible).toBe(false);
    const shown = resolveFieldStates(form, {}, {}, {
      businessData: { dataEntryDetails: {}, workload: { workloadStatus: 'Accepted' } }
    });
    expect(shown.RECEIPT_NUMBER?.visible).toBe(true);
    expect(shown.RECEIPT_NUMBER?.required).toBe(true);
  });
});
