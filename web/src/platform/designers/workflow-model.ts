import {
  isSharedEntityPath,
  sharedRootOfPath
} from '../../../../src/modules/configuration/domain/shared-entity-paths.js';
import type {
  FormFieldDefinition,
  QueueDefinition,
  StageDefinition,
  StageFormDefinition,
  TransitionSet,
  WorkflowDefinition
} from '../../../../src/modules/configuration/domain/types.js';
import { joinJsonPath } from '../../../../src/modules/workflow/domain/merge-patch.js';
import type { DesignerIssue } from './form-model.js';
import { nextStableKey } from './palette.js';

export interface WorkflowCatalog {
  forms?: string[];
  queues?: string[];
  slas?: string[];
  bulkActions?: string[];
  scheduledByStage?: Record<string, string[]>;
  scheduledActions?: Record<string, CatalogScheduledAction>;
  actions?: Record<string, { type?: string; transitionSetKey?: string; label?: string }>;
}

export interface CatalogScheduledAction {
  trigger?: Record<string, unknown>;
  delay?: Record<string, unknown>;
  action?: Record<string, unknown>;
  cancellation?: Record<string, unknown>;
  retry?: Record<string, unknown>;
}

export interface WorkflowEdge {
  edgeId: string;
  from: string;
  to: string;
  label: string;
  kind: 'default' | 'rule' | 'timer';
  /** Present for Complete (default/rule) paths. */
  transitionSetKey?: string;
  ruleKey?: string;
  priority?: number;
  /** Present for Catalog scheduled TRANSITION timers. */
  scheduledActionKey?: string;
  delaySummary?: string;
}

export const STAGE_NODE_WIDTH = 200;
export const STAGE_NODE_HEIGHT = 96;
const STAGE_GAP_X = 108;
const STAGE_GAP_Y = 92;
const STAGE_COLUMNS = 4;
/** Horizontal breathing room so Complete arrows and labels stay readable. */
const ARRANGE_GAP_X = 128;
/** Vertical gap between parallel branches in the same layer. */
const ARRANGE_GAP_Y = 80;
const ARRANGE_MARGIN_X = 40;
const ARRANGE_MARGIN_Y = 48;
const PORT_INSET = 18;
const LOOP_OUTSET = 36;

export function addStage(workflow: WorkflowDefinition, catalog: WorkflowCatalog = {}): WorkflowDefinition {
  const stageKey = nextStableKey('STAGE', workflow.stages.map((stage) => stage.stageKey));
  const order = (workflow.stages.at(-1)?.order ?? 0) + 10;
  const index = workflow.stages.length;
  const stage: StageDefinition = {
    stageKey,
    displayName: 'New stage',
    order,
    actionKeys: [],
    assignmentPolicy: {
      required: false,
      clearOnTransition: true,
      allowAssign: true,
      allowReassign: true,
      allowRelease: true
    },
    layout: defaultStageLayout(index)
  };
  return attachOutboundTransitions(
    {
      ...workflow,
      initialStageKey: workflow.initialStageKey || stageKey,
      stages: [...workflow.stages, stage]
    },
    stageKey,
    catalog
  );
}

export function updateStage(
  workflow: WorkflowDefinition,
  stageKey: string,
  patch: Partial<StageDefinition>
): WorkflowDefinition {
  const stages = workflow.stages.map((stage) => {
    if (stage.stageKey !== stageKey) {
      return stage;
    }
    const next = { ...stage, ...patch };
    if (next.terminal) {
      next.transitionSetKey = undefined;
    }
    return next;
  });
  const terminals = stages.filter((stage) => stage.terminal).map((stage) => stage.stageKey);
  return {
    ...workflow,
    stages,
    terminalStageKeys: terminals,
    initialStageKey:
      patch.stageKey && workflow.initialStageKey === stageKey ? patch.stageKey : workflow.initialStageKey
  };
}

export function removeStage(workflow: WorkflowDefinition, stageKey: string): WorkflowDefinition {
  const stages = workflow.stages.filter((stage) => stage.stageKey !== stageKey);
  return {
    ...workflow,
    stages,
    terminalStageKeys: workflow.terminalStageKeys.filter((key) => key !== stageKey),
    initialStageKey: workflow.initialStageKey === stageKey ? (stages[0]?.stageKey ?? '') : workflow.initialStageKey
  };
}

export function moveStage(workflow: WorkflowDefinition, stageKey: string, direction: -1 | 1): WorkflowDefinition {
  const ordered = [...workflow.stages].sort((left, right) => left.order - right.order);
  const index = ordered.findIndex((stage) => stage.stageKey === stageKey);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= ordered.length) {
    return workflow;
  }
  const swapped = [...ordered];
  const current = swapped[index];
  const neighbor = swapped[next];
  if (!current || !neighbor) {
    return workflow;
  }
  swapped[index] = { ...neighbor, order: current.order };
  swapped[next] = { ...current, order: neighbor.order };
  return { ...workflow, stages: swapped };
}

export function addTransitionSet(workflow: WorkflowDefinition): WorkflowDefinition {
  const transitionSetKey = nextStableKey(
    'TRANSITIONS',
    workflow.transitionSets.map((item) => item.transitionSetKey)
  );
  const set: TransitionSet = {
    transitionSetKey,
    evaluationMode: 'FIRST_MATCH',
    rules: [],
    defaultTargetStageKey: workflow.terminalStageKeys[0] ?? workflow.stages.at(-1)?.stageKey
  };
  return { ...workflow, transitionSets: [...workflow.transitionSets, set] };
}

export function removeTransitionSet(
  workflow: WorkflowDefinition,
  transitionSetKey: string,
  catalog: WorkflowCatalog = {}
): WorkflowDefinition {
  if (transitionSetStageHolders(workflow, transitionSetKey, catalog).length > 0) {
    return workflow;
  }
  return {
    ...workflow,
    transitionSets: workflow.transitionSets.filter((set) => set.transitionSetKey !== transitionSetKey),
    stages: workflow.stages.map((stage) =>
      stage.transitionSetKey === transitionSetKey ? { ...stage, transitionSetKey: undefined } : stage
    )
  };
}

export function retargetActionTransitionSet<T extends { transitionSetKey?: string }>(
  actions: Record<string, T>,
  fromKey: string,
  toKey?: string
): Record<string, T> {
  let changed = false;
  const next: Record<string, T> = {};
  for (const [actionKey, action] of Object.entries(actions)) {
    if (action.transitionSetKey === fromKey) {
      changed = true;
      next[actionKey] = { ...action, transitionSetKey: toKey };
    } else {
      next[actionKey] = action;
    }
  }
  return changed ? next : actions;
}

export function transitionSetStageHolders(
  workflow: WorkflowDefinition,
  transitionSetKey: string,
  catalog: WorkflowCatalog = {}
): string[] {
  const holders: string[] = [];
  for (const stage of workflow.stages) {
    if (stage.terminal) {
      continue;
    }
    const binding = outboundBinding(workflow, stage, catalog);
    if (binding.kind !== 'none' && binding.set.transitionSetKey === transitionSetKey) {
      holders.push(stage.displayName);
    }
  }
  return holders;
}

export function transitionSetCatalogHolders(transitionSetKey: string, catalog: WorkflowCatalog = {}): string[] {
  return Object.entries(catalog.actions ?? {})
    .filter(([, action]) => action.transitionSetKey === transitionSetKey)
    .map(([actionKey]) => actionKey);
}

