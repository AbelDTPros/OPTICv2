import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  assignmentPermissions,
  resolveAssignmentPolicy
} from '../../../../src/modules/configuration/domain/assignment-policy.js';
import type {
  ScheduledActionDefinition,
  StageDefinition,
  StageFormDefinition,
  TransitionRule,
  WorkflowDefinition
} from '../../../../src/modules/configuration/domain/types.js';
import { DesignerErrorBody, ErrorSummary } from '../ui/ErrorSummary.js';
import { ButtonLabel } from '../ui/Icon.js';
import { emptyPredicate, RuleExpressionEditor, summarizeRuleExpression } from './RuleExpressionEditor.js';
import { SaveDraftButton } from './SaveDraftButton.js';
import {
  addStage,
  addTransitionSet,
  arrangeStageLayouts,
  attachOutboundTransitions,
  collectWorkflowIssues,
  connectStages,
  edgeSelectionLabel,
  layoutEdges,
  listEdges,
  listRulePathOptions,
  moveStage,
  nudgeStageLayout,
  outboundBinding,
  removeStage,
  removeTransitionSet,
  reorderRulePriority,
  rulePriorityRank,
  STAGE_NODE_HEIGHT,
  STAGE_NODE_WIDTH,
  stageLayout,
  transitionSetCatalogHolders,
  updateStage,
  updateTransitionSet,
  type LaidOutEdge,
  type WorkflowCatalog,
  type WorkflowEdge
} from './workflow-model.js';

const NUDGE = 16;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.12;

type CanvasSelection =
  | { type: 'stage'; stageKey: string }
  | {
      type: 'edge';
      stageKey: string;
      kind: 'default' | 'rule' | 'timer';
      transitionSetKey?: string;
      ruleKey?: string;
      scheduledActionKey?: string;
    };

function selectionForEdge(edge: WorkflowEdge): Extract<CanvasSelection, { type: 'edge' }> {
  return {
    type: 'edge',
    stageKey: edge.from,
    kind: edge.kind,
    transitionSetKey: edge.transitionSetKey,
    ruleKey: edge.ruleKey,
    scheduledActionKey: edge.scheduledActionKey
  };
}

function edgeMatchesSelection(
  edge: WorkflowEdge,
  selection: Extract<CanvasSelection, { type: 'edge' }>
): boolean {
  if (edge.kind !== selection.kind || edge.from !== selection.stageKey) {
    return false;
  }
  if (edge.kind === 'timer') {
    return edge.scheduledActionKey === selection.scheduledActionKey;
  }
  return (
    edge.transitionSetKey === selection.transitionSetKey &&
    (edge.kind === 'default' || edge.ruleKey === selection.ruleKey)
  );
}

export interface WorkflowDesignerProps {
  workflow: WorkflowDefinition;
  catalog?: WorkflowCatalog;
  forms?: Record<string, StageFormDefinition>;
  scheduledActions?: Record<string, ScheduledActionDefinition>;
  readOnly?: boolean;
  errorSummary?: string;
  onChange: (workflow: WorkflowDefinition) => void;
  onScheduledActionsChange?: (scheduledActions: Record<string, ScheduledActionDefinition>) => void;
  onDetachTransitionSet?: (removedKey: string, replacementKey?: string) => void;
  onSave?: () => void;
  /** True when workflow (or linked scheduled/action transition edits) differ from the saved release. */
  dirty?: boolean;
}

