import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SearchFieldDefinition } from '../../../../src/modules/configuration/domain/types.js';
import {
  compareOfficerQueueKeys,
  compareOfficerQueuesInOrder,
  isOfficerWorkQueue,
  orderedOfficerQueueKeys
} from '../../../../src/modules/queue/domain/officer-queues.js';
import { WorkingAsField } from '../actors/WorkingAsField.js';
import { getCurrentOfficerId, OFFICER_ACTOR_ID, setCurrentOfficerId } from '../actors/demo-officers.js';
import {
  resolveCaughtError,
  retainFormErrorsAfterEdit,
  type DisplayError
} from '../api/apply-api-error.js';
import type { FormFieldError } from '../dynamic-forms/DynamicFormRenderer.js';
import { CaughtErrorBanner } from '../ui/CaughtErrorBanner.js';
import { extraFindSearchFields } from '../designers/catalog-model.js';
import { getRelease, listDefinitions, listReleaseCatalog, type DesignerRelease } from '../designers/config-api.js';
import { itemsInQueue, listOfficerQueues, nextTrackingId, trialQueuePage } from '../designers/try-queue.js';
import {
  assignWorkflow,
  createWorkflowInstance,
  executeWorkflowAction,
  getWorkflowSummary,
  listWorkflowInstances,
  mintTrackingId,
  reassignWorkflow,
  releaseWorkflow,
  type WorkflowQueueItem,
  type WorkflowSummary
} from '../designers/workflow-api.js';
import type { DemoQueuePage, DemoQueueRow } from '../queues/demo-queue.js';
import {
  assignFromQueue,
  fetchQueuePage,
  listLiveQueues,
  reassignFromQueue,
  releaseFromQueue,
  type CatalogedQueueRow
} from '../queues/optic-api.js';
import { useFeatureFlags } from '../features/FeatureFlagsContext.js';
import { QueueScreen } from '../queues/QueueScreen.js';
import { SearchScreen } from '../search/SearchScreen.js';
import type { SearchHit } from '../search/search-api.js';
import { TrackingIdLinkWithCopy } from '../tracking/TrackingIdDisplay.js';
import { ButtonLabel } from '../ui/Icon.js';
import { StatusToast } from '../ui/StatusToast.js';
import { OFFICER_USER_GUIDE } from '../guides/guide-sources.js';
import { UserGuideDialog } from '../guides/UserGuideDialog.js';
import { buildDraftCase, isDraftCase } from './draft-case.js';
import {
  groupWorkKinds,
  intakeMember,
  kindKeyFromDefinition,
  type KindMember,
  type WorkKind
} from './kind-catalog.js';
import { OfficerCasePane } from './OfficerCasePane.js';
import {
  APP_NAVIGATE_EVENT,
  consumeWorkspaceFocusHint,
  type WorkspaceFocusHint
} from '../navigation/app-navigation.js';
import {
  resolveWorkloadTypeSelection,
  writeWorkloadTypePref
} from './workload-type-pref.js';
import { WorkloadTypeSelect } from './WorkloadTypeSelect.js';

type WorkspaceMode = 'try' | 'live';

const NO_SEARCH_EXTRA_FIELDS: SearchFieldDefinition[] = [];
const RECENT_CASES_KEY = 'optic.workspace.recentCases';
const FIND_EXPANDED_PREF_KEY = 'optic.workspace.findExpandedPref';
const MAX_RECENT_CASES = 5;

type RecentCase = { trackingId: string; entityType: string };

function readRecentCases(): RecentCase[] {
  try {
    const raw = window.localStorage.getItem(RECENT_CASES_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (item): item is RecentCase =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as RecentCase).trackingId === 'string' &&
          typeof (item as RecentCase).entityType === 'string'
      )
      .slice(0, MAX_RECENT_CASES);
  } catch {
    return [];
  }
}

function readFindExpandedPref(): boolean {
  try {
    const stored = window.localStorage.getItem(FIND_EXPANDED_PREF_KEY);
    if (stored === '0') {
      return false;
    }
    if (stored === '1') {
      return true;
    }
  } catch {
    // ignore
  }
  return true;
}

function queueMatchesStage(queueKey: string, stageKey: string, stageQueueKey?: string): boolean {
  const queue = queueKey.toUpperCase();
  const stage = stageKey.toUpperCase();
  const authored = (stageQueueKey ?? '').toUpperCase();
  if (authored && queue === authored) {
    return true;
  }
  return (
    queue === stage ||
    queue === `QUEUE_${stage}` ||
    queue.endsWith(`_${stage}`) ||
    stage.endsWith(`_${queue}`)
  );
}

function stageQueueKeyFromRelease(
  release: DesignerRelease | undefined,
  stageKey: string
): string | undefined {
  const stage = release?.workflow?.stages?.find((item) => item.stageKey === stageKey);
  return stage?.queueKey?.trim() || undefined;
}

interface TryDesk {
  member: KindMember;
  release: DesignerRelease;
  items: WorkflowQueueItem[];
}

interface SelectedQueue {
  definitionKey: string;
  queueKey: string;
}

