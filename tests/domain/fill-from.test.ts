import { describe, expect, it } from 'vitest';
import {
  applyFillFromToBusinessData,
  applyFillFromToFormValue,
  fillFromOptionsForComponent,
  operationalToday,
  resolveFillFromValue
} from '../../src/modules/configuration/domain/fill-from.js';
import type { StageFormDefinition } from '../../src/modules/configuration/domain/types.js';

const form: StageFormDefinition = {
  formKey: 'I407_DATA_ENTRY',
  dataPath: '$.dataEntryDetails',
  title: 'Data Entry',
  sections: [
    {
      sectionKey: 'TRACKING',
      title: 'Tracking',
      fields: [
        {
          fieldKey: 'DATA_KEYER_NAME',
          path: '$.dataKeyerName',
          component: 'READ_ONLY_VALUE',
          label: 'Data Keyer Name',
          fillFrom: 'ASSIGNED_TO'
        },
        {
          fieldKey: 'RECEIVED_DATE',
          path: '$.receivedDate',
          component: 'DATE_INPUT',
          label: 'Received Date'
        },
        {
          fieldKey: 'DATA_ENTRY_DATE',
          path: '$.dataEntryDate',
          component: 'DATE_INPUT',
          label: 'Data Entry Date',
          fillFrom: 'TODAY'
        },
        {
          fieldKey: 'COMPLETE_DATE',
          path: '$.completeDate',
          component: 'DATE_INPUT',
          label: 'Complete Date',
          fillFrom: 'FIELD',
          fillFromFieldKey: 'RECEIVED_DATE'
        }
      ]
    }
  ]
};

describe('fillFrom', () => {
  it('offers Assigned officer only on name-like fields', () => {
    expect(fillFromOptionsForComponent('READ_ONLY_VALUE').map((item) => item.value)).toEqual(['ASSIGNED_TO']);
    expect(fillFromOptionsForComponent('TEXT_INPUT').map((item) => item.value)).toEqual(['ASSIGNED_TO']);
    expect(fillFromOptionsForComponent('DATE_INPUT').map((item) => item.value)).toEqual(['TODAY', 'FIELD']);
    expect(fillFromOptionsForComponent('RECEIPT_NUMBER_INPUT')).toEqual([]);
    expect(fillFromOptionsForComponent('TRACKING_ID_DISPLAY')).toEqual([]);
  });

  it('resolves Assigned officer from workflow context', () => {
    expect(resolveFillFromValue('ASSIGNED_TO', { assignedTo: '  jordan.officer@example.gov  ' })).toBe(
      'jordan.officer@example.gov'
    );
    expect(resolveFillFromValue('ASSIGNED_TO', { assignedTo: null })).toBeUndefined();
    expect(resolveFillFromValue(undefined, { assignedTo: 'officer@example.gov' })).toBeUndefined();
  });

  it('uses the US Eastern calendar date for Today', () => {
    expect(operationalToday(new Date('2026-09-10T02:30:00.000Z'))).toBe('2026-09-09');
    expect(operationalToday(new Date('2026-09-10T04:30:00.000Z'))).toBe('2026-09-10');
    expect(operationalToday(new Date('2026-01-01T04:30:00.000Z'))).toBe('2025-12-31');
    expect(resolveFillFromValue('TODAY', { now: new Date('2026-09-10T02:30:00.000Z') })).toBe('2026-09-09');
  });

  it('stamps an empty form field from the assignee', () => {
    expect(applyFillFromToFormValue(form, {}, 'officer@example.gov', { today: '2026-09-09' })).toEqual({
      dataKeyerName: 'officer@example.gov',
      dataEntryDate: '2026-09-09'
    });
  });

  it('copies another date field when the target is empty', () => {
    expect(
      applyFillFromToFormValue(
        form,
        { receivedDate: '2026-08-01' },
        null,
        { today: '2026-09-09' }
      )
    ).toEqual({
      receivedDate: '2026-08-01',
      dataEntryDate: '2026-09-09',
      completeDate: '2026-08-01'
    });
  });

  it('does not overwrite a value already saved', () => {
    expect(
      applyFillFromToFormValue(
        form,
        { dataKeyerName: 'Already Saved', dataEntryDate: '2026-01-01' },
        'officer@example.gov',
        { today: '2026-09-09' }
      )
    ).toEqual({ dataKeyerName: 'Already Saved', dataEntryDate: '2026-01-01' });
  });

  it('stamps business data under the form dataPath', () => {
    expect(
      applyFillFromToBusinessData(
        form,
        { dataEntryDetails: { receiptNumber: 'ABC' } },
        'officer@example.gov',
        { today: '2026-09-09' }
      )
    ).toEqual({
      dataEntryDetails: {
        receiptNumber: 'ABC',
        dataKeyerName: 'officer@example.gov',
        dataEntryDate: '2026-09-09'
      }
    });
  });

  it('leaves business data unchanged when there is nothing to stamp', () => {
    const data = { dataEntryDetails: { receiptNumber: 'ABC' } };
    expect(applyFillFromToBusinessData(form, data, null, { today: '' })).toBe(data);
  });
});
