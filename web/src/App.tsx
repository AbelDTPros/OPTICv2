import { useEffect, useMemo, useState } from 'react';
import { AdminWorkspace } from './platform/admin/AdminWorkspace.js';
import { FeatureFlagsProvider, useFeatureFlags } from './platform/features/FeatureFlagsContext.js';
import { documentTitleForView, PRODUCT_NAME, PRODUCT_VERSION } from './platform/branding.js';
import {
  APP_NAVIGATE_EVENT,
  requestAppView,
  type AppViewId
} from './platform/navigation/app-navigation.js';
import { PrimaryShellNav } from './platform/shell/PrimaryShellNav.js';
import {
  firstEnabledShellNavView,
  type ShellNavView
} from './platform/shell/shell-nav-order.js';
import { CommandPalette, type CommandPaletteItem } from './platform/ui/CommandPalette.js';
import { Icon } from './platform/ui/Icon.js';
import { confirmLeaveDesigner } from './platform/designers/designer-leave-guard.js';
import { DesignerWorkspace } from './platform/designers/DesignerWorkspace.js';
import { SupervisorWorkspace } from './platform/supervisor/SupervisorWorkspace.js';
import { OfficerWorkspace } from './platform/workspace/OfficerWorkspace.js';

const VIEW_TITLES = {
  workspace: 'Workspace',
  supervisor: 'Dashboard',
  designer: 'Designer',
  admin: 'Admin'
} as const;

type AppView = keyof typeof VIEW_TITLES;

/** Optimistic enables for first paint (matches FeatureFlagsProvider defaults). */
function initialShellView(): AppView {
  return (
    firstEnabledShellNavView({
      workspace: true,
      supervisor: true,
      designer: true,
      admin: false
    }) ?? 'workspace'
  );
}

export function App() {
  return (
    <FeatureFlagsProvider>
      <AppShell />
    </FeatureFlagsProvider>
  );
}

