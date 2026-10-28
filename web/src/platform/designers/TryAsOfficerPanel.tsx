import { useEffect, useMemo, useState } from 'react';
import type {
  ActionDefinition,
  QueueDefinition,
  SlaDefinition,
  StageFormDefinition,
  WorkflowDefinition
} from '../../../../src/modules/configuration/domain/types.js';
import type { DemoQueueRow } from '../queues/demo-queue.js';
import { QueueScreen } from '../queues/QueueScreen.js';
import { buildDraftCase, isDraftCase } from '../workspace/draft-case.js';
import { OfficerCasePane } from '../workspace/OfficerCasePane.js';
import {
  resolveCaughtError,
  retainFormErrorsAfterEdit,
  type DisplayError
} from '../api/apply-api-error.js';
import type { FormFieldError } from '../dynamic-forms/DynamicFormRenderer.js';
import { useFeatureFlags } from '../features/FeatureFlagsContext.js';
import { CaughtErrorBanner } from '../ui/CaughtErrorBanner.js';
import { ButtonLabel } from '../ui/Icon.js';
import { StatusToast } from '../ui/StatusToast.js';
import { WorkingAsField } from '../actors/WorkingAsField.js';
import { getCurrentOfficerId, OFFICER_ACTOR_ID, setCurrentOfficerId } from '../actors/demo-officers.js';
import {
  isOfficerWorkQueue,
  isSystemOfficerQueue,
  isTerminalStage,
  itemsInQueue,
  listOfficerQueues,
  nextTrackingId,
  queueForStage,
  SYSTEM_QUEUE_COMPLETED,
  trialQueuePage
} from './try-queue.js';
import {
  assignWorkflow,
  createWorkflowInstance,
  executeWorkflowAction,
  getWorkflowSummary,
  listWorkflowInstances,
  reassignWorkflow,
  releaseWorkflow,
  type WorkflowQueueItem,
  type WorkflowSummary
} from './workflow-api.js';

