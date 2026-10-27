import { fieldInputId, validationFailed } from '../errors/app-error.js';
import type { StageFormDefinition } from '../../modules/configuration/domain/types.js';

const ALLOWED_COMPONENTS = new Set([
  'TEXT_INPUT',
  'TEXT_AREA',
  'NUMBER_INPUT',
  'CURRENCY_INPUT',
  'DATE_INPUT',
  'BOOLEAN_CHECKBOX',
  'YES_NO_RADIO',
  'RADIO',
  'SELECT',
  'MULTI_SELECT',
  'A_NUMBER_INPUT',
  'RECEIPT_NUMBER_INPUT',
  'TRACKING_ID_DISPLAY',
  'USER_DISPLAY',
  'USER_LOOKUP',
  'READ_ONLY_VALUE',
  'ALERT',
  'SECTION'
]);

const SENSITIVE_CLASSIFICATIONS = new Set(['PII', 'SENSITIVE']);

export function assertFormAccessibility(
  form: StageFormDefinition,
  options?: { entityType?: string }
): void {
  const details: Array<{ field: string; path: string; message: string; inputId?: string }> = [];

  if (!form.title?.trim()) {
    details.push({
      field: 'title',
      path: 'title',
      message: 'Form title is required so the page can expose an accessible heading.',
      inputId: fieldInputId('title')
    });
  }

  const fieldKeys = new Set<string>();
  const repeatingPaths = new Set<string>();
  for (const [sectionIndex, section] of form.sections.entries()) {
    if (!section.sectionKey) {
      details.push({
        field: 'sectionKey',
        path: `sections.${sectionIndex}.sectionKey`,
        message: 'Each section must have a stable sectionKey.'
      });
    }
    if (!section.title?.trim()) {
      details.push({
        field: 'title',
        path: `sections.${sectionIndex}.title`,
        message: 'Each section must have a visible title. Status cannot be conveyed by layout or color alone.',
        inputId: fieldInputId(`section-${section.sectionKey || sectionIndex}-title`)
      });
    }

    if (section.repeatable) {
      if (options?.entityType && options.entityType !== 'MAIL') {
        details.push({
          field: 'repeatable',
          path: `sections.${sectionIndex}.repeatable`,
          message: 'Repeatable sections are only allowed on Mail item forms.',
          inputId: fieldInputId(`section-${section.sectionKey || sectionIndex}-title`)
        });
      }
      if (!section.path?.trim() || !section.path.startsWith('$.')) {
        details.push({
          field: 'path',
          path: `sections.${sectionIndex}.path`,
          message: `Repeatable section ${section.sectionKey || sectionIndex} needs a JSONPath for the workload array.`,
          inputId: fieldInputId(`section-${section.sectionKey || sectionIndex}-title`)
        });
      } else if (repeatingPaths.has(section.path)) {
        details.push({
          field: 'path',
          path: `sections.${sectionIndex}.path`,
          message: `Duplicate repeating path ${section.path}.`,
          inputId: fieldInputId(`section-${section.sectionKey || sectionIndex}-title`)
        });
      } else {
        repeatingPaths.add(section.path);
      }
      if ((section.fields ?? []).length === 0) {
        details.push({
          field: 'fields',
          path: `sections.${sectionIndex}.fields`,
          message: `Repeatable section ${section.sectionKey || sectionIndex} must contain at least one field.`,
          inputId: fieldInputId(`section-${section.sectionKey || sectionIndex}-title`)
        });
      }
    }

    for (const [fieldIndex, field] of (section.fields ?? []).entries()) {
      const pathPrefix = `sections.${sectionIndex}.fields.${fieldIndex}`;
      if (!field.fieldKey) {
        details.push({
          field: 'fieldKey',
          path: `${pathPrefix}.fieldKey`,
          message: 'Each field must have a stable fieldKey used as the accessible input id.'
        });
        continue;
      }
      if (fieldKeys.has(field.fieldKey)) {
        details.push({
          field: 'fieldKey',
          path: `${pathPrefix}.fieldKey`,
          message: `Duplicate fieldKey ${field.fieldKey} is not allowed.`,
          inputId: fieldInputId(field.fieldKey)
        });
      }
      fieldKeys.add(field.fieldKey);

      if (!field.label?.trim()) {
        details.push({
          field: 'label',
          path: `${pathPrefix}.label`,
          message: `Field ${field.fieldKey} must have a programmatic label (WCAG 2.1 AA / Section 508).`,
          inputId: fieldInputId(field.fieldKey)
        });
      }

      if (field.component && !ALLOWED_COMPONENTS.has(field.component)) {
        details.push({
          field: 'component',
          path: `${pathPrefix}.component`,
          message: `Component ${field.component} is not in the accessible component library.`,
          inputId: fieldInputId(field.fieldKey)
        });
      }

      if (field.component === 'RADIO') {
        const options = field.options ?? [];
        if (options.length < 2) {
          details.push({
            field: 'options',
            path: `${pathPrefix}.options`,
            message: `Radio field ${field.fieldKey} must have at least two choices.`,
            inputId: fieldInputId(field.fieldKey)
          });
        }
        const values = new Set<string>();
        for (const [optionIndex, option] of options.entries()) {
          if (!option.label?.trim() || !option.value?.trim()) {
            details.push({
              field: 'options',
              path: `${pathPrefix}.options.${optionIndex}`,
              message: `Radio choice ${optionIndex + 1} on ${field.fieldKey} needs a label and a stored value.`,
              inputId: fieldInputId(field.fieldKey)
            });
          }
          if (option.value?.trim()) {
            if (values.has(option.value)) {
              details.push({
                field: 'options',
                path: `${pathPrefix}.options.${optionIndex}`,
                message: `Radio field ${field.fieldKey} has a duplicate stored value ${option.value}.`,
                inputId: fieldInputId(field.fieldKey)
              });
            }
            values.add(option.value);
          }
        }
      }

      if (field.piiClassification && SENSITIVE_CLASSIFICATIONS.has(field.piiClassification) && !field.splunkPolicy) {
        details.push({
          field: 'splunkPolicy',
          path: `${pathPrefix}.splunkPolicy`,
          message: `Sensitive field ${field.fieldKey} must declare a Splunk masking policy.`,
          inputId: fieldInputId(field.fieldKey)
        });
      }
    }
  }

  if (details.length > 0) {
    throw validationFailed(
      'OPTIC-CONFIG-40010',
      'This form cannot be saved because it would produce an inaccessible user interface.',
      details
    );
  }
}