export function attachOutboundTransitions(
  workflow: WorkflowDefinition,
  stageKey: string,
  catalog: WorkflowCatalog = {}
): WorkflowDefinition {
  const stage = workflow.stages.find((item) => item.stageKey === stageKey);
  if (!stage || stage.terminal) {
    return workflow;
  }
  const binding = outboundBinding(workflow, stage, catalog);
  if (binding.kind === 'owned') {
    return workflow;
  }
  const transitionSetKey = nextStableKey(
    `FROM_${stage.stageKey}`,
    workflow.transitionSets.map((item) => item.transitionSetKey)
  );
  const completeKey = firstTransitionActionKey(catalog);
  const actionKeys =
    completeKey && !stage.actionKeys.includes(completeKey) ? [...stage.actionKeys, completeKey] : stage.actionKeys;
  return {
    ...workflow,
    transitionSets: [
      ...workflow.transitionSets,
      {
        transitionSetKey,
        evaluationMode: 'FIRST_MATCH',
        rules: [],
        defaultTargetStageKey:
          workflow.terminalStageKeys[0] ?? workflow.stages.find((item) => item.terminal)?.stageKey
      }
    ],
    stages: workflow.stages.map((item) =>
      item.stageKey === stageKey ? { ...item, transitionSetKey, actionKeys } : item
    )
  };
}

/**
 * Draw a Complete path from one stage to another.
 * Forks a shared/catalog set into a stage-owned From block first, then either
 * sets the otherwise default or appends a new rule.
 */
export function connectStages(
  workflow: WorkflowDefinition,
  fromStageKey: string,
  toStageKey: string,
  catalog: WorkflowCatalog = {},
  options?: { mode?: 'rule' | 'default'; whenPath?: string }
): { workflow: WorkflowDefinition; edge?: WorkflowEdge } {
  const from = workflow.stages.find((stage) => stage.stageKey === fromStageKey);
  const to = workflow.stages.find((stage) => stage.stageKey === toStageKey);
  if (!from || from.terminal || !to) {
    return { workflow };
  }

  let next = attachOutboundTransitions(workflow, fromStageKey, catalog);
  const owned = next.stages.find((stage) => stage.stageKey === fromStageKey);
  const binding = owned ? outboundBinding(next, owned, catalog) : { kind: 'none' as const };
  if (binding.kind !== 'owned') {
    return { workflow: next };
  }

  const mode = options?.mode ?? (binding.set.defaultTargetStageKey ? 'rule' : 'default');
  if (mode === 'default') {
    next = updateTransitionSet(next, binding.set.transitionSetKey, {
      defaultTargetStageKey: toStageKey
    });
    const edge = listEdges(next, catalog).find(
      (item) =>
        item.from === fromStageKey &&
        item.to === toStageKey &&
        item.kind === 'default' &&
        item.transitionSetKey === binding.set.transitionSetKey
    );
    return { workflow: next, edge };
  }

  if (
    options?.mode === undefined &&
    binding.set.defaultTargetStageKey === toStageKey
  ) {
    const edge = listEdges(next, catalog).find(
      (item) =>
        item.from === fromStageKey &&
        item.to === toStageKey &&
        item.kind === 'default' &&
        item.transitionSetKey === binding.set.transitionSetKey
    );
    return { workflow: next, edge };
  }

  const ruleKey = nextStableKey(
    'RULE',
    binding.set.rules.map((rule) => rule.ruleKey)
  );
  const priority =
    binding.set.rules.reduce((max, rule) => Math.max(max, rule.priority), 0) + 1;
  next = updateTransitionSet(next, binding.set.transitionSetKey, {
    rules: [
      ...binding.set.rules,
      {
        ruleKey,
        priority,
        when: {
          path: options?.whenPath ?? '$.field',
          operator: 'EQUALS',
          value: ''
        },
        targetStageKey: toStageKey
      }
    ]
  });
  const edge = listEdges(next, catalog).find(
    (item) =>
      item.from === fromStageKey &&
      item.kind === 'rule' &&
      item.ruleKey === ruleKey &&
      item.transitionSetKey === binding.set.transitionSetKey
  );
  return { workflow: next, edge };
}

export function updateTransitionSet(
  workflow: WorkflowDefinition,
  transitionSetKey: string,
  patch: Partial<TransitionSet>
): WorkflowDefinition {
  return {
    ...workflow,
    transitionSets: workflow.transitionSets.map((item) =>
      item.transitionSetKey === transitionSetKey ? { ...item, ...patch } : item
    )
  };
}

/**
 * Swap a rule one step earlier or later in evaluation order (lower priority first).
 * Rewrites dense priorities 1..n on the set so canvas labels stay sequential.
 */
export function reorderRulePriority(
  workflow: WorkflowDefinition,
  transitionSetKey: string,
  ruleKey: string,
  direction: -1 | 1
): WorkflowDefinition {
  const set = workflow.transitionSets.find((item) => item.transitionSetKey === transitionSetKey);
  if (!set || set.rules.length < 2) {
    return workflow;
  }
  const ordered = [...set.rules].sort(
    (left, right) => left.priority - right.priority || left.ruleKey.localeCompare(right.ruleKey)
  );
  const index = ordered.findIndex((rule) => rule.ruleKey === ruleKey);
  const swapWith = index + direction;
  if (index < 0 || swapWith < 0 || swapWith >= ordered.length) {
    return workflow;
  }
  const reordered = [...ordered];
  const current = reordered[index]!;
  reordered[index] = reordered[swapWith]!;
  reordered[swapWith] = current;
  const priorityByKey = new Map(reordered.map((rule, orderIndex) => [rule.ruleKey, orderIndex + 1]));
  return updateTransitionSet(workflow, transitionSetKey, {
    rules: set.rules.map((rule) => ({
      ...rule,
      priority: priorityByKey.get(rule.ruleKey) ?? rule.priority
    }))
  });
}

export function rulePriorityRank(
  set: TransitionSet,
  ruleKey: string
): { index: number; count: number; canMoveEarlier: boolean; canMoveLater: boolean } {
  const ordered = [...set.rules].sort(
    (left, right) => left.priority - right.priority || left.ruleKey.localeCompare(right.ruleKey)
  );
  const index = ordered.findIndex((rule) => rule.ruleKey === ruleKey);
  return {
    index,
    count: ordered.length,
    canMoveEarlier: index > 0,
    canMoveLater: index >= 0 && index < ordered.length - 1
  };
}

