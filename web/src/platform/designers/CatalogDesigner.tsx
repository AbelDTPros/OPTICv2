import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode
} from 'react';
import type {
  ActionDefinition,
  BulkActionDefinition,
  QueueDefinition,
  QueueProjectedField,
  ScheduledActionDefinition,
  SearchDefinition,
  SlaDefinition,
  StageFormDefinition,
  WorkflowDefinition
} from '../../../../src/modules/configuration/domain/types.js';
import {
  groupRulePathOptions,
  listProjectableFormFields,
  listQueuesInWorkflowOrder,
  type ProjectableFormFieldOption
} from './workflow-model.js';
import {
  blankAction,
  blankBulkAction,
  blankQueue,
  blankScheduledAction,
  blankSearchField,
  blankSla,
  BUILTIN_SEARCH_FIELD_KEYS,
  BUILTIN_SEARCH_FIELD_LABELS,
  ENTITY_TYPE_OPTIONS,
  eligibilityTreeOf,
  collectActionIssues,
  collectBulkIssues,
  collectQueueIssues,
  collectScheduledIssues,
  collectSearchIssues,
  collectSlaIssues,
  ensureSearchFieldProjected,
  removeSearchFieldProjection,
  groupProjectedSearchOptions,
  listFormSearchOptions,
  nextProjectedField,
  projectedOptionForSearchField,
  resolveSearchField,
  searchFieldFromProjected,
  uniqueExtraSearchFields,
  upsertSearchField,
  type BuiltinSearchFieldKey
} from './catalog-model.js';
import { EligibilityEditor } from './EligibilityEditor.js';
import { isDesignerDirty } from './designer-dirty.js';
import { DesignerErrorBody, ErrorSummary } from '../ui/ErrorSummary.js';
import { ButtonLabel } from '../ui/Icon.js';
import { SaveDraftButton } from './SaveDraftButton.js';

export type CatalogKind = 'action' | 'queue' | 'sla' | 'search' | 'bulk' | 'scheduled';

export interface CatalogDesignerProps {
  actions: Record<string, ActionDefinition>;
  queues: Record<string, QueueDefinition>;
  slas: Record<string, SlaDefinition>;
  search: SearchDefinition;
  bulkActions: Record<string, BulkActionDefinition>;
  scheduledActions: Record<string, ScheduledActionDefinition>;
  /** When set, only these catalog kinds appear in the type strip. */
  enabledKinds?: CatalogKind[];
  forms?: Record<string, StageFormDefinition>;
  workflow?: WorkflowDefinition;
  stageKeys?: string[];
  transitionSetKeys?: string[];
  defaultEntityType?: string;
  readOnly?: boolean;
  errorSummary?: string;
  onActionsChange: (actions: Record<string, ActionDefinition>) => void;
  onQueuesChange: (queues: Record<string, QueueDefinition>) => void;
  onSlasChange: (slas: Record<string, SlaDefinition>) => void;
  onSearchChange: (search: SearchDefinition) => void;
  onBulkActionsChange: (bulkActions: Record<string, BulkActionDefinition>) => void;
  onScheduledActionsChange: (scheduledActions: Record<string, ScheduledActionDefinition>) => void;
  onSaveAction?: (action: ActionDefinition) => void;
  onSaveQueue?: (queue: QueueDefinition) => void;
  onSaveSla?: (sla: SlaDefinition) => void;
  onSaveSearch?: (search: SearchDefinition, queues: Record<string, QueueDefinition>) => void;
  onSaveBulkAction?: (bulk: BulkActionDefinition) => void;
  onSaveScheduledAction?: (scheduled: ScheduledActionDefinition) => void;
  onDeleteAction?: (actionKey: string) => void;
  onDeleteQueue?: (queueKey: string) => void;
  onDeleteSla?: (slaKey: string) => void;
  onDeleteBulkAction?: (bulkActionKey: string) => void;
  onDeleteScheduledAction?: (scheduledActionKey: string) => void;
  savedActions?: Record<string, ActionDefinition>;
  savedQueues?: Record<string, QueueDefinition>;
  savedSlas?: Record<string, SlaDefinition>;
  savedSearch?: SearchDefinition;
  savedBulkActions?: Record<string, BulkActionDefinition>;
  savedScheduledActions?: Record<string, ScheduledActionDefinition>;
}

const ALL_CATALOG_KINDS: CatalogKind[] = ['action', 'queue', 'sla', 'search', 'bulk', 'scheduled'];

export function CatalogDesigner({
  actions,
  queues,
  slas,
  search,
  bulkActions,
  scheduledActions,
  enabledKinds = ALL_CATALOG_KINDS,
  forms = {},
  workflow,
  stageKeys = [],
  transitionSetKeys = [],
  defaultEntityType = 'WORKLOAD',
  readOnly,
  errorSummary,
  onActionsChange,
  onQueuesChange,
  onSlasChange,
  onSearchChange,
  onBulkActionsChange,
  onScheduledActionsChange,
  onSaveAction,
  onSaveQueue,
  onSaveSla,
  onSaveSearch,
  onSaveBulkAction,
  onSaveScheduledAction,
  onDeleteAction,
  onDeleteQueue,
  onDeleteSla,
  onDeleteBulkAction,
  onDeleteScheduledAction,
  savedActions,
  savedQueues,
  savedSlas,
  savedSearch,
  savedBulkActions,
  savedScheduledActions
}: CatalogDesignerProps) {
  const visibleKinds = enabledKinds.length > 0 ? enabledKinds : ALL_CATALOG_KINDS;
  const [kind, setKind] = useState<CatalogKind>(visibleKinds[0] ?? 'action');
  useEffect(() => {
    if (!visibleKinds.includes(kind)) {
      setKind(visibleKinds[0] ?? 'action');
    }
  }, [kind, visibleKinds]);
  const actionKeys = Object.keys(actions);
  const orderedQueues = useMemo(() => listQueuesInWorkflowOrder(queues, workflow), [queues, workflow]);
  const queueKeys = orderedQueues.map((item) => item.queueKey);
  const slaKeys = Object.keys(slas);
  const bulkKeys = Object.keys(bulkActions);
  const scheduledKeys = Object.keys(scheduledActions);
  const [actionKey, setActionKey] = useState(actionKeys[0] ?? '');
  const [queueKey, setQueueKey] = useState(queueKeys[0] ?? '');
  const [slaKey, setSlaKey] = useState(slaKeys[0] ?? '');
  const [bulkKey, setBulkKey] = useState(bulkKeys[0] ?? '');
  const [scheduledKey, setScheduledKey] = useState(scheduledKeys[0] ?? '');
  useEffect(() => {
    if (!actionKey || !actions[actionKey]) {
      setActionKey(Object.keys(actions)[0] ?? '');
    }
  }, [actions, actionKey]);
  useEffect(() => {
    if (!queueKey || !queues[queueKey]) {
      setQueueKey(orderedQueues[0]?.queueKey ?? '');
    }
  }, [queues, queueKey, orderedQueues]);
  useEffect(() => {
    if (!slaKey || !slas[slaKey]) {
      setSlaKey(Object.keys(slas)[0] ?? '');
    }
  }, [slas, slaKey]);
  useEffect(() => {
    if (!bulkKey || !bulkActions[bulkKey]) {
      setBulkKey(Object.keys(bulkActions)[0] ?? '');
    }
  }, [bulkActions, bulkKey]);
  useEffect(() => {
    if (!scheduledKey || !scheduledActions[scheduledKey]) {
      setScheduledKey(Object.keys(scheduledActions)[0] ?? '');
    }
  }, [scheduledActions, scheduledKey]);
  const action = actions[actionKey] ?? Object.values(actions)[0];
  const queue = queues[queueKey] ?? Object.values(queues)[0];
  const sla = slas[slaKey] ?? Object.values(slas)[0];
  const bulk = bulkActions[bulkKey] ?? Object.values(bulkActions)[0];
  const scheduled = scheduledActions[scheduledKey] ?? Object.values(scheduledActions)[0];
  const issues = useMemo(() => {
    if (kind === 'action' && action) {
      return collectActionIssues(action);
    }
    if (kind === 'queue' && queue) {
      return collectQueueIssues(queue);
    }
    if (kind === 'sla' && sla) {
      return collectSlaIssues(sla);
    }
    if (kind === 'bulk' && bulk) {
      return collectBulkIssues(bulk);
    }
    if (kind === 'scheduled' && scheduled) {
      return collectScheduledIssues(scheduled);
    }
    return collectSearchIssues(search, queues, forms, workflow);
  }, [kind, action, queue, sla, search, bulk, scheduled, queues, forms, workflow]);

  const kindCounts: Record<CatalogKind, number> = {
    action: actionKeys.length,
    queue: queueKeys.length,
    sla: slaKeys.length,
    search:
      BUILTIN_SEARCH_FIELD_KEYS.length +
      uniqueExtraSearchFields(search, listFormSearchOptions(forms, workflow)).length,
    bulk: bulkKeys.length,
    scheduled: scheduledKeys.length
  };

  return (
    <section className="optic-designer" aria-labelledby="catalog-designer-heading">
      <header className="optic-designer-header">
        <div>
          <h1 id="catalog-designer-heading">Catalog designer</h1>
          <p className="optic-help">
            Shared building blocks for Workflow and officer screens. Pick a type, select an item on the left, edit on
            the right — then Save draft.
          </p>
        </div>
      </header>
      <div className="optic-designer-subnav optic-designer-toolstrip" role="group" aria-label="Catalog type">
        {visibleKinds.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={kind === item}
            title={catalogKindHelp(item)}
            onClick={() => setKind(item)}
          >
            <ButtonLabel icon={catalogKindIcon(item)}>
              {catalogKindLabel(item)}
              <span className="optic-catalog-kind-count" aria-hidden="true">
                {kindCounts[item]}
              </span>
            </ButtonLabel>
          </button>
        ))}
      </div>
      {errorSummary || issues.length > 0 ? (
        <ErrorSummary
          role={errorSummary ? 'alert' : 'status'}
          focus={Boolean(errorSummary)}
          heading="Validation"
        >
          {errorSummary ? <DesignerErrorBody message={errorSummary} /> : null}
          {issues.length > 0 ? (
            <ul>
              {issues.map((issue) => (
                <li key={issue.path + issue.message}>{issue.message}</li>
              ))}
            </ul>
          ) : null}
        </ErrorSummary>
      ) : null}

      {kind === 'action' ? (
        <ActionEditor
          actions={actions}
          selectedKey={action?.actionKey ?? ''}
          transitionSetKeys={transitionSetKeys}
          readOnly={readOnly}
          savedActions={savedActions}
          onSelect={setActionKey}
          onChange={onActionsChange}
          onSave={onSaveAction}
          onDelete={onDeleteAction}
        />
      ) : null}
      {kind === 'queue' ? (
        <QueueEditor
          queues={queues}
          orderedQueues={orderedQueues}
          forms={forms}
          workflow={workflow}
          selectedKey={queue?.queueKey ?? ''}
          defaultEntityType={defaultEntityType}
          readOnly={readOnly}
          savedQueues={savedQueues}
          onSelect={setQueueKey}
          onChange={onQueuesChange}
          onSave={onSaveQueue}
          onDelete={onDeleteQueue}
        />
      ) : null}
      {kind === 'sla' ? (
        <SlaEditor
          slas={slas}
          selectedKey={sla?.slaKey ?? ''}
          readOnly={readOnly}
          savedSlas={savedSlas}
          onSelect={setSlaKey}
          onChange={onSlasChange}
          onSave={onSaveSla}
          onDelete={onDeleteSla}
        />
      ) : null}
      {kind === 'search' ? (
        <SearchEditor
          search={search}
          queues={queues}
          forms={forms}
          workflow={workflow}
          readOnly={readOnly}
          savedSearch={savedSearch}
          savedQueues={savedQueues}
          onChange={onSearchChange}
          onQueuesChange={onQueuesChange}
          onSave={onSaveSearch}
        />
      ) : null}
      {kind === 'bulk' ? (
        <BulkEditor
          bulkActions={bulkActions}
          selectedKey={bulk?.bulkActionKey ?? ''}
          stageKeys={stageKeys}
          readOnly={readOnly}
          savedBulkActions={savedBulkActions}
          onSelect={setBulkKey}
          onChange={onBulkActionsChange}
          onSave={onSaveBulkAction}
          onDelete={onDeleteBulkAction}
        />
      ) : null}
      {kind === 'scheduled' ? (
        <ScheduledEditor
          scheduledActions={scheduledActions}
          selectedKey={scheduled?.scheduledActionKey ?? ''}
          stageKeys={stageKeys}
          readOnly={readOnly}
          savedScheduledActions={savedScheduledActions}
          onSelect={setScheduledKey}
          onChange={onScheduledActionsChange}
          onSave={onSaveScheduledAction}
          onDelete={onDeleteScheduledAction}
        />
      ) : null}
    </section>
  );
}

