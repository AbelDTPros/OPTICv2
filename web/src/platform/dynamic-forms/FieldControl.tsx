import type { FormFieldDefinition, JsonSchema } from '../../../../src/modules/configuration/domain/types.js';
import { describedBy, fieldErrorId, fieldHelpId, fieldInputId } from '../accessibility/field-ids.js';
import { TrackingIdLinkWithCopy } from '../tracking/TrackingIdDisplay.js';
import type { FieldRuntimeState } from './resolve-field-state.js';

export interface FieldError {
  fieldKey: string;
  message: string;
}

interface FieldControlProps {
  field: FormFieldDefinition;
  value: unknown;
  state: FieldRuntimeState;
  error?: string;
  schema?: JsonSchema;
  instanceKey?: string;
  onChange: (next: unknown) => void;
}

export function FieldControl({ field, value, state, error, schema, instanceKey, onChange }: FieldControlProps) {
  const idKey = instanceKey ?? field.fieldKey;
  const inputId = fieldInputId(idKey);
  const described = describedBy(idKey, Boolean(field.helpText), Boolean(error));
  const options = field.options ?? enumOptions(schema, field.path);

  return (
    <div
      className="optic-field"
      data-width={field.width ?? 12}
      data-invalid={error ? 'true' : undefined}
      data-readonly={state.readOnly ? 'true' : undefined}
    >
      {field.component === 'YES_NO_RADIO' || field.component === 'RADIO' ? (
        <div id={`${inputId}-legend`} className="optic-field-legend">
          {field.label}
          <RequiredMark required={state.required} />
        </div>
      ) : field.component !== 'ALERT' ? (
        <label htmlFor={inputId}>
          {field.label}
          <RequiredMark required={state.required} />
        </label>
      ) : null}
      {renderInput(field, {
        id: inputId,
        value,
        readOnly: state.readOnly,
        required: state.required,
        invalid: Boolean(error),
        describedBy: described,
        errorId: error ? fieldErrorId(idKey) : undefined,
        options,
        onChange
      })}
      {field.helpText ? (
        <p className="optic-help" id={fieldHelpId(idKey)}>
          {field.helpText}
        </p>
      ) : null}
      {error ? (
        <p className="optic-error" id={fieldErrorId(idKey)} role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface InputProps {
  id: string;
  value: unknown;
  readOnly: boolean;
  required: boolean;
  invalid: boolean;
  describedBy?: string;
  errorId?: string;
  options: Array<{ value: string; label: string }>;
  onChange: (next: unknown) => void;
}

function renderInput(field: FormFieldDefinition, props: InputProps) {
  const common = {
    id: props.id,
    name: field.fieldKey,
    readOnly: props.readOnly,
    disabled: props.readOnly && isDisabledWhenReadOnly(field.component),
    required: props.required,
    'aria-required': props.required ? true : undefined,
    'aria-invalid': props.invalid ? true : undefined,
    'aria-errormessage': props.errorId,
    'aria-describedby': props.describedBy
  };

  const text = stringify(props.value);

  switch (field.component) {
    case 'TEXT_AREA':
      return (
        <textarea
          {...common}
          rows={field.rows ?? 4}
          minLength={field.validation?.minLength}
          maxLength={field.validation?.maxLength}
          value={text}
          onChange={(event) => props.onChange(event.target.value)}
        />
      );
    case 'NUMBER_INPUT':
    case 'CURRENCY_INPUT':
      return (
        <input
          {...common}
          type="number"
          inputMode="decimal"
          min={field.validation?.minimum}
          max={field.validation?.maximum}
          value={typeof props.value === 'number' ? props.value : text}
          onChange={(event) => props.onChange(event.target.value === '' ? '' : Number(event.target.value))}
        />
      );
    case 'DATE_INPUT':
      return (
        <input
          {...common}
          type="date"
          min={field.validation?.minDate}
          max={field.validation?.maxDate}
          value={text}
          onChange={(event) => props.onChange(event.target.value)}
        />
      );
    case 'BOOLEAN_CHECKBOX':
      return (
        <input
          {...common}
          className="optic-checkbox-input"
          type="checkbox"
          checked={props.value === true}
          onChange={(event) => props.onChange(event.target.checked)}
        />
      );
    case 'YES_NO_RADIO':
      return renderRadioGroup(field, props, [
        { value: 'Yes', label: 'Yes' },
        { value: 'No', label: 'No' }
      ]);
    case 'RADIO':
      return renderRadioGroup(field, props, props.options);
    case 'SELECT':
      return (
        <select
          {...common}
          value={text}
          onChange={(event) => props.onChange(event.target.value)}
        >
          <option value="">Select…</option>
          {props.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    case 'MULTI_SELECT':
      return (
        <select
          {...common}
          multiple
          value={Array.isArray(props.value) ? props.value.map(String) : []}
          onChange={(event) =>
            props.onChange(Array.from(event.target.selectedOptions).map((option) => option.value))
          }
        >
          {props.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    case 'A_NUMBER_INPUT':
      return (
        <input
          {...common}
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="A123456789"
          minLength={field.validation?.minLength}
          maxLength={field.validation?.maxLength}
          pattern={field.validation?.pattern}
          value={text}
          onChange={(event) => props.onChange(event.target.value.toUpperCase())}
        />
      );
    case 'RECEIPT_NUMBER_INPUT':
      return (
        <input
          {...common}
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="ABC1234567890"
          minLength={field.validation?.minLength}
          maxLength={field.validation?.maxLength}
          pattern={field.validation?.pattern}
          value={text}
          onChange={(event) => props.onChange(event.target.value.toUpperCase())}
        />
      );
    case 'TRACKING_ID_DISPLAY':
      return text ? (
        <div id={props.id} className="optic-readonly optic-tracking-readonly">
          <TrackingIdLinkWithCopy trackingId={text} />
        </div>
      ) : (
        <p id={props.id} className="optic-readonly">
          —
        </p>
      );
    case 'READ_ONLY_VALUE':
    case 'USER_DISPLAY':
      return (
        <p id={props.id} className="optic-readonly">
          {text || '—'}
        </p>
      );
    case 'ALERT':
      return (
        <p id={props.id} className="optic-alert" role="status">
          {field.helpText ?? field.label}
        </p>
      );
    case 'USER_LOOKUP':
    case 'TEXT_INPUT':
    default:
      return (
        <input
          {...common}
          type="text"
          minLength={field.validation?.minLength}
          maxLength={field.validation?.maxLength}
          pattern={field.validation?.pattern}
          value={text}
          onChange={(event) => props.onChange(event.target.value)}
        />
      );
  }
}

function isDisabledWhenReadOnly(component: string): boolean {
  return (
    component === 'SELECT' ||
    component === 'MULTI_SELECT' ||
    component === 'BOOLEAN_CHECKBOX' ||
    component === 'RADIO' ||
    component === 'YES_NO_RADIO'
  );
}

function renderRadioGroup(
  field: FormFieldDefinition,
  props: InputProps,
  choices: Array<{ value: string; label: string }>
) {
  const text = stringify(props.value);
  return (
    <div
      id={props.id}
      role="radiogroup"
      aria-labelledby={`${props.id}-legend`}
      aria-required={props.required || undefined}
      aria-invalid={props.invalid || undefined}
      aria-errormessage={props.errorId}
      aria-describedby={props.describedBy}
    >
      {choices.map((choice) => (
        <label key={choice.value} className="optic-radio">
          <input
            type="radio"
            name={props.id}
            value={choice.value}
            checked={text === choice.value}
            disabled={props.readOnly}
            onChange={() => props.onChange(choice.value)}
          />
          {choice.label}
        </label>
      ))}
    </div>
  );
}

function RequiredMark({ required }: { required?: boolean }) {
  if (!required) {
    return null;
  }
  return (
    <>
      <span className="optic-required" aria-hidden="true">
        {' '}
        *
      </span>
      <span className="optic-visually-hidden"> required</span>
    </>
  );
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

function enumOptions(schema: JsonSchema | undefined, path: string): Array<{ value: string; label: string }> {
  if (!schema || typeof schema !== 'object') {
    return [];
  }
  const name = path.replace(/^\$\./, '').split('.').pop();
  const properties = (schema.properties ?? {}) as Record<string, { enum?: unknown[] }>;
  const values = name ? properties[name]?.enum : undefined;
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((value) => ({ value: String(value), label: String(value) }));
}