export function collectWorkflowIssues(
  workflow: WorkflowDefinition,
  catalog: WorkflowCatalog = {}
): DesignerIssue[] {
  const issues: DesignerIssue[] = [];
  const keys = new Set<string>();
  if (!workflow.initialStageKey) {
    issues.push({ path: 'initialStageKey', message: 'Choose an initial stage.' });
  }
  for (const stage of workflow.stages) {
    if (keys.has(stage.stageKey)) {
      issues.push({ path: `stages.${stage.stageKey}`, message: `Duplicate stageKey ${stage.stageKey}.` });
    }
    keys.add(stage.stageKey);
    if (!stage.displayName.trim()) {
      issues.push({ path: `stages.${stage.stageKey}.displayName`, message: `${stage.stageKey} needs a display name.` });
    }
    if (stage.formKey && catalog.forms && !catalog.forms.includes(stage.formKey)) {
      issues.push({ path: `stages.${stage.stageKey}.formKey`, message: `Form ${stage.formKey} is not on this release.` });
    }
    if (stage.queueKey && catalog.queues && !catalog.queues.includes(stage.queueKey)) {
      issues.push({ path: `stages.${stage.stageKey}.queueKey`, message: `Queue ${stage.queueKey} is not on this release.` });
    }
    if (stage.slaKey && catalog.slas && !catalog.slas.includes(stage.slaKey)) {
      issues.push({ path: `stages.${stage.stageKey}.slaKey`, message: `SLA ${stage.slaKey} is not on this release.` });
    }
    if (
      !stage.terminal &&
      stage.transitionSetKey &&
      !workflow.transitionSets.some((set) => set.transitionSetKey === stage.transitionSetKey)
    ) {
      issues.push({
        path: `stages.${stage.stageKey}.transitionSetKey`,
        message: `${stage.displayName} points at missing transition set ${stage.transitionSetKey}.`
      });
    }
    for (const bulkKey of stage.bulkActionKeys ?? []) {
      if (catalog.bulkActions && !catalog.bulkActions.includes(bulkKey)) {
        issues.push({
          path: `stages.${stage.stageKey}.bulkActionKeys`,
          message: `Bulk action ${bulkKey} is not on this release.`
        });
      }
    }
    if (stage.terminal && stage.actionKeys.length > 0) {
      issues.push({
        path: `stages.${stage.stageKey}.actionKeys`,
        message: `Terminal stage ${stage.stageKey} should not declare transition actions.`
      });
    }
    if (!stage.terminal) {
      const binding = outboundBinding(workflow, stage, catalog);
      if (binding.kind === 'none' && catalog.actions) {
        issues.push({
          path: `stages.${stage.stageKey}.transitionSetKey`,
          message: `${stage.displayName} has no outbound transitions. Add them so Complete knows where to go.`
        });
      }
      for (const actionKey of stage.actionKeys) {
        const action = catalog.actions?.[actionKey];
        if (catalog.actions && !action) {
          issues.push({
            path: `stages.${stage.stageKey}.actionKeys`,
            message: `Action ${actionKey} is not on this release.`
          });
          continue;
        }
        if (action && (action.type ?? 'TRANSITION') === 'TRANSITION') {
          const setKey = stage.transitionSetKey || action.transitionSetKey;
          const set = workflow.transitionSets.find((item) => item.transitionSetKey === setKey);
          if (!setKey || !set || (!set.defaultTargetStageKey && set.rules.length === 0)) {
            issues.push({
              path: `stages.${stage.stageKey}.actionKeys`,
              message: `Transition action ${actionKey} has no reachable destination.`
            });
          }
        }
      }
    }
  }
  if (workflow.initialStageKey && !keys.has(workflow.initialStageKey)) {
    issues.push({ path: 'initialStageKey', message: `Initial stage ${workflow.initialStageKey} is missing.` });
  }
  for (const set of workflow.transitionSets) {
    if (set.defaultTargetStageKey && !keys.has(set.defaultTargetStageKey)) {
      issues.push({
        path: `transitionSets.${set.transitionSetKey}.defaultTargetStageKey`,
        message: `Default target ${set.defaultTargetStageKey} is missing.`
      });
    }
    for (const rule of set.rules) {
      if (!keys.has(rule.targetStageKey)) {
        issues.push({
          path: `transitionSets.${set.transitionSetKey}.rules.${rule.ruleKey}`,
          message: `Rule ${rule.ruleKey} targets missing stage ${rule.targetStageKey}.`
        });
      }
    }
  }
  const reachable = reachableStages(workflow, catalog);
  for (const stage of workflow.stages) {
    if (stage.stageKey !== workflow.initialStageKey && !reachable.has(stage.stageKey)) {
      issues.push({
        path: `stages.${stage.stageKey}`,
        message: `Stage ${stage.stageKey} is unreachable from ${workflow.initialStageKey || 'the initial stage'}.`
      });
    }
  }
  for (const cycle of findCycles(workflow, catalog)) {
    issues.push({ path: 'workflow', message: `Intentional cycle: ${cycle}. Confirm this return path is expected.` });
  }
  return issues;
}

export function listEdges(workflow: WorkflowDefinition, catalog: WorkflowCatalog = {}): WorkflowEdge[] {
  const edges: WorkflowEdge[] = [];
  const seen = new Set<string>();
  for (const stage of workflow.stages) {
    if (stage.terminal) {
      continue;
    }
    for (const edge of outgoingEdges(workflow, stage.stageKey, catalog)) {
      if (seen.has(edge.edgeId)) {
        continue;
      }
      seen.add(edge.edgeId);
      edges.push(edge);
    }
  }
  return edges;
}

export function findEdgeById(
  workflow: WorkflowDefinition,
  catalog: WorkflowCatalog,
  edgeId: string
): WorkflowEdge | undefined {
  return listEdges(workflow, catalog).find((edge) => edge.edgeId === edgeId);
}

export function edgeSelectionLabel(edge: WorkflowEdge, workflow: WorkflowDefinition): string {
  const from =
    workflow.stages.find((stage) => stage.stageKey === edge.from)?.displayName ?? edge.from;
  const to = workflow.stages.find((stage) => stage.stageKey === edge.to)?.displayName ?? edge.to;
  if (edge.kind === 'default') {
    return `Default: ${from} to ${to}`;
  }
  if (edge.kind === 'timer') {
    const delay = edge.delaySummary ? ` after ${edge.delaySummary}` : '';
    return `Timer: ${from} to ${to}${delay} via ${edge.label}`;
  }
  const priority = typeof edge.priority === 'number' ? `Priority ${edge.priority}: ` : '';
  return `${priority}${from} to ${to} via ${edge.label}`;
}

