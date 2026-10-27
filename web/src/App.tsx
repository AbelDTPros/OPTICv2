import { useEffect, useState } from 'react';
import { AdminWorkspace } from './platform/admin/AdminWorkspace.js';
import { FeatureFlagsProvider, useFeatureFlags } from './platform/features/FeatureFlagsContext.js';
import { Icon } from './platform/ui/Icon.js';
import { DesignerWorkspace } from './platform/designers/DesignerWorkspace.js';
import { OfficerWorkspace } from './platform/workspace/OfficerWorkspace.js';

const VIEW_TITLES = {
  workspace: 'Workspace',
  designer: 'Designer',
  admin: 'Admin'
} as const;

type AppView = keyof typeof VIEW_TITLES;

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
  const designerEnabled = isEnabled('ui.shell.designer');
  const adminEnabled = admin.uiEnabled;
  const [view, setView] = useState<AppView>('workspace');

  useEffect(() => {
    if (view === 'workspace' && !workspaceEnabled) {
      if (designerEnabled) {
        setView('designer');
      } else if (adminEnabled) {
        setView('admin');
      }
      return;
    }
    if (view === 'designer' && !designerEnabled) {
      if (workspaceEnabled) {
        setView('workspace');
      } else if (adminEnabled) {
        setView('admin');
      }
      return;
    }
    if (view === 'admin' && !adminEnabled) {
      if (workspaceEnabled) {
        setView('workspace');
      } else if (designerEnabled) {
        setView('designer');
      }
    }
  }, [adminEnabled, designerEnabled, view, workspaceEnabled]);

  useEffect(() => {
    document.title = `OPTIC NextGen — ${VIEW_TITLES[view]}`;
  }, [view]);

  return (
    <div className="optic-app">
      <a className="optic-skip-link" href="#optic-main">
        Skip to main content
      </a>
      <header className="optic-shell">
        <div className="optic-shell-brand">
          <span className="optic-shell-mark" aria-hidden="true" />
          <div className="optic-shell-wordmark">
            <p className="optic-banner-product">OPTIC</p>
            <p className="optic-banner-product-sub">NextGen</p>
            <p className="optic-banner-context">
              {view === 'designer' ? 'Configuration' : view === 'admin' ? 'Administration' : 'Workspace'}
            </p>
          </div>
        </div>
        <nav className="optic-demo-nav" aria-label="Primary">
          {workspaceEnabled ? (
            <button
              type="button"
              aria-current={view === 'workspace' ? 'page' : undefined}
              onClick={() => setView('workspace')}
            >
              <Icon name="queue" />
              Workspace
            </button>
          ) : null}
          {designerEnabled ? (
            <button
              type="button"
              aria-current={view === 'designer' ? 'page' : undefined}
              onClick={() => setView('designer')}
            >
              <Icon name="designer" />
              Designer
            </button>
          ) : null}
          {adminEnabled ? (
            <button
              type="button"
              aria-current={view === 'admin' ? 'page' : undefined}
              onClick={() => setView('admin')}
            >
              <Icon name="check" />
              Admin
            </button>
          ) : null}
        </nav>
      </header>
      <main id="optic-main" tabIndex={-1} className="optic-main-wide">
        {view === 'admin' && adminEnabled ? (
          <AdminWorkspace />
        ) : view === 'designer' && designerEnabled ? (
          <DesignerWorkspace />
        ) : workspaceEnabled ? (
          <OfficerWorkspace />
        ) : (
          <p className="optic-help">No product surfaces are enabled for this environment.</p>
        )}
      </main>
    </div>
  );
}
