import { describe, expect, it } from 'vitest';
import type { FormFieldDefinition, StageFormDefinition } from '../../src/modules/configuration/domain/types.js';
import {
  collectSpawnWorkloadRequests,
  mapSpawnedChoice,
  overlaySpawnRowOnChild,
  seedFormValueFromRow
} from '../../src/modules/workflow/domain/spawn-workloads.js';

const form: StageFormDefinition = {
  formKey: 'MAIL_DOC_PREP',
  dataPath: '$',
  title: 'Doc Prep',
  sections: [
    {
      sectionKey: 'WORKLOADS',
      title: 'Workloads',
      repeatable: true,
      path: '$.workloads',
      spawnDefinitionKey: 'I_407',
      fields: [
        { fieldKey: 'TRACKING_ID', path: '$.trackingId', component: 'TRACKING_ID_DISPLAY', label: 'Workload Tracking #' },
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

describe('collectSpawnWorkloadRequests', () => {
  it('reads each copy’s tracking id and target definition', () => {
    const plan = collectSpawnWorkloadRequests(form, {
      workloads: [{ trackingId: 'WL-1' }, { trackingId: 'WL-2' }]
    });
    expect(plan.missingTrackingIds).toBe(0);
    expect(plan.requests).toEqual([
      { definitionKey: 'I_407', trackingId: 'WL-1' },
      { definitionKey: 'I_407', trackingId: 'WL-2' }
    ]);
  });

  it('counts copies that have no tracking id', () => {
    const plan = collectSpawnWorkloadRequests(form, { workloads: [{}, { trackingId: 'WL-1' }] });
    expect(plan.missingTrackingIds).toBe(1);
    expect(plan.requests).toEqual([{ definitionKey: 'I_407', trackingId: 'WL-1' }]);
  });

  it('reads workloadTrackingId when the display field uses that path', () => {
    const withAlias = {
      ...form,
      sections: form.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) => ({ ...field, path: '$.workloadTrackingId' }))
      }))
    };
    const plan = collectSpawnWorkloadRequests(withAlias, {
      workloads: [{ workloadTrackingId: 'WL-ALIASED' }]
    });
    expect(plan.requests).toEqual([{ definitionKey: 'I_407', trackingId: 'WL-ALIASED' }]);
  });

  it('does nothing when the section has no spawn definition', () => {
    const plain = {
      ...form,
      sections: form.sections.map((section) => ({ ...section, spawnDefinitionKey: undefined }))
    };
    expect(collectSpawnWorkloadRequests(plain, { workloads: [{ trackingId: 'WL-1' }] }).requests).toEqual([]);
  });
});

describe('mapSpawnedChoice', () => {
  const target: FormFieldDefinition = childForm.sections[0]!.fields[0]!;

  it('maps accepted onto Accepted by case-insensitive value', () => {
    expect(mapSpawnedChoice('accepted', target)).toBe('Accepted');
  });

  it('maps fraud onto Fraud Review by overlapping label', () => {
    expect(mapSpawnedChoice('fraud', target)).toBe('Fraud Review');
  });
});

describe('overlaySpawnRowOnChild', () => {
  it('seeds the child form from the mail repeating row', () => {
    const seeded = overlaySpawnRowOnChild(
      {},
      childForm,
      { MAIL_DOC_PREP: form },
      { workloads: [{ trackingId: 'WL-1', workloadStatus: 'accepted' }] },
      'WL-1'
    );
    expect(seeded).toEqual({ dataEntryDetails: { workloadStatus: 'Accepted' } });
  });

  it('leaves a value the officer already saved', () => {
    const seeded = overlaySpawnRowOnChild(
      { dataEntryDetails: { workloadStatus: 'Rejected' } },
      childForm,
      { MAIL_DOC_PREP: form },
      { workloads: [{ trackingId: 'WL-1', workloadStatus: 'accepted' }] },
      'WL-1'
    );
    expect(seeded).toEqual({ dataEntryDetails: { workloadStatus: 'Rejected' } });
  });

  it('reads a Doc Prep row under a nested form dataPath', () => {
    const mailForm: StageFormDefinition = { ...form, dataPath: '$.docPrepDetails' };
    const seeded = overlaySpawnRowOnChild(
      {},
      childForm,
      { MAIL_DOC_PREP: mailForm },
      { docPrepDetails: { workloads: [{ workloadTrackingId: 'WL-1', workloadStatus: 'fraud' }] } },
      'WL-1'
    );
    expect(seeded).toEqual({ dataEntryDetails: { workloadStatus: 'Fraud Review' } });
  });
});

describe('seedFormValueFromRow', () => {
  it('skips tracking display fields', () => {
    const seed = seedFormValueFromRow(
      { trackingId: 'WL-1', workloadStatus: 'accepted' },
      form.sections[0]!,
      childForm
    );
    expect(seed).toEqual([{ path: '$.dataEntryDetails.workloadStatus', value: 'Accepted' }]);
  });

  it('writes shared-root child fields at $.workload, not under the stage dataPath', () => {
    const scanningForm: StageFormDefinition = {
      formKey: 'I936_SCANNING_DETAILS',
      dataPath: '$.scanningDetails',
      title: 'Scanning',
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
                { value: 'Accepted', label: 'Accepted' },
                { value: 'Rejected', label: 'Rejected' }
              ]
            },
            {
              fieldKey: 'RECEIVED_DATE',
              path: '$.workload.receivedDate',
              component: 'DATE_INPUT',
              label: 'Received Date'
            }
          ]
        }
      ]
    };
    const seeded = overlaySpawnRowOnChild(
      {},
      scanningForm,
      { MAIL_DOC_PREP: form },
      {
        workloads: [
          { trackingId: 'WL-1', workloadStatus: 'accepted' },
          { trackingId: 'WL-2', workloadStatus: 'rejected' }
        ]
      },
      'WL-1'
    );
    expect(seeded).toEqual({ workload: { workloadStatus: 'Accepted' } });
    expect(seeded.scanningDetails).toBeUndefined();
  });
});