export function formatScheduledDelaySummary(delay: Record<string, unknown> | undefined): string {
  if (!delay) {
    return 'timer';
  }
  if (delay.source === 'FIELD') {
    const path = typeof delay.path === 'string' ? delay.path : typeof delay.field === 'string' ? delay.field : '';
    return path ? `field ${path}` : 'field';
  }
  const duration = (delay.duration ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  const days = Number(duration.days ?? 0);
  const hours = Number(duration.hours ?? 0);
  const minutes = Number(duration.minutes ?? 0);
  if (days) {
    parts.push(`${days}d`);
  }
  if (hours) {
    parts.push(`${hours}h`);
  }
  if (minutes) {
    parts.push(`${minutes}m`);
  }
  return parts.length > 0 ? parts.join(' ') : '0h';
}

export function stageLayout(stage: StageDefinition, index: number): { x: number; y: number } {
  return stage.layout ?? defaultStageLayout(index);
}

export function defaultStageLayout(index: number): { x: number; y: number } {
  const col = index % STAGE_COLUMNS;
  const row = Math.floor(index / STAGE_COLUMNS);
  return {
    x: 40 + col * (STAGE_NODE_WIDTH + STAGE_GAP_X),
    y: 48 + row * (STAGE_NODE_HEIGHT + STAGE_GAP_Y)
  };
}

/**
 * Places stages left-to-right along the workflow graph so officers can read the
 * happy path, with branches stacked in the same column and terminals pushed right.
 */
export function arrangeStageLayouts(
  workflow: WorkflowDefinition,
  catalog: WorkflowCatalog = {}
): WorkflowDefinition {
  const layouts = computeArrangeLayouts(workflow, catalog);
  return {
    ...workflow,
    stages: workflow.stages.map((stage) => ({
      ...stage,
      layout: layouts.get(stage.stageKey) ?? stage.layout ?? defaultStageLayout(0)
    }))
  };
}

function computeArrangeLayouts(
  workflow: WorkflowDefinition,
  catalog: WorkflowCatalog
): Map<string, { x: number; y: number }> {
  const ordered = [...workflow.stages].sort((left, right) => left.order - right.order);
  const layouts = new Map<string, { x: number; y: number }>();
  if (ordered.length === 0) {
    return layouts;
  }

  const orderIndex = new Map(ordered.map((stage, index) => [stage.stageKey, index]));
  const adjacency = buildArrangeAdjacency(workflow, catalog);
  const hasEdges = [...adjacency.values()].some((targets) => targets.size > 0);

  if (!hasEdges) {
    for (const [index, stage] of ordered.entries()) {
      layouts.set(stage.stageKey, {
        x: ARRANGE_MARGIN_X + index * (STAGE_NODE_WIDTH + ARRANGE_GAP_X),
        y: ARRANGE_MARGIN_Y
      });
    }
    return layouts;
  }

  const startKey =
    (workflow.initialStageKey && orderIndex.has(workflow.initialStageKey)
      ? workflow.initialStageKey
      : ordered[0]?.stageKey) ?? '';
  const ranks = computeArrangeRanks(ordered.map((stage) => stage.stageKey), adjacency, startKey, orderIndex);
  const layers = groupKeysByRank(ranks, orderIndex);
  orderLayersToReduceCrossings(layers, adjacency, orderIndex);

  const maxLayerSize = Math.max(1, ...layers.map((layer) => layer.length));
  const rowPitch = STAGE_NODE_HEIGHT + ARRANGE_GAP_Y;
  const colPitch = STAGE_NODE_WIDTH + ARRANGE_GAP_X;

  for (const [rank, layer] of layers.entries()) {
    const offsetY = ((maxLayerSize - layer.length) * rowPitch) / 2;
    for (const [row, stageKey] of layer.entries()) {
      layouts.set(stageKey, {
        x: ARRANGE_MARGIN_X + rank * colPitch,
        y: ARRANGE_MARGIN_Y + offsetY + row * rowPitch
      });
    }
  }
  return layouts;
}

function buildArrangeAdjacency(
  workflow: WorkflowDefinition,
  catalog: WorkflowCatalog
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const stage of workflow.stages) {
    adjacency.set(stage.stageKey, new Set());
  }
  for (const edge of listEdges(workflow, catalog)) {
    if (edge.from === edge.to) {
      continue;
    }
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) {
      continue;
    }
    adjacency.get(edge.from)!.add(edge.to);
  }
  return adjacency;
}

/** Longest-path ranks from the start; back-edges stop promoting once layers would exceed n-1. */
function computeArrangeRanks(
  stageKeys: string[],
  adjacency: Map<string, Set<string>>,
  startKey: string,
  orderIndex: Map<string, number>
): Map<string, number> {
  const ranks = new Map<string, number>();
  if (!startKey) {
    for (const [index, key] of stageKeys.entries()) {
      ranks.set(key, index);
    }
    return ranks;
  }

  ranks.set(startKey, 0);
  const maxRank = Math.max(0, stageKeys.length - 1);
  let changed = true;
  let guard = 0;
  while (changed && guard < stageKeys.length * stageKeys.length) {
    changed = false;
    guard += 1;
    for (const [from, targets] of adjacency) {
      const fromRank = ranks.get(from);
      if (fromRank === undefined) {
        continue;
      }
      for (const to of targets) {
        const nextRank = fromRank + 1;
        if (nextRank > maxRank) {
          continue;
        }
        const current = ranks.get(to);
        if (current === undefined || current < nextRank) {
          ranks.set(to, nextRank);
          changed = true;
        }
      }
    }
  }

  // Unreachable / disconnected stages continue after the main flow, in author order.
  const rankedMax = Math.max(0, ...ranks.values());
  let orphanRank = rankedMax + 1;
  const orphans = stageKeys
    .filter((key) => !ranks.has(key))
    .sort((left, right) => (orderIndex.get(left) ?? 0) - (orderIndex.get(right) ?? 0));
  for (const key of orphans) {
    ranks.set(key, orphanRank);
    orphanRank += 1;
  }
  return ranks;
}

function groupKeysByRank(
  ranks: Map<string, number>,
  orderIndex: Map<string, number>
): string[][] {
  const byRank = new Map<number, string[]>();
  for (const [key, rank] of ranks) {
    const bucket = byRank.get(rank) ?? [];
    bucket.push(key);
    byRank.set(rank, bucket);
  }
  const maxRank = Math.max(0, ...byRank.keys());
  const layers: string[][] = [];
  for (let rank = 0; rank <= maxRank; rank += 1) {
    const layer = byRank.get(rank) ?? [];
    layer.sort((left, right) => (orderIndex.get(left) ?? 0) - (orderIndex.get(right) ?? 0));
    layers.push(layer);
  }
  return layers;
}

/** Barycenter heuristic: pull nodes toward the average row of their neighbors. */
function orderLayersToReduceCrossings(
  layers: string[][],
  adjacency: Map<string, Set<string>>,
  orderIndex: Map<string, number>
): void {
  const predecessors = new Map<string, string[]>();
  for (const [from, targets] of adjacency) {
    for (const to of targets) {
      const list = predecessors.get(to) ?? [];
      list.push(from);
      predecessors.set(to, list);
    }
  }

  const passes = 4;
  for (let pass = 0; pass < passes; pass += 1) {
    if (pass % 2 === 0) {
      for (let rank = 1; rank < layers.length; rank += 1) {
        const previousIndex = indexInLayer(layers[rank - 1]!);
        layers[rank] = sortLayerByBarycenter(
          layers[rank]!,
          (key) => {
            const preds = (predecessors.get(key) ?? []).filter((item) => previousIndex.has(item));
            if (preds.length === 0) {
              return undefined;
            }
            return preds.reduce((sum, item) => sum + (previousIndex.get(item) ?? 0), 0) / preds.length;
          },
          orderIndex
        );
      }
    } else {
      for (let rank = layers.length - 2; rank >= 0; rank -= 1) {
        const nextIndex = indexInLayer(layers[rank + 1]!);
        layers[rank] = sortLayerByBarycenter(
          layers[rank]!,
          (key) => {
            const succs = [...(adjacency.get(key) ?? [])].filter((item) => nextIndex.has(item));
            if (succs.length === 0) {
              return undefined;
            }
            return succs.reduce((sum, item) => sum + (nextIndex.get(item) ?? 0), 0) / succs.length;
          },
          orderIndex
        );
      }
    }
  }
}

function indexInLayer(layer: string[]): Map<string, number> {
  return new Map(layer.map((key, index) => [key, index]));
}

function sortLayerByBarycenter(
  layer: string[],
  barycenterOf: (key: string) => number | undefined,
  orderIndex: Map<string, number>
): string[] {
  return [...layer].sort((left, right) => {
    const leftCenter = barycenterOf(left);
    const rightCenter = barycenterOf(right);
    if (leftCenter !== undefined && rightCenter !== undefined && leftCenter !== rightCenter) {
      return leftCenter - rightCenter;
    }
    if (leftCenter !== undefined && rightCenter === undefined) {
      return -1;
    }
    if (leftCenter === undefined && rightCenter !== undefined) {
      return 1;
    }
    return (orderIndex.get(left) ?? 0) - (orderIndex.get(right) ?? 0);
  });
}

