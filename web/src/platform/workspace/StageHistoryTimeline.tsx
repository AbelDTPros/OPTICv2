import type { WorkflowDefinition } from '../../../../src/modules/configuration/domain/types.js';
import { officerDisplayName } from '../actors/demo-officers.js';
import { stageForKey } from '../designers/try-queue.js';
import type { WorkflowSummary } from '../designers/workflow-api.js';

type Visit = WorkflowSummary['visits'][number];

export function StageHistoryTimeline({
  visits,
  workflow,
  currentStageKey,
  jumpableStageKeys = [],
  onSelectStage
}: {
  visits: Visit[];
  workflow?: WorkflowDefinition;
  currentStageKey: string;
  jumpableStageKeys?: string[];
  onSelectStage?: (stageKey: string) => void;
}) {
  if (visits.length === 0) {
    return null;
  }

  const jumpable = new Set(jumpableStageKeys);

  return (
    <details className="optic-case-secondary optic-stage-timeline">
      <summary>
        Stage history ({visits.length})
        <span className="optic-stage-timeline-summary-hint">
          Who, when, and where this case has been
        </span>
      </summary>
      <p className="optic-help optic-stage-timeline-help">
        Open a completed step to view that earlier screen.
      </p>
      <ol className="optic-stage-timeline-list">
        {visits.map((visit, index) => {
          const officer = visitOfficerLabel(visit);
          const title = stageDisplayName(workflow, visit.stageKey);
          const isCurrent =
            !visit.completedAt && !visit.nextStageKey && visit.stageKey === currentStageKey;
          const state = isCurrent ? 'current' : visit.completedAt || visit.nextStageKey ? 'done' : 'open';
          const canJump = Boolean(onSelectStage) && jumpable.has(visit.stageKey);
          const meta = [
            visit.visitNumber > 1 ? `Pass ${visit.visitNumber}` : null,
            stateLabel(state),
            officer,
            formatVisitWhen(visit)
          ]
            .filter(Boolean)
            .join(' · ');

          const body = (
            <>
              <span className="optic-stage-timeline-marker" aria-hidden="true" />
              <span className="optic-stage-timeline-copy">
                <strong className="optic-stage-timeline-title">{title}</strong>
                <span className="optic-stage-timeline-meta">{meta}</span>
                {visit.nextStageKey ? (
                  <span className="optic-stage-timeline-next">
                    Moved to {stageDisplayName(workflow, visit.nextStageKey)}
                  </span>
                ) : null}
                {canJump ? (
                  <span className="optic-stage-timeline-jump-hint">View screen</span>
                ) : null}
              </span>
            </>
          );

          return (
            <li
              key={`${visit.stageKey}-${visit.visitNumber}-${index}`}
              className="optic-stage-timeline-item"
              data-state={state}
            >
              {canJump ? (
                <button
                  type="button"
                  className="optic-stage-timeline-card"
                  onClick={() => onSelectStage?.(visit.stageKey)}
                >
                  {body}
                </button>
              ) : (
                <div className="optic-stage-timeline-card" role="group">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function stateLabel(state: 'current' | 'done' | 'open'): string {
  if (state === 'current') {
    return 'Current';
  }
  if (state === 'done') {
    return 'Completed';
  }
  return 'Open';
}

function visitOfficerLabel(visit: Visit): string | null {
  const actorId = visit.completedBy?.trim() || visit.assignedTo?.trim() || visit.enteredBy?.trim();
  return actorId ? officerDisplayName(actorId) : null;
}

function formatVisitWhen(visit: Visit): string | null {
  const stamp = visit.completedAt || visit.enteredAt;
  if (!stamp) {
    return null;
  }
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
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
