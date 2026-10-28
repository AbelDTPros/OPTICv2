import { useEffect, useRef } from 'react';
import {
  fieldStoragePath,
  formHasSharedEntityFields
} from '../../../../src/modules/configuration/domain/shared-entity-paths.js';
import type { FormFieldDefinition, JsonSchema, StageFormDefinition } from '../../../../src/modules/configuration/domain/types.js';
import { ErrorFieldLink } from '../accessibility/ErrorFieldLink.js';
import { focusFormField } from '../accessibility/focus-field.js';
import { fieldInputId } from '../accessibility/field-ids.js';
import {
  displayFromStoragePath,
  formHasDisplayFromFields
} from '../../../../src/modules/configuration/domain/display-from.js';
import { ErrorHeading } from '../ui/Icon.js';
import { FieldControl } from './FieldControl.js';
import { displayValueForField, setByJsonPath, valueAtDataPath, wrapAtDataPath } from './json-path.js';
import { RepeatingSection } from './RepeatingSection.js';
import { resolveFieldStates } from './resolve-field-state.js';

export interface FormFieldError {
  fieldKey: string;
  message: string;
  inputId?: string;
}

export interface DynamicFormRendererProps {
  form: StageFormDefinition;
  schema?: JsonSchema;
  /**
   * Form-scoped object at dataPath, or full case businessData when shared-root fields /
   * businessData are in use.
   */
  value: unknown;
  /**
   * Full case businessData for behavior When paths and shared-root fields.
   * When omitted, value is wrapped under form.dataPath.
   */
  businessData?: unknown;
  /** All forms on the release — needed to resolve Display from form/field links. */
  releaseForms?: Record<string, StageFormDefinition>;
  workflowContext?: Record<string, unknown>;
  errors?: FormFieldError[];
  errorSummary?: string;
  headingLevel?: 1 | 2;
  readOnly?: boolean;
  onChange: (next: unknown) => void;
}