export function nudgeStageLayout(
  workflow: WorkflowDefinition,
  stageKey: string,
  delta: { x: number; y: number }
): WorkflowDefinition {
  const ordered = [...workflow.stages].sort((left, right) => left.order - right.order);
  const index = ordered.findIndex((stage) => stage.stageKey === stageKey);
  const stage = workflow.stages.find((item) => item.stageKey === stageKey);
  if (!stage) {
    return workflow;
  }
  const layout = stageLayout(stage, Math.max(0, index));
  return updateStage(workflow, stageKey, {
    layout: { x: Math.max(0, layout.x + delta.x), y: Math.max(0, layout.y + delta.y) }
  });
}

export function catalogFromRelease(release: {
  forms?: Record<string, unknown>;
  queues?: Record<string, unknown>;
  slas?: Record<string, unknown>;
  bulkActions?: Record<string, unknown>;
  actions?: Record<string, { type?: string; transitionSetKey?: string; label?: string }>;
  scheduledActions?: Record<string, CatalogScheduledAction>;
}): WorkflowCatalog {
  const scheduledActions = release.scheduledActions ?? {};
  const scheduledByStage: Record<string, string[]> = {};
  for (const [key, scheduled] of Object.entries(scheduledActions)) {
    const stageKey = scheduled.trigger?.stageKey;
    if (typeof stageKey !== 'string' || !stageKey) {
      continue;
    }
    scheduledByStage[stageKey] = [...(scheduledByStage[stageKey] ?? []), key];
  }
  const forms = Object.keys(release.forms ?? {});
  const queues = Object.keys(release.queues ?? {});
  const slas = Object.keys(release.slas ?? {});
  const bulkActions = Object.keys(release.bulkActions ?? {});
  const actions = release.actions && Object.keys(release.actions).length > 0 ? release.actions : undefined;
  return {
    forms: forms.length > 0 ? forms : undefined,
    queues: queues.length > 0 ? queues : undefined,
    slas: slas.length > 0 ? slas : undefined,
    bulkActions: bulkActions.length > 0 ? bulkActions : undefined,
    actions,
    scheduledByStage: Object.keys(scheduledByStage).length > 0 ? scheduledByStage : undefined,
    scheduledActions: Object.keys(scheduledActions).length > 0 ? scheduledActions : undefined
  };
}

function outgoingEdges(
  workflow: WorkflowDefinition,
  stageKey: string,
  catalog: WorkflowCatalog
): WorkflowEdge[] {
  const stage = workflow.stages.find((item) => item.stageKey === stageKey);
  if (!stage || stage.terminal) {
    return [];
  }
  const sets = transitionSetsForStage(workflow, stage, catalog);
  const edges: WorkflowEdge[] = [];
  for (const set of sets) {
    if (set.defaultTargetStageKey) {
      edges.push({
        edgeId: `${set.transitionSetKey}:default:${stage.stageKey}->${set.defaultTargetStageKey}`,
        from: stage.stageKey,
        to: set.defaultTargetStageKey,
        label: 'Default',
        kind: 'default',
        transitionSetKey: set.transitionSetKey
      });
    }
    const orderedRules = [...set.rules].sort((left, right) => left.priority - right.priority);
    for (const rule of orderedRules) {
      edges.push({
        edgeId: `${set.transitionSetKey}:rule:${rule.ruleKey}:${stage.stageKey}->${rule.targetStageKey}`,
        from: stage.stageKey,
        to: rule.targetStageKey,
        label: rule.ruleKey,
        kind: 'rule',
        transitionSetKey: set.transitionSetKey,
        ruleKey: rule.ruleKey,
        priority: rule.priority
      });
    }
  }
  for (const [scheduledActionKey, scheduled] of Object.entries(catalog.scheduledActions ?? {})) {
    const trigger = scheduled.trigger ?? {};
    const action = scheduled.action ?? {};
    if (trigger.type !== 'STAGE_ENTERED' || trigger.stageKey !== stageKey) {
      continue;
    }
    if (action.type !== 'TRANSITION') {
      continue;
    }
    const targetStage =
      typeof action.targetStage === 'string' && action.targetStage ? action.targetStage : undefined;
    if (!targetStage) {
      continue;
    }
    const delaySummary = formatScheduledDelaySummary(scheduled.delay);
    edges.push({
      edgeId: `timer:${scheduledActionKey}:${stageKey}->${targetStage}`,
      from: stageKey,
      to: targetStage,
      label: scheduledActionKey,
      kind: 'timer',
      scheduledActionKey,
      delaySummary
    });
  }
  return edges;
}

function outgoingTargets(
  workflow: WorkflowDefinition,
  stageKey: string,
  catalog: WorkflowCatalog
): Array<[string, string]> {
  return outgoingEdges(workflow, stageKey, catalog).map((edge) => [edge.to, edge.label]);
}

export type OutboundBinding =
  | { kind: 'owned'; set: TransitionSet }
  | { kind: 'shared'; set: TransitionSet; ownerDisplayName: string }
  | { kind: 'none' };

export function outboundBinding(
  workflow: WorkflowDefinition,
  stage: StageDefinition,
  catalog: WorkflowCatalog = {}
): OutboundBinding {
  if (stage.terminal) {
    return { kind: 'none' };
  }
  const sets = transitionSetsForStage(workflow, stage, catalog);
  const set = sets[0];
  if (!set) {
    return { kind: 'none' };
  }
  const owner = ownerStageForSet(workflow, set.transitionSetKey, catalog);
  if (owner && owner.stageKey !== stage.stageKey) {
    return { kind: 'shared', set, ownerDisplayName: owner.displayName };
  }
  return { kind: 'owned', set };
}

export interface LaidOutEdge extends WorkflowEdge {
  d: string;
  labelX: number;
  labelY: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function layoutEdges(
  workflow: WorkflowDefinition,
  catalog: WorkflowCatalog,
  orderedStages: StageDefinition[]
): LaidOutEdge[] {
  const edges = listEdges(workflow, catalog);
  const positions = new Map(orderedStages.map((stage, index) => [stage.stageKey, stageLayout(stage, index)]));
  const plans: EdgePlan[] = edges.map((edge, id) => {
    const from = positions.get(edge.from) ?? { x: 0, y: 0 };
    const to = positions.get(edge.to) ?? { x: 0, y: 0 };
    const sides = edge.from === edge.to ? { startSide: 'right' as const, endSide: 'right' as const } : chooseSides(from, to);
    return {
      id,
      edge,
      from,
      to,
      startSide: sides.startSide,
      endSide: sides.endSide,
      channel: 'direct' as Channel,
      channelLane: 0,
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 }
    };
  });

  uncrossPlans(plans);
  assignPorts(plans);

  const overs = plans.filter((plan) => plan.channel === 'over');
  const unders = plans.filter((plan) => plan.channel === 'under');
  overs.forEach((plan, index) => {
    plan.channelLane = index;
  });
  unders.forEach((plan, index) => {
    plan.channelLane = index;
  });

  return plans.map((plan, index) => {
    if (plan.edge.from === plan.edge.to) {
      return routeSelfLoop(plan.from, plan.edge, index);
    }
    return pathForPlan(plan);
  });
}

type Point = { x: number; y: number };
type Side = 'left' | 'right' | 'top' | 'bottom';
type Channel = 'direct' | 'over' | 'under';

interface EdgePlan {
  id: number;
  edge: WorkflowEdge;
  from: Point;
  to: Point;
  startSide: Side;
  endSide: Side;
  channel: Channel;
  channelLane: number;
  start: Point;
  end: Point;
}

