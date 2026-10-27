import { describe, expect, it } from 'vitest';
import type { StageFormDefinition } from '../../../../src/modules/configuration/domain/types.js';
import { appendRepeatingItems, readRepeatingItems } from './repeating-section.js';

const TRACKING_ID = /^W-[0-9A-HJKMNP-TV-Z]{10}$/;

const mailForm: StageFormDefinition = {
  formKey: 'DOC_PREP',
  dataPath: '$',
  title: 'Doc Prep',
  sections: [
    {
      sectionKey: 'WORKLOADS',
      title: 'Workloads',
      repeatable: true,
      path: '$.workloads',
      fields: [
        { fieldKey: 'TRACKING_ID', path: '$.trackingId', component: 'TRACKING_ID_DISPLAY', label: 'Workload Tracking #' },
        {
          fieldKey: 'CHOICE',
          path: '$.choice',
          component: 'RADIO',
          label: 'Type',
          options: [
            { value: 'I90', label: 'I-90' },
            { value: 'I131', label: 'I-131' }
          ]
        }
      ]
    }
  ]
};

describe('appendRepeatingItems', () => {
  it('mints a unique workload tracking id for each added copy', () => {
    const first = appendRepeatingItems({}, mailForm, mailForm.sections[0]!);
    const second = appendRepeatingItems(first, mailForm, mailForm.sections[0]!);
    const items = readRepeatingItems(second, mailForm.sections[0]!);
    expect(items).toHaveLength(2);
    expect(items[0]?.trackingId).toMatch(TRACKING_ID);
    expect(items[1]?.trackingId).toMatch(TRACKING_ID);
    expect(items[0]?.trackingId).not.toBe(items[1]?.trackingId);
  });

  it('fills only up to the Count field when matchCountField is on', () => {
    const form: StageFormDefinition = {
      ...mailForm,
      sections: [
        {
          sectionKey: 'COUNTS',
          title: 'Counts',
          fields: [
            {
              fieldKey: 'COUNT',
              path: '$.count',
              component: 'NUMBER_INPUT',
              label: 'How many'
            }
          ]
        },
        {
          ...mailForm.sections[0]!,
          countFieldKey: 'COUNT',
          matchCountField: true
        }
      ]
    };
    const section = form.sections[1]!;
    const first = appendRepeatingItems({ count: 3 }, form, section);
    expect(readRepeatingItems(first, section)).toHaveLength(3);
    const second = appendRepeatingItems(first, form, section);
    expect(readRepeatingItems(second, section)).toHaveLength(3);
  });
});
