import { useEffect, useMemo, useRef, useState } from 'react';
import { asDisplayError, type DisplayError } from '../api/apply-api-error.js';
import { listDefinitions, listReleaseCatalog } from '../designers/config-api.js';
import { useFeatureFlags } from '../features/FeatureFlagsContext.js';
import { SearchScreen } from '../search/SearchScreen.js';
import type { SearchHit } from '../search/search-api.js';
import { CaughtErrorBanner } from '../ui/CaughtErrorBanner.js';
import { ButtonLabel } from '../ui/Icon.js';
import { PagerControls } from '../ui/PagerControls.js';
import { formatSlaStateLabel } from '../ui/sla-label.js';
import { StatusToast } from '../ui/StatusToast.js';
import { groupWorkKinds, type WorkKind } from '../workspace/kind-catalog.js';
import {
  resolveWorkloadTypeSelection,
  writeWorkloadTypePref
} from '../workspace/workload-type-pref.js';
import { WorkloadTypeSelect } from '../workspace/WorkloadTypeSelect.js';
import { getCurrentOfficerId } from '../actors/demo-officers.js';
import { fetchSupervisorDashboard, type SupervisorDashboard } from './dashboard-api.js';
import { DashboardBoard } from './DashboardBoard.js';
import { DashboardLayoutMenu } from './DashboardLayoutMenu.js';
import {
  DEFAULT_DASHBOARD_LAYOUT,
  readDashboardLayout,
  writeDashboardLayout,
  type DashboardLayoutPrefs,
  type DashboardTileId
} from './dashboard-layout-pref.js';
import { requestAppView } from '../navigation/app-navigation.js';
import { TrackingIdLinkWithCopy } from '../tracking/TrackingIdDisplay.js';

type ActionFilter = 'all' | 'late' | 'unassigned' | { assignee: string };

const ATTENTION_PAGE_SIZE_KEY = 'optic.supervisor.attentionPageSize';
const ACTIVITY_PAGE_SIZE_KEY = 'optic.supervisor.activityPageSize';
const ASSIGNEE_PAGE_SIZE_KEY = 'optic.supervisor.assigneePageSize';
const DASHBOARD_REFRESH_MS = 60_000;
const LIST_PAGE_SIZES = [5, 10, 25] as const;
const EMPTY_ACTIVITY: SupervisorDashboard['recentActivity'] = [];

function readListPageSize(key: string): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) {
      return 5;
    }
    const parsed = Number(raw);
    if (LIST_PAGE_SIZES.some((size) => size === parsed)) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return 5;
}

