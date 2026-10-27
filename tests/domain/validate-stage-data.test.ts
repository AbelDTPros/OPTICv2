import { describe, expect, it } from 'vitest';
import { compileBusinessSchema } from '../../src/modules/configuration/definitions/schema-compiler.js';
import { assertStageDataValid, withoutRequired } from '../../src/modules/workflow/domain/validate-stage-data.js';
import { linearRelease, linearWorkloadSchema } from '../fixtures/definitions/linear.js';

describe('assertStageDataValid', () => {
  it('does not double-report empty behavior-required fields that also fail minLength', () => {
    const form = {
      formKey: 'I936_PAY_GOV_PAYMENT',
      dataPath: '$.payGovPayment',
      title: 'Pay.Gov Payment',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          payGovTrackingId: { type: 'string', minLength: 1 },
          manifestSequenceNumber: { type: 'string', minLength: 1 }
        }
      },
      sections: [
        {
          sectionKey: 'PAYMENT',
          title: 'Payment',
          fields: [
            {
              fieldKey: 'WORKLOAD_STATUS',
              path: '$.workload.workloadStatus',
              component: 'SELECT',
              label: 'Workload Status',
              options: [
                { label: 'Accepted', value: 'Accepted' },
                { label: 'Rejected', value: 'Rejected' }
              ]
            },
            {
              fieldKey: 'PAY_GOV_TRACKING_ID',
              path: '$.payGovTrackingId',
              component: 'TEXT_INPUT',
              label: 'Pay.Gov Tracking ID',
              validation: { minLength: 1 }
            },
            {
              fieldKey: 'MANIFEST_SEQUENCE_NUMBER',
              path: '$.manifestSequenceNumber',
              component: 'TEXT_INPUT',
              label: 'Manifest Sequence Number',
              validation: { minLength: 1 }
            }
          ]
        }
      ],
      behaviors: [
        {
          behaviorKey: 'REQUIRE_TRACKING',
          when: { path: '$.workload.workloadStatus', operator: 'EQUALS' as const, value: 'Accepted' },
          effects: [{ fieldKey: 'PAY_GOV_TRACKING_ID', visible: true, required: true }]
        },
        {
          behaviorKey: 'REQUIRE_MANIFEST',
          when: { path: '$.workload.workloadStatus', operator: 'EQUALS' as const, value: 'Accepted' },
          effects: [{ fieldKey: 'MANIFEST_SEQUENCE_NUMBER', visible: true, required: true }]
        }
      ]
    };
    const compiled = compileBusinessSchema({ type: 'object' });
    try {
      assertStageDataValid(
        compiled,
        {
          workload: { workloadStatus: 'Accepted' },
          payGovPayment: { payGovTrackingId: '', manifestSequenceNumber: '' }
        },
        form
      );
      throw new Error('expected validation error');
    } catch (error) {
      expect(error).toMatchObject({ errorCode: 'OPTIC-WF-40050' });
      const details = (error as { details?: Array<{ field?: string; message: string }> }).details ?? [];
      expect(details.map((detail) => detail.field).sort()).toEqual([
        'MANIFEST_SEQUENCE_NUMBER',
        'PAY_GOV_TRACKING_ID'
      ]);
      expect(details.every((detail) => /is required\.$/i.test(detail.message))).toBe(true);
    }
  });

  it('enforces behavior-required fields on Complete and still applies schema minimum when present', () => {
    const form = {
      formKey: 'I936_SCANNING_DETAILS',
      dataPath: '$.scanningDetails',
      title: 'Scanning',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          paymentAmount: { type: 'number', minimum: 0.01 }
        }
      },
      sections: [
        {
          sectionKey: 'TRACKING',
          title: 'Tracking',
          fields: [
            {
              fieldKey: 'WORKLOAD_STATUS',
              path: '$.workload.workloadStatus',
              component: 'SELECT',
              label: 'Workload Status',
              options: [
                { label: 'Accepted', value: 'Accepted' },
                { label: 'Rejected', value: 'Rejected' }
              ]
            },
            {
              fieldKey: 'PAYMENT_AMOUNT',
              path: '$.paymentAmount',
              component: 'CURRENCY_INPUT',
              label: 'Payment Amount',
              validation: { minimum: 0.01 }
            }
          ]
        }
      ],
      behaviors: [
        {
          behaviorKey: 'REQUIRE_PAYMENT_WHEN_ACCEPTED',
          when: { path: '$.workload.workloadStatus', operator: 'EQUALS' as const, value: 'Accepted' },
          effects: [{ fieldKey: 'PAYMENT_AMOUNT', visible: true, required: true }]
        }
      ]
    };
    const compiled = compileBusinessSchema({ type: 'object' });
    expect(() =>
      assertStageDataValid(
        compiled,
        { workload: { workloadStatus: 'Rejected' }, scanningDetails: {} },
        form
      )
    ).not.toThrow();
    try {
      assertStageDataValid(
        compiled,
        { workload: { workloadStatus: 'Accepted' }, scanningDetails: {} },
        form
      );
      throw new Error('expected behavior-required error');
    } catch (error) {
      expect(error).toMatchObject({ errorCode: 'OPTIC-WF-40050' });
      const details = (error as { details?: Array<{ message: string; field?: string }> }).details ?? [];
      expect(details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'PAYMENT_AMOUNT',
            message: 'Payment Amount is required.'
          })
        ])
      );
    }
    try {
      assertStageDataValid(
        compiled,
        { workload: { workloadStatus: 'Accepted' }, scanningDetails: { paymentAmount: 0 } },
        form
      );
      throw new Error('expected minimum error');
    } catch (error) {
      expect(error).toMatchObject({ errorCode: 'OPTIC-WF-40050' });
    }
    expect(() =>
      assertStageDataValid(
        compiled,
        { workload: { workloadStatus: 'Accepted' }, scanningDetails: { paymentAmount: 12.5 } },
        form
      )
    ).not.toThrow();
  });

  it('does not treat required fields inside a repeating section as top-level Complete requirements', () => {
    const form = {
      formKey: 'I_936_DOC_PREP',
      dataPath: '$.docPrepDetails',
      title: 'Doc Prep',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['initialWorkloadStatus'],
        properties: {
          initialWorkloadStatus: { type: 'string', enum: ['accepted', 'rejected'] },
          workloads: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['workloadStatus'],
              properties: {
                workloadTrackingId: { type: 'string' },
                workloadStatus: { type: 'string', enum: ['accepted', 'rejected'] }
              }
            }
          }
        }
      },
      sections: [
        {
          sectionKey: 'DOC_PREP',
          title: 'DOC Prep',
          fields: [
            {
              fieldKey: 'INITIAL_WORKLOAD_STATUS',
              path: '$.initialWorkloadStatus',
              component: 'RADIO',
              label: 'Initial Workload Status',
              required: true,
              options: [
                { label: 'Accept', value: 'accepted' },
                { label: 'Reject', value: 'rejected' }
              ]
            }
          ]
        },
        {
          sectionKey: 'NEW_WORKLOADS',
          title: 'New Workloads',
          path: '$.workloads',
          repeatable: true,
          choiceSourceFieldKey: 'INITIAL_WORKLOAD_STATUS',
          fields: [
            {
              fieldKey: 'TRACKING_ID',
              path: '$.workloadTrackingId',
              component: 'TRACKING_ID_DISPLAY',
              label: 'Tracking ID'
            },
            {
              fieldKey: 'WORKLOAD_STATUS',
              path: '$.workloadStatus',
              component: 'RADIO',
              label: 'Radio buttons',
              required: true,
              options: [
                { label: 'Accept', value: 'accepted' },
                { label: 'Reject', value: 'rejected' }
              ]
            }
          ]
        }
      ]
    };
    const compiled = compileBusinessSchema({ type: 'object' });
    expect(() =>
      assertStageDataValid(
        compiled,
        {
          docPrepDetails: {
            initialWorkloadStatus: 'accepted',
            workloads: [{ workloadTrackingId: 'W-1', workloadStatus: 'accepted' }]
          }
        },
        form
      )
    ).not.toThrow();
  });

  it('requires repeating copies to match the Count field when configured', () => {
    const form = {
      formKey: 'DOC_PREP',
      dataPath: '$.docPrep',
      title: 'Doc Prep',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          numberOfWorkloads: { type: 'number' },
          workloads: { type: 'array', items: { type: 'object', additionalProperties: true } }
        }
      },
      sections: [
        {
          sectionKey: 'COUNTS',
          title: 'Counts',
          fields: [
            {
              fieldKey: 'NUMBER_OF_WORKLOADS',
              path: '$.numberOfWorkloads',
              component: 'NUMBER_INPUT',
              label: '# of Workloads to Add'
            }
          ]
        },
        {
          sectionKey: 'WORKLOADS',
          title: 'New Workloads',
          path: '$.workloads',
          repeatable: true,
          countFieldKey: 'NUMBER_OF_WORKLOADS',
          matchCountField: true,
          itemLabel: 'Workload',
          fields: [
            {
              fieldKey: 'TRACKING_ID',
              path: '$.workloadTrackingId',
              component: 'TRACKING_ID_DISPLAY',
              label: 'Tracking ID'
            }
          ]
        }
      ]
    };
    const compiled = compileBusinessSchema({ type: 'object' });
    expect(() =>
      assertStageDataValid(
        compiled,
        {
          docPrep: {
            numberOfWorkloads: 2,
            workloads: [{ workloadTrackingId: 'W-1' }, { workloadTrackingId: 'W-2' }]
          }
        },
        form
      )
    ).not.toThrow();
    try {
      assertStageDataValid(compiled, { docPrep: { numberOfWorkloads: 2, workloads: [] } }, form);
      throw new Error('expected count mismatch');
    } catch (error) {
      expect(error).toMatchObject({ errorCode: 'OPTIC-WF-40050' });
      const details = (error as { details?: Array<{ message: string; field?: string }> }).details ?? [];
      expect(details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'NUMBER_OF_WORKLOADS',
            message: expect.stringMatching(/needs 2 workload copies, but found 0/i)
          })
        ])
      );
    }
  });

  it('strips required arrays for draft validation', () => {
    const stripped = withoutRequired(linearWorkloadSchema);
    expect(stripped.required).toBeUndefined();
    expect((stripped.properties as { dataEntryDetails: { required?: string[] } }).dataEntryDetails.required).toBeUndefined();
  });

  it('allows incomplete required fields on draft and rejects wrong types', () => {
    const compiled = compileBusinessSchema(linearWorkloadSchema);
    const form = linearRelease.forms.I90_DATA_ENTRY;
    expect(() =>
      assertStageDataValid(compiled, {}, form, { mode: 'draft', schema: linearWorkloadSchema })
    ).not.toThrow();
    expect(() =>
      assertStageDataValid(compiled, { dataEntryDetails: {} }, form, {
        mode: 'draft',
        schema: linearWorkloadSchema
      })
    ).not.toThrow();
    try {
      assertStageDataValid(
        compiled,
        { dataEntryDetails: { receiptNumber: 12 } },
        form,
        { mode: 'draft', schema: linearWorkloadSchema }
      );
      throw new Error('expected draft type error');
    } catch (error) {
      expect(error).toMatchObject({ errorCode: 'OPTIC-WF-40051' });
    }
  });

  it('enforces required fields on actions with form labels', () => {
    const compiled = compileBusinessSchema(linearWorkloadSchema);
    const base = linearRelease.forms.I90_DATA_ENTRY;
    const form = {
      ...base,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          receiptNumber: { type: 'string', minLength: 1 },
          workloadStatus: { type: 'string' }
        }
      },
      sections: base.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) =>
          field.fieldKey === 'RECEIPT_NUMBER' ? { ...field, required: true } : field
        )
      }))
    };
    try {
      assertStageDataValid(compiled, { dataEntryDetails: {} }, form);
      throw new Error('expected action schema error');
    } catch (error) {
      expect(error).toMatchObject({ errorCode: 'OPTIC-WF-40050' });
      const details = (error as { details?: Array<{ message: string; field?: string }> }).details ?? [];
      expect(details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'RECEIPT_NUMBER',
            message: 'Receipt Number is required.'
          })
        ])
      );
      expect(details.every((detail) => !/must have required property/i.test(detail.message))).toBe(true);
    }
  });

  it('uses form labels in type-error messages', () => {
    const compiled = compileBusinessSchema({ type: 'object' });
    const form = {
      formKey: 'I407_DATA_ENTRY',
      dataPath: '$.dataEntryDetails',
      title: 'Data Entry',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { notes: { type: 'string' } }
      },
      sections: [
        {
          sectionKey: 'TRACKING',
          title: 'Tracking',
          fields: [{ fieldKey: 'NOTES', path: '$.notes', component: 'TEXT_AREA' as const, label: 'Notes' }]
        }
      ]
    };
    try {
      assertStageDataValid(compiled, { dataEntryDetails: { notes: 12 } }, form);
      throw new Error('expected type error');
    } catch (error) {
      expect(error).toMatchObject({ errorCode: 'OPTIC-WF-40050' });
      const details = (error as { details?: Array<{ message: string }> }).details ?? [];
      expect(details[0]?.message).toBe('Notes: must be string');
    }
  });

  it('accepts canvas fields that were missing from a stale form schema', () => {
    const compiled = compileBusinessSchema({
      type: 'object',
      additionalProperties: false,
      properties: {
        dataEntryDetails: {
          type: 'object',
          additionalProperties: false,
          properties: {
            notes: { type: 'string' }
          }
        }
      }
    });
    const form = {
      formKey: 'I407_DATA_ENTRY',
      dataPath: '$.dataEntryDetails',
      title: 'Data Entry',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          notes: { type: 'string' }
        }
      },
      sections: [
        {
          sectionKey: 'TRACKING',
          title: 'Tracking',
          fields: [
            { fieldKey: 'NOTES', path: '$.notes', component: 'TEXT_AREA', label: 'Notes' },
            { fieldKey: 'BOX_NUMBER', path: '$.boxNumber', component: 'TEXT_INPUT', label: 'Box Number' },
            {
              fieldKey: 'APPLICANT_LAST_NAME',
              path: '$.applicantLastName',
              component: 'TEXT_INPUT',
              label: 'Applicant Last Name'
            },
            {
              fieldKey: 'APPLICANT_FIRST_NAME',
              path: '$.applicantFirstName',
              component: 'TEXT_INPUT',
              label: 'Applicant First Name'
            }
          ]
        }
      ]
    };
    expect(() =>
      assertStageDataValid(compiled, {
        dataEntryDetails: {
          notes: 'keyed',
          boxNumber: 'B-12',
          applicantLastName: 'Nguyen',
          applicantFirstName: 'Linh'
        }
      }, form)
    ).not.toThrow();
  });

  it('ignores stored properties that are no longer on the canvas', () => {
    const compiled = compileBusinessSchema({ type: 'object' });
    const form = {
      formKey: 'I407_DATA_ENTRY',
      dataPath: '$.dataEntryDetails',
      title: 'Data Entry',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { notes: { type: 'string' }, textInput: { type: 'string' } }
      },
      sections: [
        {
          sectionKey: 'TRACKING',
          title: 'Tracking',
          fields: [{ fieldKey: 'NOTES', path: '$.notes', component: 'TEXT_AREA', label: 'Notes' }]
        }
      ]
    };
    expect(() =>
      assertStageDataValid(compiled, { dataEntryDetails: { notes: 'ok', textInput: 'leftover' } }, form)
    ).not.toThrow();
  });

  it('still rejects wrong types on canvas fields', () => {
    const compiled = compileBusinessSchema({ type: 'object' });
    const form = {
      formKey: 'I407_DATA_ENTRY',
      dataPath: '$.dataEntryDetails',
      title: 'Data Entry',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { notes: { type: 'string' } }
      },
      sections: [
        {
          sectionKey: 'TRACKING',
          title: 'Tracking',
          fields: [{ fieldKey: 'NOTES', path: '$.notes', component: 'TEXT_AREA', label: 'Notes' }]
        }
      ]
    };
    try {
      assertStageDataValid(compiled, { dataEntryDetails: { notes: 12 } }, form);
      throw new Error('expected type error');
    } catch (error) {
      expect(error).toMatchObject({ errorCode: 'OPTIC-WF-40050' });
    }
  });
});
