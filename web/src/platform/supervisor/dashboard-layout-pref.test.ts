import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canNudgeDashboardTile,
  DASHBOARD_TILES,
  DEFAULT_DASHBOARD_LAYOUT,
  dashboardLayoutPrefKey,
  moveDashboardTile,
  normalizeDashboardLayout,
  nudgeDashboardTile,
  readDashboardLayout,
  visibleTiles,
  writeDashboardLayout
} from './dashboard-layout-pref.js';

function stubLocalStorage(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    }
  });
  return store;
}

describe('dashboard layout prefs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to all tiles visible in the default columns', () => {
    stubLocalStorage();
    expect(readDashboardLayout('supervisor@example.gov')).toEqual(DEFAULT_DASHBOARD_LAYOUT);
  });

  it('persists columns and visibility per actor id', () => {
    const store = stubLocalStorage();
    writeDashboardLayout('a@example.gov', {
      left: ['activity', 'attention', 'stages', 'assignees', 'find'],
      right: ['kpiLoggedToday', 'kpiOpenBacklog', 'kpiPastSla', 'filters', 'pressure'],
      visible: { ...DEFAULT_DASHBOARD_LAYOUT.visible, activity: false }
    });
    const saved = store.get(dashboardLayoutPrefKey('a@example.gov')) ?? '';
    expect(saved).toContain('"activity":false');
    expect(readDashboardLayout('a@example.gov').left[0]).toBe('activity');
    expect(readDashboardLayout('a@example.gov').visible.activity).toBe(false);
    expect(readDashboardLayout('b@example.gov').visible.activity).toBe(true);
  });

  it('migrates the earlier flat boolean map', () => {
    expect(
      normalizeDashboardLayout({
        filters: true,
        attention: false,
        stages: true,
        assignees: true,
        pressure: true,
        activity: false
      })
    ).toEqual({
      left: [...DEFAULT_DASHBOARD_LAYOUT.left],
      right: [...DEFAULT_DASHBOARD_LAYOUT.right],
      visible: {
        ...DEFAULT_DASHBOARD_LAYOUT.visible,
        attention: false,
        activity: false
      }
    });
  });

  it('migrates the older single-list order into two columns', () => {
    const next = normalizeDashboardLayout({
      order: ['filters', 'attention', 'stages', 'assignees', 'pressure', 'activity'],
      visible: { activity: false }
    });
    expect(next.left[0]).toBe('filters');
    expect(new Set([...next.left, ...next.right]).size).toBe(DASHBOARD_TILES.length);
    expect(next.visible.activity).toBe(false);
  });

  it('moves a tile between columns', () => {
    const next = moveDashboardTile(DEFAULT_DASHBOARD_LAYOUT, 'attention', 'right', 1);
    expect(next.left).not.toContain('attention');
    expect(next.right[1]).toBe('attention');
  });

  it('nudges a tile within and across columns for keyboard rearrange', () => {
    const up = nudgeDashboardTile(DEFAULT_DASHBOARD_LAYOUT, 'attention', 'up');
    expect(up?.left.indexOf('attention')).toBe(0);
    expect(nudgeDashboardTile(up!, 'attention', 'up')).toBeNull();
    expect(canNudgeDashboardTile(DEFAULT_DASHBOARD_LAYOUT, 'attention', 'left')).toBe(false);
    const across = nudgeDashboardTile(DEFAULT_DASHBOARD_LAYOUT, 'attention', 'right');
    expect(across?.left).not.toContain('attention');
    expect(across?.right).toContain('attention');
  });

  it('hides find from visible tiles when includeFind is false', () => {
    expect(visibleTiles(DEFAULT_DASHBOARD_LAYOUT, 'left', { includeFind: false })).not.toContain(
      'find'
    );
    expect(visibleTiles(DEFAULT_DASHBOARD_LAYOUT, 'left')).toContain('find');
  });
});