function chooseSides(from: Point, to: Point): { startSide: Side; endSide: Side } {
  const fromRight = from.x + STAGE_NODE_WIDTH;
  const fromLeft = from.x;
  const toRight = to.x + STAGE_NODE_WIDTH;
  const toLeft = to.x;
  const fromBottom = from.y + STAGE_NODE_HEIGHT;
  const fromTop = from.y;
  const toBottom = to.y + STAGE_NODE_HEIGHT;
  const toTop = to.y;
  if (toLeft >= fromRight + 16) {
    return { startSide: 'right', endSide: 'left' };
  }
  if (fromLeft >= toRight + 16) {
    return { startSide: 'bottom', endSide: 'bottom' };
  }
  if (toTop >= fromBottom + 16) {
    return { startSide: 'bottom', endSide: 'top' };
  }
  if (fromTop >= toBottom + 16) {
    return { startSide: 'top', endSide: 'bottom' };
  }
  return { startSide: 'right', endSide: 'right' };
}

function uncrossPlans(plans: EdgePlan[]): void {
  const open = plans.filter((plan) => plan.edge.from !== plan.edge.to);
  for (let i = 0; i < open.length; i += 1) {
    for (let j = i + 1; j < open.length; j += 1) {
      const left = open[i];
      const right = open[j];
      if (!left || !right || !centersCross(left, right) || !isForward(left) || !isForward(right)) {
        continue;
      }
      if (left.channel !== 'direct' && right.channel !== 'direct') {
        continue;
      }
      if (left.channel === 'direct' && right.channel === 'direct') {
        const down = left.to.y > left.from.y ? left : right;
        const up = down === left ? right : left;
        applyChannel(up, 'over');
        applyChannel(down, 'under');
        continue;
      }
      const direct = left.channel === 'direct' ? left : right;
      const detour = left.channel === 'direct' ? right : left;
      applyChannel(direct, detour.channel === 'over' ? 'under' : 'over');
    }
  }
}

function applyChannel(plan: EdgePlan, channel: Channel): void {
  plan.channel = channel;
  if (channel === 'over') {
    plan.startSide = 'left';
    plan.endSide = 'top';
  } else if (channel === 'under') {
    plan.startSide = 'right';
    plan.endSide = 'bottom';
  }
}

function isForward(plan: EdgePlan): boolean {
  return plan.to.x >= plan.from.x + STAGE_NODE_WIDTH + 16;
}

function centersCross(left: EdgePlan, right: EdgePlan): boolean {
  if (left.edge.from === right.edge.from || left.edge.to === right.edge.to) {
    return false;
  }
  if (left.edge.from === right.edge.to || left.edge.to === right.edge.from) {
    return false;
  }
  return segmentsIntersect(
    boxCenter(left.from),
    boxCenter(left.to),
    boxCenter(right.from),
    boxCenter(right.to)
  );
}

function boxCenter(pos: Point): Point {
  return { x: pos.x + STAGE_NODE_WIDTH / 2, y: pos.y + STAGE_NODE_HEIGHT / 2 };
}

function assignPorts(plans: EdgePlan[]): void {
  const buckets = new Map<string, EdgePlan[]>();
  for (const plan of plans) {
    if (plan.edge.from === plan.edge.to) {
      continue;
    }
    pushBucket(buckets, `${plan.edge.from}:${plan.startSide}:out`, plan);
    pushBucket(buckets, `${plan.edge.to}:${plan.endSide}:in`, plan);
  }
  for (const [key, group] of buckets) {
    const [, side, dir] = key.split(':') as [string, Side, 'out' | 'in'];
    const sample = group[0];
    if (!sample) {
      continue;
    }
    const origin = dir === 'out' ? sample.from : sample.to;
    group.sort((left, right) => portSort(left, right, side, dir === 'out'));
    group.forEach((plan, index) => {
      const point = portOnSide(origin, side, group.length === 1 ? 0.5 : index / (group.length - 1));
      if (dir === 'out') {
        plan.start = point;
      } else {
        plan.end = point;
      }
    });
  }
}

function pushBucket(buckets: Map<string, EdgePlan[]>, key: string, plan: EdgePlan): void {
  const group = buckets.get(key);
  if (group) {
    group.push(plan);
  } else {
    buckets.set(key, [plan]);
  }
}

function portSort(left: EdgePlan, right: EdgePlan, side: Side, outgoing: boolean): number {
  const leftOther = outgoing ? left.to : left.from;
  const rightOther = outgoing ? right.to : right.from;
  const leftMid = side === 'top' || side === 'bottom' ? leftOther.x : leftOther.y;
  const rightMid = side === 'top' || side === 'bottom' ? rightOther.x : rightOther.y;
  if (leftMid !== rightMid) {
    return leftMid - rightMid;
  }
  return left.edge.label.localeCompare(right.edge.label);
}

function portOnSide(pos: Point, side: Side, t: number): Point {
  const alongX = pos.x + PORT_INSET + t * (STAGE_NODE_WIDTH - 2 * PORT_INSET);
  const alongY = pos.y + PORT_INSET + t * (STAGE_NODE_HEIGHT - 2 * PORT_INSET);
  if (side === 'right') {
    return { x: pos.x + STAGE_NODE_WIDTH, y: alongY };
  }
  if (side === 'left') {
    return { x: pos.x, y: alongY };
  }
  if (side === 'top') {
    return { x: alongX, y: pos.y };
  }
  return { x: alongX, y: pos.y + STAGE_NODE_HEIGHT };
}

function pathForPlan(plan: EdgePlan): LaidOutEdge {
  const start = plan.start;
  const end = plan.end;
  if (plan.channel === 'over' || plan.channel === 'under') {
    return routeAround(plan);
  }
  if (plan.startSide === 'right' && plan.endSide === 'left') {
    const midX = start.x + (end.x - start.x) / 2;
    const bow = Math.abs(end.y - start.y) < 12 ? Math.min(36, (end.x - start.x) / 3.5) : 0;
    return laidOutPath(
      plan.edge,
      `M ${start.x} ${start.y} C ${midX} ${start.y - bow}, ${midX} ${end.y - bow}, ${end.x} ${end.y}`,
      midX,
      (start.y + end.y) / 2 - bow - 10
    );
  }
  if (plan.startSide === 'bottom' && plan.endSide === 'bottom') {
    const y = Math.max(plan.from.y + STAGE_NODE_HEIGHT, plan.to.y + STAGE_NODE_HEIGHT) + 40 + plan.channelLane * 18;
    return laidOutPath(
      plan.edge,
      `M ${start.x} ${start.y} C ${start.x} ${y}, ${end.x} ${y}, ${end.x} ${end.y}`,
      (start.x + end.x) / 2,
      y - 10
    );
  }
  if (plan.startSide === 'bottom' && plan.endSide === 'top') {
    const midY = start.y + (end.y - start.y) / 2;
    const bow = Math.abs(end.x - start.x) < 12 ? Math.min(28, (end.y - start.y) / 3.5) : 0;
    return laidOutPath(
      plan.edge,
      `M ${start.x} ${start.y} C ${start.x + bow} ${midY}, ${end.x + bow} ${midY}, ${end.x} ${end.y}`,
      (start.x + end.x) / 2 + bow,
      midY - 10
    );
  }
  if (plan.startSide === 'top' && plan.endSide === 'bottom') {
    const midY = end.y + (start.y - end.y) / 2;
    const bow = Math.abs(end.x - start.x) < 12 ? Math.min(28, (start.y - end.y) / 3.5) : 0;
    return laidOutPath(
      plan.edge,
      `M ${start.x} ${start.y} C ${start.x + bow} ${midY}, ${end.x + bow} ${midY}, ${end.x} ${end.y}`,
      (start.x + end.x) / 2 + bow,
      midY - 10
    );
  }
  const xClear = Math.max(plan.from.x + STAGE_NODE_WIDTH, plan.to.x + STAGE_NODE_WIDTH) + 40 + plan.channelLane * 16;
  return laidOutPath(
    plan.edge,
    `M ${start.x} ${start.y} C ${xClear} ${start.y}, ${xClear} ${end.y}, ${end.x} ${end.y}`,
    xClear + 8,
    (start.y + end.y) / 2 - 12
  );
}

