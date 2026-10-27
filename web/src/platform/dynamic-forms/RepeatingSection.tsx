import type {
  FormFieldDefinition,
  FormSectionDefinition,
  JsonSchema,
  StageFormDefinition
} from '../../../../src/modules/configuration/domain/types.js';
import type { FieldRuntimeState } from './resolve-field-state.js';
import { FieldControl } from './FieldControl.js';
import { getByJsonPath, setByJsonPath } from './json-path.js';
import {
  addButtonLabel,
  appendRepeatingItems,
  itemLabel,
  MAX_REPEATING_ITEMS,
  readCountFieldValue,
  readRepeatingItems,
  repeatingAddCount,
  writeRepeatingItems
} from './repeating-section.js';

export function RepeatingSection({
  form,
  section,
  schema,
  value,
  states,
  headingId,
  HeadingTag,
  readOnly,
  onChange
}: {
  form: StageFormDefinition;
  section: FormSectionDefinition;
  schema?: JsonSchema;
  value: unknown;
  states: Record<string, FieldRuntimeState>;
  headingId: string;
  HeadingTag: 'h2' | 'h3';
  readOnly?: boolean;
  onChange: (next: unknown) => void;
}) {
  const items = readRepeatingItems(value, section);
  const addLabel = addButtonLabel(section);
  const copyLabel = itemLabel(section);
  const targetCount = section.matchCountField ? readCountFieldValue(value, form, section) : undefined;
  const canAdd = repeatingAddCount(value, form, section) > 0 && items.length < MAX_REPEATING_ITEMS;

  function updateItem(index: number, field: FormFieldDefinition, nextValue: unknown) {
    const nextItems = readRepeatingItems(value, section);
    const current = nextItems[index] ?? {};
    nextItems[index] = setByJsonPath(current, field.path, nextValue) as Record<string, unknown>;
    onChange(writeRepeatingItems(value, section, nextItems));
  }

  return (
    <section
      className={`optic-section optic-section-${(section.layout ?? 'ONE_COLUMN').toLowerCase()} optic-repeating-section`}
      aria-labelledby={headingId}
    >
      <HeadingTag id={headingId}>{section.title}</HeadingTag>
      {items.map((item, index) => (
        <fieldset key={`${copyLabel}-${index}`} className="optic-repeating-item">
          <legend>
            {copyLabel} {index + 1}
          </legend>
          {readOnly ? null : (
            <div className="optic-repeating-item-actions">
              <button
                type="button"
                className="optic-designer-quiet-button"
                aria-label={`Remove ${copyLabel} ${index + 1}`}
                onClick={() => {
                  const nextItems = readRepeatingItems(value, section).filter((_, itemIndex) => itemIndex !== index);
                  onChange(writeRepeatingItems(value, section, nextItems));
                }}
              >
                Remove {copyLabel} {index + 1}
              </button>
            </div>
          )}
          <div className="optic-fields">
            {section.fields.map((field) => {
              const state = states[field.fieldKey] ?? { visible: true, required: false, readOnly: false };
              if (!state.visible) {
                return null;
              }
              const instanceKey = `${section.sectionKey}-${index}-${field.fieldKey}`;
              return (
                <FieldControl
                  key={instanceKey}
                  field={field}
                  instanceKey={instanceKey}
                  state={state}
                  schema={schema}
                  value={getByJsonPath(item, field.path)}
                  onChange={(nextValue) => updateItem(index, field, nextValue)}
                />
              );
            })}
          </div>
        </fieldset>
      ))}
      {readOnly ? null : (
        <>
          {section.matchCountField && typeof targetCount === 'number' ? (
            <p className="optic-help">
              {items.length === targetCount
                ? `${items.length} of ${targetCount} ${copyLabel.toLowerCase()} copies ready.`
                : `Need ${targetCount} ${copyLabel.toLowerCase()} copies (currently ${items.length}).`}
            </p>
          ) : null}
          <button
            type="button"
            className="optic-button-primary"
            disabled={!canAdd}
            onClick={() => {
              onChange(appendRepeatingItems(value, form, section));
            }}
          >
            {addLabel}
          </button>
        </>
      )}
    </section>
  );
}