export function OfficerWorkspace() {
  const { isEnabled } = useFeatureFlags();
  const tryModeEnabled = isEnabled('ui.workspace.try_mode');
  const searchEnabled = isEnabled('ui.workspace.search') && isEnabled('api.search');
  const actorOverrideEnabled = isEnabled('ui.workspace.actor_override');
  const [mode, setMode] = useState<WorkspaceMode>('live');

  useEffect(() => {
    if (mode === 'try' && !tryModeEnabled) {
      setMode('live');
    }
  }, [mode, tryModeEnabled]);
  const [kinds, setKinds] = useState<WorkKind[]>([]);
  const [selectedKindKey, setSelectedKindKey] = useState<string | undefined>();
  const [selected, setSelected] = useState<SelectedQueue | undefined>();
  const [desks, setDesks] = useState<Record<string, TryDesk>>({});
  const [liveQueues, setLiveQueues] = useState<CatalogedQueueRow[]>([]);
  const [livePage, setLivePage] = useState<DemoQueuePage | undefined>();
  const [listPage, setListPage] = useState(1);
  const [listFilters, setListFilters] = useState<Record<string, string>>({});
  const [kindSearchReleases, setKindSearchReleases] = useState<Record<string, DesignerRelease>>({});
  const [working, setWorking] = useState<WorkflowSummary | undefined>();
  const [errorBanner, setErrorBanner] = useState<DisplayError | undefined>();
  const [formFieldErrors, setFormFieldErrors] = useState<FormFieldError[]>([]);
  const [statusToast, setStatusToast] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  function clearWorkspaceErrors() {
    setErrorBanner(undefined);
    setFormFieldErrors([]);
  }

  function applyWorkspaceError(error: unknown) {
    const resolved = resolveCaughtError(error, 'The officer workspace could not load.');
    setFormFieldErrors(resolved.formErrors);
    setErrorBanner(resolved.banner);
  }
  const [actorId, setActorId] = useState(getCurrentOfficerId);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    if (actorOverrideEnabled) {
      return;
    }
    setActorId(OFFICER_ACTOR_ID);
    setCurrentOfficerId(OFFICER_ACTOR_ID);
  }, [actorOverrideEnabled]);
  const [findExpanded, setFindExpanded] = useState(readFindExpandedPref);
  const [recentCases, setRecentCases] = useState<RecentCase[]>(readRecentCases);
  const queueScrollLockRef = useRef<number | null>(null);
  const findFocusPendingRef = useRef(false);
  const focusHintAppliedRef = useRef(false);
  const pendingFocusRef = useRef<ReturnType<typeof consumeWorkspaceFocusHint> | null | undefined>(
    undefined
  );

  function setFindExpandedPref(next: boolean) {
    setFindExpanded(next);
    try {
      window.localStorage.setItem(FIND_EXPANDED_PREF_KEY, next ? '1' : '0');
    } catch {
      // ignore
    }
  }

  function focusFindCase(): void {
    setFindExpandedPref(true);
    findFocusPendingRef.current = true;
  }

  function rememberRecentCase(trackingId: string, entityType: string) {
    setRecentCases((current) => {
      const next: RecentCase[] = [
        { trackingId, entityType },
        ...current.filter((item) => item.trackingId !== trackingId)
      ].slice(0, MAX_RECENT_CASES);
      try {
        window.localStorage.setItem(RECENT_CASES_KEY, JSON.stringify(next));
      } catch {
        // ignore storage failures
      }
      return next;
    });
  }

  function openWorkingCase(summary: WorkflowSummary) {
    setWorking(summary);
    rememberRecentCase(summary.trackingId, summary.entityType);
  }

  function chooseOfficer(next: string) {
    setActorId(next);
    setCurrentOfficerId(next);
  }

  function lockQueueScroll() {
    queueScrollLockRef.current = window.scrollY;
  }

  function restoreQueueScroll() {
    const locked = queueScrollLockRef.current;
    if (locked == null) {
      return;
    }
    window.scrollTo(0, locked);
    queueScrollLockRef.current = null;
  }

  const selectedKind = kinds.find((kind) => kind.kindKey === selectedKindKey);

  const searchExtraFields = useMemo(() => {
    const byKey = new Map<string, SearchFieldDefinition>();
    for (const release of Object.values(kindSearchReleases)) {
      for (const { field } of extraFindSearchFields(
        release.search ?? { searchKey: 'DEFAULT', fields: [] }
      )) {
        if (!byKey.has(field.fieldKey)) {
          byKey.set(field.fieldKey, field);
        }
      }
    }
    return byKey.size > 0 ? [...byKey.values()] : NO_SEARCH_EXTRA_FIELDS;
  }, [kindSearchReleases]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    Promise.all([listDefinitions(), listReleaseCatalog()])
      .then(([definitions, releases]) => {
        if (cancelled) {
          return;
        }
        const next = groupWorkKinds(definitions, releases, mode);
        setKinds(next);
        setSelectedKindKey((current) => resolveWorkloadTypeSelection(next, current));
        clearWorkspaceErrors();
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          applyWorkspaceError(error);
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
  }, [mode]);

  useEffect(() => {
    if (working) {
      setFindExpanded(false);
    } else {
      setFindExpanded(readFindExpandedPref());
    }
  }, [working?.trackingId]);

  useEffect(() => {
    if (!working) {
      return;
    }
    const derivedKind = kindKeyFromDefinition(working.definition.definitionKey);
    if (kinds.some((kind) => kind.kindKey === derivedKind)) {
      setSelectedKindKey(derivedKind);
      writeWorkloadTypePref(derivedKind);
    }
  }, [working?.trackingId, working?.definition.definitionKey, kinds]);

  useEffect(() => {
    if (!findExpanded || !findFocusPendingRef.current) {
      return;
    }
    findFocusPendingRef.current = false;
    window.requestAnimationFrame(() => {
      document.getElementById('optic-find-case-tracking')?.focus();
    });
  }, [findExpanded]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        focusFindCase();
        return;
      }
      if (event.key === 'Escape' && working) {
        event.preventDefault();
        setWorking(undefined);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [working]);

  useEffect(() => {
    function onNavigate(event: Event) {
      const detail = (event as CustomEvent<{ view?: string; workspaceFocus?: WorkspaceFocusHint }>).detail;
      if (detail?.view !== 'workspace' || !detail.workspaceFocus?.findCase) {
        return;
      }
      focusFindCase();
    }
    window.addEventListener(APP_NAVIGATE_EVENT, onNavigate);
    return () => window.removeEventListener(APP_NAVIGATE_EVENT, onNavigate);
  }, []);

  useEffect(() => {
    if (!selectedKind) {
      setKindSearchReleases({});
      return;
    }
    let cancelled = false;
    Promise.all(selectedKind.members.map((member) => getRelease(member.definitionKey, member.version)))
      .then((releases) => {
        if (!cancelled) {
          setKindSearchReleases(Object.fromEntries(releases.map((release) => [release.definitionKey, release])));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setKindSearchReleases({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedKind]);

  useEffect(() => {
    if (!selectedKind || mode !== 'try') {
      return;
    }
    let cancelled = false;
    setBusy(true);
    Promise.all(
      selectedKind.members.map(async (member) => {
        const release = await getRelease(member.definitionKey, member.version);
        const listed = await listWorkflowInstances(member.definitionKey, member.version);
        return { member, release, items: listed.items } satisfies TryDesk;
      })
    )
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setDesks(Object.fromEntries(loaded.map((desk) => [desk.member.definitionKey, desk])));
        clearWorkspaceErrors();
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          applyWorkspaceError(error);
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
  }, [mode, selectedKind]);

  useEffect(() => {
    if (mode !== 'live') {
      setLiveQueues([]);
      return;
    }
    let cancelled = false;
    listLiveQueues()
      .then((queues) => {
        if (!cancelled) {
          setLiveQueues(queues);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          applyWorkspaceError(error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [actorId, mode]);

  const trySections = useMemo(() => {
    if (!selectedKind || mode !== 'try') {
      return [];
    }
    return selectedKind.members.map((member) => {
      const desk = desks[member.definitionKey];
      const queues = desk
        ? listOfficerQueues(desk.release.workflow, desk.release.queues ?? {}, member.entityType)
        : [];
      return { member, queues, items: desk?.items ?? [] };
    });
  }, [desks, mode, selectedKind]);

  const liveSections = useMemo(() => {
    if (!selectedKind || mode !== 'live') {
      return [];
    }
    const keys = new Set(selectedKind.members.map((member) => member.definitionKey));
    const orderByDefinition = new Map<string, string[]>();
    for (const member of selectedKind.members) {
      const release = kindSearchReleases[member.definitionKey];
      if (release) {
        orderByDefinition.set(
          member.definitionKey,
          orderedOfficerQueueKeys(release.workflow, release.queues ?? {}, member.entityType)
        );
      }
    }
    function sortLiveQueues(left: CatalogedQueueRow, right: CatalogedQueueRow): number {
      if (left.definitionKey !== right.definitionKey) {
        return left.definitionKey.localeCompare(right.definitionKey);
      }
      const ordered = orderByDefinition.get(left.definitionKey);
      if (ordered) {
        return compareOfficerQueuesInOrder(left.queueKey, right.queueKey, ordered);
      }
      if (left.officerSortIndex != null && right.officerSortIndex != null) {
        const byStage = left.officerSortIndex - right.officerSortIndex;
        return byStage !== 0 ? byStage : compareOfficerQueueKeys(left.queueKey, right.queueKey);
      }
      return compareOfficerQueueKeys(left.queueKey, right.queueKey);
    }
    const mail = liveQueues
      .filter((queue) => keys.has(queue.definitionKey) && queue.entityType === 'MAIL')
      .sort(sortLiveQueues);
    const workload = liveQueues
      .filter((queue) => keys.has(queue.definitionKey) && queue.entityType !== 'MAIL')
      .sort(sortLiveQueues);
    return [
      { heading: 'Mail item queues', entityType: 'MAIL' as const, queues: mail },
      { heading: 'Workload queues', entityType: 'WORKLOAD' as const, queues: workload }
    ].filter((section) => section.queues.length > 0 || selectedKind.members.some((member) => member.entityType === section.entityType));
  }, [kindSearchReleases, liveQueues, mode, selectedKind]);

  useEffect(() => {
    if (mode !== 'try' || selected || trySections.length === 0) {
      return;
    }
    for (const section of trySections) {
      const workflow = desks[section.member.definitionKey]?.release.workflow;
      // Completed / All Items are browse views — do not auto-open them as the officer desk.
      const workQueues = section.queues.filter((queue) => isOfficerWorkQueue(queue.queueKey));
      const first =
        (workflow &&
          workQueues.find((queue) => itemsInQueue(queue, workflow, section.items, actorId).length > 0)) ||
        workQueues[0];
      if (first) {
        setSelected({ definitionKey: section.member.definitionKey, queueKey: first.queueKey });
        return;
      }
    }
  }, [actorId, desks, mode, selected, trySections]);

  useEffect(() => {
    setListPage(1);
    setListFilters({});
  }, [mode, selected?.definitionKey, selected?.queueKey]);

  useEffect(() => {
    if (mode !== 'live' || !selected) {
      setLivePage(undefined);
      return;
    }
    let cancelled = false;
    fetchQueuePage(selected.queueKey, {
      definitionKey: selected.definitionKey,
      page: listPage,
      filters: listFilters
    })
      .then((page) => {
        if (!cancelled) {
          clearWorkspaceErrors();
          setLivePage(page);
          if (page.page !== listPage) {
            setListPage(page.page);
          }
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          applyWorkspaceError(error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mode, selected, listPage, listFilters]);

  const tryQueuePage = useMemo(() => {
    if (mode !== 'try' || !selected) {
      return undefined;
    }
    const desk = desks[selected.definitionKey];
    if (!desk) {
      return undefined;
    }
    const queues = listOfficerQueues(desk.release.workflow, desk.release.queues ?? {}, desk.member.entityType);
    const queue = queues.find((item) => item.queueKey === selected.queueKey);
    if (!queue) {
      return undefined;
    }
    const rows = itemsInQueue(queue, desk.release.workflow, desk.items, actorId);
    return trialQueuePage(
      queue,
      rows,
      desk.member.definitionKey,
      desk.member.version,
      desk.release.workflow,
      listPage,
      listFilters,
      actorId,
      desk.release.slas
    );
  }, [actorId, desks, listFilters, listPage, mode, selected]);

  function changeQueueFilter(key: string, value: string) {
    setListPage(1);
    setListFilters((current) => {
      const next = { ...current };
      if (!value.trim()) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  }

  const workingDesk = working
    ? Object.values(desks).find((desk) => desk.member.entityType === working.entityType || desk.items.some((item) => item.trackingId === working.trackingId))
    : undefined;

  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      clearWorkspaceErrors();
      await work();
    } catch (error: unknown) {
      applyWorkspaceError(error);
    } finally {
      setBusy(false);
    }
  }

  async function refreshLiveQueues() {
    setLiveQueues(await listLiveQueues());
  }

  async function refreshTryDesk(definitionKey: string, version: string) {
    const listed = await listWorkflowInstances(definitionKey, version);
    setDesks((current) => {
      const desk = current[definitionKey];
      if (!desk) {
        return current;
      }
      return { ...current, [definitionKey]: { ...desk, items: listed.items } };
    });
  }

  function openQueue(definitionKey: string, queueKey: string) {
    lockQueueScroll();
    setSelected({ definitionKey, queueKey });
    setWorking(undefined);
  }

  async function arriveNewWork() {
    const member = selectedKind ? intakeMember(selectedKind) : undefined;
    if (!member) {
      return;
    }
    await run(async () => {
      const release =
        desks[member.definitionKey]?.release ?? (await getRelease(member.definitionKey, member.version));
      const trackingId =
        mode === 'live'
          ? (await mintTrackingId(member.entityType)).trackingId
          : nextTrackingId(member.entityType);
      openWorkingCase(
        buildDraftCase({
          trackingId,
          entityType: member.entityType,
          definitionKey: member.definitionKey,
          version: member.version,
          workflow: release.workflow,
          forms: release.forms ?? {},
          actions: release.actions,
          schema: release.schema
        })
      );
    });
  }

  /** Insert the draft only when the officer first assigns, saves, or completes. */
  async function ensurePersisted(summary: WorkflowSummary): Promise<WorkflowSummary> {
    if (!isDraftCase(summary)) {
      return summary;
    }
    const created = await createWorkflowInstance({
      entityType: summary.entityType,
      entityTrackingId: summary.trackingId,
      definitionKey: summary.definition.definitionKey,
      ...(mode === 'try' ? { version: summary.definition.version } : {})
    });
    // Keep the open case on the persisted instance even if the following action
    // fails validation — otherwise a retry tries to create the same tracking id again.
    setWorking(created);
    if (mode === 'try') {
      await refreshTryDesk(summary.definition.definitionKey, summary.definition.version);
    } else {
      await refreshLiveQueues();
      if (selected) {
        setLivePage(
          await fetchQueuePage(selected.queueKey, {
            definitionKey: selected.definitionKey,
            page: listPage,
            filters: listFilters
          })
        );
      }
    }
    return created;
  }

  async function assignRow(row: DemoQueueRow) {
    await run(async () => {
      if (mode === 'live' && selected) {
        await assignFromQueue(selected.queueKey, {
          definitionKey: selected.definitionKey,
          entityType: row.entityType,
          trackingId: row.trackingId,
          expectedRowVersion: row.rowVersion
        });
        await refreshLiveQueues();
        setLivePage(await fetchQueuePage(selected.queueKey, { definitionKey: selected.definitionKey, page: listPage, filters: listFilters }));
      }
      const next = mode === 'try'
        ? await assignWorkflow(row.entityType, row.trackingId, row.rowVersion)
        : await getWorkflowSummary(row.entityType, row.trackingId);
      if (mode === 'try') {
        await refreshTryDesk(selected?.definitionKey ?? row.definitionKey, desks[row.definitionKey]?.member.version ?? '');
      }
      openWorkingCase(next);
    });
  }

  async function openRow(row: DemoQueueRow) {
    await run(async () => {
      openWorkingCase(await getWorkflowSummary(row.entityType, row.trackingId));
    });
  }

  async function openSearchHit(hit: SearchHit) {
    await run(async () => {
      openWorkingCase(await getWorkflowSummary(hit.entityType, hit.trackingId));
    });
  }

  async function reassignRow(row: DemoQueueRow, assignedTo: string) {
    await run(async () => {
      if (mode === 'live' && selected) {
        await reassignFromQueue(selected.queueKey, {
          definitionKey: selected.definitionKey,
          entityType: row.entityType,
          trackingId: row.trackingId,
          expectedRowVersion: row.rowVersion,
          assignedTo
        });
        await refreshLiveQueues();
        setLivePage(await fetchQueuePage(selected.queueKey, { definitionKey: selected.definitionKey, page: listPage, filters: listFilters }));
      } else {
        await reassignWorkflow(row.entityType, row.trackingId, row.rowVersion, assignedTo);
        await refreshTryDesk(row.definitionKey, desks[row.definitionKey]?.member.version ?? '');
      }
      setWorking(undefined);
    });
  }

  async function releaseRow(row: DemoQueueRow) {
    await run(async () => {
      if (mode === 'live' && selected) {
        await releaseFromQueue(selected.queueKey, {
          definitionKey: selected.definitionKey,
          entityType: row.entityType,
          trackingId: row.trackingId,
          expectedRowVersion: row.rowVersion
        });
        await refreshLiveQueues();
        setLivePage(await fetchQueuePage(selected.queueKey, { definitionKey: selected.definitionKey, page: listPage, filters: listFilters }));
      } else {
        await releaseWorkflow(row.entityType, row.trackingId, row.rowVersion);
        await refreshTryDesk(row.definitionKey, desks[row.definitionKey]?.member.version ?? '');
      }
      setWorking(undefined);
    });
  }

  async function completeWorking(actionKey: string, dataPatch?: Record<string, unknown>) {
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
      if (mode === 'try') {
        await Promise.all(
          Object.values(desks).map((desk) => refreshTryDesk(desk.member.definitionKey, desk.member.version))
        );
      } else {
        await refreshLiveQueues();
        if (selected) {
          setLivePage(await fetchQueuePage(selected.queueKey, { definitionKey: selected.definitionKey, page: listPage, filters: listFilters }));
        }
      }
      setWorking(next);
      const stage = next.workflow.currentStageLabel || next.workflow.currentStageKey;
      setStatusToast(
        actionKey.toUpperCase().includes('SAVE')
          ? 'Draft saved'
          : `Moved to ${stage}`
      );
    });
  }

  async function assignWorking() {
    if (!working) {
      return;
    }
    await run(async () => {
      const base = await ensurePersisted(working);
      const next = await assignWorkflow(base.entityType, base.trackingId, base.workflow.rowVersion);
      if (mode === 'try') {
        await refreshTryDesk(
          workingDesk?.member.definitionKey ?? selected?.definitionKey ?? base.definition.definitionKey,
          workingDesk?.member.version ?? base.definition.version
        );
      } else {
        await refreshLiveQueues();
        if (selected) {
          setLivePage(await fetchQueuePage(selected.queueKey, { definitionKey: selected.definitionKey, page: listPage, filters: listFilters }));
        }
      }
      setWorking(next);
      setStatusToast('Assigned to you');
    });
  }

  async function reassignWorking(assignedTo: string) {
    if (!working) {
      return;
    }
    await run(async () => {
      const base = await ensurePersisted(working);
      const next = await reassignWorkflow(
        base.entityType,
        base.trackingId,
        base.workflow.rowVersion,
        assignedTo
      );
      if (mode === 'try') {
        await refreshTryDesk(
          workingDesk?.member.definitionKey ?? selected?.definitionKey ?? '',
          workingDesk?.member.version ?? ''
        );
      } else {
        await refreshLiveQueues();
        if (selected) {
          setLivePage(await fetchQueuePage(selected.queueKey, { definitionKey: selected.definitionKey, page: listPage, filters: listFilters }));
        }
      }
      setWorking(next);
      setStatusToast(`Reassigned to ${assignedTo}`);
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
      if (mode === 'try') {
        await refreshTryDesk(
          workingDesk?.member.definitionKey ?? selected?.definitionKey ?? '',
          workingDesk?.member.version ?? ''
        );
      } else {
        await refreshLiveQueues();
        if (selected) {
          setLivePage(await fetchQueuePage(selected.queueKey, { definitionKey: selected.definitionKey, page: listPage, filters: listFilters }));
        }
      }
      setWorking(undefined);
      setStatusToast('Released to queue');
    });
  }

  const queuePage = mode === 'try' ? tryQueuePage : livePage;
  const caseWorkflow = workingDesk?.release.workflow;
  const caseForms = workingDesk?.release.forms ?? {};

  useLayoutEffect(() => {
    restoreQueueScroll();
  }, [queuePage?.queueKey, queuePage?.definitionKey, queuePage?.columns.length, queuePage?.total]);

  const firstWorkQueue = useMemo(() => {
    if (mode === 'try') {
      for (const section of trySections) {
        const queue = section.queues.find((item) => isOfficerWorkQueue(item.queueKey));
        if (queue) {
          return {
            definitionKey: section.member.definitionKey,
            queueKey: queue.queueKey,
            displayName: queue.displayName
          };
        }
      }
      return undefined;
    }
    for (const section of liveSections) {
      const queue = section.queues.find((item) => isOfficerWorkQueue(item.queueKey));
      if (queue) {
        return {
          definitionKey: queue.definitionKey,
          queueKey: queue.queueKey,
          displayName: queue.displayName
        };
      }
    }
    return undefined;
  }, [mode, trySections, liveSections]);

  useEffect(() => {
    if (pendingFocusRef.current === undefined) {
      pendingFocusRef.current = consumeWorkspaceFocusHint() ?? null;
    }
    if (focusHintAppliedRef.current || !pendingFocusRef.current) {
      return;
    }
    const hint = pendingFocusRef.current;
    if (hint.kindKey && kinds.length === 0) {
      return;
    }
    if (hint.kindKey && kinds.some((kind) => kind.kindKey === hint.kindKey)) {
      setSelectedKindKey(hint.kindKey);
      writeWorkloadTypePref(hint.kindKey);
    }
    if (hint.findCase) {
      focusHintAppliedRef.current = true;
      pendingFocusRef.current = null;
      focusFindCase();
      return;
    }
    if (hint.trackingId && hint.entityType) {
      focusHintAppliedRef.current = true;
      pendingFocusRef.current = null;
      void run(async () => {
        openWorkingCase(await getWorkflowSummary(hint.entityType!, hint.trackingId!));
      });
      return;
    }
    if (!hint.stageKey) {
      focusHintAppliedRef.current = true;
      pendingFocusRef.current = null;
      return;
    }
    const candidates =
      mode === 'try'
        ? trySections.flatMap((section) =>
            section.queues.map((queue) => ({
              definitionKey: section.member.definitionKey,
              queueKey: queue.queueKey,
              stageQueueKey: stageQueueKeyFromRelease(
                desks[section.member.definitionKey]?.release,
                hint.stageKey!
              )
            }))
          )
        : liveSections.flatMap((section) =>
            section.queues.map((queue) => ({
              definitionKey: queue.definitionKey,
              queueKey: queue.queueKey,
              stageQueueKey: stageQueueKeyFromRelease(
                kindSearchReleases[queue.definitionKey],
                hint.stageKey!
              )
            }))
          );
    if (candidates.length === 0) {
      // Wait until queues for the selected kind are loaded.
      return;
    }
    const match =
      candidates.find((queue) =>
        queueMatchesStage(queue.queueKey, hint.stageKey!, queue.stageQueueKey)
      ) ??
      candidates.find((queue) => queueMatchesStage(queue.queueKey, hint.stageKey!));
    focusHintAppliedRef.current = true;
    pendingFocusRef.current = null;
    if (match) {
      openQueue(match.definitionKey, match.queueKey);
    }
  }, [desks, kindSearchReleases, kinds, liveSections, mode, trySections]);

  return (
    <section
      className={`optic-workspace${mode === 'try' ? ' optic-workspace-rehearsal-mode' : ''}${
        working ? ' optic-workspace-case-open' : ''
      }`}
      aria-labelledby="workspace-heading"
    >
      <header className="optic-workspace-hero">
        <div>
          <p className="optic-workspace-kicker">{mode === 'try' ? 'Draft rehearsal' : 'Activated work'}</p>
          <h1 id="workspace-heading">Officer workspace</h1>
        </div>
        <div className="optic-workspace-hero-tools">
          <WorkingAsField
            label="Signed in as"
            value={actorId}
            onChange={chooseOfficer}
            readOnly={!actorOverrideEnabled}
          />
          {tryModeEnabled ? (
            <div className="optic-designer-view-toggle" role="group" aria-label="Workspace mode">
              <button type="button" aria-pressed={mode === 'try'} onClick={() => setMode('try')}>
                <ButtonLabel icon="draft">Try</ButtonLabel>
              </button>
              <button type="button" aria-pressed={mode === 'live'} onClick={() => setMode('live')}>
                <ButtonLabel icon="live">Live</ButtonLabel>
              </button>
            </div>
          ) : null}
          <button type="button" className="optic-guide-button" onClick={() => setGuideOpen(true)}>
            <ButtonLabel icon="help">User guide</ButtonLabel>
          </button>
        </div>
      </header>
      {guideOpen ? (
        <UserGuideDialog
          title="Officer Workspace user guide"
          source={OFFICER_USER_GUIDE}
          onClose={() => setGuideOpen(false)}
        />
      ) : null}
      {mode === 'try' ? (
        <p className="optic-workspace-rehearsal-banner" role="status">
          Rehearsal — draft data only. Switch to <strong>Live</strong> for activated work.
        </p>
      ) : null}
      <div className="optic-workspace-context" role="status" aria-label="Workspace context">
        <span className="optic-workspace-context-chip" data-mode={mode}>
          {mode === 'try' ? 'Try' : 'Live'}
        </span>
        <span className="optic-workspace-context-sep" aria-hidden="true">
          ·
        </span>
        <span>{selectedKind?.label ?? 'No workload type'}</span>
        {queuePage ? (
          <>
            <span className="optic-workspace-context-sep" aria-hidden="true">
              ·
            </span>
            <span>{queuePage.displayName}</span>
          </>
        ) : null}
        <span className="optic-workspace-context-sep" aria-hidden="true">
          ·
        </span>
        <span>{actorId}</span>
        {working ? (
          <>
            <span className="optic-workspace-context-sep" aria-hidden="true">
              ·
            </span>
            <span className="optic-workspace-context-case">{working.trackingId}</span>
          </>
        ) : null}
        {searchEnabled && !findExpanded ? (
          <button
            type="button"
            className="optic-workspace-context-find"
            onClick={() => focusFindCase()}
          >
            <ButtonLabel icon="search">Find a case</ButtonLabel>
          </button>
        ) : null}
      </div>
      <CaughtErrorBanner error={formFieldErrors.length > 0 ? undefined : errorBanner} />
      <StatusToast message={statusToast} onDismiss={() => setStatusToast(undefined)} />
      {working ? (
        <div className="optic-workspace-case-mode-bar" role="status">
          <button type="button" className="optic-button-secondary" onClick={() => setWorking(undefined)}>
            <ButtonLabel icon="queue">Back to queues</ButtonLabel>
          </button>
          <TrackingIdLinkWithCopy trackingId={working.trackingId} />
          <span className="optic-workspace-case-mode-meta">
            {working.entityType}
            {working.workflow.currentStageLabel
              ? ` · ${working.workflow.currentStageLabel}`
              : working.workflow.currentStageKey
                ? ` · ${working.workflow.currentStageKey}`
                : ''}
          </span>
          <span className="optic-workspace-case-mode-meta">Case-first mode · Esc closes</span>
        </div>
      ) : null}
      <div
        className={`optic-workspace-desk${
          working ? ' optic-workspace-desk-focused optic-workspace-desk-case-open' : ''
        }`}
      >
        <div className="optic-workspace-sidebar">
          <section className="optic-workspace-card optic-workspace-kind-card" aria-labelledby="kind-heading">
            <h2 id="kind-heading">
              <ButtonLabel icon="form">Workload Type</ButtonLabel>
            </h2>
            {kinds.length === 0 ? (
              <p className="optic-help">
                {mode === 'try'
                  ? 'Open Designer and save a draft to see workload types here (I-407, I-90, I-131).'
                  : 'Activate a published release to see live workload types. Switch to Try to walk a draft.'}
              </p>
            ) : (
              <WorkloadTypeSelect
                kinds={kinds}
                value={selectedKindKey}
                disabled={busy}
                onChange={(kindKey) => {
                  setSelectedKindKey(kindKey);
                  writeWorkloadTypePref(kindKey);
                  setSelected(undefined);
                  setWorking(undefined);
                }}
              />
            )}
            {selectedKind ? (
              <div className="optic-workspace-toolbar">
                <button
                  type="button"
                  className="optic-button-primary"
                  disabled={busy}
                  onClick={() => void arriveNewWork()}
                >
                  <ButtonLabel icon="live">
                    {intakeMember(selectedKind)?.entityType === 'MAIL' ? 'New mail arrives' : 'New work arrives'}
                  </ButtonLabel>
                </button>
                <p className="optic-help">
                  {mode === 'try'
                    ? `${selectedKind.label} · saved draft`
                    : `${selectedKind.label} · activated queues plus Assigned to Me, All Items, and Completed`}
                </p>
              </div>
            ) : null}
          </section>
          {selectedKind ? (
            <aside className="optic-workspace-rail">
              <section className="optic-workspace-card" aria-label="Queues">
                {mode === 'try'
                  ? trySections.map((section) => (
                      <QueueSection
                        key={section.member.definitionKey}
                        heading={section.member.entityType === 'MAIL' ? 'Mail item queues' : 'Workload queues'}
                        icon={section.member.entityType === 'MAIL' ? 'inbox' : 'queue'}
                        definitionKey={section.member.definitionKey}
                        queues={section.queues.map((queue) => ({
                          queueKey: queue.queueKey,
                          displayName: queue.displayName,
                          count: itemsInQueue(
                            queue,
                            desks[section.member.definitionKey]?.release.workflow ?? {
                              stages: [],
                              terminalStageKeys: [],
                              initialStageKey: '',
                              transitionSets: []
                            },
                            section.items,
                            actorId
                          ).length
                        }))}
                        selected={selected}
                        busy={busy}
                        onOpen={openQueue}
                      />
                    ))
                  : liveSections.map((section) => (
                      <QueueSection
                        key={section.heading}
                        heading={section.heading}
                        icon={section.entityType === 'MAIL' ? 'inbox' : 'queue'}
                        definitionKey={
                          section.queues[0]?.definitionKey ?? selectedKind.members[0]?.definitionKey ?? ''
                        }
                        queues={section.queues.map((queue) => ({
                          queueKey: queue.queueKey,
                          displayName: queue.displayName,
                          count: queue.total ?? 0
                        }))}
                        selected={selected}
                        busy={busy}
                        onOpen={(definitionKey, queueKey) =>
                          openQueue(
                            section.queues.find((queue) => queue.queueKey === queueKey)?.definitionKey ??
                              definitionKey,
                            queueKey
                          )
                        }
                      />
                    ))}
              </section>
            </aside>
          ) : null}
        </div>
        {searchEnabled ? (
          <div
            className={`optic-workspace-card optic-workspace-search-card${
              findExpanded ? '' : ' is-collapsed'
            }`}
          >
            {findExpanded ? (
              <>
                <div className="optic-workspace-search-collapse-bar">
                  <button
                    type="button"
                    className="optic-button-secondary"
                    onClick={() => setFindExpandedPref(false)}
                  >
                    Hide Find a case
                  </button>
                </div>
                <SearchScreen
                  headingLevel={2}
                  compact
                  openTrackingId={working?.trackingId}
                  extraFields={searchExtraFields}
                  definitionKeys={selectedKind?.members.map((member) => member.definitionKey)}
                  onOpen={(hit) => void openSearchHit(hit)}
                />
              </>
            ) : (
              <div className="optic-workspace-search-collapsed">
                <button
                  type="button"
                  className="optic-button-secondary"
                  onClick={() => focusFindCase()}
                >
                  <ButtonLabel icon="search">Find a case</ButtonLabel>
                </button>
                <p className="optic-help">Press / to search by tracking ID or receipt.</p>
                {recentCases.length > 0 ? (
                  <div className="optic-workspace-recent" aria-label="Recent cases">
                    <p className="optic-workspace-recent-label">Recent</p>
                    <ul className="optic-workspace-recent-list">
                      {recentCases.map((item) => (
                        <li key={item.trackingId}>
                          <button
                            type="button"
                            className="optic-workspace-recent-id"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                openWorkingCase(
                                  await getWorkflowSummary(item.entityType, item.trackingId)
                                );
                              })
                            }
                          >
                            {item.trackingId}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
        <div className="optic-workspace-main">
          {queuePage ? (
            <QueueScreen
              queue={queuePage}
              actorId={actorId}
              headingLevel={2}
              openTrackingId={working?.trackingId}
              emptyHint={
                queuePage.rows.length === 0
                  ? searchEnabled
                    ? 'No cases in this queue. Try Find a case, or open another queue on the left.'
                    : 'No cases in this queue. Open another queue on the left.'
                  : undefined
              }
              onFindCase={searchEnabled && queuePage.rows.length === 0 ? focusFindCase : undefined}
              onPageChange={setListPage}
              onFilterChange={changeQueueFilter}
              onAssign={(row) => void assignRow(row)}
              onOpen={(row) => void openRow(row)}
              onRelease={(row) => void releaseRow(row)}
              onReassign={(row, assignedTo) => void reassignRow(row, assignedTo)}
            />
          ) : (
            <div className="optic-workspace-main-empty" role="status">
              <p>
                {kinds.length === 0
                  ? mode === 'live'
                    ? 'No activated workload types yet. Switch to Try to rehearse a draft, or activate a published release.'
                    : 'No drafts yet. Open Designer and save a workload type to practice here.'
                  : selectedKind
                    ? 'Open a queue on the left to start, or use Find a case.'
                    : 'Select a workload type to see its queues, or use Find a case.'}
              </p>
              {firstWorkQueue ||
              searchEnabled ||
              (mode === 'live' && kinds.length === 0) ||
              (selectedKind && !queuePage) ? (
                <div className="optic-workspace-main-empty-actions">
                  {firstWorkQueue ? (
                    <button
                      type="button"
                      className="optic-button-primary"
                      disabled={busy}
                      onClick={() => openQueue(firstWorkQueue.definitionKey, firstWorkQueue.queueKey)}
                    >
                      <ButtonLabel icon="queue">Open {firstWorkQueue.displayName}</ButtonLabel>
                    </button>
                  ) : null}
                  {searchEnabled ? (
                    <button type="button" className="optic-button-secondary" onClick={() => focusFindCase()}>
                      <ButtonLabel icon="search">Find a case</ButtonLabel>
                    </button>
                  ) : null}
                  {!firstWorkQueue && mode === 'live' && kinds.length === 0 ? (
                    <button type="button" className="optic-button-secondary" onClick={() => setMode('try')}>
                      <ButtonLabel icon="draft">Switch to Try</ButtonLabel>
                    </button>
                  ) : null}
                  {selectedKind && !queuePage && !firstWorkQueue ? (
                    <button
                      type="button"
                      className="optic-button-primary"
                      disabled={busy}
                      onClick={() => void arriveNewWork()}
                    >
                      <ButtonLabel icon="live">
                        {intakeMember(selectedKind)?.entityType === 'MAIL'
                          ? 'New mail arrives'
                          : 'New work arrives'}
                      </ButtonLabel>
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>
        {working ? (
          <>
            <button
              type="button"
              className="optic-case-drawer-scrim"
              aria-label="Dismiss case overlay"
              tabIndex={-1}
              onClick={() => setWorking(undefined)}
            />
            <aside className="optic-case-drawer" aria-label="Opened case">
              <OfficerCasePane
                working={working}
                workflow={caseWorkflow ?? working.workflowDefinition}
                forms={Object.keys(caseForms).length > 0 ? caseForms : (working.forms ?? {})}
                busy={busy}
                formErrors={formFieldErrors}
                onFormEdit={(previous, next) => {
                  if (formFieldErrors.length === 0) {
                    return;
                  }
                  setFormFieldErrors((current) => retainFormErrorsAfterEdit(current, previous, next));
                }}
                onComplete={(actionKey, dataPatch) => void completeWorking(actionKey, dataPatch)}
                onAssign={() => void assignWorking()}
                onReassign={(assignedTo) => void reassignWorking(assignedTo)}
                onRelease={() => void releaseWorking()}
                onClose={() => {
                  clearWorkspaceErrors();
                  setWorking(undefined);
                }}
              />
            </aside>
          </>
        ) : null}
      </div>
    </section>
  );
}

function QueueSection({
  heading,
  icon,
  definitionKey,
  queues,
  selected,
  busy,
  onOpen
}: {
  heading: string;
  icon: 'inbox' | 'queue';
  definitionKey: string;
  queues: Array<{ queueKey: string; displayName: string; count?: number }>;
  selected?: SelectedQueue;
  busy: boolean;
  onOpen: (definitionKey: string, queueKey: string) => void;
}) {
  const entity = icon === 'inbox' ? 'mail' : 'workload';
  return (
    <section
      className={`optic-workspace-section optic-workspace-section-${entity}`}
      data-entity={entity}
      aria-label={heading}
    >
      <h2>
        <ButtonLabel icon={icon}>{heading}</ButtonLabel>
      </h2>
      {queues.length === 0 ? (
        <p className="optic-help">No queues for this side yet.</p>
      ) : (
        <nav className="optic-workspace-queue-list" aria-label={heading}>
          {queues.map((queue) => (
            <button
              key={`${definitionKey}:${queue.queueKey}`}
              type="button"
              aria-pressed={selected?.definitionKey === definitionKey && selected.queueKey === queue.queueKey}
              disabled={busy}
              onClick={() => onOpen(definitionKey, queue.queueKey)}
            >
              <span className="optic-workspace-queue-name">
                <ButtonLabel icon="queue">{queue.displayName}</ButtonLabel>
              </span>
              {queue.count != null ? (
                <span key={queue.count} className="optic-count-badge optic-count-badge-pulse">
                  {queue.count}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
      )}
    </section>
  );
}