function CatalogKindView({ kind, children }: { kind: CatalogKind; children: ReactNode }) {
  return (
    <div className="optic-catalog-kind">
      <header className="optic-catalog-kind-intro">
        <h2>{catalogKindLabel(kind)}</h2>
        <p className="optic-help">{catalogKindHelp(kind)}</p>
      </header>
      {children}
    </div>
  );
}

function CatalogHint({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} className="optic-catalog-hint">
      {children}
    </span>
  );
}

function withDescribedBy(control: ReactNode, hintId?: string): ReactNode {
  if (!hintId || !isValidElement(control)) {
    return control;
  }
  const existing = (control.props as { 'aria-describedby'?: string })['aria-describedby'];
  return cloneElement(control as ReactElement<Record<string, unknown>>, {
    'aria-describedby': existing ? `${existing} ${hintId}` : hintId
  });
}

function CatalogField({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const hintId = useId();
  const control = Children.only(children);
  return (
    <div className="optic-catalog-field">
      <label>
        <span className="optic-catalog-field-label">{label}</span>
        {withDescribedBy(control, hint ? hintId : undefined)}
      </label>
      {hint ? <CatalogHint id={hintId}>{hint}</CatalogHint> : null}
    </div>
  );
}

function CatalogCheck({
  label,
  hint,
  checked,
  readOnly,
  onChange
}: {
  label: string;
  hint?: string;
  checked: boolean;
  readOnly?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const hintId = useId();
  return (
    <div className="optic-catalog-check">
      <label className="optic-catalog-check-row">
        <input
          type="checkbox"
          checked={checked}
          disabled={readOnly}
          aria-describedby={hint ? hintId : undefined}
          onChange={(event) => onChange(event.target.checked)}
        />
        {label}
      </label>
      {hint ? <CatalogHint id={hintId}>{hint}</CatalogHint> : null}
    </div>
  );
}

function CatalogSection({
  title,
  hint,
  children
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="optic-catalog-section">
      <legend>{title}</legend>
      {hint ? <p className="optic-catalog-section-hint">{hint}</p> : null}
      {children}
    </fieldset>
  );
}

function CatalogItemBrowser({
  listLabel,
  items,
  selectedKey,
  onSelect,
  onAdd,
  addLabel,
  emptyTitle,
  emptyHelp,
  readOnly,
  children
}: {
  listLabel: string;
  items: Array<{ key: string; title: string; subtitle?: string }>;
  selectedKey: string;
  onSelect: (key: string) => void;
  onAdd: () => void;
  addLabel: string;
  emptyTitle: string;
  emptyHelp: string;
  readOnly?: boolean;
  children: ReactNode;
}) {
  if (items.length === 0) {
    return (
      <div className="optic-designer-empty" role="status">
        <p>
          <strong>{emptyTitle}</strong>
        </p>
        <p className="optic-help">{emptyHelp}</p>
        <button type="button" className="optic-button-primary" disabled={readOnly} onClick={onAdd}>
          {addLabel}
        </button>
      </div>
    );
  }
  return (
    <div className="optic-designer-panes optic-catalog-panes">
      <aside className="optic-catalog-list" aria-label={listLabel}>
        <div className="optic-catalog-list-header">
          <h3>{listLabel}</h3>
          <button type="button" disabled={readOnly} onClick={onAdd}>
            {addLabel}
          </button>
        </div>
        <ul>
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                aria-pressed={item.key === selectedKey}
                onClick={() => onSelect(item.key)}
              >
                <strong>{item.title}</strong>
                <span className="optic-form-key">{item.subtitle ?? item.key}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="optic-catalog-detail">{children}</div>
    </div>
  );
}

function CatalogDeleteButton({
  label,
  itemKey,
  readOnly,
  onDelete
}: {
  label: string;
  itemKey: string;
  readOnly?: boolean;
  onDelete?: (key: string) => void;
}) {
  if (!onDelete) {
    return null;
  }
  return (
    <button
      type="button"
      disabled={readOnly}
      onClick={() => {
        if (!window.confirm(`Delete ${label} ${itemKey}? This cannot be undone.`)) {
          return;
        }
        onDelete(itemKey);
      }}
    >
      <ButtonLabel icon="trash">Delete {label}</ButtonLabel>
    </button>
  );
}

function ActionEditor({
  actions,
  selectedKey,
  transitionSetKeys,
  readOnly,
  savedActions,
  onSelect,
  onChange,
  onSave,
  onDelete
}: {
  actions: Record<string, ActionDefinition>;
  selectedKey: string;
  transitionSetKeys: string[];
  readOnly?: boolean;
  savedActions?: Record<string, ActionDefinition>;
  onSelect: (key: string) => void;
  onChange: (actions: Record<string, ActionDefinition>) => void;
  onSave?: (action: ActionDefinition) => void;
  onDelete?: (actionKey: string) => void;
}) {
  const action = actions[selectedKey];
  const dirty = action ? isDesignerDirty(action, savedActions?.[action.actionKey]) : false;
  function replace(next: ActionDefinition) {
    const copy = { ...actions };
    if (next.actionKey !== selectedKey) {
      delete copy[selectedKey];
    }
    copy[next.actionKey] = next;
    onChange(copy);
    onSelect(next.actionKey);
  }
  function createAction() {
    const created = blankAction();
    onChange({ ...actions, [created.actionKey]: created });
    onSelect(created.actionKey);
  }
  return (
    <CatalogKindView kind="action">
      <CatalogItemBrowser
        listLabel="Actions"
        items={Object.values(actions).map((item) => ({
          key: item.actionKey,
          title: item.label || item.actionKey,
          subtitle: `${item.type} · ${item.actionKey}`
        }))}
        selectedKey={selectedKey}
        onSelect={onSelect}
        onAdd={createAction}
        addLabel="Add action"
        emptyTitle="No actions yet"
        emptyHelp="Add an action officers can run from a stage (Complete, Save, …)."
        readOnly={readOnly}
      >
        {action ? (
          <>
            <CatalogSection title="Identity" hint="Stable key used in Workflow; label is what officers see on the button.">
              <CatalogField label="Action key" hint="Uppercase id. Stages reference this key in actionKeys.">
                <input
                  value={action.actionKey}
                  disabled={readOnly}
                  onChange={(event) => replace({ ...action, actionKey: event.target.value.toUpperCase() })}
                />
              </CatalogField>
              <CatalogField label="Label" hint="Button text on the case screen.">
                <input
                  value={action.label}
                  disabled={readOnly}
                  onChange={(event) => replace({ ...action, label: event.target.value })}
                />
              </CatalogField>
            </CatalogSection>
            <CatalogSection title="Behavior" hint="What happens when the officer presses this action.">
              <CatalogField
                label="Type"
                hint="TRANSITION moves stages; SAVE keeps the case; RELEASE_ASSIGNMENT returns it to the queue."
              >
                <select
                  value={action.type}
                  disabled={readOnly}
                  onChange={(event) => replace({ ...action, type: event.target.value })}
                >
                  <option value="TRANSITION">TRANSITION</option>
                  <option value="SAVE">SAVE</option>
                  <option value="RELEASE_ASSIGNMENT">RELEASE_ASSIGNMENT</option>
                </select>
              </CatalogField>
              <CatalogField
                label="Transition set"
                hint="Workflow From block that decides the next stage. Required for TRANSITION."
              >
                <select
                  value={action.transitionSetKey ?? ''}
                  disabled={readOnly}
                  onChange={(event) => replace({ ...action, transitionSetKey: event.target.value || undefined })}
                >
                  <option value="">None</option>
                  {uniqueKeys(action.transitionSetKey, transitionSetKeys).map((key) => (
                    <option key={key} value={key}>
                      {transitionSetKeys.includes(key) ? key : `${key} (not on workflow)`}
                    </option>
                  ))}
                </select>
              </CatalogField>
              {transitionSetKeys.length === 0 ? (
                <p className="optic-help">
                  Add a transition set on the Workflow tab, then pick it here. Required for TRANSITION actions.
                </p>
              ) : null}
              <CatalogCheck
                label="Require assignment to current user"
                hint="Officer must own the case before this action runs."
                checked={Boolean(action.requireAssignmentToCurrentUser)}
                readOnly={readOnly}
                onChange={(checked) => replace({ ...action, requireAssignmentToCurrentUser: checked })}
              />
              <CatalogCheck
                label="Validate stage form on complete"
                hint="Run form schema checks before Complete succeeds."
                checked={Boolean(action.validation?.validateStageForm)}
                readOnly={readOnly}
                onChange={(checked) =>
                  replace({
                    ...action,
                    validation: { ...action.validation, validateStageForm: checked }
                  })
                }
              />
            </CatalogSection>
            <div className="optic-catalog-footer">
              {onSave ? (
                <SaveDraftButton
                  dirty={dirty}
                  disabled={readOnly || collectActionIssues(action).length > 0}
                  onClick={() => onSave(action)}
                />
              ) : null}
              <CatalogDeleteButton label="Action" itemKey={action.actionKey} readOnly={readOnly} onDelete={onDelete} />
            </div>
          </>
        ) : (
          <p className="optic-help">Select an action on the left to edit it.</p>
        )}
      </CatalogItemBrowser>
    </CatalogKindView>
  );
}

function QueueEditor({
  queues,
  orderedQueues,
  forms,
  workflow,
  selectedKey,
  defaultEntityType,
  readOnly,
  savedQueues,
  onSelect,
  onChange,
  onSave,
  onDelete
}: {
  queues: Record<string, QueueDefinition>;
  orderedQueues: QueueDefinition[];
  forms: Record<string, StageFormDefinition>;
  workflow?: WorkflowDefinition;
  selectedKey: string;
  defaultEntityType: string;
  readOnly?: boolean;
  savedQueues?: Record<string, QueueDefinition>;
  onSelect: (key: string) => void;
  onChange: (queues: Record<string, QueueDefinition>) => void;
  onSave?: (queue: QueueDefinition) => void;
  onDelete?: (queueKey: string) => void;
}) {
  const queue = queues[selectedKey];
  const dirty = queue ? isDesignerDirty(queue, savedQueues?.[queue.queueKey]) : false;
  const projectableFields = useMemo(
    () => listProjectableFormFields(forms, workflow),
    [forms, workflow]
  );
  function replace(next: QueueDefinition) {
    const copy = { ...queues };
    if (next.queueKey !== selectedKey) {
      delete copy[selectedKey];
    }
    copy[next.queueKey] = next;
    onChange(copy);
    onSelect(next.queueKey);
  }
  function createQueue() {
    const created = blankQueue(defaultEntityType);
    onChange({ ...queues, [created.queueKey]: created });
    onSelect(created.queueKey);
  }
  return (
    <CatalogKindView kind="queue">
      <CatalogItemBrowser
        listLabel="Queues"
        items={orderedQueues.map((item) => ({
          key: item.queueKey,
          title: item.displayName || item.queueKey,
          subtitle: item.queueKey
        }))}
        selectedKey={selectedKey}
        onSelect={onSelect}
        onAdd={createQueue}
        addLabel="Add queue"
        emptyTitle="No queues yet"
        emptyHelp="Add a queue for officer worklists, then link it from a Workflow stage."
        readOnly={readOnly}
      >
        {queue ? (
          <>
            <CatalogSection
              title="Identity"
              hint="Link this queue key on a Workflow stage so officers open this worklist."
            >
              <CatalogField label="Queue key" hint="Stable id referenced by Workflow stages.">
                <input
                  value={queue.queueKey}
                  disabled={readOnly}
                  onChange={(event) => replace({ ...queue, queueKey: event.target.value.toUpperCase() })}
                />
              </CatalogField>
              <CatalogField label="Display name" hint="Title officers see on the queue tab.">
                <input
                  value={queue.displayName}
                  disabled={readOnly}
                  onChange={(event) => replace({ ...queue, displayName: event.target.value })}
                />
              </CatalogField>
              <CatalogField
                label="Queue entity type"
                hint="Must match the definition (workload vs mail item)."
              >
                <select
                  value={queue.entityType === 'MAIL' ? 'MAIL' : 'WORKLOAD'}
                  disabled={readOnly}
                  onChange={(event) => replace({ ...queue, entityType: event.target.value })}
                >
                  {ENTITY_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </CatalogField>
            </CatalogSection>
            <CatalogSection
              title="List layout"
              hint="How the officer worklist looks: which columns, filters, and row buttons appear."
            >
              <CommaSeparatedKeys
                label="Columns"
                resetKey={queue.queueKey}
                keys={queue.columns}
                disabled={readOnly}
                help="Fields shown as columns on each queue row. Use platform keys (trackingId, assignedTo, receiptNumber) or Field keys from Projected form fields below."
                onKeysChange={(columns) => replace({ ...queue, columns })}
              />
              <CommaSeparatedKeys
                label="Filters"
                resetKey={queue.queueKey}
                keys={queue.filters}
                disabled={readOnly}
                help="Filter controls above the list so officers can narrow rows (e.g. by assignment or stage). Platform keys only — assignedStatus, currentStageKey, and similar."
                onKeysChange={(filters) => replace({ ...queue, filters })}
              />
              <CommaSeparatedKeys
                label="Queue actions"
                resetKey={queue.queueKey}
                keys={queue.actions}
                disabled={readOnly}
                help="Buttons on each row for claiming or releasing work. Comma-separated; allowed: ASSIGN_TO_SELF, RELEASE_TO_QUEUE."
                onKeysChange={(actions) => replace({ ...queue, actions })}
              />
              <CatalogField
                label="Page size"
                hint="How many rows load per page before the officer pages to the next set."
              >
                <input
                  type="number"
                  value={queue.pageSize}
                  disabled={readOnly}
                  onChange={(event) => replace({ ...queue, pageSize: Number(event.target.value) })}
                />
              </CatalogField>
            </CatalogSection>
            <details className="optic-designer-collapse" open>
              <summary>Projected form fields</summary>
              <p className="optic-catalog-hint">
                Pull values from the case form onto queue columns for display only. They cannot be used as
                Filters or sort keys — add their Field key to Columns to show them.
              </p>
              <ProjectedFieldsEditor
                fields={queue.projectedFields ?? []}
                projectableFields={projectableFields}
                readOnly={readOnly}
                onChange={(projectedFields, columns) =>
                  replace({ ...queue, projectedFields, columns: columns ?? queue.columns })
                }
                columns={queue.columns}
              />
            </details>
            <details className="optic-designer-collapse">
              <summary>Eligibility rules</summary>
              <p className="optic-catalog-hint">
                Decide which cases land in this queue. Typical rules match stage, assignment, or entity type —
                cases that fail these predicates never appear in the list.
              </p>
              <EligibilityEditor
                value={eligibilityTreeOf(queue.eligibility)}
                readOnly={readOnly}
                onChange={(eligibility) =>
                  replace({ ...queue, eligibility: eligibility as Record<string, unknown> })
                }
              />
            </details>
            <div className="optic-catalog-footer">
              {onSave ? (
                <SaveDraftButton
                  dirty={dirty}
                  disabled={readOnly || collectQueueIssues(queue).length > 0}
                  onClick={() => onSave(queue)}
                />
              ) : null}
              <CatalogDeleteButton label="Queue" itemKey={queue.queueKey} readOnly={readOnly} onDelete={onDelete} />
            </div>
          </>
        ) : (
          <p className="optic-help">Select a queue on the left to edit it.</p>
        )}
      </CatalogItemBrowser>
    </CatalogKindView>
  );
}

function SlaEditor({
  slas,
  selectedKey,
  readOnly,
  savedSlas,
  onSelect,
  onChange,
  onSave,
  onDelete
}: {
  slas: Record<string, SlaDefinition>;
  selectedKey: string;
  readOnly?: boolean;
  savedSlas?: Record<string, SlaDefinition>;
  onSelect: (key: string) => void;
  onChange: (slas: Record<string, SlaDefinition>) => void;
  onSave?: (sla: SlaDefinition) => void;
  onDelete?: (slaKey: string) => void;
}) {
  const sla = slas[selectedKey];
  const dirty = sla ? isDesignerDirty(sla, savedSlas?.[sla.slaKey]) : false;
  function replace(next: SlaDefinition) {
    const copy = { ...slas };
    if (next.slaKey !== selectedKey) {
      delete copy[selectedKey];
    }
    copy[next.slaKey] = next;
    onChange(copy);
    onSelect(next.slaKey);
  }
  function createSla() {
    const created = blankSla();
    onChange({ ...slas, [created.slaKey]: created });
    onSelect(created.slaKey);
  }
  return (
    <CatalogKindView kind="sla">
      <CatalogItemBrowser
        listLabel="SLAs"
        items={Object.values(slas).map((item) => ({
          key: item.slaKey,
          title: item.slaKey,
          subtitle: `${item.target.durationHours}h · ${item.clock}`
        }))}
        selectedKey={selectedKey}
        onSelect={onSelect}
        onAdd={createSla}
        addLabel="Add SLA"
        emptyTitle="No SLAs yet"
        emptyHelp="Add an SLA, then attach it to a Workflow stage."
        readOnly={readOnly}
      >
        {sla ? (
          <>
            <CatalogSection title="Identity" hint="Attach this SLA key on a Workflow stage to start the clock.">
              <CatalogField label="SLA key" hint="Stable id referenced by Workflow stages.">
                <input
                  value={sla.slaKey}
                  disabled={readOnly}
                  onChange={(event) => replace({ ...sla, slaKey: event.target.value.toUpperCase() })}
                />
              </CatalogField>
              <CatalogField
                label="Clock"
                hint="CALENDAR counts every hour; BUSINESS uses business hours."
              >
                <select
                  value={sla.clock}
                  disabled={readOnly}
                  onChange={(event) => replace({ ...sla, clock: event.target.value as SlaDefinition['clock'] })}
                >
                  <option value="CALENDAR">CALENDAR</option>
                  <option value="BUSINESS">BUSINESS</option>
                </select>
              </CatalogField>
            </CatalogSection>
            <CatalogSection title="Thresholds" hint="When the timer warns and when it breaches.">
              <CatalogField label="Target hours" hint="Allowed time in the stage before breach at 100%.">
                <input
                  type="number"
                  value={sla.target.durationHours}
                  disabled={readOnly}
                  onChange={(event) => replace({ ...sla, target: { durationHours: Number(event.target.value) } })}
                />
              </CatalogField>
              <CatalogField label="Warning percent" hint="Percent of target hours when a warning fires (e.g. 75).">
                <input
                  type="number"
                  value={sla.warningThresholdPercent}
                  disabled={readOnly}
                  onChange={(event) => replace({ ...sla, warningThresholdPercent: Number(event.target.value) })}
                />
              </CatalogField>
              <CatalogField label="Breach percent" hint="Usually 100 — full target hours elapsed.">
                <input
                  type="number"
                  value={sla.breachThresholdPercent}
                  disabled={readOnly}
                  onChange={(event) => replace({ ...sla, breachThresholdPercent: Number(event.target.value) })}
                />
              </CatalogField>
              <CatalogField label="Severity on breach" hint="Severity tag recorded when the SLA breaches.">
                <input
                  value={sla.severityOnBreach}
                  disabled={readOnly}
                  onChange={(event) => replace({ ...sla, severityOnBreach: event.target.value })}
                />
              </CatalogField>
            </CatalogSection>
            <div className="optic-catalog-footer">
              {onSave ? (
                <SaveDraftButton
                  dirty={dirty}
                  disabled={readOnly || collectSlaIssues(sla).length > 0}
                  onClick={() => onSave(sla)}
                />
              ) : null}
              <CatalogDeleteButton label="SLA" itemKey={sla.slaKey} readOnly={readOnly} onDelete={onDelete} />
            </div>
          </>
        ) : (
          <p className="optic-help">Select an SLA on the left to edit it.</p>
        )}
      </CatalogItemBrowser>
    </CatalogKindView>
  );
}

function SearchEditor({
  search,
  queues,
  forms,
  workflow,
  readOnly,
  savedSearch,
  savedQueues,
  onChange,
  onQueuesChange,
  onSave
}: {
  search: SearchDefinition;
  queues: Record<string, QueueDefinition>;
  forms: Record<string, StageFormDefinition>;
  workflow?: WorkflowDefinition;
  readOnly?: boolean;
  savedSearch?: SearchDefinition;
  savedQueues?: Record<string, QueueDefinition>;
  onChange: (search: SearchDefinition) => void;
  onQueuesChange: (queues: Record<string, QueueDefinition>) => void;
  onSave?: (search: SearchDefinition, queues: Record<string, QueueDefinition>) => void;
}) {
  const dirty =
    isDesignerDirty(search, savedSearch) ||
    isDesignerDirty(
      Object.fromEntries(
        Object.entries(queues).map(([key, queue]) => [key, queue.projectedFields ?? []])
      ),
      Object.fromEntries(
        Object.entries(savedQueues ?? {}).map(([key, queue]) => [key, queue.projectedFields ?? []])
      )
    );
  const formOptions = listFormSearchOptions(forms, workflow);
  const extras = uniqueExtraSearchFields(search, formOptions);
  const usedPaths = new Set(
    extras.map(({ field }) => {
      const matched = projectedOptionForSearchField(field, formOptions);
      return (matched?.path ?? field.path).toLowerCase();
    })
  );
  const availableFormOptions = formOptions.filter((option) => !usedPaths.has(option.path.toLowerCase()));
  const groupedFormOptions = groupProjectedSearchOptions(formOptions);
  const searchIssues = collectSearchIssues(search, queues, forms, workflow);

  function updateBuiltin(fieldKey: BuiltinSearchFieldKey, patch: Partial<SearchDefinition['fields'][number]>) {
    onChange(upsertSearchField(search, { ...resolveSearchField(search, fieldKey), ...patch, fieldKey }));
  }

  function applySearchField(index: number, option: (typeof formOptions)[number], match: string, pii: boolean) {
    const previous = search.fields[index];
    const nextFields = search.fields.map((item, itemIndex) =>
      itemIndex === index ? { ...searchFieldFromProjected(option), match, pii } : item
    );
    const nextSearch = { ...search, fields: nextFields };
    onChange(nextSearch);
    let nextQueues = ensureSearchFieldProjected(queues, option);
    if (previous && previous.path.trim().toLowerCase() !== option.path.trim().toLowerCase()) {
      nextQueues = removeSearchFieldProjection(nextQueues, previous, nextSearch);
    }
    onQueuesChange(nextQueues);
  }

  function addSearchFilter() {
    const option = availableFormOptions[0];
    const nextField = blankSearchField(option);
    onChange({ ...search, fields: [...search.fields, nextField] });
    if (option) {
      onQueuesChange(ensureSearchFieldProjected(queues, option));
    }
  }

  function removeSearchFilter(index: number) {
    const removed = search.fields[index];
    const nextSearch = {
      ...search,
      fields: search.fields.filter((_, itemIndex) => itemIndex !== index)
    };
    onChange(nextSearch);
    if (removed) {
      onQueuesChange(removeSearchFieldProjection(queues, removed, nextSearch));
    }
  }

  function replaceExtra(index: number, nextField: SearchDefinition['fields'][number]) {
    onChange({
      ...search,
      fields: search.fields.map((item, itemIndex) => (itemIndex === index ? nextField : item))
    });
  }

  return (
    <CatalogKindView kind="search">
      <div className="optic-catalog-detail optic-catalog-detail-solo">
        <CatalogSection
          title="Find a case filters"
          hint="These four inputs always appear on Workspace Find a case. Adjust match style or path when the default is wrong — you cannot remove them."
        >
          <ul className="optic-catalog-builtin-list">
            {BUILTIN_SEARCH_FIELD_KEYS.map((fieldKey) => {
              const field = resolveSearchField(search, fieldKey);
              const customized = search.fields.some((item) => item.fieldKey === fieldKey);
              return (
                <li key={fieldKey}>
                  <div className="optic-catalog-builtin-head">
                    <strong>{BUILTIN_SEARCH_FIELD_LABELS[fieldKey]}</strong>
                    <span className="optic-form-key">{fieldKey}</span>
                    {customized ? (
                      <button
                        type="button"
                        className="optic-catalog-builtin-reset"
                        disabled={readOnly}
                        onClick={() =>
                          onChange({
                            ...search,
                            fields: search.fields.filter((item) => item.fieldKey !== fieldKey)
                          })
                        }
                      >
                        Reset to default
                      </button>
                    ) : (
                      <span className="optic-help">Platform default</span>
                    )}
                  </div>
                  <div className="optic-catalog-builtin-fields">
                    <CatalogField
                      label={`${BUILTIN_SEARCH_FIELD_LABELS[fieldKey]} match`}
                      hint="How typed text is compared to the stored value."
                    >
                      <select
                        value={normalizeSearchMatch(field.match)}
                        disabled={readOnly}
                        onChange={(event) => updateBuiltin(fieldKey, { match: event.target.value })}
                      >
                        <SearchMatchOptions />
                      </select>
                    </CatalogField>
                    <CatalogField
                      label={`${BUILTIN_SEARCH_FIELD_LABELS[fieldKey]} source`}
                      hint="Platform data is workflow/system; Form data is business payload."
                    >
                      <select
                        value={field.source}
                        disabled={readOnly}
                        onChange={(event) =>
                          updateBuiltin(fieldKey, {
                            source: event.target.value as SearchDefinition['fields'][number]['source']
                          })
                        }
                      >
                        <SearchSourceOptions />
                      </select>
                    </CatalogField>
                    <CatalogField
                      label={`${BUILTIN_SEARCH_FIELD_LABELS[fieldKey]} path`}
                      hint="JSONPath to the value (for example $workflow.trackingId or $.receiptNumber)."
                    >
                      <input
                        value={field.path}
                        disabled={readOnly}
                        onChange={(event) => updateBuiltin(fieldKey, { path: event.target.value })}
                      />
                    </CatalogField>
                    <CatalogCheck
                      label={`${BUILTIN_SEARCH_FIELD_LABELS[fieldKey]} is PII`}
                      hint="Mark if results for this field must be treated as personally identifiable."
                      checked={field.pii}
                      readOnly={readOnly}
                      onChange={(checked) => updateBuiltin(fieldKey, { pii: checked })}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </CatalogSection>

        <CatalogSection
          title="More Find a case filters"
          hint="Optional inputs on Workspace Find a case. Pick any field from this definition’s forms — it is copied onto a queue projection so search can match it."
        >
          {formOptions.length === 0 ? (
            <p className="optic-help optic-catalog-section-empty" role="status">
              Nothing to add yet. Save fields on the <strong>Form</strong> tab first, then return here.
            </p>
          ) : null}
          {extras.length > 0 ? (
            <ul className="optic-catalog-search-extras">
              {extras.map(({ field, index }) => {
                const matched = projectedOptionForSearchField(field, formOptions);
                const selectValue = matched?.path ?? '';
                const filterName = matched?.label || field.fieldKey.trim() || 'Filter';
                return (
                  <li key={`extra-${index}-${field.fieldKey}-${field.path}`}>
                    <div className="optic-catalog-search-extra-head">
                      <strong>{filterName}</strong>
                      <button
                        type="button"
                        className="optic-catalog-builtin-reset"
                        disabled={readOnly}
                        onClick={() => removeSearchFilter(index)}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="optic-catalog-search-extra-row">
                      <CatalogField
                        label="Find a case input"
                        hint="Form value officers can type on Workspace."
                      >
                        <select
                          value={selectValue}
                          disabled={readOnly || formOptions.length === 0}
                          onChange={(event) => {
                            const option = formOptions.find((item) => item.path === event.target.value);
                            if (!option) {
                              return;
                            }
                            applySearchField(index, option, field.match, field.pii);
                          }}
                        >
                          {selectValue ? null : <option value="">Choose a form field…</option>}
                          {groupedFormOptions.map((group) => (
                            <optgroup key={group.group} label={group.group}>
                              {group.items.map((option) => (
                                <option
                                  key={option.path}
                                  value={option.path}
                                  disabled={
                                    usedPaths.has(option.path.toLowerCase()) &&
                                    option.path.toLowerCase() !== matched?.path.toLowerCase()
                                  }
                                >
                                  {option.label}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </CatalogField>
                      <CatalogField
                        label="Match"
                        hint="Contains is usually right."
                      >
                        <select
                          value={normalizeSearchMatch(field.match)}
                          disabled={readOnly}
                          onChange={(event) => replaceExtra(index, { ...field, match: event.target.value })}
                        >
                          <SearchMatchOptions />
                        </select>
                      </CatalogField>
                      <CatalogCheck
                        label="Personal data"
                        hint="On if this value is personally identifiable."
                        checked={field.pii}
                        readOnly={readOnly}
                        onChange={(checked) => replaceExtra(index, { ...field, pii: checked })}
                      />
                    </div>
                    {!matched && formOptions.length > 0 ? (
                      <p className="optic-help" role="status">
                        This filter is not linked to a form field. Choose one above.
                      </p>
                    ) : matched ? (
                      <p className="optic-help">
                        Officers will see “{matched.label}” on Find a case. Saved on a queue projection for matching.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : formOptions.length > 0 ? (
            <p className="optic-help optic-catalog-section-empty">
              Only the four built-in filters are on Find a case. Add another from this workload’s forms (receipt
              details, status, names, and so on).
            </p>
          ) : null}
          <div className="optic-catalog-footer">
            <button
              type="button"
              disabled={readOnly || (formOptions.length > 0 && availableFormOptions.length === 0)}
              onClick={() => addSearchFilter()}
            >
              Add Find a case filter
            </button>
            {onSave ? (
              <SaveDraftButton
                dirty={dirty}
                disabled={readOnly || searchIssues.length > 0}
                onClick={() => onSave(search, queues)}
              />
            ) : null}
          </div>
        </CatalogSection>

        <details className="optic-catalog-search-advanced">
          <summary>Advanced storage</summary>
          <CatalogField label="Search key" hint="Package id only (usually DEFAULT). Officers never see this.">
            <input
              value={search.searchKey}
              disabled={readOnly}
              onChange={(event) => onChange({ ...search, searchKey: event.target.value.toUpperCase() })}
            />
          </CatalogField>
        </details>
      </div>
    </CatalogKindView>
  );
}

function normalizeSearchMatch(match: string): string {
  if (match === 'FUZZY') {
    return 'CONTAINS';
  }
  if (match === 'CONTAINS' || match === 'EQUALS' || match === 'EXACT_PREFIX') {
    return match;
  }
  if (match === 'EXACT') {
    return 'EQUALS';
  }
  return 'EXACT_PREFIX';
}

function SearchMatchOptions() {
  return (
    <>
      <option value="CONTAINS">Contains</option>
      <option value="EXACT_PREFIX">Starts with</option>
      <option value="EQUALS">Exact match</option>
    </>
  );
}

function SearchSourceOptions() {
  return (
    <>
      <option value="SYSTEM">Platform data</option>
      <option value="BUSINESS_DATA">Form data</option>
    </>
  );
}

function splitKeys(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function sameKeyList(text: string, keys: string[]): boolean {
  const parsed = splitKeys(text);
  return parsed.length === keys.length && parsed.every((key, index) => key === keys[index]);
}

function ProjectedFieldsEditor({
  fields,
  columns,
  projectableFields,
  readOnly,
  onChange
}: {
  fields: QueueProjectedField[];
  columns: string[];
  projectableFields: ProjectableFormFieldOption[];
  readOnly?: boolean;
  onChange: (fields: QueueProjectedField[], columns?: string[]) => void;
}) {
  const usedPaths = new Set(fields.map((field) => field.path));
  const availableToAdd = projectableFields.filter((option) => !usedPaths.has(option.path));
  const pathGroups = groupRulePathOptions(
    projectableFields.map((option) => ({
      value: option.path,
      label: `${option.label} · ${option.path}`,
      group: option.group
    }))
  );

  function replaceField(index: number, nextField: QueueProjectedField) {
    const previous = fields[index];
    if (!previous) {
      return;
    }
    const next = fields.map((field, fieldIndex) => (fieldIndex === index ? nextField : field));
    let nextColumns = columns.map((column) => (column === previous.fieldKey ? nextField.fieldKey : column));
    if (!nextColumns.includes(nextField.fieldKey)) {
      nextColumns = [...nextColumns, nextField.fieldKey];
    }
    onChange(next, nextColumns);
  }

  function patchLabel(index: number, label: string) {
    const previous = fields[index];
    if (!previous) {
      return;
    }
    onChange(fields.map((field, fieldIndex) => (fieldIndex === index ? { ...field, label } : field)));
  }

  function selectFormField(index: number, path: string) {
    const option = projectableFields.find((item) => item.path === path);
    const previous = fields[index];
    if (!option || !previous) {
      return;
    }
    const usedKeys = new Set(
      fields.filter((_, fieldIndex) => fieldIndex !== index).map((field) => field.fieldKey)
    );
    replaceField(index, {
      fieldKey: uniqueProjectedFieldKey(option.fieldKey, usedKeys),
      label: option.label,
      path: option.path
    });
  }

  function addProjectedField(option?: ProjectableFormFieldOption) {
    const pick = option ?? availableToAdd[0];
    const created = pick
      ? {
          fieldKey: uniqueProjectedFieldKey(
            pick.fieldKey,
            new Set(fields.map((field) => field.fieldKey))
          ),
          label: pick.label,
          path: pick.path
        }
      : nextProjectedField(fields);
    onChange([...fields, created], columns.includes(created.fieldKey) ? columns : [...columns, created.fieldKey]);
  }

  return (
    <div className="optic-catalog-projected">
      <p className="optic-catalog-hint">
        Pick a form field (same list as Form behaviors). Column label is what officers see; Field key is added to
        Columns automatically.
      </p>
      {projectableFields.length === 0 ? (
        <p className="optic-help">Save a form on the Form tab first, then pick fields here.</p>
      ) : null}
      {fields.map((field, index) => {
        const known = projectableFields.some((option) => option.path === field.path);
        return (
          <div key={`projected-${index}`} className="optic-catalog-projected-row">
            <CatalogField
              label={`Form field ${index + 1}`}
              hint={field.path ? `Copies ${field.path} onto the queue row as ${field.fieldKey}.` : 'Choose a form field.'}
            >
              {projectableFields.length > 0 ? (
                <select
                  value={field.path}
                  disabled={readOnly}
                  aria-label={`Form field ${index + 1}`}
                  onChange={(event) => selectFormField(index, event.target.value)}
                >
                  {known ? null : (
                    <option value={field.path}>
                      {field.label || field.fieldKey || field.path || 'Unknown'} (not on a form)
                    </option>
                  )}
                  {pathGroups.map(({ group, items }) => (
                    <optgroup key={group} label={group}>
                      {items.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              ) : (
                <input
                  value={field.path}
                  disabled={readOnly}
                  aria-label={`JSONPath ${index + 1}`}
                  onChange={(event) =>
                    replaceField(index, { ...field, path: event.target.value })
                  }
                />
              )}
            </CatalogField>
            <CatalogField
              label={`Column label ${index + 1}`}
              hint="Header text officers see for this column."
            >
              <input
                value={field.label}
                disabled={readOnly}
                onChange={(event) => patchLabel(index, event.target.value)}
              />
            </CatalogField>
            <div className="optic-catalog-projected-actions optic-catalog-field">
              <label>
                <span className="optic-catalog-field-label">Actions</span>
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() =>
                    onChange(
                      fields.filter((_, fieldIndex) => fieldIndex !== index),
                      columns.filter((column) => column !== field.fieldKey)
                    )
                  }
                >
                  Remove
                </button>
              </label>
            </div>
          </div>
        );
      })}
      <div className="optic-catalog-projected-footer">
        <button
          type="button"
          disabled={readOnly || (projectableFields.length > 0 && availableToAdd.length === 0)}
          onClick={() => addProjectedField()}
        >
          Add form field
        </button>
        {projectableFields.length > 0 && availableToAdd.length === 0 ? (
          <p className="optic-catalog-hint">All form fields on this draft are already projected.</p>
        ) : null}
      </div>
    </div>
  );
}

function uniqueProjectedFieldKey(preferred: string, used: Set<string>): string {
  const base = preferred.replace(/[^A-Za-z0-9_]/g, '_') || 'field';
  const start = /^[A-Za-z]/.test(base) ? base : `f_${base}`;
  if (!used.has(start)) {
    return start;
  }
  let index = 2;
  while (used.has(`${start}${index}`)) {
    index += 1;
  }
  return `${start}${index}`;
}

function CommaSeparatedKeys({
  label,
  keys,
  resetKey,
  disabled,
  help,
  onKeysChange
}: {
  label: string;
  keys: string[];
  resetKey: string;
  disabled?: boolean;
  help?: string;
  onKeysChange: (keys: string[]) => void;
}) {
  const serialized = keys.join(', ');
  const [text, setText] = useState(serialized);
  useEffect(() => {
    setText((current) => (sameKeyList(current, keys) ? current : serialized));
  }, [keys, resetKey, serialized]);
  const helpId = useId();
  return (
    <div className="optic-key-list optic-catalog-field">
      <label>
        <span className="optic-catalog-field-label">{label}</span>
        <input
          value={text}
          disabled={disabled}
          aria-describedby={help ? helpId : undefined}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            onKeysChange(splitKeys(next));
          }}
        />
      </label>
      {help ? <CatalogHint id={helpId}>{help}</CatalogHint> : null}
    </div>
  );
}

function catalogKindIcon(kind: CatalogKind) {
  if (kind === 'queue') {
    return 'queue' as const;
  }
  if (kind === 'sla') {
    return 'clock' as const;
  }
  if (kind === 'search') {
    return 'search' as const;
  }
  if (kind === 'bulk') {
    return 'inbox' as const;
  }
  if (kind === 'scheduled') {
    return 'calendar' as const;
  }
  return 'check' as const;
}

function catalogKindLabel(kind: CatalogKind): string {
  if (kind === 'action') {
    return 'Actions';
  }
  if (kind === 'queue') {
    return 'Queues';
  }
  if (kind === 'sla') {
    return 'SLAs';
  }
  if (kind === 'search') {
    return 'Search';
  }
  if (kind === 'bulk') {
    return 'Bulk';
  }
  return 'Scheduled';
}

function catalogKindHelp(kind: CatalogKind): string {
  if (kind === 'action') {
    return 'Buttons on a case (Complete, Save). TRANSITION actions must point at a Workflow transition set.';
  }
  if (kind === 'queue') {
    return 'Officer worklists in Workflow stage order. Link a queue on a stage (Routing) and use Move earlier/later to change the list order.';
  }
  if (kind === 'sla') {
    return 'How long work may sit before warning or breach. Attach an SLA key on a Workflow stage.';
  }
  if (kind === 'search') {
    return 'Configures Find a case on Workspace. Four filters are always present; add more from workload form fields — they are projected onto a queue automatically for matching.';
  }
  if (kind === 'bulk') {
    return 'Multi-select actions on a queue. Stage must match a Workflow stage that uses that queue.';
  }
  return 'Timers and nudges after a stage is entered. Wire them from Workflow scheduled actions.';
}

function BulkEditor({
  bulkActions,
  selectedKey,
  stageKeys,
  readOnly,
  savedBulkActions,
  onSelect,
  onChange,
  onSave,
  onDelete
}: {
  bulkActions: Record<string, BulkActionDefinition>;
  selectedKey: string;
  stageKeys: string[];
  readOnly?: boolean;
  savedBulkActions?: Record<string, BulkActionDefinition>;
  onSelect: (key: string) => void;
  onChange: (bulkActions: Record<string, BulkActionDefinition>) => void;
  onSave?: (bulk: BulkActionDefinition) => void;
  onDelete?: (bulkActionKey: string) => void;
}) {
  const bulk = bulkActions[selectedKey];
  const dirty = bulk ? isDesignerDirty(bulk, savedBulkActions?.[bulk.bulkActionKey]) : false;
  function replace(next: BulkActionDefinition) {
    const copy = { ...bulkActions };
    if (next.bulkActionKey !== selectedKey) {
      delete copy[selectedKey];
    }
    copy[next.bulkActionKey] = next;
    onChange(copy);
    onSelect(next.bulkActionKey);
  }
  function createBulk() {
    const created = blankBulkAction();
    onChange({ ...bulkActions, [created.bulkActionKey]: created });
    onSelect(created.bulkActionKey);
  }
  const schemaText = JSON.stringify(bulk?.sharedInputSchema ?? { type: 'object', properties: {} }, null, 2);
  return (
    <CatalogKindView kind="bulk">
      <CatalogItemBrowser
        listLabel="Bulk actions"
        items={Object.values(bulkActions).map((item) => ({
          key: item.bulkActionKey,
          title: item.label || item.bulkActionKey,
          subtitle: item.stageKey ? `Stage ${item.stageKey}` : item.bulkActionKey
        }))}
        selectedKey={selectedKey}
        onSelect={onSelect}
        onAdd={createBulk}
        addLabel="Add bulk action"
        emptyTitle="No bulk actions yet"
        emptyHelp="Add a bulk action for multi-select work on a queue stage."
        readOnly={readOnly}
      >
        {bulk ? (
          <>
            <CatalogSection title="Identity" hint="Toolbar label officers see when multi-selecting queue rows.">
              <CatalogField label="Bulk action key" hint="Stable id for this bulk operation.">
                <input
                  value={bulk.bulkActionKey}
                  disabled={readOnly}
                  onChange={(event) => replace({ ...bulk, bulkActionKey: event.target.value.toUpperCase() })}
                />
              </CatalogField>
              <CatalogField label="Label" hint="Button text on the queue bulk toolbar.">
                <input
                  value={bulk.label}
                  disabled={readOnly}
                  onChange={(event) => replace({ ...bulk, label: event.target.value })}
                />
              </CatalogField>
            </CatalogSection>
            <CatalogSection
              title="Scope"
              hint="Which stage’s queue offers this action, and what happens to selected rows."
            >
              <CatalogField
                label="Stage"
                hint="Workflow stage whose queue shows this bulk action."
              >
                <select
                  value={bulk.stageKey}
                  disabled={readOnly}
                  onChange={(event) => replace({ ...bulk, stageKey: event.target.value })}
                >
                  <option value="">Choose a stage</option>
                  {uniqueKeys(bulk.stageKey, stageKeys).map((key) => (
                    <option key={key} value={key}>
                      {stageKeys.includes(key) ? key : `${key} (not on workflow)`}
                    </option>
                  ))}
                </select>
              </CatalogField>
              {stageKeys.length === 0 ? (
                <p className="optic-help">Add a stage on the Workflow tab, then pick it here.</p>
              ) : null}
              <CatalogField label="Max selection" hint="Upper limit on rows an officer can select at once.">
                <input
                  type="number"
                  value={bulk.maxSelection}
                  disabled={readOnly}
                  onChange={(event) => replace({ ...bulk, maxSelection: Number(event.target.value) })}
                />
              </CatalogField>
              <CatalogField
                label="Transaction mode"
                hint="ATOMIC rolls back all items on any failure; BEST_EFFORT commits each item alone."
              >
                <select
                  value={bulk.transactionMode}
                  disabled={readOnly}
                  onChange={(event) =>
                    replace({
                      ...bulk,
                      transactionMode: event.target.value as BulkActionDefinition['transactionMode']
                    })
                  }
                >
                  <option value="BEST_EFFORT">BEST_EFFORT</option>
                  <option value="ATOMIC">ATOMIC</option>
                </select>
              </CatalogField>
              <CatalogField
                label="Target stage"
                hint="Optional stage to move each selected item into after the bulk run."
              >
                <select
                  value={bulk.transition?.targetStage ?? ''}
                  disabled={readOnly}
                  onChange={(event) =>
                    replace({
                      ...bulk,
                      transition: event.target.value ? { targetStage: event.target.value } : undefined
                    })
                  }
                >
                  <option value="">None</option>
                  {uniqueKeys(bulk.transition?.targetStage, stageKeys).map((key) => (
                    <option key={key} value={key}>
                      {stageKeys.includes(key) ? key : `${key} (not on workflow)`}
                    </option>
                  ))}
                </select>
              </CatalogField>
            </CatalogSection>
            <details className="optic-designer-collapse">
              <summary>Eligibility</summary>
              <p className="optic-catalog-hint">Extra rules for which selected rows may run this bulk action.</p>
              <CatalogCheck
                label="Require unassigned or assigned to current user"
                hint="Skip rows owned by someone else."
                checked={Boolean(
                  bulk.eligibility &&
                    typeof bulk.eligibility === 'object' &&
                    (bulk.eligibility as { requireUnassignedOrAssignedToCurrentUser?: boolean })
                      .requireUnassignedOrAssignedToCurrentUser
                )}
                readOnly={readOnly}
                onChange={(checked) =>
                  replace({
                    ...bulk,
                    eligibility: {
                      ...eligibilityTreeOf(bulk.eligibility),
                      requireUnassignedOrAssignedToCurrentUser: checked
                    }
                  })
                }
              />
              <EligibilityEditor
                label="Bulk eligibility"
                value={eligibilityTreeOf(bulk.eligibility)}
                readOnly={readOnly}
                onChange={(tree) =>
                  replace({
                    ...bulk,
                    eligibility: {
                      ...tree,
                      requireUnassignedOrAssignedToCurrentUser: Boolean(
                        bulk.eligibility &&
                          typeof bulk.eligibility === 'object' &&
                          (bulk.eligibility as { requireUnassignedOrAssignedToCurrentUser?: boolean })
                            .requireUnassignedOrAssignedToCurrentUser
                      )
                    }
                  })
                }
              />
            </details>
            <details className="optic-designer-collapse">
              <summary>Shared input and mappings</summary>
              <p className="optic-catalog-hint">
                Optional form officers fill once for the whole selection, then writeMappings copy values onto each item.
              </p>
              <label className="optic-designer-json">
                Shared input schema
                <textarea
                  spellCheck={false}
                  value={schemaText}
                  disabled={readOnly}
                  onChange={(event) => {
                    try {
                      replace({
                        ...bulk,
                        sharedInputSchema: JSON.parse(
                          event.target.value
                        ) as BulkActionDefinition['sharedInputSchema']
                      });
                    } catch {
                      /* keep typing */
                    }
                  }}
                />
              </label>
              {(bulk.writeMappings ?? []).map((mapping, index) => (
                <div key={`map-${index}`} className="optic-designer-behavior">
                  <label>
                    Mapping source {index + 1}
                    <input
                      value={mapping.source}
                      disabled={readOnly}
                      onChange={(event) =>
                        replace({
                          ...bulk,
                          writeMappings: (bulk.writeMappings ?? []).map((item, itemIndex) =>
                            itemIndex === index ? { ...item, source: event.target.value } : item
                          )
                        })
                      }
                    />
                  </label>
                  <label>
                    Mapping target {index + 1}
                    <input
                      value={mapping.target}
                      disabled={readOnly}
                      onChange={(event) =>
                        replace({
                          ...bulk,
                          writeMappings: (bulk.writeMappings ?? []).map((item, itemIndex) =>
                            itemIndex === index ? { ...item, target: event.target.value } : item
                          )
                        })
                      }
                    />
                  </label>
                </div>
              ))}
              <button
                type="button"
                disabled={readOnly}
                onClick={() =>
                  replace({
                    ...bulk,
                    writeMappings: [...(bulk.writeMappings ?? []), { source: '$.field', target: '$.path' }]
                  })
                }
              >
                Add write mapping
              </button>
            </details>
            <div className="optic-catalog-footer">
              {onSave ? (
                <SaveDraftButton
                  dirty={dirty}
                  disabled={readOnly || collectBulkIssues(bulk).length > 0}
                  onClick={() => onSave(bulk)}
                />
              ) : null}
              <CatalogDeleteButton
                label="Bulk action"
                itemKey={bulk.bulkActionKey}
                readOnly={readOnly}
                onDelete={onDelete}
              />
            </div>
          </>
        ) : (
          <p className="optic-help">Select a bulk action on the left to edit it.</p>
        )}
      </CatalogItemBrowser>
    </CatalogKindView>
  );
}

function ScheduledEditor({
  scheduledActions,
  selectedKey,
  stageKeys,
  readOnly,
  savedScheduledActions,
  onSelect,
  onChange,
  onSave,
  onDelete
}: {
  scheduledActions: Record<string, ScheduledActionDefinition>;
  selectedKey: string;
  stageKeys: string[];
  readOnly?: boolean;
  savedScheduledActions?: Record<string, ScheduledActionDefinition>;
  onSelect: (key: string) => void;
  onChange: (scheduledActions: Record<string, ScheduledActionDefinition>) => void;
  onSave?: (scheduled: ScheduledActionDefinition) => void;
  onDelete?: (scheduledActionKey: string) => void;
}) {
  const scheduled = scheduledActions[selectedKey];
  const dirty = scheduled
    ? isDesignerDirty(scheduled, savedScheduledActions?.[scheduled.scheduledActionKey])
    : false;
  function replace(next: ScheduledActionDefinition) {
    const copy = { ...scheduledActions };
    if (next.scheduledActionKey !== selectedKey) {
      delete copy[selectedKey];
    }
    copy[next.scheduledActionKey] = next;
    onChange(copy);
    onSelect(next.scheduledActionKey);
  }
  function createScheduled() {
    const created = blankScheduledAction();
    onChange({ ...scheduledActions, [created.scheduledActionKey]: created });
    onSelect(created.scheduledActionKey);
  }
  const delay = scheduled?.delay ?? {};
  const duration = (delay.duration ?? {}) as Record<string, unknown>;
  return (
    <CatalogKindView kind="scheduled">
      <CatalogItemBrowser
        listLabel="Scheduled actions"
        items={Object.values(scheduledActions).map((item) => ({
          key: item.scheduledActionKey,
          title: item.scheduledActionKey,
          subtitle: String(item.trigger.stageKey ?? 'No stage')
        }))}
        selectedKey={selectedKey}
        onSelect={onSelect}
        onAdd={createScheduled}
        addLabel="Add scheduled action"
        emptyTitle="No scheduled actions yet"
        emptyHelp="Add a timer or nudge that fires after a Workflow stage is entered."
        readOnly={readOnly}
      >
        {scheduled ? (
          <>
            <CatalogSection
              title="Trigger"
              hint="Fires when a case enters the selected Workflow stage."
            >
              <CatalogField label="Scheduled action key" hint="Stable id for this timer or nudge.">
                <input
                  value={scheduled.scheduledActionKey}
                  disabled={readOnly}
                  onChange={(event) =>
                    replace({ ...scheduled, scheduledActionKey: event.target.value.toUpperCase() })
                  }
                />
              </CatalogField>
              <CatalogField label="Trigger stage" hint="Stage entry that starts the delay countdown.">
                <select
                  value={String(scheduled.trigger.stageKey ?? '')}
                  disabled={readOnly}
                  onChange={(event) =>
                    replace({
                      ...scheduled,
                      trigger: { ...scheduled.trigger, type: 'STAGE_ENTERED', stageKey: event.target.value }
                    })
                  }
                >
                  <option value="">None</option>
                  {uniqueKeys(String(scheduled.trigger.stageKey ?? ''), stageKeys).map((key) => (
                    <option key={key} value={key}>
                      {stageKeys.includes(key) ? key : `${key} (not on workflow)`}
                    </option>
                  ))}
                </select>
              </CatalogField>
              {stageKeys.length === 0 ? (
                <p className="optic-help">Add a stage on the Workflow tab, then pick it here.</p>
              ) : null}
            </CatalogSection>
            <CatalogSection title="Delay" hint="How long to wait after the trigger before the action runs.">
              <CatalogField
                label="Delay source"
                hint="CONFIG uses fixed hours/days; FIELD reads a date from the case."
              >
                <select
                  value={String(delay.source ?? 'CONFIG')}
                  disabled={readOnly}
                  onChange={(event) =>
                    replace({
                      ...scheduled,
                      delay:
                        event.target.value === 'FIELD'
                          ? { source: 'FIELD', path: '$.dueAt' }
                          : { source: 'CONFIG', duration: { hours: 24 } }
                    })
                  }
                >
                  <option value="CONFIG">CONFIG</option>
                  <option value="FIELD">FIELD</option>
                </select>
              </CatalogField>
              {delay.source === 'FIELD' ? (
                <CatalogField label="Delay path" hint="JSONPath to a date/time on the case (e.g. $.dueAt).">
                  <input
                    value={String(delay.path ?? delay.field ?? '')}
                    disabled={readOnly}
                    onChange={(event) =>
                      replace({ ...scheduled, delay: { ...delay, source: 'FIELD', path: event.target.value } })
                    }
                  />
                </CatalogField>
              ) : (
                <>
                  <CatalogField label="Delay hours" hint="Hours to wait after the trigger.">
                    <input
                      type="number"
                      value={Number(duration.hours ?? 0)}
                      disabled={readOnly}
                      onChange={(event) =>
                        replace({
                          ...scheduled,
                          delay: {
                            source: 'CONFIG',
                            duration: { ...duration, hours: Number(event.target.value) }
                          }
                        })
                      }
                    />
                  </CatalogField>
                  <CatalogField label="Delay days" hint="Extra whole days to wait (added to hours).">
                    <input
                      type="number"
                      value={Number(duration.days ?? 0)}
                      disabled={readOnly}
                      onChange={(event) =>
                        replace({
                          ...scheduled,
                          delay: {
                            source: 'CONFIG',
                            duration: { ...duration, days: Number(event.target.value) }
                          }
                        })
                      }
                    />
                  </CatalogField>
                </>
              )}
            </CatalogSection>
            <CatalogSection title="When it fires" hint="What to do when the delay elapses.">
              <CatalogField
                label="Action type"
                hint="NOTIFICATION alerts; TRANSITION moves the case to another stage."
              >
                <select
                  value={String(scheduled.action.type ?? 'NOTIFICATION')}
                  disabled={readOnly}
                  onChange={(event) =>
                    replace({
                      ...scheduled,
                      action:
                        event.target.value === 'TRANSITION'
                          ? { type: 'TRANSITION', targetStage: 'COMPLETED' }
                          : { type: 'NOTIFICATION' }
                    })
                  }
                >
                  <option value="NOTIFICATION">NOTIFICATION</option>
                  <option value="TRANSITION">TRANSITION</option>
                </select>
              </CatalogField>
              {scheduled.action.type === 'TRANSITION' ? (
                <CatalogField label="Target stage" hint="Stage to enter when the timer fires.">
                  <select
                    value={String(scheduled.action.targetStage ?? '')}
                    disabled={readOnly}
                    onChange={(event) =>
                      replace({ ...scheduled, action: { type: 'TRANSITION', targetStage: event.target.value } })
                    }
                  >
                    <option value="">None</option>
                    {uniqueKeys(String(scheduled.action.targetStage ?? ''), stageKeys).map((key) => (
                      <option key={key} value={key}>
                        {stageKeys.includes(key) ? key : `${key} (not on workflow)`}
                      </option>
                    ))}
                  </select>
                </CatalogField>
              ) : null}
              <CatalogCheck
                label="Cancel if stage changes"
                hint="Drop the pending timer if the case leaves the trigger stage early."
                checked={Boolean(scheduled.cancellation?.cancelIfStageChanges)}
                readOnly={readOnly}
                onChange={(checked) =>
                  replace({
                    ...scheduled,
                    cancellation: {
                      ...scheduled.cancellation,
                      cancelIfStageChanges: checked
                    }
                  })
                }
              />
              <CatalogField label="Retry max attempts" hint="How many times to retry a failed scheduled run.">
                <input
                  type="number"
                  value={Number(scheduled.retry?.maxAttempts ?? 5)}
                  disabled={readOnly}
                  onChange={(event) =>
                    replace({
                      ...scheduled,
                      retry: {
                        ...scheduled.retry,
                        maxAttempts: Number(event.target.value),
                        backoff: 'EXPONENTIAL'
                      }
                    })
                  }
                />
              </CatalogField>
            </CatalogSection>
            <div className="optic-catalog-footer">
              {onSave ? (
                <SaveDraftButton
                  dirty={dirty}
                  disabled={readOnly || collectScheduledIssues(scheduled).length > 0}
                  onClick={() => onSave(scheduled)}
                />
              ) : null}
              <CatalogDeleteButton
                label="Scheduled action"
                itemKey={scheduled.scheduledActionKey}
                readOnly={readOnly}
                onDelete={onDelete}
              />
            </div>
          </>
        ) : (
          <p className="optic-help">Select a scheduled action on the left to edit it.</p>
        )}
      </CatalogItemBrowser>
    </CatalogKindView>
  );
}

function uniqueKeys(...groups: Array<string | undefined | readonly string[]>): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const group of groups) {
    const items = Array.isArray(group) ? group : group ? [group] : [];
    for (const item of items) {
      if (!item || seen.has(item)) {
        continue;
      }
      seen.add(item);
      keys.push(item);
    }
  }
  return keys;
}