export function SupervisorWorkspace() {
  const { isEnabled } = useFeatureFlags();
  const searchEnabled = isEnabled('ui.workspace.search');
  const [kinds, setKinds] = useState<WorkKind[]>([]);
  const [kindsReady, setKindsReady] = useState(false);
  const [selectedKindKey, setSelectedKindKey] = useState<string | undefined>();
  const [dashboard, setDashboard] = useState<SupervisorDashboard | null>(null);
  const [dimensionFilters, setDimensionFilters] = useState<Record<string, string>>({});
  const [openedHit, setOpenedHit] = useState<SearchHit | undefined>();
  const [busy, setBusy] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [refreshToast, setRefreshToast] = useState<string>();
  const [errorSummary, setErrorSummary] = useState<DisplayError | undefined>();
  const lastKpisRef = useRef<SupervisorDashboard['kpis'] | null>(null);
  const dimensionFiltersRef = useRef<Record<string, string>>({});
  dimensionFiltersRef.current = dimensionFilters;
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all');
  const [attentionPageSize, setAttentionPageSize] = useState(() =>
    readListPageSize(ATTENTION_PAGE_SIZE_KEY)
  );
  const [attentionPage, setAttentionPage] = useState(1);
  const [activityPageSize, setActivityPageSize] = useState(() =>
    readListPageSize(ACTIVITY_PAGE_SIZE_KEY)
  );
  const [activityPage, setActivityPage] = useState(1);
  const [assigneePageSize, setAssigneePageSize] = useState(() =>
    readListPageSize(ASSIGNEE_PAGE_SIZE_KEY)
  );
  const [assigneePage, setAssigneePage] = useState(1);
  const [layoutPrefs, setLayoutPrefs] = useState<DashboardLayoutPrefs>(() =>
    readDashboardLayout(getCurrentOfficerId())
  );
  const openedCaseRef = useRef<HTMLElement | null>(null);
  const actionQueueRef = useRef<HTMLElement | null>(null);
  const assigneeCasesRef = useRef<HTMLElement | null>(null);
  const definitionKeysRef = useRef<string[]>([]);

  function chooseAttentionPageSize(next: number) {
    setAttentionPageSize(next);
    setAttentionPage(1);
    try {
      window.localStorage.setItem(ATTENTION_PAGE_SIZE_KEY, String(next));
    } catch {
      // ignore
    }
  }

  function chooseActivityPageSize(next: number) {
    setActivityPageSize(next);
    setActivityPage(1);
    try {
      window.localStorage.setItem(ACTIVITY_PAGE_SIZE_KEY, String(next));
    } catch {
      // ignore
    }
  }

  function chooseAssigneePageSize(next: number) {
    setAssigneePageSize(next);
    setAssigneePage(1);
    try {
      window.localStorage.setItem(ASSIGNEE_PAGE_SIZE_KEY, String(next));
    } catch {
      // ignore
    }
  }

  function persistLayoutPrefs(next: DashboardLayoutPrefs) {
    writeDashboardLayout(getCurrentOfficerId(), next);
    setLayoutPrefs(next);
  }

  function resetLayoutPrefs() {
    persistLayoutPrefs({
      left: [...DEFAULT_DASHBOARD_LAYOUT.left],
      right: [...DEFAULT_DASHBOARD_LAYOUT.right],
      visible: { ...DEFAULT_DASHBOARD_LAYOUT.visible }
    });
  }

  function ensureLayoutTile(tile: DashboardTileId) {
    setLayoutPrefs((current) => {
      if (current.visible[tile]) {
        return current;
      }
      const next = {
        ...current,
        visible: { ...current.visible, [tile]: true }
      };
      writeDashboardLayout(getCurrentOfficerId(), next);
      return next;
    });
  }

  function setAttentionFilter(filter: ActionFilter) {
    setActionFilter(filter);
    if (filter === 'all' || filter === 'late') {
      setAttentionPage(1);
    }
    if (filter === 'unassigned' || typeof filter === 'object') {
      setAssigneePage(1);
    }
  }

  function openCasePreview(hit: SearchHit) {
    setOpenedHit(hit);
  }

  function openActivityCase(item: SupervisorDashboard['recentActivity'][number]) {
    if (!item.entityTrackingId || !item.entityType) {
      return;
    }
    openCasePreview({
      trackingId: item.entityTrackingId,
      entityType: item.entityType,
      definitionKey: item.definitionKey ?? '',
      version: '',
      currentStageKey: item.stageKey ?? '',
      assignedTo: null,
      slaState: null,
      rowVersion: 0,
      matchedFields: []
    });
  }

  function openWorkspaceCase(trackingId: string, entityType: string, stageKey?: string) {
    requestAppView('workspace', {
      kindKey: selectedKindKey,
      stageKey: stageKey || undefined,
      trackingId,
      entityType
    });
  }

  function openWorkspaceStage(stageKey: string) {
    requestAppView('workspace', {
      kindKey: selectedKindKey,
      stageKey
    });
  }

  function openWorkspaceKind() {
    requestAppView('workspace', { kindKey: selectedKindKey });
  }

  function focusActionQueue(filter: ActionFilter) {
    const scrollToAssignee =
      filter === 'unassigned' || (typeof filter === 'object' && 'assignee' in filter);
    if (scrollToAssignee) {
      ensureLayoutTile('assignees');
    } else {
      ensureLayoutTile('attention');
    }
    setAttentionFilter(filter);
    window.requestAnimationFrame(() => {
      const target = scrollToAssignee ? assigneeCasesRef.current : actionQueueRef.current;
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });
  }

  function chooseWorkloadType(kindKey: string | undefined) {
    setSelectedKindKey(kindKey);
    setDimensionFilters({});
    writeWorkloadTypePref(kindKey);
    setOpenedHit(undefined);
    if (!kindKey) {
      setDashboard(null);
      setActionFilter('all');
      setDashboardLoading(false);
      lastKpisRef.current = null;
    }
  }

  async function loadDashboard(
    keys: string[],
    opts?: { quiet?: boolean; filters?: Record<string, string> }
  ) {
    if (keys.length === 0) {
      setDashboard(null);
      setDashboardLoading(false);
      return;
    }
    if (!opts?.quiet) {
      setDashboardLoading(true);
      setBusy(true);
    }
    setErrorSummary(undefined);
    const filters = opts?.filters ?? dimensionFiltersRef.current;
    try {
      const data = await fetchSupervisorDashboard(keys, 50, filters);
      if (opts?.quiet && lastKpisRef.current) {
        const prev = lastKpisRef.current;
        const changed =
          prev.loggedToday !== data.kpis.loggedToday ||
          prev.openBacklog !== data.kpis.openBacklog ||
          prev.pastSla !== data.kpis.pastSla;
        if (changed) {
          setRefreshToast(
            `Updated · backlog ${data.kpis.openBacklog.toLocaleString()}, Past SLA ${data.kpis.pastSla.toLocaleString()}`
          );
        }
      }
      lastKpisRef.current = data.kpis;
      setDashboard(data);
    } catch (error: unknown) {
      setDashboard(null);
      setErrorSummary(asDisplayError(error, 'Could not load the supervisor dashboard.'));
    } finally {
      if (!opts?.quiet) {
        setDashboardLoading(false);
        setBusy(false);
      }
    }
  }

  function setDimensionFilterValue(fieldKey: string, value: string) {
    setDimensionFilters((current) => {
      const next = { ...current };
      if (!value.trim()) {
        delete next[fieldKey];
      } else {
        next[fieldKey] = value;
      }
      return next;
    });
  }

  function applyDimensionFilters() {
    void loadDashboard(definitionKeys, { filters: dimensionFilters });
  }

  function clearDimensionFilters() {
    setDimensionFilters({});
    void loadDashboard(definitionKeys, { filters: {} });
  }

  useEffect(() => {
    if (!openedHit) {
      return;
    }
    openedCaseRef.current?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'nearest'
    });
  }, [openedHit]);

  const selectedKind = kinds.find((kind) => kind.kindKey === selectedKindKey);
  const definitionKeys = useMemo(
    () => selectedKind?.members.map((member) => member.definitionKey) ?? [],
    [selectedKind]
  );
  definitionKeysRef.current = definitionKeys;

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    Promise.all([listDefinitions(), listReleaseCatalog()])
      .then(([definitions, releases]) => {
        if (cancelled) {
          return;
        }
        const next = groupWorkKinds(definitions, releases, 'live');
        setKinds(next);
        setSelectedKindKey((current) => resolveWorkloadTypeSelection(next, current));
        setKindsReady(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setErrorSummary(asDisplayError(error, 'Could not load workload types.'));
          setKindsReady(true);
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
  }, []);

  useEffect(() => {
    setActionFilter('all');
    void loadDashboard(definitionKeys, {
      filters: dimensionFiltersRef.current
    });
  }, [definitionKeys.join('|')]);

  useEffect(() => {
    if (definitionKeys.length === 0) {
      return;
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      void loadDashboard(definitionKeysRef.current, {
        quiet: true,
        filters: dimensionFiltersRef.current
      });
    }, DASHBOARD_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [definitionKeys.join('|')]);

  const maxLate = Math.max(1, ...(dashboard?.pressure.map((item) => item.lateCount) ?? [1]));
  const isAssigneeFilter = actionFilter === 'unassigned' || typeof actionFilter === 'object';

  const attentionActions = useMemo(() => {
    const rows = dashboard?.actionQueue ?? [];
    if (actionFilter === 'late') {
      return rows.filter((row) => row.pastSla);
    }
    return rows;
  }, [actionFilter, dashboard?.actionQueue]);

  const attentionTotalPages = Math.max(1, Math.ceil(attentionActions.length / attentionPageSize));
  const safeAttentionPage = Math.min(attentionPage, attentionTotalPages);
  const attentionPageRows = useMemo(() => {
    const start = (safeAttentionPage - 1) * attentionPageSize;
    return attentionActions.slice(start, start + attentionPageSize);
  }, [attentionActions, attentionPageSize, safeAttentionPage]);
  const attentionRangeStart =
    attentionActions.length === 0 ? 0 : (safeAttentionPage - 1) * attentionPageSize + 1;
  const attentionRangeEnd = Math.min(
    safeAttentionPage * attentionPageSize,
    attentionActions.length
  );

  const activityRows = dashboard?.recentActivity ?? EMPTY_ACTIVITY;
  const activityTotalPages = Math.max(1, Math.ceil(activityRows.length / activityPageSize));
  const safeActivityPage = Math.min(activityPage, activityTotalPages);
  const activityPageRows = useMemo(() => {
    const start = (safeActivityPage - 1) * activityPageSize;
    return activityRows.slice(start, start + activityPageSize);
  }, [activityPageSize, activityRows, safeActivityPage]);
  const activityRangeStart =
    activityRows.length === 0 ? 0 : (safeActivityPage - 1) * activityPageSize + 1;
  const activityRangeEnd = Math.min(safeActivityPage * activityPageSize, activityRows.length);

  const assigneeCases = useMemo(() => {
    if (!isAssigneeFilter) {
      return [];
    }
    const assignedTo = actionFilter === 'unassigned' ? null : actionFilter.assignee;
    return dashboard?.assignees.find((item) => item.assignedTo === assignedTo)?.cases ?? [];
  }, [actionFilter, dashboard?.assignees, isAssigneeFilter]);

  const assigneeTotalPages = Math.max(1, Math.ceil(assigneeCases.length / assigneePageSize));
  const safeAssigneePage = Math.min(assigneePage, assigneeTotalPages);
  const assigneePageRows = useMemo(() => {
    const start = (safeAssigneePage - 1) * assigneePageSize;
    return assigneeCases.slice(start, start + assigneePageSize);
  }, [assigneeCases, assigneePageSize, safeAssigneePage]);
  const assigneeRangeStart =
    assigneeCases.length === 0 ? 0 : (safeAssigneePage - 1) * assigneePageSize + 1;
  const assigneeRangeEnd = Math.min(safeAssigneePage * assigneePageSize, assigneeCases.length);

  const attentionHeading = actionFilter === 'late' ? 'Past SLA' : 'Needs attention';
  const assigneeHeading =
    actionFilter === 'unassigned'
      ? 'Unassigned'
      : typeof actionFilter === 'object'
        ? `Assigned to ${actionFilter.assignee}`
        : '';

  function renderCaseRows(rows: SupervisorDashboard['actionQueue'], emptyMessage: string) {
    if (rows.length === 0) {
      return <p className="optic-help">{emptyMessage}</p>;
    }
    return (
      <ul className="optic-supervisor-action-list">
        {rows.map((item) => (
          <li key={`${item.entityType}:${item.trackingId}`}>
            <button
              type="button"
              className="optic-supervisor-action-row"
              disabled={busy}
              onClick={() => openWorkspaceCase(item.trackingId, item.entityType, item.stageKey)}
            >
              <span className="optic-supervisor-action-id optic-workspace-tracking">
                {item.trackingId}
              </span>
              <span className="optic-help">
                {item.stageDisplayName}
                {' · '}
                {item.assignedTo ?? 'Unassigned'}
                {' · '}
                {formatAge(item.ageMinutes)}
                {item.pastSla ? (
                  <>
                    {' · '}
                    <span className="optic-sla-badge" data-tone="critical">
                      {formatSlaStateLabel('BREACHED')}
                    </span>
                  </>
                ) : null}
              </span>
              <span className="optic-supervisor-pressure-cta">Open in Workspace</span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="optic-supervisor" aria-labelledby="supervisor-heading">
      <StatusToast message={refreshToast} onDismiss={() => setRefreshToast(undefined)} />
      <header className="optic-workspace-hero optic-supervisor-hero">
        <div>
          <h1 id="supervisor-heading">Dashboard</h1>
          <p className="optic-help">Clear stuck work — open a stage or case in Workspace.</p>
        </div>
        {selectedKind ? (
          <div className="optic-supervisor-hero-tools">
            {dashboard?.asOf ? (
              <p className="optic-supervisor-asof optic-help" role="status">
                As of {formatWhen(dashboard.asOf)}
                {busy ? ' · Updating…' : null}
              </p>
            ) : null}
            <DashboardLayoutMenu
              prefs={layoutPrefs}
              includeFind={searchEnabled}
              onChange={persistLayoutPrefs}
              onReset={resetLayoutPrefs}
            />
          </div>
        ) : null}
      </header>

      <div className="optic-supervisor-scope optic-workspace-card">
        <h2 className="optic-workspace-card-title" id="kind-heading">
          Workload Type
        </h2>
        {!kindsReady ? (
          <div className="optic-skeleton-line" aria-hidden="true" />
        ) : kinds.length === 0 ? (
          <p className="optic-help">Activate a published release to see live workload types.</p>
        ) : (
          <WorkloadTypeSelect
            kinds={kinds}
            value={selectedKindKey}
            disabled={busy && !selectedKind}
            onChange={chooseWorkloadType}
          />
        )}
      </div>

      <CaughtErrorBanner error={errorSummary} />

      {openedHit ? (
        <aside
          ref={openedCaseRef}
          className="optic-workspace-card optic-supervisor-opened-case optic-supervisor-opened-case-live"
          aria-label="Opened case"
          tabIndex={-1}
        >
          <div className="optic-supervisor-opened-case-banner" role="status">
            Case opened
          </div>
          <h2 className="optic-supervisor-section-title">Case</h2>
          <p className="optic-supervisor-case-line">
            <TrackingIdLinkWithCopy trackingId={openedHit.trackingId} />
            <span>
              {' '}
              · {openedHit.entityType}
              {openedHit.currentStageKey ? ` · ${openedHit.currentStageKey}` : ''}
            </span>
          </p>
          <p className="optic-help">
            Continue in Workspace to assign, save, or complete this case.
          </p>
          <div className="optic-supervisor-opened-case-actions">
            <button
              type="button"
              className="optic-button-primary"
              onClick={() =>
                openWorkspaceCase(
                  openedHit.trackingId,
                  openedHit.entityType,
                  openedHit.currentStageKey || undefined
                )
              }
            >
              <ButtonLabel icon="queue">Open in Workspace</ButtonLabel>
            </button>
            <button
              type="button"
              className="optic-guide-button"
              onClick={() => setOpenedHit(undefined)}
            >
              Dismiss
            </button>
          </div>
        </aside>
      ) : null}

      {kindsReady && !selectedKind ? (
        <div className="optic-supervisor-empty-card optic-workspace-card" role="status">
          <h2 className="optic-supervisor-section-title">Choose a workload type</h2>
          <p className="optic-help">
            Pick a type above to see backlog, Past SLA, and recent activity for that work.
          </p>
        </div>
      ) : null}

      {selectedKind && dashboardLoading && !dashboard ? <DashboardSkeleton /> : null}

      {selectedKind && dashboard ? (
        <>
          {!layoutPrefs.visible.filters &&
          Object.keys(dashboard.appliedFilters ?? {}).length > 0 ? (
            <p className="optic-help optic-supervisor-filters-hidden" role="status">
              Filters are applied but hidden. Use Arrange dashboard to show them again.
            </p>
          ) : null}

          <DashboardBoard
            prefs={layoutPrefs}
            includeFind={searchEnabled}
            onChange={persistLayoutPrefs}
            renderTile={(tileId) => {
              switch (tileId) {
                case 'find':
                  if (!searchEnabled) {
                    return null;
                  }
                  return (
                    <div className="optic-workspace-card optic-workspace-search-card">
                      <SearchScreen
                        headingLevel={2}
                        compact
                        openTrackingId={openedHit?.trackingId}
                        definitionKeys={definitionKeys.length > 0 ? definitionKeys : undefined}
                        onOpen={openCasePreview}
                      />
                    </div>
                  );
                case 'kpiLoggedToday':
                  return (
                    <button
                      type="button"
                      className="optic-supervisor-kpi optic-workspace-card optic-supervisor-kpi-action"
                      onClick={openWorkspaceKind}
                    >
                      <p className="optic-supervisor-kpi-label">Logged today</p>
                      <p className="optic-supervisor-kpi-value">
                        {dashboard.kpis.loggedToday.toLocaleString()}
                      </p>
                      <span className="optic-supervisor-kpi-cta">Open Workspace</span>
                    </button>
                  );
                case 'kpiOpenBacklog':
                  return (
                    <button
                      type="button"
                      className="optic-supervisor-kpi optic-workspace-card optic-supervisor-kpi-action"
                      onClick={openWorkspaceKind}
                    >
                      <p className="optic-supervisor-kpi-label">Open backlog</p>
                      <p className="optic-supervisor-kpi-value">
                        {dashboard.kpis.openBacklog.toLocaleString()}
                      </p>
                      <span className="optic-supervisor-kpi-cta">Open Workspace</span>
                    </button>
                  );
                case 'kpiPastSla':
                  return (
                    <button
                      type="button"
                      className="optic-supervisor-kpi optic-workspace-card optic-supervisor-kpi-action"
                      onClick={() => focusActionQueue('late')}
                    >
                      <p className="optic-supervisor-kpi-label">Past SLA</p>
                      <p
                        className={
                          dashboard.kpis.pastSla > 0
                            ? 'optic-supervisor-kpi-value optic-supervisor-kpi-warn'
                            : 'optic-supervisor-kpi-value'
                        }
                      >
                        {dashboard.kpis.pastSla.toLocaleString()}
                      </p>
                      <p className="optic-supervisor-kpi-status">
                        {dashboard.kpis.pastSla > 0 ? 'Needs attention' : 'On track'}
                      </p>
                      <span className="optic-supervisor-kpi-cta">Show late cases</span>
                    </button>
                  );
                case 'filters':
                  if ((dashboard.dimensions?.length ?? 0) === 0) {
                    return null;
                  }
                  return (
                    <section
                      className="optic-workspace-card optic-supervisor-dimensions"
                      aria-labelledby="supervisor-dimensions-heading"
                    >
                      <div className="optic-supervisor-dimensions-head">
                        <div>
                          <h2
                            id="supervisor-dimensions-heading"
                            className="optic-supervisor-section-title"
                          >
                            Dashboard filters
                          </h2>
                          <p className="optic-help">
                            Slice KPIs and attention lists by indexed fields marked for Dashboard in
                            Catalog.
                          </p>
                        </div>
                        <div className="optic-supervisor-dimensions-actions">
                          <button
                            type="button"
                            className="optic-button-primary"
                            disabled={busy}
                            onClick={() => applyDimensionFilters()}
                          >
                            Apply filters
                          </button>
                          <button
                            type="button"
                            className="optic-button-secondary"
                            disabled={busy || Object.keys(dimensionFilters).length === 0}
                            onClick={() => clearDimensionFilters()}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      <div className="optic-supervisor-dimensions-grid">
                        {dashboard.dimensions.map((dimension) => (
                          <label
                            key={dimension.fieldKey}
                            className="optic-supervisor-dimension-field"
                          >
                            {dimension.label}
                            <input
                              type="text"
                              value={dimensionFilters[dimension.fieldKey] ?? ''}
                              disabled={busy}
                              placeholder={`Filter by ${dimension.label}`}
                              onChange={(event) =>
                                setDimensionFilterValue(dimension.fieldKey, event.target.value)
                              }
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  applyDimensionFilters();
                                }
                              }}
                            />
                          </label>
                        ))}
                      </div>
                    </section>
                  );
                case 'attention':
                  return (
                    <section
                      ref={actionQueueRef}
                      className="optic-workspace-card optic-supervisor-action-queue"
                      aria-labelledby="supervisor-action-heading"
                    >
                      <div className="optic-supervisor-action-head">
                        <div>
                          <h2
                            id="supervisor-action-heading"
                            className="optic-supervisor-section-title"
                          >
                            {attentionHeading}
                          </h2>
                          <p className="optic-help">
                            Late and unassigned work first. Open a case to work it in Workspace.
                          </p>
                        </div>
                        <div className="optic-supervisor-action-tools">
                          <label className="optic-supervisor-page-size">
                            Rows per page
                            <select
                              value={attentionPageSize}
                              aria-label="Needs attention rows per page"
                              onChange={(event) =>
                                chooseAttentionPageSize(Number(event.target.value))
                              }
                            >
                              {LIST_PAGE_SIZES.map((size) => (
                                <option key={size} value={size}>
                                  {size}
                                </option>
                              ))}
                            </select>
                          </label>
                          {actionFilter === 'late' ? (
                            <button
                              type="button"
                              className="optic-button-secondary"
                              onClick={() => setAttentionFilter('all')}
                            >
                              Clear filter
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {renderCaseRows(
                        attentionPageRows,
                        actionFilter === 'late'
                          ? 'No cases are past SLA for this workload type.'
                          : 'Nothing needs attention right now.'
                      )}
                      {attentionActions.length > 0 ? (
                        <div className="optic-supervisor-list-pager">
                          <p className="optic-help" role="status">
                            Showing {attentionRangeStart.toLocaleString()}–
                            {attentionRangeEnd.toLocaleString()} of{' '}
                            {attentionActions.length.toLocaleString()}
                          </p>
                          <PagerControls
                            page={safeAttentionPage}
                            totalPages={attentionTotalPages}
                            ariaLabel="Needs attention pages"
                            onPageChange={setAttentionPage}
                          />
                        </div>
                      ) : null}
                    </section>
                  );
                case 'stages':
                  return (
                    <section aria-labelledby="supervisor-stages-heading">
                      <h2 id="supervisor-stages-heading" className="optic-supervisor-section-title">
                        Stages
                      </h2>
                      <p className="optic-help optic-supervisor-section-help">
                        Open a stage to work that queue in Workspace.
                      </p>
                      <div className="optic-supervisor-stages">
                        {dashboard.stages.map((stage) => (
                          <button
                            key={stage.stageKey}
                            type="button"
                            className="optic-supervisor-stage optic-workspace-card optic-supervisor-stage-action"
                            disabled={busy || stage.count === 0}
                            onClick={() => openWorkspaceStage(stage.stageKey)}
                          >
                            <h3 className="optic-supervisor-stage-title">{stage.displayName}</h3>
                            <p className="optic-supervisor-stage-count">
                              {stage.count.toLocaleString()}
                            </p>
                            <p className="optic-help">
                              Oldest{' '}
                              {stage.oldestAgeMinutes == null
                                ? '—'
                                : formatAge(stage.oldestAgeMinutes)}
                            </p>
                            <p className="optic-supervisor-stage-late">
                              {stage.lateCount > 0
                                ? `${stage.lateCount.toLocaleString()} Past SLA`
                                : 'On track'}
                            </p>
                            <span className="optic-supervisor-kpi-cta">Open in Workspace</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  );
                case 'assignees':
                  return (
                    <div className="optic-supervisor-assignee-stack">
                      <section
                        className="optic-workspace-card"
                        aria-labelledby="supervisor-assignee-heading"
                      >
                        <div className="optic-supervisor-action-head">
                          <div>
                            <h2
                              id="supervisor-assignee-heading"
                              className="optic-supervisor-section-title"
                            >
                              By assignee
                            </h2>
                            <p className="optic-help">
                              Unassigned first. Click a name to list their open cases below.
                            </p>
                          </div>
                          {isAssigneeFilter ? (
                            <button
                              type="button"
                              className="optic-button-secondary"
                              onClick={() => setAttentionFilter('all')}
                            >
                              Clear filter
                            </button>
                          ) : null}
                        </div>
                        {dashboard.assignees.length === 0 ? (
                          <p className="optic-help">No open cases.</p>
                        ) : (
                          <ul className="optic-supervisor-assignees">
                            {dashboard.assignees.map((item) => {
                              const selected =
                                (item.assignedTo == null && actionFilter === 'unassigned') ||
                                (typeof actionFilter === 'object' &&
                                  actionFilter.assignee === item.assignedTo);
                              return (
                                <li key={item.assignedTo ?? 'unassigned'}>
                                  <button
                                    type="button"
                                    className="optic-supervisor-assignee-row"
                                    aria-pressed={selected}
                                    onClick={() =>
                                      focusActionQueue(
                                        item.assignedTo == null
                                          ? 'unassigned'
                                          : { assignee: item.assignedTo }
                                      )
                                    }
                                  >
                                    <span>{item.label}</span>
                                    <span className="optic-help">
                                      {item.count.toLocaleString()} open
                                      {item.lateCount > 0
                                        ? ` · ${item.lateCount.toLocaleString()} late`
                                        : ''}
                                      {item.oldestAgeMinutes != null
                                        ? ` · oldest ${formatAge(item.oldestAgeMinutes)}`
                                        : ''}
                                    </span>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </section>

                      {isAssigneeFilter ? (
                        <section
                          ref={assigneeCasesRef}
                          className="optic-workspace-card optic-supervisor-action-queue"
                          aria-labelledby="supervisor-assignee-cases-heading"
                        >
                          <div className="optic-supervisor-action-head">
                            <div>
                              <h2
                                id="supervisor-assignee-cases-heading"
                                className="optic-supervisor-section-title"
                              >
                                {assigneeHeading}
                              </h2>
                              <p className="optic-help">
                                {actionFilter === 'unassigned'
                                  ? 'Open unassigned cases in Workspace, or assign them from the queue.'
                                  : 'Open cases for this assignee in Workspace.'}
                              </p>
                            </div>
                            {assigneeCases.length > 0 ? (
                              <label className="optic-supervisor-page-size">
                                Rows per page
                                <select
                                  value={assigneePageSize}
                                  aria-label="Assignee cases rows per page"
                                  onChange={(event) =>
                                    chooseAssigneePageSize(Number(event.target.value))
                                  }
                                >
                                  {LIST_PAGE_SIZES.map((size) => (
                                    <option key={size} value={size}>
                                      {size}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : null}
                          </div>
                          {renderCaseRows(assigneePageRows, 'Nothing in this list right now.')}
                          {assigneeCases.length > 0 ? (
                            <div className="optic-supervisor-list-pager">
                              <p className="optic-help" role="status">
                                Showing {assigneeRangeStart.toLocaleString()}–
                                {assigneeRangeEnd.toLocaleString()} of{' '}
                                {assigneeCases.length.toLocaleString()}
                              </p>
                              <PagerControls
                                page={safeAssigneePage}
                                totalPages={assigneeTotalPages}
                                ariaLabel="Assignee cases pages"
                                onPageChange={setAssigneePage}
                              />
                            </div>
                          ) : null}
                        </section>
                      ) : null}
                    </div>
                  );
                case 'pressure':
                  return (
                    <section
                      className="optic-workspace-card"
                      aria-labelledby="supervisor-pressure-heading"
                    >
                      <h2
                        id="supervisor-pressure-heading"
                        className="optic-supervisor-section-title"
                      >
                        Where the pressure is
                      </h2>
                      <p className="optic-help">
                        Most overdue first. Open a row to jump to that stage in Workspace.
                      </p>
                      {dashboard.pressure.length === 0 ? (
                        <p className="optic-help">No open stages.</p>
                      ) : (
                        <ul className="optic-supervisor-pressure">
                          {dashboard.pressure.map((item) => {
                            const ratio = item.lateCount / maxLate;
                            const widthPct = Math.max(item.lateCount === 0 ? 6 : 10, ratio * 100);
                            return (
                              <li key={item.stageKey}>
                                <button
                                  type="button"
                                  className="optic-supervisor-pressure-open"
                                  disabled={busy}
                                  onClick={() => openWorkspaceStage(item.stageKey)}
                                >
                                  <div className="optic-supervisor-pressure-row">
                                    <span>{item.displayName}</span>
                                    <span className="optic-help">
                                      {item.lateCount.toLocaleString()} late ·{' '}
                                      {item.count.toLocaleString()} open
                                    </span>
                                  </div>
                                  <div
                                    className="optic-supervisor-pressure-track"
                                    role="img"
                                    aria-label={`${item.displayName}: ${item.lateCount} late of ${item.count} open`}
                                  >
                                    <div
                                      className="optic-supervisor-pressure-bar"
                                      data-severity={pressureSeverity(ratio, item.lateCount)}
                                      style={{
                                        width: `${widthPct}%`,
                                        backgroundSize: `${(100 / widthPct) * 100}% 100%`
                                      }}
                                    />
                                  </div>
                                  <span className="optic-supervisor-pressure-cta">
                                    Open in Workspace
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </section>
                  );
                case 'activity':
                  return (
                    <section
                      className="optic-workspace-card"
                      aria-labelledby="supervisor-activity-heading"
                    >
                      <div className="optic-supervisor-action-head">
                        <div>
                          <h2
                            id="supervisor-activity-heading"
                            className="optic-supervisor-section-title"
                          >
                            Recent activity
                          </h2>
                        </div>
                        {activityRows.length > 0 ? (
                          <label className="optic-supervisor-page-size">
                            Rows per page
                            <select
                              value={activityPageSize}
                              aria-label="Recent activity rows per page"
                              onChange={(event) =>
                                chooseActivityPageSize(Number(event.target.value))
                              }
                            >
                              {LIST_PAGE_SIZES.map((size) => (
                                <option key={size} value={size}>
                                  {size}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                      </div>
                      {activityRows.length === 0 ? (
                        <p className="optic-help optic-supervisor-empty-inline" role="status">
                          No recent assign, release, or stage events for this workload type.
                        </p>
                      ) : (
                        <>
                          <ul className="optic-supervisor-activity">
                            {activityPageRows.map((item) => (
                              <li key={item.eventId}>
                                <p className="optic-supervisor-activity-summary">{item.summary}</p>
                                <p className="optic-help optic-supervisor-activity-meta">
                                  {item.entityTrackingId ? (
                                    <TrackingIdLinkWithCopy
                                      trackingId={item.entityTrackingId}
                                      onOpen={
                                        item.entityType ? () => openActivityCase(item) : undefined
                                      }
                                    />
                                  ) : null}
                                  {item.entityTrackingId ? ' · ' : null}
                                  {formatWhen(item.occurredAt)}
                                </p>
                              </li>
                            ))}
                          </ul>
                          <div className="optic-supervisor-list-pager">
                            <p className="optic-help" role="status">
                              Showing {activityRangeStart.toLocaleString()}–
                              {activityRangeEnd.toLocaleString()} of{' '}
                              {activityRows.length.toLocaleString()}
                            </p>
                            <PagerControls
                              page={safeActivityPage}
                              totalPages={activityTotalPages}
                              ariaLabel="Recent activity pages"
                              onPageChange={setActivityPage}
                            />
                          </div>
                        </>
                      )}
                    </section>
                  );
                default:
                  return null;
              }
            }}
          />
        </>
      ) : null}
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div
      className="optic-supervisor-skeleton"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading dashboard"
    >
      <div className="optic-supervisor-kpis" aria-hidden="true">
        <div className="optic-skeleton-card" />
        <div className="optic-skeleton-card" />
        <div className="optic-skeleton-card" />
      </div>
      <div className="optic-skeleton-block" aria-hidden="true" />
      <div className="optic-skeleton-block optic-skeleton-block-tall" aria-hidden="true" />
    </div>
  );
}

function pressureSeverity(ratio: number, lateCount: number): 'ok' | 'watch' | 'critical' {
  if (lateCount <= 0 || ratio < 0.34) {
    return 'ok';
  }
  if (ratio < 0.67) {
    return 'watch';
  }
  return 'critical';
}

function formatAge(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
