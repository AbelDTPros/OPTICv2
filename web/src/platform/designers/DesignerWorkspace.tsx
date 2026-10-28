import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  ActionDefinition,
  BulkActionDefinition,
  JsonSchema,
  QueueDefinition,
  ScheduledActionDefinition,
  SearchDefinition,
  SlaDefinition,
  StageFormDefinition,
  WorkflowDefinition
} from '../../../../src/modules/configuration/domain/types.js';
import {
  createDefinition,
  createDraftRelease,
  deleteActionDraft,
  deleteBulkActionDraft,
  deleteDraftRelease,
  deleteFormDraft,
  deleteQueueDraft,
  deleteScheduledActionDraft,
  deleteSlaDraft,
  DESIGNER_API_UNREACHABLE,
  DesignerApiError,
  diffReleases,
  exportReleasePackage,
  getRelease,
  importReleasePackage,
  listReleaseCatalog,
  mutateLifecycle,
  saveActionDraft,
  saveBulkActionDraft,
  saveFormDraft,
  saveQueueDraft,
  saveScheduledActionDraft,
  saveSchemaDraft,
  saveSearchDraft,
  saveSlaDraft,
  saveWorkflowDraft,
  simulateTransition,
  validateRelease,
  type DesignerRelease,
  type ReleaseCatalogItem,
  type SemanticDiffResult,
  type SimulateTransitionResult,
  type ValidateReleaseResult
} from './config-api.js';
import { asDisplayError, type DisplayError } from '../api/apply-api-error.js';
import { CaughtErrorBanner } from '../ui/CaughtErrorBanner.js';
import { useFeatureFlags } from '../features/FeatureFlagsContext.js';
import { DESIGNER_USER_GUIDE } from '../guides/guide-sources.js';
import { UserGuideDialog } from '../guides/UserGuideDialog.js';
import {
  APP_NAVIGATE_EVENT,
  consumeDesignerFocusHint,
  type DesignerFocusHint
} from '../navigation/app-navigation.js';
import { CatalogDesigner, type CatalogKind } from './CatalogDesigner.js';
import { ButtonLabel, StatusPill, type IconName } from '../ui/Icon.js';
import {
  blankDesignerForm,
  blankDesignerWorkflow,
  demoDesignerAction,
  demoDesignerBulk,
  demoDesignerForm,
  demoDesignerQueue,
  demoDesignerScheduled,
  demoDesignerSearch,
  demoDesignerSla,
  demoDesignerWorkflow
} from './demo-draft.js';
import { FormDesigner } from './FormDesigner.js';
import { TryAsOfficerPanel } from './TryAsOfficerPanel.js';
import { WorkflowDesigner } from './WorkflowDesigner.js';
import { isDesignerDirty, isFormDirty } from './designer-dirty.js';
import {
  confirmLeaveDesigner,
  setDesignerUnsavedChanges
} from './designer-leave-guard.js';
import {
  retargetDisplayFromFormKeys,
  scrubDisplayFromFormKey,
  syncDisplayFromAfterFormEdit
} from './form-integrity.js';
import {
  duplicateFormDefinition,
  releaseSchemaFromForms,
  schemaAtDataPath,
  schemaFromForm
} from './form-model.js';
import {
  catalogFromRelease,
  listFormsInWorkflowOrder,
  outboundBinding,
  retargetActionTransitionSet,
  type WorkflowCatalog
} from './workflow-model.js';
import {
  ENTITY_TYPE_OPTIONS,
  entityTypeForCatalogItem,
  entityTypeOptionLabel,
  normalizeEntityType
} from './catalog-model.js';

