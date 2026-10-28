export const DASHBOARD_TILES = [
  'find',
  'kpiLoggedToday',
  'kpiOpenBacklog',
  'kpiPastSla',
  'filters',
  'attention',
  'stages',
  'assignees',
  'pressure',
  'activity'
] as const;

export type DashboardTileId = (typeof DASHBOARD_TILES)[number];
export type DashboardColumnId = 'left' | 'right';

export interface DashboardLayoutPrefs {
  left: DashboardTileId[];
  right: DashboardTileId[];
  visible: Record<DashboardTileId, boolean>;
}

const ALL_VISIBLE: Record<DashboardTileId, boolean> = {
  find: true,
  kpiLoggedToday: true,
  kpiOpenBacklog: true,
  kpiPastSla: true,
  filters: true,
  attention: true,
  stages: true,
  assignees: true,
  pressure: true,
  activity: true
};

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayoutPrefs = {
  left: ['find', 'attention', 'stages', 'assignees', 'activity'],
  right: ['kpiLoggedToday', 'kpiOpenBacklog', 'kpiPastSla', 'filters', 'pressure'],
  visible: { ...ALL_VISIBLE }
};

export const DASHBOARD_TILE_LABELS: Record<DashboardTileId, string> = {
  find: 'Find a case',
  kpiLoggedToday: 'Logged today',
  kpiOpenBacklog: 'Open backlog',
  kpiPastSla: 'Past SLA',
  filters: 'Dashboard filters',
  attention: 'Needs attention',
  stages: 'Stages',
  assignees: 'By assignee',
  pressure: 'Where the pressure is',
  activity: 'Recent activity'
};

/** @deprecated kept for migration typing */
export type DashboardLayoutSection = DashboardTileId;

export function dashboardLayoutPrefKey(actorId: string): string {
  const id = actorId.trim() || 'default';
  return `optic.supervisor.layout.${id}`;
}

function isTile(value: unknown): value is DashboardTileId {
  return typeof value === 'string' && (DASHBOARD_TILES as readonly string[]).includes(value);
}

function normalizeVisible(raw: unknown): Record<DashboardTileId, boolean> {
  const visible = { ...ALL_VISIBLE };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return visible;
  }
  const record = raw as Record<string, unknown>;
  for (const tile of DASHBOARD_TILES) {
    if (typeof record[tile] === 'boolean') {
      visible[tile] = record[tile];
    }
  }
  // Older section-only prefs
  if (typeof record.filters === 'boolean') visible.filters = record.filters;
  if (typeof record.attention === 'boolean') visible.attention = record.attention;
  if (typeof record.stages === 'boolean') visible.stages = record.stages;
  if (typeof record.assignees === 'boolean') visible.assignees = record.assignees;
  if (typeof record.pressure === 'boolean') visible.pressure = record.pressure;
  if (typeof record.activity === 'boolean') visible.activity = record.activity;
  return visible;
}

function normalizeColumn(raw: unknown): DashboardTileId[] {
  const seen = new Set<DashboardTileId>();
  const column: DashboardTileId[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (isTile(item) && !seen.has(item)) {
        seen.add(item);
        column.push(item);
      }
    }
  }
  return column;
}

function completePlacement(
  left: DashboardTileId[],
  right: DashboardTileId[]
): { left: DashboardTileId[]; right: DashboardTileId[] } {
  const placed = new Set([...left, ...right]);
  const nextLeft = [...left];
  const nextRight = [...right];
  for (const tile of DEFAULT_DASHBOARD_LAYOUT.left) {
    if (!placed.has(tile)) {
      nextLeft.push(tile);
      placed.add(tile);
    }
  }
  for (const tile of DEFAULT_DASHBOARD_LAYOUT.right) {
    if (!placed.has(tile)) {
      nextRight.push(tile);
      placed.add(tile);
    }
  }
  for (const tile of DASHBOARD_TILES) {
    if (!placed.has(tile)) {
      nextLeft.push(tile);
      placed.add(tile);
    }
  }
  return { left: nextLeft, right: nextRight };
}

/** Accepts left/right board prefs, older `{ order, visible }`, or flat booleans. */
export function normalizeDashboardLayout(raw: unknown): DashboardLayoutPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      left: [...DEFAULT_DASHBOARD_LAYOUT.left],
      right: [...DEFAULT_DASHBOARD_LAYOUT.right],
      visible: { ...ALL_VISIBLE }
    };
  }
  const record = raw as Record<string, unknown>;
  const visible = normalizeVisible(
    'visible' in record && record.visible && typeof record.visible === 'object'
      ? record.visible
      : record
  );

  if (Array.isArray(record.left) || Array.isArray(record.right)) {
    const placed = completePlacement(normalizeColumn(record.left), normalizeColumn(record.right));
    return { ...placed, visible };
  }

  if (Array.isArray(record.order)) {
    const order = normalizeColumn(record.order);
    const mid = Math.ceil(order.length / 2);
    const placed = completePlacement(order.slice(0, mid), order.slice(mid));
    return { ...placed, visible };
  }

  return {
    left: [...DEFAULT_DASHBOARD_LAYOUT.left],
    right: [...DEFAULT_DASHBOARD_LAYOUT.right],
    visible
  };
}