export function DynamicFormRenderer({
  form,
  schema,
  value,
  businessData,
  releaseForms,
  workflowContext,
  errors = [],
  errorSummary,
  headingLevel = 1,
  readOnly,
  onChange
}: DynamicFormRendererProps) {
  const titleId = `form-${form.formKey}-title`;
  const summaryId = `form-${form.formKey}-errors`;
  const formsForDisplay = { ...(releaseForms ?? {}), [form.formKey]: form };
  const emitCaseShape =
    businessData !== undefined || formHasSharedEntityFields(form) || formHasDisplayFromFields(form);
  const caseValue = resolveCaseValue(form, value, businessData, emitCaseShape);
  const states = resolveFieldStates(form, valueAtDataPath(caseValue, form.dataPath || '$'), workflowContext, {
    forceReadOnly: readOnly,
    businessData: caseValue
  });
  const errorByField = new Map(errors.map((error) => [error.fieldKey, error.message]));
  const visibleErrors = errors.filter((error) => states[error.fieldKey]?.visible !== false);
  const TitleTag = headingLevel === 1 ? 'h1' : 'h2';
  const SectionTag = headingLevel === 1 ? 'h2' : 'h3';
  const summaryRef = useRef<HTMLDivElement>(null);
  const errorSignature = visibleErrors.map((error) => `${error.fieldKey}:${error.message}`).join('|');

  useEffect(() => {
    if (!errorSummary && visibleErrors.length === 0) {
      return;
    }
    const summary = summaryRef.current;
    summary?.focus({ preventScroll: true });
    const first = visibleErrors[0];
    if (!first) {
      return;
    }
    const inputId = first.inputId ?? fieldInputId(first.fieldKey);
    window.setTimeout(() => {
      focusFormField(inputId);
    }, 120);
  }, [errorSignature, errorSummary, visibleErrors.length]);

  function fieldValue(field: FormFieldDefinition): unknown {
    const displayFromPath = displayFromStoragePath(field, formsForDisplay);
    if (displayFromPath) {
      return displayValueForField(field, caseValue, workflowContext, {
        form,
        releaseForms: formsForDisplay,
        displayFromPath
      });
    }
    const storagePath = fieldStoragePath(form, field);
    return displayValueForField({ ...field, path: storagePath }, caseValue, workflowContext, {
      form,
      releaseForms: formsForDisplay
    });
  }

  function patchField(field: FormFieldDefinition, next: unknown): void {
    if (displayFromStoragePath(field, formsForDisplay)) {
      return;
    }
    const storagePath = fieldStoragePath(form, field);
    const nextCase = setByJsonPath(caseValue, storagePath, next);
    if (emitCaseShape) {
      onChange(nextCase);
      return;
    }
    onChange(valueAtDataPath(nextCase, form.dataPath || '$'));
  }

  return (
    <form
      className="optic-form"
      aria-labelledby={titleId}
      aria-describedby={errorSummary || visibleErrors.length ? summaryId : undefined}
      noValidate
      onSubmit={(event) => event.preventDefault()}
    >
      <header className="optic-form-header">
        <div>
          <TitleTag id={titleId}>{form.title}</TitleTag>
          <p className="optic-form-key">{form.formKey}</p>
        </div>
      </header>
      {errorSummary || visibleErrors.length > 0 ? (
        <div
          className="optic-error-summary"
          id={summaryId}
          role="alert"
          tabIndex={-1}
          ref={summaryRef}
          aria-live="assertive"
        >
          <ErrorHeading />
          <p>
            {errorSummary ?? 'Review the highlighted fields and try again.'}
            {visibleErrors.length > 0
              ? ` ${visibleErrors.length} ${visibleErrors.length === 1 ? 'field needs' : 'fields need'} attention.`
              : ''}
          </p>
          {visibleErrors.length > 0 ? (
            <ul>
              {visibleErrors.map((error) => {
                const inputId = error.inputId ?? fieldInputId(error.fieldKey);
                return (
                  <li key={error.fieldKey}>
                    <ErrorFieldLink inputId={inputId}>{error.message}</ErrorFieldLink>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
      {form.sections.map((section) =>
        section.repeatable ? (
          <RepeatingSection
            key={section.sectionKey}
            form={form}
            section={section}
            schema={schema ?? form.schema}
            value={valueAtDataPath(caseValue, form.dataPath || '$')}
            states={states}
            headingId={`section-${section.sectionKey}-title`}
            HeadingTag={SectionTag}
            readOnly={readOnly}
            onChange={(nextSlice) => {
              const nextCase = {
                ...(caseValue as Record<string, unknown>),
                ...wrapAtDataPath(form.dataPath || '$', nextSlice)
              };
              if (emitCaseShape) {
                onChange(nextCase);
                return;
              }
              onChange(nextSlice);
            }}
          />
        ) : (
          <section
            key={section.sectionKey}
            className={`optic-section optic-section-${(section.layout ?? 'ONE_COLUMN').toLowerCase()}`}
            aria-labelledby={`section-${section.sectionKey}-title`}
          >
            <SectionTag id={`section-${section.sectionKey}-title`}>{section.title}</SectionTag>
            <div className="optic-fields">
              {section.fields.map((field) => {
                const state = states[field.fieldKey] ?? { visible: true, required: false, readOnly: false };
                if (!state.visible) {
                  return null;
                }
                return (
                  <FieldControl
                    key={field.fieldKey}
                    field={field}
                    state={state}
                    schema={schema ?? form.schema}
                    value={fieldValue(field)}
                    error={errorByField.get(field.fieldKey)}
                    onChange={(next) => patchField(field, next)}
                  />
                );
              })}
            </div>
          </section>
        )
      )}
    </form>
  );
}

function resolveCaseValue(
  form: StageFormDefinition,
  value: unknown,
  businessData: unknown,
  emitCaseShape: boolean
): Record<string, unknown> {
  if (!emitCaseShape) {
    return wrapAtDataPath(form.dataPath || '$', value ?? {});
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const dataTop = (form.dataPath || '$').replace(/^\$\.?/, '').split('.').filter(Boolean)[0];
    // Live editors pass the full case (dataPath root and/or shared roots present).
    // A dataPath-only slice must not win over businessData — earlier-stage read-only
    // views used to look empty for forms with $.workload / $.mailItem fields.
    if (!dataTop || dataTop in record || recordHasSharedEntityRoot(record)) {
      return record;
    }
  }
  if (businessData !== null && typeof businessData === 'object' && !Array.isArray(businessData)) {
    return businessData as Record<string, unknown>;
  }
  return wrapAtDataPath(form.dataPath || '$', value ?? {});
}

function recordHasSharedEntityRoot(record: Record<string, unknown>): boolean {
  return 'workload' in record || 'mailItem' in record;
}

