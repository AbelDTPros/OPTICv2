import { describe, expect, it } from 'vitest';
import {
  collectBehaviorIntegrityIssues,
  collectDisplayFromIntegrityIssues,
  collectPacketBindingIntegrityIssues,
  displayFromStoragePath,
  retargetDisplayFromAcrossForms,
  retargetFieldReferences,
  scrubDeletedFieldReferences,
  scrubDisplayFromAcrossForms,
  syncDisplayFromAfterFormEdit
} from './form-integrity.js';
import { collectFormIssues, removeField, renameFieldKey } from './form-model.js';
import { demoDesignerForm } from './demo-draft.js';

describe('form integrity', () => {
  it('flags missing behavior targets and When paths', () => {
    const form = {
      ...demoDesignerForm,
      behaviors: [
        {
          behaviorKey: 'BROKEN',
          when: { path: '$.missingField', operator: 'EXISTS' as const },
          effects: [{ fieldKey: 'NO_SUCH_FIELD', visible: true }]
        }
      ]
    };
    const issues = collectBehaviorIntegrityIssues(form);
    expect(issues.some((issue) => issue.message.includes('NO_SUCH_FIELD'))).toBe(true);
    expect(issues.some((issue) => issue.message.includes('$.missingField'))).toBe(true);
  });

  it('accepts When paths for shared fields hosted on another form in the release', () => {
    const trackingForm = {
      ...demoDesignerForm,
      formKey: 'TRACKING',
      title: 'Tracking',
      dataPath: '$.trackingDetails',
      sections: [
        {
          sectionKey: 'STATUS',
          title: 'Status',
          fields: [
            {
              fieldKey: 'WORKLOAD_STATUS',
              path: '$.workload.workloadStatus',
              component: 'RADIO_BUTTONS',
              label: 'Workload Status',
              options: [
                { value: 'Accepted', label: 'Accepted' },
                { value: 'Rejected', label: 'Rejected' }
              ]
            }
          ]
        }
      ]
    };
    const dataEntryForm = {
      ...demoDesignerForm,
      formKey: 'DATA_ENTRY',
      title: 'Data Entry',
      dataPath: '$.dataEntryDetails',
      behaviors: [
        {
          behaviorKey: 'SHOW_WHEN_ACCEPTED',
          when: {
            path: '$.workload.workloadStatus',
            operator: 'EQUALS' as const,
            value: 'Accepted'
          },
          effects: [{ fieldKey: 'RECEIPT_NUMBER', visible: true }]
        }
      ]
    };
    expect(
      collectBehaviorIntegrityIssues(dataEntryForm).some((issue) =>
        issue.message.includes('$.workload.workloadStatus')
      )
    ).toBe(true);
    expect(
      collectBehaviorIntegrityIssues(dataEntryForm, {
        TRACKING: trackingForm,
        DATA_ENTRY: dataEntryForm
      })
    ).toEqual([]);
  });

  it('detects visibility cycles between conditional behaviors', () => {
    const form = {
      ...demoDesignerForm,
      behaviors: [
        {
          behaviorKey: 'A_NEEDS_B',
          when: { path: '$.receiptNumber', operator: 'EXISTS' as const },
          effects: [{ fieldKey: 'A_NUMBER', visible: true }]
        },
        {
          behaviorKey: 'B_NEEDS_A',
          when: { path: '$.ANumber', operator: 'EXISTS' as const },
          effects: [{ fieldKey: 'RECEIPT_NUMBER', visible: true }]
        }
      ]
    };
    expect(
      collectBehaviorIntegrityIssues(form).some((issue) => issue.message.includes('visibility cycle'))
    ).toBe(true);
  });

  it('retargets behavior targets, When paths, and packet bindings on rename', () => {
    const form = {
      ...demoDesignerForm,
      behaviors: [
        {
          behaviorKey: 'SHOW',
          when: { path: '$.receiptNumber', operator: 'EXISTS' as const },
          effects: [{ fieldKey: 'RECEIPT_NUMBER', visible: true }]
        }
      ],
      sections: demoDesignerForm.sections.map((section) =>
        section.sectionKey === 'APPLICANT'
          ? {
              ...section,
              repeatable: true,
              path: '$.workloads',
              spawnDefinitionKey: 'I_407_WORKLOAD',
              packetFieldBindings: [
                {
                  bindingKey: 'B1',
                  parentFieldKey: 'RECEIPT_NUMBER',
                  childFieldKey: 'RECEIPT_NUMBER',
                  mode: 'INHERIT_ONCE' as const,
                  parentScope: 'ROW' as const
                }
              ]
            }
          : section
      )
    };
    const renamed = renameFieldKey(form, 'APPLICANT', 'RECEIPT_NUMBER', 'RECEIPT');
    expect(renamed.behaviors?.[0]?.effects[0]?.fieldKey).toBe('RECEIPT');
    expect(renamed.behaviors?.[0] && 'path' in renamed.behaviors[0].when && renamed.behaviors[0].when.path).toMatch(
      /receipt/i
    );
    expect(renamed.sections[0]?.packetFieldBindings?.[0]?.parentFieldKey).toBe('RECEIPT');
  });

  it('removes behaviors that targeted or When-referenced a deleted field', () => {
    const form = {
      ...demoDesignerForm,
      behaviors: [
        {
          behaviorKey: 'ONLY_RECEIPT',
          when: { path: '$.ANumber', operator: 'EXISTS' as const },
          effects: [{ fieldKey: 'RECEIPT_NUMBER', required: true }]
        },
        {
          behaviorKey: 'WHEN_RECEIPT',
          when: { path: '$.receiptNumber', operator: 'EXISTS' as const },
          effects: [{ fieldKey: 'A_NUMBER', visible: true }]
        },
        {
          behaviorKey: 'KEEP',
          when: { path: '$.ANumber', operator: 'EXISTS' as const },
          effects: [{ fieldKey: 'A_NUMBER', readOnly: true }]
        }
      ]
    };
    const next = removeField(form, 'APPLICANT', 'RECEIPT_NUMBER');
    expect(next.behaviors?.map((behavior) => behavior.behaviorKey)).toEqual(['KEEP']);
    expect(collectFormIssues(next).some((issue) => issue.message.includes('receiptNumber'))).toBe(false);
  });

  it('rejects Show child on parent bindings scoped to packet-only fields', () => {
    const form = {
      ...demoDesignerForm,
      sections: [
        {
          sectionKey: 'PACKET',
          title: 'Packet',
          fields: [
            {
              fieldKey: 'RECEIVED_DATE',
              path: '$.receivedDate',
              component: 'DATE_INPUT',
              label: 'Received'
            }
          ]
        },
        {
          sectionKey: 'WORKLOADS',
          title: 'Workloads',
          repeatable: true,
          path: '$.workloads',
          spawnDefinitionKey: 'I_407_WORKLOAD',
          packetFieldBindings: [
            {
              bindingKey: 'BAD',
              parentFieldKey: 'RECEIVED_DATE',
              childFieldKey: 'RECEIVED_DATE',
              mode: 'PROJECT_CHILD' as const,
              parentScope: 'PACKET' as const
            }
          ],
          fields: [
            {
              fieldKey: 'TRACKING_ID',
              path: '$.trackingId',
              component: 'TRACKING_ID_DISPLAY',
              label: 'Tracking'
            }
          ]
        }
      ]
    };
    const issues = collectPacketBindingIntegrityIssues(form, form.sections[1]!, 1);
    expect(issues.some((issue) => issue.message.includes('row field'))).toBe(true);
  });

  it('accepts packet parents that live on another form in the release', () => {
    const spawnForm = {
      ...demoDesignerForm,
      formKey: 'MAIL_DOC_PREP',
      sections: [
        {
          sectionKey: 'WORKLOADS',
          title: 'Workloads',
          repeatable: true,
          path: '$.workloads',
          spawnDefinitionKey: 'I_407_WORKLOAD',
          packetFieldBindings: [
            {
              bindingKey: 'RECEIVED',
              parentFieldKey: 'RECEIVED_DATE',
              childFieldKey: 'RECEIVED_DATE',
              mode: 'INHERIT_ONCE' as const,
              parentScope: 'PACKET' as const
            }
          ],
          fields: [
            {
              fieldKey: 'TRACKING_ID',
              path: '$.trackingId',
              component: 'TRACKING_ID_DISPLAY',
              label: 'Tracking'
            }
          ]
        }
      ]
    };
    const intakeForm = {
      ...demoDesignerForm,
      formKey: 'MAIL_INTAKE',
      title: 'Intake',
      sections: [
        {
          sectionKey: 'HEADER',
          title: 'Header',
          fields: [
            {
              fieldKey: 'RECEIVED_DATE',
              path: '$.receivedDate',
              component: 'DATE_INPUT',
              label: 'Received Date'
            }
          ]
        }
      ]
    };
    const withoutSibling = collectPacketBindingIntegrityIssues(spawnForm, spawnForm.sections[0]!, 0);
    expect(withoutSibling.some((issue) => issue.message.includes('not found on this form'))).toBe(true);
    const withSibling = collectPacketBindingIntegrityIssues(spawnForm, spawnForm.sections[0]!, 0, {
      MAIL_INTAKE: intakeForm,
      MAIL_DOC_PREP: spawnForm
    });
    expect(withSibling).toEqual([]);
  });

  it('retargetFieldReferences rewrites nested When groups', () => {
    const form = {
      ...demoDesignerForm,
      behaviors: [
        {
          behaviorKey: 'GROUP',
          when: {
            all: [
              { path: '$.receiptNumber', operator: 'EXISTS' as const },
              { path: '$.ANumber', operator: 'EXISTS' as const }
            ]
          },
          effects: [{ fieldKey: 'A_NUMBER', visible: true }]
        }
      ]
    };
    const next = retargetFieldReferences(form, 'RECEIPT_NUMBER', 'RECEIPT', {
      from: '$.receiptNumber',
      to: '$.receipt'
    });
    const when = next.behaviors?.[0]?.when;
    expect(when && 'all' in when && when.all[0] && 'path' in when.all[0] && when.all[0].path).toBe('$.receipt');
  });

  it('scrubDeletedFieldReferences drops matching packet bindings', () => {
    const form = {
      ...demoDesignerForm,
      sections: demoDesignerForm.sections.map((section) => ({
        ...section,
        packetFieldBindings: [
          {
            bindingKey: 'B1',
            parentFieldKey: 'RECEIPT_NUMBER',
            childFieldKey: 'X',
            mode: 'INHERIT_ONCE' as const
          }
        ]
      }))
    };
    const next = scrubDeletedFieldReferences(form, 'RECEIPT_NUMBER');
    expect(next.sections[0]?.packetFieldBindings).toEqual([]);
  });

  it('validates Display from against another form on the release', () => {
    const payment = {
      ...demoDesignerForm,
      formKey: 'PAYMENT',
      dataPath: '$.payment',
      title: 'Payment'
    };
    const report = {
      formKey: 'REPORT',
      dataPath: '$.report',
      title: 'Report',
      sections: [
        {
          sectionKey: 'SUMMARY',
          title: 'Summary',
          fields: [
            {
              fieldKey: 'TRACKING_DISPLAY',
              path: '$.unused',
              component: 'READ_ONLY_VALUE',
              label: 'Pay.gov tracking',
              displayFromFormKey: 'PAYMENT',
              displayFromFieldKey: 'RECEIPT_NUMBER'
            }
          ]
        }
      ]
    };
    expect(collectDisplayFromIntegrityIssues(report, { PAYMENT: payment, REPORT: report })).toEqual([]);
    expect(displayFromStoragePath(report.sections[0]!.fields[0]!, { PAYMENT: payment })).toBe(
      '$.payment.receiptNumber'
    );
    const broken = {
      ...report,
      sections: report.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) => ({ ...field, displayFromFieldKey: 'MISSING' }))
      }))
    };
    expect(
      collectDisplayFromIntegrityIssues(broken, { PAYMENT: payment, REPORT: broken }).some((issue) =>
        issue.message.includes('MISSING')
      )
    ).toBe(true);
  });

  it('retargets and scrubs Display from links across forms', () => {
    const payment = {
      ...demoDesignerForm,
      formKey: 'PAYMENT',
      dataPath: '$.payment'
    };
    const report = {
      formKey: 'REPORT',
      dataPath: '$.report',
      title: 'Report',
      sections: [
        {
          sectionKey: 'SUMMARY',
          title: 'Summary',
          fields: [
            {
              fieldKey: 'TRACKING_DISPLAY',
              path: '$.unused',
              component: 'READ_ONLY_VALUE',
              label: 'Tracking',
              displayFromFormKey: 'PAYMENT',
              displayFromFieldKey: 'RECEIPT_NUMBER'
            }
          ]
        }
      ]
    };
    const renamed = retargetDisplayFromAcrossForms(
      { PAYMENT: payment, REPORT: report },
      'PAYMENT',
      'RECEIPT_NUMBER',
      'PAY_GOV_TRACKING_ID'
    );
    expect(renamed.REPORT?.sections[0]?.fields[0]?.displayFromFieldKey).toBe('PAY_GOV_TRACKING_ID');
    const scrubbed = scrubDisplayFromAcrossForms(renamed, 'PAYMENT', 'PAY_GOV_TRACKING_ID');
    expect(scrubbed.REPORT?.sections[0]?.fields[0]?.displayFromFormKey).toBeUndefined();
    const synced = syncDisplayFromAfterFormEdit(
      { PAYMENT: payment, REPORT: report },
      payment,
      removeField(payment, 'APPLICANT', 'RECEIPT_NUMBER')
    );
    expect(synced.REPORT?.sections[0]?.fields[0]?.displayFromFieldKey).toBeUndefined();
  });
});
