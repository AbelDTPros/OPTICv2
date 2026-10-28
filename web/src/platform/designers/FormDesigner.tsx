import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { validationForComponent, validationRuleFamily } from '../../../../src/modules/configuration/domain/field-validation.js';
import {
  fillFromOptionsForComponent,
  isFillFromSource,
  listFillFromDateFields
} from '../../../../src/modules/configuration/domain/fill-from.js';
import type {
  FormBehaviorDefinition,
  FormFieldDefinition,
  PacketFieldBinding,
  PacketFieldBindingMode,
  StageFormDefinition
} from '../../../../src/modules/configuration/domain/types.js';
import { DynamicFormRenderer } from '../dynamic-forms/DynamicFormRenderer.js';
import {
  addField,
  addSection,
  collectFormIssues,
  defaultRadioOptions,
  insertClonedFields,
  moveField,
  moveFieldToIndex,
  moveSection,
  moveSectionToIndex,
  RADIO_CHOICE_MAX,
  RADIO_CHOICE_MIN,
  removeFields,
  removeSection,
  renameFieldKey,
  resizeRadioOptions,
  retargetFieldComponent,
  schemaFromForm,
  setSectionRepeatable,
  updateField,
  updateSection
} from './form-model.js';
import type { DisplayError } from '../api/apply-api-error.js';
import { CaughtErrorBanner } from '../ui/CaughtErrorBanner.js';
import { ErrorSummary } from '../ui/ErrorSummary.js';
import { ButtonLabel } from '../ui/Icon.js';
import { PALETTE_COMPONENTS, paletteLabel, paletteOptions } from './palette.js';
import { emptyPredicate, RuleExpressionEditor } from './RuleExpressionEditor.js';
import { getRelease, listDefinitions, listReleaseCatalog } from './config-api.js';
import { isFormDirty } from './designer-dirty.js';
import {
  collectChildPacketBindingHints,
  collectParentPacketBindingHints,
  hintsForField,
  packetBindingChipLabel,
  packetBindingDetail,
  packetBindingModeLabel,
  packetBindingModeSummary,
  type PacketBindingFieldHint
} from './packet-binding-hints.js';
import { SaveDraftButton } from './SaveDraftButton.js';
import { listRulePathOptions } from './workflow-model.js';

export type DesignerSelection =
  | { type: 'section'; sectionKey: string }
  | { type: 'field'; sectionKey: string; fieldKey: string; fieldKeys: string[] }
  | null;

export interface FormDesignerProps {
  form: StageFormDefinition;
  /** Current definition key (needed so workload forms can show inbound packet binding hints). */
  definitionKey?: string;
  /** All forms on the current mail/workload release (for cross-form packet binding parents). */
  releaseForms?: Record<string, StageFormDefinition>;
  /** Last saved copy of this form (from the opened release). Omit when nothing is saved yet. */
  savedForm?: StageFormDefinition;
  entityType?: string;
  readOnly?: boolean;
  errorSummary?: DisplayError;
  onChange: (form: StageFormDefinition) => void;
  onSave?: (form: StageFormDefinition) => void;
}

