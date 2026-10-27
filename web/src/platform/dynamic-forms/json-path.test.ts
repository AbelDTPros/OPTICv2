import { describe, expect, it } from 'vitest';
import { displayValueForField, getByJsonPath, valueAtDataPath, wrapAtDataPath } from './json-path.js';

describe('dataPath helpers', () => {
  it('wraps a form object under its dataPath', () => {
    expect(wrapAtDataPath('$.dataEntryDetails', { receiptNumber: 'ABC' })).toEqual({
      dataEntryDetails: { receiptNumber: 'ABC' }
    });
  });

  it('reads the form object back from business data', () => {
    expect(valueAtDataPath({ dataEntryDetails: { receiptNumber: 'ABC' } }, '$.dataEntryDetails')).toEqual({
      receiptNumber: 'ABC'
    });
  });
});

describe('displayValueForField', () => {
  it('uses the instance tracking id when $.trackingId is empty', () => {
    expect(
      displayValueForField(
        { component: 'TRACKING_ID_DISPLAY', path: '$.trackingId' },
        {},
        { trackingId: '7f3a9c2e-1b04-4d8a-9e21-0c4b6a8d1f22' }
      )
    ).toBe('7f3a9c2e-1b04-4d8a-9e21-0c4b6a8d1f22');
  });

  it('prefers a value already stored at the field path', () => {
    expect(
      displayValueForField(
        { component: 'TRACKING_ID_DISPLAY', path: '$.trackingId' },
        { trackingId: 'from-form' },
        { trackingId: 'from-instance' }
      )
    ).toBe('from-form');
  });

  it('resolves $workflow.trackingId', () => {
    expect(
      getByJsonPath({}, '$workflow.trackingId', { trackingId: 'MAIL-99' })
    ).toBe('MAIL-99');
  });

  it('fills a read-only Workload Tracking # bound to $.trackingId', () => {
    expect(
      displayValueForField(
        { component: 'READ_ONLY_VALUE', path: '$.trackingId' },
        {},
        { trackingId: '7f3a9c2e-1b04-4d8a-9e21-0c4b6a8d1f22' }
      )
    ).toBe('7f3a9c2e-1b04-4d8a-9e21-0c4b6a8d1f22');
  });

  it('does not fill unrelated read-only fields with the instance tracking id', () => {
    expect(
      displayValueForField(
        { component: 'READ_ONLY_VALUE', path: '$.readOnlyValue' },
        {},
        { trackingId: '7f3a9c2e-1b04-4d8a-9e21-0c4b6a8d1f22' }
      )
    ).toBeUndefined();
  });

  it('fills an empty date from Today in US Eastern Time', () => {
    expect(
      displayValueForField(
        { component: 'DATE_INPUT', path: '$.dataEntryDate', fillFrom: 'TODAY' },
        {},
        {},
        { form: { formKey: 'F', dataPath: '$', title: 'F', sections: [] } }
      )
    ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('fills an empty date from another date field', () => {
    const form = {
      formKey: 'F',
      dataPath: '$',
      title: 'F',
      sections: [
        {
          sectionKey: 'S',
          title: 'S',
          fields: [
            { fieldKey: 'RECEIVED_DATE', path: '$.receivedDate', component: 'DATE_INPUT', label: 'Received' },
            {
              fieldKey: 'DATA_ENTRY_DATE',
              path: '$.dataEntryDate',
              component: 'DATE_INPUT',
              label: 'Data entry',
              fillFrom: 'FIELD' as const,
              fillFromFieldKey: 'RECEIVED_DATE'
            }
          ]
        }
      ]
    };
    expect(
      displayValueForField(
        form.sections[0]!.fields[1]!,
        { receivedDate: '2026-08-01' },
        {},
        { form }
      )
    ).toBe('2026-08-01');
  });

  it('fills an empty field from the assigned officer', () => {
    expect(
      displayValueForField(
        { component: 'READ_ONLY_VALUE', path: '$.dataKeyerName', fillFrom: 'ASSIGNED_TO' },
        {},
        { assignedTo: 'officer@example.gov' }
      )
    ).toBe('officer@example.gov');
  });

  it('prefers a stored POC name over the current assignee', () => {
    expect(
      displayValueForField(
        { component: 'READ_ONLY_VALUE', path: '$.dataKeyerName', fillFrom: 'ASSIGNED_TO' },
        { dataKeyerName: 'Already Saved' },
        { assignedTo: 'officer@example.gov' }
      )
    ).toBe('Already Saved');
  });

  it('does not invent a tracking id for repeating workload rows', () => {
    expect(
      displayValueForField(
        { component: 'TRACKING_ID_DISPLAY', path: '$.trackingId' },
        {},
        { trackingId: 'MAIL-99' },
        { instanceTrackingIdFallback: false }
      )
    ).toBeUndefined();
  });
});