export function readDashboardLayout(actorId: string): DashboardLayoutPrefs {
  try {
    const raw = window.localStorage.getItem(dashboardLayoutPrefKey(actorId));
    if (!raw) {
      return normalizeDashboardLayout(null);
    }
    return normalizeDashboardLayout(JSON.parse(raw) as unknown);
  } catch {
    return normalizeDashboardLayout(null);
  }
}

export function writeDashboardLayout(actorId: string, prefs: DashboardLayoutPrefs): void {
  try {
    window.localStorage.setItem(
      dashboardLayoutPrefKey(actorId),
      JSON.stringify({
        left: prefs.left,
        right: prefs.right,
        visible: prefs.visible
      })
    );
  } catch {
    // ignore quota / private mode
  }
}

export function visibleTiles(
  prefs: DashboardLayoutPrefs,
  column: DashboardColumnId,
  opts?: { includeFind?: boolean }
): DashboardTileId[] {
  const includeFind = opts?.includeFind !== false;
  return prefs[column].filter((tile) => {
    if (tile === 'find' && !includeFind) {
      return false;
    }
    return prefs.visible[tile];
  });
}

export function moveDashboardTile(
  prefs: DashboardLayoutPrefs,
  tileId: DashboardTileId,
  targetColumn: DashboardColumnId,
  targetIndex: number
): DashboardLayoutPrefs {
  const left = prefs.left.filter((tile) => tile !== tileId);
  const right = prefs.right.filter((tile) => tile !== tileId);
  const column = targetColumn === 'left' ? left : right;
  const index = Math.max(0, Math.min(targetIndex, column.length));
  column.splice(index, 0, tileId);
  return {
    left: targetColumn === 'left' ? column : left,
    right: targetColumn === 'right' ? column : right,
    visible: prefs.visible
  };
}

export type DashboardNudgeDirection = 'up' | 'down' | 'left' | 'right';

export function columnForTile(
  prefs: DashboardLayoutPrefs,
  tileId: DashboardTileId
): DashboardColumnId | null {
  if (prefs.left.includes(tileId)) {
    return 'left';
  }
  if (prefs.right.includes(tileId)) {
    return 'right';
  }
  return null;
}

/** Keyboard / menu nudge among currently visible tiles. Returns null when the move is a no-op. */
export function nudgeDashboardTile(
  prefs: DashboardLayoutPrefs,
  tileId: DashboardTileId,
  direction: DashboardNudgeDirection,
  opts?: { includeFind?: boolean }
): DashboardLayoutPrefs | null {
  const column = columnForTile(prefs, tileId);
  if (!column) {
    return null;
  }
  const visible = visibleTiles(prefs, column, opts);
  const index = visible.indexOf(tileId);
  if (index < 0) {
    return null;
  }

  if (direction === 'up') {
    if (index === 0) {
      return null;
    }
    const previous = visible[index - 1]!;
    return moveDashboardTile(prefs, tileId, column, prefs[column].indexOf(previous));
  }

  if (direction === 'down') {
    if (index >= visible.length - 1) {
      return null;
    }
    const next = visible[index + 1]!;
    return moveDashboardTile(prefs, tileId, column, prefs[column].indexOf(next) + 1);
  }

  const targetColumn: DashboardColumnId = direction === 'left' ? 'left' : 'right';
  if (column === targetColumn) {
    return null;
  }
  const targetVisible = visibleTiles(prefs, targetColumn, opts);
  if (index >= targetVisible.length) {
    return moveDashboardTile(prefs, tileId, targetColumn, prefs[targetColumn].length);
  }
  const anchor = targetVisible[index]!;
  return moveDashboardTile(prefs, tileId, targetColumn, prefs[targetColumn].indexOf(anchor));
}

export function canNudgeDashboardTile(
  prefs: DashboardLayoutPrefs,
  tileId: DashboardTileId,
  direction: DashboardNudgeDirection,
  opts?: { includeFind?: boolean }
): boolean {
  return nudgeDashboardTile(prefs, tileId, direction, opts) != null;
}

export function allTilesInOrder(prefs: DashboardLayoutPrefs): DashboardTileId[] {
  return [...prefs.left, ...prefs.right];
}