export function FormDesigner({
  form,
  definitionKey,
  releaseForms,
  savedForm,
  entityType,
  readOnly,
  errorSummary,
  onChange,
  onSave
}: FormDesignerProps) {
  const [selection, setSelection] = useState<DesignerSelection>(
    form.sections[0] ? { type: 'section', sectionKey: form.sections[0].sectionKey } : null
  );
  const [view, setView] = useState<'edit' | 'preview' | 'json' | 'schema'>('edit');
  const [schemaText, setSchemaText] = useState(() => JSON.stringify(form.schema ?? { type: 'object', properties: {} }, null, 2));
  const [schemaError, setSchemaError] = useState<string | undefined>();
  const [previewWidth, setPreviewWidth] = useState<'desktop' | 'narrow'>('desktop');
  const [previewValue, setPreviewValue] = useState<unknown>({});
  const [workloadChoices, setWorkloadChoices] = useState<Array<{ definitionKey: string; displayName: string }>>([]);
  const [inboundBindingHints, setInboundBindingHints] = useState<PacketBindingFieldHint[]>([]);
  const [fieldClipboard, setFieldClipboard] = useState<FormFieldDefinition[]>([]);
  const [historyTick, setHistoryTick] = useState(0);
  const historyRef = useRef<{ past: StageFormDefinition[]; future: StageFormDefinition[] }>({
    past: [],
    future: []
  });
  const skipHistoryRef = useRef(false);
  const issues = useMemo(
    () => collectFormIssues(form, entityType, releaseForms),
    [form, entityType, releaseForms]
  );
  const formDirty = useMemo(() => isFormDirty(form, savedForm), [form, savedForm]);
  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;
  void historyTick;
  const selectedFieldKeys =
    selection?.type === 'field' ? selectedFieldKeysOf(selection) : ([] as string[]);
  const selectedFieldCount = selectedFieldKeys.length;
  const formsForHints = useMemo(
    () => ({ ...(releaseForms ?? {}), [form.formKey]: form }),
    [form, releaseForms]
  );
  const parentBindingHints = useMemo(
    () => (entityType === 'MAIL' ? collectParentPacketBindingHints(formsForHints) : []),
    [entityType, formsForHints]
  );
  const bindingHints = entityType === 'WORKLOAD' ? inboundBindingHints : parentBindingHints;

  useEffect(() => {
    if (entityType !== 'MAIL') {
      return;
    }
    let cancelled = false;
    listDefinitions()
      .then((items) => {
        if (cancelled) {
          return;
        }
        setWorkloadChoices(
          items
            .filter((item) => item.entityType === 'WORKLOAD')
            .map((item) => ({ definitionKey: item.definitionKey, displayName: item.displayName }))
            .sort((left, right) => left.definitionKey.localeCompare(right.definitionKey))
        );
      })
      .catch(() => {
        if (!cancelled) {
          setWorkloadChoices([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [entityType]);

  useEffect(() => {
    if (entityType !== 'WORKLOAD' || !definitionKey?.trim()) {
      setInboundBindingHints([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [definitions, catalog] = await Promise.all([listDefinitions(), listReleaseCatalog()]);
        const mailKeys = definitions
          .filter((item) => item.entityType === 'MAIL')
          .map((item) => ({
            definitionKey: item.definitionKey,
            displayName: item.displayName
          }));
        const batches = await Promise.all(
          mailKeys.map(async (mail) => {
            const matches = catalog.filter(
              (item) => item.definitionKey === mail.definitionKey && item.lifecycleStatus !== 'RETIRED'
            );
            const version =
              matches.find((item) => item.lifecycleStatus === 'DRAFT')?.version ??
              matches.find((item) => item.lifecycleStatus === 'PUBLISHED')?.version ??
              matches[0]?.version;
            if (!version) {
              return [] as PacketBindingFieldHint[];
            }
            const release = await getRelease(mail.definitionKey, version);
            return collectChildPacketBindingHints(release.forms ?? {}, mail.definitionKey, definitionKey, {
              mailDisplayName: mail.displayName
            });
          })
        );
        if (!cancelled) {
          setInboundBindingHints(batches.flat());
        }
      } catch {
        if (!cancelled) {
          setInboundBindingHints([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [definitionKey, entityType]);

  useEffect(() => {
    setSchemaText(JSON.stringify(form.schema ?? { type: 'object', properties: {} }, null, 2));
    setSchemaError(undefined);
    setSelection((current) => {
      const next = pruneSelection(form, current);
      return next ?? firstSectionSelection(form);
    });
    historyRef.current = { past: [], future: [] };
    setHistoryTick((tick) => tick + 1);
  }, [form.formKey]);

  useEffect(() => {
    setSelection((current) => pruneSelection(form, current) ?? current);
  }, [form]);

  const selectedSectionKey =
    selection?.type === 'section' || selection?.type === 'field'
      ? selection.sectionKey
      : form.sections[0]?.sectionKey;

  function applyPaletteComponent(component: string, sectionKey: string) {
    const next = addField(form, sectionKey, component);
    const added = next.sections.find((section) => section.sectionKey === sectionKey)?.fields.at(-1);
    change(next);
    if (added) {
      setSelection(singleFieldSelection(sectionKey, added.fieldKey));
    }
  }

  function change(next: StageFormDefinition, options?: { preserveSchema?: boolean }) {
    if (!skipHistoryRef.current && !readOnly) {
      const past = historyRef.current.past;
      past.push(structuredClone(form));
      if (past.length > 50) {
        past.shift();
      }
      historyRef.current.future = [];
      setHistoryTick((tick) => tick + 1);
    }
    skipHistoryRef.current = false;
    const withSchema = options?.preserveSchema ? next : { ...next, schema: schemaFromForm(next) };
    if (!options?.preserveSchema) {
      setSchemaText(JSON.stringify(withSchema.schema ?? { type: 'object', properties: {} }, null, 2));
      setSchemaError(undefined);
    }
    onChange(withSchema);
  }

  function undoChange() {
    const previous = historyRef.current.past.pop();
    if (!previous || readOnly) {
      return;
    }
    historyRef.current.future.push(structuredClone(form));
    skipHistoryRef.current = true;
    setHistoryTick((tick) => tick + 1);
    const withSchema = { ...previous, schema: previous.schema ?? schemaFromForm(previous) };
    setSchemaText(JSON.stringify(withSchema.schema ?? { type: 'object', properties: {} }, null, 2));
    setSchemaError(undefined);
    onChange(withSchema);
  }

  function redoChange() {
    const next = historyRef.current.future.pop();
    if (!next || readOnly) {
      return;
    }
    historyRef.current.past.push(structuredClone(form));
    skipHistoryRef.current = true;
    setHistoryTick((tick) => tick + 1);
    const withSchema = { ...next, schema: next.schema ?? schemaFromForm(next) };
    setSchemaText(JSON.stringify(withSchema.schema ?? { type: 'object', properties: {} }, null, 2));
    setSchemaError(undefined);
    onChange(withSchema);
  }

  function copySelectedFields() {
    if (selection?.type !== 'field') {
      return;
    }
    const section = form.sections.find((item) => item.sectionKey === selection.sectionKey);
    if (!section) {
      return;
    }
    const order = new Map(section.fields.map((field, index) => [field.fieldKey, index]));
    const keys = selectedFieldKeysOf(selection)
      .filter((key) => order.has(key))
      .sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
    const fields = keys
      .map((key) => section.fields.find((field) => field.fieldKey === key))
      .filter((field): field is FormFieldDefinition => Boolean(field))
      .map((field) => structuredClone(field));
    if (fields.length > 0) {
      setFieldClipboard(fields);
    }
  }

  function pasteClipboardFields() {
    if (fieldClipboard.length === 0 || readOnly) {
      return;
    }
    const sectionKey =
      selection?.type === 'field' || selection?.type === 'section'
        ? selection.sectionKey
        : selectedSectionKey;
    if (!sectionKey) {
      return;
    }
    const afterFieldKey = selection?.type === 'field' ? selection.fieldKey : undefined;
    const inserted = insertClonedFields(form, sectionKey, fieldClipboard, { afterFieldKey });
    change(inserted.form);
    if (inserted.fieldKeys.length === 1) {
      setSelection(singleFieldSelection(sectionKey, inserted.fieldKeys[0]!));
    } else if (inserted.fieldKeys.length > 1) {
      setSelection(multiFieldSelection(sectionKey, inserted.fieldKeys, inserted.fieldKeys.at(-1)!));
    }
  }

  function deleteSelectedFields() {
    if (selection?.type !== 'field' || readOnly) {
      return;
    }
    const { sectionKey } = selection;
    const keys = selectedFieldKeysOf(selection);
    change(removeFields(form, sectionKey, keys));
    setSelection({ type: 'section', sectionKey });
  }

  function selectFieldOnCanvas(
    sectionKey: string,
    fieldKey: string,
    fieldIndex: number,
    event: ReactMouseEvent
  ) {
    const section = form.sections.find((item) => item.sectionKey === sectionKey);
    if (!section) {
      return;
    }
    if (event.shiftKey && selection?.type === 'field' && selection.sectionKey === sectionKey) {
      const anchorKey = selection.fieldKey;
      const anchorIndex = section.fields.findIndex((field) => field.fieldKey === anchorKey);
      if (anchorIndex >= 0) {
        const start = Math.min(anchorIndex, fieldIndex);
        const end = Math.max(anchorIndex, fieldIndex);
        const fieldKeys = section.fields.slice(start, end + 1).map((field) => field.fieldKey);
        setSelection(multiFieldSelection(sectionKey, fieldKeys, fieldKey));
        return;
      }
    }
    if ((event.metaKey || event.ctrlKey) && selection?.type === 'field' && selection.sectionKey === sectionKey) {
      const current = new Set(selectedFieldKeysOf(selection));
      if (current.has(fieldKey) && current.size > 1) {
        current.delete(fieldKey);
        const nextKeys = [...current];
        const nextActive = nextKeys.includes(selection.fieldKey) ? selection.fieldKey : nextKeys.at(-1)!;
        setSelection(multiFieldSelection(sectionKey, nextKeys, nextActive));
        return;
      }
      if (!current.has(fieldKey)) {
        current.add(fieldKey);
        setSelection(multiFieldSelection(sectionKey, [...current], fieldKey));
        return;
      }
    }
    setSelection(singleFieldSelection(sectionKey, fieldKey));
  }

  useEffect(() => {
    if (view !== 'edit' || readOnly) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (isTextEditingTarget(event.target)) {
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undoChange();
        return;
      }
      if ((mod && event.key.toLowerCase() === 'y') || (mod && event.shiftKey && event.key.toLowerCase() === 'z')) {
        event.preventDefault();
        redoChange();
        return;
      }
      if (mod && event.key.toLowerCase() === 'a' && selectedSectionKey) {
        const section = form.sections.find((item) => item.sectionKey === selectedSectionKey);
        if (section && section.fields.length > 0) {
          event.preventDefault();
          const keys = section.fields.map((field) => field.fieldKey);
          setSelection(multiFieldSelection(selectedSectionKey, keys, keys.at(-1)!));
        }
        return;
      }
      if (mod && event.key.toLowerCase() === 'c') {
        if (selection?.type === 'field') {
          event.preventDefault();
          copySelectedFields();
        }
        return;
      }
      if (mod && event.key.toLowerCase() === 'v') {
        if (fieldClipboard.length > 0) {
          event.preventDefault();
          pasteClipboardFields();
        }
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection?.type === 'field') {
          event.preventDefault();
          deleteSelectedFields();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [view, readOnly, form, selection, fieldClipboard, selectedSectionKey]);

  const modKey = isApplePlatform() ? '⌘' : 'Ctrl';

  return (
    <section className="optic-designer" aria-labelledby="form-designer-heading">
      <header className="optic-designer-header">
        <div>
          <h1 id="form-designer-heading">Form designer</h1>
          <p className="optic-form-key">{form.formKey}</p>
        </div>
        <div className="optic-designer-header-tools optic-designer-toolbar-tools">
          <div className="optic-designer-header-actions" role="group" aria-label="Edit actions">
            <button type="button" disabled={readOnly || !canUndo} onClick={undoChange} title={`Undo (${modKey}+Z)`}>
              <ButtonLabel icon="undo">Undo</ButtonLabel>
            </button>
            <button type="button" disabled={readOnly || !canRedo} onClick={redoChange} title={`Redo (${modKey}+Y)`}>
              <ButtonLabel icon="redo">Redo</ButtonLabel>
            </button>
            <button
              type="button"
              disabled={readOnly || fieldClipboard.length === 0 || !selectedSectionKey}
              title={
                fieldClipboard.length === 0
                  ? `Copy a field on the canvas first (${modKey}+C)`
                  : !selectedSectionKey
                    ? 'Select a section to paste into'
                    : `Paste copied field(s) (${modKey}+V)`
              }
              onClick={pasteClipboardFields}
            >
              <ButtonLabel icon="paste">
                Paste{fieldClipboard.length > 1 ? ` (${fieldClipboard.length})` : ''}
              </ButtonLabel>
            </button>
          </div>
          {onSave ? (
            <SaveDraftButton
              dirty={formDirty}
              disabled={readOnly || issues.length > 0 || Boolean(schemaError)}
              onClick={() => {
                const next = { ...form, schema: schemaFromForm(form) };
                setSchemaText(JSON.stringify(next.schema, null, 2));
                onSave(next);
              }}
            />
          ) : null}
        </div>
      </header>
      <div className="optic-designer-subnav optic-designer-toolstrip" role="group" aria-label="Designer view">
        <button type="button" aria-pressed={view === 'edit'} onClick={() => setView('edit')}>
          <ButtonLabel icon="designer">Edit</ButtonLabel>
        </button>
        <button type="button" aria-pressed={view === 'preview'} onClick={() => setView('preview')}>
          <ButtonLabel icon="live">Preview</ButtonLabel>
        </button>
        <button type="button" aria-pressed={view === 'json'} onClick={() => setView('json')}>
          <ButtonLabel icon="draft">UI JSON</ButtonLabel>
        </button>
        <button type="button" aria-pressed={view === 'schema'} onClick={() => setView('schema')}>
          <ButtonLabel icon="generate">Form schema</ButtonLabel>
        </button>
      </div>
      <details className="optic-designer-identity">
        <summary>
          Identity · {form.title || form.formKey || 'Untitled'} · <code>{form.dataPath || '$'}</code>
        </summary>
        <div className="optic-designer-toolbar optic-designer-identity-fields">
          <label>
            Form title
            <input
              value={form.title}
              disabled={readOnly}
              onChange={(event) => change({ ...form, title: event.target.value })}
            />
          </label>
          <label>
            formKey
            <input
              value={form.formKey}
              disabled={readOnly}
              onChange={(event) => change({ ...form, formKey: event.target.value.toUpperCase() })}
            />
          </label>
          <label>
            dataPath
            <input
              value={form.dataPath}
              disabled={readOnly}
              onChange={(event) => change({ ...form, dataPath: event.target.value })}
            />
          </label>
        </div>
      </details>

      <CaughtErrorBanner error={errorSummary} />
      {issues.length > 0 ? (
        <ErrorSummary role="status" focus={!errorSummary} heading="Validation">
          <p>Review the designer fields before saving.</p>
          <ul>
            {issues.map((issue) => (
              <li key={issue.path}>{issue.message}</li>
            ))}
          </ul>
        </ErrorSummary>
      ) : null}

      {view === 'preview' ? (
        <div className="optic-designer-preview" data-preview={previewWidth}>
          <div className="optic-designer-view-toggle" role="group" aria-label="Preview width">
            <button
              type="button"
              aria-pressed={previewWidth === 'desktop'}
              onClick={() => setPreviewWidth('desktop')}
            >
              Desktop
            </button>
            <button type="button" aria-pressed={previewWidth === 'narrow'} onClick={() => setPreviewWidth('narrow')}>
              Narrow
            </button>
          </div>
          <DynamicFormRenderer
            form={form}
            schema={form.schema}
            value={previewValue}
            releaseForms={formsForHints}
            workflowContext={{ assignedTo: 'preview.officer@example.gov' }}
            headingLevel={2}
            onChange={setPreviewValue}
          />
        </div>
      ) : null}

      {view === 'schema' ? (
        <div className="optic-designer-json">
          <div className="optic-designer-schema-bar">
            <p className="optic-help">
              This JSON describes the object at <code>{form.dataPath || '$'}</code>. Save draft regenerates
              properties from the canvas so officers are not blocked by extra-property errors, then merges this
              object into the release Schema tab. Generate schema previews the same merge. You can still edit the
              JSON after; hand-edited constraints are kept when they do not conflict with a field.
            </p>
            <button
              type="button"
              className="optic-button-primary"
              disabled={readOnly}
              onClick={() => {
                const schema = schemaFromForm(form);
                setSchemaText(JSON.stringify(schema, null, 2));
                setSchemaError(undefined);
                change({ ...form, schema });
              }}
            >
              <ButtonLabel icon="generate">Generate schema</ButtonLabel>
            </button>
          </div>
          <label>
            JSON Schema
          <textarea
            spellCheck={false}
            value={schemaText}
            disabled={readOnly}
            aria-invalid={schemaError ? 'true' : undefined}
            aria-errormessage={schemaError ? 'schema-json-error' : undefined}
            aria-describedby={schemaError ? 'schema-json-error' : undefined}
            onChange={(event) => {
              setSchemaText(event.target.value);
              try {
                const parsed = JSON.parse(event.target.value) as StageFormDefinition['schema'];
                setSchemaError(undefined);
                change({ ...form, schema: parsed }, { preserveSchema: true });
              } catch (error) {
                setSchemaError(error instanceof Error ? error.message : 'Schema JSON is not valid.');
              }
            }}
          />
          {schemaError ? (
            <p className="optic-error" id="schema-json-error" role="status">
              {schemaError}
            </p>
          ) : null}
          </label>
        </div>
      ) : null}

      {view === 'json' ? (
        <label className="optic-designer-json">
          Form UI JSON
          <textarea
            spellCheck={false}
            value={JSON.stringify(form, null, 2)}
            disabled={readOnly}
            onChange={(event) => {
              try {
                change(JSON.parse(event.target.value) as StageFormDefinition);
              } catch {
                /* keep typing until JSON is valid */
              }
            }}
          />
        </label>
      ) : null}

      {view === 'edit' ? (
        <div className="optic-designer-panes">
          <aside className="optic-designer-palette" aria-label="Component palette">
            <h2>Palette</h2>
            <ul>
              {PALETTE_COMPONENTS.map((item) => (
                <li key={item.component}>
                  <button
                    type="button"
                    disabled={readOnly || !selectedSectionKey}
                    draggable={!readOnly}
                    onDragStart={(event) => event.dataTransfer.setData('text/optic-component', item.component)}
                    onClick={() => {
                      if (!selectedSectionKey) {
                        return;
                      }
                      applyPaletteComponent(item.component, selectedSectionKey);
                    }}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
            <div className="optic-designer-palette-actions">
              <button
                type="button"
                disabled={readOnly}
                onClick={() => {
                  const next = addSection(form);
                  change(next);
                  const added = next.sections.at(-1);
                  if (added) {
                    setSelection({ type: 'section', sectionKey: added.sectionKey });
                  }
                }}
              >
                Add section
              </button>
            </div>
            <details className="optic-designer-shortcuts">
              <summary>Keyboard shortcuts</summary>
              <FormShortcutHelp />
            </details>
          </aside>

          <div
            className="optic-designer-canvas"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              const component = event.dataTransfer.getData('text/optic-component');
              if (!component || !selectedSectionKey || readOnly) {
                return;
              }
              applyPaletteComponent(component, selectedSectionKey);
            }}
          >
            <h2>Canvas</h2>
            {form.sections.every((section) => section.fields.length === 0) ? (
              <div className="optic-designer-empty" role="status">
                <p>
                  <strong>Build the officer form</strong>
                </p>
                <p className="optic-help">
                  {form.sections.length === 0
                    ? 'Add a section, then pick a component from the palette.'
                    : 'Pick a component from the palette to add it to the selected section.'}
                </p>
                {form.sections.length === 0 ? (
                  <button
                    type="button"
                    className="optic-button-primary"
                    disabled={readOnly}
                    onClick={() => {
                      const next = addSection(form);
                      change(next);
                      const added = next.sections.at(-1);
                      if (added) {
                        setSelection({ type: 'section', sectionKey: added.sectionKey });
                      }
                    }}
                  >
                    Add section
                  </button>
                ) : null}
              </div>
            ) : null}
            {form.sections.map((section, sectionIndex) => (
              <article
                key={section.sectionKey}
                className="optic-designer-section"
                data-selected={selection?.type === 'section' && selection.sectionKey === section.sectionKey}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  const movedSection = event.dataTransfer.getData('text/optic-section');
                  if (movedSection && !readOnly) {
                    event.preventDefault();
                    event.stopPropagation();
                    change(moveSectionToIndex(form, movedSection, sectionIndex));
                    return;
                  }
                  const component = event.dataTransfer.getData('text/optic-component');
                  if (component && !readOnly) {
                    event.preventDefault();
                    event.stopPropagation();
                    applyPaletteComponent(component, section.sectionKey);
                  }
                }}
              >
                <header className="optic-designer-section-header">
                  <div>
                    <button
                      type="button"
                      draggable={!readOnly}
                      aria-pressed={selection?.type === 'section' && selection.sectionKey === section.sectionKey}
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/optic-section', section.sectionKey);
                      }}
                      onClick={() => setSelection({ type: 'section', sectionKey: section.sectionKey })}
                    >
                      {section.title}
                    </button>
                    {section.repeatable ? <span className="optic-status-pill">Repeats</span> : null}
                    <p className="optic-form-key">{section.sectionKey}</p>
                  </div>
                  <div className="optic-designer-field-actions">
                    <ReorderButton
                      direction="up"
                      disabled={readOnly || sectionIndex === 0}
                      aria-label={`Move section ${section.title} up`}
                      onClick={() => change(moveSection(form, section.sectionKey, -1))}
                    />
                    <ReorderButton
                      direction="down"
                      disabled={readOnly || sectionIndex === form.sections.length - 1}
                      aria-label={`Move section ${section.title} down`}
                      onClick={() => change(moveSection(form, section.sectionKey, 1))}
                    />
                    <button
                      type="button"
                      className="optic-designer-quiet-button"
                      disabled={readOnly}
                      onClick={() => change(removeSection(form, section.sectionKey))}
                    >
                      Remove section
                    </button>
                  </div>
                </header>
                <ol>
                  {section.fields.map((field, fieldIndex) => {
                    const fieldHints = hintsForField(bindingHints, form.formKey, field.fieldKey);
                    return (
                    <li
                      key={field.fieldKey}
                      className="optic-designer-canvas-row"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        const payload = event.dataTransfer.getData('text/optic-field');
                        const [fromSection, fromField] = payload.split('\t');
                        if (!fromSection || !fromField || readOnly) {
                          return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        change(moveFieldToIndex(form, fromSection, fromField, fieldIndex));
                      }}
                    >
                      <button
                        type="button"
                        className="optic-designer-field"
                        aria-label={fieldCanvasLabel(
                          field.label,
                          field.component,
                          field.required,
                          section.repeatable,
                          [
                            ...fieldHints.map(packetBindingChipLabel),
                            ...(field.displayFromFormKey && field.displayFromFieldKey
                              ? [
                                  `← ${displayFromChipLabel(formsForHints, field.displayFromFormKey, field.displayFromFieldKey)}`
                                ]
                              : [])
                          ]
                        )}
                        aria-pressed={
                          selection?.type === 'field' && selectedFieldKeysOf(selection).includes(field.fieldKey)
                        }
                        draggable={!readOnly && selectedFieldCount <= 1}
                        data-selected={
                          selection?.type === 'field' && selectedFieldKeysOf(selection).includes(field.fieldKey)
                        }
                        onDragStart={(event) =>
                          event.dataTransfer.setData('text/optic-field', `${section.sectionKey}\t${field.fieldKey}`)
                        }
                        onClick={(event) =>
                          selectFieldOnCanvas(section.sectionKey, field.fieldKey, fieldIndex, event)
                        }
                      >
                        <span>{field.label}</span>
                        <span className="optic-designer-field-meta">
                          {section.repeatable ? <span className="optic-designer-field-flag">Repeats</span> : null}
                          {canRequireField(field.component) ? (
                            <span className="optic-designer-field-flag">
                              {field.required ? 'Required' : 'Optional'}
                            </span>
                          ) : (
                            <span className="optic-designer-field-flag">Display</span>
                          )}
                          {fieldHints.map((hint) => (
                            <span
                              key={`${hint.role}-${hint.mode}-${hint.linkedFieldKey}`}
                              className="optic-designer-field-flag"
                            >
                              {packetBindingChipLabel(hint)}
                            </span>
                          ))}
                          {field.displayFromFormKey && field.displayFromFieldKey ? (
                            <span className="optic-designer-field-flag">
                              ← {displayFromChipLabel(formsForHints, field.displayFromFormKey, field.displayFromFieldKey)}
                            </span>
                          ) : null}
                          <span className="optic-designer-field-type">{paletteLabel(field.component)}</span>
                        </span>
                      </button>
                      <div className="optic-designer-field-actions">
                        <ReorderButton
                          direction="up"
                          disabled={readOnly || fieldIndex === 0}
                          aria-label={`Move ${field.label} up`}
                          onClick={() => change(moveField(form, section.sectionKey, field.fieldKey, -1))}
                        />
                        <ReorderButton
                          direction="down"
                          disabled={readOnly || fieldIndex === section.fields.length - 1}
                          aria-label={`Move ${field.label} down`}
                          onClick={() => change(moveField(form, section.sectionKey, field.fieldKey, 1))}
                        />
                        <button
                          type="button"
                          className="optic-designer-quiet-button"
                          disabled={readOnly}
                          aria-label={`Copy ${field.label}`}
                          title={`Copy (${modKey}+C)`}
                          onClick={() => {
                            const keys =
                              selection?.type === 'field' &&
                              selection.sectionKey === section.sectionKey &&
                              selectedFieldKeysOf(selection).includes(field.fieldKey)
                                ? selectedFieldKeysOf(selection)
                                : [field.fieldKey];
                            setSelection(multiFieldSelection(section.sectionKey, keys, field.fieldKey));
                            const order = new Map(section.fields.map((item, index) => [item.fieldKey, index]));
                            const ordered = [...keys]
                              .filter((key) => order.has(key))
                              .sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
                            setFieldClipboard(
                              ordered
                                .map((key) => section.fields.find((item) => item.fieldKey === key))
                                .filter((item): item is FormFieldDefinition => Boolean(item))
                                .map((item) => structuredClone(item))
                            );
                          }}
                        >
                          <ButtonLabel icon="copy">Copy</ButtonLabel>
                        </button>
                        <button
                          type="button"
                          className="optic-designer-quiet-button"
                          disabled={readOnly}
                          aria-label={`Remove ${field.label}`}
                          title="Delete (Del)"
                          onClick={() => {
                            const keys =
                              selection?.type === 'field' &&
                              selection.sectionKey === section.sectionKey &&
                              selectedFieldKeysOf(selection).includes(field.fieldKey)
                                ? selectedFieldKeysOf(selection)
                                : [field.fieldKey];
                            change(removeFields(form, section.sectionKey, keys));
                            setSelection({ type: 'section', sectionKey: section.sectionKey });
                          }}
                        >
                          <ButtonLabel icon="trash">Remove</ButtonLabel>
                        </button>
                      </div>
                    </li>
                    );
                  })}
                </ol>
                {section.repeatable ? (
                  <p className="optic-help">
                    Officers click {section.addButtonLabel?.trim() || 'Add Workload'} to append copies of these fields.
                    Bind a Number and Radio in another section to add many at once. Each copy gets a workload tracking
                    # (W-…). That does not create a workload case.
                  </p>
                ) : null}
              </article>
            ))}
            <BehaviorsEditor
              form={form}
              releaseForms={releaseForms}
              selectedFieldKey={selection?.type === 'field' ? selection.fieldKey : undefined}
              readOnly={readOnly}
              onChange={change}
            />
          </div>

          <aside className="optic-designer-properties" aria-label="Properties">
            <h2>Properties</h2>
            {selection?.type === 'section' ? (
              <SectionProperties
                form={form}
                releaseForms={releaseForms}
                sectionKey={selection.sectionKey}
                entityType={entityType}
                workloadChoices={workloadChoices}
                readOnly={readOnly}
                onChange={change}
                onSelect={setSelection}
              />
            ) : selection?.type === 'field' && selectedFieldCount > 1 ? (
              <div className="optic-designer-multi-select">
                <p>
                  <strong>{selectedFieldCount}</strong> fields selected in this section.
                </p>
                <p className="optic-help">
                  Copy, paste, or delete applies to all selected fields. Click one field (without{' '}
                  {modKey}) to edit its properties alone.
                </p>
                <ul>
                  {selectedFieldKeys.map((key) => {
                    const field = form.sections
                      .find((section) => section.sectionKey === selection.sectionKey)
                      ?.fields.find((item) => item.fieldKey === key);
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          className="optic-designer-quiet-button"
                          onClick={() => setSelection(singleFieldSelection(selection.sectionKey, key))}
                        >
                          {field?.label || key}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : selection?.type === 'field' ? (
              <FieldProperties
                form={form}
                sectionKey={selection.sectionKey}
                fieldKey={selection.fieldKey}
                releaseForms={releaseForms}
                bindingHints={hintsForField(bindingHints, form.formKey, selection.fieldKey)}
                readOnly={readOnly}
                onChange={change}
                onSelect={setSelection}
              />
            ) : (
              <p>Select a section or field to edit its properties.</p>
            )}
          </aside>
        </div>
      ) : null}
    </section>
  );
}

function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) || /Mac OS/.test(navigator.userAgent);
}

function FormShortcutHelp() {
  const mod = isApplePlatform() ? '⌘' : 'Ctrl';
  const rows: Array<{ keys: string[]; action: string }> = [
    { keys: [`${mod}+click`], action: 'Toggle multi-select' },
    { keys: ['Shift+click'], action: 'Select a range' },
    { keys: [`${mod}+A`], action: 'Select all fields in the section' },
    { keys: ['Delete'], action: 'Remove selected fields' },
    { keys: [`${mod}+C`], action: 'Copy selected fields' },
    { keys: [`${mod}+V`], action: 'Paste (header Paste button)' },
    { keys: [`${mod}+Z`], action: 'Undo' },
    { keys: [`${mod}+Y`], action: 'Redo' }
  ];
  return (
    <div className="optic-designer-shortcut-help">
      <ul className="optic-designer-shortcut-list">
        {rows.map((row) => (
          <li key={row.action}>
            <span className="optic-designer-shortcut-keys" aria-hidden="true">
              {row.keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </span>
            <span className="optic-designer-shortcut-action">{row.action}</span>
          </li>
        ))}
      </ul>
      <p className="optic-help">Shortcuts are ignored while typing in a property field.</p>
    </div>
  );
}

function SectionProperties({
  form,
  releaseForms,
  sectionKey,
  entityType,
  workloadChoices,
  readOnly,
  onChange,
  onSelect
}: {
  form: StageFormDefinition;
  releaseForms?: Record<string, StageFormDefinition>;
  sectionKey: string;
  entityType?: string;
  workloadChoices: Array<{ definitionKey: string; displayName: string }>;
  readOnly?: boolean;
  onChange: (form: StageFormDefinition) => void;
  onSelect: (selection: DesignerSelection) => void;
}) {
  const section = form.sections.find((item) => item.sectionKey === sectionKey);
  if (!section) {
    return <p>Section was removed.</p>;
  }
  const mailForm = entityType === 'MAIL';
  return (
    <>
      <label>
        Title
        <input
          value={section.title}
          disabled={readOnly}
          onChange={(event) => onChange(updateSection(form, sectionKey, { title: event.target.value }))}
        />
      </label>
      <label>
        Section key
        <input
          value={section.sectionKey}
          disabled={readOnly}
          onChange={(event) => {
            const nextKey = event.target.value.toUpperCase();
            onChange(updateSection(form, sectionKey, { sectionKey: nextKey }));
            onSelect({ type: 'section', sectionKey: nextKey });
          }}
        />
      </label>
      <label>
        Layout
        <select
          value={section.layout ?? 'ONE_COLUMN'}
          disabled={readOnly}
          onChange={(event) => onChange(updateSection(form, sectionKey, { layout: event.target.value }))}
        >
          <option value="ONE_COLUMN">One column</option>
          <option value="TWO_COLUMN">Two column</option>
        </select>
      </label>
      {mailForm ? (
        <>
          <label className="optic-checkbox">
            <input
              type="checkbox"
              checked={Boolean(section.repeatable)}
              disabled={readOnly}
              onChange={(event) => onChange(setSectionRepeatable(form, sectionKey, event.target.checked))}
            />
            Repeat this section
          </label>
          {section.repeatable ? (
            <>
              <label>
                Array path
                <input
                  value={section.path ?? ''}
                  disabled={readOnly}
                  onChange={(event) => onChange(updateSection(form, sectionKey, { path: event.target.value }))}
                />
              </label>
              <label>
                Add button label
                <input
                  value={section.addButtonLabel ?? 'Add Workload'}
                  disabled={readOnly}
                  onChange={(event) => onChange(updateSection(form, sectionKey, { addButtonLabel: event.target.value }))}
                />
              </label>
              <label>
                Item label
                <input
                  value={section.itemLabel ?? 'Workload'}
                  disabled={readOnly}
                  onChange={(event) => onChange(updateSection(form, sectionKey, { itemLabel: event.target.value }))}
                />
              </label>
              <label>
                Count field
                <select
                  value={section.countFieldKey ?? ''}
                  disabled={readOnly}
                  onChange={(event) =>
                    onChange(
                      updateSection(form, sectionKey, {
                        countFieldKey: event.target.value || undefined,
                        ...(event.target.value ? {} : { matchCountField: undefined })
                      })
                    )
                  }
                >
                  <option value="">None — add one copy</option>
                  {fieldsOutsideSection(form, sectionKey)
                    .filter((field) => field.component === 'NUMBER_INPUT')
                    .map((field) => (
                      <option key={field.fieldKey} value={field.fieldKey}>
                        {field.label} ({field.fieldKey})
                      </option>
                    ))}
                </select>
              </label>
              {section.countFieldKey ? (
                <label className="optic-checkbox">
                  <input
                    type="checkbox"
                    checked={Boolean(section.matchCountField)}
                    disabled={readOnly}
                    onChange={(event) =>
                      onChange(updateSection(form, sectionKey, { matchCountField: event.target.checked || undefined }))
                    }
                  />
                  Require exact copies from Count field
                </label>
              ) : null}
              {section.countFieldKey && section.matchCountField ? (
                <p className="optic-help">
                  Complete requires the same number of copies as the Count field (for example # of Workloads to Add).
                  Add Workload only fills up to that number; remove extras if there are too many.
                </p>
              ) : (
                <>
                  <label>
                    Minimum copies
                    <input
                      type="number"
                      min={0}
                      value={section.minItems ?? ''}
                      disabled={readOnly}
                      onChange={(event) =>
                        onChange(
                          updateSection(form, sectionKey, {
                            minItems: event.target.value === '' ? undefined : Number(event.target.value)
                          })
                        )
                      }
                    />
                  </label>
                  <label>
                    Maximum copies
                    <input
                      type="number"
                      min={0}
                      value={section.maxItems ?? ''}
                      disabled={readOnly}
                      onChange={(event) =>
                        onChange(
                          updateSection(form, sectionKey, {
                            maxItems: event.target.value === '' ? undefined : Number(event.target.value)
                          })
                        )
                      }
                    />
                  </label>
                  <p className="optic-help">
                    Fixed minimum/maximum copies on Complete (schema minItems / maxItems). Prefer Count field + Require
                    exact copies when officers enter how many workloads to create.
                  </p>
                </>
              )}
              <label>
                Apply choice from
                <select
                  value={section.choiceSourceFieldKey ?? ''}
                  disabled={readOnly}
                  onChange={(event) =>
                    onChange(
                      updateSection(form, sectionKey, { choiceSourceFieldKey: event.target.value || undefined })
                    )
                  }
                >
                  <option value="">None — officer chooses per copy</option>
                  {fieldsOutsideSection(form, sectionKey)
                    .filter((field) => field.component === 'RADIO' || field.component === 'YES_NO_RADIO' || field.component === 'SELECT')
                    .map((field) => (
                      <option key={field.fieldKey} value={field.fieldKey}>
                        {field.label} ({field.fieldKey})
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Create cases of definition
                <select
                  value={section.spawnDefinitionKey ?? ''}
                  disabled={readOnly}
                  onChange={(event) =>
                    onChange(
                      updateSection(form, sectionKey, {
                        spawnDefinitionKey: event.target.value || undefined,
                        ...(event.target.value ? {} : { packetFieldBindings: undefined })
                      })
                    )
                  }
                >
                  <option value="">None — store rows on this mail form only</option>
                  {spawnDefinitionOptions(workloadChoices, section.spawnDefinitionKey).map((choice) => (
                    <option key={choice.definitionKey} value={choice.definitionKey}>
                      {choice.displayName} ({choice.definitionKey})
                    </option>
                  ))}
                </select>
              </label>
              {section.spawnDefinitionKey ? (
                <PacketFieldBindingsEditor
                  form={form}
                  releaseForms={releaseForms}
                  sectionKey={sectionKey}
                  spawnDefinitionKey={section.spawnDefinitionKey}
                  readOnly={readOnly}
                  onChange={onChange}
                />
              ) : null}
              <p className="optic-help">
                Put a Number and Radio in another section. Bind Count field to # of Workloads to Add, then turn on
                Require exact copies so Complete matches that number. Add Workload fills up to the count, mints a
                workload tracking # for each, and copies the radio value onto each. On Complete, each copy becomes a
                workload case of the definition you pick. Leave Create cases as None to store rows on the mail form
                only. Field paths inside this section are relative to each copy. Use field links below to copy or
                project values between this mail packet and the spawned workload.
              </p>
            </>
          ) : (
            <p className="optic-help">
              Turn this on so officers can add copies of every field in the section (Add Workload).
            </p>
          )}
        </>
      ) : (
        <p className="optic-help">Repeatable sections are available on Mail item definitions.</p>
      )}
    </>
  );
}

function FieldProperties({
  form,
  sectionKey,
  fieldKey,
  releaseForms,
  bindingHints,
  readOnly,
  onChange,
  onSelect
}: {
  form: StageFormDefinition;
  sectionKey: string;
  fieldKey: string;
  releaseForms?: Record<string, StageFormDefinition>;
  bindingHints: PacketBindingFieldHint[];
  readOnly?: boolean;
  onChange: (form: StageFormDefinition) => void;
  onSelect: (selection: DesignerSelection) => void;
}) {
  const section = form.sections.find((item) => item.sectionKey === sectionKey);
  const field = section?.fields.find((item) => item.fieldKey === fieldKey);
  if (!field) {
    return <p>Field was removed.</p>;
  }

  function patch(next: Partial<FormFieldDefinition>) {
    onChange(updateField(form, sectionKey, fieldKey, next));
  }

  const typeChoices = paletteOptions(field.component);
  const fillFromOptions = fillFromOptionsForComponent(field.component);
  const dateSources = listFillFromDateFields(form, field.fieldKey);
  const displayFromForms = Object.values(releaseForms ?? {})
    .filter((entry) => entry.formKey !== form.formKey)
    .sort((left, right) => left.formKey.localeCompare(right.formKey));
  const displayFromSourceForm = field.displayFromFormKey
    ? (releaseForms?.[field.displayFromFormKey] ??
      (field.displayFromFormKey === form.formKey ? form : undefined))
    : undefined;
  const displayFromFields = (displayFromSourceForm?.sections ?? [])
    .filter((entry) => !entry.repeatable)
    .flatMap((entry) => entry.fields)
    .filter((item) => item.fieldKey && !(displayFromSourceForm?.formKey === form.formKey && item.fieldKey === field.fieldKey));

  return (
    <>
      <div className="optic-designer-type-banner" role="status" aria-label="Current palette type">
        <span className="optic-status-pill">{paletteLabel(field.component)}</span>
        <span>Palette type</span>
      </div>
      {bindingHints.length > 0 ? (
        <p className="optic-help" role="status">
          {bindingHints.map((hint) => packetBindingDetail(hint)).join(' ')} Edit field links on the mail repeating
          section that creates cases.
        </p>
      ) : null}
      <label>
        Label
        <input value={field.label} disabled={readOnly} onChange={(event) => patch({ label: event.target.value })} />
      </label>
      <label>
        Palette type
        <select
          value={field.component}
          disabled={readOnly}
            onChange={(event) => {
              const component = event.target.value;
              const fieldIndex =
                form.sections.find((section) => section.sectionKey === sectionKey)?.fields.findIndex((item) => item.fieldKey === fieldKey) ??
                -1;
              const next = retargetFieldComponent(form, sectionKey, fieldKey, component);
              onChange(next);
              const renamed = fieldIndex >= 0 ? next.sections.find((section) => section.sectionKey === sectionKey)?.fields[fieldIndex] : undefined;
              if (renamed && renamed.fieldKey !== fieldKey) {
                onSelect(singleFieldSelection(sectionKey, renamed.fieldKey));
              }
            }}
        >
          {typeChoices.map((item) => (
            <option key={item.component} value={item.component}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Field key
        <input
          value={field.fieldKey}
          disabled={readOnly}
          onChange={(event) => {
            const nextKey = event.target.value.toUpperCase();
            onChange(renameFieldKey(form, sectionKey, fieldKey, nextKey));
            onSelect(singleFieldSelection(sectionKey, nextKey));
          }}
        />
      </label>
      <label>
        Path
        <input
          value={field.path}
          disabled={readOnly || Boolean(field.displayFromFormKey && field.displayFromFieldKey)}
          onChange={(event) => patch({ path: event.target.value })}
        />
      </label>
      <p className="optic-help">
        {field.displayFromFormKey && field.displayFromFieldKey
          ? 'Path is unused while Display from is set — the value comes from the other form’s field.'
          : 'Usually relative to this form’s dataPath (for example $.receiptNumber). For values shared across stages, use $.workload.fieldName on a Workload definition or $.mailItem.fieldName on a Mail item — no separate form required.'}
      </p>
      {canRequireField(field.component) ? (
        <>
          <label>
            <input
              type="checkbox"
              checked={Boolean(field.required)}
              disabled={readOnly}
              onChange={(event) => patch({ required: event.target.checked || undefined })}
            />
            Required on Complete
          </label>
          <p className="optic-help">
            Optional fields can stay empty on Save. Required is written into JSON Schema and checked when Complete
            validates the stage form.
          </p>
        </>
      ) : (
        <p className="optic-help">Display-only fields are not required and are not schema-validated on Complete.</p>
      )}
      {field.component === 'RADIO' ? (
        <RadioOptionsEditor
          options={field.options}
          readOnly={readOnly}
          onChange={(options) => patch({ options })}
        />
      ) : null}
      {field.component === 'SELECT' || field.component === 'MULTI_SELECT' ? (
        <SelectOptionsEditor
          key={field.fieldKey}
          fieldKey={field.fieldKey}
          options={field.options}
          readOnly={readOnly}
          onChange={(options) => patch({ options })}
        />
      ) : null}
      <details className="optic-designer-advanced">
        <summary>Advanced</summary>
        {field.component === 'READ_ONLY_VALUE' ? (
          <>
            <label>
              Display from form
              <select
                value={field.displayFromFormKey ?? ''}
                disabled={readOnly}
                onChange={(event) => {
                  const nextFormKey = event.target.value || undefined;
                  patch({
                    displayFromFormKey: nextFormKey,
                    displayFromFieldKey: undefined
                  });
                }}
              >
                <option value="">None — use Path / Fill from</option>
                {field.displayFromFormKey &&
                !displayFromForms.some((entry) => entry.formKey === field.displayFromFormKey) &&
                field.displayFromFormKey !== form.formKey ? (
                  <option value={field.displayFromFormKey}>
                    {field.displayFromFormKey} (not on release)
                  </option>
                ) : null}
                {displayFromForms.map((entry) => (
                  <option key={entry.formKey} value={entry.formKey}>
                    {entry.title?.trim() || entry.formKey} ({entry.formKey})
                  </option>
                ))}
              </select>
            </label>
            {field.displayFromFormKey ? (
              <label>
                Display from field
                <select
                  value={field.displayFromFieldKey ?? ''}
                  disabled={readOnly}
                  onChange={(event) => patch({ displayFromFieldKey: event.target.value || undefined })}
                >
                  <option value="">Select a field</option>
                  {field.displayFromFieldKey &&
                  !displayFromFields.some((item) => item.fieldKey === field.displayFromFieldKey) ? (
                    <option value={field.displayFromFieldKey}>
                      {field.displayFromFieldKey} (not on form)
                    </option>
                  ) : null}
                  {displayFromFields.map((item) => (
                    <option key={item.fieldKey} value={item.fieldKey}>
                      {item.label} ({item.fieldKey})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <p className="optic-help">
              Show another form’s stored value on this screen without copying it. The other form keeps ownership; this
              field is display-only.
            </p>
          </>
        ) : null}
        {fillFromOptions.length > 0 ? (
          <>
            <label>
              Fill from
              <select
                value={field.fillFrom ?? ''}
                disabled={readOnly}
                onChange={(event) => {
                  const next = event.target.value;
                  if (!isFillFromSource(next)) {
                    patch({ fillFrom: undefined, fillFromFieldKey: undefined });
                    return;
                  }
                  patch({
                    fillFrom: next,
                    fillFromFieldKey: next === 'FIELD' ? field.fillFromFieldKey : undefined
                  });
                }}
              >
                <option value="">None</option>
                {fillFromOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {field.fillFrom === 'FIELD' ? (
              <label>
                Copy from
                <select
                  value={field.fillFromFieldKey ?? ''}
                  disabled={readOnly}
                  onChange={(event) => patch({ fillFromFieldKey: event.target.value || undefined })}
                >
                  <option value="">Select a date field</option>
                  {dateSources.map((source) => (
                    <option key={source.fieldKey} value={source.fieldKey}>
                      {source.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <p className="optic-help">{fillFromHelp(field)}</p>
          </>
        ) : null}
        {field.component === 'TRACKING_ID_DISPLAY' && !section?.repeatable ? (
          <p className="optic-help">
            Leave as <code>$.trackingId</code>. Try and officer screens show this case’s mail or workload tracking #.
            Change the label to Mail Tracking # or Workload Tracking #.
          </p>
        ) : null}
        {section?.repeatable ? (
          <p className="optic-help">This path is relative to each workload copy, not the top of the form.</p>
        ) : null}
        <p className="optic-help" role="status">
          {section?.repeatable
            ? 'Repeated: officers get another copy of this field when they add a workload.'
            : 'Not repeated. To repeat fields, select the section and turn on Repeat this section (Mail item forms).'}
        </p>
        {canRequireField(field.component) ? (
          <FieldValidationEditor field={field} readOnly={readOnly} onPatch={patch} />
        ) : null}
        <label>
          Help text
          <input
            value={field.helpText ?? ''}
            disabled={readOnly}
            onChange={(event) => patch({ helpText: event.target.value })}
          />
        </label>
        <label>
          Width
          <select
            value={String(field.width ?? 12)}
            disabled={readOnly}
            onChange={(event) => patch({ width: Number(event.target.value) })}
          >
            <option value="6">Half</option>
            <option value="12">Full</option>
          </select>
        </label>
        <label>
          Classification
          <select
            value={field.piiClassification ?? ''}
            disabled={readOnly}
            onChange={(event) => patch({ piiClassification: event.target.value || undefined })}
          >
            <option value="">None</option>
            <option value="PII">PII</option>
            <option value="SENSITIVE">Sensitive</option>
          </select>
        </label>
      </details>
    </>
  );
}

function BehaviorsEditor({
  form,
  releaseForms,
  selectedFieldKey,
  readOnly,
  onChange
}: {
  form: StageFormDefinition;
  releaseForms?: Record<string, StageFormDefinition>;
  selectedFieldKey?: string;
  readOnly?: boolean;
  onChange: (form: StageFormDefinition) => void;
}) {
  const behaviors = form.behaviors ?? [];
  const pathOptions = useMemo(
    () =>
      listRulePathOptions(
        { ...(releaseForms ?? {}), [form.formKey]: form },
        { formBehaviorFocus: form.formKey }
      ),
    [form, releaseForms]
  );
  const fieldChoices = useMemo(
    () =>
      form.sections.flatMap((section) =>
        section.fields.map((field) => ({
          fieldKey: field.fieldKey,
          label: `${field.label} (${field.fieldKey})`
        }))
      ),
    [form.sections]
  );
  const [showAll, setShowAll] = useState(false);
  const filterToSelected = Boolean(selectedFieldKey) && !showAll;
  const visibleEntries = behaviors
    .map((behavior, index) => ({ behavior, index }))
    .filter(({ behavior }) =>
      filterToSelected ? behavior.effects.some((effect) => effect.fieldKey === selectedFieldKey) : true
    );
  const hiddenCount = filterToSelected ? behaviors.length - visibleEntries.length : 0;

  useEffect(() => {
    setShowAll(false);
  }, [selectedFieldKey]);

  return (
    <fieldset className="optic-designer-behaviors">
      <legend>Conditional behaviors</legend>
      <p className="optic-help">
        When paths use the full case location (for example <code>$.dataEntryDetails.receiptNumber</code> or{' '}
        <code>$.workload.workloadStatus</code>). The list is this form’s fields plus shared{' '}
        <code>$.workload.*</code> / <code>$.mailItem.*</code> from other stages — not every stage folder on the
        release (those stay available on Complete rules).
      </p>
      {selectedFieldKey ? (
        <div className="optic-designer-toolbar">
          <p className="optic-help" role="status">
            {showAll
              ? `Showing all ${behaviors.length} behavior${behaviors.length === 1 ? '' : 's'}.`
              : `Showing behaviors for ${selectedFieldKey}${hiddenCount > 0 ? ` (${hiddenCount} other on this form)` : ''}.`}
          </p>
          <label className="optic-checkbox">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(event) => setShowAll(event.target.checked)}
              aria-label="Show all conditional behaviors"
            />
            Show all behaviors
          </label>
        </div>
      ) : (
        <p className="optic-help">Select a field on the canvas to focus its behaviors, or add one for any target.</p>
      )}
      {visibleEntries.length === 0 ? (
        <p className="optic-help">
          {filterToSelected
            ? `No behaviors target ${selectedFieldKey} yet.`
            : 'No conditional behaviors on this form yet.'}
        </p>
      ) : null}
      {visibleEntries.map(({ behavior, index }, displayIndex) => (
        <div key={behavior.behaviorKey} className="optic-designer-behavior">
          <p className="optic-form-key" aria-label={`Behavior ${index + 1}`}>
            {index + 1}.
            {filterToSelected ? (
              <span className="optic-help"> ({displayIndex + 1} of {visibleEntries.length} for this field)</span>
            ) : null}
          </p>
          <RuleExpressionEditor
            value={behavior.when}
            readOnly={readOnly}
            pathOptions={pathOptions}
            onChange={(when) => onChange(replaceBehavior(form, index, { when }))}
          />
          <label>
            Target field
            <select
              value={behavior.effects[0]?.fieldKey ?? ''}
              disabled={readOnly}
              onChange={(event) =>
                onChange(
                  replaceBehavior(form, index, {
                    effects: [{ ...effectOf(behavior), fieldKey: event.target.value }]
                  })
                )
              }
            >
              <option value="">Select…</option>
              {behavior.effects[0]?.fieldKey &&
              !fieldChoices.some((choice) => choice.fieldKey === behavior.effects[0]?.fieldKey) ? (
                <option value={behavior.effects[0].fieldKey}>
                  {behavior.effects[0].fieldKey} (not on form)
                </option>
              ) : null}
              {fieldChoices.map((choice) => (
                <option key={choice.fieldKey} value={choice.fieldKey}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <label className="optic-checkbox">
            <input
              type="checkbox"
              checked={behavior.effects[0]?.visible === true}
              disabled={readOnly}
              onChange={(event) =>
                onChange(
                  replaceBehavior(form, index, {
                    effects: [patchBehaviorEffect(effectOf(behavior), 'visible', event.target.checked)]
                  })
                )
              }
            />
            Visible when matched (hides the field until then)
          </label>
          <label className="optic-checkbox">
            <input
              type="checkbox"
              checked={behavior.effects[0]?.required === true}
              disabled={readOnly}
              onChange={(event) =>
                onChange(
                  replaceBehavior(form, index, {
                    effects: [patchBehaviorEffect(effectOf(behavior), 'required', event.target.checked)]
                  })
                )
              }
            />
            Required when matched
          </label>
          <label className="optic-checkbox">
            <input
              type="checkbox"
              checked={behavior.effects[0]?.readOnly === true}
              disabled={readOnly}
              onChange={(event) =>
                onChange(
                  replaceBehavior(form, index, {
                    effects: [patchBehaviorEffect(effectOf(behavior), 'readOnly', event.target.checked)]
                  })
                )
              }
            />
            Read-only when matched
          </label>
          <button
            type="button"
            disabled={readOnly}
            aria-label={`Remove behavior ${index + 1}`}
            onClick={() => onChange({ ...form, behaviors: behaviors.filter((_, itemIndex) => itemIndex !== index) })}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={readOnly}
        onClick={() =>
          onChange({
            ...form,
            behaviors: [
              ...behaviors,
              {
                behaviorKey: `BEHAVIOR_${behaviors.length + 1}`,
                when: emptyPredicate(pathOptions.find((item) => item.value.startsWith('$.'))?.value),
                effects: [{ fieldKey: selectedFieldKey ?? '', visible: true }]
              }
            ]
          })
        }
      >
        Add behavior
        {selectedFieldKey && !showAll ? ` for ${selectedFieldKey}` : ''}
      </button>
    </fieldset>
  );
}

function effectOf(behavior: FormBehaviorDefinition) {
  return behavior.effects[0] ?? { fieldKey: '' };
}

/** Unchecked means “no effect for this flag” — never store false (that would hide/clear on match). */
function patchBehaviorEffect(
  effect: FormBehaviorDefinition['effects'][number],
  flag: 'visible' | 'required' | 'readOnly',
  enabled: boolean
): FormBehaviorDefinition['effects'][number] {
  const next = { ...effect };
  if (enabled) {
    next[flag] = true;
  } else {
    delete next[flag];
  }
  return next;
}

function RadioOptionsEditor({
  options,
  readOnly,
  onChange
}: {
  options: FormFieldDefinition['options'];
  readOnly?: boolean;
  onChange: (options: Array<{ value: string; label: string }>) => void;
}) {
  const choices = options && options.length > 0 ? options : defaultRadioOptions();
  const [countText, setCountText] = useState(String(choices.length));

  useEffect(() => {
    setCountText(String(choices.length));
  }, [choices.length]);

  function patchChoice(index: number, patch: Partial<{ value: string; label: string }>) {
    onChange(choices.map((choice, choiceIndex) => (choiceIndex === index ? { ...choice, ...patch } : choice)));
  }

  function commitCount(raw: string) {
    const parsed = Number(raw);
    onChange(resizeRadioOptions(choices, parsed));
  }

  return (
    <fieldset className="optic-designer-choice-list">
      <legend>Radio buttons</legend>
      <label>
        Number of radio buttons
        <input
          type="number"
          min={RADIO_CHOICE_MIN}
          max={RADIO_CHOICE_MAX}
          value={countText}
          disabled={readOnly}
          onChange={(event) => {
            const next = event.target.value;
            setCountText(next);
            const parsed = Number(next);
            if (Number.isInteger(parsed) && parsed >= RADIO_CHOICE_MIN && parsed <= RADIO_CHOICE_MAX) {
              onChange(resizeRadioOptions(choices, parsed));
            }
          }}
          onBlur={() => commitCount(countText)}
        />
      </label>
      <p className="optic-help">
        Label is what the officer sees. Value is stored on the case. Use at least two choices.
      </p>
      {choices.map((choice, index) => (
        <div key={`radio-choice-${index}`} className="optic-designer-choice-row">
          <label>
            Option {index + 1} label
            <input
              value={choice.label}
              disabled={readOnly}
              onChange={(event) => patchChoice(index, { label: event.target.value })}
            />
          </label>
          <label>
            Option {index + 1} value
            <input
              value={choice.value}
              disabled={readOnly}
              onChange={(event) => patchChoice(index, { value: event.target.value })}
            />
          </label>
        </div>
      ))}
    </fieldset>
  );
}

function SelectOptionsEditor({
  fieldKey,
  options,
  readOnly,
  onChange
}: {
  fieldKey: string;
  options: FormFieldDefinition['options'];
  readOnly?: boolean;
  onChange: (options: Array<{ value: string; label: string }>) => void;
}) {
  const [text, setText] = useState(() => formatOptions(options));
  const helpId = `select-options-help-${fieldKey}`;

  return (
    <>
      <label>
        Options
        <textarea
          spellCheck={false}
          value={text}
          disabled={readOnly}
          aria-describedby={helpId}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            onChange(parseOptions(next));
          }}
        />
      </label>
      <p className="optic-help" id={helpId}>
        One choice per line. Press Enter for the next choice. Use value|label when the stored value differs from what
        officers see.
      </p>
    </>
  );
}

function formatOptions(options: FormFieldDefinition['options']): string {
  return (options ?? []).map((option) => (option.label === option.value ? option.value : `${option.value}|${option.label}`)).join('\n');
}

function parseOptions(raw: string): Array<{ value: string; label: string }> {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('|');
      if (separator < 0) {
        return { value: line, label: line };
      }
      return { value: line.slice(0, separator).trim(), label: line.slice(separator + 1).trim() || line.slice(0, separator).trim() };
    });
}

function replaceBehavior(
  form: StageFormDefinition,
  index: number,
  patch: Partial<FormBehaviorDefinition>
): StageFormDefinition {
  const behaviors = [...(form.behaviors ?? [])];
  const current = behaviors[index];
  if (!current) {
    return form;
  }
  behaviors[index] = { ...current, ...patch, when: patch.when ?? current.when, effects: patch.effects ?? current.effects };
  return { ...form, behaviors };
}

const DISPLAY_ONLY_COMPONENTS = new Set(['READ_ONLY_VALUE', 'TRACKING_ID_DISPLAY', 'USER_DISPLAY', 'ALERT']);

function canRequireField(component: string): boolean {
  return !DISPLAY_ONLY_COMPONENTS.has(component);
}

function fillFromHelp(field: FormFieldDefinition): string {
  if (field.fillFrom === 'ASSIGNED_TO') {
    return 'Copies the officer this case is assigned to when the field is empty. Save and Complete store that name.';
  }
  if (field.fillFrom === 'TODAY') {
    return 'Copies today’s date in US Eastern Time (America/New_York) when the field is empty. Save and Complete store that date.';
  }
  if (field.fillFrom === 'FIELD') {
    return 'Copies the other date field when this field is empty. A value already saved is left alone.';
  }
  return 'When empty, fill this field from a system or form value. Save and Complete store it. A value already saved is left alone.';
}

function displayFromChipLabel(
  forms: Record<string, StageFormDefinition>,
  formKey: string,
  fieldKey: string
): string {
  const sourceForm = forms[formKey];
  const sourceField = sourceForm?.sections.flatMap((section) => section.fields).find((field) => field.fieldKey === fieldKey);
  const formLabel = sourceForm?.title?.trim() || formKey;
  const fieldLabel = sourceField?.label?.trim() || fieldKey;
  return `${formLabel} · ${fieldLabel}`;
}

function fieldCanvasLabel(
  label: string,
  component: string,
  required?: boolean,
  repeatable?: boolean,
  bindingChips: string[] = []
): string {
  const contract = canRequireField(component) ? (required ? 'required' : 'optional') : 'display';
  const bindings = bindingChips.length > 0 ? `, ${bindingChips.join(', ')}` : '';
  return `Select ${label}, ${contract}${repeatable ? ', repeats' : ''}${bindings}`;
}

function FieldValidationEditor({
  field,
  readOnly,
  onPatch
}: {
  field: FormFieldDefinition;
  readOnly?: boolean;
  onPatch: (next: Partial<FormFieldDefinition>) => void;
}) {
  const family = validationRuleFamily(field.component);
  if (family === 'none') {
    return null;
  }

  function patchValidation(next: FormFieldDefinition['validation']) {
    onPatch({
      validation: validationForComponent(field.component, { ...field.validation, ...next })
    });
  }

  return (
    <fieldset className="optic-designer-behaviors">
      <legend>Validation rules</legend>
      <p className="optic-help">{validationHelp(family)}</p>
      {family === 'length' ? (
        <>
          <label>
            Minimum length
            <input
              type="number"
              min={0}
              value={field.validation?.minLength ?? ''}
              disabled={readOnly}
              onChange={(event) =>
                patchValidation({ minLength: event.target.value === '' ? undefined : Number(event.target.value) })
              }
            />
          </label>
          <label>
            Maximum length
            <input
              type="number"
              min={0}
              value={field.validation?.maxLength ?? ''}
              disabled={readOnly}
              onChange={(event) =>
                patchValidation({ maxLength: event.target.value === '' ? undefined : Number(event.target.value) })
              }
            />
          </label>
          <label>
            Pattern
            <input
              value={field.validation?.pattern ?? ''}
              disabled={readOnly}
              placeholder="e.g. ^A\\d{8,9}$"
              onChange={(event) => patchValidation({ pattern: event.target.value.trim() || undefined })}
            />
          </label>
        </>
      ) : null}
      {family === 'number' ? (
        <>
          <label>
            Minimum
            <input
              type="number"
              value={field.validation?.minimum ?? ''}
              disabled={readOnly}
              onChange={(event) =>
                patchValidation({ minimum: event.target.value === '' ? undefined : Number(event.target.value) })
              }
            />
          </label>
          <label>
            Maximum
            <input
              type="number"
              value={field.validation?.maximum ?? ''}
              disabled={readOnly}
              onChange={(event) =>
                patchValidation({ maximum: event.target.value === '' ? undefined : Number(event.target.value) })
              }
            />
          </label>
        </>
      ) : null}
      {family === 'date' ? (
        <>
          <label>
            Earliest date
            <input
              type="date"
              value={field.validation?.minDate ?? ''}
              disabled={readOnly}
              onChange={(event) => patchValidation({ minDate: event.target.value || undefined })}
            />
          </label>
          <label>
            Latest date
            <input
              type="date"
              value={field.validation?.maxDate ?? ''}
              disabled={readOnly}
              onChange={(event) => patchValidation({ maxDate: event.target.value || undefined })}
            />
          </label>
        </>
      ) : null}
      {family === 'items' ? (
        <>
          <label>
            Minimum selections
            <input
              type="number"
              min={0}
              value={field.validation?.minItems ?? ''}
              disabled={readOnly}
              onChange={(event) =>
                patchValidation({ minItems: event.target.value === '' ? undefined : Number(event.target.value) })
              }
            />
          </label>
          <label>
            Maximum selections
            <input
              type="number"
              min={0}
              value={field.validation?.maxItems ?? ''}
              disabled={readOnly}
              onChange={(event) =>
                patchValidation({ maxItems: event.target.value === '' ? undefined : Number(event.target.value) })
              }
            />
          </label>
        </>
      ) : null}
    </fieldset>
  );
}

function validationHelp(family: ReturnType<typeof validationRuleFamily>): string {
  if (family === 'date') {
    return 'Earliest and latest dates officers may enter. Generate schema writes these as minDate and maxDate. Complete enforces them if the action validates the stage form.';
  }
  if (family === 'number') {
    return 'Lowest and highest values. Generate schema writes these as minimum and maximum. Complete enforces them if the action validates the stage form.';
  }
  if (family === 'items') {
    return 'How many choices officers must pick. Generate schema writes these as minItems and maxItems. Complete enforces them if the action validates the stage form.';
  }
  return 'Minimum and maximum characters, plus an optional regex. Generate schema writes these as minLength, maxLength, and pattern. Complete enforces them if the action validates the stage form.';
}

function ReorderButton({
  direction,
  disabled,
  onClick,
  'aria-label': ariaLabel
}: {
  direction: 'up' | 'down';
  disabled?: boolean;
  onClick: () => void;
  'aria-label': string;
}) {
  return (
    <button
      type="button"
      className="optic-designer-icon-button"
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          d={direction === 'up' ? 'M3.5 10 8 5.5 12.5 10' : 'M3.5 6 8 10.5 12.5 6'}
        />
      </svg>
    </button>
  );
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  return target.isContentEditable;
}

function singleFieldSelection(sectionKey: string, fieldKey: string): DesignerSelection {
  return { type: 'field', sectionKey, fieldKey, fieldKeys: [fieldKey] };
}

function multiFieldSelection(
  sectionKey: string,
  fieldKeys: string[],
  fieldKey: string
): DesignerSelection {
  const unique = [...new Set(fieldKeys)];
  const active = unique.includes(fieldKey) ? fieldKey : unique[0]!;
  return { type: 'field', sectionKey, fieldKey: active, fieldKeys: unique };
}

function selectedFieldKeysOf(selection: Extract<DesignerSelection, { type: 'field' }>): string[] {
  if (selection.fieldKeys?.length) {
    return selection.fieldKeys;
  }
  return selection.fieldKey ? [selection.fieldKey] : [];
}

function firstSectionSelection(form: StageFormDefinition): DesignerSelection {
  return form.sections[0] ? { type: 'section', sectionKey: form.sections[0].sectionKey } : null;
}

function pruneSelection(form: StageFormDefinition, selection: DesignerSelection): DesignerSelection {
  if (!selection) {
    return null;
  }
  const section = form.sections.find((item) => item.sectionKey === selection.sectionKey);
  if (!section) {
    return null;
  }
  if (selection.type === 'section') {
    return selection;
  }
  const existing = new Set(section.fields.map((field) => field.fieldKey));
  const fieldKeys = selectedFieldKeysOf(selection).filter((key) => existing.has(key));
  if (fieldKeys.length === 0) {
    return { type: 'section', sectionKey: selection.sectionKey };
  }
  const fieldKey = fieldKeys.includes(selection.fieldKey) ? selection.fieldKey : fieldKeys[0]!;
  return multiFieldSelection(selection.sectionKey, fieldKeys, fieldKey);
}

type PacketParentOption = {
  fieldKey: string;
  label: string;
  keyHint: string;
  scope: 'PACKET' | 'ROW';
  group: string;
};

function PacketFieldBindingsEditor({
  form,
  releaseForms,
  sectionKey,
  spawnDefinitionKey,
  readOnly,
  onChange
}: {
  form: StageFormDefinition;
  releaseForms?: Record<string, StageFormDefinition>;
  sectionKey: string;
  spawnDefinitionKey: string;
  readOnly?: boolean;
  onChange: (form: StageFormDefinition) => void;
}) {
  const section = form.sections.find((item) => item.sectionKey === sectionKey);
  const bindings = section?.packetFieldBindings ?? [];
  const [childFields, setChildFields] = useState<Array<{ fieldKey: string; label: string; keyHint: string }>>([]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const pendingExpandRef = useRef<string | null>(null);
  const parentFieldGroups = useMemo(() => {
    const seen = new Set<string>();
    const onThisFormPacket: PacketParentOption[] = [];
    const onThisFormRow: PacketParentOption[] = [];
    const onOtherForms = new Map<string, PacketParentOption[]>();

    for (const field of fieldsOutsideSection(form, sectionKey)) {
      if (!field.fieldKey || seen.has(field.fieldKey)) {
        continue;
      }
      seen.add(field.fieldKey);
      onThisFormPacket.push({
        fieldKey: field.fieldKey,
        label: field.label,
        keyHint: field.fieldKey,
        scope: 'PACKET',
        group: 'On this form (packet)'
      });
    }
    for (const field of section?.fields ?? []) {
      if (!field.fieldKey || seen.has(field.fieldKey)) {
        continue;
      }
      seen.add(field.fieldKey);
      onThisFormRow.push({
        fieldKey: field.fieldKey,
        label: field.label,
        keyHint: field.fieldKey,
        scope: 'ROW',
        group: 'On this form (workload row)'
      });
    }
    const otherForms = Object.values(releaseForms ?? {})
      .filter((entry) => entry.formKey !== form.formKey)
      .sort((left, right) => left.formKey.localeCompare(right.formKey));
    for (const other of otherForms) {
      const formLabel = other.title?.trim() || other.formKey;
      const group = `On other mail form · ${formLabel}`;
      for (const entry of other.sections) {
        if (entry.repeatable) {
          continue;
        }
        for (const field of entry.fields) {
          if (!field.fieldKey || seen.has(field.fieldKey)) {
            continue;
          }
          seen.add(field.fieldKey);
          const list = onOtherForms.get(group) ?? [];
          list.push({
            fieldKey: field.fieldKey,
            label: field.label,
            keyHint: field.fieldKey,
            scope: 'PACKET',
            group
          });
          onOtherForms.set(group, list);
        }
      }
    }
    return [
      { group: 'On this form (packet)', options: onThisFormPacket },
      { group: 'On this form (workload row)', options: onThisFormRow },
      ...[...onOtherForms.entries()].map(([group, options]) => ({ group, options }))
    ].filter((entry) => entry.options.length > 0);
  }, [form, releaseForms, section?.fields, sectionKey]);
  const parentFields = useMemo(
    () => parentFieldGroups.flatMap((entry) => entry.options),
    [parentFieldGroups]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const catalog = await listReleaseCatalog();
        const matches = catalog.filter(
          (item) => item.definitionKey === spawnDefinitionKey && item.lifecycleStatus !== 'RETIRED'
        );
        const version =
          matches.find((item) => item.lifecycleStatus === 'DRAFT')?.version ??
          matches.find((item) => item.lifecycleStatus === 'PUBLISHED')?.version ??
          matches[0]?.version;
        if (!version) {
          if (!cancelled) {
            setChildFields([]);
          }
          return;
        }
        const release = await getRelease(spawnDefinitionKey, version);
        if (cancelled) {
          return;
        }
        const initialFormKey =
          release.workflow?.stages.find((stage) => stage.stageKey === release.workflow?.initialStageKey)?.formKey ??
          release.workflow?.stages[0]?.formKey;
        const childForm = initialFormKey ? release.forms?.[initialFormKey] : Object.values(release.forms ?? {})[0];
        setChildFields(
          (childForm?.sections ?? [])
            .filter((entry) => !entry.repeatable)
            .flatMap((entry) => entry.fields)
            .map((field) => ({
              fieldKey: field.fieldKey,
              label: field.label,
              keyHint: field.fieldKey
            }))
        );
      } catch {
        if (!cancelled) {
          setChildFields([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spawnDefinitionKey]);

  useEffect(() => {
    if (expandedKey && !bindings.some((binding) => binding.bindingKey === expandedKey)) {
      setExpandedKey(null);
    }
  }, [bindings, expandedKey]);

  function replaceBindings(next: PacketFieldBinding[]) {
    onChange(updateSection(form, sectionKey, { packetFieldBindings: next.length > 0 ? next : undefined }));
  }

  function patchBinding(index: number, patch: Partial<PacketFieldBinding>) {
    replaceBindings(bindings.map((binding, itemIndex) => (itemIndex === index ? { ...binding, ...patch } : binding)));
  }

  function addFieldLink() {
    const bindingKey = `BINDING_${bindings.length + 1}`;
    pendingExpandRef.current = bindingKey;
    replaceBindings([
      ...bindings,
      {
        bindingKey,
        parentFieldKey: '',
        childFieldKey: '',
        mode: 'INHERIT_ONCE',
        parentScope: 'PACKET'
      }
    ]);
    setExpandedKey(bindingKey);
  }

  function parentLabel(fieldKey: string): string {
    return parentFields.find((field) => field.fieldKey === fieldKey)?.label || fieldKey || 'Mail field';
  }

  function childLabel(fieldKey: string): string {
    return childFields.find((field) => field.fieldKey === fieldKey)?.label || fieldKey || 'Workload field';
  }

  function bindingSummary(binding: PacketFieldBinding): string {
    const from = parentLabel(binding.parentFieldKey);
    const to = childLabel(binding.childFieldKey);
    if (!binding.parentFieldKey && !binding.childFieldKey) {
      return 'Pick mail and workload fields';
    }
    return `${from} → ${to} · ${packetBindingModeSummary(binding.mode)}`;
  }

  function bindingHelp(binding: PacketFieldBinding): string {
    if (!binding.parentFieldKey || !binding.childFieldKey) {
      return 'Choose a mail field and a workload field, then how they should sync.';
    }
    return packetBindingModeLabel(binding.mode);
  }

  return (
    <fieldset className="optic-designer-behaviors optic-packet-field-links">
      <legend>Copy fields to spawned workloads</legend>
      <p className="optic-help">
        When this section creates <strong>{spawnDefinitionKey}</strong> cases, link mail fields to workload fields.
        Expand a row to edit.
      </p>
      {bindings.length > 0 ? (
        <ul className="optic-packet-link-list" aria-label="Field links to spawned workloads">
          {bindings.map((binding, index) => {
            const expanded =
              expandedKey === binding.bindingKey || pendingExpandRef.current === binding.bindingKey;
            return (
              <li
                key={binding.bindingKey}
                className="optic-packet-link-row"
                data-expanded={expanded ? 'true' : undefined}
              >
                <div className="optic-packet-link-summary">
                  <span className="optic-packet-link-order" aria-hidden="true">
                    {index + 1}
                  </span>
                  <button
                    type="button"
                    className="optic-packet-link-toggle"
                    aria-expanded={expanded}
                    aria-label={
                      expanded
                        ? `Collapse field link ${index + 1}`
                        : `Expand field link ${index + 1}: ${bindingSummary(binding)}`
                    }
                    onClick={() => {
                      pendingExpandRef.current = null;
                      setExpandedKey(expanded ? null : binding.bindingKey);
                    }}
                  >
                    <span className="optic-packet-link-preview">{bindingSummary(binding)}</span>
                  </button>
                  <button
                    type="button"
                    className="optic-designer-quiet-button"
                    disabled={readOnly}
                    aria-label={`Remove field link ${index + 1}`}
                    title="Remove field link"
                    onClick={() => {
                      replaceBindings(bindings.filter((_, itemIndex) => itemIndex !== index));
                      if (expandedKey === binding.bindingKey) {
                        setExpandedKey(null);
                      }
                    }}
                  >
                    <ButtonLabel icon="trash">Remove</ButtonLabel>
                  </button>
                </div>
                {expanded ? (
                  <div className="optic-packet-link-editor">
                    <label>
                      Field on this mail packet
                      <select
                        value={binding.parentFieldKey}
                        disabled={readOnly}
                        onChange={(event) => {
                          const selected = parentFields.find((field) => field.fieldKey === event.target.value);
                          patchBinding(index, {
                            parentFieldKey: event.target.value,
                            parentScope: selected?.scope
                          });
                        }}
                      >
                        <option value="">Select mail field…</option>
                        {parentFieldGroups.map((group) => (
                          <optgroup key={group.group} label={group.group}>
                            {group.options.map((field) => (
                              <option key={`${field.scope}-${field.fieldKey}`} value={field.fieldKey}>
                                {field.label} · {field.keyHint}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                    <label>
                      Field on {spawnDefinitionKey}
                      <select
                        value={binding.childFieldKey}
                        disabled={readOnly}
                        onChange={(event) => patchBinding(index, { childFieldKey: event.target.value })}
                      >
                        <option value="">Select workload field…</option>
                        {binding.childFieldKey &&
                        !childFields.some((field) => field.fieldKey === binding.childFieldKey) ? (
                          <option value={binding.childFieldKey}>
                            {binding.childFieldKey} (not on loaded child form)
                          </option>
                        ) : null}
                        {childFields.map((field) => (
                          <option key={field.fieldKey} value={field.fieldKey}>
                            {field.label} · {field.keyHint}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      When to copy
                      <select
                        value={binding.mode}
                        disabled={readOnly}
                        onChange={(event) =>
                          patchBinding(index, { mode: event.target.value as PacketFieldBindingMode })
                        }
                      >
                        <option value="INHERIT_ONCE">Copy once when workload is created</option>
                        <option value="PROJECT_PARENT">Always show mail value on the workload</option>
                        <option value="PROJECT_CHILD">Always show workload value back on the mail row</option>
                      </select>
                    </label>
                    <p className="optic-help">{bindingHelp(binding)}</p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="optic-help">No field links yet—add one to copy Received Date or other values onto the workload.</p>
      )}
      <button type="button" disabled={readOnly} onClick={addFieldLink}>
        Add field link
      </button>
      {childFields.length === 0 ? (
        <p className="optic-help">
          Open or save a draft of {spawnDefinitionKey} so workload field names can load into the picker.
        </p>
      ) : null}
    </fieldset>
  );
}

function fieldsOutsideSection(form: StageFormDefinition, sectionKey: string): FormFieldDefinition[] {
  return form.sections
    .filter((section) => section.sectionKey !== sectionKey)
    .flatMap((section) => section.fields);
}

function spawnDefinitionOptions(
  choices: Array<{ definitionKey: string; displayName: string }>,
  current?: string
): Array<{ definitionKey: string; displayName: string }> {
  if (current && !choices.some((choice) => choice.definitionKey === current)) {
    return [...choices, { definitionKey: current, displayName: current }];
  }
  return choices;
}