function AppShell() {
  const { admin, isEnabled } = useFeatureFlags();
  const workspaceEnabled = isEnabled('ui.shell.workspace');
  const supervisorEnabled = isEnabled('ui.shell.supervisor');
  const designerEnabled = isEnabled('ui.shell.designer');
  const commandPaletteEnabled = isEnabled('ui.shell.command_palette');
  const workspaceSearchEnabled = isEnabled('ui.workspace.search') && isEnabled('api.search');
  const designerTryEnabled = isEnabled('ui.designer.try');
  const designerLifecycleEnabled = isEnabled('ui.designer.lifecycle');
  const adminEnabled = admin.uiEnabled;
  const [view, setView] = useState<AppView>(initialShellView);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shellScrolled, setShellScrolled] = useState(false);

  function changeView(next: AppView) {
    if (next === view) {
      return;
    }
    if (view === 'designer' && next !== 'designer' && !confirmLeaveDesigner()) {
      return;
    }
    setView(next);
  }

  useEffect(() => {
    function onScroll() {
      setShellScrolled(window.scrollY > 4);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const enabled: Record<ShellNavView, boolean> = {
      workspace: workspaceEnabled,
      supervisor: supervisorEnabled,
      designer: designerEnabled,
      admin: adminEnabled
    };
    if (enabled[view]) {
      return;
    }
    const fallback = firstEnabledShellNavView(enabled);
    if (fallback) {
      setView(fallback);
    }
  }, [adminEnabled, designerEnabled, supervisorEnabled, view, workspaceEnabled]);

  useEffect(() => {
    document.title = documentTitleForView(VIEW_TITLES[view]);
  }, [view]);

  useEffect(() => {
    function onNavigate(event: Event) {
      const detail = (event as CustomEvent<{ view?: AppViewId }>).detail;
      const next = detail?.view;
      if (!next || !(next in VIEW_TITLES)) {
        return;
      }
      const enabled: Record<AppView, boolean> = {
        workspace: workspaceEnabled,
        supervisor: supervisorEnabled,
        designer: designerEnabled,
        admin: adminEnabled
      };
      if (enabled[next]) {
        changeView(next);
      }
    }
    window.addEventListener(APP_NAVIGATE_EVENT, onNavigate);
    return () => window.removeEventListener(APP_NAVIGATE_EVENT, onNavigate);
  }, [adminEnabled, designerEnabled, supervisorEnabled, view, workspaceEnabled]);

  useEffect(() => {
    if (!commandPaletteEnabled) {
      setPaletteOpen(false);
    }
  }, [commandPaletteEnabled]);

  useEffect(() => {
    if (!commandPaletteEnabled) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'k') {
        return;
      }
      event.preventDefault();
      setPaletteOpen((open) => !open);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commandPaletteEnabled]);

  const commands = useMemo((): CommandPaletteItem[] => {
    const items: CommandPaletteItem[] = [];
    if (workspaceEnabled) {
      items.push({
        id: 'go-workspace',
        label: 'Go to Workspace',
        hint: 'Queues & cases',
        group: 'Navigate',
        run: () => changeView('workspace')
      });
      if (workspaceSearchEnabled) {
        items.push({
          id: 'find-case',
          label: 'Find a case',
          hint: 'Workspace search',
          group: 'Workspace',
          run: () => requestAppView('workspace', { findCase: true })
        });
      }
    }
    if (supervisorEnabled) {
      items.push({
        id: 'go-dashboard',
        label: 'Go to Dashboard',
        hint: 'Queue pressure',
        group: 'Navigate',
        run: () => changeView('supervisor')
      });
    }
    if (designerEnabled) {
      items.push({
        id: 'go-designer',
        label: 'Go to Designer',
        hint: 'Author releases',
        group: 'Navigate',
        run: () => changeView('designer')
      });
      items.push(
        {
          id: 'designer-form',
          label: 'Designer · Form',
          hint: 'Build',
          group: 'Designer',
          run: () => requestAppView('designer', undefined, { tab: 'form' })
        },
        {
          id: 'designer-workflow',
          label: 'Designer · Workflow',
          hint: 'Build',
          group: 'Designer',
          run: () => requestAppView('designer', undefined, { tab: 'workflow' })
        },
        {
          id: 'designer-catalog',
          label: 'Designer · Catalog',
          hint: 'Build',
          group: 'Designer',
          run: () => requestAppView('designer', undefined, { tab: 'catalog' })
        }
      );
      if (designerTryEnabled) {
        items.push({
          id: 'designer-try',
          label: 'Designer · Try',
          hint: 'Rehearse',
          group: 'Designer',
          run: () => requestAppView('designer', undefined, { tab: 'try' })
        });
      }
      if (designerLifecycleEnabled) {
        items.push({
          id: 'designer-lifecycle',
          label: 'Designer · Lifecycle',
          hint: 'Release',
          group: 'Designer',
          run: () => requestAppView('designer', undefined, { tab: 'lifecycle' })
        });
      }
    }
    if (adminEnabled) {
      items.push(
        {
          id: 'go-admin',
          label: 'Go to Admin',
          hint: 'Environment controls',
          group: 'Navigate',
          run: () => changeView('admin')
        },
        {
          id: 'admin-features',
          label: 'Admin · Features',
          hint: 'Feature flags',
          group: 'Admin',
          run: () => requestAppView('admin', undefined, undefined, { section: 'features' })
        },
        {
          id: 'admin-audit',
          label: 'Admin · Audit trail',
          hint: 'History',
          group: 'Admin',
          run: () => requestAppView('admin', undefined, undefined, { section: 'audit' })
        },
        {
          id: 'admin-integrations',
          label: 'Admin · Integrations',
          hint: 'Coming next',
          group: 'Admin',
          run: () => requestAppView('admin', undefined, undefined, { section: 'integrations' })
        }
      );
    }
    return items;
  }, [
    adminEnabled,
    designerEnabled,
    designerLifecycleEnabled,
    designerTryEnabled,
    supervisorEnabled,
    view,
    workspaceEnabled,
    workspaceSearchEnabled
  ]);

  const contextLabel = VIEW_TITLES[view];
  const paletteShortcut = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘K'
    : 'Ctrl+K';

  return (
    <div className="optic-app">
      <a className="optic-skip-link" href="#optic-main">
        Skip to main content
      </a>
      <div className="optic-shell-wrap" data-scrolled={shellScrolled ? 'true' : undefined}>
        <header className="optic-shell">
          <div className="optic-shell-inner">
            <div className="optic-shell-brand">
              <span className="optic-shell-mark" aria-hidden="true">
                O
              </span>
              <div className="optic-shell-wordmark">
                <p className="optic-banner-product">{PRODUCT_NAME}</p>
                <p className="optic-banner-context">
                  <span className="optic-banner-product-sub">{PRODUCT_VERSION}</span>
                  <span aria-hidden="true"> · </span>
                  {contextLabel}
                </p>
              </div>
            </div>
            <div className="optic-shell-nav-tools">
              <PrimaryShellNav
                enabled={{
                  workspace: workspaceEnabled,
                  supervisor: supervisorEnabled,
                  designer: designerEnabled,
                  admin: adminEnabled
                }}
                currentView={view}
                onSelect={changeView}
              />
              {commandPaletteEnabled ? (
                <button
                  type="button"
                  className="optic-shell-command-toggle"
                  title={`Jump to a page or action (${paletteShortcut})`}
                  aria-label={`Jump to… (${paletteShortcut})`}
                  onClick={() => setPaletteOpen(true)}
                >
                  <Icon name="search" />
                  <span>Jump to…</span>
                  <kbd className="optic-shell-command-kbd">{paletteShortcut}</kbd>
                </button>
              ) : null}
            </div>
          </div>
        </header>
      </div>
      <main id="optic-main" tabIndex={-1} className="optic-main-wide">
        <div key={view} className="optic-view-enter">
          {view === 'admin' && adminEnabled ? (
            <AdminWorkspace />
          ) : view === 'designer' && designerEnabled ? (
            <DesignerWorkspace />
          ) : view === 'supervisor' && supervisorEnabled ? (
            <SupervisorWorkspace />
          ) : workspaceEnabled ? (
            <OfficerWorkspace />
          ) : (
            <p className="optic-help">No product surfaces are enabled for this environment.</p>
          )}
        </div>
      </main>
      {commandPaletteEnabled ? (
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      ) : null}
    </div>
  );
}