export function DesignerWorkspace() {
  const { isEnabled } = useFeatureFlags();
  const tryTabEnabled = isEnabled('ui.designer.try');
  const simulateTabEnabled = isEnabled('ui.designer.simulate');
  const lifecycleTabEnabled = isEnabled('ui.designer.lifecycle');
  const diffTabEnabled = isEnabled('ui.designer.diff');
  const catalogEnabledKinds = useMemo(() => {
    const kinds: CatalogKind[] = ['action', 'queue'];
    if (isEnabled('ui.designer.catalog.sla')) {
      kinds.push('sla');
    }
    if (isEnabled('ui.designer.catalog.search')) {
      kinds.push('search');
    }
    if (isEnabled('ui.designer.catalog.bulk')) {
      kinds.push('bulk');
    }
    if (isEnabled('ui.designer.catalog.scheduled')) {
      kinds.push('scheduled');
    }
    return kinds;
  }, [isEnabled]);
  const [guideOpen, setGuideOpen] = useState(false);
  const [definitionKey, setDefinitionKey] = useState('I_DESIGN');
  const [version, setVersion] = useState('0.1.0');
  const [cloneSource, setCloneSource] = useState('');
  const [cloneChoices, setCloneChoices] = useState<ReleaseCatalogItem[]>([]);
  const [displayName, setDisplayName] = useState('Designer demo');
  const [entityType, setEntityType] = useState<'WORKLOAD' | 'MAIL'>('WORKLOAD');
  const [tab, setTab] = useState<
    'workflow' | 'form' | 'schema' | 'catalog' | 'lifecycle' | 'simulate' | 'try' | 'diff'
  >('form');
  useEffect(() => {
    const hint = consumeDesignerFocusHint();
    if (hint?.tab) {
      setTab(hint.tab);
    }
    function onNavigate(event: Event) {
      const detail = (event as CustomEvent<{ view?: string; designerFocus?: DesignerFocusHint }>).detail;
      if (detail?.view !== 'designer' || !detail.designerFocus?.tab) {
        return;
      }
      setTab(detail.designerFocus.tab);
    }
    window.addEventListener(APP_NAVIGATE_EVENT, onNavigate);
    return () => window.removeEventListener(APP_NAVIGATE_EVENT, onNavigate);
  }, []);

  useEffect(() => {
    if (tab === 'try' && !tryTabEnabled) {
      setTab('form');
    } else if (tab === 'simulate' && !simulateTabEnabled) {
      setTab('form');
    } else if (tab === 'lifecycle' && !lifecycleTabEnabled) {
      setTab('form');
    } else if (tab === 'diff' && !diffTabEnabled) {
      setTab('form');
    }
  }, [diffTabEnabled, lifecycleTabEnabled, simulateTabEnabled, tab, tryTabEnabled]);
  const [forms, setForms] = useState<Record<string, StageFormDefinition>>({
    [demoDesignerForm.formKey]: demoDesignerForm
  });
  const [formKey, setFormKey] = useState(demoDesignerForm.formKey);
  const [workflow, setWorkflow] = useState<WorkflowDefinition>(demoDesignerWorkflow);
  const [actions, setActions] = useState<Record<string, ActionDefinition>>({
    [demoDesignerAction.actionKey]: demoDesignerAction
  });
  const [queues, setQueues] = useState<Record<string, QueueDefinition>>({
    [demoDesignerQueue.queueKey]: demoDesignerQueue
  });
  const [slas, setSlas] = useState<Record<string, SlaDefinition>>({
    [demoDesignerSla.slaKey]: demoDesignerSla
  });
  const [search, setSearch] = useState<SearchDefinition>(demoDesignerSearch);
  const [bulkActions, setBulkActions] = useState<Record<string, BulkActionDefinition>>({
    [demoDesignerBulk.bulkActionKey]: demoDesignerBulk
  });
  const [scheduledActions, setScheduledActions] = useState<Record<string, ScheduledActionDefinition>>({
    [demoDesignerScheduled.scheduledActionKey]: demoDesignerScheduled
  });
  const [release, setRelease] = useState<DesignerRelease | undefined>();
  const [rowVersion, setRowVersion] = useState(0);
  const [lifecycleStatus, setLifecycleStatus] = useState('DRAFT');
  const [errorSummary, setErrorSummary] = useState<DisplayError | undefined>();
  const [status, setStatus] = useState('Editing locally. Open or create a DRAFT to save through the API.');
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>();
  const [releasePickerMode, setReleasePickerMode] = useState<'open' | 'clone' | null>(null);
  const [openQuery, setOpenQuery] = useState('');
  const [openFilter, setOpenFilter] = useState<ReleaseCatalogFilter>('ALL');
  const [releaseEditorOpen, setReleaseEditorOpen] = useState(true);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const cloneButtonRef = useRef<HTMLButtonElement>(null);
  const openPickerTitleRef = useRef<HTMLHeadingElement>(null);
  const openSearchRef = useRef<HTMLInputElement>(null);
  const releasePickerOpen = releasePickerMode !== null;
  const form = forms[formKey] ?? blankDesignerForm;
  const readOnly = lifecycleStatus !== 'DRAFT';
  const releaseIdentity = release ? `${release.definitionKey}@${release.version}` : '';
  useEffect(() => {
    setReleaseEditorOpen(!release);
  }, [releaseIdentity]);
  const formDirty = useMemo(
    () => isFormDirty(form, release?.forms?.[form.formKey]),
    [form, release]
  );
  const workflowDirty = useMemo(() => {
    if (!release) {
      return true;
    }
    if (isDesignerDirty(workflow, release.workflow)) {
      return true;
    }
    if (isDesignerDirty(scheduledActions, release.scheduledActions ?? {})) {
      return true;
    }
    for (const [key, action] of Object.entries(actions)) {
      const saved = release.actions?.[key];
      if (saved && saved.transitionSetKey !== action.transitionSetKey) {
        return true;
      }
    }
    return false;
  }, [actions, release, scheduledActions, workflow]);
  const catalogDirty = useMemo(() => {
    if (!release) {
      return true;
    }
    return (
      isDesignerDirty(actions, release.actions ?? {}) ||
      isDesignerDirty(queues, release.queues ?? {}) ||
      isDesignerDirty(slas, release.slas ?? {}) ||
      isDesignerDirty(search, release.search) ||
      isDesignerDirty(bulkActions, release.bulkActions ?? {}) ||
      isDesignerDirty(scheduledActions, release.scheduledActions ?? {})
    );
  }, [actions, bulkActions, queues, release, scheduledActions, search, slas]);
  const hasUnsavedChanges = Boolean(release) && !readOnly && (formDirty || workflowDirty || catalogDirty);
  useEffect(() => {
    setDesignerUnsavedChanges(hasUnsavedChanges);
    return () => setDesignerUnsavedChanges(false);
  }, [hasUnsavedChanges]);
  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedChanges]);

  const autosaveBusyRef = useRef(false);
  useEffect(() => {
    if (!release || readOnly || !hasUnsavedChanges || autosaveBusyRef.current) {
      return;
    }
    if (tab !== 'form' && tab !== 'workflow') {
      return;
    }
    const timer = window.setTimeout(() => {
      if (autosaveBusyRef.current) {
        return;
      }
      autosaveBusyRef.current = true;
      void run(async () => {
        try {
          if (tab === 'form' && formDirty) {
            const withSchema = { ...form, schema: schemaFromForm(form) };
            let next = await saveFormDraft(definitionKey, version, rowVersion, withSchema);
            const releaseSchema = releaseSchemaFromForms(
              { ...forms, [withSchema.formKey]: withSchema },
              release?.schema
            );
            if (releaseSchema) {
              next = await saveSchemaDraft(definitionKey, version, next.rowVersion, releaseSchema);
            }
            applyRelease(next, withSchema.formKey);
            setStatus(`Autosaved form ${withSchema.formKey}.`);
          } else if (tab === 'workflow' && workflowDirty) {
            let next = await saveWorkflowDraft(definitionKey, version, rowVersion, workflow);
            for (const action of Object.values(actions)) {
              const saved = release?.actions?.[action.actionKey];
              if (saved && saved.transitionSetKey !== action.transitionSetKey) {
                next = await saveActionDraft(definitionKey, version, next.rowVersion, action);
              }
            }
            for (const scheduled of Object.values(scheduledActions)) {
              const saved = release?.scheduledActions?.[scheduled.scheduledActionKey];
              if (!saved || JSON.stringify(saved) !== JSON.stringify(scheduled)) {
                next = await saveScheduledActionDraft(definitionKey, version, next.rowVersion, scheduled);
              }
            }
            applyRelease(next, formKey);
            setStatus('Autosaved workflow.');
          }
        } finally {
          autosaveBusyRef.current = false;
        }
      });
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [
    actions,
    definitionKey,
    form,
    formDirty,
    formKey,
    forms,
    hasUnsavedChanges,
    readOnly,
    release,
    rowVersion,
    scheduledActions,
    tab,
    version,
    workflow,
    workflowDirty
  ]);

  const openCatalogGroups = useMemo(
    () => groupReleaseCatalog(filterReleaseCatalog(cloneChoices, openQuery, openFilter)),
    [cloneChoices, openQuery, openFilter]
  );
  useEffect(() => {
    void refreshCloneChoices();
  }, []);
  useEffect(() => {
    if (!releasePickerOpen) {
      return;
    }
    openSearchRef.current?.focus();
  }, [releasePickerOpen]);
  useEffect(() => {
    if (!releasePickerOpen) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return;
      }
      closeReleasePicker();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [releasePickerOpen]);

  function closeReleasePicker() {
    const mode = releasePickerMode;
    setReleasePickerMode(null);
    setOpenQuery('');
    setOpenFilter('ALL');
    if (mode === 'clone') {
      cloneButtonRef.current?.focus();
    } else {
      openButtonRef.current?.focus();
    }
  }

  async function refreshCloneChoices() {
    try {
      setCloneChoices(await listReleaseCatalog());
    } catch {
      setCloneChoices([]);
    }
  }

  async function openReleasePicker(mode: 'open' | 'clone') {
    await run(async () => {
      const items = await listReleaseCatalog();
      setCloneChoices(items);
      setOpenQuery('');
      setOpenFilter('ALL');
      setReleasePickerMode(mode);
      setStatus(
        items.length === 0
          ? 'No saved releases yet. Create a draft first.'
          : mode === 'clone'
            ? 'Choose a release to clone from, or keep a blank draft.'
            : 'Choose a saved release to open.'
      );
    });
  }

  async function openCatalogRelease(item: ReleaseCatalogItem) {
    if (
      hasUnsavedChanges &&
      !confirmLeaveDesigner('You have unsaved Designer changes. Open another release without saving?')
    ) {
      return;
    }
    await run(async () => {
      const next = await getRelease(item.definitionKey, item.version);
      setDefinitionKey(item.definitionKey);
      setVersion(item.version);
      setDisplayName(item.displayName);
      applyRelease(next);
      setLastSavedAt(Date.now());
      setReleasePickerMode(null);
      setOpenQuery('');
      setOpenFilter('ALL');
    });
  }

  function pickCloneSource(item: ReleaseCatalogItem | null) {
    if (!item) {
      setCloneSource('');
    } else {
      setCloneSource(cloneSourceValue(item));
      setEntityType(entityTypeForCatalogItem(item));
    }
    closeReleasePicker();
  }

  function cloneSourceSummary(): string {
    if (!cloneSource) {
      return 'None — blank draft';
    }
    const parsed = parseCloneSource(cloneSource);
    if (!parsed) {
      return cloneSource;
    }
    const item = cloneChoices.find(
      (choice) => choice.definitionKey === parsed.definitionKey && choice.version === parsed.version
    );
    if (!item) {
      return `${parsed.definitionKey} ${parsed.version}`;
    }
    return `${item.displayName} ${item.version}`;
  }

  const catalog = useMemo(
    () =>
      catalogFromRelease({
        ...(release ?? {}),
        forms: { ...release?.forms, ...forms },
        actions: { ...release?.actions, ...actions },
        queues: { ...release?.queues, ...queues },
        slas: { ...release?.slas, ...slas },
        bulkActions: { ...release?.bulkActions, ...bulkActions },
        scheduledActions: { ...release?.scheduledActions, ...scheduledActions }
      }),
    [release, forms, actions, queues, slas, bulkActions, scheduledActions]
  );
  const stageKeys = useMemo(() => workflow.stages.map((stage) => stage.stageKey), [workflow.stages]);
  const transitionSetKeys = useMemo(
    () => workflow.transitionSets.map((set) => set.transitionSetKey),
    [workflow.transitionSets]
  );
  const formsInWorkflowOrder = useMemo(
    () => listFormsInWorkflowOrder(forms, workflow),
    [forms, workflow]
  );

  function applyRelease(next: DesignerRelease, preferredFormKey = formKey) {
    setRelease(next);
    setRowVersion(next.rowVersion);
    setLifecycleStatus(next.lifecycleStatus);
    const nextWorkflow = next.workflow?.stages?.length ? next.workflow : blankDesignerWorkflow;
    setWorkflow(nextWorkflow);
    setActions(next.actions ?? {});
    setQueues(next.queues ?? {});
    setSlas(next.slas ?? {});
    if (next.search) {
      setSearch(next.search);
    }
    setBulkActions(next.bulkActions ?? {});
    setScheduledActions(next.scheduledActions ?? {});
    const nextForms = seedFormSchemas(next.forms, next.schema);
    if (Object.keys(nextForms).length > 0) {
      setForms(nextForms);
      setFormKey(pickFormKey(nextForms, nextWorkflow, preferredFormKey));
    } else {
      const created = { ...blankDesignerForm, formKey: nextFormKey({}) };
      setForms({ [created.formKey]: created });
      setFormKey(created.formKey);
    }
    setErrorSummary(undefined);
    setEntityType(normalizeEntityType(next.entityType));
    setLastSavedAt(Date.now());
    setStatus(releaseStatusLine(next));
  }

  function changeForm(next: StageFormDefinition) {
    setForms((current) => {
      const previousKey = formKey;
      const previous = current[previousKey] ?? current[next.formKey];
      let copy = { ...current };
      if (previousKey !== next.formKey) {
        delete copy[previousKey];
        copy = retargetDisplayFromFormKeys(copy, previousKey, next.formKey);
      }
      copy[next.formKey] = next;
      if (previous) {
        copy = syncDisplayFromAfterFormEdit(copy, { ...previous, formKey: next.formKey }, next);
      }
      return copy;
    });
    setFormKey(next.formKey);
  }

  async function run(work: () => Promise<void>) {
    try {
      setErrorSummary(undefined);
      await work();
    } catch (error: unknown) {
      setErrorSummary(caughtDesignerError(error));
    }
  }

  return (
    <div className="optic-designer-workspace">
      <header className="optic-designer-page-intro">
        <div className="optic-designer-page-intro-copy">
          <p className="optic-designer-kicker">Authoring</p>
          <p className="optic-designer-page-title">Designer</p>
          <p className="optic-help">
            Build forms, workflow, and catalog for a definition release, then rehearse and promote it to Live.
          </p>
        </div>
        <div className="optic-designer-page-intro-status" aria-label="Release status">
          <StatusPill>{lifecycleStatus}</StatusPill>
          {release?.active ? <StatusPill>Live</StatusPill> : null}
          {release ? (
            <span className="optic-designer-page-release-id">
              {definitionKey} · {version}
            </span>
          ) : (
            <span className="optic-designer-page-release-id">No release open</span>
          )}
          {release && !readOnly ? (
            <p
              className={`optic-designer-save-state${hasUnsavedChanges ? ' is-dirty' : ''}`}
              role="status"
              aria-live="polite"
            >
              {hasUnsavedChanges
                ? 'Unsaved changes'
                : lastSavedAt
                  ? `Saved · ${formatSavedWhen(lastSavedAt)}`
                  : 'All changes saved'}
            </p>
          ) : null}
        </div>
      </header>

      <form className="optic-designer-open" onSubmit={(event) => event.preventDefault()}>
        <fieldset className="optic-designer-open-grid">
          <legend>Definition release</legend>

          <section className="optic-designer-open-zone optic-designer-open-zone-hero" aria-label="Release actions">
            <div className="optic-designer-open-header">
              <div>
                <p className="optic-designer-open-section-label">Release</p>
                <p className="optic-help">
                  {release && !releaseEditorOpen
                    ? `${displayName} · ${entityType === 'MAIL' ? 'Mail item' : 'Workload'} · Edit release details when you need a new draft or form.`
                    : 'Open an existing release to edit it, or fill the fields below and create a new draft.'}
                </p>
              </div>
              <div className="optic-designer-open-action-group" role="group" aria-label="Release actions">
                <button
                  ref={openButtonRef}
                  type="button"
                  className="optic-button-primary"
                  onClick={() => void openReleasePicker('open')}
                >
                  <ButtonLabel icon="folder">Open definition</ButtonLabel>
                </button>
                {release ? (
                  <button
                    type="button"
                    className="optic-button-secondary"
                    aria-expanded={releaseEditorOpen}
                    aria-controls="optic-designer-release-editor"
                    onClick={() => setReleaseEditorOpen((open) => !open)}
                  >
                    <ButtonLabel icon="draft">
                      {releaseEditorOpen ? 'Hide release details' : 'Edit release'}
                    </ButtonLabel>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    if (
                      hasUnsavedChanges &&
                      !confirmLeaveDesigner('You have unsaved Designer changes. Create a new draft without saving?')
                    ) {
                      return;
                    }
                    void run(async () => {
                      await createDefinition({ definitionKey, displayName, entityType });
                      applyRelease(await createDraftRelease(definitionKey, version, parseCloneSource(cloneSource)));
                      setReleasePickerMode(null);
                      await refreshCloneChoices();
                    });
                  }}
                >
                  <ButtonLabel icon="draft">Create draft</ButtonLabel>
                </button>
                <button
                  type="button"
                  disabled={!release || lifecycleStatus !== 'DRAFT'}
                  onClick={() => {
                    if (!release || lifecycleStatus !== 'DRAFT') {
                      return;
                    }
                    if (!window.confirm(`Delete draft ${definitionKey} ${version}? This cannot be undone.`)) {
                      return;
                    }
                    void run(async () => {
                      const result = await deleteDraftRelease(definitionKey, version, rowVersion);
                      setRelease(undefined);
                      setRowVersion(0);
                      setLifecycleStatus('DRAFT');
                      setReleasePickerMode(null);
                      await refreshCloneChoices();
                      setStatus(
                        result.definitionRemoved
                          ? `${result.definitionKey} was deleted (no remaining releases). Open another release or Create draft.`
                          : `${result.definitionKey} ${result.version} was deleted. Open another release or Create draft.`
                      );
                    });
                  }}
                >
                  <ButtonLabel icon="trash">Delete draft</ButtonLabel>
                </button>
              </div>
            </div>
          </section>

          <div
            id="optic-designer-release-editor"
            className="optic-designer-release-editor"
            hidden={Boolean(release) && !releaseEditorOpen}
          >
          <section className="optic-designer-open-zone" aria-label="New draft">
            <p className="optic-designer-open-section-label">New draft</p>
            <div className="optic-designer-open-identity">
              <label>
                Definition key
                <input value={definitionKey} onChange={(event) => setDefinitionKey(event.target.value.toUpperCase())} />
              </label>
              <label>
                Display name
                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              </label>
              <label>
                Entity type
                <select
                  value={entityType}
                  aria-describedby="entity-type-help"
                  onChange={(event) => setEntityType(normalizeEntityType(event.target.value))}
                >
                  {ENTITY_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Version
                <input value={version} onChange={(event) => setVersion(event.target.value)} />
              </label>
              <label>
                Clone from
                <button
                  ref={cloneButtonRef}
                  type="button"
                  className="optic-designer-open-picker-field"
                  aria-describedby="clone-from-help"
                  aria-haspopup="dialog"
                  onClick={() => void openReleasePicker('clone')}
                >
                  <span className="optic-designer-open-picker-field-copy">
                    <strong>{cloneSourceSummary()}</strong>
                    {cloneSource ? (
                      <span className="optic-form-key">{cloneSource.replace('@', ' · ')}</span>
                    ) : (
                      <span>Start empty, or pick a release to copy</span>
                    )}
                  </span>
                  <ButtonLabel icon="folder">Browse</ButtonLabel>
                </button>
              </label>
            </div>
            <div className="optic-designer-open-helps">
              <details className="optic-designer-open-help">
                <summary>About entity type</summary>
                <p id="entity-type-help" className="optic-help optic-designer-open-clone-help">
                  Workload is a form case (I-407). Mail item is the envelope that can have one or more workloads. Picking
                  Clone from fills this from that definition; you can still change it before Create draft. Opening a
                  release shows its saved type. New queues use the same type.
                </p>
              </details>
              <details className="optic-designer-open-help">
                <summary>About clone and delete</summary>
                <p id="clone-from-help" className="optic-help optic-designer-open-clone-help">
                  Copies forms, workflow, and catalog from the picked release and fills Entity type to match that
                  definition. Workspace Try uses the newest DRAFT, so clone that draft if you want the same officer
                  screens (for example New Mail Item). A published snapshot may be an older or simpler package. Cloning
                  onto a different definition rewrites form keys, internal queue keys, form titles, and mail spawn
                  targets to the new type (I-407 → I-936) so Live queues do not collide. Officer-facing queue names stay
                  as they were (Ready for Data Entry). A new version of the same definition keeps the existing keys.
                  Delete draft removes an opened DRAFT (leftover clones, unused experiments) and any Try cases cooked
                  from that draft. Published releases cannot be deleted; retire them from Lifecycle instead.
                </p>
              </details>
            </div>
          </section>

          <section className="optic-designer-open-zone optic-designer-open-forms" aria-labelledby="draft-forms-label">
            <p className="optic-designer-open-section-label" id="draft-forms-label">
              Forms on this draft
            </p>
            <p className="optic-help">
              Listed in workflow stage order (earliest stage that uses the form first). Link forms on the Workflow tab to
              change the order.
            </p>
            <div className="optic-designer-open-toolbar" role="group" aria-labelledby="draft-forms-label">
              <label>
                Form
                <select value={formKey} onChange={(event) => setFormKey(event.target.value)}>
                  {formsInWorkflowOrder.map((item) => (
                    <option key={item.formKey} value={item.formKey}>
                      {item.title} ({item.formKey})
                    </option>
                  ))}
                </select>
              </label>
              <div className="optic-designer-open-action-group" role="group" aria-label="Form actions">
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => {
                    const created = {
                      ...blankDesignerForm,
                      formKey: nextFormKey(forms)
                    };
                    setForms((current) => ({ ...current, [created.formKey]: created }));
                    setFormKey(created.formKey);
                    setTab('form');
                  }}
                >
                  <ButtonLabel icon="form">New form</ButtonLabel>
                </button>
                <button
                  type="button"
                  disabled={readOnly}
                  title="Copy the selected form onto this draft with a new key. Stages keep their current form links."
                  onClick={() => {
                    const sourceKey = form.formKey;
                    const created = duplicateFormDefinition(form, Object.keys(forms));
                    setForms((current) => ({ ...current, [created.formKey]: created }));
                    setFormKey(created.formKey);
                    setTab('form');
                    setStatus(
                      `${created.formKey} was copied from ${sourceKey}. Link it on the Workflow tab when a stage should use it.`
                    );
                  }}
                >
                  <ButtonLabel icon="copy">Duplicate form</ButtonLabel>
                </button>
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() =>
                    run(async () => {
                      const removedKey = formKey;
                      const referenced = workflow.stages.some((stage) => stage.formKey === removedKey);
                      if (release?.forms?.[removedKey]) {
                        const next = await deleteFormDraft(definitionKey, version, rowVersion, removedKey);
                        applyRelease(next);
                        if (referenced) {
                          setStatus(
                            `${removedKey} was deleted. Clear that form key on any stages that still point at it before you validate.`
                          );
                        }
                        return;
                      }
                      const remaining = scrubDisplayFromFormKey(
                        Object.fromEntries(Object.entries(forms).filter(([key]) => key !== removedKey)),
                        removedKey
                      );
                      if (Object.keys(remaining).length === 0) {
                        const created = { ...blankDesignerForm, formKey: nextFormKey({}) };
                        setForms({ [created.formKey]: created });
                        setFormKey(created.formKey);
                      } else {
                        setForms(remaining);
                        setFormKey(pickFormKey(remaining, workflow));
                      }
                      setStatus(
                        referenced
                          ? `${removedKey} was removed locally. Clear that form key on any stages that still point at it.`
                          : `${removedKey} was removed from this workspace.`
                      );
                    })
                  }
                >
                  <ButtonLabel icon="trash">Delete form</ButtonLabel>
                </button>
              </div>
            </div>
          </section>
          </div>
        </fieldset>
        <div className="optic-designer-open-footer">
          <p className="optic-help optic-status" role="status">
            {status} {readOnly ? 'Save is disabled because only DRAFT releases can be edited.' : ''}
          </p>
        </div>
      </form>
      {releasePickerOpen ? (
        <div
          className="optic-designer-open-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeReleasePicker();
            }
          }}
        >
          <div
            className="optic-designer-open-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="open-release-title"
          >
            <div className="optic-designer-open-picker-header">
              <h2 id="open-release-title" ref={openPickerTitleRef} tabIndex={-1}>
                {releasePickerMode === 'clone' ? 'Clone from' : 'Open definition'}
              </h2>
              <button type="button" onClick={closeReleasePicker}>
                Cancel
              </button>
            </div>
            <div className="optic-designer-open-dialog-tools">
              <label>
                Search releases
                <input
                  ref={openSearchRef}
                  value={openQuery}
                  placeholder="Name, key, or version"
                  onChange={(event) => setOpenQuery(event.target.value)}
                />
              </label>
              <label>
                Show
                <select
                  value={openFilter}
                  onChange={(event) => setOpenFilter(event.target.value as ReleaseCatalogFilter)}
                >
                  <option value="ALL">All releases</option>
                  <option value="DRAFT">Drafts</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="LIVE">Live only</option>
                </select>
              </label>
            </div>
            {releasePickerMode === 'clone' ? (
              <button
                type="button"
                className="optic-designer-open-choice"
                data-selected={!cloneSource ? 'true' : undefined}
                onClick={() => pickCloneSource(null)}
              >
                <span className="optic-designer-open-choice-copy">
                  <strong>None — blank draft</strong>
                  <span>Create an empty draft without copying a release</span>
                </span>
              </button>
            ) : null}
            {cloneChoices.length === 0 ? (
              <p className="optic-help">No saved releases yet. Create a draft first.</p>
            ) : openCatalogGroups.length === 0 ? (
              <p className="optic-help">No releases match this search or filter.</p>
            ) : (
              <ul className="optic-designer-open-groups">
                {openCatalogGroups.map((group) => (
                  <li key={group.definitionKey} className="optic-designer-open-group">
                    <p className="optic-designer-open-group-title">
                      <strong>{group.displayName}</strong>
                      <span className="optic-form-key">{group.definitionKey}</span>
                    </p>
                    <ul className="optic-designer-open-list">
                      {group.releases.map((item) => {
                        const selected =
                          releasePickerMode === 'clone' && cloneSource === cloneSourceValue(item);
                        return (
                          <li key={`${item.definitionKey}:${item.version}`}>
                            <button
                              type="button"
                              className="optic-designer-open-choice"
                              data-selected={selected ? 'true' : undefined}
                              onClick={() =>
                                releasePickerMode === 'clone'
                                  ? pickCloneSource(item)
                                  : void openCatalogRelease(item)
                              }
                            >
                              <span className="optic-designer-open-choice-copy">
                                <strong>
                                  {item.displayName} {item.version}
                                </strong>
                                <span>
                                  {item.definitionKey} · {entityTypeOptionLabel(entityTypeForCatalogItem(item))}
                                </span>
                              </span>
                              <span className="optic-designer-open-choice-meta">
                                <StatusPill>{item.lifecycleStatus}</StatusPill>
                                {item.active ? <StatusPill>Live</StatusPill> : null}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
      {!release ? (
        <p className="optic-designer-empty-hint" role="status">
          Open a definition or create a draft above, then author Form → Workflow → Catalog before Try and
          Lifecycle.
        </p>
      ) : null}
      <nav className="optic-designer-nav" aria-label="Designer">
        <div className="optic-designer-nav-groups">
          <DesignerNavGroup label="Build" hint="Author the release">
            <DesignerNavButton
              icon="form"
              pressed={tab === 'form'}
              dirty={formDirty}
              onClick={() => setTab('form')}
            >
              Form
            </DesignerNavButton>
            <DesignerNavButton
              icon="designer"
              pressed={tab === 'workflow'}
              dirty={workflowDirty}
              onClick={() => setTab('workflow')}
            >
              Workflow
            </DesignerNavButton>
            <DesignerNavButton
              icon="inbox"
              pressed={tab === 'catalog'}
              dirty={catalogDirty}
              onClick={() => setTab('catalog')}
            >
              Catalog
            </DesignerNavButton>
            <DesignerNavButton icon="draft" pressed={tab === 'schema'} onClick={() => setTab('schema')}>
              Schema
            </DesignerNavButton>
          </DesignerNavGroup>
          {tryTabEnabled || simulateTabEnabled ? (
            <DesignerNavGroup label="Rehearse" hint="Try before promote">
              {tryTabEnabled ? (
                <DesignerNavButton icon="live" pressed={tab === 'try'} onClick={() => setTab('try')}>
                  Try
                </DesignerNavButton>
              ) : null}
              {simulateTabEnabled ? (
                <DesignerNavButton icon="generate" pressed={tab === 'simulate'} onClick={() => setTab('simulate')}>
                  Simulate
                </DesignerNavButton>
              ) : null}
            </DesignerNavGroup>
          ) : null}
          {lifecycleTabEnabled || diffTabEnabled ? (
            <DesignerNavGroup label="Release" hint="Validate and promote">
              {lifecycleTabEnabled ? (
                <DesignerNavButton icon="clock" pressed={tab === 'lifecycle'} onClick={() => setTab('lifecycle')}>
                  Lifecycle
                </DesignerNavButton>
              ) : null}
              {diffTabEnabled ? (
                <DesignerNavButton icon="diff" pressed={tab === 'diff'} onClick={() => setTab('diff')}>
                  Diff
                </DesignerNavButton>
              ) : null}
            </DesignerNavGroup>
          ) : null}
        </div>
        <button
          type="button"
          className="optic-guide-button optic-designer-nav-help"
          onClick={() => setGuideOpen(true)}
        >
          <ButtonLabel icon="help">User guide</ButtonLabel>
        </button>
      </nav>

      <div className="optic-designer-stage" data-tab={tab}>
      {guideOpen ? (
        <UserGuideDialog
          title="Designer user guide"
          source={DESIGNER_USER_GUIDE}
          onClose={() => setGuideOpen(false)}
        />
      ) : null}

      {tab === 'form' ? (
        <FormDesigner
          form={form}
          definitionKey={definitionKey}
          releaseForms={forms}
          savedForm={release?.forms?.[form.formKey]}
          entityType={entityType}
          readOnly={readOnly}
          errorSummary={errorSummary}
          onChange={changeForm}
          onSave={(saved) =>
            run(async () => {
              const withSchema = { ...saved, schema: schemaFromForm(saved) };
              let next = await saveFormDraft(definitionKey, version, rowVersion, withSchema);
              const releaseSchema = releaseSchemaFromForms(
                { ...forms, [withSchema.formKey]: withSchema },
                release?.schema
              );
              if (releaseSchema) {
                next = await saveSchemaDraft(definitionKey, version, next.rowVersion, releaseSchema);
              }
              applyRelease(next, withSchema.formKey);
            })
          }
        />
      ) : null}
      {tab === 'schema' ? (
        <ReleaseSchemaPanel
          forms={forms}
          savedSchema={release?.schema}
          errorSummary={errorSummary}
          onEditForm={() => setTab('form')}
        />
      ) : null}
      {tab === 'workflow' ? (
        <WorkflowDesigner
          workflow={workflow}
          catalog={catalog}
          forms={forms}
          scheduledActions={scheduledActions}
          readOnly={readOnly}
          errorSummary={errorSummary}
          dirty={workflowDirty}
          onChange={setWorkflow}
          onScheduledActionsChange={setScheduledActions}
          onDetachTransitionSet={(removedKey, replacementKey) => {
            setActions((current) => retargetActionTransitionSet(current, removedKey, replacementKey));
          }}
          onSave={() =>
            run(async () => {
              let next = await saveWorkflowDraft(definitionKey, version, rowVersion, workflow);
              for (const action of Object.values(actions)) {
                const saved = release?.actions?.[action.actionKey];
                if (saved && saved.transitionSetKey !== action.transitionSetKey) {
                  next = await saveActionDraft(definitionKey, version, next.rowVersion, action);
                }
              }
              for (const scheduled of Object.values(scheduledActions)) {
                const saved = release?.scheduledActions?.[scheduled.scheduledActionKey];
                if (!saved || JSON.stringify(saved) !== JSON.stringify(scheduled)) {
                  next = await saveScheduledActionDraft(definitionKey, version, next.rowVersion, scheduled);
                }
              }
              applyRelease(next, formKey);
            })
          }
        />
      ) : null}
      {tab === 'catalog' ? (
        <CatalogDesigner
          actions={actions}
          queues={queues}
          slas={slas}
          search={search}
          bulkActions={bulkActions}
          scheduledActions={scheduledActions}
          enabledKinds={catalogEnabledKinds}
          forms={forms}
          workflow={workflow}
          stageKeys={stageKeys}
          transitionSetKeys={transitionSetKeys}
          defaultEntityType={entityType}
          readOnly={readOnly}
          errorSummary={errorSummary}
          savedActions={release?.actions}
          savedQueues={release?.queues}
          savedSlas={release?.slas}
          savedSearch={release?.search}
          savedBulkActions={release?.bulkActions}
          savedScheduledActions={release?.scheduledActions}
          onActionsChange={setActions}
          onQueuesChange={setQueues}
          onSlasChange={setSlas}
          onSearchChange={setSearch}
          onBulkActionsChange={setBulkActions}
          onScheduledActionsChange={setScheduledActions}
          onSaveAction={(action) =>
            run(async () => {
              applyRelease(await saveActionDraft(definitionKey, version, rowVersion, action), formKey);
            })
          }
          onSaveQueue={(queue) =>
            run(async () => {
              applyRelease(await saveQueueDraft(definitionKey, version, rowVersion, queue), formKey);
            })
          }
          onSaveSla={(sla) =>
            run(async () => {
              applyRelease(await saveSlaDraft(definitionKey, version, rowVersion, sla), formKey);
            })
          }
          onSaveSearch={(nextSearch, nextQueues) =>
            run(async () => {
              let release = await saveSearchDraft(definitionKey, version, rowVersion, nextSearch);
              applyRelease(release, formKey);
              for (const queue of Object.values(nextQueues)) {
                const savedFields = release.queues?.[queue.queueKey]?.projectedFields ?? [];
                const nextFields = queue.projectedFields ?? [];
                if (JSON.stringify(savedFields) === JSON.stringify(nextFields)) {
                  continue;
                }
                release = await saveQueueDraft(definitionKey, version, release.rowVersion, queue);
                applyRelease(release, formKey);
              }
            })
          }
          onSaveBulkAction={(bulk) =>
            run(async () => {
              applyRelease(await saveBulkActionDraft(definitionKey, version, rowVersion, bulk), formKey);
            })
          }
          onSaveScheduledAction={(scheduled) =>
            run(async () => {
              applyRelease(await saveScheduledActionDraft(definitionKey, version, rowVersion, scheduled), formKey);
            })
          }
          onDeleteAction={(actionKey) =>
            run(async () => {
              const referenced = workflow.stages.some((stage) => stage.actionKeys?.includes(actionKey));
              if (release?.actions?.[actionKey]) {
                applyRelease(await deleteActionDraft(definitionKey, version, rowVersion, actionKey), formKey);
              } else {
                setActions((current) => {
                  const next = { ...current };
                  delete next[actionKey];
                  return next;
                });
              }
              setStatus(
                referenced
                  ? `${actionKey} was deleted. Clear it from any stages that still list it before you validate.`
                  : `${actionKey} was deleted.`
              );
            })
          }
          onDeleteQueue={(queueKey) =>
            run(async () => {
              const referenced = workflow.stages.some((stage) => stage.queueKey === queueKey);
              if (release?.queues?.[queueKey]) {
                applyRelease(await deleteQueueDraft(definitionKey, version, rowVersion, queueKey), formKey);
              } else {
                setQueues((current) => {
                  const next = { ...current };
                  delete next[queueKey];
                  return next;
                });
              }
              setStatus(
                referenced
                  ? `${queueKey} was deleted. Clear it from any stages that still point at it before you validate.`
                  : `${queueKey} was deleted.`
              );
            })
          }
          onDeleteSla={(slaKey) =>
            run(async () => {
              const referenced = workflow.stages.some((stage) => stage.slaKey === slaKey);
              if (release?.slas?.[slaKey]) {
                applyRelease(await deleteSlaDraft(definitionKey, version, rowVersion, slaKey), formKey);
              } else {
                setSlas((current) => {
                  const next = { ...current };
                  delete next[slaKey];
                  return next;
                });
              }
              setStatus(
                referenced
                  ? `${slaKey} was deleted. Clear it from any stages that still point at it before you validate.`
                  : `${slaKey} was deleted.`
              );
            })
          }
          onDeleteBulkAction={(bulkActionKey) =>
            run(async () => {
              if (release?.bulkActions?.[bulkActionKey]) {
                applyRelease(
                  await deleteBulkActionDraft(definitionKey, version, rowVersion, bulkActionKey),
                  formKey
                );
              } else {
                setBulkActions((current) => {
                  const next = { ...current };
                  delete next[bulkActionKey];
                  return next;
                });
              }
              setStatus(`${bulkActionKey} was deleted.`);
            })
          }
          onDeleteScheduledAction={(scheduledActionKey) =>
            run(async () => {
              if (release?.scheduledActions?.[scheduledActionKey]) {
                applyRelease(
                  await deleteScheduledActionDraft(definitionKey, version, rowVersion, scheduledActionKey),
                  formKey
                );
              } else {
                setScheduledActions((current) => {
                  const next = { ...current };
                  delete next[scheduledActionKey];
                  return next;
                });
              }
              setStatus(`${scheduledActionKey} was deleted.`);
            })
          }
        />
      ) : null}
      {tab === 'try' ? (
        <TryAsOfficerPanel
          definitionKey={definitionKey}
          version={version}
          entityType={entityType}
          workflow={release?.workflow ?? workflow}
          queues={release?.queues && Object.keys(release.queues).length > 0 ? release.queues : queues}
          forms={release?.forms && Object.keys(release.forms).length > 0 ? release.forms : forms}
          actions={release?.actions}
          slas={release?.slas && Object.keys(release.slas).length > 0 ? release.slas : slas}
          enabled={Boolean(release)}
          errorSummary={errorSummary}
          onError={setErrorSummary}
        />
      ) : null}
      {tab === 'lifecycle' ? (
        <LifecyclePanel
          definitionKey={definitionKey}
          version={version}
          rowVersion={rowVersion}
          lifecycleStatus={lifecycleStatus}
          active={Boolean(release?.active)}
          enabled={Boolean(release)}
          errorSummary={errorSummary}
          onApplied={(next, message) => {
            setDefinitionKey(next.definitionKey);
            setVersion(next.version);
            setDisplayName(next.displayName);
            applyRelease(next);
            if (message) {
              setStatus(message);
            }
          }}
          onStatus={setStatus}
          onError={setErrorSummary}
        />
      ) : null}
      {tab === 'simulate' ? (
        <SimulatePanel
          key={`${definitionKey}@${version}`}
          definitionKey={definitionKey}
          version={version}
          workflow={workflow}
          savedWorkflow={release?.workflow}
          catalog={catalog}
          errorSummary={errorSummary}
          onError={setErrorSummary}
        />
      ) : null}
      {tab === 'diff' ? (
        <DiffPanel
          definitionKey={definitionKey}
          version={version}
          errorSummary={errorSummary}
          onError={setErrorSummary}
        />
      ) : null}
      </div>
    </div>
  );
}

function ReleaseSchemaPanel({
  forms,
  savedSchema,
  errorSummary,
  onEditForm
}: {
  forms: Record<string, StageFormDefinition>;
  savedSchema?: JsonSchema;
  errorSummary?: DisplayError;
  onEditForm?: () => void;
}) {
  const merged = useMemo(() => releaseSchemaFromForms(forms, savedSchema), [forms, savedSchema]);
  const text = merged ? JSON.stringify(merged, null, 2) : '';
  const contributors = listFormsInWorkflowOrder(forms);

  return (
    <section className="optic-designer" aria-labelledby="release-schema-heading">
      <header className="optic-designer-header">
        <div>
          <h1 id="release-schema-heading">Release schema</h1>
          <p className="optic-help">
            Read-only merge of each form&apos;s schema at its dataPath. Edit fields on Form → Form schema, then Save
            draft.
          </p>
        </div>
        {onEditForm ? (
          <div className="optic-designer-header-tools">
            <button type="button" className="optic-button-primary" onClick={onEditForm}>
              <ButtonLabel icon="form">Edit on Form</ButtonLabel>
            </button>
          </div>
        ) : null}
      </header>
      <CaughtErrorBanner error={errorSummary} />
      <ul className="optic-release-schema-forms">
        {contributors.map((item) => (
          <li key={item.formKey}>
            <div>
              <strong>{item.formKey}</strong>
              <span>{item.dataPath || '$'}</span>
            </div>
            <StatusPill>{item.schema ? 'Has form schema' : 'No form schema yet'}</StatusPill>
          </li>
        ))}
      </ul>
      {text ? (
        <label className="optic-designer-json">
          Merged JSON Schema
          <textarea spellCheck={false} readOnly value={text} />
        </label>
      ) : (
        <div className="optic-designer-empty" role="status">
          <p>
            <strong>No merged schema yet</strong>
          </p>
          <p className="optic-help">Open Form, choose Form schema, Generate schema, then Save draft.</p>
          {onEditForm ? (
            <button type="button" className="optic-button-primary" onClick={onEditForm}>
              <ButtonLabel icon="form">Edit on Form</ButtonLabel>
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function LifecyclePanel({
  definitionKey,
  version,
  rowVersion,
  lifecycleStatus,
  active,
  enabled,
  errorSummary,
  onApplied,
  onStatus,
  onError
}: {
  definitionKey: string;
  version: string;
  rowVersion: number;
  lifecycleStatus: string;
  active: boolean;
  enabled: boolean;
  errorSummary?: DisplayError;
  onApplied: (next: DesignerRelease, message?: string) => void;
  onStatus: (message: string) => void;
  onError: (message: DisplayError | undefined) => void;
}) {
  const [actorId, setActorId] = useState('author@example.gov');
  const [comment, setComment] = useState('');
  const [validation, setValidation] = useState<ValidateReleaseResult | undefined>();
  const [importMode, setImportMode] = useState<'DRAFT' | 'PUBLISHED'>('DRAFT');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const operations = lifecycleOperations(lifecycleStatus);

  async function runLifecycle(operation: Parameters<typeof mutateLifecycle>[2]) {
    try {
      onError(undefined);
      const next = await mutateLifecycle(definitionKey, version, operation, rowVersion, actorId, comment);
      onApplied(
        next,
        operation === 'activate'
          ? `${definitionKey} ${version} is now the Live pointer. Status stays PUBLISHED.`
          : operation === 'deactivate'
            ? `${definitionKey} ${version} is no longer the Live pointer. Status stays PUBLISHED.`
            : undefined
      );
    } catch (error: unknown) {
      onError(caughtDesignerError(error));
    }
  }

  async function downloadPackage() {
    try {
      onError(undefined);
      const exported = await exportReleasePackage(definitionKey, version);
      const blob = new Blob(
        [
          JSON.stringify(
            {
              package: exported.package,
              checksum: exported.checksum,
              checksumAlgorithm: exported.checksumAlgorithm ?? 'SHA-256',
              files: exported.files
            },
            null,
            2
          )
        ],
        { type: 'application/json' }
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${definitionKey}-${version}.optic-package.json`;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      onStatus(`Downloaded ${definitionKey} ${version} package${exported.checksum ? ` (${exported.checksum.slice(0, 12)}…)` : ''}.`);
    } catch (error: unknown) {
      onError(caughtDesignerError(error));
    }
  }

  function chooseImportFile(file: File | undefined) {
    setImportFile(file ?? null);
    onError(undefined);
  }

  function clearImportFile() {
    setImportFile(null);
    if (importFileRef.current) {
      importFileRef.current.value = '';
    }
  }

  async function runImportPackage() {
    if (!importFile || importBusy) {
      return;
    }
    setImportBusy(true);
    try {
      onError(undefined);
      const text = await readFileText(importFile);
      const raw = JSON.parse(text) as {
        package?: Record<string, unknown>;
        checksum?: string;
        checksumAlgorithm?: string;
      };
      if (!raw.package || typeof raw.package !== 'object' || !raw.checksum) {
        onError('Package file must include package and checksum (from Download package or GET …/export).');
        return;
      }
      const metadata = (raw.package.metadata ?? {}) as { definitionKey?: string; version?: string };
      const targetKey =
        typeof metadata.definitionKey === 'string' && metadata.definitionKey
          ? metadata.definitionKey
          : definitionKey;
      const next = await importReleasePackage(
        targetKey,
        {
          package: raw.package,
          checksum: raw.checksum,
          checksumAlgorithm: raw.checksumAlgorithm === 'SHA-256' ? 'SHA-256' : undefined,
          mode: importMode
        },
        actorId
      );
      clearImportFile();
      onApplied(
        next,
        importMode === 'PUBLISHED'
          ? `Imported ${next.definitionKey} ${next.version} as PUBLISHED (not Live). Activate when ready.`
          : `Imported ${next.definitionKey} ${next.version} as DRAFT.`
      );
    } catch (error: unknown) {
      onError(caughtDesignerError(error));
    } finally {
      setImportBusy(false);
    }
  }

  const phaseGroupLabel =
    lifecycleStatus === 'DRAFT'
      ? 'Submit'
      : lifecycleStatus === 'IN_REVIEW' || lifecycleStatus === 'REJECTED'
        ? 'Review'
        : lifecycleStatus === 'APPROVED'
          ? 'Publish'
          : 'Live pointer';

  return (
    <section className="optic-designer" aria-labelledby="lifecycle-heading">
      <header className="optic-designer-header">
        <div>
          <h1 id="lifecycle-heading">Release lifecycle</h1>
          <p className="optic-help">
            Promote the opened release from draft to Live. Path is Validate → Submit → Approve → Publish → Activate.
            Change Actor id between submit, approve, and publish (separation of duties).
          </p>
        </div>
      </header>
      <CaughtErrorBanner error={errorSummary} />

      <section className="optic-lifecycle-panel" aria-labelledby="lifecycle-status-heading">
        <header className="optic-lifecycle-package-header">
          <h2 id="lifecycle-status-heading">This release</h2>
          <p className="optic-help">
            Status and Live pointer for the opened version. Actor id is sent with each lifecycle call; Comment is kept
            when you reject.
          </p>
        </header>
        <div className="optic-lifecycle-status-row">
          <p className="optic-status optic-lifecycle-status">
            <span className="optic-catalog-field-label">Status</span>
            <StatusPill>{lifecycleStatus || '—'}</StatusPill>
            {active ? <StatusPill>Live</StatusPill> : lifecycleStatus === 'PUBLISHED' ? <StatusPill>Not Live</StatusPill> : null}
            <span className="optic-lifecycle-meta">rowVersion {rowVersion}</span>
          </p>
          <div className="optic-lifecycle-package-fields optic-lifecycle-actor-fields">
            <label className="optic-catalog-field">
              <span className="optic-catalog-field-label">Actor id</span>
              <input
                value={actorId}
                onChange={(event) => setActorId(event.target.value)}
                placeholder="author@example.gov"
              />
            </label>
            <label className="optic-catalog-field">
              <span className="optic-catalog-field-label">Comment</span>
              <input
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Optional — stored on reject"
              />
            </label>
          </div>
        </div>
      </section>

      <section className="optic-lifecycle-panel" aria-labelledby="lifecycle-actions-heading">
        <header className="optic-lifecycle-package-header">
          <h2 id="lifecycle-actions-heading">Promote &amp; Live</h2>
          <p className="optic-help">{lifecyclePhaseHelp(lifecycleStatus, active)}</p>
        </header>
        <div className="optic-lifecycle-package-grid">
          <div className="optic-lifecycle-package-card">
            <h3>Validate</h3>
            <p className="optic-catalog-hint">
              Check forms, queues, transitions, and projections before you promote. Safe to run anytime; fix every error
              before Submit or Publish.
            </p>
            <div className="optic-lifecycle-actions" role="group" aria-label="Validate">
              <button
                type="button"
                disabled={!enabled}
                onClick={async () => {
                  try {
                    onError(undefined);
                    const result = await validateRelease(definitionKey, version);
                    setValidation(result);
                    onStatus(
                      result.valid
                        ? `Validation successful — ${definitionKey} ${version} passed publish checks (${result.projections.length} projections).`
                        : `Validation failed — ${definitionKey} ${version} is not valid.`
                    );
                  } catch (error: unknown) {
                    setValidation(undefined);
                    onError(caughtDesignerError(error));
                  }
                }}
              >
                <ButtonLabel icon="check">Validate</ButtonLabel>
              </button>
            </div>
            {validation?.valid ? (
              <p className="optic-lifecycle-validate-ok" role="status" aria-live="polite">
                Validation successful. This release passed publishability checks
                {validation.projections.length > 0
                  ? ` (${validation.projections.length} field projection${validation.projections.length === 1 ? '' : 's'} listed below).`
                  : ' (platform default projections only).'}
              </p>
            ) : null}
          </div>

          <div className="optic-lifecycle-package-card">
            <h3>{phaseGroupLabel}</h3>
            <p className="optic-catalog-hint">{lifecycleActionHint(lifecycleStatus, active)}</p>
            {operations.length > 0 ? (
              <div className="optic-lifecycle-actions" role="group" aria-label={phaseGroupLabel}>
                {operations.map((item) => (
                  <button
                    key={item.operation}
                    type="button"
                    className={
                      item.operation === 'submit' || item.operation === 'publish' || item.operation === 'activate'
                        ? 'optic-button-primary'
                        : item.operation === 'reject' || item.operation === 'retire'
                          ? 'optic-button-secondary'
                          : undefined
                    }
                    disabled={
                      !enabled ||
                      (item.operation === 'activate' && active) ||
                      (item.operation === 'deactivate' && !active)
                    }
                    onClick={() => runLifecycle(item.operation)}
                  >
                    <ButtonLabel icon={item.icon}>{item.label}</ButtonLabel>
                  </button>
                ))}
              </div>
            ) : (
              <p className="optic-catalog-hint">No lifecycle actions for this status.</p>
            )}
          </div>
        </div>
      </section>

      <section className="optic-lifecycle-package" aria-labelledby="lifecycle-package-heading">
        <header className="optic-lifecycle-package-header">
          <h2 id="lifecycle-package-heading">Package transfer</h2>
          <p className="optic-help">
            Move a checksummed release between environments. Export from here (or GET …/export), then import in the
            target environment. Import never auto-activates Live.
          </p>
        </header>

        <div className="optic-lifecycle-package-grid">
          <div className="optic-lifecycle-package-card">
            <h3>Export</h3>
            <p className="optic-catalog-hint">
              Download the opened release as a JSON package with SHA-256 checksum. Open a release first; the file name
              is {'{definitionKey}-{version}.optic-package.json'}.
            </p>
            <div className="optic-lifecycle-actions">
              <button type="button" disabled={!enabled} onClick={() => downloadPackage()}>
                <ButtonLabel icon="save">Download package</ButtonLabel>
              </button>
            </div>
          </div>

          <div className="optic-lifecycle-package-card">
            <h3>Import</h3>
            <p className="optic-catalog-hint">
              Install a downloaded package into this environment. Uses the definition key inside the package (creates
              the definition if missing). Fails if that version already exists or the checksum does not match.
            </p>
            <div className="optic-lifecycle-package-fields">
              <label className="optic-catalog-field">
                <span className="optic-catalog-field-label">Import as</span>
                <select
                  value={importMode}
                  onChange={(event) => setImportMode(event.target.value as 'DRAFT' | 'PUBLISHED')}
                >
                  <option value="DRAFT">DRAFT — editable, run submit → approve → publish</option>
                  <option value="PUBLISHED">PUBLISHED — frozen, not Live until you Activate</option>
                </select>
              </label>
              <p className="optic-catalog-hint">
                {importMode === 'PUBLISHED'
                  ? 'Trusted packages can land as PUBLISHED to skip authoring. Activate afterward when this environment should go Live.'
                  : 'Default for lower environments. After import, edit if needed, then validate and promote through Lifecycle.'}
              </p>
            </div>
            <input
              ref={importFileRef}
              type="file"
              accept="application/json,.json"
              aria-label="Choose package file"
              className="optic-lifecycle-package-file"
              onChange={(event) => {
                chooseImportFile(event.target.files?.[0]);
              }}
            />
            {importFile ? (
              <p className="optic-help optic-lifecycle-package-chosen" role="status">
                Selected: <strong>{importFile.name}</strong>
              </p>
            ) : (
              <p className="optic-help optic-lifecycle-package-chosen">No package file selected yet.</p>
            )}
            <div className="optic-lifecycle-actions">
              <button type="button" disabled={importBusy} onClick={() => importFileRef.current?.click()}>
                <ButtonLabel icon="folder">
                  {importFile ? 'Choose a different file' : 'Choose package file'}
                </ButtonLabel>
              </button>
              <button
                type="button"
                className="optic-button-primary"
                disabled={!importFile || importBusy}
                onClick={() => void runImportPackage()}
              >
                <ButtonLabel icon="save">{importBusy ? 'Importing…' : 'Import package'}</ButtonLabel>
              </button>
              {importFile ? (
                <button type="button" disabled={importBusy} onClick={() => clearImportFile()}>
                  Clear
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>
      {!enabled ? (
        <p className="optic-help">
          Open or create a draft before Validate / Submit / Activate. Package import still works from a file without an
          open release.
        </p>
      ) : null}
      {validation?.valid ? (
        <div className="optic-bulk-result optic-lifecycle-validate-result" role="status" aria-live="polite">
          <h2>Validation successful</h2>
          <p>
            {definitionKey} {version} is ready to promote. Review projections below, then use the next lifecycle action
            for this status.
          </p>
          <h3>Projections</h3>
          {validation.projections.length === 0 ? (
            <p>No extra projections beyond the platform defaults.</p>
          ) : (
            <ul>
              {validation.projections.map((item) => (
                <li key={`${item.key}-${item.sqlColumn}`}>
                  {item.field} → {item.sqlColumn} ({item.source}; {item.usedBy.join(', ') || 'unused'})
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

function lifecyclePhaseHelp(status: string, active: boolean): string {
  if (!status) {
    return 'Open or create a release to see the next promote step for its status.';
  }
  if (status === 'DRAFT') {
    return 'This version is editable. Validate, then Submit for review with the author Actor id.';
  }
  if (status === 'IN_REVIEW') {
    return 'Waiting on a different reviewer Actor id. Approve to continue, or Reject / Return to draft.';
  }
  if (status === 'REJECTED') {
    return 'Rejected in review. Return to draft to edit, then Submit again.';
  }
  if (status === 'APPROVED') {
    return 'Ready to freeze. Publish with a publisher Actor id (not the approver). Publish does not make Live.';
  }
  if (status === 'PUBLISHED') {
    return active
      ? 'This PUBLISHED version is the Live pointer for new cases. Deactivate to clear Live, or Retire only after another version is Live.'
      : 'Published and frozen. Activate to point Workspace Live at this version. Status stays PUBLISHED.';
  }
  if (status === 'RETIRED') {
    return 'Retired — no further promote actions. Open another version to continue.';
  }
  return 'Use the actions for the current status. Illegal transitions are rejected by the API.';
}

function lifecycleActionHint(status: string, active: boolean): string {
  if (status === 'DRAFT') {
    return 'Sends this draft to IN_REVIEW. Use a different Actor id later for Approve and Publish.';
  }
  if (status === 'IN_REVIEW') {
    return 'Approve advances to APPROVED. Reject stores your Comment. Return to draft unlocks editing again.';
  }
  if (status === 'REJECTED') {
    return 'Return to draft so authors can fix issues and Submit again.';
  }
  if (status === 'APPROVED') {
    return 'Locks this version (checksum + snapshot). In-flight cases stay on their pinned release; new Live traffic still needs Activate.';
  }
  if (status === 'PUBLISHED') {
    if (active) {
      return 'Deactivate clears the Live pointer without retiring. Retire is blocked while this version is Live.';
    }
    return 'Activate makes new intakes use this version. Deactivate only applies when Live. Retire removes a non-Live published snapshot.';
  }
  return 'No promote actions are available for this status.';
}

function lifecycleOperations(status: string): Array<{
  operation: Parameters<typeof mutateLifecycle>[2];
  label: string;
  icon: IconName;
}> {
  if (status === 'DRAFT') {
    return [{ operation: 'submit', label: 'Submit', icon: 'save' }];
  }
  if (status === 'IN_REVIEW') {
    return [
      { operation: 'approve', label: 'Approve', icon: 'check' },
      { operation: 'reject', label: 'Reject', icon: 'alert' },
      { operation: 'return-to-draft', label: 'Return to draft', icon: 'draft' }
    ];
  }
  if (status === 'REJECTED') {
    return [{ operation: 'return-to-draft', label: 'Return to draft', icon: 'draft' }];
  }
  if (status === 'APPROVED') {
    return [{ operation: 'publish', label: 'Publish', icon: 'live' }];
  }
  if (status === 'PUBLISHED') {
    return [
      { operation: 'activate', label: 'Activate', icon: 'check' },
      { operation: 'deactivate', label: 'Deactivate', icon: 'release' },
      { operation: 'retire', label: 'Retire', icon: 'inbox' }
    ];
  }
  return [];
}

function SimulatePanel({
  definitionKey,
  version,
  workflow,
  savedWorkflow,
  catalog,
  errorSummary,
  onError
}: {
  definitionKey: string;
  version: string;
  workflow: WorkflowDefinition;
  savedWorkflow?: WorkflowDefinition;
  catalog: WorkflowCatalog;
  errorSummary?: DisplayError;
  onError: (message: DisplayError | undefined) => void;
}) {
  const transitionSets = workflow.transitionSets;
  const savedKeys = new Set((savedWorkflow?.transitionSets ?? []).map((set) => set.transitionSetKey));
  const unsavedKeys = transitionSets.filter((set) => savedWorkflow && !savedKeys.has(set.transitionSetKey));
  const [transitionSetKey, setTransitionSetKey] = useState(transitionSets[0]?.transitionSetKey ?? '');
  const [businessData, setBusinessData] = useState('{\n  \n}');
  const [workflowContext, setWorkflowContext] = useState('{\n  \n}');
  const [result, setResult] = useState<SimulateTransitionResult | undefined>();

  useEffect(() => {
    if (transitionSets.some((set) => set.transitionSetKey === transitionSetKey)) {
      return;
    }
    setTransitionSetKey(transitionSets[0]?.transitionSetKey ?? '');
  }, [transitionSetKey, transitionSets]);

  return (
    <section className="optic-designer" aria-labelledby="simulate-heading">
      <header className="optic-designer-header">
        <div>
          <h1 id="simulate-heading">Transition simulation</h1>
          <p className="optic-help">
            Pick the same Complete path you see on Workflow as <strong>From {'{stage}'}</strong>. Run compiles the last
            saved draft. Save Workflow first if the list is empty or a set is marked unsaved.
          </p>
        </div>
      </header>
      <CaughtErrorBanner error={errorSummary} />
      {transitionSets.length === 0 ? (
        <p className="optic-help">
          No transition sets on this canvas. On Workflow, select a non-terminal stage, add outbound transitions, then
          Save draft.
        </p>
      ) : null}
      {unsavedKeys.length > 0 ? (
        <p className="optic-help">
          Not saved yet: {unsavedKeys.map((set) => set.transitionSetKey).join(', ')}. Run will fail until you Save draft
          on Workflow.
        </p>
      ) : null}
      <div className="optic-designer-toolbar">
        <label>
          Transition set
          <select value={transitionSetKey} onChange={(event) => setTransitionSetKey(event.target.value)}>
            {transitionSets.length === 0 ? <option value="">None</option> : null}
            {transitionSets.map((set) => (
              <option key={set.transitionSetKey} value={set.transitionSetKey}>
                {describeTransitionSet(workflow, catalog, set.transitionSetKey)}
                {savedWorkflow && !savedKeys.has(set.transitionSetKey) ? ' (unsaved)' : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="optic-button-primary"
          disabled={!transitionSetKey}
          onClick={async () => {
            try {
              onError(undefined);
              const parsedBusiness = parseJsonObject(businessData, 'Business data');
              const parsedContext = parseJsonObject(workflowContext, 'Workflow context');
              setResult(
                await simulateTransition(definitionKey, version, {
                  transitionSetKey,
                  businessData: parsedBusiness,
                  workflowContext: parsedContext
                })
              );
            } catch (error: unknown) {
              setResult(undefined);
              onError(caughtDesignerError(error));
            }
          }}
        >
          Run simulation
        </button>
      </div>
      <label className="optic-designer-json">
        Business data JSON
        <textarea spellCheck={false} value={businessData} onChange={(event) => setBusinessData(event.target.value)} />
      </label>
      <label className="optic-designer-json">
        Workflow context JSON
        <textarea spellCheck={false} value={workflowContext} onChange={(event) => setWorkflowContext(event.target.value)} />
      </label>
      {result ? (
        <div className="optic-designer-simulation">
          <h2>Result</h2>
          <p>
            Complete would go to <strong>{result.targetStageKey}</strong>
            {result.matchedRuleKey
              ? ` because rule ${result.matchedRuleKey} matched.`
              : result.usedDefault
                ? ' using the default target (no extra rule matched).'
                : '.'}
          </p>
          {result.trace.length === 0 ? (
            <p>This set has no extra rules, so the trace is empty.</p>
          ) : (
            <ol>
              {result.trace.map((entry, index) => (
                <li key={`${entry.ruleKey ?? 'step'}-${index}`}>
                  {entry.ruleKey ?? entry.path ?? 'step'}: {entry.result}
                  {entry.message ? ` — ${entry.message}` : ''}
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </section>
  );
}

function DiffPanel({
  definitionKey,
  version,
  errorSummary,
  onError
}: {
  definitionKey: string;
  version: string;
  errorSummary?: DisplayError;
  onError: (message: DisplayError | undefined) => void;
}) {
  const [versions, setVersions] = useState<ReleaseCatalogItem[]>([]);
  const [fromVersion, setFromVersion] = useState(version);
  const [toVersion, setToVersion] = useState(version);
  const [diff, setDiff] = useState<SemanticDiffResult | undefined>();
  const [busy, setBusy] = useState(false);
  const [compared, setCompared] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const catalog = await listReleaseCatalog();
        if (cancelled) {
          return;
        }
        const forDefinition = catalog
          .filter((item) => item.definitionKey === definitionKey)
          .sort((left, right) => left.version.localeCompare(right.version, undefined, { numeric: true }));
        setVersions(forDefinition);
        const opened = forDefinition.find((item) => item.version === version);
        const earlier = forDefinition.filter((item) => item.version !== version).at(-1);
        setToVersion(opened?.version ?? version);
        setFromVersion(earlier?.version ?? forDefinition[0]?.version ?? version);
      } catch {
        if (!cancelled) {
          setVersions([]);
          setFromVersion(version);
          setToVersion(version);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [definitionKey, version]);

  const groupedChanges = useMemo(() => groupDiffChanges(diff?.changes ?? []), [diff]);
  const canCompare = Boolean(definitionKey && fromVersion.trim() && toVersion.trim());

  async function runCompare() {
    if (!canCompare) {
      return;
    }
    try {
      onError(undefined);
      setBusy(true);
      setDiff(await diffReleases(definitionKey, fromVersion.trim(), toVersion.trim()));
      setCompared(true);
    } catch (error: unknown) {
      setDiff(undefined);
      setCompared(false);
      onError(caughtDesignerError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="optic-designer" aria-labelledby="diff-heading">
      <header className="optic-designer-header">
        <div>
          <h1 id="diff-heading">Compare versions</h1>
          <p className="optic-help">
            See what changed between two saved releases of this definition — stages, forms, fields, queues, actions, and
            more. Pick an older version on the left and a newer one on the right, then Compare.
          </p>
        </div>
      </header>
      <CaughtErrorBanner error={errorSummary} />

      <section className="optic-lifecycle-panel" aria-labelledby="diff-compare-heading">
        <header className="optic-lifecycle-package-header">
          <h2 id="diff-compare-heading">Choose versions</h2>
          <p className="optic-help">
            Only saved releases appear here (including drafts). Unsaved canvas edits are not included — Save draft
            first if you need those changes in the comparison.
          </p>
        </header>
        <div className="optic-lifecycle-package-grid optic-diff-picker">
          <div className="optic-lifecycle-package-card optic-diff-picker-field">
            <h3>From (baseline)</h3>
            <p className="optic-catalog-hint">Usually an older published or draft snapshot.</p>
            <label className="optic-catalog-field">
              <span className="optic-catalog-field-label">Version</span>
              <DiffVersionSelect
                value={fromVersion}
                versions={versions}
                fallbackVersion={version}
                onChange={(next) => {
                  setFromVersion(next);
                  setCompared(false);
                  setDiff(undefined);
                }}
              />
            </label>
          </div>
          <div className="optic-lifecycle-package-card optic-diff-picker-field">
            <h3>To (compare)</h3>
            <p className="optic-catalog-hint">Defaults to the release you currently have open.</p>
            <label className="optic-catalog-field">
              <span className="optic-catalog-field-label">Version</span>
              <DiffVersionSelect
                value={toVersion}
                versions={versions}
                fallbackVersion={version}
                onChange={(next) => {
                  setToVersion(next);
                  setCompared(false);
                  setDiff(undefined);
                }}
              />
            </label>
          </div>
        </div>
        <div className="optic-diff-actions">
          <div className="optic-lifecycle-actions">
            <button
              type="button"
              className="optic-button-secondary"
              aria-label="Swap from and to versions"
              disabled={!fromVersion || !toVersion || fromVersion === toVersion}
              onClick={() => {
                setFromVersion(toVersion);
                setToVersion(fromVersion);
                setCompared(false);
                setDiff(undefined);
              }}
            >
              <ButtonLabel icon="diff">Swap</ButtonLabel>
            </button>
            <button
              type="button"
              className="optic-button-primary"
              disabled={!canCompare || busy || fromVersion.trim() === toVersion.trim()}
              onClick={() => void runCompare()}
            >
              <ButtonLabel icon="search">{busy ? 'Comparing…' : 'Compare versions'}</ButtonLabel>
            </button>
          </div>
          {fromVersion.trim() && toVersion.trim() && fromVersion.trim() === toVersion.trim() ? (
            <p className="optic-catalog-hint">Pick two different versions to compare.</p>
          ) : null}
        </div>
      </section>

      {!compared && !diff ? (
        <div className="optic-designer-empty" role="status">
          <p>No comparison yet.</p>
          <p className="optic-help">Choose From and To above, then Compare versions to list semantic changes.</p>
        </div>
      ) : null}

      {diff ? (
        <section className="optic-diff-results" aria-labelledby="diff-results-heading">
          {diff.changes.length === 0 ? (
            <div className="optic-bulk-result" role="status" aria-live="polite">
              <h2 id="diff-results-heading">No semantic changes</h2>
              <p>
                {diff.fromVersion} and {diff.toVersion} match for workflow, forms, catalog, and schema. Packaging
                metadata alone may still differ.
              </p>
            </div>
          ) : (
            <>
              <header className="optic-lifecycle-package-header">
                <h2 id="diff-results-heading">
                  {diff.changes.length} change{diff.changes.length === 1 ? '' : 's'} from {diff.fromVersion} →{' '}
                  {diff.toVersion}
                </h2>
                <p className="optic-help">
                  Grouped by area. <strong>Added</strong> exists only in To, <strong>Removed</strong> only in From,{' '}
                  <strong>Changed</strong> in both but different.
                </p>
              </header>
              <div className="optic-diff-summary" aria-label="Change counts by type">
                <span className="optic-diff-chip optic-diff-chip-added">
                  {countDiffType(diff.changes, 'ADDED')} added
                </span>
                <span className="optic-diff-chip optic-diff-chip-removed">
                  {countDiffType(diff.changes, 'REMOVED')} removed
                </span>
                <span className="optic-diff-chip optic-diff-chip-changed">
                  {countDiffType(diff.changes, 'CHANGED')} changed
                </span>
              </div>
              <div className="optic-diff-groups">
                {groupedChanges.map((group) => (
                  <section key={group.category} className="optic-lifecycle-package-card optic-diff-group">
                    <h3>{diffCategoryLabel(group.category)}</h3>
                    <p className="optic-catalog-hint">{diffCategoryHint(group.category)}</p>
                    <ul className="optic-diff-change-list">
                      {group.changes.map((change, index) => (
                        <li key={`${change.category}-${change.key}-${change.change}-${index}`}>
                          <span className={`optic-diff-chip optic-diff-chip-${change.change.toLowerCase()}`}>
                            {change.change.toLowerCase()}
                          </span>
                          <div className="optic-diff-change-body">
                            <strong>{change.key}</strong>
                            {change.path && change.path !== change.key ? (
                              <span className="optic-form-key">{change.path}</span>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </>
          )}
        </section>
      ) : null}
    </section>
  );
}

function DiffVersionSelect({
  value,
  versions,
  fallbackVersion,
  onChange
}: {
  value: string;
  versions: ReleaseCatalogItem[];
  fallbackVersion: string;
  onChange: (version: string) => void;
}) {
  if (versions.length === 0) {
    return <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={fallbackVersion} />;
  }
  const options = versions.some((item) => item.version === value)
    ? versions
    : [{ definitionKey: '', displayName: value, version: value, lifecycleStatus: 'DRAFT' as const }, ...versions];
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((item) => (
        <option key={item.version} value={item.version}>
          {item.version}
          {item.lifecycleStatus ? ` · ${item.lifecycleStatus}` : ''}
          {item.active ? ' · Live' : ''}
        </option>
      ))}
    </select>
  );
}

function groupDiffChanges(changes: SemanticDiffResult['changes']): Array<{
  category: string;
  changes: SemanticDiffResult['changes'];
}> {
  const order: string[] = [];
  const byCategory = new Map<string, SemanticDiffResult['changes']>();
  for (const change of changes) {
    if (!byCategory.has(change.category)) {
      order.push(change.category);
      byCategory.set(change.category, []);
    }
    byCategory.get(change.category)!.push(change);
  }
  return order.map((category) => ({ category, changes: byCategory.get(category)! }));
}

function countDiffType(changes: SemanticDiffResult['changes'], type: string): number {
  return changes.filter((change) => change.change === type).length;
}

function diffCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    metadata: 'Metadata',
    schema: 'JSON Schema',
    validations: 'Required fields',
    stages: 'Stages',
    transitions: 'Transitions',
    forms: 'Forms',
    fields: 'Form fields',
    actions: 'Actions',
    queues: 'Queues',
    bulkActions: 'Bulk actions',
    scheduledActions: 'Scheduled actions',
    slas: 'SLAs',
    search: 'Search'
  };
  return labels[category] ?? category;
}

function diffCategoryHint(category: string): string {
  const hints: Record<string, string> = {
    metadata: 'Display name or entity type.',
    schema: 'Business data schema shape.',
    validations: 'Schema required lists.',
    stages: 'Workflow stages and their settings.',
    transitions: 'Transition sets and initial stage.',
    forms: 'Whole form definitions.',
    fields: 'Individual fields on forms.',
    actions: 'Catalog actions (Complete, Save, …).',
    queues: 'Officer worklists and eligibility.',
    bulkActions: 'Bulk toolbar actions.',
    scheduledActions: 'Timers and hold expirations.',
    slas: 'Stage clocks.',
    search: 'Find-a-case search metadata.'
  };
  return hints[category] ?? 'Semantic differences in this area.';
}

function seedFormSchemas(
  forms: Record<string, StageFormDefinition> | undefined,
  schema?: JsonSchema
): Record<string, StageFormDefinition> {
  if (!forms) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(forms).map(([key, form]) => {
      const next =
        form.schema || !schema
          ? form
          : (() => {
              const slice = schemaAtDataPath(schema, form.dataPath);
              return slice ? { ...form, schema: slice } : form;
            })();
      return [key, { ...next, schema: schemaFromForm(next) }];
    })
  );
}

function DesignerNavGroup({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="optic-designer-nav-group">
      <div className="optic-designer-nav-group-heading">
        <p className="optic-designer-nav-label">{label}</p>
        {hint ? <p className="optic-designer-nav-hint">{hint}</p> : null}
      </div>
      <div className="optic-designer-view-toggle" role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

function DesignerNavButton({
  icon,
  pressed,
  dirty,
  onClick,
  children
}: {
  icon: IconName;
  pressed: boolean;
  dirty?: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-dirty={dirty ? 'true' : undefined}
      title={dirty ? `${children} has unsaved changes` : undefined}
      onClick={onClick}
    >
      <ButtonLabel icon={icon}>
        {children}
        {dirty ? <span className="optic-designer-nav-dirty" aria-hidden="true" /> : null}
      </ButtonLabel>
    </button>
  );
}

function nextFormKey(forms: Record<string, StageFormDefinition>): string {
  let index = Object.keys(forms).length + 1;
  let key = `STAGE_FORM_${index}`;
  while (forms[key]) {
    index += 1;
    key = `STAGE_FORM_${index}`;
  }
  return key;
}

function formatSavedWhen(at: number): string {
  const deltaMs = Math.max(0, Date.now() - at);
  if (deltaMs < 15_000) {
    return 'just now';
  }
  if (deltaMs < 60_000) {
    return `${Math.max(1, Math.floor(deltaMs / 1000))}s ago`;
  }
  if (deltaMs < 3_600_000) {
    return `${Math.max(1, Math.floor(deltaMs / 60_000))}m ago`;
  }
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function releaseStatusLine(next: DesignerRelease): string {
  const live =
    next.active
      ? ' and is the Live pointer'
      : next.lifecycleStatus === 'PUBLISHED'
        ? ' (not the Live pointer)'
        : '';
  return `${next.definitionKey} ${next.version} is ${next.lifecycleStatus}${live} (${normalizeEntityType(next.entityType)}, rowVersion ${next.rowVersion}).`;
}

function pickFormKey(
  forms: Record<string, StageFormDefinition>,
  workflow?: WorkflowDefinition,
  preferred?: string
): string {
  if (preferred && forms[preferred]) {
    return preferred;
  }
  return listFormsInWorkflowOrder(forms, workflow)[0]?.formKey ?? preferred ?? '';
}

type ReleaseCatalogFilter = 'ALL' | 'DRAFT' | 'PUBLISHED' | 'LIVE';

function filterReleaseCatalog(
  items: ReleaseCatalogItem[],
  query: string,
  filter: ReleaseCatalogFilter
): ReleaseCatalogItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter === 'DRAFT' && item.lifecycleStatus !== 'DRAFT') {
      return false;
    }
    if (filter === 'PUBLISHED' && item.lifecycleStatus !== 'PUBLISHED') {
      return false;
    }
    if (filter === 'LIVE' && !item.active) {
      return false;
    }
    if (!needle) {
      return true;
    }
    return (
      item.displayName.toLowerCase().includes(needle) ||
      item.definitionKey.toLowerCase().includes(needle) ||
      item.version.toLowerCase().includes(needle)
    );
  });
}

function groupReleaseCatalog(
  items: ReleaseCatalogItem[]
): Array<{ definitionKey: string; displayName: string; releases: ReleaseCatalogItem[] }> {
  const order: string[] = [];
  const byKey = new Map<string, ReleaseCatalogItem[]>();
  const sorted = [...items].sort((left, right) => {
    const byName = left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' });
    if (byName !== 0) {
      return byName;
    }
    const byKeyName = left.definitionKey.localeCompare(right.definitionKey);
    if (byKeyName !== 0) {
      return byKeyName;
    }
    return left.version.localeCompare(right.version, undefined, { numeric: true });
  });
  for (const item of sorted) {
    if (!byKey.has(item.definitionKey)) {
      order.push(item.definitionKey);
      byKey.set(item.definitionKey, []);
    }
    byKey.get(item.definitionKey)!.push(item);
  }
  return order.map((definitionKey) => {
    const releases = byKey.get(definitionKey)!;
    return {
      definitionKey,
      displayName: releases[0]?.displayName ?? definitionKey,
      releases
    };
  });
}

function cloneSourceValue(item: ReleaseCatalogItem): string {
  return `${item.definitionKey}@${item.version}`;
}

function parseCloneSource(value: string): { definitionKey: string; version: string } | undefined {
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) {
    return undefined;
  }
  return { definitionKey: value.slice(0, at), version: value.slice(at + 1) };
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function describeTransitionSet(
  workflow: WorkflowDefinition,
  catalog: WorkflowCatalog,
  transitionSetKey: string
): string {
  const owner = workflow.stages.find((stage) => {
    if (stage.terminal) {
      return false;
    }
    const binding = outboundBinding(workflow, stage, catalog);
    return binding.kind === 'owned' && binding.set.transitionSetKey === transitionSetKey;
  });
  if (owner) {
    return `${transitionSetKey} — From ${owner.displayName}`;
  }
  return `${transitionSetKey} — not used by a stage`;
}

function caughtDesignerError(error: unknown): DisplayError {
  return asDisplayError(error, designerUnavailable());
}

function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read package file.'));
    reader.readAsText(file);
  });
}

function designerUnavailable(): string {
  return DESIGNER_API_UNREACHABLE;
}