export function WorkflowDesigner({
  workflow,
  catalog = {},
  forms = {},
  scheduledActions = {},
  readOnly,
  errorSummary,
  onChange,
  onScheduledActionsChange,
  onDetachTransitionSet,
  onSave,
  dirty = true
}: WorkflowDesignerProps) {
  const stages = useMemo(
    () => [...workflow.stages].sort((left, right) => left.order - right.order),
    [workflow.stages]
  );
  const [selection, setSelection] = useState<CanvasSelection | null>(
    stages[0] ? { type: 'stage', stageKey: stages[0].stageKey } : null
  );
  const selectedKey = selection?.stageKey;
  const selected = stages.find((stage) => stage.stageKey === selectedKey);
  const selectedEdge =
    selection?.type === 'edge'
      ? listEdges(workflow, catalog).find((edge) => edgeMatchesSelection(edge, selection))
      : undefined;
  const pathOptions = useMemo(() => listRulePathOptions(forms), [forms]);
  const issues = useMemo(() => collectWorkflowIssues(workflow, catalog), [workflow, catalog]);
  const dragRef = useRef<{
    stageKey: string;
    originX: number;
    originY: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
  } | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const [dragLayout, setDragLayout] = useState<{ stageKey: string; x: number; y: number } | null>(null);
  const [connectDrag, setConnectDrag] = useState<{
    fromStageKey: string;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    hoverStageKey?: string;
  } | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [spacePan, setSpacePan] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const stagesForCanvas = useMemo(() => {
    if (!dragLayout) {
      return stages;
    }
    return stages.map((stage) =>
      stage.stageKey === dragLayout.stageKey
        ? { ...stage, layout: { x: dragLayout.x, y: dragLayout.y } }
        : stage
    );
  }, [dragLayout, stages]);
  const laidOutEdges = useMemo(
    () => offsetCollidingEdgeLabels(layoutEdges(workflow, catalog, stagesForCanvas)),
    [workflow, catalog, stagesForCanvas]
  );

  useEffect(() => {
    if (!selection) {
      return;
    }
    if (selection.type === 'stage') {
      // Do not remap a missing stage key to stages[0]. Add/rename updates selection
      // before the parent workflow prop arrives; remapping steals focus from the
      // stage being edited and leaves the canvas stuck on "New stage".
      if (stages.length === 0) {
        setSelection(null);
      }
      return;
    }
    if (!listEdges(workflow, catalog).some((edge) => edgeMatchesSelection(edge, selection))) {
      setSelection(
        stages.some((stage) => stage.stageKey === selection.stageKey)
          ? { type: 'stage', stageKey: selection.stageKey }
          : stages[0]
            ? { type: 'stage', stageKey: stages[0].stageKey }
            : null
      );
    }
  }, [catalog, selection, stages, workflow]);

  const canvas = useMemo(() => {
    const positions = stagesForCanvas.map((stage, index) => stageLayout(stage, index));
    const contentWidth = Math.max(
      720,
      ...positions.map((point) => point.x + STAGE_NODE_WIDTH + 56),
      ...laidOutEdges.map((edge) => edge.right + 40)
    );
    const contentHeight = Math.max(
      320,
      ...positions.map((point) => point.y + STAGE_NODE_HEIGHT + 56),
      ...laidOutEdges.map((edge) => edge.bottom + 40)
    );
    const padLeft = Math.max(0, ...positions.map((point) => -point.x), ...laidOutEdges.map((edge) => -edge.left));
    const padTop = Math.max(0, ...positions.map((point) => -point.y), ...laidOutEdges.map((edge) => -edge.top));
    return {
      width: contentWidth + padLeft,
      height: contentHeight + padTop,
      padLeft,
      padTop
    };
  }, [stagesForCanvas, laidOutEdges]);

  useEffect(() => {
    return () => {
      if (dragRafRef.current != null) {
        cancelAnimationFrame(dragRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== 'Space' && event.key !== 'Escape') {
        return;
      }
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      if (event.key === 'Escape') {
        if (connectDrag) {
          event.preventDefault();
          setConnectDrag(null);
        }
        return;
      }
      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault();
        setSpacePan(true);
      }
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.code === 'Space') {
        setSpacePan(false);
        setIsPanning(false);
        panRef.current = null;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [connectDrag]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) {
      return;
    }
    function onWheel(event: WheelEvent) {
      if (!graphRef.current?.contains(event.target as Node)) {
        return;
      }
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const direction = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        zoomBy(direction, event.clientX, event.clientY);
        return;
      }
      setViewport((current) => ({
        ...current,
        x: current.x - event.deltaX,
        y: current.y - event.deltaY
      }));
    }
    graph.addEventListener('wheel', onWheel, { passive: false });
    return () => graph.removeEventListener('wheel', onWheel);
  }, []);

  function selectStage(stageKey: string) {
    setSelection({ type: 'stage', stageKey });
  }

  function selectEdge(edge: WorkflowEdge) {
    setSelection(selectionForEdge(edge));
  }

  function addAndSelectStage() {
    if (readOnly) {
      return;
    }
    const next = addStage(workflow, catalog);
    const added = next.stages[next.stages.length - 1];
    onChange(next);
    if (added) {
      selectStage(added.stageKey);
    }
  }

  function applyConnection(fromStageKey: string, toStageKey: string, mode?: 'rule' | 'default') {
    if (readOnly || fromStageKey === toStageKey) {
      return;
    }
    const result = connectStages(workflow, fromStageKey, toStageKey, catalog, { mode });
    onChange(result.workflow);
    if (result.edge) {
      selectEdge(result.edge);
    } else {
      selectStage(fromStageKey);
    }
  }

  function scenePoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = sceneRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: clientX, y: clientY };
    }
    const zoom = viewportRef.current.zoom || 1;
    return {
      x: (clientX - rect.left) / zoom,
      y: (clientY - rect.top) / zoom
    };
  }

  function clampZoom(zoom: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));
  }

  function zoomBy(delta: number, clientX?: number, clientY?: number) {
    setViewport((current) => {
      const nextZoom = clampZoom(current.zoom + delta);
      if (nextZoom === current.zoom) {
        return current;
      }
      const graph = graphRef.current?.getBoundingClientRect();
      if (!graph || clientX == null || clientY == null) {
        return { ...current, zoom: nextZoom };
      }
      const anchorX = clientX - graph.left;
      const anchorY = clientY - graph.top;
      const worldX = (anchorX - current.x) / current.zoom;
      const worldY = (anchorY - current.y) / current.zoom;
      return {
        zoom: nextZoom,
        x: anchorX - worldX * nextZoom,
        y: anchorY - worldY * nextZoom
      };
    });
  }

  function resetViewport() {
    setViewport({ x: 0, y: 0, zoom: 1 });
  }

  function stageAtPoint(clientX: number, clientY: number): string | undefined {
    const point = scenePoint(clientX, clientY);
    for (const [index, stage] of stagesForCanvas.entries()) {
      const layout = stageLayout(stage, index);
      const left = layout.x + canvas.padLeft;
      const top = layout.y + canvas.padTop;
      if (
        point.x >= left &&
        point.x <= left + STAGE_NODE_WIDTH &&
        point.y >= top &&
        point.y <= top + STAGE_NODE_HEIGHT
      ) {
        return stage.stageKey;
      }
    }
    return undefined;
  }

  const connectHelpersRef = useRef({ scenePoint, stageAtPoint, applyConnection });
  connectHelpersRef.current = { scenePoint, stageAtPoint, applyConnection };

  useEffect(() => {
    if (!connectDrag) {
      return;
    }
    function onMove(event: PointerEvent) {
      const helpers = connectHelpersRef.current;
      const hoverStageKey = helpers.stageAtPoint(event.clientX, event.clientY);
      const point = helpers.scenePoint(event.clientX, event.clientY);
      setConnectDrag((current) =>
        current
          ? {
              ...current,
              currentX: point.x,
              currentY: point.y,
              hoverStageKey:
                hoverStageKey && hoverStageKey !== current.fromStageKey ? hoverStageKey : undefined
            }
          : null
      );
    }
    function onUp(event: PointerEvent) {
      const helpers = connectHelpersRef.current;
      const fromStageKey = connectDrag.fromStageKey;
      const hoverStageKey = helpers.stageAtPoint(event.clientX, event.clientY);
      setConnectDrag(null);
      if (hoverStageKey && hoverStageKey !== fromStageKey) {
        helpers.applyConnection(fromStageKey, hoverStageKey);
      }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [connectDrag]);

  function deleteStage(stageKey: string) {
    if (readOnly) {
      return;
    }
    const index = stages.findIndex((stage) => stage.stageKey === stageKey);
    if (index < 0) {
      return;
    }
    const fallback = stages[index + 1] ?? stages[index - 1];
    onChange(removeStage(workflow, stageKey));
    setSelection(fallback ? { type: 'stage', stageKey: fallback.stageKey } : null);
  }

  function deleteSelectedEdge() {
    if (readOnly || !selectedEdge) {
      return;
    }
    removeSelectedConnection(selectedEdge);
  }

  function removeSelectedConnection(edge: WorkflowEdge) {
    if (edge.kind === 'timer') {
      if (!edge.scheduledActionKey || !onScheduledActionsChange) {
        return;
      }
      const scheduled = scheduledActions[edge.scheduledActionKey];
      if (!scheduled) {
        return;
      }
      onScheduledActionsChange({
        ...scheduledActions,
        [edge.scheduledActionKey]: {
          ...scheduled,
          action: { type: 'NOTIFICATION' }
        }
      });
      setSelection({ type: 'stage', stageKey: edge.from });
      return;
    }
    onChange(removeEdge(workflow, edge));
    setSelection({ type: 'stage', stageKey: edge.from });
  }

  useEffect(() => {
    if (readOnly || !selection) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      if (selection?.type === 'edge') {
        const edge = listEdges(workflow, catalog).find((item) =>
          edgeMatchesSelection(item, selection)
        );
        if (!edge) {
          return;
        }
        event.preventDefault();
        removeSelectedConnection(edge);
        return;
      }
      if (selection?.type === 'stage') {
        event.preventDefault();
        deleteStage(selection.stageKey);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  return (
    <section className="optic-designer" aria-labelledby="workflow-designer-heading">
      <header className="optic-designer-header">
        <div>
          <h1 id="workflow-designer-heading">Workflow designer</h1>
          <p className="optic-form-key">Initial stage {workflow.initialStageKey || 'not set'}</p>
        </div>
        <div className="optic-designer-header-tools optic-designer-toolbar-tools">
          <div className="optic-designer-header-actions" role="group" aria-label="Workflow tools">
            <button
              type="button"
              disabled={readOnly}
              title="Add a stage to the canvas"
              onClick={addAndSelectStage}
            >
              <ButtonLabel icon="designer">Add stage</ButtonLabel>
            </button>
            <button
              type="button"
              disabled={readOnly || stages.length === 0}
              title="Arrange stages left-to-right along the workflow path"
              onClick={() => onChange(arrangeStageLayouts(workflow, catalog))}
            >
              <ButtonLabel icon="generate">Arrange stages</ButtonLabel>
            </button>
            <button
              type="button"
              disabled={readOnly}
              title="Add a transition set for Complete paths and rules"
              onClick={() => onChange(addTransitionSet(workflow))}
            >
              <ButtonLabel icon="draft">Add transition set</ButtonLabel>
            </button>
          </div>
          {onSave ? <SaveDraftButton dirty={dirty} disabled={readOnly} onClick={onSave} /> : null}
        </div>
      </header>

      {errorSummary || issues.length > 0 ? (
        <ErrorSummary
          role={errorSummary ? 'alert' : 'status'}
          focus={Boolean(errorSummary)}
          heading={issues.length > 0 ? 'Validation' : undefined}
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

      <div className="optic-designer-panes" data-layout="workflow">
        <div className="optic-designer-canvas optic-workflow-canvas" role="region" aria-labelledby="workflow-stages-heading">
          <div className="optic-workflow-canvas-heading">
            <h2 id="workflow-stages-heading">Stages</h2>
            <div className="optic-workflow-canvas-tools" role="group" aria-label="Canvas view">
              <button type="button" onClick={() => zoomBy(-ZOOM_STEP)} title="Zoom out">
                −
              </button>
              <button type="button" onClick={resetViewport} title="Reset view">
                {Math.round(viewport.zoom * 100)}%
              </button>
              <button type="button" onClick={() => zoomBy(ZOOM_STEP)} title="Zoom in">
                +
              </button>
              <details className="optic-workflow-tips">
                <summary>Canvas tips</summary>
                <p className="optic-help">
                  Drag empty canvas to pan · Scroll to pan · Ctrl/⌘+scroll to zoom · Space+drag or middle-click also
                  pans · Esc cancels a connection drag. Drag a node (or arrow keys) for layout only. Execution order is
                  Properties → Move earlier / later. Drag + to connect stages. Dashed = default; numbered = rules;
                  dotted = timers.
                </p>
              </details>
            </div>
          </div>
          <div
            ref={graphRef}
            className="optic-workflow-graph"
            data-dragging={dragLayout ? 'true' : undefined}
            data-panning={isPanning || spacePan ? 'true' : undefined}
            onPointerDown={(event) => {
              if (connectDrag) {
                return;
              }
              const middleClick = event.button === 1;
              const spaceDrag = event.button === 0 && spacePan;
              const backgroundDrag =
                event.button === 0 && !spacePan && isWorkflowCanvasBackground(event.target);
              if (!middleClick && !spaceDrag && !backgroundDrag) {
                return;
              }
              event.preventDefault();
              (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
              panRef.current = {
                startX: event.clientX,
                startY: event.clientY,
                originX: viewport.x,
                originY: viewport.y
              };
              setIsPanning(true);
            }}
            onPointerMove={(event) => {
              const pan = panRef.current;
              if (!pan) {
                return;
              }
              setViewport({
                ...viewportRef.current,
                x: pan.originX + (event.clientX - pan.startX),
                y: pan.originY + (event.clientY - pan.startY)
              });
            }}
            onPointerUp={() => {
              panRef.current = null;
              setIsPanning(false);
            }}
            onPointerCancel={() => {
              panRef.current = null;
              setIsPanning(false);
            }}
          >
            <div
              className="optic-workflow-viewport"
              style={{
                transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
                transformOrigin: '0 0'
              }}
            >
            <div
              ref={sceneRef}
              className="optic-workflow-scene"
              style={{ width: canvas.width, height: canvas.height }}
              data-connecting={connectDrag ? 'true' : undefined}
            >
            {stages.length === 0 ? (
              <div className="optic-workflow-empty" role="status">
                <p>
                  <strong>Build the path officers follow</strong>
                </p>
                <p className="optic-help">Add a stage, then drag + to connect the next one.</p>
                <button
                  type="button"
                  className="optic-button-primary"
                  disabled={readOnly}
                  onClick={addAndSelectStage}
                >
                  <ButtonLabel icon="designer">Add your first stage</ButtonLabel>
                </button>
              </div>
            ) : null}
            {stagesForCanvas.map((stage, index) => {
              const position = stageLayout(stage, index);
              const isDropTarget =
                connectDrag?.hoverStageKey === stage.stageKey &&
                connectDrag.fromStageKey !== stage.stageKey;
              const isConnectSource = connectDrag?.fromStageKey === stage.stageKey;
              const isValidTarget =
                Boolean(connectDrag) && !isConnectSource && stage.stageKey !== connectDrag?.fromStageKey;
              const isDragging = dragLayout?.stageKey === stage.stageKey;
              const actionCount = stage.actionKeys?.length ?? 0;
              return (
                <div
                  key={stage.stageKey}
                  className="optic-workflow-node-wrap"
                  style={{ left: position.x + canvas.padLeft, top: position.y + canvas.padTop }}
                  data-drop-target={isDropTarget ? 'true' : undefined}
                  data-valid-target={isValidTarget ? 'true' : undefined}
                  data-connect-source={isConnectSource ? 'true' : undefined}
                  data-dragging={isDragging ? 'true' : undefined}
                >
                  <button
                    type="button"
                    className="optic-workflow-node"
                    data-terminal={stage.terminal ? 'true' : undefined}
                    data-initial={workflow.initialStageKey === stage.stageKey ? 'true' : undefined}
                    data-selected={selection?.type === 'stage' && stage.stageKey === selectedKey ? 'true' : undefined}
                    aria-pressed={selection?.type === 'stage' && stage.stageKey === selectedKey}
                    aria-label={`Stage ${stage.displayName}`}
                    onClick={() => selectStage(stage.stageKey)}
                    onKeyDown={(event) => {
                      if (readOnly) {
                        return;
                      }
                      const delta =
                        event.key === 'ArrowLeft'
                          ? { x: -NUDGE, y: 0 }
                          : event.key === 'ArrowRight'
                            ? { x: NUDGE, y: 0 }
                            : event.key === 'ArrowUp'
                              ? { x: 0, y: -NUDGE }
                              : event.key === 'ArrowDown'
                                ? { x: 0, y: NUDGE }
                                : undefined;
                      if (!delta) {
                        return;
                      }
                      event.preventDefault();
                      selectStage(stage.stageKey);
                      onChange(nudgeStageLayout(workflow, stage.stageKey, delta));
                    }}
                    onPointerDown={(event) => {
                      if (readOnly || connectDrag || spacePan || event.button === 1) {
                        return;
                      }
                      const layout = stageLayout(stage, index);
                      event.currentTarget.setPointerCapture?.(event.pointerId);
                      dragRef.current = {
                        stageKey: stage.stageKey,
                        originX: layout.x,
                        originY: layout.y,
                        startX: event.clientX,
                        startY: event.clientY,
                        lastX: layout.x,
                        lastY: layout.y
                      };
                      setDragLayout({ stageKey: stage.stageKey, x: layout.x, y: layout.y });
                    }}
                    onPointerMove={(event) => {
                      const drag = dragRef.current;
                      if (!drag || drag.stageKey !== stage.stageKey) {
                        return;
                      }
                      const zoom = viewportRef.current.zoom || 1;
                      const x = Math.max(0, drag.originX + (event.clientX - drag.startX) / zoom);
                      const y = Math.max(0, drag.originY + (event.clientY - drag.startY) / zoom);
                      drag.lastX = x;
                      drag.lastY = y;
                      if (dragRafRef.current != null) {
                        cancelAnimationFrame(dragRafRef.current);
                      }
                      dragRafRef.current = requestAnimationFrame(() => {
                        dragRafRef.current = null;
                        setDragLayout({ stageKey: drag.stageKey, x: drag.lastX, y: drag.lastY });
                      });
                    }}
                    onPointerUp={() => {
                      const drag = dragRef.current;
                      dragRef.current = null;
                      if (dragRafRef.current != null) {
                        cancelAnimationFrame(dragRafRef.current);
                        dragRafRef.current = null;
                      }
                      if (drag) {
                        onChange(
                          updateStage(workflow, drag.stageKey, {
                            layout: { x: drag.lastX, y: drag.lastY }
                          })
                        );
                      }
                      setDragLayout(null);
                    }}
                    onPointerCancel={() => {
                      dragRef.current = null;
                      if (dragRafRef.current != null) {
                        cancelAnimationFrame(dragRafRef.current);
                        dragRafRef.current = null;
                      }
                      setDragLayout(null);
                    }}
                  >
                    <span className="optic-workflow-node-badges">
                      <span className="optic-workflow-stage-index" aria-hidden="true">
                        {index + 1}
                      </span>
                      {workflow.initialStageKey === stage.stageKey ? (
                        <span className="optic-workflow-node-pill">Start</span>
                      ) : null}
                      {stage.terminal ? <span className="optic-workflow-node-pill">End</span> : null}
                    </span>
                    <strong>{stage.displayName}</strong>
                    <span className="optic-form-key">{stage.formKey || 'No form'}</span>
                    <span className="optic-workflow-node-meta">
                      {stage.queueKey ? `Queue ${shortKey(stage.queueKey)}` : 'No queue'}
                      {' · '}
                      {actionCount} action{actionCount === 1 ? '' : 's'}
                    </span>
                  </button>
                  {!stage.terminal && !readOnly ? (
                    <button
                      type="button"
                      className="optic-workflow-connect-handle"
                      aria-label={`Connect from ${stage.displayName}`}
                      title="Drag to another stage to connect"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        selectStage(stage.stageKey);
                        const point = scenePoint(event.clientX, event.clientY);
                        setConnectDrag({
                          fromStageKey: stage.stageKey,
                          startX: position.x + canvas.padLeft + STAGE_NODE_WIDTH,
                          startY: position.y + canvas.padTop + STAGE_NODE_HEIGHT / 2,
                          currentX: point.x,
                          currentY: point.y
                        });
                      }}
                    >
                      +
                    </button>
                  ) : null}
                </div>
              );
            })}
            <svg
              className="optic-workflow-edges"
              width={canvas.width}
              height={canvas.height}
              viewBox={`0 0 ${canvas.width} ${canvas.height}`}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="optic-workflow-arrow"
                  markerUnits="userSpaceOnUse"
                  markerWidth="12"
                  markerHeight="10"
                  refX="10"
                  refY="5"
                  orient="auto"
                >
                  <path d="M0,0 L10,5 L0,10 Z" />
                </marker>
                <marker
                  id="optic-workflow-arrow-selected"
                  markerUnits="userSpaceOnUse"
                  markerWidth="12"
                  markerHeight="10"
                  refX="10"
                  refY="5"
                  orient="auto"
                >
                  <path d="M0,0 L10,5 L0,10 Z" />
                </marker>
              </defs>
              <g transform={`translate(${canvas.padLeft} ${canvas.padTop})`}>
                {laidOutEdges.map((edge) => {
                  const selected =
                    selection?.type === 'edge' ? edgeMatchesSelection(edge, selection) : false;
                  return (
                    <g
                      key={edge.edgeId}
                      data-kind={edge.kind}
                      data-selected={selected ? 'true' : undefined}
                    >
                      <path
                        d={edge.d}
                        markerEnd={selected ? 'url(#optic-workflow-arrow-selected)' : 'url(#optic-workflow-arrow)'}
                      />
                    </g>
                  );
                })}
              </g>
              {connectDrag ? (
                <path
                  className="optic-workflow-connect-preview"
                  d={connectPreviewPath(
                    connectDrag.startX,
                    connectDrag.startY,
                    connectDrag.currentX,
                    connectDrag.currentY
                  )}
                />
              ) : null}
            </svg>
            {laidOutEdges.map((edge) => {
              const selected =
                selection?.type === 'edge' ? edgeMatchesSelection(edge, selection) : false;
              const chipLabel =
                edge.kind === 'rule' && typeof edge.priority === 'number'
                  ? `${edge.priority}. ${edge.label}`
                  : edge.kind === 'timer'
                    ? `timer · ${edge.delaySummary ?? 'timer'} · ${edge.label}`
                    : edge.label;
              const fullLabel = edgeSelectionLabel(edge, workflow);
              return (
                <button
                  key={`hit-${edge.edgeId}`}
                  type="button"
                  className="optic-workflow-edge-hit"
                  style={{
                    left: edge.labelX + canvas.padLeft,
                    top: edge.labelY + canvas.padTop
                  }}
                  data-kind={edge.kind}
                  data-selected={selected ? 'true' : undefined}
                  aria-pressed={selected}
                  aria-label={fullLabel}
                  title={fullLabel}
                  onClick={() => selectEdge(edge)}
                >
                  {chipLabel}
                </button>
              );
            })}
            </div>
            </div>
          </div>
        </div>

        <TransitionSetsEditor
          workflow={workflow}
          catalog={catalog}
          selectedStageKey={selectedKey}
          readOnly={readOnly}
          pathOptions={pathOptions}
          onChange={onChange}
          onDetachTransitionSet={onDetachTransitionSet}
        />

        <aside className="optic-designer-properties" aria-label={selectedEdge ? 'Connection properties' : 'Stage properties'}>
          <h2>{selectedEdge ? 'Connection' : 'Properties'}</h2>
          {selectedEdge ? (
            <EdgeProperties
              workflow={workflow}
              edge={selectedEdge}
              catalog={catalog}
              scheduledActions={scheduledActions}
              readOnly={readOnly}
              pathOptions={pathOptions}
              onChange={onChange}
              onScheduledActionsChange={onScheduledActionsChange}
              onRemove={deleteSelectedEdge}
              onSelectStage={selectStage}
              onSelectEdge={selectEdge}
            />
          ) : selected ? (
            <StageProperties
              workflow={workflow}
              stage={selected}
              catalog={catalog}
              readOnly={readOnly}
              onChange={onChange}
              onSelectKey={selectStage}
              onRemove={() => deleteStage(selected.stageKey)}
              onConnect={(toStageKey, mode) => applyConnection(selected.stageKey, toStageKey, mode)}
            />
          ) : (
            <p>Select a stage or an arrow to edit. Stable keys stay in this panel; canvas labels stay friendly.</p>
          )}
        </aside>
      </div>
    </section>
  );
}

function StageProperties({
  workflow,
  stage,
  catalog,
  readOnly,
  onChange,
  onSelectKey,
  onRemove,
  onConnect
}: {
  workflow: WorkflowDefinition;
  stage: StageDefinition;
  catalog: WorkflowCatalog;
  readOnly?: boolean;
  onChange: (workflow: WorkflowDefinition) => void;
  onSelectKey: (stageKey: string) => void;
  onRemove: () => void;
  onConnect: (toStageKey: string, mode?: 'rule' | 'default') => void;
}) {
  const [connectTargetKey, setConnectTargetKey] = useState('');
  const [section, setSection] = useState<'identity' | 'routing' | 'assignment' | 'sequence'>('identity');
  const connectTargets = useMemo(
    () =>
      [...workflow.stages]
        .filter((item) => item.stageKey !== stage.stageKey)
        .sort((left, right) => left.order - right.order),
    [workflow.stages, stage.stageKey]
  );

  useEffect(() => {
    setSection('identity');
  }, [stage.stageKey]);

  useEffect(() => {
    if (!connectTargets.some((item) => item.stageKey === connectTargetKey)) {
      setConnectTargetKey(connectTargets[0]?.stageKey ?? '');
    }
  }, [connectTargetKey, connectTargets]);

  function patch(next: Partial<StageDefinition>) {
    onChange(updateStage(workflow, stage.stageKey, next));
    if (next.stageKey !== undefined && next.stageKey !== stage.stageKey) {
      onSelectKey(next.stageKey);
    }
  }

  const scheduled = catalog.scheduledByStage?.[stage.stageKey] ?? [];
  const actionLabels = Object.fromEntries(
    Object.entries(catalog.actions ?? {}).map(([key, action]) => [key, action.label])
  );
  const orderedStages = useMemo(
    () => [...workflow.stages].sort((left, right) => left.order - right.order),
    [workflow.stages]
  );
  const sequenceIndex = orderedStages.findIndex((item) => item.stageKey === stage.stageKey);
  const earlierStage = sequenceIndex > 0 ? orderedStages[sequenceIndex - 1] : undefined;
  const laterStage =
    sequenceIndex >= 0 && sequenceIndex < orderedStages.length - 1
      ? orderedStages[sequenceIndex + 1]
      : undefined;

  return (
    <>
      <div className="optic-workflow-properties-header">
        <p className="optic-workflow-properties-title">{stage.displayName}</p>
        <button
          type="button"
          className="optic-designer-quiet-button"
          disabled={readOnly}
          title="Delete (Del)"
          aria-label={`Remove ${stage.displayName}`}
          onClick={onRemove}
        >
          <ButtonLabel icon="trash">Remove</ButtonLabel>
        </button>
      </div>
      <div className="optic-workflow-prop-tabs" role="tablist" aria-label="Stage property sections">
        {(
          [
            ['identity', 'Identity'],
            ['routing', 'Routing'],
            ['assignment', 'Assign'],
            ['sequence', 'Order']
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={section === key}
            data-active={section === key ? 'true' : undefined}
            onClick={() => setSection(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {section === 'identity' ? (
        <div className="optic-workflow-prop-panel" role="tabpanel">
          <label>
            Stage key
            <input
              value={stage.stageKey}
              disabled={readOnly}
              onChange={(event) => patch({ stageKey: event.target.value.toUpperCase() })}
            />
          </label>
          <label>
            Display name
            <input
              value={stage.displayName}
              disabled={readOnly}
              onChange={(event) => patch({ displayName: event.target.value })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={workflow.initialStageKey === stage.stageKey}
              disabled={readOnly}
              onChange={() => onChange({ ...workflow, initialStageKey: stage.stageKey })}
            />
            Initial stage
          </label>
          <label>
            <input
              type="checkbox"
              checked={Boolean(stage.terminal)}
              disabled={readOnly}
              onChange={(event) => patch({ terminal: event.target.checked })}
            />
            Terminal
          </label>
        </div>
      ) : null}

      {section === 'routing' ? (
        <div className="optic-workflow-prop-panel" role="tabpanel">
          <CatalogSelect
            label="Form"
            value={stage.formKey}
            options={catalog.forms ?? []}
            emptyHelp="Save a form on the Form tab first, then pick it here."
            readOnly={readOnly}
            onChange={(formKey) => patch({ formKey })}
          />
          <CatalogSelect
            label="Queue"
            value={stage.queueKey}
            options={catalog.queues ?? []}
            emptyHelp="Save a queue in Catalog first, then pick it here."
            readOnly={readOnly}
            onChange={(queueKey) => patch({ queueKey })}
          />
          <CatalogSelect
            label="SLA"
            value={stage.slaKey}
            options={catalog.slas ?? []}
            emptyHelp="Save an SLA in Catalog first, then pick it here. Optional."
            readOnly={readOnly}
            onChange={(slaKey) => patch({ slaKey })}
          />
          <KeyChecklist
            legend="Actions"
            selected={stage.actionKeys}
            options={Object.keys(catalog.actions ?? {})}
            labels={actionLabels}
            emptyHelp="Save actions in Catalog first, then check the ones this stage should offer."
            readOnly={readOnly}
            onChange={(actionKeys) => patch({ actionKeys })}
          />
          <KeyChecklist
            legend="Bulk actions"
            selected={stage.bulkActionKeys ?? []}
            options={catalog.bulkActions ?? []}
            emptyHelp="Save bulk actions in Catalog first, then check the ones this stage should offer."
            readOnly={readOnly}
            onChange={(bulkActionKeys) =>
              patch({ bulkActionKeys: bulkActionKeys.length > 0 ? bulkActionKeys : undefined })
            }
          />
          <p className="optic-help">
            Scheduled: {scheduled.length > 0 ? scheduled.join(', ') : 'none on this release'}
          </p>
          {!stage.terminal ? (
            <fieldset className="optic-workflow-connect-fieldset">
              <legend>Connect to</legend>
              <label>
                Target stage
                <select
                  value={connectTargetKey}
                  disabled={readOnly || connectTargets.length === 0}
                  onChange={(event) => setConnectTargetKey(event.target.value)}
                >
                  {connectTargets.length === 0 ? <option value="">No other stages</option> : null}
                  {connectTargets.map((item) => (
                    <option key={item.stageKey} value={item.stageKey}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <div className="optic-designer-field-actions">
                <button
                  type="button"
                  disabled={readOnly || !connectTargetKey}
                  onClick={() => onConnect(connectTargetKey)}
                >
                  Connect
                </button>
                <button
                  type="button"
                  disabled={readOnly || !connectTargetKey}
                  onClick={() => onConnect(connectTargetKey, 'default')}
                >
                  Default
                </button>
                <button
                  type="button"
                  disabled={readOnly || !connectTargetKey}
                  onClick={() => onConnect(connectTargetKey, 'rule')}
                >
                  As rule
                </button>
              </div>
            </fieldset>
          ) : null}
        </div>
      ) : null}

      {section === 'assignment' ? (
        <div className="optic-workflow-prop-panel" role="tabpanel">
          <label>
            <input
              type="checkbox"
              checked={stage.assignmentPolicy.required}
              disabled={readOnly}
              onChange={(event) =>
                patch({
                  assignmentPolicy: resolveAssignmentPolicy(stage, { required: event.target.checked })
                })
              }
            />
            Assignment required
          </label>
          <label>
            <input
              type="checkbox"
              checked={assignmentPermissions(stage).allowAssign}
              disabled={readOnly}
              onChange={(event) =>
                patch({
                  assignmentPolicy: resolveAssignmentPolicy(stage, { allowAssign: event.target.checked })
                })
              }
            />
            Allow assign
          </label>
          <label>
            <input
              type="checkbox"
              checked={assignmentPermissions(stage).allowReassign}
              disabled={readOnly}
              onChange={(event) =>
                patch({
                  assignmentPolicy: resolveAssignmentPolicy(stage, { allowReassign: event.target.checked })
                })
              }
            />
            Allow reassign
          </label>
          <label>
            <input
              type="checkbox"
              checked={assignmentPermissions(stage).allowRelease}
              disabled={readOnly}
              onChange={(event) =>
                patch({
                  assignmentPolicy: resolveAssignmentPolicy(stage, { allowRelease: event.target.checked })
                })
              }
            />
            Allow release
          </label>
          <p className="optic-help">
            Assign and reassign default off on a terminal stage if you leave them blank. Release defaults on.
          </p>
        </div>
      ) : null}

      {section === 'sequence' ? (
        <div className="optic-workflow-prop-panel optic-workflow-stage-sequence" role="tabpanel">
          <p>
            <strong>Stage sequence</strong> {sequenceIndex + 1} of {orderedStages.length}
            {typeof stage.order === 'number' ? <> (order {stage.order})</> : null}
          </p>
          <p className="optic-help">
            {earlierStage ? `After ${earlierStage.displayName}. ` : 'First in sequence. '}
            {laterStage ? `Before ${laterStage.displayName}.` : 'Last in sequence.'} Canvas position is layout only.
          </p>
          <ol className="optic-workflow-stage-sequence-list">
            {orderedStages.map((item) => (
              <li key={item.stageKey} data-current={item.stageKey === stage.stageKey ? 'true' : undefined}>
                {item.displayName}
                {item.formKey ? ` · ${item.formKey}` : ''}
              </li>
            ))}
          </ol>
          <div className="optic-designer-field-actions">
            <button
              type="button"
              disabled={readOnly || sequenceIndex <= 0}
              onClick={() => onChange(moveStage(workflow, stage.stageKey, -1))}
            >
              Move earlier
            </button>
            <button
              type="button"
              disabled={readOnly || sequenceIndex < 0 || sequenceIndex >= orderedStages.length - 1}
              onClick={() => onChange(moveStage(workflow, stage.stageKey, 1))}
            >
              Move later
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function EdgeProperties({
  workflow,
  edge,
  catalog,
  scheduledActions,
  readOnly,
  pathOptions,
  onChange,
  onScheduledActionsChange,
  onRemove,
  onSelectStage,
  onSelectEdge
}: {
  workflow: WorkflowDefinition;
  edge: WorkflowEdge;
  catalog: WorkflowCatalog;
  scheduledActions: Record<string, ScheduledActionDefinition>;
  readOnly?: boolean;
  pathOptions: ReturnType<typeof listRulePathOptions>;
  onChange: (workflow: WorkflowDefinition) => void;
  onScheduledActionsChange?: (scheduledActions: Record<string, ScheduledActionDefinition>) => void;
  onRemove: () => void;
  onSelectStage: (stageKey: string) => void;
  onSelectEdge: (edge: WorkflowEdge) => void;
}) {
  const set = edge.transitionSetKey
    ? workflow.transitionSets.find((item) => item.transitionSetKey === edge.transitionSetKey)
    : undefined;
  const ruleIndex =
    edge.kind === 'rule' ? set?.rules.findIndex((rule) => rule.ruleKey === edge.ruleKey) ?? -1 : -1;
  const rule = ruleIndex >= 0 ? set?.rules[ruleIndex] : undefined;
  const from =
    workflow.stages.find((stage) => stage.stageKey === edge.from)?.displayName ?? edge.from;
  const fromStage = workflow.stages.find((stage) => stage.stageKey === edge.from);
  const binding = fromStage
    ? outboundBinding(workflow, fromStage, catalog)
    : ({ kind: 'none' } as const);
  const scheduled =
    edge.kind === 'timer' && edge.scheduledActionKey
      ? scheduledActions[edge.scheduledActionKey]
      : undefined;
  const delay = scheduled?.delay ?? {};
  const duration = (delay.duration ?? {}) as Record<string, unknown>;

  function patchScheduled(next: ScheduledActionDefinition) {
    if (!onScheduledActionsChange || !edge.scheduledActionKey) {
      return;
    }
    const copy = { ...scheduledActions };
    if (next.scheduledActionKey !== edge.scheduledActionKey) {
      delete copy[edge.scheduledActionKey];
    }
    copy[next.scheduledActionKey] = next;
    onScheduledActionsChange(copy);
  }

  return (
    <>
      <p className="optic-help" role="status">
        {edge.kind === 'default'
          ? `Default path from ${from}. Used when no rule matches.`
          : edge.kind === 'timer'
            ? `Timer path from ${from}. Fires after the delay if the case is still on this stage (Catalog scheduled action).`
            : `Rule path from ${from}. Lower priority numbers are tried first.`}
      </p>
      <p className="optic-form-key">
        {edge.kind === 'timer' ? edge.scheduledActionKey : edge.transitionSetKey}
      </p>
      {edge.kind !== 'timer' && binding.kind === 'shared' ? (
        <p className="optic-help">
          This stage currently follows {binding.ownerDisplayName}&apos;s rules. Editing this connection changes that
          shared set.
        </p>
      ) : null}
      {edge.kind === 'default' ? (
        <label>
          Default path target
          <select
            value={set?.defaultTargetStageKey ?? ''}
            disabled={readOnly || !set}
            onChange={(event) => {
              if (!set) {
                return;
              }
              const defaultTargetStageKey = event.target.value || undefined;
              onChange(
                updateTransitionSet(workflow, set.transitionSetKey, {
                  defaultTargetStageKey
                })
              );
              if (defaultTargetStageKey) {
                onSelectEdge({
                  ...edge,
                  to: defaultTargetStageKey,
                  edgeId: `${edge.transitionSetKey}:default:${edge.from}->${defaultTargetStageKey}`
                });
              } else {
                onSelectStage(edge.from);
              }
            }}
          >
            <option value="">None</option>
            {workflow.stages.map((stage) => (
              <option key={stage.stageKey} value={stage.stageKey}>
                {stage.displayName}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {edge.kind === 'timer' && scheduled ? (
        <>
          <label>
            Scheduled action key
            <input
              value={scheduled.scheduledActionKey}
              disabled={readOnly || !onScheduledActionsChange}
              onChange={(event) => {
                const nextKey = event.target.value.toUpperCase();
                patchScheduled({ ...scheduled, scheduledActionKey: nextKey });
                onSelectEdge({
                  ...edge,
                  scheduledActionKey: nextKey,
                  label: nextKey,
                  edgeId: `timer:${nextKey}:${edge.from}->${edge.to}`
                });
              }}
            />
          </label>
          <label>
            Delay source
            <select
              value={String(delay.source ?? 'CONFIG')}
              disabled={readOnly || !onScheduledActionsChange}
              onChange={(event) =>
                patchScheduled({
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
          </label>
          {delay.source === 'FIELD' ? (
            <label>
              Delay path
              <input
                value={String(delay.path ?? delay.field ?? '')}
                disabled={readOnly || !onScheduledActionsChange}
                onChange={(event) =>
                  patchScheduled({
                    ...scheduled,
                    delay: { ...delay, source: 'FIELD', path: event.target.value }
                  })
                }
              />
            </label>
          ) : (
            <>
              <label>
                Delay hours
                <input
                  type="number"
                  value={Number(duration.hours ?? 0)}
                  disabled={readOnly || !onScheduledActionsChange}
                  onChange={(event) =>
                    patchScheduled({
                      ...scheduled,
                      delay: {
                        source: 'CONFIG',
                        duration: { ...duration, hours: Number(event.target.value) }
                      }
                    })
                  }
                />
              </label>
              <label>
                Delay days
                <input
                  type="number"
                  value={Number(duration.days ?? 0)}
                  disabled={readOnly || !onScheduledActionsChange}
                  onChange={(event) =>
                    patchScheduled({
                      ...scheduled,
                      delay: {
                        source: 'CONFIG',
                        duration: { ...duration, days: Number(event.target.value) }
                      }
                    })
                  }
                />
              </label>
            </>
          )}
          <label>
            Target stage
            <select
              value={String(scheduled.action?.targetStage ?? '')}
              disabled={readOnly || !onScheduledActionsChange}
              onChange={(event) => {
                const targetStage = event.target.value;
                patchScheduled({
                  ...scheduled,
                  action: { type: 'TRANSITION', targetStage }
                });
                onSelectEdge({
                  ...edge,
                  to: targetStage,
                  edgeId: `timer:${edge.scheduledActionKey}:${edge.from}->${targetStage}`
                });
              }}
            >
              <option value="">None</option>
              {workflow.stages.map((stage) => (
                <option key={stage.stageKey} value={stage.stageKey}>
                  {stage.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={scheduled.cancellation?.cancelIfStageChanges !== false}
              disabled={readOnly || !onScheduledActionsChange}
              onChange={(event) =>
                patchScheduled({
                  ...scheduled,
                  cancellation: { ...scheduled.cancellation, cancelIfStageChanges: event.target.checked }
                })
              }
            />
            Cancel if stage changes
          </label>
          <p className="optic-help">
            New timers are created on Catalog → Scheduled as TRANSITION. Clear timer path turns the action into a
            notification (no stage arrow). Save draft on Workflow also saves changed scheduled actions.
          </p>
        </>
      ) : null}
      {edge.kind === 'rule' && rule && set && ruleIndex >= 0 ? (
        <>
          <label>
            Rule key
            <input
              value={rule.ruleKey}
              disabled={readOnly}
              onChange={(event) => {
                const nextKey = event.target.value.toUpperCase();
                onChange(
                  replaceRule(workflow, set.transitionSetKey, ruleIndex, {
                    ruleKey: nextKey
                  })
                );
                onSelectEdge({
                  ...edge,
                  ruleKey: nextKey,
                  label: nextKey,
                  edgeId: `${edge.transitionSetKey}:rule:${nextKey}:${edge.from}->${edge.to}`
                });
              }}
            />
          </label>
          <label>
            Priority
            <input
              type="number"
              value={rule.priority}
              disabled={readOnly}
              onChange={(event) =>
                onChange(
                  replaceRule(workflow, set.transitionSetKey, ruleIndex, {
                    priority: Number(event.target.value) || 0
                  })
                )
              }
            />
          </label>
          <div className="optic-designer-field-actions">
            <button
              type="button"
              disabled={readOnly || !rulePriorityRank(set, rule.ruleKey).canMoveEarlier}
              aria-label={`Connection: try earlier ${rule.ruleKey}`}
              onClick={() =>
                onChange(reorderRulePriority(workflow, set.transitionSetKey, rule.ruleKey, -1))
              }
            >
              Try earlier
            </button>
            <button
              type="button"
              disabled={readOnly || !rulePriorityRank(set, rule.ruleKey).canMoveLater}
              aria-label={`Connection: try later ${rule.ruleKey}`}
              onClick={() =>
                onChange(reorderRulePriority(workflow, set.transitionSetKey, rule.ruleKey, 1))
              }
            >
              Try later
            </button>
          </div>
          <p className="optic-help">Lower priority numbers run first. Try earlier / later swaps with the neighboring rule and renumbers 1…n.</p>
          <label>
            Target
            <select
              value={rule.targetStageKey}
              disabled={readOnly}
              onChange={(event) => {
                const targetStageKey = event.target.value;
                onChange(
                  replaceRule(workflow, set.transitionSetKey, ruleIndex, {
                    targetStageKey
                  })
                );
                onSelectEdge({
                  ...edge,
                  to: targetStageKey,
                  edgeId: `${edge.transitionSetKey}:rule:${edge.ruleKey}:${edge.from}->${targetStageKey}`
                });
              }}
            >
              {workflow.stages.map((stage) => (
                <option key={stage.stageKey} value={stage.stageKey}>
                  {stage.displayName}
                </option>
              ))}
            </select>
          </label>
          <RuleExpressionEditor
            value={rule.when}
            readOnly={readOnly}
            pathOptions={pathOptions}
            onChange={(when) => onChange(replaceRule(workflow, set.transitionSetKey, ruleIndex, { when }))}
          />
        </>
      ) : null}
      <div className="optic-designer-field-actions">
        <button type="button" onClick={() => onSelectStage(edge.from)}>
          Edit stage
        </button>
        <button type="button" disabled={readOnly} onClick={onRemove}>
          {edge.kind === 'default' ? 'Clear default' : edge.kind === 'timer' ? 'Clear timer path' : 'Remove rule'}
        </button>
      </div>
    </>
  );
}

function TransitionSetsEditor({
  workflow,
  catalog,
  selectedStageKey,
  readOnly,
  pathOptions,
  onChange,
  onDetachTransitionSet
}: {
  workflow: WorkflowDefinition;
  catalog: WorkflowCatalog;
  selectedStageKey?: string;
  readOnly?: boolean;
  pathOptions: ReturnType<typeof listRulePathOptions>;
  onChange: (workflow: WorkflowDefinition) => void;
  onDetachTransitionSet?: (removedKey: string, replacementKey?: string) => void;
}) {
  const defaultPath = pathOptions.find((item) => item.value.startsWith('$.'))?.value;
  const stages = [...workflow.stages].sort((left, right) => left.order - right.order);
  const usedKeys = new Set<string>();
  for (const stage of stages) {
    const binding = outboundBinding(workflow, stage, catalog);
    if (binding.kind !== 'none') {
      usedKeys.add(binding.set.transitionSetKey);
    }
  }
  const unusedSets = workflow.transitionSets.filter((set) => !usedKeys.has(set.transitionSetKey));
  const sectionIds = [
    ...stages.filter((stage) => !stage.terminal).map((stage) => stage.stageKey),
    ...unusedSets.map((set) => set.transitionSetKey)
  ];
  const [openKeys, setOpenKeys] = useState(() => defaultOpenTransitionKeys(workflow, catalog, selectedStageKey));

  useEffect(() => {
    if (!selectedStageKey) {
      return;
    }
    setOpenKeys((current) => {
      if (current.has(selectedStageKey)) {
        return current;
      }
      const next = new Set(current);
      next.add(selectedStageKey);
      return next;
    });
  }, [selectedStageKey]);

  function setSectionOpen(id: string, open: boolean) {
    setOpenKeys((current) => {
      if (current.has(id) === open) {
        return current;
      }
      const next = new Set(current);
      if (open) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  return (
    <section className="optic-designer-transitions" aria-labelledby="transition-heading">
      <div className="optic-designer-transition-header">
        <div>
          <h2 id="transition-heading">Transition rules</h2>
        </div>
        <div className="optic-designer-transition-toggles">
          <button type="button" onClick={() => setOpenKeys(new Set(sectionIds))}>
            Expand all
          </button>
          <button
            type="button"
            onClick={() => setOpenKeys(new Set(selectedStageKey ? [selectedStageKey] : []))}
          >
            Collapse others
          </button>
        </div>
      </div>
      <p className="optic-help">
        Each non-terminal stage has its own Complete path. Rules show as compact rows so you can scan every stage at
        once—expand a row to edit. Select an arrow on the canvas to edit that connection in Properties. Sections start
        collapsed except the stage selected on the canvas; use Expand all to review everything.
      </p>
      {stages.map((stage) => {
        if (stage.terminal) {
          return null;
        }
        const binding = outboundBinding(workflow, stage, catalog);
        return (
          <TransitionSetSection
            key={stage.stageKey}
            title={`From ${stage.displayName}`}
            preview={transitionPreview(workflow, binding)}
            open={openKeys.has(stage.stageKey)}
            onToggle={(open) => setSectionOpen(stage.stageKey, open)}
          >
            {binding.kind === 'none' ? (
              <>
                <p className="optic-help">
                  Complete on this stage has nowhere to go until you add outbound transitions.
                </p>
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => onChange(attachOutboundTransitions(workflow, stage.stageKey, catalog))}
                >
                  Add outbound transitions
                </button>
              </>
            ) : null}
            {binding.kind === 'shared' ? (
              <>
                <p className="optic-help">
                  Complete on this stage currently follows {binding.ownerDisplayName}'s rules ({binding.set.transitionSetKey}
                  ). Give this stage its own transitions to choose a different next stage.
                </p>
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => onChange(attachOutboundTransitions(workflow, stage.stageKey, catalog))}
                >
                  Give this stage its own transitions
                </button>
              </>
            ) : null}
            {binding.kind === 'owned' ? (
              <TransitionSetFields
                workflow={workflow}
                set={binding.set}
                readOnly={readOnly}
                pathOptions={pathOptions}
                defaultPath={defaultPath}
                onChange={onChange}
              />
            ) : null}
          </TransitionSetSection>
        );
      })}
      {unusedSets.map((set) => {
        const catalogHolders = transitionSetCatalogHolders(set.transitionSetKey, catalog);
        const replacementKey = workflow.transitionSets.find((item) => item.transitionSetKey !== set.transitionSetKey)
          ?.transitionSetKey;
        return (
          <TransitionSetSection
            key={set.transitionSetKey}
            title={`${set.transitionSetKey} (not used by a stage)`}
            preview={ownedPreview(workflow, set)}
            open={openKeys.has(set.transitionSetKey)}
            onToggle={(open) => setSectionOpen(set.transitionSetKey, open)}
          >
            <p className="optic-help">
              This set is extra. Stages use the From blocks above. Clone leftovers such as FROM_DATA_ENTRY can be
              deleted here.
            </p>
            {catalogHolders.length > 0 ? (
              <p className="optic-help">
                Catalog action {catalogHolders.join(', ')} still names this set. Remove points{' '}
                {replacementKey ? `it at ${replacementKey}` : 'that action at no set'} and then deletes this block.
              </p>
            ) : null}
            <TransitionSetFields
              workflow={workflow}
              set={set}
              readOnly={readOnly}
              pathOptions={pathOptions}
              defaultPath={defaultPath}
              onChange={onChange}
            />
            <button
              type="button"
              disabled={readOnly}
              onClick={() => {
                onChange(removeTransitionSet(workflow, set.transitionSetKey, catalog));
                onDetachTransitionSet?.(set.transitionSetKey, replacementKey);
              }}
            >
              Remove transition set
            </button>
          </TransitionSetSection>
        );
      })}
    </section>
  );
}

function TransitionSetSection({
  title,
  preview,
  open,
  onToggle,
  children
}: {
  title: string;
  preview: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      className="optic-designer-transition-set"
      open={open}
      aria-label={title}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary>
        <span className="optic-designer-transition-heading">
          <span className="optic-designer-transition-title">{title}</span>
          <span className="optic-designer-transition-preview">{preview}</span>
        </span>
      </summary>
      {open ? <div className="optic-designer-transition-body">{children}</div> : null}
    </details>
  );
}

function defaultOpenTransitionKeys(
  workflow: WorkflowDefinition,
  catalog: WorkflowCatalog,
  selectedStageKey?: string
): Set<string> {
  const keys = new Set<string>();
  if (selectedStageKey) {
    keys.add(selectedStageKey);
  }
  for (const stage of workflow.stages) {
    if (stage.terminal) {
      continue;
    }
    if (outboundBinding(workflow, stage, catalog).kind !== 'owned') {
      keys.add(stage.stageKey);
    }
  }
  return keys;
}

function transitionPreview(
  workflow: WorkflowDefinition,
  binding: ReturnType<typeof outboundBinding>
): string {
  if (binding.kind === 'none') {
    return 'No outbound path';
  }
  if (binding.kind === 'shared') {
    return `Follows ${binding.ownerDisplayName}`;
  }
  return ownedPreview(workflow, binding.set);
}

function ownedPreview(workflow: WorkflowDefinition, set: WorkflowDefinition['transitionSets'][number]): string {
  const target =
    workflow.stages.find((stage) => stage.stageKey === set.defaultTargetStageKey)?.displayName ??
    set.defaultTargetStageKey ??
    'None';
  const extra =
    set.rules.length === 0 ? 'No extra rules' : set.rules.length === 1 ? '1 rule' : `${set.rules.length} rules`;
  return `Default → ${target} · ${extra}`;
}

function TransitionSetFields({
  workflow,
  set,
  readOnly,
  pathOptions,
  defaultPath,
  onChange
}: {
  workflow: WorkflowDefinition;
  set: WorkflowDefinition['transitionSets'][number];
  readOnly?: boolean;
  pathOptions: ReturnType<typeof listRulePathOptions>;
  defaultPath?: string;
  onChange: (workflow: WorkflowDefinition) => void;
}) {
  const [expandedRuleKey, setExpandedRuleKey] = useState<string | null>(null);
  const orderedRules = set.rules
    .map((rule, index) => ({ rule, index }))
    .sort(
      (left, right) =>
        left.rule.priority - right.rule.priority || left.rule.ruleKey.localeCompare(right.rule.ruleKey)
    );

  useEffect(() => {
    if (expandedRuleKey && !set.rules.some((rule) => rule.ruleKey === expandedRuleKey)) {
      setExpandedRuleKey(null);
    }
  }, [expandedRuleKey, set.rules]);

  function addRule() {
    const ruleKey = nextUniqueRuleKey(set);
    onChange(
      updateTransitionSet(workflow, set.transitionSetKey, {
        rules: [
          ...set.rules,
          {
            ruleKey,
            priority: set.rules.length + 1,
            when: emptyPredicate(defaultPath),
            targetStageKey: workflow.stages[0]?.stageKey ?? ''
          }
        ]
      })
    );
    setExpandedRuleKey(ruleKey);
  }

  return (
    <>
      <p className="optic-form-key">{set.transitionSetKey}</p>
      <label>
        Default target
        <select
          value={set.defaultTargetStageKey ?? ''}
          disabled={readOnly}
          onChange={(event) =>
            onChange(updateTransitionSet(workflow, set.transitionSetKey, { defaultTargetStageKey: event.target.value || undefined }))
          }
        >
          <option value="">None</option>
          {workflow.stages.map((stage) => (
            <option key={stage.stageKey} value={stage.stageKey}>
              {stage.displayName}
            </option>
          ))}
        </select>
      </label>
      {orderedRules.length > 0 ? (
        <ul className="optic-workflow-rule-list" aria-label={`Rules for ${set.transitionSetKey}`}>
          {orderedRules.map(({ rule, index }) => {
            const rank = rulePriorityRank(set, rule.ruleKey);
            const expanded = expandedRuleKey === rule.ruleKey;
            const targetName =
              workflow.stages.find((stage) => stage.stageKey === rule.targetStageKey)?.displayName ??
              (rule.targetStageKey || 'No target');
            const whenSummary = summarizeRuleExpression(rule.when);
            return (
              <li
                key={`${set.transitionSetKey}-rule-${index}`}
                className="optic-workflow-rule-row"
                data-expanded={expanded ? 'true' : undefined}
              >
                <div className="optic-workflow-rule-summary">
                  <span className="optic-workflow-rule-order" aria-hidden="true">
                    {rank.index + 1}
                  </span>
                  <button
                    type="button"
                    className="optic-workflow-rule-toggle"
                    aria-expanded={expanded}
                    aria-label={
                      expanded
                        ? `Collapse rule ${rule.ruleKey}`
                        : `Expand rule ${rule.ruleKey}: ${whenSummary} to ${targetName}`
                    }
                    onClick={() => setExpandedRuleKey(expanded ? null : rule.ruleKey)}
                  >
                    <span className="optic-workflow-rule-when">{whenSummary}</span>
                    <span className="optic-workflow-rule-arrow" aria-hidden="true">
                      →
                    </span>
                    <span className="optic-workflow-rule-target">{targetName}</span>
                  </button>
                  <div className="optic-workflow-rule-actions">
                    <button
                      type="button"
                      className="optic-designer-quiet-button"
                      disabled={readOnly || !rank.canMoveEarlier}
                      aria-label={`From block: try earlier ${rule.ruleKey}`}
                      title="Try earlier"
                      onClick={() => onChange(reorderRulePriority(workflow, set.transitionSetKey, rule.ruleKey, -1))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="optic-designer-quiet-button"
                      disabled={readOnly || !rank.canMoveLater}
                      aria-label={`From block: try later ${rule.ruleKey}`}
                      title="Try later"
                      onClick={() => onChange(reorderRulePriority(workflow, set.transitionSetKey, rule.ruleKey, 1))}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="optic-designer-quiet-button"
                      disabled={readOnly}
                      aria-label={`Remove rule ${rule.ruleKey}`}
                      title="Remove rule"
                      onClick={() => {
                        onChange(
                          updateTransitionSet(workflow, set.transitionSetKey, {
                            rules: set.rules.filter((_, itemIndex) => itemIndex !== index)
                          })
                        );
                        if (expandedRuleKey === rule.ruleKey) {
                          setExpandedRuleKey(null);
                        }
                      }}
                    >
                      <ButtonLabel icon="trash">Remove</ButtonLabel>
                    </button>
                  </div>
                </div>
                {expanded ? (
                  <div className="optic-workflow-rule-editor optic-designer-behavior">
                    <label>
                      Rule key
                      <input
                        value={rule.ruleKey}
                        disabled={readOnly}
                        onChange={(event) => {
                          const nextKey = event.target.value.toUpperCase();
                          onChange(replaceRule(workflow, set.transitionSetKey, index, { ruleKey: nextKey }));
                          setExpandedRuleKey(nextKey);
                        }}
                      />
                    </label>
                    <p className="optic-help">
                      Priority {rule.priority} · tried {rank.index + 1} of {rank.count}
                    </p>
                    <label>
                      Target
                      <select
                        value={rule.targetStageKey}
                        disabled={readOnly}
                        onChange={(event) =>
                          onChange(
                            replaceRule(workflow, set.transitionSetKey, index, {
                              targetStageKey: event.target.value
                            })
                          )
                        }
                      >
                        {workflow.stages.map((stage) => (
                          <option key={stage.stageKey} value={stage.stageKey}>
                            {stage.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <RuleExpressionEditor
                      value={rule.when}
                      readOnly={readOnly}
                      pathOptions={pathOptions}
                      onChange={(when) => onChange(replaceRule(workflow, set.transitionSetKey, index, { when }))}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="optic-help">No extra rules—Complete uses the default target only.</p>
      )}
      <button type="button" disabled={readOnly} onClick={addRule}>
        Add rule
      </button>
    </>
  );
}

function nextUniqueRuleKey(set: WorkflowDefinition['transitionSets'][number]): string {
  const used = new Set(set.rules.map((rule) => rule.ruleKey));
  let index = set.rules.length + 1;
  let key = `RULE_${index}`;
  while (used.has(key)) {
    index += 1;
    key = `RULE_${index}`;
  }
  return key;
}

function replaceRule(
  workflow: WorkflowDefinition,
  transitionSetKey: string,
  index: number,
  patch: Partial<TransitionRule>
): WorkflowDefinition {
  const set = workflow.transitionSets.find((item) => item.transitionSetKey === transitionSetKey);
  if (!set) {
    return workflow;
  }
  const rules = set.rules.map((rule, itemIndex) => (itemIndex === index ? { ...rule, ...patch } : rule));
  return updateTransitionSet(workflow, transitionSetKey, { rules });
}

function shortKey(value: string): string {
  const parts = value.split('_').filter(Boolean);
  if (parts.length <= 2) {
    return value;
  }
  return parts.slice(-2).join('_');
}

/** True when the pointer is on empty canvas chrome, not a stage, handle, or edge. */
function isWorkflowCanvasBackground(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  if (!target.closest('.optic-workflow-graph')) {
    return false;
  }
  return !target.closest(
    [
      '.optic-workflow-node',
      '.optic-workflow-node-wrap',
      '.optic-workflow-connect-handle',
      '.optic-workflow-edge-hit',
      '.optic-workflow-edge-label',
      '.optic-workflow-empty',
      'button',
      'a',
      'input',
      'select',
      'textarea',
      'summary',
      'details'
    ].join(', ')
  );
}

function connectPreviewPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(48, Math.abs(x2 - x1) * 0.45);
  const c1x = x1 + (x2 >= x1 ? dx : -dx);
  const c2x = x2 + (x2 >= x1 ? -dx : dx);
  return `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`;
}

/** Nudge overlapping edge chips so labels stay readable. */
function offsetCollidingEdgeLabels(edges: LaidOutEdge[]): LaidOutEdge[] {
  const placed: Array<{ x: number; y: number }> = [];
  return edges.map((edge) => {
    let labelX = edge.labelX;
    let labelY = edge.labelY;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const clash = placed.some((point) => Math.hypot(point.x - labelX, point.y - labelY) < 30);
      if (!clash) {
        break;
      }
      labelY += 16;
    }
    placed.push({ x: labelX, y: labelY });
    return { ...edge, labelX, labelY };
  });
}

function removeEdge(workflow: WorkflowDefinition, edge: WorkflowEdge): WorkflowDefinition {
  if (!edge.transitionSetKey || edge.kind === 'timer') {
    return workflow;
  }
  const set = workflow.transitionSets.find((item) => item.transitionSetKey === edge.transitionSetKey);
  if (!set) {
    return workflow;
  }
  if (edge.kind === 'default') {
    return updateTransitionSet(workflow, set.transitionSetKey, { defaultTargetStageKey: undefined });
  }
  return updateTransitionSet(workflow, set.transitionSetKey, {
    rules: set.rules.filter((rule) => rule.ruleKey !== edge.ruleKey)
  });
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

function CatalogSelect({
  label,
  value,
  options,
  emptyHelp,
  readOnly,
  onChange
}: {
  label: string;
  value?: string;
  options: readonly string[];
  emptyHelp: string;
  readOnly?: boolean;
  onChange: (value: string | undefined) => void;
}) {
  const keys = uniqueKeys(value, options);
  return (
    <>
      <label>
        {label}
        <select value={value ?? ''} disabled={readOnly} onChange={(event) => onChange(event.target.value || undefined)}>
          <option value="">None</option>
          {keys.map((key) => (
            <option key={key} value={key}>
              {options.includes(key) ? key : `${key} (not in catalog)`}
            </option>
          ))}
        </select>
      </label>
      {options.length === 0 ? <p className="optic-help">{emptyHelp}</p> : null}
    </>
  );
}

function KeyChecklist({
  legend,
  selected,
  options,
  labels,
  emptyHelp,
  readOnly,
  onChange
}: {
  legend: string;
  selected: readonly string[];
  options: readonly string[];
  labels?: Record<string, string | undefined>;
  emptyHelp: string;
  readOnly?: boolean;
  onChange: (selected: string[]) => void;
}) {
  const keys = uniqueKeys(options, selected);
  if (keys.length === 0) {
    return (
      <fieldset className="optic-key-checklist">
        <legend>{legend}</legend>
        <p className="optic-help">{emptyHelp}</p>
      </fieldset>
    );
  }
  return (
    <fieldset className="optic-key-checklist">
      <legend>{legend}</legend>
      {keys.map((key) => (
        <label key={key} className="optic-checkbox">
          <input
            type="checkbox"
            checked={selected.includes(key)}
            disabled={readOnly}
            onChange={(event) =>
              onChange(event.target.checked ? [...selected, key] : selected.filter((item) => item !== key))
            }
          />
          {labels?.[key] ? `${labels[key]} (${key})` : options.includes(key) ? key : `${key} (not in catalog)`}
        </label>
      ))}
    </fieldset>
  );
}
