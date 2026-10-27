import { describe, expect, it } from 'vitest';
import { compileBusinessSchema } from '../../src/modules/configuration/definitions/schema-compiler.js';
import { validationForComponent, validationRuleFamily } from '../../src/modules/configuration/domain/field-validation.js';
import { schemaFromForm } from '../../src/modules/configuration/domain/schema-from-form.js';
import type { StageFormDefinition } from '../../src/modules/configuration/domain/types.js';
import { assertStageDataValid } from '../../src/modules/workflow/domain/validate-stage-data.js';

const dateForm: StageFormDefinition = {
  formKey: 'DATE_FORM',
  dataPath: '$.details',
  title: 'Dates',
  sections: [
    {
      sectionKey: 'WHEN',
      title: 'When',
      fields: [
        {
          fieldKey: 'SHIP_DATE',
          path: '$.shipDate',
          component: 'DATE_INPUT',
          label: 'Ship date',
          validation: { minDate: '2020-01-01', maxDate: '2030-12-31' }
        }
      ]
    }
  ]
};

describe('field validation families', () => {
  it('maps components to the rules authors can set', () => {
    expect(validationRuleFamily('TEXT_INPUT')).toBe('length');
    expect(validationRuleFamily('DATE_INPUT')).toBe('date');
    expect(validationRuleFamily('NUMBER_INPUT')).toBe('number');
    expect(validationRuleFamily('RADIO')).toBe('none');
    expect(validationForComponent('DATE_INPUT', { minLength: 4, minDate: '2024-01-01' })).toEqual({
      minDate: '2024-01-01'
    });
  });

  it('rejects a date outside the authored bounds on Complete', () => {
    const schema = schemaFromForm(dateForm);
    const compiled = compileBusinessSchema({
      type: 'object',
      properties: { details: schema },
      additionalProperties: false
    });
    expect(() =>
      assertStageDataValid(compiled, { details: { shipDate: '2024-06-15' } }, dateForm)
    ).not.toThrow();
    try {
      assertStageDataValid(compiled, { details: { shipDate: '2019-12-31' } }, dateForm);
      throw new Error('expected date bound error');
    } catch (error) {
      expect(error).toMatchObject({ errorCode: 'OPTIC-WF-40050' });
    }
  });

  it('writes repeating-section minItems into schema and rejects empty Complete', () => {
    const mailForm: StageFormDefinition = {
      formKey: 'DOC_PREP',
      dataPath: '$.docPrep',
      title: 'Doc Prep',
      sections: [
        {
          sectionKey: 'WORKLOADS',
          title: 'New Workloads',
          path: '$.workloads',
          repeatable: true,
          minItems: 1,
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
    const schema = schemaFromForm(mailForm);
    expect(schema).toMatchObject({
      required: ['workloads'],
      properties: { workloads: { type: 'array', minItems: 1 } }
    });
    const compiled = compileBusinessSchema({
      type: 'object',
      properties: { docPrep: schema },
      additionalProperties: false
    });
    expect(() =>
      assertStageDataValid(
        compiled,
        { docPrep: { workloads: [{ workloadTrackingId: 'W-1' }] } },
        mailForm
      )
    ).not.toThrow();
    try {
      assertStageDataValid(compiled, { docPrep: { workloads: [] } }, mailForm);
      throw new Error('expected minItems error');
    } catch (error) {
      expect(error).toMatchObject({ errorCode: 'OPTIC-WF-40050' });
    }
  });
});
