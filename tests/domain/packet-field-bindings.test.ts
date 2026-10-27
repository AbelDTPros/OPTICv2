import { describe, expect, it } from 'vitest';
import type { StageFormDefinition } from '../../src/modules/configuration/domain/types.js';
import {
  buildProjectChildWriteBack,
  projectChildrenOntoParentBusinessData,
  projectParentOntoChildBusinessData,
  seedInheritOnceFromBindings
} from '../../src/modules/workflow/domain/packet-field-bindings.js';
import { overlaySpawnRowOnChild } from '../../src/modules/workflow/domain/spawn-workloads.js';

const mailForm: StageFormDefinition = {
  formKey: 'MAIL_DOC_PREP',
  dataPath: '$',
  title: 'Doc Prep',
  sections: [
    {
      sectionKey: 'PACKET',
      title: 'Packet',
      fields: [
        {
          fieldKey: 'RECEIVED_DATE',
          path: '$.receivedDate',
          component: 'DATE_INPUT',
          label: 'Received Date'
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
          bindingKey: 'RECEIVED',
          parentFieldKey: 'RECEIVED_DATE',
          childFieldKey: 'RECEIVED_DATE',
          mode: 'INHERIT_ONCE',
          parentScope: 'PACKET'
        },
        {
          bindingKey: 'STATUS',
          parentFieldKey: 'WORKLOAD_STATUS',
          childFieldKey: 'WORKLOAD_STATUS',
          mode: 'PROJECT_CHILD',
          parentScope: 'ROW'
        }
      ],
      fields: [
        {
          fieldKey: 'TRACKING_ID',
          path: '$.trackingId',
          component: 'TRACKING_ID_DISPLAY',
          label: 'Workload Tracking #'
        },
        {
          fieldKey: 'WORKLOAD_STATUS',
          path: '$.workloadStatus',
          component: 'RADIO',
          label: 'Workload Status',
          options: [
            { value: 'accepted', label: 'Accept' },
            { value: 'rejected', label: 'Reject' },
            { value: 'fraud', label: 'Fraud Review' }
          ]
        }
      ]
    }
  ]
};

const childForm: StageFormDefinition = {
  formKey: 'I407_DATA_ENTRY',
  dataPath: '$.dataEntryDetails',
  title: 'Data Entry',
  sections: [
    {
      sectionKey: 'DETAILS',
      title: 'Details',
      fields: [
        {
          fieldKey: 'RECEIVED_DATE',
          path: '$.receivedDate',
          component: 'DATE_INPUT',
          label: 'Received Date'
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
};

describe('packet field bindings', () => {
  it('inherits a packet-level date onto the child by field key', () => {
    const seed = seedInheritOnceFromBindings(
      { trackingId: 'WL-1' },
      mailForm.sections[1]!,
      { MAIL_DOC_PREP: mailForm },
      { receivedDate: '2026-03-15', workloads: [{ trackingId: 'WL-1' }] },
      childForm,
      mailForm
    );
    expect(seed).toEqual([{ path: '$.dataEntryDetails.receivedDate', value: '2026-03-15' }]);
  });

  it('inherits a packet field from another form on the same mail release', () => {
    const intakeForm: StageFormDefinition = {
      formKey: 'MAIL_INTAKE',
      dataPath: '$.intake',
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
    const spawnOnlyForm: StageFormDefinition = {
      ...mailForm,
      formKey: 'MAIL_DOC_PREP',
      sections: mailForm.sections.map((section) =>
        section.sectionKey === 'PACKET'
          ? { ...section, fields: [] }
          : section.sectionKey === 'WORKLOADS'
            ? {
                ...section,
                packetFieldBindings: [
                  {
                    bindingKey: 'RECEIVED',
                    parentFieldKey: 'RECEIVED_DATE',
                    childFieldKey: 'RECEIVED_DATE',
                    mode: 'INHERIT_ONCE' as const,
                    parentScope: 'PACKET' as const
                  }
                ]
              }
            : section
      )
    };
    const seed = seedInheritOnceFromBindings(
      { trackingId: 'WL-1' },
      spawnOnlyForm.sections[1]!,
      { MAIL_INTAKE: intakeForm, MAIL_DOC_PREP: spawnOnlyForm },
      { intake: { receivedDate: '2026-05-20' }, workloads: [{ trackingId: 'WL-1' }] },
      childForm,
      spawnOnlyForm
    );
    expect(seed).toEqual([{ path: '$.dataEntryDetails.receivedDate', value: '2026-05-20' }]);
  });

  it('seeds inherit bindings through overlaySpawnRowOnChild', () => {
    const seeded = overlaySpawnRowOnChild(
      {},
      childForm,
      { MAIL_DOC_PREP: mailForm },
      { receivedDate: '2026-03-15', workloads: [{ trackingId: 'WL-1', workloadStatus: 'accepted' }] },
      'WL-1'
    );
    expect(seeded).toEqual({
      dataEntryDetails: {
        receivedDate: '2026-03-15',
        workloadStatus: 'Accepted'
      }
    });
  });

  it('projects child status onto the parent Doc Prep row', () => {
    const projected = projectChildrenOntoParentBusinessData(
      {
        receivedDate: '2026-03-15',
        workloads: [{ trackingId: 'WL-1', workloadStatus: 'accepted' }]
      },
      { MAIL_DOC_PREP: mailForm },
      [
        {
          trackingId: 'WL-1',
          businessData: { dataEntryDetails: { workloadStatus: 'Fraud Review' } },
          forms: { I407_DATA_ENTRY: childForm }
        }
      ]
    );
    expect(projected.workloads).toEqual([{ trackingId: 'WL-1', workloadStatus: 'fraud' }]);
  });

  it('writes child status back onto the parent row patch', () => {
    const next = buildProjectChildWriteBack(
      { MAIL_DOC_PREP: mailForm },
      {
        receivedDate: '2026-03-15',
        workloads: [{ trackingId: 'WL-1', workloadStatus: 'accepted' }]
      },
      'WL-1',
      childForm,
      { dataEntryDetails: { workloadStatus: 'Rejected' } }
    );
    expect(next?.workloads).toEqual([{ trackingId: 'WL-1', workloadStatus: 'rejected' }]);
  });

  it('projects parent packet fields onto the child for PROJECT_PARENT', () => {
    const withParentMode: StageFormDefinition = {
      ...mailForm,
      sections: mailForm.sections.map((section) =>
        section.sectionKey === 'WORKLOADS'
          ? {
              ...section,
              packetFieldBindings: [
                {
                  bindingKey: 'RECEIVED_LIVE',
                  parentFieldKey: 'RECEIVED_DATE',
                  childFieldKey: 'RECEIVED_DATE',
                  mode: 'PROJECT_PARENT',
                  parentScope: 'PACKET'
                }
              ]
            }
          : section
      )
    };
    const projected = projectParentOntoChildBusinessData(
      { dataEntryDetails: { workloadStatus: 'Accepted' } },
      childForm,
      { MAIL_DOC_PREP: withParentMode },
      { receivedDate: '2026-04-01', workloads: [{ trackingId: 'WL-1' }] },
      'WL-1'
    );
    expect(projected).toEqual({
      dataEntryDetails: { workloadStatus: 'Accepted', receivedDate: '2026-04-01' }
    });
  });
});
