import { describe, expect, it } from 'vitest';
import { demoDesignerForm } from './demo-draft.js';
import { addField, addSection, cloneFieldDefinition, collectFormIssues, duplicateField, duplicateFields, duplicateFormDefinition, insertClonedField, insertClonedFields, moveField, moveFieldToIndex, moveSection, releaseSchemaFromForm, releaseSchemaFromForms, removeFields, renameFieldKey, resizeRadioOptions, retargetFieldComponent, schemaAtDataPath, schemaFromForm, setSectionRepeatable, updateField } from './form-model.js';

describe('form designer model', () => {
  it('duplicates a form with a new key and copy title', () => {
    const copy = duplicateFormDefinition(demoDesignerForm, [demoDesignerForm.formKey]);
    expect(copy.formKey).toBe('I90_DATA_ENTRY_2');
    expect(copy.title).toBe('Data Entry (copy)');
    expect(copy.dataPath).toBe(demoDesignerForm.dataPath);
    expect(copy.sections).toEqual(demoDesignerForm.sections);
    expect(copy.sections).not.toBe(demoDesignerForm.sections);
  });

  it('adds an approved component and reports a missing label', () => {
    const next = addField(demoDesignerForm, 'APPLICANT', 'TEXT_INPUT');
    expect(next.sections[0]?.fields.map((field) => field.fieldKey)).toContain('TEXT_INPUT');
    const broken = {
      ...next,
      sections: next.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) =>
          field.fieldKey === 'TEXT_INPUT' ? { ...field, label: '' } : field
        )
      }))
    };
    expect(collectFormIssues(broken).some((issue) => issue.message.includes('programmatic label'))).toBe(true);
  });

  it('reorders fields within a section', () => {
    const moved = moveField(demoDesignerForm, 'APPLICANT', 'RECEIPT_NUMBER', -1);
    expect(moved.sections[0]?.fields.map((field) => field.fieldKey)).toEqual(['RECEIPT_NUMBER', 'A_NUMBER']);
  });

  it('duplicates a field with a new key and path after the source', () => {
    const duplicated = duplicateField(demoDesignerForm, 'APPLICANT', 'RECEIPT_NUMBER');
    expect(duplicated?.fieldKey).toBe('RECEIPT_NUMBER_2');
    expect(duplicated?.form.sections[0]?.fields.map((field) => field.fieldKey)).toEqual([
      'A_NUMBER',
      'RECEIPT_NUMBER',
      'RECEIPT_NUMBER_2'
    ]);
    const copy = duplicated?.form.sections[0]?.fields.find((field) => field.fieldKey === 'RECEIPT_NUMBER_2');
    expect(copy?.path).toBe('$.receiptNumber2');
    expect(copy?.label).toBe('Receipt Number (copy)');
  });

  it('pastes a shared-root field with a unique shared path', () => {
    const source = {
      fieldKey: 'WORKLOAD_STATUS',
      path: '$.workload.workloadStatus',
      component: 'SELECT',
      label: 'Workload Status',
      options: [
        { value: 'Accepted', label: 'Accepted' },
        { value: 'Rejected', label: 'Rejected' }
      ]
    };
    const existing = ['WORKLOAD_STATUS'];
    const cloned = cloneFieldDefinition(source, existing);
    expect(cloned.fieldKey).toBe('WORKLOAD_STATUS_2');
    expect(cloned.path).toBe('$.workload.workloadStatus2');
    const pasted = insertClonedField(demoDesignerForm, 'APPLICANT', source);
    expect(pasted.form.sections[0]?.fields.some((field) => field.fieldKey === pasted.fieldKey)).toBe(true);
  });

  it('pastes and removes multiple fields together', () => {
    const sources = demoDesignerForm.sections[0]!.fields;
    const pasted = insertClonedFields(demoDesignerForm, 'APPLICANT', sources, {
      afterFieldKey: 'RECEIPT_NUMBER'
    });
    expect(pasted.fieldKeys).toHaveLength(2);
    expect(pasted.form.sections[0]?.fields.map((field) => field.fieldKey)).toEqual([
      'A_NUMBER',
      'RECEIPT_NUMBER',
      'A_NUMBER_2',
      'RECEIPT_NUMBER_2'
    ]);
    const duplicated = duplicateFields(demoDesignerForm, 'APPLICANT', ['A_NUMBER', 'RECEIPT_NUMBER']);
    expect(duplicated?.fieldKeys).toEqual(['A_NUMBER_2', 'RECEIPT_NUMBER_2']);
    const removed = removeFields(pasted.form, 'APPLICANT', pasted.fieldKeys);
    expect(removed.sections[0]?.fields.map((field) => field.fieldKey)).toEqual(['A_NUMBER', 'RECEIPT_NUMBER']);
  });

  it('moves a field to an explicit index', () => {
    const moved = moveFieldToIndex(demoDesignerForm, 'APPLICANT', 'RECEIPT_NUMBER', 0);
    expect(moved.sections[0]?.fields.map((field) => field.fieldKey)).toEqual(['RECEIPT_NUMBER', 'A_NUMBER']);
  });

  it('reorders sections', () => {
    const withSecond = addSection(demoDesignerForm);
    expect(withSecond.sections.map((section) => section.sectionKey)).toEqual(['APPLICANT', 'SECTION']);
    const moved = moveSection(withSecond, 'SECTION', -1);
    expect(moved.sections.map((section) => section.sectionKey)).toEqual(['SECTION', 'APPLICANT']);
  });

  it('renames a field key and retargets behavior effects', () => {
    const withBehavior = {
      ...demoDesignerForm,
      behaviors: [
        {
          behaviorKey: 'SHOW_RECEIPT',
          when: { path: '$.status', operator: 'EQUALS', value: 'READY' },
          effects: [{ fieldKey: 'RECEIPT_NUMBER', visible: true }]
        }
      ]
    };
    const renamed = renameFieldKey(withBehavior, 'APPLICANT', 'RECEIPT_NUMBER', 'RECEIPT');
    expect(renamed.sections[0]?.fields.map((field) => field.fieldKey)).toEqual(['A_NUMBER', 'RECEIPT']);
    expect(renamed.behaviors?.[0]?.effects[0]?.fieldKey).toBe('RECEIPT');
    expect(renamed.sections[0]?.fields.find((field) => field.fieldKey === 'RECEIPT')?.path).toBe('$.receipt');
  });

  it('seeds radio buttons with two labeled choices', () => {
    const next = addField(demoDesignerForm, 'APPLICANT', 'RADIO');
    const field = next.sections[0]?.fields.find((item) => item.fieldKey === 'RADIO');
    expect(field?.options).toEqual([
      { value: 'OPTION_1', label: 'Option 1' },
      { value: 'OPTION_2', label: 'Option 2' }
    ]);
    expect(resizeRadioOptions(field?.options, 4)).toHaveLength(4);
    expect(resizeRadioOptions(field?.options, 1)).toHaveLength(2);
    const missingChoices = {
      ...next,
      sections: next.sections.map((section) => ({
        ...section,
        fields: section.fields.map((item) => (item.fieldKey === 'RADIO' ? { ...item, options: [] } : item))
      }))
    };
    expect(collectFormIssues(missingChoices).some((issue) => issue.message.includes('two radio buttons'))).toBe(true);
  });

  it('marks a section as repeatable and seeds a tracking id field', () => {
    const withSection = addSection(demoDesignerForm);
    const next = setSectionRepeatable(withSection, 'SECTION', true);
    const section = next.sections.find((item) => item.sectionKey === 'SECTION');
    expect(section?.repeatable).toBe(true);
    expect(section?.addButtonLabel).toBe('Add Workload');
    expect(section?.path).toBe('$.workloads');
    expect(section?.fields[0]?.component).toBe('TRACKING_ID_DISPLAY');
    expect(
      collectFormIssues(next, 'WORKLOAD').some((issue) => issue.message.includes('Mail item'))
    ).toBe(true);
    expect(collectFormIssues(next, 'MAIL').some((issue) => issue.message.includes('Mail item'))).toBe(false);
    const withSpawn = {
      ...next,
      sections: next.sections.map((section) =>
        section.sectionKey === 'SECTION' ? { ...section, spawnDefinitionKey: 'I_407' } : section
      )
    };
    expect(collectFormIssues(next, 'MAIL').some((issue) => issue.message.includes('Create cases of definition'))).toBe(
      true
    );
    expect(collectFormIssues(withSpawn, 'MAIL').some((issue) => issue.path.includes('spawnDefinitionKey'))).toBe(false);
    const badSpawn = {
      ...next,
      sections: next.sections.map((section) =>
        section.sectionKey === 'SECTION' ? { ...section, spawnDefinitionKey: 'i-407' } : section
      )
    };
    expect(collectFormIssues(badSpawn, 'MAIL').some((issue) => issue.message.includes('I_407'))).toBe(true);
  });

  it('requires count and choice fields to sit outside the repeating section', () => {
    const withSection = setSectionRepeatable(addSection(demoDesignerForm), 'SECTION', true);
    const broken = {
      ...withSection,
      sections: withSection.sections.map((section) =>
        section.sectionKey === 'SECTION' ? { ...section, countFieldKey: 'TRACKING_ID' } : section
      )
    };
    expect(collectFormIssues(broken, 'MAIL').some((issue) => issue.message.includes('outside'))).toBe(true);
  });

  it('generates schema properties from field paths and repeating sections', () => {
    const withRules = {
      ...demoDesignerForm,
      sections: demoDesignerForm.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) =>
          field.fieldKey === 'RECEIPT_NUMBER'
            ? { ...field, required: true, validation: { minLength: 13, pattern: '^[A-Z0-9]+$' } }
            : field
        )
      }))
    };
    const withRepeat = setSectionRepeatable(addSection(withRules), 'SECTION', true);
    const schema = schemaFromForm(withRepeat);
    const properties = schema.properties as Record<
      string,
      { type?: string; minLength?: number; pattern?: string; items?: { properties?: Record<string, unknown> } }
    >;
    expect(properties.ANumber).toEqual({ type: 'string' });
    expect(properties.receiptNumber).toEqual({ type: 'string', minLength: 13, pattern: '^[A-Z0-9]+$' });
    expect(schema.required).toEqual(['receiptNumber']);
    expect(properties.workloads?.type).toBe('array');
    expect(properties.workloads?.items?.properties?.trackingId).toEqual({ type: 'string' });
    expect(releaseSchemaFromForm({ ...demoDesignerForm, schema }).properties).toEqual({
      dataEntryDetails: schema
    });
  });

  it('adds canvas fields that were missing from a stale schema and drops removed palette properties', () => {
    const stale = {
      ...demoDesignerForm,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ANumber: { type: 'string', description: 'Alien number' },
          textInput: { type: 'string' }
        }
      }
    };
    const properties = schemaFromForm(stale).properties as Record<string, { type?: string; description?: string }>;
    expect(properties.ANumber).toEqual({ type: 'string', description: 'Alien number' });
    expect(properties.receiptNumber).toEqual({ type: 'string' });
    expect(properties.textInput).toBeUndefined();
  });

  it('retargets the default path when renaming a generated field key', () => {
    const withText = addField(demoDesignerForm, 'APPLICANT', 'TEXT_INPUT');
    const renamed = renameFieldKey(withText, 'APPLICANT', 'TEXT_INPUT', 'BOX_NUMBER');
    expect(renamed.sections[0]?.fields.find((field) => field.fieldKey === 'BOX_NUMBER')?.path).toBe('$.boxNumber');
  });

  it('retargets generated key and path when the palette type changes', () => {
    const withText = addField(demoDesignerForm, 'APPLICANT', 'TEXT_INPUT');
    const retargeted = retargetFieldComponent(withText, 'APPLICANT', 'TEXT_INPUT', 'DATE_INPUT');
    const field = retargeted.sections[0]?.fields.find((item) => item.component === 'DATE_INPUT');
    expect(field?.fieldKey).toBe('DATE_INPUT');
    expect(field?.path).toBe('$.dateInput');
    expect(field?.label).toBe('Date');
    const customized = updateField(withText, 'APPLICANT', 'TEXT_INPUT', { path: '$.boxNumber', label: 'Box Number' });
    const kept = retargetFieldComponent(customized, 'APPLICANT', 'TEXT_INPUT', 'DATE_INPUT');
    const keptField = kept.sections[0]?.fields.find((item) => item.fieldKey === 'TEXT_INPUT');
    expect(keptField?.component).toBe('DATE_INPUT');
    expect(keptField?.path).toBe('$.boxNumber');
    expect(keptField?.label).toBe('Box Number');
  });

  it('drops text length rules when a field is retargeted to Date', () => {
    const withText = updateField(addField(demoDesignerForm, 'APPLICANT', 'TEXT_INPUT'), 'APPLICANT', 'TEXT_INPUT', {
      validation: { minLength: 3, pattern: '^A' }
    });
    const retargeted = retargetFieldComponent(withText, 'APPLICANT', 'TEXT_INPUT', 'DATE_INPUT');
    const field = retargeted.sections[0]?.fields.find((item) => item.component === 'DATE_INPUT');
    expect(field?.validation).toBeUndefined();
  });

  it('writes date bounds into generated schema and ignores leftover length rules', () => {
    const withDate = addField(demoDesignerForm, 'APPLICANT', 'DATE_INPUT');
    const dated = updateField(withDate, 'APPLICANT', 'DATE_INPUT', {
      validation: { minDate: '2020-01-01', maxDate: '2030-12-31', minLength: 8 }
    });
    const schema = schemaFromForm(dated);
    const dateInput = (schema.properties as Record<string, { format?: string; minDate?: string; maxDate?: string; minLength?: number }>)
      .dateInput;
    expect(dateInput).toEqual({
      type: 'string',
      format: 'date',
      minDate: '2020-01-01',
      maxDate: '2030-12-31'
    });
  });

  it('keeps Fill from Assigned officer on a name field', () => {
    const withText = addField(demoDesignerForm, 'APPLICANT', 'TEXT_INPUT');
    const next = updateField(withText, 'APPLICANT', 'TEXT_INPUT', { fillFrom: 'ASSIGNED_TO' });
    expect(next.sections[0]?.fields.find((field) => field.fieldKey === 'TEXT_INPUT')?.fillFrom).toBe('ASSIGNED_TO');
  });

  it('rejects Fill from Assigned officer on a receipt field', () => {
    const broken = updateField(demoDesignerForm, 'APPLICANT', 'RECEIPT_NUMBER', { fillFrom: 'ASSIGNED_TO' });
    expect(collectFormIssues(broken).some((issue) => issue.message.includes('not valid for this palette type'))).toBe(
      true
    );
  });

  it('rejects an unknown Fill from source', () => {
    const withText = addField(demoDesignerForm, 'APPLICANT', 'TEXT_INPUT');
    const broken = updateField(withText, 'APPLICANT', 'TEXT_INPUT', {
      fillFrom: 'UNKNOWN' as never
    });
    expect(collectFormIssues(broken).some((issue) => issue.message.includes('not a known source'))).toBe(true);
  });

  it('requires another date field when Fill from is Another date field', () => {
    const withDate = addField(demoDesignerForm, 'APPLICANT', 'DATE_INPUT');
    const missing = updateField(withDate, 'APPLICANT', 'DATE_INPUT', { fillFrom: 'FIELD' });
    expect(collectFormIssues(missing).some((issue) => issue.message.includes('another date field'))).toBe(true);
  });

  it('clears Fill from when the palette type no longer supports it', () => {
    const withText = addField(demoDesignerForm, 'APPLICANT', 'TEXT_INPUT');
    const filled = updateField(withText, 'APPLICANT', 'TEXT_INPUT', { fillFrom: 'ASSIGNED_TO' });
    const retargeted = retargetFieldComponent(filled, 'APPLICANT', 'TEXT_INPUT', 'DATE_INPUT');
    const dateField = retargeted.sections[0]?.fields.find((field) => field.component === 'DATE_INPUT');
    expect(dateField?.fillFrom).toBeUndefined();
  });

  it('retargets Copy from when the source date field key is renamed', () => {
    const withReceived = addField(demoDesignerForm, 'APPLICANT', 'DATE_INPUT');
    const received = withReceived.sections[0]?.fields.find((field) => field.component === 'DATE_INPUT');
    const withComplete = addField(withReceived, 'APPLICANT', 'DATE_INPUT');
    const completeKey = withComplete.sections[0]?.fields.find(
      (field) => field.component === 'DATE_INPUT' && field.fieldKey !== received?.fieldKey
    )?.fieldKey;
    const linked = updateField(withComplete, 'APPLICANT', completeKey ?? '', {
      fillFrom: 'FIELD',
      fillFromFieldKey: received?.fieldKey
    });
    const renamed = renameFieldKey(linked, 'APPLICANT', received?.fieldKey ?? '', 'RECEIVED_DATE');
    const complete = renamed.sections[0]?.fields.find((field) => field.fieldKey === completeKey);
    expect(complete?.fillFromFieldKey).toBe('RECEIVED_DATE');
  });

  it('rejects an earliest date after the latest date', () => {
    const withDate = addField(demoDesignerForm, 'APPLICANT', 'DATE_INPUT');
    const dated = updateField(withDate, 'APPLICANT', 'DATE_INPUT', {
      validation: { minDate: '2030-01-01', maxDate: '2020-01-01' }
    });
    expect(collectFormIssues(dated).some((issue) => issue.message.includes('earliest date'))).toBe(true);
  });

  it('unions every form into one release schema', () => {
    const intake = {
      ...demoDesignerForm,
      formKey: 'MAIL_INTAKE',
      dataPath: '$.mailDetails',
      schema: {
        type: 'object',
        properties: { receiptNumber: { type: 'string' } },
        required: ['receiptNumber']
      }
    };
    const review = {
      ...demoDesignerForm,
      formKey: 'MAIL_REVIEW',
      dataPath: '$.reviewDetails',
      schema: { type: 'object', properties: { decision: { type: 'string' } } }
    };
    const merged = releaseSchemaFromForms({ MAIL_INTAKE: intake, MAIL_REVIEW: review });
    expect(merged?.properties).toEqual({
      mailDetails: intake.schema,
      reviewDetails: review.schema
    });
    expect(merged?.required).toBeUndefined();
  });

  it('merges properties when two forms share a dataPath', () => {
    const first = {
      ...demoDesignerForm,
      formKey: 'PART_A',
      dataPath: '$.details',
      schema: {
        type: 'object',
        properties: { a: { type: 'string' }, shared: { type: 'string', minLength: 2 } },
        required: ['a']
      }
    };
    const second = {
      ...demoDesignerForm,
      formKey: 'PART_B',
      dataPath: '$.details',
      schema: {
        type: 'object',
        properties: { b: { type: 'number' }, shared: { type: 'string', pattern: '^[A-Z]+$' } },
        required: ['b']
      }
    };
    const merged = releaseSchemaFromForms({ PART_A: first, PART_B: second });
    expect(merged?.properties).toEqual({
      details: {
        type: 'object',
        properties: {
          a: { type: 'string' },
          shared: { type: 'string', minLength: 2, pattern: '^[A-Z]+$' },
          b: { type: 'number' }
        },
        required: ['a', 'b']
      }
    });
  });

  it('keeps a form without its own schema by reading the existing release slice', () => {
    const existing = {
      type: 'object',
      additionalProperties: false,
      properties: {
        mailDetails: { type: 'object', properties: { receiptNumber: { type: 'string' } } }
      }
    };
    const intake = { ...demoDesignerForm, formKey: 'MAIL_INTAKE', dataPath: '$.mailDetails' };
    const review = {
      ...demoDesignerForm,
      formKey: 'MAIL_REVIEW',
      dataPath: '$.reviewDetails',
      schema: { type: 'object', properties: { decision: { type: 'string' } } }
    };
    const merged = releaseSchemaFromForms({ MAIL_INTAKE: intake, MAIL_REVIEW: review }, existing);
    expect(schemaAtDataPath(merged, '$.mailDetails')).toEqual({
      type: 'object',
      properties: { receiptNumber: { type: 'string' } }
    });
    expect(schemaAtDataPath(merged, '$.reviewDetails')).toEqual(review.schema);
  });
});