function routeAround(plan: EdgePlan): LaidOutEdge {
  const start = plan.start;
  const end = plan.end;
  const lane = plan.channelLane;
  if (plan.channel === 'over') {
    const xClear = Math.min(plan.from.x, plan.to.x) - 28 - lane * 16;
    const highway = Math.min(plan.from.y, plan.to.y) - 36 - lane * 22;
    const points = [start, { x: xClear, y: start.y }, { x: xClear, y: highway }, { x: end.x, y: highway }, end];
    return laidOutPath(plan.edge, filletedPath(points, 16), (xClear + end.x) / 2, highway - 8);
  }
  const xLeave = start.x + 24 + lane * 12;
  const highway =
    Math.max(plan.from.y + STAGE_NODE_HEIGHT, plan.to.y + STAGE_NODE_HEIGHT) + 36 + lane * 22;
  const points = [start, { x: xLeave, y: start.y }, { x: xLeave, y: highway }, { x: end.x, y: highway }, end];
  return laidOutPath(plan.edge, filletedPath(points, 16), (xLeave + end.x) / 2, highway - 8);
}

function filletedPath(points: Point[], radius: number): string {
  const first = points[0];
  if (!first) {
    return '';
  }
  let d = `M ${first.x} ${first.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const prev = points[index - 1]!;
    const curr = points[index]!;
    const next = points[index + 1]!;
    const incoming = normalize({ x: curr.x - prev.x, y: curr.y - prev.y });
    const outgoing = normalize({ x: next.x - curr.x, y: next.y - curr.y });
    const inLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const outLen = Math.hypot(next.x - curr.x, next.y - curr.y);
    const corner = Math.min(radius, inLen / 2, outLen / 2);
    d += ` L ${curr.x - incoming.x * corner} ${curr.y - incoming.y * corner}`;
    d += ` Q ${curr.x} ${curr.y} ${curr.x + outgoing.x * corner} ${curr.y + outgoing.y * corner}`;
  }
  const last = points[points.length - 1]!;
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function normalize(vector: Point): Point {
  const length = Math.hypot(vector.x, vector.y) || 1;
  return { x: vector.x / length, y: vector.y / length };
}

function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-6) {
    return false;
  }
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
}

function routeSelfLoop(from: { x: number; y: number }, edge: WorkflowEdge, lane: number): LaidOutEdge {
  const w = STAGE_NODE_WIDTH;
  const h = STAGE_NODE_HEIGHT;
  const y1 = from.y + h / 2 - 14;
  const y2 = from.y + h / 2 + 14;
  const x = from.x + w;
  const bulge = x + LOOP_OUTSET + lane * 14;
  return laidOutPath(
    edge,
    `M ${x} ${y1} C ${bulge} ${y1}, ${bulge} ${y2}, ${x} ${y2}`,
    bulge + 8,
    from.y + h / 2 - 6
  );
}

function laidOutPath(edge: WorkflowEdge, d: string, labelX: number, labelY: number): LaidOutEdge {
  const points = [...d.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2])
  }));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    ...edge,
    d,
    labelX,
    labelY,
    left: (xs.length ? Math.min(...xs) : 0) - 24,
    top: (ys.length ? Math.min(...ys) : 0) - 24,
    right: (xs.length ? Math.max(...xs) : 0) + 24,
    bottom: (ys.length ? Math.max(...ys) : 0) + 24
  };
}

function ownerStageForSet(
  workflow: WorkflowDefinition,
  transitionSetKey: string,
  catalog: WorkflowCatalog
): StageDefinition | undefined {
  const ordered = [...workflow.stages].sort((left, right) => left.order - right.order);
  const explicit = ordered.find((stage) => !stage.terminal && stage.transitionSetKey === transitionSetKey);
  if (explicit) {
    return explicit;
  }
  return ordered.find((stage) => {
    if (stage.terminal || stage.transitionSetKey) {
      return false;
    }
    return transitionSetsForStage(workflow, stage, catalog).some((set) => set.transitionSetKey === transitionSetKey);
  });
}

function firstTransitionActionKey(catalog: WorkflowCatalog): string | undefined {
  const actions = catalog.actions ?? {};
  if (actions.COMPLETE && (actions.COMPLETE.type ?? 'TRANSITION') === 'TRANSITION') {
    return 'COMPLETE';
  }
  return Object.entries(actions).find(([, action]) => (action.type ?? 'TRANSITION') === 'TRANSITION')?.[0];
}

function transitionSetsForStage(
  workflow: WorkflowDefinition,
  stage: StageDefinition,
  catalog: WorkflowCatalog
) {
  if (stage.transitionSetKey) {
    const owned = workflow.transitionSets.find((item) => item.transitionSetKey === stage.transitionSetKey);
    return owned ? [owned] : [];
  }
  const fromActions = stage.actionKeys
    .map((actionKey) => catalog.actions?.[actionKey]?.transitionSetKey)
    .filter((key): key is string => Boolean(key))
    .map((key) => workflow.transitionSets.find((item) => item.transitionSetKey === key))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (fromActions.length > 0) {
    return fromActions;
  }
  if (!catalog.actions) {
    return workflow.transitionSets;
  }
  return [];
}

function reachableStages(workflow: WorkflowDefinition, catalog: WorkflowCatalog): Set<string> {
  const reachable = new Set<string>();
  const queue = workflow.initialStageKey ? [workflow.initialStageKey] : [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || reachable.has(current)) {
      continue;
    }
    reachable.add(current);
    for (const [target] of outgoingTargets(workflow, current, catalog)) {
      queue.push(target);
    }
  }
  return reachable;
}

export function findCycles(workflow: WorkflowDefinition, catalog: WorkflowCatalog = {}): string[] {
  const edges = new Map<string, string[]>();
  for (const stage of workflow.stages) {
    edges.set(
      stage.stageKey,
      [...new Set(outgoingTargets(workflow, stage.stageKey, catalog).map(([target]) => target))]
    );
  }
  const cycles: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function walk(node: string, trail: string[]): void {
    if (visiting.has(node)) {
      const start = trail.indexOf(node);
      cycles.push([...trail.slice(start), node].join(' → '));
      return;
    }
    if (visited.has(node)) {
      return;
    }
    visiting.add(node);
    for (const next of edges.get(node) ?? []) {
      walk(next, [...trail, node]);
    }
    visiting.delete(node);
    visited.add(node);
  }
  for (const stage of workflow.stages) {
    walk(stage.stageKey, []);
  }
  return [...new Set(cycles)];
}

export interface RulePathOption {
  value: string;
  label: string;
  /** Optgroup heading in path pickers (form · section, or Workflow). */
  group?: string;
  choices?: Array<{ value: string; label: string }>;
  valueKind?: 'date' | 'text';
}

/** Form fields that can be copied onto a queue row (Catalog projected fields). */
export interface ProjectableFormFieldOption {
  fieldKey: string;
  label: string;
  path: string;
  group: string;
}

const WORKFLOW_PATH_GROUP = 'Workflow';

/**
 * Forms for designer pickers, ordered by earliest linked workflow stage `order`,
 * then title. Unlinked forms sort after linked ones.
 */
export function listFormsInWorkflowOrder(
  forms: Record<string, StageFormDefinition>,
  workflow?: WorkflowDefinition
): StageFormDefinition[] {
  return listCatalogInWorkflowOrder(forms, workflow, 'formKey', (item) => item.title || item.formKey);
}

/**
 * Queues for Catalog designer lists, ordered by earliest linked workflow stage `order`,
 * then display name. Unlinked queues sort after linked ones.
 */
export function listQueuesInWorkflowOrder(
  queues: Record<string, QueueDefinition>,
  workflow?: WorkflowDefinition
): QueueDefinition[] {
  return listCatalogInWorkflowOrder(queues, workflow, 'queueKey', (item) => item.displayName || item.queueKey);
}

function listCatalogInWorkflowOrder<T extends Record<string, unknown>>(
  items: Record<string, T>,
  workflow: WorkflowDefinition | undefined,
  stageLinkKey: 'formKey' | 'queueKey',
  labelOf: (item: T) => string
): T[] {
  const stageOrder = new Map<string, number>();
  for (const stage of workflow?.stages ?? []) {
    const key = String(stage[stageLinkKey] ?? '').trim();
    if (!key) {
      continue;
    }
    const order = typeof stage.order === 'number' ? stage.order : Number.MAX_SAFE_INTEGER;
    const previous = stageOrder.get(key);
    if (previous === undefined || order < previous) {
      stageOrder.set(key, order);
    }
  }
  return Object.values(items).sort((left, right) => {
    const leftKey = String(left[stageLinkKey] ?? '');
    const rightKey = String(right[stageLinkKey] ?? '');
    const leftOrder = stageOrder.get(leftKey);
    const rightOrder = stageOrder.get(rightKey);
    if (leftOrder !== undefined && rightOrder !== undefined && leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    if (leftOrder !== undefined && rightOrder === undefined) {
      return -1;
    }
    if (leftOrder === undefined && rightOrder !== undefined) {
      return 1;
    }
    return labelOf(left).localeCompare(labelOf(right), undefined, { sensitivity: 'base' });
  });
}

export function listRulePathOptions(
  forms: Record<string, StageFormDefinition> = {},
  options?: {
    /**
     * Form behaviors: include every field on this formKey, plus shared-root fields
     * (`$.workload.*` / `$.mailItem.*`) from any form. Omits other stages’ local folders
     * so cloned Receipt Number / etc. do not flood the When dropdown.
     */
    formBehaviorFocus?: string;
  }
): RulePathOption[] {
  const pathOptions: RulePathOption[] = [
    { value: '$workflow.currentStageKey', label: 'Current stage', group: WORKFLOW_PATH_GROUP },
    { value: '$workflow.assignedTo', label: 'Assigned to', group: WORKFLOW_PATH_GROUP }
  ];
  const seen = new Set(pathOptions.map((item) => item.value));
  const focusKey = options?.formBehaviorFocus?.trim();
  // Prefer the form being edited so shared fields hosted there win labels/choices when
  // the same $.workload.* / $.mailItem.* path also appears on another stage form.
  const formList = Object.values(forms).sort((left, right) => {
    if (!focusKey) {
      return 0;
    }
    if (left.formKey === focusKey) {
      return -1;
    }
    if (right.formKey === focusKey) {
      return 1;
    }
    return 0;
  });
  for (const form of formList) {
    const formTitle = form.title?.trim() || form.formKey || 'Form';
    for (const section of form.sections ?? []) {
      const sectionTitle = section.title?.trim() || section.sectionKey || 'Section';
      for (const field of section.fields ?? []) {
        if (!field.path?.trim()) {
          continue;
        }
        const shared = isSharedEntityPath(field.path);
        if (focusKey && form.formKey !== focusKey && !shared) {
          continue;
        }
        const value = shared ? field.path.trim() : joinJsonPath(form.dataPath || '$', field.path);
        if (seen.has(value)) {
          continue;
        }
        seen.add(value);
        const fieldLabel = field.label?.trim() || field.fieldKey || value;
        // Same case path can be hosted on many stage UIs — group by shared root, not host form.
        const sharedRoot = sharedRootOfPath(field.path)?.replace(/^\$\./, '');
        const group = shared && sharedRoot
          ? `Shared · ${sharedRoot}`
          : `${formTitle} · ${sectionTitle}`;
        pathOptions.push({
          value,
          // Include the case path so authors can find $.workload.workloadStatus by scanning the list.
          label: `${fieldLabel} · ${value}`,
          group,
          choices: fieldValueChoices(field),
          valueKind: field.component === 'DATE_INPUT' ? 'date' : 'text'
        });
      }
    }
  }
  return pathOptions;
}

/**
 * Business-data form fields for Catalog queue projection pickers.
 * Forms are walked in workflow stage order (same as the Form dropdown).
 * Paths are case-absolute (same as transition/behavior When paths).
 */
export function listProjectableFormFields(
  forms: Record<string, StageFormDefinition>,
  workflow?: WorkflowDefinition
): ProjectableFormFieldOption[] {
  const options: ProjectableFormFieldOption[] = [];
  const seenPaths = new Set<string>();
  for (const form of listFormsInWorkflowOrder(forms, workflow)) {
    const formTitle = form.title?.trim() || form.formKey || 'Form';
    for (const section of form.sections ?? []) {
      const sectionTitle = section.title?.trim() || section.sectionKey || 'Section';
      for (const field of section.fields ?? []) {
        if (!field.fieldKey?.trim() || !field.path?.trim()) {
          continue;
        }
        const shared = isSharedEntityPath(field.path);
        const path = shared ? field.path.trim() : joinJsonPath(form.dataPath || '$', field.path);
        if (seenPaths.has(path)) {
          continue;
        }
        seenPaths.add(path);
        const sharedRoot = sharedRootOfPath(field.path)?.replace(/^\$\./, '');
        const group =
          shared && sharedRoot ? `Shared · ${sharedRoot}` : `${formTitle} · ${sectionTitle}`;
        options.push({
          fieldKey: field.fieldKey.trim(),
          label: field.label?.trim() || field.fieldKey,
          path,
          group
        });
      }
    }
  }
  return options;
}

/** Preserve first-seen group order for `<optgroup>` rendering. */
export function groupRulePathOptions(
  pathOptions: RulePathOption[]
): Array<{ group: string; items: RulePathOption[] }> {
  const order: string[] = [];
  const byGroup = new Map<string, RulePathOption[]>();
  for (const item of pathOptions) {
    const group = item.group?.trim() || 'Fields';
    if (!byGroup.has(group)) {
      order.push(group);
      byGroup.set(group, []);
    }
    byGroup.get(group)!.push(item);
  }
  return order.map((group) => ({ group, items: byGroup.get(group)! }));
}

function fieldValueChoices(field: FormFieldDefinition): Array<{ value: string; label: string }> | undefined {
  if (field.options && field.options.length > 0) {
    return field.options.map((option) => ({ value: option.value, label: option.label }));
  }
  if (field.component === 'YES_NO_RADIO') {
    return [
      { value: 'Yes', label: 'Yes' },
      { value: 'No', label: 'No' }
    ];
  }
  if (field.component === 'BOOLEAN_CHECKBOX') {
    return [
      { value: 'true', label: 'True' },
      { value: 'false', label: 'False' }
    ];
  }
  return undefined;
}
