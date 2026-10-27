import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { assignmentPermissions } from '../../../../src/modules/configuration/domain/assignment-policy.js';
import { applyFillFromToBusinessData } from '../../../../src/modules/configuration/domain/fill-from.js';
import type { StageFormDefinition, WorkflowDefinition } from '../../../../src/modules/configuration/domain/types.js';
import { stageDataPatchFromCase } from '../../../../src/modules/workflow/domain/merge-patch.js';
import { DynamicFormRenderer } from '../dynamic-forms/DynamicFormRenderer.js';
import { ButtonLabel, Icon, StatusPill } from '../ui/Icon.js';
import { isTerminalStage, journeyStageTabs, stageForKey, visitedFormScreens } from '../designers/try-queue.js';
import { officerDisplayName } from '../actors/demo-officers.js';
import { type WorkflowSummary } from '../designers/workflow-api.js';
import { ReassignDialog } from '../queues/ReassignDialog.js';
import { LabelSticker, qrSvgForPayload } from './LabelSticker.js';
import { labelsForPacket, printLabels } from './labels.js';

export function OfficerCasePane({
  working,
  workflow,
  forms = {},
  busy,
  onComplete,
  onAssign,
  onReassign,
  onRelease,
  onClose
}: {
  working: WorkflowSummary;
  workflow?: WorkflowDefinition;
  forms?: Record<string, StageFormDefinition>;
  busy: boolean;
  onComplete: (actionKey: string, dataPatch?: Record<string, unknown>) => void;
  onAssign?: () => void;
  onReassign?: (assignedTo: string) => void;
  onRelease: () => void;
  onClose: () => void;
}) {
  const [formValue, setFormValue] = useState<unknown>({});
  const [reassigning, setReassigning] = useState(false);
  const caseWorkflow = working.workflowDefinition ?? workflow;
  const finished = caseWorkflow ? isTerminalStage(caseWorkflow, working) : working.status === 'COMPLETED';
  const permissions =
    working.assignmentPermissions ??
    assignmentPermissions(
      caseWorkflow ? stageForKey(caseWorkflow, working.workflow.currentStageKey) : undefined,
      working.status
    );
  const completeActions = working.allowedActions.filter((action) => action.actionKey !== 'RELEASE_ASSIGNMENT');

  useEffect(() => {
    if (!working.stageForm) {
      setFormValue({});
      return;
    }
    setFormValue(
      applyFillFromToBusinessData(
        working.stageForm.ui,
        working.businessData ?? {},
        working.workflow.assignedTo
      )
    );
  }, [
    working.stageForm,
    working.trackingId,
    working.workflow.assignedTo,
    working.workflow.currentStageKey,
    working.workflow.rowVersion
  ]);

  function dataPatch(): Record<string, unknown> | undefined {
    if (!working.stageForm) {
      return undefined;
    }
    const stamped = applyFillFromToBusinessData(
      working.stageForm.ui,
      formValue !== null && typeof formValue === 'object' && !Array.isArray(formValue)
        ? (formValue as Record<string, unknown>)
        : {},
      working.workflow.assignedTo
    );
    return stageDataPatchFromCase(stamped, working.stageForm.dataPath || '$', working.entityType);
  }

  return (
    <div className="optic-workspace-case">
      <header className="optic-case-header">
        <div className="optic-case-identity">
          <h2 className="optic-case-title">{working.workflow.currentStageLabel}</h2>
          <p className="optic-case-tracking">{working.trackingId}</p>
        </div>
        <div
          className={`optic-case-ownership${working.workflow.assignedTo ? ' is-assigned' : ' is-unassigned'}`}
          role="status"
          aria-label="Case status"
        >
          <span className="optic-case-ownership-assignment">
            <Icon name={working.workflow.assignedTo ? 'user' : 'assign'} />
            {working.workflow.assignedTo ? (
              <>
                <span className="optic-case-ownership-label">Assigned to</span>
                <strong className="optic-case-ownership-officer">
                  {officerDisplayName(working.workflow.assignedTo)}
                </strong>
              </>
            ) : (
              <strong className="optic-case-ownership-officer">Unassigned</strong>
            )}
          </span>
          <StatusPill>{working.status}</StatusPill>
        </div>
        {permissions.allowAssign || permissions.allowReassign || permissions.allowRelease ? (
          <div className="optic-case-assignment-bar" role="group" aria-label="Assignment">
            {permissions.allowAssign && onAssign ? (
              <button
                type="button"
                className={
                  working.workflow.assignedTo ? 'optic-case-action-quiet' : 'optic-button-primary'
                }
                disabled={busy || Boolean(working.workflow.assignedTo)}
                aria-label="Assign to me"
                title="Assign this case to yourself"
                onClick={onAssign}
              >
                <ButtonLabel icon="assign">Assign</ButtonLabel>
              </button>
            ) : null}
            {permissions.allowRelease ? (
              <button
                type="button"
                className="optic-case-action-quiet"
                disabled={busy || !working.workflow.assignedTo}
                aria-label="Release"
                title="Release back to the queue"
                onClick={onRelease}
              >
                <ButtonLabel icon="release">Release</ButtonLabel>
              </button>
            ) : null}
            {permissions.allowReassign && onReassign ? (
              <button
                type="button"
                className="optic-case-action-quiet"
                disabled={busy}
                aria-label="Reassign"
                title="Reassign to another officer"
                onClick={() => setReassigning(true)}
              >
                <ButtonLabel icon="reassign">Reassign</ButtonLabel>
              </button>
            ) : null}
          </div>
        ) : null}
        {working.packet?.parent ? (
          <p className="optic-case-callout">
            Linked mail item <strong>{working.packet.parent.trackingId}</strong> — open a mail screen below for intake
            data.
          </p>
        ) : working.entityType === 'WORKLOAD' ? (
          <p className="optic-case-callout optic-case-callout-muted">
            Not linked to a mail item. Complete Doc Prep on the mail packet that lists this tracking number to attach it.
          </p>
        ) : null}
        {finished ? (
          <p className="optic-case-callout optic-case-callout-muted">
            This case reached a terminal stage. Earlier screens stay available read-only.
          </p>
        ) : null}
        {reassigning && onReassign ? (
          <ReassignDialog
            trackingId={working.trackingId}
            onCancel={() => setReassigning(false)}
            onConfirm={(assignedTo) => {
              onReassign(assignedTo);
              setReassigning(false);
            }}
          />
        ) : null}
      </header>

      <div className="optic-case-body">
        <OfficerStageScreens
          working={working}
          workflow={caseWorkflow}
          forms={forms}
          formValue={formValue}
          finished={finished}
          onFormChange={finished ? () => undefined : setFormValue}
        />

        {working.visits.length > 0 ? (
          <details className="optic-case-secondary">
            <summary>Stage history ({working.visits.length})</summary>
            <ol className="optic-try-visits">
              {working.visits.map((visit) => {
                const officer = visitOfficerLabel(visit);
                return (
                  <li key={`${visit.stageKey}-${visit.visitNumber}`}>
                    {formatStageHistoryRow(visit, caseWorkflow)}
                    {officer ? ` · ${officer}` : ''}
                  </li>
                );
              })}
            </ol>
          </details>
        ) : null}

        <details className="optic-case-secondary optic-case-labels">
          <summary>Labels</summary>
          <p className="optic-help">
            Print a sticker for this case
            {working.packet?.parent || (working.packet?.children?.length ?? 0) > 0
              ? ', the mail item, and each workload in the packet'
              : ''}
            .
          </p>
          <div className="optic-sticker-row">
            {labelsForPacket(working).map((label) => (
              <LabelSticker key={`${label.entityType}:${label.trackingId}`} label={label} />
            ))}
          </div>
        </details>
      </div>

      <footer className="optic-case-action-bar" role="toolbar" aria-label="Case actions">
        <div className="optic-case-action-primary">
          {!finished
            ? completeActions.map((action) => (
                <button
                  key={action.actionKey}
                  type="button"
                  className="optic-button-primary"
                  disabled={busy}
                  onClick={() => onComplete(action.actionKey, dataPatch())}
                >
                  <ButtonLabel icon="check">{action.label}</ButtonLabel>
                </button>
              ))
            : null}
        </div>
        <div className="optic-case-action-tools">
          <div className="optic-case-action-cluster" role="group" aria-label="Case tools">
            <button
              type="button"
              className="optic-case-action-quiet"
              disabled={busy}
              aria-label="Print labels"
              title="Print case labels"
              onClick={() => void printCaseLabels(working)}
            >
              <ButtonLabel icon="print">Print labels</ButtonLabel>
            </button>
            <button
              type="button"
              className="optic-case-action-quiet optic-case-action-back"
              disabled={busy}
              aria-label="Back to queues"
              onClick={onClose}
            >
              <ButtonLabel icon="queue">Queues</ButtonLabel>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function OfficerStageScreens({
  working,
  workflow,
  forms = {},
  formValue,
  finished,
  onFormChange
}: {
  working: WorkflowSummary;
  workflow?: WorkflowDefinition;
  forms?: Record<string, StageFormDefinition>;
  formValue: unknown;
  finished: boolean;
  onFormChange: (value: unknown) => void;
}) {
  const ownWorkflow = working.workflowDefinition ?? workflow;
  const ownForms = working.forms && Object.keys(working.forms).length > 0 ? working.forms : forms;
  const ownTabs = useMemo(
    () =>
      ownWorkflow
        ? journeyStageTabs(
            ownWorkflow,
            ownForms,
            working.visits,
            working.workflow.currentStageKey,
            working.workflow.currentStageLabel
          )
        : [],
    [ownForms, ownWorkflow, working]
  );
  const parent = working.packet?.parent;
  const parentScreens = useMemo(() => {
    if (!parent) {
      return [];
    }
    const parentWorkflow = parent.workflowDefinition;
    const parentForms = parent.forms ?? {};
    if (!parentWorkflow) {
      return [];
    }
    return visitedFormScreens(parentWorkflow, parentForms, parent.visits);
  }, [parent]);
  const currentStageKey = working.workflow.currentStageKey;
  const lastOwnStageKey = ownTabs.at(-1)?.stageKey;
  const [screenKey, setScreenKey] = useState(() =>
    finished ? lastOwnStageKey ?? currentStageKey : currentStageKey
  );
  const selectedTabRef = useRef<HTMLButtonElement | null>(null);
  const viewingOwn = ownTabs.find((tab) => tab.stageKey === screenKey);
  const viewingPacket = parentScreens.find((screen) => screenKey === packetScreenKey(screen.stageKey));
  const viewingCurrentForm = Boolean(
    viewingOwn && viewingOwn.stageKey === currentStageKey && working.stageForm && !viewingPacket
  );

  useLayoutEffect(() => {
    if (ownTabs.length > 0) {
      setScreenKey(finished ? lastOwnStageKey ?? currentStageKey : currentStageKey);
      return;
    }
    if (parentScreens[0]) {
      setScreenKey(packetScreenKey(parentScreens[0].stageKey));
    }
  }, [
    currentStageKey,
    finished,
    lastOwnStageKey,
    ownTabs.length,
    parentScreens,
    working.trackingId,
    working.workflow.rowVersion
  ]);

  useEffect(() => {
    if (!finished) {
      return;
    }
    selectedTabRef.current?.focus();
  }, [finished, screenKey, working.trackingId]);

  const hasOwnScreens = ownTabs.length > 0;
  const packetRef = parent?.trackingId ?? '';

  return (
    <section className="optic-stage-journey">
      {hasOwnScreens || (parent && parentScreens.length > 0) ? (
        <div className="optic-stage-lanes">
          {hasOwnScreens ? (
            <div className="optic-stage-lane">
              <p className="optic-stage-lane-label">This case</p>
              <nav className="optic-try-screens optic-stage-tabs" aria-label="Stage screens">
                {ownTabs.map((tab) => (
                  <button
                    key={tab.stageKey}
                    ref={tab.stageKey === screenKey && !viewingPacket ? selectedTabRef : undefined}
                    type="button"
                    className="optic-stage-tab"
                    data-kind={tab.isCurrent ? 'current' : 'prior'}
                    aria-pressed={screenKey === tab.stageKey && !viewingPacket}
                    onClick={() => setScreenKey(tab.stageKey)}
                  >
                    <span className="optic-stage-tab-name">{tab.displayName}</span>
                    <span className="optic-stage-tab-note" aria-hidden="true">
                      {tab.isCurrent ? 'Current' : 'Earlier'}
                    </span>
                  </button>
                ))}
              </nav>
            </div>
          ) : null}
          {parent && parentScreens.length > 0 ? (
            <div className="optic-stage-lane optic-stage-lane-mail">
              <p className="optic-stage-lane-label">
                Mail item <span className="optic-stage-lane-ref-inline">{packetRef}</span>
              </p>
              <nav className="optic-try-screens optic-stage-tabs" aria-label="Mail item screens">
                {parentScreens.map((screen) => (
                  <button
                    key={packetScreenKey(screen.stageKey)}
                    type="button"
                    className="optic-stage-tab"
                    data-kind="mail"
                    aria-pressed={screenKey === packetScreenKey(screen.stageKey)}
                    onClick={() => setScreenKey(packetScreenKey(screen.stageKey))}
                  >
                    <span className="optic-stage-tab-name">{screen.displayName}</span>
                    <span className="optic-stage-tab-note" aria-hidden="true">
                      Intake
                    </span>
                  </button>
                ))}
              </nav>
            </div>
          ) : null}
        </div>
      ) : null}
      {viewingPacket && parent ? (
        <>
          <p className="optic-help optic-case-readonly" role="status">
            Read-only. This is the {viewingPacket.displayName} screen from mail item {parent.trackingId}.
          </p>
          <div className="optic-case-canvas">
            <DynamicFormRenderer
              form={viewingPacket.form}
              schema={viewingPacket.form.schema}
              value={parent.businessData}
              businessData={parent.businessData}
              releaseForms={parent.forms ?? forms}
              workflowContext={{
                currentStageKey: parent.workflow.currentStageKey,
                assignedTo: parent.workflow.assignedTo,
                trackingId: parent.trackingId,
                entityType: parent.entityType
              }}
              headingLevel={2}
              readOnly
              onChange={() => undefined}
            />
          </div>
        </>
      ) : viewingCurrentForm && working.stageForm ? (
        <div className="optic-case-canvas">
          <DynamicFormRenderer
            form={working.stageForm.ui}
            schema={working.stageForm.schema}
            value={formValue}
            businessData={formValue}
            releaseForms={ownForms}
            workflowContext={{
              currentStageKey: working.workflow.currentStageKey,
              assignedTo: working.workflow.assignedTo,
              trackingId: working.trackingId,
              entityType: working.entityType
            }}
            headingLevel={2}
            readOnly={finished}
            onChange={finished ? () => undefined : onFormChange}
          />
        </div>
      ) : viewingOwn?.form ? (
        <>
          <p className="optic-help optic-case-readonly" role="status">
            Read-only. This is the {viewingOwn.displayName} screen using the data stored on this case.
          </p>
          <div className="optic-case-canvas">
            <DynamicFormRenderer
              form={viewingOwn.form}
              schema={viewingOwn.form.schema}
              value={working.businessData}
              businessData={working.businessData}
              releaseForms={ownForms}
              workflowContext={{
                currentStageKey: working.workflow.currentStageKey,
                assignedTo: working.workflow.assignedTo,
                trackingId: working.trackingId,
                entityType: working.entityType
              }}
              headingLevel={2}
              readOnly
              onChange={() => undefined}
            />
          </div>
        </>
      ) : (
        <p className="optic-help optic-case-empty">
          This stage has no form. Use an action to move on, or open an earlier screen.
        </p>
      )}
    </section>
  );
}

function visitOfficerLabel(visit: WorkflowSummary['visits'][number]): string | null {
  const actorId = visit.completedBy?.trim() || visit.assignedTo?.trim() || visit.enteredBy?.trim();
  return actorId ? officerDisplayName(actorId) : null;
}

function formatStageHistoryRow(
  visit: WorkflowSummary['visits'][number],
  workflow?: WorkflowDefinition
): string {
  const from = stageDisplayName(workflow, visit.stageKey);
  const pass = visit.visitNumber > 1 ? `Pass ${visit.visitNumber} · ` : '';
  if (visit.nextStageKey) {
    return `${pass}${from} → ${stageDisplayName(workflow, visit.nextStageKey)}`;
  }
  if (visit.completedAt) {
    return `${pass}${from} (closed)`;
  }
  return `${pass}${from} (open)`;
}

function stageDisplayName(workflow: WorkflowDefinition | undefined, stageKey: string): string {
  const labeled = workflow ? stageForKey(workflow, stageKey)?.displayName?.trim() : '';
  if (labeled && labeled !== stageKey) {
    return labeled;
  }
  return stageKey
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function packetScreenKey(stageKey: string): string {
  return `packet:${stageKey}`;
}

async function printCaseLabels(working: WorkflowSummary): Promise<void> {
  try {
    const labels = labelsForPacket(working);
    const qrByPayload: Record<string, string> = {};
    await Promise.all(
      labels.map(async (label) => {
        qrByPayload[label.payload] = await qrSvgForPayload(label.payload);
      })
    );
    printLabels(labels, qrByPayload);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Print labels failed. Try again or check pop-up settings.';
    window.alert(message);
  }
}