export function TryAsOfficerPanel({
  definitionKey,
  version,
  entityType,
  workflow,
  queues,
  forms,
  actions,
  slas,
  enabled,
  errorSummary,
  onError
}: {
  definitionKey: string;
  version: string;
  entityType: string;
  workflow: WorkflowDefinition;
  queues: Record<string, QueueDefinition>;
  forms: Record<string, StageFormDefinition>;
  actions?: Record<string, ActionDefinition>;
  slas?: Record<string, SlaDefinition>;
  enabled: boolean;
  errorSummary?: DisplayError;
  onError: (message: DisplayError | undefined) => void;
}) {
  const { isEnabled } = useFeatureFlags();
  const actorOverrideEnabled = isEnabled('ui.workspace.actor_override');
  const [items, setItems] = useState<WorkflowQueueItem[]>([]);
  const [selectedQueueKey, setSelectedQueueKey] = useState<string | undefined>();
  const [working, setWorking] = useState<WorkflowSummary | undefined>();
  const [busy, setBusy] = useState(false);
  const [actorId, setActorId] = useState(getCurrentOfficerId);
  const [formFieldErrors, setFormFieldErrors] = useState<FormFieldError[]>([]);
  const [statusToast, setStatusToast] = useState<string | undefined>();

  useEffect(() => {
    if (actorOverrideEnabled) {
      return;
    }
    setActorId(OFFICER_ACTOR_ID);
    setCurrentOfficerId(OFFICER_ACTOR_ID);
  }, [actorOverrideEnabled]);

  function clearTryErrors() {
    setFormFieldErrors([]);
    onError(undefined);
  }

  function applyTryError(error: unknown) {
    const resolved = resolveCaughtError(error, 'The trial desk request failed.');
    setFormFieldErrors(resolved.formErrors);
    onError(resolved.banner);
  }

  function chooseOfficer(next: string) {
    setActorId(next);
    setCurrentOfficerId(next);
  }

  const officerQueues = useMemo(
    () => listOfficerQueues(workflow, queues, entityType),
    [entityType, queues, workflow]
  );

  useEffect(() => {
    setItems([]);
    setSelectedQueueKey(undefined);
    setWorking(undefined);
  }, [definitionKey, version]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    setBusy(true);
    listWorkflowInstances(definitionKey, version)
      .then((page) => {
        if (cancelled) {
          return;
        }
        setItems(page.items);
        clearTryErrors();
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          applyTryError(error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [definitionKey, enabled, onError, version]);

  useEffect(() => {
    if (selectedQueueKey && officerQueues.some((queue) => queue.queueKey === selectedQueueKey)) {
      return;
    }
    const workQueues = officerQueues.filter((queue) => isOfficerWorkQueue(queue.queueKey));
    const withItems = workQueues.find(
      (queue) => itemsInQueue(queue, workflow, items, actorId).length > 0
    );
    setSelectedQueueKey((withItems ?? workQueues[0])?.queueKey);
  }, [actorId, items, officerQueues, selectedQueueKey, workflow]);

  const selectedQueue = officerQueues.find((queue) => queue.queueKey === selectedQueueKey);
  const queueItems = selectedQueue ? itemsInQueue(selectedQueue, workflow, items, actorId) : [];
  const queuePage = selectedQueue
    ? trialQueuePage(selectedQueue, queueItems, definitionKey, version, workflow, 1, {}, actorId, slas)
    : undefined;
  const showWork = Boolean(working);

  async function refreshItems(): Promise<WorkflowQueueItem[]> {
    const page = await listWorkflowInstances(definitionKey, version);
    setItems(page.items);
    return page.items;
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      clearTryErrors();
      await work();
    } catch (error: unknown) {
      applyTryError(error);
    } finally {
      setBusy(false);
    }
  }

  function openQueue(queueKey: string) {
    setSelectedQueueKey(queueKey);
    setWorking(undefined);
  }

  async function arriveNewWork() {
    setWorking(
      buildDraftCase({
        trackingId: nextTrackingId(entityType),
        entityType,
        definitionKey,
        version,
        workflow,
        forms,
        actions
      })
    );
  }

  async function ensurePersisted(summary: WorkflowSummary): Promise<WorkflowSummary> {
    if (!isDraftCase(summary)) {
      return summary;
    }
    const created = await createWorkflowInstance({
      entityType: summary.entityType,
      entityTrackingId: summary.trackingId,
      definitionKey,
      version
    });
    await refreshItems();
    return created;
  }

  async function assignRow(row: DemoQueueRow) {
    await run(async () => {
      const next = await assignWorkflow(row.entityType, row.trackingId, row.rowVersion);
      await refreshItems();
      setWorking(next);
    });
  }

  async function assignWorking() {
    if (!working) {
      return;
    }
    await run(async () => {
      const base = await ensurePersisted(working);
      const next = await assignWorkflow(base.entityType, base.trackingId, base.workflow.rowVersion);
      await refreshItems();
      setWorking(next);
    });
  }

  async function openRow(row: DemoQueueRow) {
    await run(async () => {
      setWorking(await getWorkflowSummary(row.entityType, row.trackingId));
    });
  }

  async function reassignRow(row: DemoQueueRow, assignedTo: string) {
    await run(async () => {
      await reassignWorkflow(row.entityType, row.trackingId, row.rowVersion, assignedTo);
      await refreshItems();
      setWorking(undefined);
    });
  }

  async function releaseRow(row: DemoQueueRow) {
    await run(async () => {
      await releaseWorkflow(row.entityType, row.trackingId, row.rowVersion);
      await refreshItems();
      setWorking(undefined);
    });
  }

  async function releaseWorking() {
    if (!working) {
      return;
    }
    if (isDraftCase(working)) {
      setWorking(undefined);
      return;
    }
    await run(async () => {
      await releaseWorkflow(
        working.entityType,
        working.trackingId,
        working.workflow.rowVersion,
        working.workflow.assignedTo ?? undefined
      );
      await refreshItems();
      setWorking(undefined);
    });
  }

  async function completeAction(actionKey: string, dataPatch?: Record<string, unknown>) {
    if (!working) {
      return;
    }
    await run(async () => {
      const base = await ensurePersisted(working);
      const next = await executeWorkflowAction(
        base.entityType,
        base.trackingId,
        actionKey,
        base.workflow.rowVersion,
        dataPatch
      );
      await refreshItems();
      const stage = next.workflow.currentStageLabel || next.workflow.currentStageKey;
      setStatusToast(
        actionKey.toUpperCase().includes('SAVE') ? 'Draft saved' : `Moved to ${stage}`
      );
      if (isTerminalStage(workflow, next)) {
        setSelectedQueueKey(SYSTEM_QUEUE_COMPLETED);
        setWorking(next);
        return;
      }
      if (!selectedQueueKey || !isSystemOfficerQueue(selectedQueueKey)) {
        const destination = queueForStage(workflow, queues, next);
        if (destination) {
          setSelectedQueueKey(destination.queueKey);
        }
      }
      setWorking(undefined);
    });
  }

  return (
    <section className="optic-designer optic-try-panel" aria-labelledby="try-officer-heading">
      <header className="optic-try-header">
        <div className="optic-try-header-main">
          <h1 id="try-officer-heading">Try as officer</h1>
          <details className="optic-try-help">
            <summary>How Try works</summary>
            <p className="optic-help">
              Uses the <strong>saved</strong> draft. Open a queue, pick an item, assign or open it, then Complete to move
              it. Finished cases land in <strong>Completed</strong> (read-only). Save Form, Workflow, and Catalog first.
              On mail, Complete can spawn workloads from the repeating section.
            </p>
          </details>
        </div>
        <div className="optic-try-toolbar" role="group" aria-label="Try desk tools">
          <button
            type="button"
            className="optic-button-primary"
            disabled={!enabled || busy}
            onClick={() => void arriveNewWork()}
          >
            <ButtonLabel icon="live">New work arrives</ButtonLabel>
          </button>
          <WorkingAsField
            label="Signed in as"
            value={actorId}
            onChange={chooseOfficer}
            readOnly={!actorOverrideEnabled}
          />
        </div>
      </header>
      <CaughtErrorBanner error={formFieldErrors.length > 0 ? undefined : errorSummary} />
      <StatusToast message={statusToast} onDismiss={() => setStatusToast(undefined)} />
      {!enabled ? (
        <p className="optic-help" role="status">
          Open or create a draft first. Try uses the saved release, not unsaved canvas edits.
        </p>
      ) : null}
      <div className="optic-try-desk">
        {officerQueues.length > 0 ? (
          <nav className="optic-designer-view-toggle optic-try-queue-nav" aria-label="Officer queues">
            {officerQueues.map((queue) => {
              const count = itemsInQueue(queue, workflow, items, actorId).length;
              return (
                <button
                  key={queue.queueKey}
                  type="button"
                  aria-current={queue.queueKey === selectedQueueKey && !showWork ? 'page' : undefined}
                  aria-pressed={queue.queueKey === selectedQueueKey}
                  disabled={busy}
                  onClick={() => openQueue(queue.queueKey)}
                >
                  {queue.displayName}
                  <span className="optic-count-badge">{count}</span>
                </button>
              );
            })}
          </nav>
        ) : (
          <p className="optic-help" role="status">
            No officer queues yet. Give each live stage a Catalog queue and save.
          </p>
        )}
        {showWork && working ? (
          <OfficerCasePane
            working={working}
            workflow={workflow}
            forms={forms}
            busy={busy}
            formErrors={formFieldErrors}
            onFormEdit={(previous, next) => {
              if (formFieldErrors.length === 0) {
                return;
              }
              setFormFieldErrors((current) => retainFormErrorsAfterEdit(current, previous, next));
            }}
            onComplete={(actionKey, dataPatch) => void completeAction(actionKey, dataPatch)}
            onAssign={() => void assignWorking()}
            onRelease={() => void releaseWorking()}
            onClose={() => {
              clearTryErrors();
              setWorking(undefined);
            }}
          />
        ) : queuePage ? (
          <QueueScreen
            queue={queuePage}
            actorId={actorId}
            headingLevel={2}
            onAssign={(row) => void assignRow(row)}
            onOpen={(row) => void openRow(row)}
            onRelease={(row) => void releaseRow(row)}
            onReassign={(row, assignedTo) => void reassignRow(row, assignedTo)}
          />
        ) : null}
      </div>
    </section>
  );
}
